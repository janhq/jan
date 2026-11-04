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

vi.mock('@/lib/agentTools', () => ({ refreshMemoryDigest: vi.fn(async () => ''), memoryDigestNow: () => '', getAgentToolSchemas: vi.fn(async () => []), sandboxEnforces: () => false }))

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

  it('refreshes full ownership only when the routed set is invalidated', async () => {
    await transport.refreshTools()
    expect(mcpService.getTools).toHaveBeenCalledTimes(1)
    await transport.refreshTools()
    await transport.refreshTools()
    expect(mcpService.getTools).toHaveBeenCalledTimes(1)
    h.disabledTools = ['srv::newly-disabled']
    await transport.refreshTools()
    expect(mcpService.getTools).toHaveBeenCalledTimes(2)
    h.servers = ['srv', 'other']
    await transport.refreshTools()
    expect(mcpService.getTools).toHaveBeenCalledTimes(3)
  })

  it('shares the collision discovery with orchestrator all-tools fallback', async () => {
    h.getRelevantTools.mockImplementationOnce(async (_message, service) => {
      const first = await service.getTools()
      const second = await service.getTools()
      expect(first).toBe(second)
      return first
    })
    await transport.refreshTools()
    expect(mcpService.getTools).toHaveBeenCalledTimes(1)
  })

  it('freezes tools for the entire Chat run then refreshes on the next turn', async () => {
    const release = transport.beginChatRun()
    await transport.refreshTools(undefined, undefined, true)
    const original = transport.getTools()
    h.servers = ['srv', 'new-server']
    h.disabledTools = ['srv::tool_a']
    await transport.refreshTools()
    expect(transport.getTools()).toBe(original)
    expect(h.getRelevantTools).toHaveBeenCalledTimes(1)
    release()
    await transport.refreshTools()
    expect(h.getRelevantTools).toHaveBeenCalledTimes(2)
  })

  it('ignores discovery started before a run when it completes after the run snapshot', async () => {
    let finishOld!: (tools: unknown[]) => void
    mcpService.getTools.mockResolvedValue([
      { name: 'new_tool', description: '', inputSchema: {}, server: 'srv' },
      { name: 'stale_tool', description: '', inputSchema: {}, server: 'srv' },
    ])
    h.getRelevantTools.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const stale = transport.refreshTools()
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'))
    const release = transport.beginChatRun()
    h.getRelevantTools.mockResolvedValueOnce([{ name: 'new_tool', description: '', inputSchema: {}, server: 'srv' }])
    await transport.refreshTools(undefined, undefined, true)
    finishOld([{ name: 'stale_tool', description: '', inputSchema: {}, server: 'srv' }])
    await stale
    expect(Object.keys(transport.getTools())).toContain('new_tool')
    expect(Object.keys(transport.getTools())).not.toContain('stale_tool')
    release()
  })

  it('does not let an external tool-less global-model refresh win while the run model is loading', async () => {
    const release = transport.beginChatRun()
    const wrongModel = { selectedProvider: 'global-other', selectedModel: { id: 'global-no-tools', capabilities: [] } }
    // The external effect finishes before the request-owned discovery starts.
    await transport.refreshTools(undefined, wrongModel as never)
    expect(h.getRelevantTools).not.toHaveBeenCalled()
    expect(mcpService.getTools).not.toHaveBeenCalled()
    expect(Object.keys(transport.getTools())).toEqual([])
    await transport.refreshTools(undefined, { selectedProvider: 'local', selectedModel: { id: 'local-tools', capabilities: ['tools'] } } as never, true)
    expect(Object.keys(transport.getTools())).toContain('tool_a')
    expect(transport.getMcpServerForTool('tool_a')).toBe('srv')
    await transport.refreshTools(undefined, wrongModel as never)
    expect(Object.keys(transport.getTools())).toContain('tool_a')
    release()
    await transport.refreshTools(undefined, wrongModel as never)
    expect(Object.keys(transport.getTools())).toEqual([])
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
      expect(Object.keys(transport.getTools())).toEqual(['write', 'todo', 'ask'])
      expect(transport.getMcpServerForTool('read')).toBeUndefined()
      expect(transport.getMcpServerForTool('write')).toBe('srv')
    }
  )

})
