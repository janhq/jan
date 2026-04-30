/**
 * Tests for the remote provider-registry loader.
 *
 * These tests cover the public surface in `services/provider-registry.ts`:
 *   - Successful fetch caches and merges with baseline.
 *   - Stale cache is preferred over a network round-trip when fresh.
 *   - Network failures fall back to cached / baseline data.
 *   - api_key sanitization defends against malicious manifests.
 *   - schema_version mismatches are rejected.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

import {
  CACHE_TTL_MS,
  clearRegistryCache,
  getCachedManifest,
  getProvidersOrFallback,
  isCacheFresh,
  SUPPORTED_SCHEMA_VERSION,
} from '../provider-registry'
import { BASELINE_PROVIDERS } from '@/constants/providers'

const REMOTE_URL = 'https://example.test/registry.json'

const buildManifest = (overrides: Record<string, unknown> = {}) => ({
  schema_version: SUPPORTED_SCHEMA_VERSION,
  updated_at: '2026-04-29T00:00:00Z',
  providers: [
    {
      active: true,
      api_key: '',
      base_url: 'https://api.openai.com/v1',
      explore_models_url: 'https://platform.openai.com/docs/models',
      provider: 'openai',
      settings: [],
      models: [],
    },
  ],
  ...overrides,
})

const mockFetchSuccess = (body: unknown) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

const mockFetchFailure = (error: unknown) => {
  const fetchMock = vi.fn(async () => {
    throw error
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('provider-registry loader', () => {
  beforeEach(() => {
    clearRegistryCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches a valid manifest and merges with baseline', async () => {
    mockFetchSuccess(buildManifest())

    const result = await getProvidersOrFallback({ url: REMOTE_URL })

    expect(result.source).toBe('remote')
    expect(result.providers.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['openai', 'azure'])
    )
    const baselineIds = BASELINE_PROVIDERS.map((p) => p.provider)
    for (const id of baselineIds) {
      expect(result.providers.map((p) => p.provider)).toContain(id)
    }
  })

  it('writes the cache after a successful fetch', async () => {
    mockFetchSuccess(buildManifest())

    await getProvidersOrFallback({ url: REMOTE_URL })

    const cached = getCachedManifest()
    expect(cached).not.toBeNull()
    expect(cached!.manifest.providers[0].provider).toBe('openai')
    expect(isCacheFresh(cached)).toBe(true)
  })

  it('serves cached data on subsequent calls within TTL', async () => {
    const fetchMock = mockFetchSuccess(buildManifest())

    await getProvidersOrFallback({ url: REMOTE_URL })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await getProvidersOrFallback({ url: REMOTE_URL })
    expect(second.source).toBe('cache')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forces a fetch when force=true even if cache is fresh', async () => {
    const fetchMock = mockFetchSuccess(buildManifest())

    await getProvidersOrFallback({ url: REMOTE_URL })
    await getProvidersOrFallback({ url: REMOTE_URL, force: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to cached data when the network fails', async () => {
    mockFetchSuccess(buildManifest())
    await getProvidersOrFallback({ url: REMOTE_URL })

    mockFetchFailure(new Error('offline'))
    const result = await getProvidersOrFallback({
      url: REMOTE_URL,
      force: true,
    })

    expect(result.source).toBe('cache')
    expect(result.error).toBe('offline')
    expect(
      result.providers.find((p) => p.provider === 'openai')
    ).toBeDefined()
  })

  it('falls back to baseline when no cache and the network fails', async () => {
    mockFetchFailure(new Error('boom'))

    const result = await getProvidersOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('baseline')
    expect(result.providers.map((p) => p.provider)).toEqual(
      BASELINE_PROVIDERS.map((p) => p.provider)
    )
  })

  it('sanitizes api_key on every fetched provider', async () => {
    mockFetchSuccess(
      buildManifest({
        providers: [
          {
            active: true,
            api_key: 'leaked-key-from-malicious-commit',
            base_url: 'https://api.openai.com/v1',
            provider: 'openai',
            settings: [],
            models: [],
          },
        ],
      })
    )

    const result = await getProvidersOrFallback({ url: REMOTE_URL })
    const openai = result.providers.find((p) => p.provider === 'openai')
    expect(openai?.api_key).toBe('')
  })

  it('rejects manifests with a newer schema_version than supported', async () => {
    mockFetchSuccess(
      buildManifest({ schema_version: SUPPORTED_SCHEMA_VERSION + 1 })
    )

    const result = await getProvidersOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('baseline')
    expect(result.error).toMatch(/schema_version/)
  })

  it('rejects manifests with a malformed payload', async () => {
    mockFetchSuccess({ not: 'a manifest' })

    const result = await getProvidersOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('baseline')
    expect(result.error).toMatch(/not a valid manifest/)
  })

  it('treats a stale cache as eligible for fallback only', async () => {
    mockFetchSuccess(buildManifest())
    await getProvidersOrFallback({ url: REMOTE_URL })

    // Backdate the cache so isCacheFresh would return false.
    const tsKey = 'jan_provider_registry_cache_ts_v1'
    window.localStorage.setItem(
      tsKey,
      String(Date.now() - CACHE_TTL_MS - 1000)
    )

    const cached = getCachedManifest()
    expect(isCacheFresh(cached)).toBe(false)

    mockFetchFailure(new Error('still offline'))
    const result = await getProvidersOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('cache')
  })
})
