/**
 * Provider Registry — remote configuration loader.
 *
 * Fetches the cloud-provider catalog from a public git-hosted JSON manifest at
 * runtime so that adding/updating providers does not require an app release.
 *
 * Failure-safe: when the network is unreachable, the schema_version is too
 * high, or the payload is malformed, callers fall back to a locally bundled
 * baseline ({@link BASELINE_PROVIDERS}). API keys are never read from the
 * registry — the `api_key` field is always coerced to "" on load.
 *
 * Designed to be importable from both React components (via the Zustand store
 * in `@/stores/provider-registry-store`) and non-React code (e.g. the Tauri
 * providers service).
 */

import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { BASELINE_PROVIDERS } from '@/constants/providers'

/**
 * Why we use the standard `fetch` instead of the Tauri HTTP plugin here:
 * the registry is served by GitHub's raw CDN with `Access-Control-Allow-Origin: *`,
 * so a normal browser-side fetch works in both the desktop WebView and the
 * web-only build. The Tauri plugin has been observed to hang under macOS for
 * this specific endpoint; standard fetch resolves quickly and uniformly.
 *
 * `fetchTauri` is still imported so we can fall back to it if the standard
 * fetch fails (e.g. an air-gapped corporate proxy that intercepts WebView
 * traffic but lets the Rust HTTP client through).
 */

export const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/providers/registry.json'

export const REGISTRY_URL: string =
  (import.meta.env.VITE_PROVIDER_REGISTRY_URL as string | undefined) ??
  DEFAULT_REGISTRY_URL

/** Highest registry schema_version this client understands. */
export const SUPPORTED_SCHEMA_VERSION = 1

/** Cache TTL (1 hour). */
export const CACHE_TTL_MS = 60 * 60 * 1000

const CACHE_KEY = 'jan_provider_registry_cache_v1'
const CACHE_TS_KEY = 'jan_provider_registry_cache_ts_v1'

const FETCH_TIMEOUT_MS = 5000

export type RegistryManifest = {
  schema_version: number
  updated_at: string
  providers: ModelProvider[]
}

export type RegistryFetchResult = {
  providers: ModelProvider[]
  source: 'remote' | 'cache' | 'baseline'
  fetchedAt: number | null
  manifestUpdatedAt: string | null
  error?: string
}

/**
 * Strip fields the registry MUST NOT influence (notably API keys).
 * Even if a malicious commit slips a non-empty value in, it is wiped here.
 */
const sanitizeProvider = (p: ModelProvider): ModelProvider => ({
  ...p,
  api_key: '',
})

const isManifest = (value: unknown): value is RegistryManifest => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.schema_version === 'number' &&
    typeof v.updated_at === 'string' &&
    Array.isArray(v.providers)
  )
}

const safeLocalStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export type CachedManifest = {
  manifest: RegistryManifest
  fetchedAt: number
}

export const getCachedManifest = (): CachedManifest | null => {
  const ls = safeLocalStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(CACHE_KEY)
    const tsRaw = ls.getItem(CACHE_TS_KEY)
    if (!raw || !tsRaw) return null
    const fetchedAt = Number(tsRaw)
    if (!Number.isFinite(fetchedAt)) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isManifest(parsed)) return null
    return { manifest: parsed, fetchedAt }
  } catch {
    return null
  }
}

export const isCacheFresh = (cached: CachedManifest | null): boolean => {
  if (!cached) return false
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS
}

const writeCache = (manifest: RegistryManifest, fetchedAt: number): void => {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.setItem(CACHE_KEY, JSON.stringify(manifest))
    ls.setItem(CACHE_TS_KEY, String(fetchedAt))
  } catch (error) {
    console.warn('[provider-registry] Failed to write cache:', error)
  }
}

export const clearRegistryCache = (): void => {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.removeItem(CACHE_KEY)
    ls.removeItem(CACHE_TS_KEY)
  } catch (error) {
    console.warn('[provider-registry] Failed to clear cache:', error)
  }
}

const isTauriRuntime = (): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof IS_TAURI !== 'undefined' && Boolean(IS_TAURI as any)
  } catch {
    return false
  }
}

const fetchOnce = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal
): Promise<unknown> => {
  const response = await fetcher(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(
      `Registry fetch failed: ${response.status} ${response.statusText}`
    )
  }
  return (await response.json()) as unknown
}

