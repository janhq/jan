/**
 * Model catalog registry -- remote loader for the curated Atomic Chat
 * model catalog and its pre-built MiniSearch index.
 *
 * Mirrors the architecture of `provider-registry.ts` and
 * `recommended-models-registry.ts`: fetch from GitHub Releases, cache in
 * `localStorage` for one hour, fall back to a bundled baseline. The
 * cache holds two independent payloads (catalog + index) with separate
 * keys so each can be refreshed without invalidating the other.
 *
 * Failure-safe by construction: `getCatalogOrFallback()` and
 * `getIndexOrFallback()` never throw — UI code can render unconditionally.
 *
 * The catalog payload is the strict JSON envelope produced by the
 * `atomic-chat-model-catalog` scraper (`{ manifest_version: 1, models:
 * CatalogModel[] }`). The shape of every `models[]` entry is a strict
 * superset of the client-side `CatalogModel` type, so the existing
 * download pipeline keeps working unchanged.
 */

import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { BASELINE_MODEL_CATALOG } from '@/constants/models'
import type { CatalogModel } from '@/services/models/types'

// Why raw.githubusercontent.com and not GitHub Releases?
//
//   We tried `github.com/<owner>/<repo>/releases/latest/download/*` first.
//   That endpoint responds with a 302 to a signed `objects.githubusercontent.com`
//   URL, and the chain (HTTP/2 + Vary: Origin + Accept-Encoding) is not
//   handled reliably by Tauri's `@tauri-apps/plugin-http` (fetch hangs
//   past the 60 s timeout, despite curl -L completing in ~1 s). Browser
//   fetch likewise refuses the redirect under CORS.
//
//   `raw.githubusercontent.com` serves git-tracked files directly with
//   permissive CORS headers and no signed redirect. It is the same
//   transport `recommended-models-registry.ts` already uses successfully
//   for the smaller `recommended.json` payload.
//
// The cron in `atomic-chat-model-catalog` commits the gzipped artefacts
// to `dist/` on main after each scrape; the latest snapshot is therefore
// always one HTTP/2 hop away.
export const DEFAULT_CATALOG_BASE_URL =
  'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-model-catalog/main/dist'

export const CATALOG_URL: string =
  (import.meta.env.VITE_MODEL_CATALOG_URL as string | undefined) ??
  `${DEFAULT_CATALOG_BASE_URL}/catalog.json`

export const CATALOG_INDEX_URL: string =
  (import.meta.env.VITE_MODEL_CATALOG_INDEX_URL as string | undefined) ??
  `${DEFAULT_CATALOG_BASE_URL}/catalog.idx.json`

/** Highest manifest schema_version this client understands. */
export const SUPPORTED_SCHEMA_VERSION = 1

/** Pre-built index format version this client understands. */
export const SUPPORTED_INDEX_VERSION = 1

/** Cache TTL (1 hour) — same posture as the sibling registries. */
export const CACHE_TTL_MS = 60 * 60 * 1000

const CATALOG_CACHE_KEY = 'atomic_model_catalog_cache_v1'
const CATALOG_CACHE_TS_KEY = 'atomic_model_catalog_cache_ts_v1'
const INDEX_CACHE_KEY = 'atomic_model_catalog_idx_v1'
const INDEX_CACHE_TS_KEY = 'atomic_model_catalog_idx_ts_v1'

// 60 s for the catalog (~13 MB raw, ~3-4 MB gzipped) — covers users on
// slow connections to GitHub Releases CDN (~300 KB/s in the worst case
// we have measured). 30 s for the index (~2.4 MB raw, ~1 MB gzipped).
const CATALOG_FETCH_TIMEOUT_MS = 60_000
const INDEX_FETCH_TIMEOUT_MS = 30_000

export type CatalogManifest = {
  manifest_version: number
  schema_version: number
  updated_at: string
  orgs?: string[]
  stats?: Record<string, unknown>
  models: CatalogModel[]
}

export type CatalogIndexPayload = {
  index_version: number
  catalog_updated_at?: string
  catalog_total_models?: number
  // The raw `MiniSearch.toJSON()` snapshot. Kept loose-typed here so that
  // bumping minisearch's internal shape never breaks this loader.
  minisearch: unknown
}

/**
 * Where the manifest came from, in priority order:
 *
 *   - `remote`   — fresh GET against `raw.githubusercontent.com`.
 *   - `cache`    — `localStorage` snapshot from a previous successful
 *                  remote fetch (TTL: 1 hour).
 *   - `bundled`  — gzipped catalog snapshot embedded in the app bundle
 *                  by `scripts/fetch-seed-catalog.mjs` at build time.
 *                  Used when neither cache nor remote is available
 *                  (offline first-launch, corporate proxy, blocked CDN).
 *   - `baseline` — five-model hard-coded `BASELINE_MODEL_CATALOG`,
 *                  truly defensive only.
 */
