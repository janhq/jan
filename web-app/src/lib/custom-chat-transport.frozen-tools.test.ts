import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const getTools = vi.fn()
  const getToolsForServers = vi.fn()
  const getServerSummaries = vi.fn()
  const getRelevantTools = vi.fn()
  const mcpSettings = {
    enableSmartToolRouting: true,
    useLightweightRouterModel: false,
    routerModelProvider: '',
    routerModelId: '',
  }
  const modelState = {
    selectedProvider: 'llamacpp',
    selectedModel: { id: 'm', capabilities: ['tools'] as string[] },
  }
  return {
    getTools,
    getToolsForServers,
    getServerSummaries,
    getRelevantTools,
    mcpSettings,
    modelState,
  }
})

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        mcp: () => ({
          getTools: h.getTools,
          getToolsForServers: h.getToolsForServers,
          getServerSummaries: h.getServerSummaries,
        }),
        rag: () => ({ getTools: async () => [] }),
      },
    }),
  },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: { getState: () => ({ settings: h.mcpSettings }) },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => h.modelState },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => [] }) },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: h.getRelevantTools },
}))
vi.mock('@/lib/mcp-orchestrator/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: h.getRelevantTools },
}))
vi.mock('@/lib/agentTools', async () => ({
  ...(await vi.importActual<object>('@/lib/agentTools')),
  refreshMemoryDigest: vi.fn().mockResolvedValue(undefined),
  getAgentToolSchemas: vi.fn().mockResolvedValue([]),
}))

import { CustomChatTransport } from './custom-chat-transport'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator'

describe('CustomChatTransport frozen routed tools', () => {
  beforeEach(() => {
    vi.mocked(mcpOrchestrator.getRelevantTools).mockReset()
    vi.mocked(mcpOrchestrator.getRelevantTools).mockResolvedValue([
      { name: 'list', server: 'fs', description: '', inputSchema: { type: 'object' } },
    ] as never)
    h.getTools.mockReset().mockResolvedValue([])
    h.getToolsForServers.mockReset().mockResolvedValue([])
    h.getServerSummaries
      .mockReset()
      .mockResolvedValue([{ name: 'fs' }, { name: 'gmail' }])
    h.mcpSettings.enableSmartToolRouting = true
    h.modelState.selectedModel.capabilities = ['tools']
  })

  it('reuses the frozen list when the key is unchanged', async () => {
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(1)
  })

  it('re-routes after invalidateFrozenTools() even though the key is unchanged', async () => {
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    t.invalidateFrozenTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(2)
  })

  it('a refresh superseded by invalidateFrozenTools() does not overwrite the newer result', async () => {
    const tool = (name: string) => ({
      name,
      server: 'fs',
      description: '',
      inputSchema: { type: 'object' },
    })
    let resolveA!: (tools: unknown) => void
    vi.mocked(mcpOrchestrator.getRelevantTools)
      .mockReset()
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveA = resolve)) as never
      )
      .mockResolvedValueOnce([tool('b_tool')] as never)

    const t = new CustomChatTransport('sys', 'thread-1')
    const refreshA = t.refreshTools()
    await vi.waitFor(() =>
      expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(1)
    )
    t.invalidateFrozenTools()
    await t.refreshTools()
    resolveA([tool('a_tool')])
    await refreshA

    expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(2)
    expect(Object.keys(t.getTools())).toContain('b_tool')
    expect(Object.keys(t.getTools())).not.toContain('a_tool')
    // The freeze holds B too: an unchanged-key refresh reuses it.
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(2)
    expect(Object.keys(t.getTools())).toContain('b_tool')
    expect(Object.keys(t.getTools())).not.toContain('a_tool')
  })

  it('is a no-op when routing is disabled', async () => {
    h.mcpSettings.enableSmartToolRouting = false
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    t.invalidateFrozenTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).not.toHaveBeenCalled()
    expect(h.getTools).toHaveBeenCalledTimes(2)
  })

  it('sends no tools when the model lacks the tools capability', async () => {
    h.modelState.selectedModel.capabilities = []
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    t.invalidateFrozenTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).not.toHaveBeenCalled()
  })
})
