/**
 * Model search service -- Google-like local search over the curated
 * Atomic Chat model catalog.
 *
 * The service loads a pre-built MiniSearch snapshot when one is
 * available (`catalog.idx.json` from the catalog repo's GitHub Release).
 * Falling back to on-the-fly indexing keeps search functional when the
 * pre-built index is missing, malformed, or version-mismatched.
 *
 * Ranking pipeline:
 *
 *   1. MiniSearch BM25 multi-field hit (model_name, developer,
 *      tags_normalized, description) -- weighted boosts match the
 *      scraper-side `build_index.mjs` so both code paths produce
 *      comparable scores.
 *   2. Platform-aware ORG_BOOST multiplier (e.g. `mlx-community` is
 *      heavy on macOS, zero on Windows / Linux). This lives in the
 *      client so the cron-generated artifact stays platform-neutral.
 *   3. Popularity weight: `log(1 + downloads / 100)`.
 *   4. Exponential recency decay with a 180-day half-life on
 *      `created_at` (graceful when the field is absent).
 *
 * Field weights / tokenisation MUST stay in sync with
 * `scripts/build_index.mjs` in the `atomic-chat-model-catalog` repo.
 * When the bundle here changes, bump that file too and bump
 * `SUPPORTED_INDEX_VERSION` in `model-catalog-registry.ts`.
 */

import MiniSearch, { type SearchResult } from 'minisearch'
import type { CatalogModel } from '@/services/models/types'

export const SEARCH_INDEX_FIELDS = [
  'model_name',
  'developer',
  'tags_normalized',
  'description',
] as const

export const SEARCH_BOOSTS: Record<(typeof SEARCH_INDEX_FIELDS)[number], number> =
  {
    model_name: 5,
    developer: 3,
    tags_normalized: 2,
    description: 1,
  }

export const SEARCH_STORE_FIELDS = [
  'model_name',
  'developer',
  'downloads',
  'likes',
  'is_mlx',
  'created_at',
  'last_modified',
  'num_quants',
  'num_mmproj',
  'num_safetensors',
] as const

const tokenizeText = (text: string): string[] =>
  String(text)
    .toLowerCase()
    .split(/[\s\-_./:,;()[\]<>+]+/u)
    .filter(Boolean)

const processTerm = (term: string): string | null =>
  term.length < 2 ? null : term.toLowerCase()

const RECENCY_HALF_LIFE_DAYS = 180

const ORG_BOOST: Record<string, number> = {
  bartowski: 1.3,
  unsloth: 1.3,
  mradermacher: 1.2,
  ubergarm: 1.1,
  'lmstudio-community': 0.85,
  MaziyarPanahi: 0.9,
  QuantFactory: 0.8,
  'ggml-org': 1.4,
  // MLX track -- heavy on macOS, suppressed elsewhere. The 0 on non-mac
  // hosts is defense-in-depth: useModelSources already filters mlx
  // models away when `IS_MACOS` is false.
  'mlx-community': IS_MACOS ? 1.5 : 0,
  'prince-canuma': IS_MACOS ? 1.5 : 0.7,
  apple: IS_MACOS ? 1.3 : 1.0,
  'Goekdeniz-Guelmez': IS_MACOS ? 1.2 : 0,
  AtomicChat: 2.0,
  TheBloke: 0.3,
  janhq: 0.5,
}

const recencyDecay = (
  iso: string | undefined,
  halfLifeDays = RECENCY_HALF_LIFE_DAYS
): number => {
  if (!iso) return 1
  const created = Date.parse(iso)
  if (Number.isNaN(created)) return 1
  const ageDays = (Date.now() - created) / 86_400_000
  if (ageDays <= 0) return 1
  return Math.pow(0.5, ageDays / halfLifeDays)
}

const popularityWeight = (downloads: number | undefined): number =>
  Math.log1p((downloads ?? 0) / 100)

type IndexableDocument = {
  id: string
  model_name: string
  developer: string
  tags_normalized: string
  description: string
  downloads: number
  likes: number
  is_mlx: boolean
  created_at: string
  last_modified: string
  num_quants: number
  num_mmproj: number
  num_safetensors: number
}