export type RegistrySource = 'remote' | 'cache' | 'bundled' | 'baseline'

const SEED_CATALOG_PATH = '/seed-catalog.json.gz'
const SEED_INDEX_PATH = '/seed-catalog.idx.json.gz'

/**
 * Best-effort read of the bundled seed catalog. Returns `null` if the
 * asset is missing (no prebuild ran, dev mode without seed, build
 * pipeline skipped) or unreadable (corrupt gzip, schema mismatch).
 * Never throws.
 */
export const getBundledSeedCatalog = async (): Promise<CatalogManifest | null> => {
  if (typeof window === 'undefined') return null
  if (!hasDecompressionStream()) return null
  try {
    const response = await fetch(SEED_CATALOG_PATH, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
    })
    if (!response.ok) return null
    const buf = await response.arrayBuffer()
    if (buf.byteLength < 1024) return null
    const text = await gunzipToText(buf)
    const parsed = JSON.parse(text) as unknown
    if (!isManifestShape(parsed)) return null
    if (parsed.schema_version > SUPPORTED_SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Best-effort read of the bundled MiniSearch index snapshot.
 */
export const getBundledSeedIndex = async (): Promise<CatalogIndexPayload | null> => {
  if (typeof window === 'undefined') return null
  if (!hasDecompressionStream()) return null
  try {
    const response = await fetch(SEED_INDEX_PATH, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
    })
    if (!response.ok) return null
    const buf = await response.arrayBuffer()
    if (buf.byteLength < 256) return null
    const text = await gunzipToText(buf)
    const parsed = JSON.parse(text) as unknown
    if (!isIndexShape(parsed)) return null
    if (parsed.index_version > SUPPORTED_INDEX_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export type CatalogFetchResult = {
  manifest: CatalogManifest
  source: RegistrySource
  fetchedAt: number | null
  manifestUpdatedAt: string | null
  error?: string
}

export type IndexFetchResult = {
  payload: CatalogIndexPayload | null
  source: RegistrySource
  fetchedAt: number | null
  error?: string
}

const baselineManifest = (): CatalogManifest => ({
  manifest_version: 1,
  schema_version: SUPPORTED_SCHEMA_VERSION,
  updated_at: '1970-01-01T00:00:00Z',
  models: BASELINE_MODEL_CATALOG.slice(),
})

const safeLocalStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

const isManifestShape = (value: unknown): value is CatalogManifest => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.schema_version === 'number' &&
    typeof v.updated_at === 'string' &&
    Array.isArray(v.models)
  )
}

const isIndexShape = (value: unknown): value is CatalogIndexPayload => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.index_version === 'number' &&
    v.minisearch !== undefined &&
    v.minisearch !== null
  )
}

type CachedCatalog = { manifest: CatalogManifest; fetchedAt: number }
type CachedIndex = { payload: CatalogIndexPayload; fetchedAt: number }

export const getCachedCatalog = (): CachedCatalog | null => {
  const ls = safeLocalStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(CATALOG_CACHE_KEY)
    const tsRaw = ls.getItem(CATALOG_CACHE_TS_KEY)
    if (!raw || !tsRaw) return null
    const fetchedAt = Number(tsRaw)
    if (!Number.isFinite(fetchedAt)) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isManifestShape(parsed)) return null
    return { manifest: parsed, fetchedAt }
  } catch {
    return null
  }
}

export const getCachedIndex = (): CachedIndex | null => {
  const ls = safeLocalStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(INDEX_CACHE_KEY)
    const tsRaw = ls.getItem(INDEX_CACHE_TS_KEY)
    if (!raw || !tsRaw) return null
    const fetchedAt = Number(tsRaw)
    if (!Number.isFinite(fetchedAt)) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isIndexShape(parsed)) return null
    if (parsed.index_version > SUPPORTED_INDEX_VERSION) return null
    return { payload: parsed, fetchedAt }
  } catch {
    return null
  }
}

export const isCacheFresh = (
  cached: { fetchedAt: number } | null
): boolean => {
  if (!cached) return false
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS
}

const writeCatalogCache = (
  manifest: CatalogManifest,
  fetchedAt: number
): void => {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.setItem(CATALOG_CACHE_KEY, JSON.stringify(manifest))
    ls.setItem(CATALOG_CACHE_TS_KEY, String(fetchedAt))
  } catch (error) {
    // Catalog can grow to a few MB. `QuotaExceededError` is recoverable: we
    // just lose the persistent cache for this session.
    console.warn('[model-catalog-registry] Failed to write catalog cache:', error)
  }
}

