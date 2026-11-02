import { describe, expect, it, vi, beforeEach } from 'vitest'

import type { UIMessage } from '@ai-sdk/react'
import type { MCPTool } from '@/types/completion'

// Reuse the isolated shell-switch fixture: no providers, IPC or network calls.
const h = vi.hoisted(() => ({
  routing: false,
  routedTools: [] as MCPTool[],
  shellEnabled: false,
  webEnabled: false,
  documents: false,
  disabled: [] as string[],
  mcpTools: [] as MCPTool[],
  ragTools: [] as MCPTool[],
  sandbox: true,
  schemas: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: h.shellEnabled }) },
}))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: new Set(['shell']),
  getAgentToolSchemas: h.schemas,
  sandboxEnforces: () => h.sandbox,
  memoryDigestNow: () => '',
  refreshMemoryDigest: async () => '',
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        mcp: () => ({
          getTools: async () => h.mcpTools,
          getToolsForServers: async () => h.routedTools,
          getServerSummaries: async () => [],
        }),
        rag: () => ({ getTools: async () => h.ragTools }),
      },
    }),
  },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => h.disabled }) },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: { id: 'test-model', capabilities: ['tools'] },
      selectedProvider: 'test-provider',
      getProviderByName: () => ({ provider: 'test-provider', models: [] }),
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: { 'thread-1': { metadata: { hasDocuments: h.documents } } } }) },
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: h.documents }) },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => ({ settings: { enableSmartToolRouting: h.routing } }),
  },
}))
vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: { getState: () => ({ webSearchEnabled: h.webEnabled }) },
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: async () => h.routedTools },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn(async () => ({})) },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => new Proxy({}, { get: () => () => undefined }),
  },
}))
vi.mock('@/lib/reasoningProviderOptions', () => ({
  buildReasoningProviderOptions: () => undefined,
}))
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: h.streamText,
}))

import { CustomChatTransport } from '../custom-chat-transport'

const tool = (name: string, server: string, description = `${server}/${name}`): MCPTool => ({
  name, server, description, inputSchema: { type: 'object' },
})