const toDocument = (model: CatalogModel, index: number): IndexableDocument => ({
  id: model.model_name || `idx-${index}`,
  model_name: model.model_name || '',
  developer: model.developer || '',
  tags_normalized: Array.isArray(
    (model as unknown as { tags_normalized?: unknown }).tags_normalized
  )
    ? ((model as unknown as { tags_normalized: string[] }).tags_normalized).join(
        ' '
      )
    : '',
  description: typeof model.description === 'string' ? model.description : '',
  downloads: Number(model.downloads || 0),
  likes: Number(
    (model as unknown as { likes?: number | string }).likes ?? 0
  ),
  is_mlx: Boolean(model.is_mlx),
  created_at: model.created_at ?? '',
  last_modified:
    (model as unknown as { last_modified?: string }).last_modified ?? '',
  num_quants: Number(model.num_quants ?? 0),
  num_mmproj: Number(model.num_mmproj ?? 0),
  num_safetensors: Number(model.num_safetensors ?? 0),
})

const newMiniSearch = (): MiniSearch<IndexableDocument> =>
  new MiniSearch<IndexableDocument>({
    idField: 'id',
    fields: [...SEARCH_INDEX_FIELDS],
    storeFields: [...SEARCH_STORE_FIELDS],
    searchOptions: {
      boost: SEARCH_BOOSTS,
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'AND',
    },
    tokenize: tokenizeText,
    processTerm,
  })

export type ScoredCatalogModel = CatalogModel & {
  _score: number
  _matches: string[]
}

export type SearchOptions = {
  limit?: number
}

