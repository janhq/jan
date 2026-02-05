import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useModelSources } from '../useModelSources'
import type { CatalogModel } from '@/services/models/types'

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

// Mock the ServiceHub
const mockFetchModelCatalog = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    models: () => ({
      fetchModelCatalog: mockFetchModelCatalog,
    }),
  }),
}))

// Mock the sanitizeModelId function
vi.mock('@/lib/utils', () => ({
  sanitizeModelId: vi.fn((id: string) => id),
}))

describe('useModelSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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
  })

  describe('fetchSources', () => {
    it('should fetch sources successfully', async () => {
      const mockSources: CatalogModel[] = [
        {
          model_name: 'model-1',
          description: 'First model',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [{ model_id: 'model-1-q4', path: '/path/1', file_size: '1GB' }],
        },
        {
          model_name: 'model-2',
          description: 'Second model',
          developer: 'provider-2',
          downloads: 200,
          num_quants: 1,
          quants: [{ model_id: 'model-2-q4', path: '/path/2', file_size: '2GB' }],
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
          description: 'Existing model',
          developer: 'existing-provider',
          downloads: 50,
          num_quants: 1,
          quants: [{ model_id: 'existing-model-q4', path: '/path/existing', file_size: '1GB' }],
        },
      ]

      const newSources: CatalogModel[] = [
        {
          model_name: 'new-model',
          description: 'New model',
          developer: 'new-provider',
          downloads: 150,
          num_quants: 1,
          quants: [{ model_id: 'new-model-q4', path: '/path/new', file_size: '2GB' }],
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
          description: 'Old version',
          developer: 'old-provider',
          downloads: 100,
          num_quants: 1,
          quants: [{ model_id: 'duplicate-model-q4', path: '/path/old', file_size: '1GB' }],
        },
        {
          model_name: 'unique-model',
          description: 'Unique model',
          developer: 'provider',
          downloads: 75,
          num_quants: 1,
          quants: [{ model_id: 'unique-model-q4', path: '/path/unique', file_size: '1GB' }],
        },
      ]

      const newSources: CatalogModel[] = [
        {
          model_name: 'duplicate-model',
          description: 'New version',
          developer: 'new-provider',
          downloads: 200,
          num_quants: 1,
          quants: [{ model_id: 'duplicate-model-q4-new', path: '/path/new', file_size: '2GB' }],
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
          description: 'Model 1',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [{ model_id: 'model-1-q4', path: '/path/1', file_size: '1GB' }],
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
          description: 'Shared model',
          developer: 'shared-provider',
          downloads: 100,
          num_quants: 1,
          quants: [{ model_id: 'shared-model-q4', path: '/path/shared', file_size: '1GB' }],
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
          description: 'First batch',
          developer: 'provider-1',
          downloads: 100,
          num_quants: 1,
          quants: [{ model_id: 'model-1-q4', path: '/path/1', file_size: '1GB' }],
        },
      ]

      const sources2: CatalogModel[] = [
        {
          model_name: 'model-2',
          description: 'Second batch',
          developer: 'provider-2',
          downloads: 200,
          num_quants: 1,
          quants: [{ model_id: 'model-2-q4', path: '/path/2', file_size: '2GB' }],
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
          description: 'Recovery model',
          developer: 'recovery-provider',
          downloads: 100,
          num_quants: 1,
          quants: [{ model_id: 'recovery-model-q4', path: '/path/recovery', file_size: '1GB' }],
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
