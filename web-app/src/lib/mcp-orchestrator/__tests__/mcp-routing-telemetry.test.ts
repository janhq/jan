import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MCPOrchestrator,
  type MCPServiceLike,
  type McpRoutingTelemetry,
} from '../mcp-orchestrator'
import type { ServerSummary } from '@/services/mcp/types'
import * as mcpRouterLlm from '../mcp-router-llm'

vi.mock('../mcp-router-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mcp-router-llm')>()
  return {
    ...actual,
    selectServersWithLlm: vi.fn(),
  }
})

const sixSummaries: ServerSummary[] = [
  { name: 'a', capabilities: [], description: '' },
  { name: 'b', capabilities: [], description: '' },
  { name: 'c', capabilities: [], description: '' },
  { name: 'd', capabilities: [], description: '' },
  { name: 'e', capabilities: [], description: '' },
  { name: 'f', capabilities: [], description: '' },
]

function makeService(overrides: Partial<MCPServiceLike> = {}): MCPServiceLike {
  return {
    getTools: vi.fn().mockResolvedValue([]),
    getToolsForServers: vi.fn().mockResolvedValue([]),
    getServerSummaries: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('MCP routing telemetry', () => {
  let orchestrator: MCPOrchestrator
  let lastTelemetry: McpRoutingTelemetry | undefined

  beforeEach(() => {
    orchestrator = new MCPOrchestrator()
    lastTelemetry = undefined
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockReset()
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockImplementation(
      async () => ({
        names: [],
        durationMs: 0,
        errorKind: 'none',
        emptyValidatedSelection: false,
      })
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('emits bypassed routing when server count is at threshold', async () => {
    const summaries = sixSummaries.slice(0, 5)
    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(summaries),
      getTools: vi.fn().mockResolvedValue([{ name: 't', description: '', inputSchema: {}, server: 'a' }]),
    })

    await orchestrator.getRelevantTools('hello', service, [], {
      onRoutingTelemetry: (t) => {
        lastTelemetry = t
      },
    })

    expect(lastTelemetry).toMatchObject({
      routingRan: false,
      connectedServerCount: 5,
      bypassedRouting: true,
      pickSource: null,
      selectedServerCount: 5,
      totalLatencyMs: expect.any(Number),
      llmRouterLatencyMs: null,
      llmInvoked: false,
      llmAccepted: false,
      fallbackReason: 'none',
      selectiveToolsWereEmpty: false,
      selectiveFetchHadError: false,
      fellBackToFullToolList: false,
    })
  })

  it('emits keyword pick when LLM returns empty', async () => {
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockImplementation(async () => ({
      names: [],
      durationMs: 5,
      errorKind: 'none',
      emptyValidatedSelection: false,
    }))

    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(sixSummaries),
      getToolsForServers: vi.fn().mockResolvedValue([]),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    await orchestrator.getRelevantTools('read files from disk', service, [], {
      routerModel: fakeModel as never,
      onRoutingTelemetry: (t) => {
        lastTelemetry = t
      },
    })

    expect(lastTelemetry).toMatchObject({
      routingRan: true,
      connectedServerCount: 6,
      bypassedRouting: false,
      pickSource: 'keyword',
      llmInvoked: true,
      llmAccepted: false,
      fallbackReason: 'selective_tools_empty',
      llmRouterLatencyMs: 5,
      selectiveToolsWereEmpty: true,
      fellBackToFullToolList: true,
    })
  })

  it('emits llm pick when LLM returns servers', async () => {
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockImplementation(async () => ({
      names: ['a', 'b'],
      durationMs: 3,
      errorKind: 'none',
      emptyValidatedSelection: false,
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    }))

    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(sixSummaries),
      getToolsForServers: vi.fn().mockResolvedValue([
        { name: 'ta', description: '', inputSchema: {}, server: 'a' },
        { name: 'tb', description: '', inputSchema: {}, server: 'b' },
      ]),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    await orchestrator.getRelevantTools('hello', service, [], {
      routerModel: fakeModel as never,
      onRoutingTelemetry: (t) => {
        lastTelemetry = t
      },
    })

    expect(lastTelemetry).toMatchObject({
      routingRan: true,
      pickSource: 'llm',
      llmInvoked: true,
      llmAccepted: true,
      selectedServerCount: 2,
      fallbackReason: 'none',
      llmRouterLatencyMs: 3,
      selectiveToolsWereEmpty: false,
      fellBackToFullToolList: false,
      llmRouterUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    })
  })

  it('sets fellBackToFullToolList when selective fetch is empty but getTools returns tools', async () => {
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockImplementation(async () => ({
      names: [],
      durationMs: 1,
      errorKind: 'none',
      emptyValidatedSelection: false,
    }))

    const fullList = [{ name: 'tool', description: '', inputSchema: {}, server: 'a' }]
    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(sixSummaries),
      getToolsForServers: vi.fn().mockResolvedValue([]),
      getTools: vi.fn().mockResolvedValue(fullList),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    const tools = await orchestrator.getRelevantTools('anything', service, [], {
      routerModel: fakeModel as never,
      onRoutingTelemetry: (t) => {
        lastTelemetry = t
      },
    })

    expect(lastTelemetry?.fellBackToFullToolList).toBe(true)
    expect(lastTelemetry?.fallbackReason).toBe('selective_tools_empty')
    expect(tools).toEqual(fullList)
    expect(service.getTools).toHaveBeenCalled()
  })

  it('records llm_timeout when the router returns timeout error kind', async () => {
    vi.mocked(mcpRouterLlm.selectServersWithLlm).mockImplementation(async () => ({
      names: [],
      durationMs: 3500,
      errorKind: 'timeout',
      emptyValidatedSelection: false,
    }))

    const service = makeService({
      getServerSummaries: vi.fn().mockResolvedValue(sixSummaries),
      getToolsForServers: vi.fn().mockResolvedValue([
        { name: 't', description: '', inputSchema: {}, server: 'a' },
      ]),
    })

    const fakeModel = { specificationVersion: 'v2', provider: 'x', modelId: 'y' } as const

    await orchestrator.getRelevantTools('hello', service, [], {
      routerModel: fakeModel as never,
      onRoutingTelemetry: (t) => {
        lastTelemetry = t
      },
    })

    expect(lastTelemetry?.fallbackReason).toBe('llm_timeout')
    expect(lastTelemetry?.pickSource).toBe('keyword')
  })
})