const cleanQuery = (raw: string): string =>
  raw.trim().replace(/^https?:\/\/[^/]+\//, '')

export class ModelSearchService {
  private catalogById: Map<string, CatalogModel> = new Map()
  private miniSearch: MiniSearch<IndexableDocument> | null = null
  private indexVersionLoaded: number | null = null
  private builtFromSnapshot = false

  /**
   * Replace the indexed catalog. Call this whenever the store's catalog
   * changes (typically once per `model-catalog-store` refresh).
   */
  setCatalog(catalog: ReadonlyArray<CatalogModel>): void {
    this.catalogById = new Map(catalog.map((m) => [m.model_name, m]))
    // Invalidate the existing index — `loadSnapshot` or `rebuild` must
    // be called explicitly to (re-)populate it.
    this.miniSearch = null
    this.indexVersionLoaded = null
    this.builtFromSnapshot = false
  }

  /**
   * Hydrate from a pre-built `MiniSearch.toJSON()` snapshot. Returns
   * `true` when the snapshot was usable, `false` otherwise (caller
   * should fall back to `rebuild()`).
   */
  loadSnapshot(payload: {
    minisearch: unknown
    index_version: number
  } | null): boolean {
    if (!payload) return false
    try {
      const configOverrides: Parameters<typeof MiniSearch.loadJSON>[1] = {
        idField: 'id',
        fields: [...SEARCH_INDEX_FIELDS],
        storeFields: [...SEARCH_STORE_FIELDS],
        searchOptions: {
          boost: SEARCH_BOOSTS,
          fuzzy: 0.2,
          prefix: true,
          combineWith: 'AND',
        },
        tokenize: tokenizeText,
        processTerm,
      }
      const serialized =
        typeof payload.minisearch === 'string'
          ? payload.minisearch
          : JSON.stringify(payload.minisearch)
      this.miniSearch = MiniSearch.loadJSON<IndexableDocument>(
        serialized,
        configOverrides as never
      )
      this.indexVersionLoaded = payload.index_version
      this.builtFromSnapshot = true
      return true
    } catch (error) {
      console.warn(
        '[model-search] Failed to load pre-built index snapshot, will rebuild:',
        error instanceof Error ? error.message : error
      )
      this.miniSearch = null
      this.indexVersionLoaded = null
      this.builtFromSnapshot = false
      return false
    }
  }

  /**
   * Build the MiniSearch index from the current catalog. Used as a
   * fallback when the pre-built snapshot is missing or malformed.
   */
  rebuild(): void {
    const docs = Array.from(this.catalogById.values()).map((m, i) =>
      toDocument(m, i)
    )
    const ms = newMiniSearch()
    if (docs.length > 0) ms.addAll(docs)
    this.miniSearch = ms
    this.builtFromSnapshot = false
  }

  /**
   * Returns `true` when the service has a usable index — either loaded
   * from a snapshot or built locally.
   */
  isReady(): boolean {
    return this.miniSearch !== null
  }

  /** Diagnostics surfaced in the Hub UI ("indexed N models from K orgs"). */
  stats(): {
    total: number
    indexVersion: number | null
    builtFromSnapshot: boolean
    orgs: number
  } {
    const orgs = new Set<string>()
    for (const m of this.catalogById.values()) {
      if (m.developer) orgs.add(m.developer)
    }
    return {
      total: this.catalogById.size,
      indexVersion: this.indexVersionLoaded,
      builtFromSnapshot: this.builtFromSnapshot,
      orgs: orgs.size,
    }
  }

  /**
   * Run a full-text query. Empty queries return the default ranking
   * (popularity * recency, top-`limit`). On any MiniSearch failure we
   * fall back to a substring scan so the UI never blanks out.
   */
  search(rawQuery: string, options: SearchOptions = {}): ScoredCatalogModel[] {
    const limit = options.limit ?? 200
    const query = cleanQuery(rawQuery)
    if (!query) return this.defaultRanking(limit)
    if (!this.miniSearch) this.rebuild()
    if (!this.miniSearch) return []

    let hits: SearchResult[]
    try {
      hits = this.miniSearch.search(query, {
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'AND',
        boost: SEARCH_BOOSTS,
      })
    } catch (error) {
      console.warn(
        '[model-search] MiniSearch.search threw, falling back to substring scan:',
        error instanceof Error ? error.message : error
      )
      return this.substringFallback(query, limit)
    }

    const scored: ScoredCatalogModel[] = []
    for (const h of hits) {
      const id = String(h.id)
      const model = this.catalogById.get(id)
      if (!model) continue
      const orgBoost = ORG_BOOST[model.developer ?? ''] ?? 1.0
      if (orgBoost === 0) continue
      const score =
        h.score *
        orgBoost *
        popularityWeight(model.downloads) *
        recencyDecay(model.created_at)
      const matches = Object.keys(h.match ?? {})
      scored.push({ ...model, _score: score, _matches: matches })
    }
    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  }

  /**
   * Ordering used when the query is empty: combined popularity +
   * recency + org-boost ranking. Mirrors the scored path so the
   * "no-query" view feels consistent with results.
   */
  defaultRanking(limit = 200): ScoredCatalogModel[] {
    const scored: ScoredCatalogModel[] = []
    for (const model of this.catalogById.values()) {
      const orgBoost = ORG_BOOST[model.developer ?? ''] ?? 1.0
      if (orgBoost === 0) continue
      const score =
        orgBoost *
        popularityWeight(model.downloads) *
        recencyDecay(model.created_at)
      scored.push({ ...model, _score: score, _matches: [] })
    }
    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  }

  /**
   * Last-resort scan used only when MiniSearch itself fails. Treats the
   * query as a case-insensitive substring against name/developer/tags.
   */
  private substringFallback(query: string, limit: number): ScoredCatalogModel[] {
    const needle = query.toLowerCase()
    const scored: ScoredCatalogModel[] = []
    for (const model of this.catalogById.values()) {
      const haystack = [
        model.model_name,
        model.developer,
        ((model as unknown as { tags_normalized?: string[] }).tags_normalized ?? []).join(
          ' '
        ),
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) continue
      const orgBoost = ORG_BOOST[model.developer ?? ''] ?? 1.0
      if (orgBoost === 0) continue
      const score =
        orgBoost *
        popularityWeight(model.downloads) *
        recencyDecay(model.created_at)
      scored.push({ ...model, _score: score, _matches: ['model_name'] })
    }
    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  }
}

/** Shared singleton — Hub mounts thousands of cards, one index is enough. */
let sharedInstance: ModelSearchService | null = null

export const getModelSearchService = (): ModelSearchService => {
  if (sharedInstance === null) sharedInstance = new ModelSearchService()
  return sharedInstance
}

/**
 * Helper for tests / hot-reload — drop the cached singleton so the next
 * `getModelSearchService` call rebuilds from scratch.
 */
export const __resetModelSearchService = (): void => {
  sharedInstance = null
}
