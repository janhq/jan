/**
 * MTP (Multi-Token Prediction) draft model registry.
 *
 * A pure, network-free static manifest mapping base MLX model identifiers to
 * the matching `mlx-community/gemma-4-*-it-assistant-bf16` drafters from
 * Google's Gemma 4 MTP collection. Reference:
 * https://ai.google.dev/gemma/docs/mtp/mtp.
 *
 * Mirrors the shape of `dflashRegistry.ts` so the MLX extension can route
 * both speculative-decoding kinds through the same local-first resolution
 * and direct-download path. This module only carries the static lookup
 * data; no `huggingface.co/api/...` calls happen here.
 */
import {
  type DraftRepoManifest,
  type DraftResolution,
  isQuantizedTarget,
  normalizeBaseId,
} from './dflashRegistry'

/// Gemma 4 assistant drafters published by `mlx-community` ship as a
/// single-file `model.safetensors` plus `config.json`. Sharded layouts
/// (rare for the 4-layer assistant) need a per-repo override.
const DEFAULT_REQUIRED = ['config.json', 'model.safetensors']

/// `model.safetensors.index.json` is grabbed best-effort so sharded
/// drafters keep working through the local-first path; absence is not
/// fatal.
const DEFAULT_OPTIONAL: string[] = ['model.safetensors.index.json']

/// Snapshot of the four canonical Gemma 4 target ↔ assistant pairings
/// from `mlx_vlm/speculative/drafters/gemma4_assistant/README.md`.
///
/// Keys are normalized base-model ids (lowercase, separators preserved as
/// `-`) derived via `normalizeBaseId`. The trailing `-it` is stripped by
/// `TRAIL_HINT_RE` in `dflashRegistry.ts`, so the keys here are
/// `gemma-4-{e2b,e4b,26b-a4b,31b}` without the `-it` suffix.
export const STATIC_MTP_MAP: Record<string, DraftRepoManifest> = {
  'gemma-4-e2b': {
    repo: 'mlx-community/gemma-4-E2B-it-assistant-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'gemma-4-e4b': {
    repo: 'mlx-community/gemma-4-E4B-it-assistant-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'gemma-4-26b-a4b': {
    repo: 'mlx-community/gemma-4-26B-A4B-it-assistant-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'gemma-4-31b': {
    repo: 'mlx-community/gemma-4-31B-it-assistant-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
}

/**
 * Resolve a Gemma 4 MTP assistant repo for the given base model.
 *
 * Pure / synchronous — relies solely on `STATIC_MTP_MAP` and never touches
 * the network. Returns `null` when the base model has no canonical MTP
 * pairing.
 */
export function resolveMtpDraft(modelId: string): DraftResolution | null {
  /// Reverse lookup: caller already passed a fully-qualified
  /// `mlx-community/gemma-4-*-it-assistant-*` id — match against manifest
  /// values rather than running it through `normalizeBaseId` (which would
  /// strip the `-bf16` suffix and try to look it up as a target).
  if (/-assistant(?:-|$)/i.test(modelId)) {
    const target = modelId.toLowerCase()
    for (const manifest of Object.values(STATIC_MTP_MAP)) {
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

  /// Forward path: the published Gemma 4 assistant drafters are bf16,
  /// and their `pre_projection` / `post_projection` / `MaskedEmbedder`
  /// were calibrated against the bf16 backbone hidden-state distribution.
  /// Pairing them with a 4bit/8bit Gemma 4 target shifts that
  /// distribution, breaks mlx-vlm's strict-equality speculative
  /// verification at non-zero temperature, and the model degenerates
  /// into low-entropy loops. Refuse the pairing here so the toggle
  /// surfaces `MtpUnsupportedDialog` instead of producing garbage.
  if (isQuantizedTarget(modelId)) return null

  const baseId = normalizeBaseId(modelId)
  const manifest = STATIC_MTP_MAP[baseId]
  if (!manifest) return null

  return {
    repo: manifest.repo,
    required: manifest.required,
    optional: manifest.optional ?? [],
  }
}