const fetchManifest = async (
  url: string,
  signal?: AbortSignal
): Promise<RegistryManifest> => {
  let data: unknown
  try {
    // Primary path: standard fetch. GitHub raw is CORS-enabled and the
    // browser/WebView resolves it reliably across macOS, Windows, and Linux.
    data = await fetchOnce(fetch, url, signal)
  } catch (primaryError) {
    if (!isTauriRuntime()) throw primaryError
    console.warn(
      '[provider-registry] standard fetch failed, retrying via Tauri HTTP plugin:',
      primaryError instanceof Error ? primaryError.message : primaryError
    )
    data = await fetchOnce(fetchTauri as typeof fetch, url, signal)
  }

  if (!isManifest(data)) {
    throw new Error('Registry payload is not a valid manifest')
  }
  if (data.schema_version > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Registry schema_version ${data.schema_version} is newer than supported ` +
        `(${SUPPORTED_SCHEMA_VERSION}). Update the application to read it.`
    )
  }
  return {
    ...data,
    providers: data.providers.map(sanitizeProvider),
  }
}

/**
 * Hard timeout wrapper. Tauri's HTTP plugin does not always honour
 * `AbortSignal`, so we race against a timer to guarantee resolution.
 */
const withHardTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  reason = `Registry fetch timed out after ${timeoutMs}ms`
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })

const mergeWithBaseline = (remote: ModelProvider[]): ModelProvider[] => {
  const remoteIds = new Set(remote.map((p) => p.provider))
  const baselineExtras = BASELINE_PROVIDERS.filter(
    (p) => !remoteIds.has(p.provider)
  )
  return [...remote, ...baselineExtras]
}

export type FetchOptions = {
  /** Bypass cache freshness check and force a network round-trip. */
  force?: boolean
  /** Override URL (for tests). */
  url?: string
  /** Abort the network request after this many ms. Default: 5000. */
  timeoutMs?: number
}

/**
 * Resolve the effective list of providers using the priority chain:
 *
 *   1. Fresh cache (when not forcing).
 *   2. Network fetch (writes a new cache entry on success).
 *   3. Stale cache (used after a network failure).
 *   4. Baseline fallback bundled in the app.
 *
 * Always returns a result — never throws — so UI code can render unconditionally.
 */
export const getProvidersOrFallback = async (
  options: FetchOptions = {}
): Promise<RegistryFetchResult> => {
  const { force = false, url = REGISTRY_URL, timeoutMs = FETCH_TIMEOUT_MS } =
    options

  const cached = getCachedManifest()
  if (!force && isCacheFresh(cached) && cached) {
    return {
      providers: mergeWithBaseline(cached.manifest.providers),
      source: 'cache',
      fetchedAt: cached.fetchedAt,
      manifestUpdatedAt: cached.manifest.updated_at,
    }
  }

  const controller = new AbortController()
  // When the caller is explicitly forcing a fetch (e.g. the manual Refresh
  // button), append a cache-busting timestamp to bypass the GitHub raw CDN
  // cache (which can hold the previous payload for a few minutes after a
  // push) and any intermediate proxy/browser caches.
  const fetchUrl = force
    ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
    : url
  try {
    console.info(
      `[provider-registry] Fetching ${fetchUrl} (timeout ${timeoutMs}ms)`
    )
    const manifest = await withHardTimeout(
      fetchManifest(fetchUrl, controller.signal),
      timeoutMs
    )
    const fetchedAt = Date.now()
    writeCache(manifest, fetchedAt)
    console.info(
      `[provider-registry] Loaded ${manifest.providers.length} providers (schema_version=${manifest.schema_version}, updated_at=${manifest.updated_at})`
    )
    return {
      providers: mergeWithBaseline(manifest.providers),
      source: 'remote',
      fetchedAt,
      manifestUpdatedAt: manifest.updated_at,
    }
  } catch (error) {
    // Best-effort cancel of the underlying request when the timeout wins
    // (Tauri's plugin may ignore the signal but standard fetch honours it).
    try {
      controller.abort()
    } catch {
      // ignore
    }
    const message =
      error instanceof Error ? error.message : 'Unknown registry error'
    console.warn('[provider-registry] Falling back:', message)
    if (cached) {
      return {
        providers: mergeWithBaseline(cached.manifest.providers),
        source: 'cache',
        fetchedAt: cached.fetchedAt,
        manifestUpdatedAt: cached.manifest.updated_at,
        error: message,
      }
    }
    return {
      providers: BASELINE_PROVIDERS.slice(),
      source: 'baseline',
      fetchedAt: null,
      manifestUpdatedAt: null,
      error: message,
    }
  }
}
