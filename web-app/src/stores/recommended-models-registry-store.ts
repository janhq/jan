/**
 * Zustand store wrapping the remote recommended-models registry loader.
 *
 * Mirrors `provider-registry-store.ts`:
 *  - Holds the manifest in memory for synchronous access from React
 *    components and non-React modules.
 *  - Exposes loading status / last-fetch metadata for UI.
 *  - Bootstraps once when first imported.
 *
 * The store keeps the platform-neutral list. Use the
 * {@link useRecommendedModelsForPlatform} selector (or
 * {@link getRecommendationsSync}) to obtain the list filtered for the
 * current host OS.
 */

import { create } from 'zustand'
import {
  filterRecommendationsForPlatform,
  getCachedManifest,
  getRecommendationsOrFallback,
  type FetchOptions,
  type Recommendation,
  type RecommendationPlatform,
  type RegistryFetchResult,
  type RegistrySource,
} from '@/services/recommended-models-registry'
import { BASELINE_RECOMMENDED_MODELS } from '@/constants/models'

export type RegistryStatus = 'idle' | 'loading' | 'success' | 'error'

type RegistryState = {
  recommendations: Recommendation[]
  status: RegistryStatus
  source: RegistrySource
  fetchedAt: number | null
  manifestUpdatedAt: string | null
  error: string | null
  /** True until the first refresh resolves (success or fallback). */
  hasInitialized: boolean
  refresh: (options?: FetchOptions) => Promise<void>
}

const seedRecommendations = (): Recommendation[] => {
  const cached = getCachedManifest()
  if (cached) return cached.manifest.recommendations.slice()
  return BASELINE_RECOMMENDED_MODELS.slice()
}

const baselineFallback = (message: string): RegistryFetchResult => ({
  recommendations: BASELINE_RECOMMENDED_MODELS.slice(),
  source: 'baseline',
  fetchedAt: null,
  manifestUpdatedAt: null,
  error: message,
})

export const useRecommendedModelsRegistryStore = create<RegistryState>()(
  (set) => ({
    recommendations: seedRecommendations(),
    status: 'idle',
    source: getCachedManifest() ? 'cache' : 'baseline',
    fetchedAt: getCachedManifest()?.fetchedAt ?? null,
    manifestUpdatedAt: getCachedManifest()?.manifest.updated_at ?? null,
    error: null,
    hasInitialized: false,
    refresh: async (options?: FetchOptions) => {
      set({ status: 'loading', error: null })

      let result: RegistryFetchResult
      try {
        result = await getRecommendationsOrFallback(options)
      } catch (error) {
        // `getRecommendationsOrFallback` already catches network errors and
        // returns a fallback result — this branch is purely defensive
        // against unexpected synchronous bugs in the loader.
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown recommended-models registry error'
        console.warn(
          '[recommended-models-registry-store] refresh threw:',
          message
        )
        result = baselineFallback(message)
      }

      set({
        recommendations: result.recommendations,
        source: result.source,
        fetchedAt: result.fetchedAt,
        manifestUpdatedAt: result.manifestUpdatedAt,
        status: result.error ? 'error' : 'success',
        error: result.error ?? null,
        hasInitialized: true,
      })
    },
  })
)

const detectCurrentOs = (): RecommendationPlatform => {
  if (typeof IS_MACOS !== 'undefined' && IS_MACOS) return 'macos'
  if (typeof IS_WINDOWS !== 'undefined' && IS_WINDOWS) return 'windows'
  return 'linux'
}

/**
 * Synchronous accessor for non-React code, returning the full (unfiltered)
 * list currently in the store.
 */
export const getRecommendationsSync = (): Recommendation[] =>
  useRecommendedModelsRegistryStore.getState().recommendations

/**
 * Synchronous accessor returning recommendations filtered for the current
 * host OS.
 */
export const getRecommendationsForCurrentPlatformSync = (): Recommendation[] =>
  filterRecommendationsForPlatform(
    useRecommendedModelsRegistryStore.getState().recommendations,
    detectCurrentOs()
  )

/**
 * Ensure the registry has resolved at least once. Cheap on subsequent calls —
 * returns immediately when initialization is already complete.
 */
export const ensureRecommendedModelsLoaded = async (): Promise<
  Recommendation[]
> => {
  const state = useRecommendedModelsRegistryStore.getState()
  if (state.hasInitialized) return state.recommendations
  await state.refresh()
  return useRecommendedModelsRegistryStore.getState().recommendations
}

/**
 * Kick off the initial fetch in the background. Importing this module is
 * enough to start loading; tests can override or skip via mocking.
 */
if (typeof window !== 'undefined') {
  void useRecommendedModelsRegistryStore
    .getState()
    .refresh()
    .catch((error) => {
      console.warn(
        '[recommended-models-registry-store] initial refresh failed:',
        error
      )
    })
}
