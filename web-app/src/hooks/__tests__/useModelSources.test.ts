import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useModelSources } from '../useModelSources'
import type { CatalogModel } from '@/services/models'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelSources: 'model-sources-settings',
  },
}))

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

// Mock the fetchModelCatalog service
vi.mock('@/services/models', () => ({
  fetchModelCatalog: vi.fn(),
}))

describe('useModelSources', () => {
  let mockFetchModelCatalog: any

  beforeEach(async () => {
    vi.clearAllMocks()
    // Get the mocked function
    const { fetchModelCatalog } = await import('@/services/models')
    mockFetchModelCatalog = fetchModelCatalog as any

    // Reset store state to defaults
    useModelSources.setState({
      sources: [],
      error: null,
      loading: false,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useModelSources())

    expect(result.current.sources).toEqual([])
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(typeof result.current.fetchSources).toBe('function')
    expect(typeof result.current.addSource).toBe('function')
  })

  describe('fetchSources', () => {
    it('should fetch sources successfully', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'model-1',
          provider: 'provider-1',
          description: 'First model',
          version: '1.0.0',
        },
        {
          model_name: 'model-2',
          provider: 'provider-2',
          description: 'Second model',
          version: '2.0.0',
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(mockFetchModelCatalog).toHaveBeenCalledOnce()
      expect(result.current.sources).toEqual(mockSources)
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should handle fetch errors', async () => {
      const mockError = new Error('Network error')
      mockFetchModelCatalog.mockRejectedValueOnce(mockError)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(mockError)
      expect(result.current.sources).toEqual([])
    })

    it('should not merge new sources with existing ones', async () => {
      const existingSources: CatalogModel[] = [
        {
          model_name: 'existing-model',
          provider: 'existing-provider',
          description: 'Existing model',
          version: '1.0.0',
        },
      ]

      const newSources: CatalogModel[] = [
        {
          model_name: 'new-model',
          provider: 'new-provider',
          description: 'New model',
          version: '2.0.0',
        },
      ]

      // Set initial state with existing sources
      useModelSources.setState({
        sources: existingSources,
        error: null,
        loading: false,
      })

      mockFetchModelCatalog.mockResolvedValueOnce(newSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(newSources)
    })

    it('should not duplicate models with same model_name', async () => {
      const existingSources: CatalogModel[] = [
        {
          model_name: 'duplicate-model',
          provider: 'old-provider',
          description: 'Old version',
          version: '1.0.0',
        },
        {
          model_name: 'unique-model',
          provider: 'provider',
          description: 'Unique model',
          version: '1.0.0',
        },
      ]

      const newSources: CatalogModel[] = [
        {
          model_name: 'duplicate-model',
          provider: 'new-provider',
          description: 'New version',
          version: '2.0.0',
        },
      ]

      // Set initial state with existing sources
      useModelSources.setState({
        sources: existingSources,
        error: null,
        loading: false,
      })

      mockFetchModelCatalog.mockResolvedValueOnce(newSources)

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(newSources)
    })

    it('should handle empty sources response', async () => {
      mockFetchModelCatalog.mockResolvedValueOnce([])

      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual([])
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should clear previous error on successful fetch', async () => {
      const { result } = renderHook(() => useModelSources())

      // First request fails
      mockFetchModelCatalog.mockRejectedValueOnce(new Error('First error'))

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBeInstanceOf(Error)

      // Second request succeeds
      const mockSources: CatalogModel[] = [
        {
          model_name: 'model-1',
          provider: 'provider-1',
          description: 'Model 1',
          version: '1.0.0',
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBe(null)
      expect(result.current.sources).toEqual(mockSources)
    })
  })

  describe('addSource', () => {
    it('should add a new source to the store', () => {
      const { result } = renderHook(() => useModelSources())

      const testModel: CatalogModel = {
        model_name: 'test-model',
        description: 'Test model description',
        developer: 'test-developer',
        downloads: 100,
        num_quants: 2,
        quants: [
          {
            model_id: 'test-model-q4',
            path: 'https://example.com/test-model-q4.gguf',
            file_size: '2.0 GB',
          },
        ],
        created_at: '2023-01-01T00:00:00Z',
      }

      act(() => {
        result.current.addSource(testModel)
      })

      expect(result.current.sources).toHaveLength(1)
      expect(result.current.sources[0]).toEqual(testModel)
    })

    it('should replace existing source with same model_name', () => {
      const { result } = renderHook(() => useModelSources())

      const originalModel: CatalogModel = {
        model_name: 'duplicate-model',
        description: 'Original description',
        developer: 'original-developer',
        downloads: 50,
        num_quants: 1,
        quants: [],
        created_at: '2023-01-01T00:00:00Z',
      }

      const updatedModel: CatalogModel = {
        model_name: 'duplicate-model',
        description: 'Updated description',
        developer: 'updated-developer',
        downloads: 150,
        num_quants: 2,
        quants: [
          {
            model_id: 'duplicate-model-q4',
            path: 'https://example.com/duplicate-model-q4.gguf',
            file_size: '3.0 GB',
          },
        ],
        created_at: '2023-02-01T00:00:00Z',
      }

      act(() => {
        result.current.addSource(originalModel)
      })

      expect(result.current.sources).toHaveLength(1)

      act(() => {
        result.current.addSource(updatedModel)
      })

      expect(result.current.sources).toHaveLength(1)
      expect(result.current.sources[0]).toEqual(updatedModel)
    })

    it('should handle multiple different sources', () => {
      const { result } = renderHook(() => useModelSources())

      const model1: CatalogModel = {
        model_name: 'model-1',
        description: 'First model',
        developer: 'developer-1',
        downloads: 100,
        num_quants: 1,
        quants: [],
        created_at: '2023-01-01T00:00:00Z',
      }

      const model2: CatalogModel = {
        model_name: 'model-2',
        description: 'Second model',
        developer: 'developer-2',
        downloads: 200,
        num_quants: 1,
        quants: [],
        created_at: '2023-01-02T00:00:00Z',
      }

      act(() => {
        result.current.addSource(model1)
      })

      act(() => {
        result.current.addSource(model2)
      })

      expect(result.current.sources).toHaveLength(2)
      expect(result.current.sources).toContainEqual(model1)
      expect(result.current.sources).toContainEqual(model2)
    })

    it('should handle CatalogModel with complete quants data', () => {
      const { result } = renderHook(() => useModelSources())

      const modelWithQuants: CatalogModel = {
        model_name: 'model-with-quants',
        description: 'Model with quantizations',
        developer: 'quant-developer',
        downloads: 500,
        num_quants: 3,
        quants: [
          {
            model_id: 'model-q4_k_m',
            path: 'https://example.com/model-q4_k_m.gguf',
            file_size: '2.0 GB',
          },
          {
            model_id: 'model-q8_0',
            path: 'https://example.com/model-q8_0.gguf',
            file_size: '4.0 GB',
          },
          {
            model_id: 'model-f16',
            path: 'https://example.com/model-f16.gguf',
            file_size: '8.0 GB',
          },
        ],
        created_at: '2023-01-01T00:00:00Z',
        readme: 'https://example.com/readme.md',
      }

      act(() => {
        result.current.addSource(modelWithQuants)
      })

      expect(result.current.sources).toHaveLength(1)
      expect(result.current.sources[0]).toEqual(modelWithQuants)
      expect(result.current.sources[0].quants).toHaveLength(3)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useModelSources())
      const { result: result2 } = renderHook(() => useModelSources())

      expect(result1.current.sources).toBe(result2.current.sources)
      expect(result1.current.loading).toBe(result2.current.loading)
      expect(result1.current.error).toBe(result2.current.error)
    })

    it('should update state across multiple hook instances', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'shared-model',
          provider: 'shared-provider',
          description: 'Shared model',
          version: '1.0.0',
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      const { result: result1 } = renderHook(() => useModelSources())
      const { result: result2 } = renderHook(() => useModelSources())

      await act(async () => {
        await result1.current.fetchSources()
      })

      expect(result2.current.sources).toEqual(mockSources)
    })
  })

  describe('error handling', () => {
    it('should handle different error types', async () => {
      const errors = [
        new Error('Network error'),
        new TypeError('Type error'),
        new ReferenceError('Reference error'),
      ]

      const { result } = renderHook(() => useModelSources())

      for (const error of errors) {
        mockFetchModelCatalog.mockRejectedValueOnce(error)

        await act(async () => {
          await result.current.fetchSources()
        })

        expect(result.current.error).toBe(error)
        expect(result.current.loading).toBe(false)
        expect(result.current.sources).toEqual([])
      }
    })
  })

  describe('complex scenarios', () => {
    it('should handle multiple fetch operations', async () => {
      const { result } = renderHook(() => useModelSources())

      const sources1: CatalogModel[] = [
        {
          model_name: 'model-1',
          provider: 'provider-1',
          description: 'First batch',
          version: '1.0.0',
        },
      ]

      const sources2: CatalogModel[] = [
        {
          model_name: 'model-2',
          provider: 'provider-2',
          description: 'Second batch',
          version: '2.0.0',
        },
      ]

      // First fetch
      mockFetchModelCatalog.mockResolvedValueOnce(sources1)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(sources1)

      // Second fetch
      mockFetchModelCatalog.mockResolvedValueOnce(sources2)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.sources).toEqual(sources2)
    })

    it('should handle fetch after error', async () => {
      const { result } = renderHook(() => useModelSources())

      // First request fails
      mockFetchModelCatalog.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBeInstanceOf(Error)

      // Second request succeeds
      const mockSources: CatalogModel[] = [
        {
          model_name: 'recovery-model',
          provider: 'recovery-provider',
          description: 'Recovery model',
          version: '1.0.0',
        },
      ]

      mockFetchModelCatalog.mockResolvedValueOnce(mockSources)

      await act(async () => {
        await result.current.fetchSources()
      })

      expect(result.current.error).toBe(null)
      expect(result.current.sources).toEqual(mockSources)
    })
  })
})
