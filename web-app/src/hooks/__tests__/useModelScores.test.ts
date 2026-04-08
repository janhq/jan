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
})
