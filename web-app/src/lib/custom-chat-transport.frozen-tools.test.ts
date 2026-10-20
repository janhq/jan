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

  it('invalidate during refresh does not throw', async () => {
    const t = new CustomChatTransport('sys', 'thread-1')
    const p = t.refreshTools()
    expect(() => t.invalidateFrozenTools()).not.toThrow()
    await expect(p).resolves.toBeUndefined()
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
