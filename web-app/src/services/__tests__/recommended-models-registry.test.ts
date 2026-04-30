/**
 * Tests for the remote recommended-models registry loader.
 *
 * Covers the public surface in `services/recommended-models-registry.ts`:
 *   - Successful fetch caches the manifest.
 *   - Fresh cache is preferred over a network round-trip.
 *   - Network failures fall back to cached / baseline data.
 *   - schema_version mismatches are rejected.
 *   - Malformed payloads are rejected.
 *   - Stale cache is eligible only as a network-failure fallback.
 *   - Platform filter helper (`filterRecommendationsForPlatform`).
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
  filterRecommendationsForPlatform,
  getCachedManifest,
  getRecommendationsOrFallback,
  isCacheFresh,
  SUPPORTED_SCHEMA_VERSION,
  type Recommendation,
} from '../recommended-models-registry'
import { BASELINE_RECOMMENDED_MODELS } from '@/constants/models'

const REMOTE_URL = 'https://example.test/recommended.json'

const buildManifest = (overrides: Record<string, unknown> = {}) => ({
  schema_version: SUPPORTED_SCHEMA_VERSION,
  updated_at: '2026-04-30T00:00:00Z',
  recommendations: [
    {
      model_name: 'unsloth/gemma-4-E4B-it-GGUF',
      description_key: 'hub:recEverydayUse',
    },
    {
      model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      description_key: 'hub:recForMlx',
      platforms: ['macos'],
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

describe('recommended-models-registry loader', () => {
  beforeEach(() => {
    clearRegistryCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches a valid manifest and exposes its recommendations', async () => {
    mockFetchSuccess(buildManifest())

    const result = await getRecommendationsOrFallback({ url: REMOTE_URL })

    expect(result.source).toBe('remote')
    expect(result.recommendations.map((r) => r.model_name)).toEqual([
      'unsloth/gemma-4-E4B-it-GGUF',
      'mlx-community/Qwen3.5-9B-MLX-4bit',
    ])
    expect(result.recommendations[1].platforms).toEqual(['macos'])
  })

  it('writes the cache after a successful fetch', async () => {
    mockFetchSuccess(buildManifest())

    await getRecommendationsOrFallback({ url: REMOTE_URL })

    const cached = getCachedManifest()
    expect(cached).not.toBeNull()
    expect(cached!.manifest.recommendations).toHaveLength(2)
    expect(isCacheFresh(cached)).toBe(true)
  })

  it('serves cached data on subsequent calls within TTL', async () => {
    const fetchMock = mockFetchSuccess(buildManifest())

    await getRecommendationsOrFallback({ url: REMOTE_URL })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await getRecommendationsOrFallback({ url: REMOTE_URL })
    expect(second.source).toBe('cache')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forces a fetch when force=true even if cache is fresh', async () => {
    const fetchMock = mockFetchSuccess(buildManifest())

    await getRecommendationsOrFallback({ url: REMOTE_URL })
    await getRecommendationsOrFallback({ url: REMOTE_URL, force: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to cached data when the network fails', async () => {
    mockFetchSuccess(buildManifest())
    await getRecommendationsOrFallback({ url: REMOTE_URL })

    mockFetchFailure(new Error('offline'))
    const result = await getRecommendationsOrFallback({
      url: REMOTE_URL,
      force: true,
    })

    expect(result.source).toBe('cache')
    expect(result.error).toBe('offline')
    expect(
      result.recommendations.find(
        (r) => r.model_name === 'unsloth/gemma-4-E4B-it-GGUF'
      )
    ).toBeDefined()
  })

  it('falls back to baseline when no cache and the network fails', async () => {
    mockFetchFailure(new Error('boom'))

    const result = await getRecommendationsOrFallback({ url: REMOTE_URL })

    expect(result.source).toBe('baseline')
    expect(result.recommendations.map((r) => r.model_name)).toEqual(
      BASELINE_RECOMMENDED_MODELS.map((r) => r.model_name)
    )
    expect(result.error).toBe('boom')
  })

  it('rejects manifests with a newer schema_version than supported', async () => {
    mockFetchSuccess(
      buildManifest({ schema_version: SUPPORTED_SCHEMA_VERSION + 1 })
    )

    const result = await getRecommendationsOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('baseline')
    expect(result.error).toMatch(/schema_version/)
  })

  it('rejects manifests with a malformed payload', async () => {
    mockFetchSuccess({ not: 'a manifest' })

    const result = await getRecommendationsOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('baseline')
    expect(result.error).toMatch(/not a valid manifest/)
  })

  it('drops invalid recommendation entries while keeping good ones', async () => {
    mockFetchSuccess(
      buildManifest({
        recommendations: [
          { model_name: 'good/one', description_key: 'hub:recEverydayUse' },
          { model_name: '', description_key: 'hub:recEverydayUse' },
          { model_name: 'bad/key', description_key: 'NOT_HUB_PREFIXED' },
          {
            model_name: 'platform/coerced',
            description_key: 'hub:recForMlx',
            platforms: ['macos', 'aix', 7],
          },
        ],
      })
    )

    const result = await getRecommendationsOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('remote')
    expect(result.recommendations.map((r) => r.model_name)).toEqual([
      'good/one',
      'platform/coerced',
    ])
    expect(result.recommendations[1].platforms).toEqual(['macos'])
  })

  it('treats a stale cache as eligible for fallback only', async () => {
    mockFetchSuccess(buildManifest())
    await getRecommendationsOrFallback({ url: REMOTE_URL })

    // Backdate the cache so isCacheFresh returns false.
    const tsKey = 'jan_recommended_models_cache_ts_v1'
    window.localStorage.setItem(
      tsKey,
      String(Date.now() - CACHE_TTL_MS - 1000)
    )

    const cached = getCachedManifest()
    expect(isCacheFresh(cached)).toBe(false)

    mockFetchFailure(new Error('still offline'))
    const result = await getRecommendationsOrFallback({ url: REMOTE_URL })
    expect(result.source).toBe('cache')
  })
})

describe('filterRecommendationsForPlatform', () => {
  const recs: Recommendation[] = [
    {
      model_name: 'universal/one',
      description_key: 'hub:recEverydayUse',
    },
    {
      model_name: 'mac/only',
      description_key: 'hub:recForMlx',
      platforms: ['macos'],
    },
    {
      model_name: 'win-linux/only',
      description_key: 'hub:recFinetuningChat',
      platforms: ['windows', 'linux'],
    },
    {
      model_name: 'disabled/everywhere',
      description_key: 'hub:recEverydayUse',
      active: false,
    },
  ]

  it('keeps universal entries on every platform', () => {
    expect(
      filterRecommendationsForPlatform(recs, 'macos').map((r) => r.model_name)
    ).toContain('universal/one')
    expect(
      filterRecommendationsForPlatform(recs, 'windows').map((r) => r.model_name)
    ).toContain('universal/one')
    expect(
      filterRecommendationsForPlatform(recs, 'linux').map((r) => r.model_name)
    ).toContain('universal/one')
  })

  it('hides macOS-only entries on Windows and Linux', () => {
    const winNames = filterRecommendationsForPlatform(recs, 'windows').map(
      (r) => r.model_name
    )
    const linuxNames = filterRecommendationsForPlatform(recs, 'linux').map(
      (r) => r.model_name
    )
    expect(winNames).not.toContain('mac/only')
    expect(linuxNames).not.toContain('mac/only')
  })

  it('hides Windows/Linux-only entries on macOS', () => {
    const macNames = filterRecommendationsForPlatform(recs, 'macos').map(
      (r) => r.model_name
    )
    expect(macNames).not.toContain('win-linux/only')
  })

  it('always drops entries with active: false', () => {
    for (const os of ['macos', 'windows', 'linux'] as const) {
      const names = filterRecommendationsForPlatform(recs, os).map(
        (r) => r.model_name
      )
      expect(names).not.toContain('disabled/everywhere')
    }
  })
})
