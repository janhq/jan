import { describe, expect, it, vi, beforeEach } from 'vitest'

// #9222: a user who turns the chat shell off must get neither the tool nor the
// prompt paragraph that describes it.
const h = vi.hoisted(() => ({
  shellEnabled: true,
  sandbox: true,
  schemas: vi.fn(),
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
        mcp: () => ({ getTools: async () => [] }),
        rag: () => ({ getTools: async () => [] }),
      },
    }),
  },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => [] }) },
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
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
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

describe('chat shell switch (#9222)', () => {
  let transport: CustomChatTransport

  beforeEach(() => {
    h.shellEnabled = true
    h.sandbox = true
    h.schemas.mockReset()
    h.schemas.mockResolvedValue([
      {
        type: 'function',
        function: {
          name: 'shell',
          description: 'run',
          parameters: { type: 'object' },
        },
      },
    ])
    transport = new CustomChatTransport('sys', 'thread-1')
  })

  it('offers the shell and describes it while the switch is on', async () => {
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toContain('shell')
    expect(transport.buildAgentToolsSystemInstruction()).toContain('# Shell')
  })

  it('withholds the shell and its prompt text once the switch is off', async () => {
    h.shellEnabled = false
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).not.toContain('shell')
    expect(transport.buildAgentToolsSystemInstruction()).toBe('')
  })

  it('does not even ask the sandbox for schemas when the switch is off', async () => {
    h.shellEnabled = false
    await transport.refreshTools()
    expect(h.schemas).not.toHaveBeenCalled()
  })

  it('takes effect on the very next send without a new transport', async () => {
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toContain('shell')
    h.shellEnabled = false
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).not.toContain('shell')
  })
})
