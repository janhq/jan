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
  getBundledSeedCatalog,
  getBundledSeedIndex,
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
    const initialState = useModelCatalogStore.getState()
    set({ status: 'loading', error: null })

    // Phase 1: if neither localStorage cache nor a previous successful
    // refresh has populated the store yet, try the bundled seed snapshot.
    // It is shipped with the app by `scripts/fetch-seed-catalog.mjs` and
    // gives the user the full ~2700-model catalog instantly, even on a
    // brand-new offline machine. We only fire this once per session
    // (gated on `hasInitialized`) to avoid re-reading the same asset on
    // every manual refresh.
    if (
      !initialState.hasInitialized &&
      initialState.source === 'baseline'
    ) {
      try {
        const [seedManifest, seedIndex] = await Promise.all([
          getBundledSeedCatalog(),
          getBundledSeedIndex(),
        ])
        if (seedManifest && seedManifest.models.length > 0) {
          set({
            catalog: seedManifest.models,
            manifestUpdatedAt: seedManifest.updated_at,
            source: 'bundled',
            fetchedAt: null,
            error: null,
            index: seedIndex ?? null,
            indexSource: seedIndex ? 'bundled' : 'baseline',
            indexFetchedAt: null,
          })
        }
      } catch (error) {
        console.warn(
          '[model-catalog-store] bundled seed unavailable:',
          error instanceof Error ? error.message : error
        )
      }
    }

    // Phase 2: network refresh — promotes `source` from 'bundled'/'cache'
    // to 'remote' on success, or keeps the seed/cache when the remote
    // call fails. Either way the user already sees a populated UI by now.
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
      const message =
        error instanceof Error ? error.message : 'Unknown catalog error'
      console.warn('[model-catalog-store] refresh threw:', message)
      catalogResult = baselineFallback(message)
      indexResult = baselineIndex(message)
    }

    // If the network came back with `baseline` (everything failed) and
    // we previously populated from `bundled`, keep the bundled snapshot
    // — it's strictly better than five emergency entries.
    const current = useModelCatalogStore.getState()
    const shouldKeepBundled =
      catalogResult.source === 'baseline' && current.source === 'bundled'

    set({
      catalog: shouldKeepBundled ? current.catalog : catalogResult.manifest.models,
      manifestUpdatedAt: shouldKeepBundled
        ? current.manifestUpdatedAt
        : catalogResult.manifestUpdatedAt,
      source: shouldKeepBundled ? 'bundled' : catalogResult.source,
      fetchedAt: shouldKeepBundled ? current.fetchedAt : catalogResult.fetchedAt,
      status: catalogResult.error && !shouldKeepBundled ? 'error' : 'success',
      error: shouldKeepBundled ? null : catalogResult.error ?? null,
      index: shouldKeepBundled ? current.index : indexResult.payload,
      indexSource: shouldKeepBundled ? current.indexSource : indexResult.source,
      indexFetchedAt: shouldKeepBundled
        ? current.indexFetchedAt
        : indexResult.fetchedAt,
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
