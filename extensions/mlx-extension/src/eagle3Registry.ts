/**
 * EAGLE-3 draft model registry.
 *
 * A pure, network-free static manifest mapping base MLX model identifiers to
 * the matching `RedHatAI/*-speculator.eagle3` draft checkpoints (Speculators /
 * SGLang EAGLE-3 format), which `mlx_vlm`'s `eagle3` drafter loads directly.
 *
 * Mirrors the shape of `dflashRegistry.ts` / `mtpRegistry.ts` so the MLX
 * extension routes all three speculative-decoding kinds through the same
 * local-first resolution and direct `/resolve/main/<file>` download path. This
 * module only carries the static lookup data; no `huggingface.co/api/...`
 * calls happen here.
 */
import {
  type DraftRepoManifest,
  type DraftResolution,
  normalizeBaseId,
} from './dflashRegistry'

/// Speculators EAGLE-3 checkpoints ship a single-file `model.safetensors`
/// plus a `config.json` (a sibling `config.py` carries the upstream loader
/// shim and is NOT needed by mlx-vlm's own `Eagle3Config`). Tokenizer files
/// belong to the target model.
const DEFAULT_REQUIRED = ['config.json', 'model.safetensors']

/// `model.safetensors.index.json` is grabbed best-effort so a future sharded
/// EAGLE-3 head keeps working through the local-first path; absence is not
/// fatal.
const DEFAULT_OPTIONAL: string[] = ['model.safetensors.index.json']

/// Snapshot of the canonical Gemma 4 EAGLE-3 speculators published by
/// `RedHatAI`. Only the two large Gemma 4 targets have an EAGLE-3 head; the
/// E2B / E4B targets use the Gemma 4 MTP "assistant" drafter instead (see
/// `mtpRegistry.ts`).
///
/// Keys are normalized base-model ids (lowercase, separators preserved as
/// `-`) derived via `normalizeBaseId`. The trailing `-it` is stripped by
/// `TRAIL_HINT_RE` in `dflashRegistry.ts`, so the keys here are
/// `gemma-4-{31b,26b-a4b}` without the `-it` suffix.
export const STATIC_EAGLE3_MAP: Record<string, DraftRepoManifest> = {
  'gemma-4-31b': {
    repo: 'RedHatAI/gemma-4-31B-it-speculator.eagle3',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'gemma-4-26b-a4b': {
    repo: 'RedHatAI/gemma-4-26B-A4B-it-speculator.eagle3',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
}

/**
 * Resolve an EAGLE-3 draft repo for the given base model.
 *
 * Pure / synchronous — relies solely on `STATIC_EAGLE3_MAP` and never touches
 * the network. Returns `null` when the base model has no canonical EAGLE-3
 * pairing.
 */
export function resolveEagle3Draft(modelId: string): DraftResolution | null {
  /// Reverse lookup: caller already passed a fully-qualified
  /// `*-speculator.eagle3` id — match against manifest values rather than
  /// running it through `normalizeBaseId` (which would mangle the
  /// `-speculator.eagle3` suffix).
  if (/\.eagle3(?:-|$)/i.test(modelId) || /^redhatai\//i.test(modelId)) {
    const target = modelId.toLowerCase()
    for (const manifest of Object.values(STATIC_EAGLE3_MAP)) {
      if (manifest.repo.toLowerCase() === target) {
        return {
          repo: manifest.repo,
          required: manifest.required,
          optional: manifest.optional ?? [],
        }
      }
    }
    return null
  }

  const baseId = normalizeBaseId(modelId)
  const manifest = STATIC_EAGLE3_MAP[baseId]
  if (!manifest) return null

  return {
    repo: manifest.repo,
    required: manifest.required,
    optional: manifest.optional ?? [],
  }
}
