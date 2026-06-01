import type { CatalogModel } from '@/services/models/types'

/**
 * Helpers for the Hub model card (v12). Hugging Face has no "capabilities"
 * field, so badges are derived from pipeline/tags signals available on the
 * catalog entry. Hardware fit is estimated from the quant size vs the user's
 * memory budget (HF computes the same thing client-side).
 */

export type HardwareFit = 'ok' | 'maybe' | 'no'

/** Card summary label + hover tooltip, wording taken from Hugging Face. */
export const HARDWARE_FIT: Record<
  HardwareFit,
  { label: string; tip: string }
> = {
  ok: {
    label: 'Recommended',
    tip: 'This model is likely to run on your hardware',
  },
  maybe: {
    label: 'Heavy for your device',
    tip: 'This model can probably run on your hardware',
  },
  no: {
    label: 'Not enough memory',
    tip: 'This model is probably too large for your hardware',
  },
}

const SIZE_UNIT_BYTES: Record<string, number> = {
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
}

/** Parse catalog file-size strings like "5.3 GB" / "412 MB" into bytes. */
export function parseFileSizeToBytes(fileSize?: string): number | undefined {
  if (!fileSize) return undefined
  const match = fileSize.trim().match(/^([\d.]+)\s*(KB|MB|GB|TB)$/i)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  return value * SIZE_UNIT_BYTES[match[2].toUpperCase()]
}

/** Full download count with thin-space grouping, e.g. 1163988 -> "1 163 988". */
export function formatDownloads(n?: number): string {
  if (!n || n <= 0) return '0'
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
}

/** Best-effort parameter count from the model name, e.g. "...-80B..." -> "80B". */
export function deriveParams(model: CatalogModel): string | undefined {
  const match = model.model_name.match(/(\d+(?:\.\d+)?)\s*[xX]?\s*B\b/)
  return match ? `${match[1]}B` : undefined
}

/** Best-effort context window from the model name, e.g. "256K" / "1M". */
export function deriveContext(model: CatalogModel): string | undefined {
  const match = model.model_name.match(/\b(\d+(?:\.\d+)?)\s*([KM])\b/)
  if (!match) return undefined
  return `${match[1]}${match[2].toUpperCase()}`
}

/** Format a raw parameter count (e.g. 7615616512) into "7.6B" / "671B" / "350M". */
export function formatParamCount(total?: number): string | undefined {
  if (!total || total <= 0) return undefined
  if (total >= 1e9) {
    const b = total / 1e9
    return `${b >= 100 ? Math.round(b) : Number(b.toFixed(1))}B`
  }
  if (total >= 1e6) return `${Math.round(total / 1e6)}M`
  return undefined
}

/** Format a context length in tokens (e.g. 262144) into "256K" / "1M". */
export function formatContextLength(tokens?: number): string | undefined {
  if (!tokens || tokens <= 0) return undefined
  const k = tokens / 1024
  if (k >= 1000) return `${Number((k / 1024).toFixed(1)).toString().replace(/\.0$/, '')}M`
  return `${Math.round(k)}K`
}

export type ModelStats = { params?: string; context?: string }

const modelStatsCache = new Map<string, ModelStats>()

/**
 * Fetch real params/context from the Hugging Face model API:
 *   params  ← safetensors.total | gguf.total
 *   context ← gguf.context_length | config.max_position_embeddings
 * Falls back to the repo config.json for context when the API omits it
 * (typical for safetensors/MLX repos). Cached per model id.
 */
export async function fetchModelStats(modelId: string): Promise<ModelStats> {
  if (modelStatsCache.has(modelId)) return modelStatsCache.get(modelId) as ModelStats
  const stats: ModelStats = {}
  try {
    const res = await fetch(`https://huggingface.co/api/models/${modelId}`)
    if (res.ok) {
      const d = await res.json()
      const total: number | undefined = d?.safetensors?.total ?? d?.gguf?.total
      stats.params = formatParamCount(total)
      const ctx: number | undefined =
        d?.gguf?.context_length ??
        d?.config?.max_position_embeddings ??
        d?.config?.text_config?.max_position_embeddings
      stats.context = formatContextLength(ctx)
    }
  } catch {
    // ignore — try config.json below / fall back to name heuristics
  }

  if (!stats.context) {
    try {
      const cfgRes = await fetch(
        `https://huggingface.co/${modelId}/resolve/main/config.json`
      )
      if (cfgRes.ok) {
        const cfg = await cfgRes.json()
        const ctx: number | undefined =
          cfg?.max_position_embeddings ??
          cfg?.text_config?.max_position_embeddings
        stats.context = formatContextLength(ctx)
      }
    } catch {
      // ignore
    }
  }

  modelStatsCache.set(modelId, stats)
  return stats
}

/**
 * Extract a human one-line summary from raw README/markdown: strips YAML front
 * matter, images, HTML, markdown syntax, and skips raw "tags:"/"license:"
 * metadata lines, then returns the first real paragraph collapsed to one line.
 */
export function cleanFirstParagraph(raw: string): string {
  if (!raw) return ''
  const text = raw
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)

  const first =
    lines.find(
      (l) =>
        l.length > 20 &&
        !/^(tags|license|base_?model|pipeline|datasets?|language)\b/i.test(l)
    ) ??
    lines[0] ??
    ''

  return first.replace(/\s+/g, ' ').trim()
}

/** True for a bare URL (e.g. the README link some catalog rows store). */
export function isUrlLike(s?: string): boolean {
  return !!s && /^https?:\/\/\S+$/i.test(s.trim())
}