describe('transport advertised MCP identity', () => {
  let transport: CustomChatTransport

  beforeEach(() => {
    h.routing = false
    h.routedTools = []
    h.shellEnabled = false
    h.webEnabled = false
    h.documents = false
    h.disabled = []
    h.mcpTools = []
    h.ragTools = []
    h.streamText.mockReset()
    h.schemas.mockReset()
    h.schemas.mockResolvedValue([{
      type: 'function',
      function: { name: 'shell', description: 'native sandbox shell', parameters: { type: 'object' } },
    }])
    transport = new CustomChatTransport('sys', 'thread-1')
  })

  it('binds the original advertised name to its server and refreshes the binding', async () => {
    h.mcpTools = [tool('read', 'alpha')]
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toEqual(['read'])
    expect(transport.getTools().read.description).toBe('alpha/read')
    expect(transport.getMcpServerForTool('read')).toBe('alpha')
    h.mcpTools = [tool('read', 'beta')]
    await transport.refreshTools()
    expect(transport.getMcpServerForTool('read')).toBe('beta')
    h.mcpTools = []
    await transport.refreshTools()
    expect(transport.getTools()).toEqual({})
    expect(transport.getMcpServerForTool('read')).toBeUndefined()
  })

  it.each([{ disabled: [] }, { disabled: ['beta::read'] }])('withholds collisions even when a rival is disabled: $disabled', async ({ disabled }) => {
    h.disabled = disabled
    h.mcpTools = [tool('read', 'alpha'), tool('read', 'beta'), tool('write', 'alpha')]
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toEqual(['write'])
    expect(transport.getMcpServerForTool('read')).toBeUndefined()
    expect(transport.getMcpServerForTool('write')).toBe('alpha')
  })

  it('warns for hidden/disabled rivals and missing identities without logging tool data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      h.routing = true
      h.disabled = ['beta::read']
      h.mcpTools = [tool('read', 'alpha', 'SECRET_DESCRIPTION'), tool('read', 'beta'), tool('orphan', '')]
      h.routedTools = [h.mcpTools[0]]
      await transport.refreshTools()
      expect(transport.getTools()).toEqual({})
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Withheld MCP tool "read".*name collision.*"alpha".*"beta"/))
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Withheld MCP tool "orphan".*missing server identity/))
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET_DESCRIPTION')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('inputSchema')
    } finally {
      warn.mockRestore()
    }
  })

  it('withholds absent identity and disabled pairs and drops their old bindings', async () => {
    h.mcpTools = [tool('read', 'alpha')]
    await transport.refreshTools()
    h.disabled = ['alpha::read']
    h.mcpTools.push(tool('missing', undefined as unknown as string), tool('blank', '  '))
    await transport.refreshTools()
    expect(transport.getTools()).toEqual({})
    for (const name of ['read', 'missing', 'blank']) {
      expect(transport.getMcpServerForTool(name)).toBeUndefined()
    }
  })

  it('keeps RAG schemas and does not attach an overlapping MCP identity', async () => {
    h.documents = true
    h.ragTools = [tool('retrieve', 'rag', 'internal retrieval')]
    h.mcpTools = [tool('retrieve', 'external'), tool('read', 'alpha')]
    await transport.refreshTools()
    expect(transport.getTools().retrieve.description).toBe('internal retrieval')
    expect(transport.getMcpServerForTool('retrieve')).toBeUndefined()
    expect(transport.getMcpServerForTool('read')).toBe('alpha')
  })

  it('gives native web schemas precedence and removes overlapping MCP bindings', async () => {
    h.mcpTools = [tool('web_search', 'external'), tool('web_fetch', 'external')]
    await transport.refreshTools()
    expect(transport.getMcpServerForTool('web_search')).toBe('external')
    h.webEnabled = true
    await transport.refreshTools()
    for (const name of ['web_search', 'web_fetch']) {
      expect(transport.getTools()[name]).toBeDefined()
      expect(transport.getTools()[name].description).not.toBe(`external/${name}`)
      expect(transport.getMcpServerForTool(name)).toBeUndefined()
    }
    h.webEnabled = false
    await transport.refreshTools()
    expect(transport.getMcpServerForTool('web_fetch')).toBe('external')
  })

  it('gives native shell precedence only while its schema is advertised', async () => {
    h.mcpTools = [tool('shell', 'external')]
    await transport.refreshTools()
    expect(transport.getMcpServerForTool('shell')).toBe('external')
    h.shellEnabled = true
    await transport.refreshTools()
    expect(transport.getTools().shell.description).toBe('native sandbox shell')
    expect(transport.getMcpServerForTool('shell')).toBeUndefined()
    h.schemas.mockResolvedValue([])
    await transport.refreshTools()
    expect(transport.getTools().shell.description).toBe('external/shell')
    expect(transport.getMcpServerForTool('shell')).toBe('external')
  })

  it('pins the actual request identity while background refresh changes the advertised inventory', async () => {
    let controller!: ReadableStreamDefaultController
    h.streamText.mockReturnValue({
      toUIMessageStream: () => new ReadableStream({ start: (value) => { controller = value } }),
    })
    h.mcpTools = [tool('read', 'alpha')]
    const stream = await transport.sendMessages({
      chatId: 'thread-1',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'read it' }] }] as UIMessage[],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })
    expect(h.streamText).toHaveBeenCalledTimes(1)
    expect(h.streamText.mock.calls[0][0].tools.read.description).toBe('alpha/read')
    expect(transport.getMcpServerForTool('read')).toBe('alpha')

    try {
      h.mcpTools = [tool('read', 'beta'), tool('write', 'beta')]
      await transport.refreshTools()
      expect(transport.getTools().read.description).toBe('beta/read')
      expect(transport.getTools().write).toBeDefined()
      expect(h.streamText.mock.calls[0][0].tools.read.description).toBe('alpha/read')
      expect(transport.getMcpServerForTool('read')).toBe('alpha')
      expect(transport.getMcpServerForTool('write')).toBeUndefined()

      h.mcpTools = []
      await transport.refreshTools()
      expect(transport.getTools()).toEqual({})
      expect(transport.getMcpServerForTool('read')).toBe('alpha')
    } finally {
      controller.close()
      await stream.cancel()
    }
  })

})
