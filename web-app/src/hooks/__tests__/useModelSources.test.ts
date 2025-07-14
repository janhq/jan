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

    it('should merge new sources with existing ones', async () => {
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

      expect(result.current.sources).toEqual([...newSources, ...existingSources])
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

      expect(result.current.sources).toEqual([
        ...newSources,
        {
          model_name: 'unique-model',
          provider: 'provider',
          description: 'Unique model',
          version: '1.0.0',
        },
      ])
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
    it('should log the source parameter', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.addSource('test-source')
      })

      expect(consoleSpy).toHaveBeenCalledWith('test-source')
      consoleSpy.mockRestore()
    })

    it('should set loading state during addSource', async () => {
      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.addSource('test-source')
      })

      expect(result.current.loading).toBe(true)
      expect(result.current.error).toBe(null)
    })

    it('should handle different source types', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { result } = renderHook(() => useModelSources())

      const sources = [
        'http://example.com/source1',
        'https://secure.example.com/source2',
        'file:///local/path/source3',
        'custom-source-name',
      ]

      for (const source of sources) {
        await act(async () => {
          await result.current.addSource(source)
        })

        expect(consoleSpy).toHaveBeenCalledWith(source)
      }

      consoleSpy.mockRestore()
    })

    it('should handle empty source string', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { result } = renderHook(() => useModelSources())

      await act(async () => {
        await result.current.addSource('')
      })

      expect(consoleSpy).toHaveBeenCalledWith('')
      consoleSpy.mockRestore()
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

      expect(result.current.sources).toEqual([...sources2, ...sources1])
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