/**
 * A human one-line description from the data already on the catalog entry.
 * Returns '' when only a README URL / nothing usable is present, signalling
 * the caller to fetch the actual README.
 */
export function cardDescription(model: CatalogModel): string {
  const text = cleanFirstParagraph(model.readme || model.description || '')
  return isUrlLike(text) ? '' : text
}

const readmeDescriptionCache = new Map<string, string>()

/**
 * Fetch the model README and return its first human paragraph. Cached per
 * model id so each repo is fetched at most once per session.
 */
export async function fetchReadmeDescription(modelId: string): Promise<string> {
  if (readmeDescriptionCache.has(modelId)) {
    return readmeDescriptionCache.get(modelId) ?? ''
  }
  try {
    const res = await fetch(
      `https://huggingface.co/${modelId}/resolve/main/README.md`
    )
    if (res.ok) {
      const text = cleanFirstParagraph(await res.text())
      readmeDescriptionCache.set(modelId, text)
      return text
    }
  } catch {
    // network/parse error — fall back to empty
  }
  readmeDescriptionCache.set(modelId, '')
  return ''
}

export type ModelFormat = 'mlx' | 'gguf'

export function modelFormat(model: CatalogModel): ModelFormat {
  if (model.is_mlx || model.library_name?.toLowerCase() === 'mlx') return 'mlx'
  return 'gguf'
}

export type Capability = {
  label: 'Vision' | 'Tool Use' | 'Reasoning' | 'Audio'
  className: string
}

//* Палитра как у RecommendedModelChip: border + светлый фон/тёмный текст в
//* light и translucent тёмный фон/светлый текст в dark — так бейджи остаются
//* выразительными на тёмной теме (а не блёклыми bg-*-100). Цвет каждой
//* способности сохранён (amber/blue/fuchsia/teal).
const CAP_COLORS = {
  vision:
    'border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-200',
  tool: 'border border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/45 dark:text-blue-200',
  reasoning:
    'border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900 dark:border-fuchsia-800 dark:bg-fuchsia-950/45 dark:text-fuchsia-200',
  audio:
    'border border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/45 dark:text-teal-200',
} as const

/**
 * Canonical capability badges (no synonyms) derived from the signals the
 * catalog entry exposes: mmproj presence, the `tools` flag, plus keyword hints
 * in the name/description/library for reasoning and audio.
 */
export function deriveCapabilities(model: CatalogModel): Capability[] {
  const hay =
    `${model.model_name} ${model.description ?? ''} ${model.library_name ?? ''}`.toLowerCase()
  const caps: Capability[] = []

  if ((model.num_mmproj ?? 0) > 0 || /image-text-to-text|vision|multimodal|-vl\b/.test(hay)) {
    caps.push({ label: 'Vision', className: CAP_COLORS.vision })
  }
  if (model.tools || /function[- ]?calling|tool[- ]?use|\btools\b/.test(hay)) {
    caps.push({ label: 'Tool Use', className: CAP_COLORS.tool })
  }
  if (/reasoning|thinking|chain[- ]of[- ]thought|\br1\b/.test(hay)) {
    caps.push({ label: 'Reasoning', className: CAP_COLORS.reasoning })
  }
  if (/audio-text-to-text|\baudio\b|speech/.test(hay)) {
    caps.push({ label: 'Audio', className: CAP_COLORS.audio })
  }
  return caps
}

/**
 * Quantization label shown as the mono "quant badge" in a variant row.
 *
 * `ModelQuant.model_id` is the full HF repo id for GGUF
 * (e.g. `mradermacher/Solon_Athens_v2_i1-IQ1_M`) but already a short token for
 * MLX (e.g. `4bit`). We surface only the quant scheme — the precision the file
 * was quantized to — never the whole repo path:
 *   GGUF:  IQ1_M, IQ2_XXS, Q4_K_M, Q6_K, Q8_0, F16 …
 *   MLX:   4BIT, 6BIT, 8BIT
 */
export function quantLabel(modelId: string): string {
  const seg = modelId.split('/').pop() ?? modelId
  // MLX: trailing "<n>bit"
  const bit = seg.match(/(\d+)\s*bit$/i)
  if (bit) return `${bit[1]}BIT`
  // GGUF: trailing quant token after a separator
  const gguf = seg.match(/[-_.]((?:I?Q\d[0-9A-Za-z_]*)|BF16|F16|F32)$/i)
  if (gguf) return gguf[1].toUpperCase()
  // Fallback: last separator-delimited segment
  return (seg.split(/[-_.]/).pop() ?? seg).toUpperCase()
}

/**
 * Usable memory budget in bytes. `total_memory` and GPU `total_memory` are
 * reported in MB (see `formatMegaBytes`). We take the larger of system RAM and
 * total VRAM to avoid double-counting Apple unified memory.
 */
export function getMemoryBudgetBytes(hw: {
  total_memory?: number
  gpus?: Array<{ total_memory?: number }>
}): number {
  const ramMB = hw.total_memory ?? 0
  const gpuMB = (hw.gpus ?? []).reduce((sum, g) => sum + (g.total_memory ?? 0), 0)
  return Math.max(ramMB, gpuMB) * SIZE_UNIT_BYTES.MB
}

/**
 * 3-level hardware fit, matching Hugging Face's traffic-light model. Unknown
 * size/budget is treated as "maybe" rather than blocking the user.
 */
export function estimateFit(
  sizeBytes?: number,
  budgetBytes?: number
): HardwareFit {
  if (!budgetBytes || !sizeBytes) return 'maybe'
  if (sizeBytes <= budgetBytes * 0.7) return 'ok'
  if (sizeBytes <= budgetBytes) return 'maybe'
  return 'no'
}
