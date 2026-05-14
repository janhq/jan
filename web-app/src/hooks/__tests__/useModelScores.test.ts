import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelScore } from '../useModelScores'
import type { CatalogModel, ModelScore } from '../../services/models/types'

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelScores: 'model-scores-settings',
  },
}))

vi.mock('zustand/middleware', () => ({
  persist: (fn: typeof useModelScore) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

const mockGetHubModelScore =
  vi.fn<(model: CatalogModel) => Promise<Partial<ModelScore>>>()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    models: () => ({
      getHubModelScore: mockGetHubModelScore,
    }),
  }),
}))

describe('useModelScore', () => {
  const model: CatalogModel = {
    model_name: 'qwen/test-model',
    description: 'Test model',
    downloads: 100,
    quants: [
      {
        model_id: 'qwen/test-model-q4_k_m',
        path: 'qwen/test-model-q4_k_m.gguf',
        file_size: '4 GB',
      },
      {
        model_id: 'qwen/test-model-q8_0',
        path: 'qwen/test-model-q8_0.gguf',
        file_size: '8 GB',
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useModelScore.getState().reset()
  })

  it('fetches and stores a preferred score after setting loading state', async () => {
    mockGetHubModelScore.mockResolvedValueOnce({
      status: 'ready',
      overall: 91,
      estimated_tps: 12,
    })

    const { result } = renderHook(() => useModelScore())

    let preferredScore: ModelScore | undefined

    await act(async () => {
      preferredScore = await result.current.fetchModelScore(model)
    })

    expect(mockGetHubModelScore).toHaveBeenCalledTimes(1)
    expect(preferredScore).toMatchObject({
      status: 'ready',
      overall: 91,
      estimated_tps: 12,
    })
    expect(useModelScore.getState().getScore(model.model_name)).toMatchObject({
      status: 'ready',
      overall: 91,
      estimated_tps: 12,
    })
  })

  it('preserves unavailable responses from the scoring service', async () => {
    mockGetHubModelScore.mockResolvedValueOnce({
      status: 'unavailable',
      estimated_tps: 0,
      reason: 'Hub scoring is not available on this platform.',
    })

    const { result } = renderHook(() => useModelScore())

    let score: ModelScore | undefined

    await act(async () => {
      score = await result.current.fetchModelScore(model)
    })

    expect(score).toMatchObject({
      status: 'unavailable',
      estimated_tps: 0,
      reason: 'Hub scoring is not available on this platform.',
    })
    expect(useModelScore.getState().getScore(model.model_name)).toMatchObject({
      status: 'unavailable',
      estimated_tps: 0,
      reason: 'Hub scoring is not available on this platform.',
    })
  })

  it('deduplicates concurrent score fetches for the same model', async () => {
    let resolveScore: ((value: Partial<ModelScore>) => void) | undefined

    mockGetHubModelScore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveScore = resolve
        })
    )

    const { result } = renderHook(() => useModelScore())

    let scores: Array<ModelScore | undefined> = []

    const concurrentRequest = act(async () => {
      scores = await Promise.all([
        result.current.fetchModelScore(model),
        result.current.fetchModelScore(model),
      ])
    })

    expect(mockGetHubModelScore).toHaveBeenCalledTimes(1)

    resolveScore?.({
      status: 'ready',
      overall: 88,
      estimated_tps: 14,
    })

    await concurrentRequest

    expect(scores[0]).toMatchObject({
      status: 'ready',
      overall: 88,
      estimated_tps: 14,
    })
    expect(scores[1]).toMatchObject({
      status: 'ready',
      overall: 88,
      estimated_tps: 14,
    })
  })
})
