import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { MCPTool } from '@/types/completion'

const h = vi.hoisted(() => ({
  disabledTools: [] as string[],
  servers: ['srv'] as string[],
  getRelevantTools: vi.fn(),
  serviceHub: null as unknown,
}))

const mcpService = {
  getTools: vi.fn(async (): Promise<MCPTool[]> => []),
  getToolsForServers: vi.fn(async () => []),
  getServerSummaries: vi.fn(async () =>
    h.servers.map((name) => ({ name, capabilities: [], description: '' }))
  ),
}

h.serviceHub = {
  mcp: () => mcpService,
  rag: () => ({ getTools: async () => [] }),
}

vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: false }) },
}))
vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: { getState: () => ({ webSearchEnabled: false }) },
}))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: new Set(['shell']),
  getAgentToolSchemas: async () => [],
  sandboxEnforces: () => true,
  memoryDigestNow: () => '',
  refreshMemoryDigest: async () => '',
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: h.serviceHub }) },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => h.disabledTools }) },
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
    getState: () => ({ settings: { enableSmartToolRouting: true } }),
  },
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: h.getRelevantTools },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn() },
}))

import { CustomChatTransport } from '../custom-chat-transport'

describe('CustomChatTransport smart-tool-routing freeze', () => {
  let transport: CustomChatTransport

  beforeEach(() => {
    h.disabledTools = []
    h.servers = ['srv']
    mcpService.getTools.mockReset()
    mcpService.getTools.mockResolvedValue([
      { name: 'tool_a', description: '', inputSchema: {}, server: 'srv' },
    ])
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([
      { name: 'tool_a', description: '', inputSchema: {}, server: 'srv' },
    ])
    transport = new CustomChatTransport('sys', 'thread-1')
  })

  it('routes once and freezes the set across subsequent turns', async () => {
    transport.setLastUserMessage('first query')
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(1)
    expect(Object.keys(transport.getTools())).toContain('tool_a')

    transport.setLastUserMessage('a completely different query')
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(1)
  })

  it('re-routes when the disabled-tool set changes', async () => {
    transport.setLastUserMessage('q1')
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(1)

    h.disabledTools = ['srv::something']
    transport.setLastUserMessage('q2')
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(2)
  })

  it('re-routes when the connected server set changes', async () => {
    transport.setLastUserMessage('q1')
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(1)

    h.servers = ['srv', 'srv2']
    transport.setLastUserMessage('q2')
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    'withholds a routed tool when an omitted colliding rival is disabled=%s',
    async (disableRival) => {
      const routed = { name: 'read', server: 'srv', description: 'routed', inputSchema: {} }
      const safe = { name: 'write', server: 'srv', description: 'safe', inputSchema: {} }
      const rival = { ...routed, server: 'other', description: 'not routed' }
      h.servers = ['srv', 'other']
      h.disabledTools = disableRival ? ['other::read'] : []
      mcpService.getTools.mockResolvedValue([routed, rival, safe])
      h.getRelevantTools.mockResolvedValue([routed, safe])

      transport.setLastUserMessage('use srv only')
      await transport.refreshTools()

      expect(h.getRelevantTools).toHaveBeenCalledTimes(1)
      expect(mcpService.getTools).toHaveBeenCalled()
      expect(Object.keys(transport.getTools())).toEqual(['write'])
      expect(transport.getMcpServerForTool('read')).toBeUndefined()
      expect(transport.getMcpServerForTool('write')).toBe('srv')
    }
  )

})
