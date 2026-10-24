import { describe, expect, it, vi, beforeEach } from 'vitest'

// Tools contributed by extensions are offered to the model under their wire
// names, and the tool toggles switch them off per extension like an MCP server.
const h = vi.hoisted(() => ({
  disabled: [] as string[],
  extensionTools: [] as unknown[],
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({ extensionTools: h.extensionTools }),
  },
}))
vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: false }) },
}))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: new Set(['shell']),
  getAgentToolSchemas: async () => [],
  sandboxEnforces: () => true,
  memoryDigestNow: () => '',
  refreshMemoryDigest: async () => '',
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        mcp: () => ({ getTools: async () => [] }),
        rag: () => ({ getTools: async () => [] }),
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
      selectedModel: { capabilities: ['tools'] },
      selectedProvider: '',
      getProviderByName: () => null,
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => ({ settings: { enableSmartToolRouting: false } }),
  },
}))
vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: { getState: () => ({ webSearchEnabled: false }) },
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: vi.fn() },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn() },
}))

import { CustomChatTransport } from '../custom-chat-transport'

describe('extension tools in the chat transport', () => {
  beforeEach(() => {
    h.disabled = []
    h.extensionTools = [
      {
        wireName: 'x_acme_one__echo',
        extensionId: 'acme.one',
        name: 'echo',
        description: 'Echo the input',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        server: 'ext:acme.one',
      },
    ]
  })

  it('offers each contributed tool under its wire name', async () => {
    const transport = new CustomChatTransport('', 'thread-1')
    await transport.refreshTools()
    const tools = transport.getTools()
    expect(Object.keys(tools)).toEqual(['x_acme_one__echo'])
    expect(tools.x_acme_one__echo.description).toBe('Echo the input')
  })

  it('leaves out a tool the user switched off', async () => {
    h.disabled = ['ext:acme.one::x_acme_one__echo']
    const transport = new CustomChatTransport('', 'thread-1')
    await transport.refreshTools()
    expect(transport.getTools()).toEqual({})
  })
})
