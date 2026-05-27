import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'

// Build-time globals must be set BEFORE the module under test loads.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.IS_TAURI = false
  g.IS_MACOS = true
  g.IS_WINDOWS = false
  g.IS_LINUX = false
  // Disable the gzip-preferred path so tests can mock a single fetch
  // call per assertion. The gzip path itself is exercised by the real
  // app + the cron `gzip` step.
  g.DecompressionStream = undefined
})

import type { CatalogManifest } from '@/services/model-catalog-registry'

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k]
    }),
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

const buildManifest = (
  overrides: Partial<CatalogManifest> = {}
): CatalogManifest => ({
  manifest_version: 1,
  schema_version: 1,
  updated_at: '2026-05-27T12:00:00Z',
  orgs: ['unsloth'],
  models: [
    {
      model_name: 'unsloth/test',
      developer: 'unsloth',
      downloads: 0,
      quants: [],
    },
  ],
  ...overrides,
})

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorageMock.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('model-catalog-registry', () => {
  it('returns remote source when fetch succeeds', async () => {
    const manifest = buildManifest()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => manifest,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getCatalogOrFallback, clearCatalogCache } = await import(
      '@/services/model-catalog-registry'
    )
    clearCatalogCache()

    const result = await getCatalogOrFallback()
    expect(result.source).toBe('remote')
    expect(result.manifest.models).toHaveLength(1)
    expect(result.manifest.models[0].model_name).toBe('unsloth/test')
  })

  it('uses cache on a second call within TTL', async () => {
    const manifest = buildManifest()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => manifest,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getCatalogOrFallback, clearCatalogCache } = await import(
      '@/services/model-catalog-registry'
    )
    clearCatalogCache()

    const first = await getCatalogOrFallback()
    expect(first.source).toBe('remote')

    const second = await getCatalogOrFallback()
    expect(second.source).toBe('cache')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to baseline when fetch fails and no cache exists', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', fetchMock)

    const { getCatalogOrFallback, clearCatalogCache } = await import(
      '@/services/model-catalog-registry'
    )
    clearCatalogCache()

    const result = await getCatalogOrFallback()
    expect(result.source).toBe('baseline')
    expect(result.manifest.models.length).toBeGreaterThan(0)
    expect(result.error).toContain('boom')
  })

  it('falls back to cache when fetch fails after a successful first call', async () => {
    const manifest = buildManifest()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => manifest,
      } as Response)
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const { getCatalogOrFallback, clearCatalogCache } = await import(
      '@/services/model-catalog-registry'
    )
    clearCatalogCache()

    await getCatalogOrFallback()
    const fallback = await getCatalogOrFallback({ force: true })
    expect(fallback.source).toBe('cache')
    expect(fallback.error).toContain('network down')
    expect(fallback.manifest.models[0].model_name).toBe('unsloth/test')
  })

  it('rejects manifests with newer schema_version', async () => {
    const manifest = buildManifest({ schema_version: 999 })
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => manifest,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getCatalogOrFallback, clearCatalogCache } = await import(
      '@/services/model-catalog-registry'
    )
    clearCatalogCache()

    const result = await getCatalogOrFallback()
    expect(result.source).toBe('baseline')
    expect(result.error).toMatch(/schema_version 999/)
  })

  it('rejects malformed payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ not_a_manifest: true }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getCatalogOrFallback, clearCatalogCache } = await import(
      '@/services/model-catalog-registry'
    )
    clearCatalogCache()

    const result = await getCatalogOrFallback()
    expect(result.source).toBe('baseline')
    expect(result.error).toMatch(/not a valid catalog/)
  })
})
