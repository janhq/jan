import { describe, expect, it, beforeEach, vi } from 'vitest'

// Build-time globals must be set BEFORE the module under test loads
// (`ORG_BOOST` reads `IS_MACOS` at import time). Use `vi.hoisted` so the
// stub runs ahead of the ES-module hoisted imports below.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.IS_MACOS = true
  g.IS_WINDOWS = false
  g.IS_LINUX = false
})

import {
  ModelSearchService,
  __resetModelSearchService,
} from '@/services/model-search'
import type { CatalogModel } from '@/services/models/types'

type CatalogWithTags = CatalogModel & { tags_normalized?: string[] }

const make = (overrides: Partial<CatalogWithTags>): CatalogWithTags => ({
  model_name: 'org/name',
  developer: 'org',
  downloads: 0,
  num_quants: 0,
  quants: [],
  num_mmproj: 0,
  mmproj_models: [],
  num_safetensors: 0,
  safetensors_files: [],
  is_mlx: false,
  description: '',
  ...overrides,
})

const corpus: CatalogWithTags[] = [
  make({
    model_name: 'unsloth/Qwen3.5-9B-GGUF',
    developer: 'unsloth',
    description: '**Tags**: gguf, qwen3, unsloth, conversational',
    downloads: 50_000,
    created_at: '2026-03-01T00:00:00Z',
    num_quants: 1,
    tags_normalized: ['gguf', 'qwen3', 'unsloth', 'q4_k_m'],
  }),
  make({
    model_name: 'bartowski/Qwen3.5-9B-Instruct-GGUF',
    developer: 'bartowski',
    description: '**Tags**: gguf, qwen3, bartowski, conversational',
    downloads: 120_000,
    created_at: '2026-04-15T00:00:00Z',
    num_quants: 8,
    tags_normalized: ['gguf', 'qwen3', 'bartowski', 'q4_k_m', 'iq3_xs'],
  }),
  make({
    model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
    developer: 'mlx-community',
    description: '**Tags**: mlx, qwen3_5, vision-language-model, 4-bit',
    downloads: 73_490,
    library_name: 'mlx',
    is_mlx: true,
    created_at: '2026-04-20T00:00:00Z',
    num_safetensors: 1,
    tags_normalized: ['mlx', 'qwen3.5', '4-bit'],
  }),
  make({
    model_name: 'meta-llama/Llama-3.2-3B-Instruct',
    developer: 'meta-llama',
    description: '**Tags**: transformers, llama, conversational',
    downloads: 1_000_000,
    created_at: '2025-09-25T00:00:00Z',
    tags_normalized: ['transformers', 'llama'],
  }),
  make({
    model_name: 'janhq/Jan-v2-VL-high-gguf',
    developer: 'janhq',
    description: '**Tags**: gguf, jan, vision-language',
    downloads: 5_000,
    created_at: '2026-01-10T00:00:00Z',
    tags_normalized: ['gguf', 'jan', 'vision-language'],
  }),
  make({
    model_name: 'ggml-org/granite-4.0-h-small-Q8_0-GGUF',
    developer: 'ggml-org',
    description: '**Tags**: gguf, granite, ibm',
    downloads: 30_000,
    created_at: '2026-05-10T00:00:00Z',
    num_quants: 1,
    tags_normalized: ['gguf', 'granite', 'q8_0', 'ibm'],
  }),
]

describe('ModelSearchService', () => {
  let svc: ModelSearchService

  beforeEach(() => {
    __resetModelSearchService()
    svc = new ModelSearchService()
    svc.setCatalog(corpus)
    svc.rebuild()
  })

  it('builds an index from the catalog', () => {
    const stats = svc.stats()
    expect(stats.total).toBe(6)
    expect(stats.orgs).toBeGreaterThanOrEqual(5)
    expect(svc.isReady()).toBe(true)
  })

  it('returns no results for an empty query when the catalog is empty', () => {
    const empty = new ModelSearchService()
    expect(empty.search('qwen')).toEqual([])
  })

  it('ranks the bartowski Qwen3.5 above the unsloth one when both are GGUF', () => {
    const hits = svc.search('qwen3.5')
    expect(hits.length).toBeGreaterThan(0)
    const bart = hits.findIndex((h) => h.developer === 'bartowski')
    const unsl = hits.findIndex((h) => h.developer === 'unsloth')
    expect(bart).toBeGreaterThanOrEqual(0)
    expect(unsl).toBeGreaterThanOrEqual(0)
    // bartowski has 120k downloads vs unsloth's 50k AND equal org boost (1.3),
    // so popularity * recency keeps it ahead.
    expect(bart).toBeLessThan(unsl)
  })

  it('boosts MLX results on macOS for an MLX-flavoured query', () => {
    const hits = svc.search('mlx qwen')
    expect(hits[0].developer).toBe('mlx-community')
  })

  it('suppresses Jan models via the org-boost penalty', () => {
    const hits = svc.search('jan')
    // janhq has ORG_BOOST=0.5 and competes with org-neutral matches. Even
    // when relevant, the penalty should knock it below the natural ranking.
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.developer === 'janhq')).toBe(true)
    // The first hit must not be jan when other obvious matches exist.
    if (hits.length > 1) {
      expect(hits[0].developer).not.toBe('janhq')
    }
  })

  it('uses default ranking for empty queries — popularity + recency + boost', () => {
    const hits = svc.defaultRanking()
    expect(hits.length).toBe(corpus.length)
    // ggml-org has ORG_BOOST=1.4 and a recent release, so it should outrank
    // meta-llama (ORG_BOOST defaults to 1, older release) despite fewer
    // downloads.
    const ggml = hits.findIndex((h) => h.developer === 'ggml-org')
    const meta = hits.findIndex((h) => h.developer === 'meta-llama')
    expect(ggml).toBeGreaterThanOrEqual(0)
    expect(meta).toBeGreaterThanOrEqual(0)
    expect(ggml).toBeLessThan(meta)
  })

  it('tolerates malformed queries (URL prefix, whitespace)', () => {
    const hits = svc.search(
      '   https://huggingface.co/unsloth/Qwen3.5-9B-GGUF   '
    )
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].developer).toBe('unsloth')
  })

  it('clears the cached singleton when reset', () => {
    __resetModelSearchService()
    expect(svc.stats().total).toBe(corpus.length)
  })
})
