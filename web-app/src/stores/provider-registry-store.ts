/**
 * Zustand store wrapping the remote provider registry loader.
 *
 * Responsibilities:
 *  - Hold the merged list of providers (remote + baseline) for synchronous
 *    access from both React components and non-React modules.
 *  - Expose loading status / last-fetch metadata for UI.
 *  - Bootstrap once when first imported.
 *
 * Design notes:
 *  The refresh action is intentionally simple — every call awaits
 *  `getProvidersOrFallback` (which already handles network timeouts and
 *  fallback) and then writes a deterministic terminal state into the store.
 *  This avoids the "stuck spinner" class of bugs that arise when refresh
 *  promises depend on shared singletons or nested timeout races.
 *
 * See `web-app/src/services/AGENTS.md` for feature-level guidance.
 */

import { create } from 'zustand'
import {
  getCachedManifest,
  getProvidersOrFallback,
  type FetchOptions,
  type RegistryFetchResult,
} from '@/services/provider-registry'
import { BASELINE_PROVIDERS } from '@/constants/providers'

export type RegistryStatus = 'idle' | 'loading' | 'success' | 'error'
export type RegistrySource = 'remote' | 'cache' | 'baseline'

type RegistryState = {
  providers: ModelProvider[]
  status: RegistryStatus
  source: RegistrySource
  fetchedAt: number | null
  manifestUpdatedAt: string | null
  error: string | null
  /** True until the first refresh resolves (success or fallback). */
  hasInitialized: boolean
  refresh: (options?: FetchOptions) => Promise<void>
}

const seedProviders = (): ModelProvider[] => {
  const cached = getCachedManifest()
  if (cached) {
    const remoteIds = new Set(cached.manifest.providers.map((p) => p.provider))
    return [
      ...cached.manifest.providers,
      ...BASELINE_PROVIDERS.filter((p) => !remoteIds.has(p.provider)),
    ]
  }
  return BASELINE_PROVIDERS.slice()
}

const baselineFallback = (message: string): RegistryFetchResult => ({
  providers: BASELINE_PROVIDERS.slice(),
  source: 'baseline',
  fetchedAt: null,
  manifestUpdatedAt: null,
  error: message,
})

export const useProviderRegistryStore = create<RegistryState>()((set) => ({
  providers: seedProviders(),
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
      result = await getProvidersOrFallback(options)
    } catch (error) {
      // `getProvidersOrFallback` already catches network errors and returns a
      // fallback result — so this branch is purely defensive against
      // unexpected synchronous bugs in the loader.
      const message =
        error instanceof Error ? error.message : 'Unknown registry error'
      console.warn('[provider-registry-store] refresh threw:', message)
      result = baselineFallback(message)
    }

    set({
      providers: result.providers,
      source: result.source,
      fetchedAt: result.fetchedAt,
      manifestUpdatedAt: result.manifestUpdatedAt,
      status: result.error ? 'error' : 'success',
      error: result.error ?? null,
      hasInitialized: true,
    })
  },
}))

/**
 * Synchronous accessor for non-React code (e.g. the Tauri providers service).
 * Returns whatever providers list is currently in the store, including
 * baseline-only state during the very first load.
 */
export const getRegistryProvidersSync = (): ModelProvider[] =>
  useProviderRegistryStore.getState().providers

/**
 * Check whether a provider name is part of the system catalog (remote registry
 * or baseline). Used everywhere we need to distinguish system-defined
 * providers from user-added custom ones.
 */
export const isKnownProvider = (providerName: string): boolean => {
  if (!providerName) return false
  return useProviderRegistryStore
    .getState()
    .providers.some((p) => p.provider === providerName)
}

/**
 * Ensure the registry has resolved at least once. Cheap on subsequent calls —
 * returns immediately when initialization is already complete.
 */
export const ensureRegistryLoaded = async (): Promise<ModelProvider[]> => {
  const state = useProviderRegistryStore.getState()
  if (state.hasInitialized) return state.providers
  await state.refresh()
  return useProviderRegistryStore.getState().providers
}

/**
 * Kick off the initial fetch in the background. Importing this module is
 * enough to start loading; tests can override or skip via mocking.
 */
if (typeof window !== 'undefined') {
  void useProviderRegistryStore
    .getState()
    .refresh()
    .catch((error) => {
      console.warn('[provider-registry-store] initial refresh failed:', error)
    })
}