const writeIndexCache = (
  payload: CatalogIndexPayload,
  fetchedAt: number
): void => {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.setItem(INDEX_CACHE_KEY, JSON.stringify(payload))
    ls.setItem(INDEX_CACHE_TS_KEY, String(fetchedAt))
  } catch (error) {
    console.warn('[model-catalog-registry] Failed to write index cache:', error)
  }
}

export const clearCatalogCache = (): void => {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.removeItem(CATALOG_CACHE_KEY)
    ls.removeItem(CATALOG_CACHE_TS_KEY)
    ls.removeItem(INDEX_CACHE_KEY)
    ls.removeItem(INDEX_CACHE_TS_KEY)
  } catch (error) {
    console.warn('[model-catalog-registry] Failed to clear cache:', error)
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

const hasDecompressionStream = (): boolean => {
  return typeof (globalThis as { DecompressionStream?: unknown })
    .DecompressionStream === 'function'
}

const gunzipToText = async (buf: ArrayBuffer): Promise<string> => {
  // `DecompressionStream` is a native browser API available in WKWebView
  // (Safari 16.4+), WebView2 (Chromium 80+) and WebKitGTK 2.42+, i.e. every
  // platform Tauri 2 supports. We pipe the gzipped bytes through it and
  // collect the result as UTF-8 text.
  const Decompressor = (
    globalThis as unknown as {
      DecompressionStream: new (format: 'gzip' | 'deflate') => GenericTransformStream
    }
  ).DecompressionStream
  const stream = new Blob([buf]).stream().pipeThrough(new Decompressor('gzip'))
  return await new Response(stream).text()
}

const fetchJsonRaw = async (
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
      `Catalog fetch failed: ${response.status} ${response.statusText} (${url})`
    )
  }
  return (await response.json()) as unknown
}

const fetchJsonGzip = async (
  fetcher: typeof fetch,
  gzipUrl: string,
  signal?: AbortSignal
): Promise<unknown> => {
  const response = await fetcher(gzipUrl, {
    method: 'GET',
    headers: { Accept: 'application/octet-stream' },
    signal,
  })
  if (!response.ok) {
    throw new Error(
      `Catalog gzip fetch failed: ${response.status} ${response.statusText} (${gzipUrl})`
    )
  }
  const buf = await response.arrayBuffer()
  const text = await gunzipToText(buf)
  return JSON.parse(text) as unknown
}

/**
 * Fetch a JSON artefact, preferring the gzipped variant for ~10x smaller
 * transfer when both exist. Tries `${url}.gz` first; on 404 / network /
 * decompression error falls back to the plain `${url}`.
 *
 * Transport priority (mirrors `recommended-models-registry.ts`):
 *
 *   1. Standard `window.fetch` — works against `raw.githubusercontent.com`
 *      because that host emits permissive CORS headers and serves files
 *      directly with no signed redirect.
 *   2. `@tauri-apps/plugin-http` — fallback for the rare case the
 *      primary path fails (e.g. an enterprise proxy strips CORS or a
 *      future URL flip lands on a redirecting endpoint again). The
 *      plugin uses the native Rust HTTP client and ignores browser
 *      CORS, but in practice it has occasionally hung when used as
 *      the primary transport for large gzipped payloads, so it stays
 *      strictly secondary here.
 */
