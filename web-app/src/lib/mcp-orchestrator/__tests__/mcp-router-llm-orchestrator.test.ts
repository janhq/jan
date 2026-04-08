import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MCPOrchestrator } from '../mcp-orchestrator'
import type { MCPServiceLike } from '../mcp-orchestrator'
import type { ServerSummary } from '@/services/mcp/types'
import * as mcpRouterLlm from '../mcp-router-llm'

vi.mock('../mcp-router-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mcp-router-llm')>()
  return {
    ...actual,
    selectServersWithLlm: vi.fn(),
  }
})

const manySummaries: ServerSummary[] = [
  { name: 'filesystem', capabilities: ['filesystem'], description: 'files' },
  { name: 'browser', capabilities: ['web'], description: 'web' },
  { name: 'database', capabilities: ['database'], description: 'sql' },
  { name: 'calendar', capabilities: ['calendar'], description: 'events' },
  { name: 'email', capabilities: ['email'], description: 'mail' },
  { name: 'code', capabilities: ['code'], description: 'git' },
]

function makeService(overrides: Partial<MCPServiceLike> = {}): MCPServiceLike {
  return {
    getTools: vi.fn().mockResolvedValue([]),
    getToolsForServers: vi.fn().mockResolvedValue([]),
    getServerSummaries: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('MCPOrchestrator LLM routing', () => {
  let orchestrator: MCPOrchestrator

  beforeEach(() => {
    orchestrator = new MCPOrchestrator()
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses LLM server list when the model returns non-empty selection', async () => {
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockResolvedValue({
      names: ['email', 'calendar'],
      durationMs: 2,
      errorKind: 'none',
      emptyValidatedSelection: false,
    })

    const mockTools = [{ name: 'send', description: '', inputSchema: {}, server: 'email' }]
    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
      getToolsForServers: vi.fn().mockResolvedValue(mockTools),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    await orchestrator.getRelevantTools('schedule a meeting and email invites', service, [], {
      routerModel: fakeModel as never,
    })

    expect(mcpRouterLlm.selectServersWithLlm).toHaveBeenCalled()
    const calledWith = (service.getToolsForServers as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(calledWith).toEqual(['email', 'calendar'])
  })

  it('falls back to keyword routing when LLM returns empty', async () => {
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockResolvedValue({
      names: [],
      durationMs: 1,
      errorKind: 'none',
      emptyValidatedSelection: false,
    })

    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
      getToolsForServers: vi.fn().mockResolvedValue([]),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    await orchestrator.getRelevantTools('read the file from disk', service, [], {
      routerModel: fakeModel as never,
    })

    expect(mcpRouterLlm.selectServersWithLlm).toHaveBeenCalled()
    const calledWith = (service.getToolsForServers as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(calledWith).toContain('filesystem')
  })

  it('does not call the LLM without a router model', async () => {
    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
      getToolsForServers: vi.fn().mockResolvedValue([]),
    })

    await orchestrator.getRelevantTools('read the file from disk', service, [])

    expect(mcpRouterLlm.selectServersWithLlm).not.toHaveBeenCalled()
  })

  it('does not call the LLM when the user message is blank', async () => {
    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
      getToolsForServers: vi.fn().mockResolvedValue([]),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    await orchestrator.getRelevantTools('   ', service, [], {
      routerModel: fakeModel as never,
    })

    expect(mcpRouterLlm.selectServersWithLlm).not.toHaveBeenCalled()
  })
})
