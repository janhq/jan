import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetadataExtractor } from '@ai-sdk/openai-compatible'
import { ModelFactory } from '../model-factory'
import { useAppState } from '@/hooks/useAppState'

const { extractors } = vi.hoisted(() => ({ extractors: [] as MetadataExtractor[] }))
vi.mock('@ai-sdk/openai-compatible', () => ({
  OpenAICompatibleChatLanguageModel: vi.fn().mockImplementation((_id, config) => {
    extractors.push(config.metadataExtractor)
    return { modelId: _id }
  }),
  createOpenAICompatible: vi.fn(),
}))
vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn(({ model }) => model),
  extractReasoningMiddleware: vi.fn(() => ({})),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({ port: 1234, api_key: 'test' }),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  findSessionByModel: vi.fn().mockResolvedValue({ port: 1234, api_key: 'test' }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: undefined }) },
}))

const chunk = (n: number) => ({
  timings: { prompt_n: n, cache_n: 2, predicted_n: n, predicted_per_second: n },
  prompt_progress: { total: 100, processed: n },
})
const provider = (name: string): ProviderObject => ({
  provider: name, models: [], settings: [], active: true,
})
const createForThread = (name: string, threadId?: string) =>
  ModelFactory.createModel('test-model', provider(name), {}, threadId)

describe('local model stream statistics ownership', () => {
  beforeEach(() => {
    extractors.length = 0
    useAppState.setState({
      currentStreamThreadId: undefined, loadingModel: true,
      liveTokenStats: undefined, promptProgress: undefined,
      loadingModels: { A: true, B: true }, liveTokenStatsByThread: {}, promptProgresses: {},
    })
  })

  it.each(['llamacpp', 'mlx'])('keeps interleaved %s metadata attached to its originating thread', async (name) => {
    await createForThread(name, 'A')
    await createForThread(name, 'B')
    const a = extractors[0].createStreamExtractor()
    const b = extractors[1].createStreamExtractor()
    useAppState.getState().setCurrentStreamThreadId('B')
    a.processChunk(chunk(11))
    let state = useAppState.getState()
    expect(state.liveTokenStatsByThread.A?.completionTokens).toBe(11)
    expect(state.promptProgresses.A?.processed).toBe(11)
    expect(state.loadingModels.B).toBe(true)
    expect(state.loadingModel).toBe(true)
    expect(state.liveTokenStats).toBeUndefined()
    b.processChunk(chunk(22))
    useAppState.getState().setCurrentStreamThreadId('A')
    a.processChunk(chunk(33))
    b.processChunk(chunk(44))
    state = useAppState.getState()
    expect(state.liveTokenStatsByThread.A?.completionTokens).toBe(33)
    expect(state.liveTokenStatsByThread.B?.completionTokens).toBe(44)
    expect(state.promptProgresses.A?.processed).toBe(33)
    expect(state.promptProgresses.B?.processed).toBe(44)
    expect(state.liveTokenStats?.completionTokens).toBe(33)
    expect(a.buildMetadata()).toEqual({ providerMetadata: {
      promptTokens: 35, completionTokens: 33, tokensPerSecond: 33, promptPerSecond: null,
    } })
  })

  it('does not attribute an unscoped title model to the active conversation', async () => {
    await createForThread('llamacpp')
    useAppState.getState().setCurrentStreamThreadId('B')
    const stream = extractors[0].createStreamExtractor()
    stream.processChunk(chunk(7))
    expect(useAppState.getState().liveTokenStatsByThread.B).toBeUndefined()
    expect(useAppState.getState().loadingModels.B).toBe(true)
    expect(stream.buildMetadata()).toBeDefined()
  })

  it('does not update global loading or progress for an unscoped stream', async () => {
    await createForThread('llamacpp')
    const stream = extractors[0].createStreamExtractor()
    stream.processChunk(chunk(7))
    const state = useAppState.getState()
    expect(state.loadingModel).toBe(true)
    expect(state.liveTokenStats).toBeUndefined()
    expect(state.promptProgress).toBeUndefined()
    expect(stream.buildMetadata()).toBeDefined()
  })
})