const fetchJson = async <T,>(
  url: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
  label = 'catalog'
): Promise<T> => {
  const attempt = async (transport: typeof fetch): Promise<unknown> => {
    if (hasDecompressionStream()) {
      const [path, query] = url.split('?', 2)
      const gzipUrl = `${path}.gz${query ? `?${query}` : ''}`
      try {
        return await fetchJsonGzip(transport, gzipUrl, signal)
      } catch (gzipError) {
        console.info(
          `[model-catalog-registry] gzip variant unavailable for ${label}, falling back to plain JSON:`,
          gzipError instanceof Error ? gzipError.message : gzipError
        )
        return await fetchJsonRaw(transport, url, signal)
      }
    }
    return await fetchJsonRaw(transport, url, signal)
  }

  let data: unknown
  try {
    data = await attempt(fetch)
  } catch (primaryError) {
    if (!isTauriRuntime()) throw primaryError
    console.warn(
      `[model-catalog-registry] window.fetch failed for ${label}, retrying via Tauri HTTP plugin:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    )
    data = await attempt(fetchTauri as typeof fetch)
  }
  if (!validate(data)) {
    throw new Error(`Catalog payload at ${url} is not a valid ${label}`)
  }
  return data
}

const withHardTimeout = <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  reason = `Catalog fetch timed out after ${timeoutMs}ms`
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

export type FetchOptions = {
  /** Bypass cache freshness check and force a network round-trip. */
  force?: boolean
  /** Override URL (for tests). */
  url?: string
  /** Abort the network request after this many ms. Default: 15000. */
  timeoutMs?: number
}

/**
 * Resolve the catalog manifest using the priority chain:
 *
 *   1. Fresh cache (when not forcing).
 *   2. Network fetch (writes a new cache entry on success).
 *   3. Stale cache (used after a network failure).
 *   4. Baseline manifest bundled in the app.
 *
 * Always returns a result — never throws.
 */
export const getCatalogOrFallback = async (
  options: FetchOptions = {}
): Promise<CatalogFetchResult> => {
  const {
    force = false,
    url = CATALOG_URL,
    timeoutMs = CATALOG_FETCH_TIMEOUT_MS,
  } = options

  const cached = getCachedCatalog()
  if (!force && isCacheFresh(cached) && cached) {
    return {
      manifest: cached.manifest,
      source: 'cache',
      fetchedAt: cached.fetchedAt,
      manifestUpdatedAt: cached.manifest.updated_at,
    }
  }

  const controller = new AbortController()
  const fetchUrl = force
    ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
    : url
  try {
    console.info(
      `[model-catalog-registry] Fetching catalog ${fetchUrl} (timeout ${timeoutMs}ms)`
    )
    const manifest = await withHardTimeout(
      fetchJson<CatalogManifest>(
        fetchUrl,
        isManifestShape,
        controller.signal,
        'catalog'
      ),
      timeoutMs
    )
    if (manifest.schema_version > SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        `Catalog schema_version ${manifest.schema_version} is newer than supported ` +
          `(${SUPPORTED_SCHEMA_VERSION}). Update Atomic Chat to read it.`
      )
    }
    const fetchedAt = Date.now()
    writeCatalogCache(manifest, fetchedAt)
    console.info(
      `[model-catalog-registry] Loaded ${manifest.models.length} models ` +
        `(schema_version=${manifest.schema_version}, updated_at=${manifest.updated_at})`
    )
    return {
      manifest,
      source: 'remote',
      fetchedAt,
      manifestUpdatedAt: manifest.updated_at,
    }
  } catch (error) {
    try {
      controller.abort()
    } catch {
      // ignore
    }
    const message =
      error instanceof Error ? error.message : 'Unknown catalog error'
    console.warn('[model-catalog-registry] Falling back:', message)
    if (cached) {
      return {
        manifest: cached.manifest,
        source: 'cache',
        fetchedAt: cached.fetchedAt,
        manifestUpdatedAt: cached.manifest.updated_at,
        error: message,
      }
    }
    return {
      manifest: baselineManifest(),
      source: 'baseline',
      fetchedAt: null,
      manifestUpdatedAt: null,
      error: message,
    }
  }
}

/**
 * Resolve the pre-built MiniSearch index payload. Same priority chain
 * as the catalog: fresh cache → network → stale cache → null (the
 * search service falls back to indexing on the fly).
 */
export const getIndexOrFallback = async (
  options: FetchOptions = {}
): Promise<IndexFetchResult> => {
  const {
    force = false,
    url = CATALOG_INDEX_URL,
    timeoutMs = INDEX_FETCH_TIMEOUT_MS,
  } = options

  const cached = getCachedIndex()
  if (!force && isCacheFresh(cached) && cached) {
    return {
      payload: cached.payload,
      source: 'cache',
      fetchedAt: cached.fetchedAt,
    }
  }

  const controller = new AbortController()
  const fetchUrl = force
    ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
    : url
  try {
    console.info(
      `[model-catalog-registry] Fetching index ${fetchUrl} (timeout ${timeoutMs}ms)`
    )
    const payload = await withHardTimeout(
      fetchJson<CatalogIndexPayload>(
        fetchUrl,
        isIndexShape,
        controller.signal,
        'index'
      ),
      timeoutMs
    )
    if (payload.index_version > SUPPORTED_INDEX_VERSION) {
      throw new Error(
        `Index version ${payload.index_version} is newer than supported ` +
          `(${SUPPORTED_INDEX_VERSION}). Falling back to on-the-fly indexing.`
      )
    }
    const fetchedAt = Date.now()
    writeIndexCache(payload, fetchedAt)
    return { payload, source: 'remote', fetchedAt }
  } catch (error) {
    try {
      controller.abort()
    } catch {
      // ignore
    }
    const message =
      error instanceof Error ? error.message : 'Unknown index error'
    console.warn(
      '[model-catalog-registry] Index fetch failed, will rebuild client-side if needed:',
      message
    )
    if (cached) {
      return {
        payload: cached.payload,
        source: 'cache',
        fetchedAt: cached.fetchedAt,
        error: message,
      }
    }
    return { payload: null, source: 'baseline', fetchedAt: null, error: message }
  }
}
