import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// IS_MACOS is a build-time constant; ensure it is true before the shim
// (which references it inside `adaptCatalog`) loads.
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).IS_MACOS = true
})

import type { CatalogModel } from '@/services/models/types'

// Mock the sanitizeModelId function — keep ids verbatim for assertion clarity.
vi.mock('@/lib/utils', () => ({
  sanitizeModelId: (id: string) => id,
}))

// Mock the underlying catalog store so the shim exercises the subscription
// path without involving the registry/network.
const mockEnsureCatalogLoaded = vi.fn()
const subscribers = new Set<
  (next: CatalogStoreState, prev: CatalogStoreState) => void
>()

type CatalogStoreState = {
  catalog: CatalogModel[]
  status: 'idle' | 'loading' | 'success' | 'error'
  error: string | null
}

let storeState: CatalogStoreState = {
  catalog: [],
  status: 'idle',
  error: null,
}

const setStoreState = (next: Partial<CatalogStoreState>) => {
  const prev = storeState
  storeState = { ...storeState, ...next }
  for (const sub of subscribers) sub(storeState, prev)
}

vi.mock('@/stores/model-catalog-store', () => ({
  useModelCatalogStore: {
    getState: () => storeState,
    subscribe: (
      listener: (n: CatalogStoreState, p: CatalogStoreState) => void
    ) => {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
  },
  ensureCatalogLoaded: mockEnsureCatalogLoaded,
}))

// Dynamically import the shim after mocks are wired so the module-level
// subscribe runs against the mock.
let useModelSources: typeof import('../useModelSources').useModelSources

beforeEach(async () => {
  subscribers.clear()
  storeState = { catalog: [], status: 'idle', error: null }
  mockEnsureCatalogLoaded.mockReset()
  vi.resetModules()
  ;({ useModelSources } = await import('../useModelSources'))
})

describe('useModelSources (compatibility shim)', () => {
  it('exposes default values when the catalog store is empty', () => {
    const { result } = renderHook(() => useModelSources())

    expect(result.current.sources).toEqual([])
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(typeof result.current.fetchSources).toBe('function')
  })

  it('mirrors the catalog from the underlying store, sanitised + platform-filtered', async () => {
    const catalog: CatalogModel[] = [
      {
        model_name: 'unsloth/model-1',
        description: 'gguf entry',
        developer: 'unsloth',
        downloads: 100,
        num_quants: 1,
        quants: [
          { model_id: 'unsloth/model-1-q4', path: '/p1', file_size: '1GB' },
        ],
        is_mlx: false,
      },
      {
        model_name: 'mlx-community/model-2',
        description: 'mlx entry',
        developer: 'mlx-community',
        library_name: 'mlx',
        downloads: 200,
        is_mlx: true,
      },
    ]

    mockEnsureCatalogLoaded.mockImplementation(async () => {
      setStoreState({ catalog, status: 'success', error: null })
    })

    const { result } = renderHook(() => useModelSources())

    await act(async () => {
      await result.current.fetchSources()
    })

    expect(mockEnsureCatalogLoaded).toHaveBeenCalledOnce()
    expect(result.current.sources).toHaveLength(2)
    expect(result.current.sources[0]).toMatchObject({
      model_name: 'unsloth/model-1',
      is_mlx: false,
    })
    expect(result.current.sources[1]).toMatchObject({
      model_name: 'mlx-community/model-2',
      is_mlx: true,
    })
  })

  it('surfaces errors from the underlying store as Error instances', async () => {
    mockEnsureCatalogLoaded.mockImplementation(async () => {
      setStoreState({ catalog: [], status: 'error', error: 'network down' })
    })

    const { result } = renderHook(() => useModelSources())

    await act(async () => {
      await result.current.fetchSources()
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('network down')
    expect(result.current.sources).toEqual([])
  })

  it('reacts to background store updates without an explicit fetchSources call', () => {
    const { result } = renderHook(() => useModelSources())

    act(() => {
      setStoreState({
        catalog: [
          {
            model_name: 'unsloth/late-arrival',
            description: '',
            developer: 'unsloth',
            downloads: 0,
          },
        ],
        status: 'success',
        error: null,
      })
    })

    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0].model_name).toBe('unsloth/late-arrival')
  })
})
