/**
 * Hub search ranking helpers.
 *
 * Fuse.js scores fuzzy relevance but does not guarantee that an exact model id
 * (e.g. `unsloth/gemma-4-26B-A4B-it-qat-GGUF`) lands first. Re-rank after Fuse
 * so exact / near-exact ids bubble to the top while preserving relative order.
 */

export type RankableCatalogModel = {
  model_name: string
  developer?: string
  quants?: Array<{ model_id: string }>
}

/** Strip a leading Hugging Face (or other) host prefix from a pasted URL. */
export function cleanHubSearchQuery(raw: string): string {
  return raw.replace(/^https?:\/\/[^/]+\//, '').trim()
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Lower rank = higher priority.
 * 0: exact model id / developer+name
 * 1: exact quant / variant id
 * 2: prefix / suffix near-exact
 * 3: everything else (keep Fuse order)
 */
function exactnessRank(model: RankableCatalogModel, query: string): number {
  const name = normalize(model.model_name || '')
  const developer = normalize(model.developer || '')
  // model_name may already be `author/repo`
  const full =
    name.includes('/')
      ? name
      : developer
        ? `${developer}/${name}`
        : name

  if (name === query || full === query) return 0

  if (model.quants?.some((q) => normalize(q.model_id) === query)) return 1

  if (
    full.startsWith(query) ||
    name.startsWith(query) ||
    query.startsWith(full) ||
    query.startsWith(name)
  ) {
    return 2
  }

  return 3
}

/**
 * Stable re-rank: exact matches first, original relative order otherwise.
 */
export function prioritizeExactModelMatches<T extends RankableCatalogModel>(
  models: T[],
  rawQuery: string
): T[] {
  const query = normalize(cleanHubSearchQuery(rawQuery))
  if (!query || models.length <= 1) return models

  return models
    .map((model, index) => ({
      model,
      index,
      rank: exactnessRank(model, query),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ model }) => model)
}
