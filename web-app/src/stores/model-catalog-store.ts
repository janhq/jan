/**
 * Zustand store wrapping the model-catalog loader.
 *
 * Mirrors `provider-registry-store.ts` and
 * `recommended-models-registry-store.ts`:
 *  - Bootstraps the catalog + index in the background on first import.
 *  - Holds the in-memory list (and the pre-built MiniSearch payload) so
 *    React components and non-React modules read it synchronously.
 *  - Surfaces loading / source / last-fetch metadata for UI.
 *
 * The store stays platform-neutral. Platform-aware filtering (MLX vs
 * non-macOS hosts) happens in `useModelSources` / `model-search.ts`, not
 * here, so the cache + baseline remain portable.
 */

import { create } from 'zustand'
import {
  getCatalogOrFallback,
  getCachedCatalog,
  getCachedIndex,
  getIndexOrFallback,
  type CatalogFetchResult,
  type CatalogIndexPayload,
  type CatalogManifest,
  type FetchOptions,
  type IndexFetchResult,
  type RegistrySource,
} from '@/services/model-catalog-registry'
import { BASELINE_MODEL_CATALOG } from '@/constants/models'
import type { CatalogModel } from '@/services/models/types'

export type CatalogStatus = 'idle' | 'loading' | 'success' | 'error'

type ModelCatalogState = {
  catalog: CatalogModel[]
  manifestUpdatedAt: string | null
  source: RegistrySource
  status: CatalogStatus
  fetchedAt: number | null
  error: string | null
  /** Pre-built MiniSearch snapshot (or `null` if absent). */
  index: CatalogIndexPayload | null
  indexSource: RegistrySource
  indexFetchedAt: number | null
  /** True until the first refresh resolves (success or fallback). */
  hasInitialized: boolean
  refresh: (options?: FetchOptions) => Promise<void>
}

const seedCatalog = (): CatalogModel[] => {
  const cached = getCachedCatalog()
  if (cached) return cached.manifest.models.slice()
  return BASELINE_MODEL_CATALOG.slice()
}

const seedIndex = (): CatalogIndexPayload | null => {
  const cached = getCachedIndex()
  return cached ? cached.payload : null
}

const baselineFallback = (message: string): CatalogFetchResult => ({
  manifest: {
    manifest_version: 1,
    schema_version: 1,
    updated_at: '1970-01-01T00:00:00Z',
    models: BASELINE_MODEL_CATALOG.slice(),
  } as CatalogManifest,
  source: 'baseline',
  fetchedAt: null,
  manifestUpdatedAt: null,
  error: message,
})

const baselineIndex = (message: string): IndexFetchResult => ({
  payload: null,
  source: 'baseline',
  fetchedAt: null,
  error: message,
})

export const useModelCatalogStore = create<ModelCatalogState>()((set) => ({
  catalog: seedCatalog(),
  manifestUpdatedAt: getCachedCatalog()?.manifest.updated_at ?? null,
  source: getCachedCatalog() ? 'cache' : 'baseline',
  status: 'idle',
  fetchedAt: getCachedCatalog()?.fetchedAt ?? null,
  error: null,
  index: seedIndex(),
  indexSource: getCachedIndex() ? 'cache' : 'baseline',
  indexFetchedAt: getCachedIndex()?.fetchedAt ?? null,
  hasInitialized: false,
  refresh: async (options?: FetchOptions) => {
    set({ status: 'loading', error: null })

    let catalogResult: CatalogFetchResult
    let indexResult: IndexFetchResult
    try {
      const [catalog, index] = await Promise.all([
        getCatalogOrFallback(options),
        getIndexOrFallback(options),
      ])
      catalogResult = catalog
      indexResult = index
    } catch (error) {
      // Defensive: `getCatalogOrFallback` / `getIndexOrFallback` already
      // catch network errors and return fallback results. This branch is
      // here only for synchronous bugs inside the loader itself.
      const message =
        error instanceof Error ? error.message : 'Unknown catalog error'
      console.warn('[model-catalog-store] refresh threw:', message)
      catalogResult = baselineFallback(message)
      indexResult = baselineIndex(message)
    }

    set({
      catalog: catalogResult.manifest.models,
      manifestUpdatedAt: catalogResult.manifestUpdatedAt,
      source: catalogResult.source,
      fetchedAt: catalogResult.fetchedAt,
      status: catalogResult.error ? 'error' : 'success',
      error: catalogResult.error ?? null,
      index: indexResult.payload,
      indexSource: indexResult.source,
      indexFetchedAt: indexResult.fetchedAt,
      hasInitialized: true,
    })
  },
}))

/**
 * Synchronous accessor for non-React code returning the current catalog.
 */
export const getCatalogSync = (): CatalogModel[] =>
  useModelCatalogStore.getState().catalog

/**
 * Synchronous accessor for the pre-built MiniSearch index payload.
 */
export const getCatalogIndexSync = (): CatalogIndexPayload | null =>
  useModelCatalogStore.getState().index

/**
 * Ensure the catalog has resolved at least once. Cheap on subsequent
 * calls — returns immediately when initialization is already complete.
 */
export const ensureCatalogLoaded = async (): Promise<CatalogModel[]> => {
  const state = useModelCatalogStore.getState()
  if (state.hasInitialized) return state.catalog
  await state.refresh()
  return useModelCatalogStore.getState().catalog
}

/**
 * Kick off the initial fetch in the background. Importing this module is
 * enough to start loading; tests can override or skip via mocking.
 */
if (typeof window !== 'undefined') {
  void useModelCatalogStore
    .getState()
    .refresh()
    .catch((error) => {
      console.warn('[model-catalog-store] initial refresh failed:', error)
    })
}
