import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('../mcp-orchestrator/intent-classifier', () => ({
  MAX_ROUTED_SERVERS: 3,
}))

import { generateObject } from 'ai'
import {
  selectServersWithLlm,
  MCP_ROUTER_TIMEOUT_MS,
  type LlmRouterResult,
} from '../mcp-orchestrator/mcp-router-llm'
import type { ServerSummary } from '@/services/mcp/types'

const mockModel = { modelId: 'test' } as any

const summaries: ServerSummary[] = [
  { name: 'weather', description: 'Weather data', capabilities: ['get_weather'] },
  { name: 'calendar', description: 'Calendar', capabilities: ['list_events', 'create_event'] },
  { name: 'email', description: '', capabilities: [] },
]

describe('selectServersWithLlm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns matched server names on success', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { selectedServers: ['weather', 'calendar'] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as any)

    const result = await selectServersWithLlm('What is the weather?', summaries, mockModel)
    expect(result.errorKind).toBe('none')
    expect(result.names).toEqual(['weather', 'calendar'])
    expect(result.emptyValidatedSelection).toBe(false)
    expect(result.usage).toBeDefined()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('filters out server names not in allow list', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { selectedServers: ['weather', 'nonexistent'] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as any)

    const result = await selectServersWithLlm('test', summaries, mockModel)
    expect(result.names).toEqual(['weather'])
    expect(result.emptyValidatedSelection).toBe(false)
  })

  it('sets emptyValidatedSelection when model returns names not in allow list', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { selectedServers: ['unknown1', 'unknown2'] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as any)

    const result = await selectServersWithLlm('test', summaries, mockModel)
    expect(result.names).toEqual([])
    expect(result.emptyValidatedSelection).toBe(true)
  })

  it('deduplicates server names', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { selectedServers: ['weather', 'weather', 'weather'] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as any)

    const result = await selectServersWithLlm('test', summaries, mockModel)
    expect(result.names).toEqual(['weather'])
  })

  it('returns empty names with no error when model returns empty array', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { selectedServers: [] },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as any)

    const result = await selectServersWithLlm('test', summaries, mockModel)
    expect(result.names).toEqual([])
    expect(result.errorKind).toBe('none')
    expect(result.emptyValidatedSelection).toBe(false)
  })

  it('returns abort errorKind when parent signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    vi.mocked(generateObject).mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    )

    const result = await selectServersWithLlm('test', summaries, mockModel, controller.signal)
    expect(result.errorKind).toBe('abort')
    expect(result.names).toEqual([])
  })

  it('returns abort errorKind when parent aborts during call', async () => {
    const controller = new AbortController()

    vi.mocked(generateObject).mockImplementation(async () => {
      controller.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })

    const result = await selectServersWithLlm('test', summaries, mockModel, controller.signal)
    expect(result.errorKind).toBe('abort')
  })

  it('returns timeout errorKind when timeout fires', async () => {
    vi.useFakeTimers()

    vi.mocked(generateObject).mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, MCP_ROUTER_TIMEOUT_MS + 100)
        })
    )

    const promise = selectServersWithLlm('test', summaries, mockModel)
    vi.advanceTimersByTime(MCP_ROUTER_TIMEOUT_MS + 200)
    const result = await promise
    expect(result.errorKind).toBe('timeout')
    expect(result.names).toEqual([])
  })

  it('returns error errorKind for non-abort errors', async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error('network failure'))

    const result = await selectServersWithLlm('test', summaries, mockModel)
    expect(result.errorKind).toBe('error')
    expect(result.names).toEqual([])
  })

  it('handles summaries with empty description and capabilities', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { selectedServers: ['email'] },
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    } as any)

    const result = await selectServersWithLlm('send email', summaries, mockModel)
    expect(result.names).toEqual(['email'])
  })

  it('returns abort for AbortError via constructor name', async () => {
    class AbortError extends Error {
      constructor() {
        super('abort')
        this.name = 'AbortError'
      }
    }
    vi.mocked(generateObject).mockRejectedValue(new AbortError())

    const result = await selectServersWithLlm('test', summaries, mockModel)
    // No parent signal, no timeout -> falls through to generic abort
    expect(result.errorKind).toBe('abort')
  })
})
