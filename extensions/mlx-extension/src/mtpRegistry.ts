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

/// Lossy quantization suffixes that disqualify a target from MTP. The
/// upstream MTP drafter is tightly coupled to the target's KV/embed
/// distributions (see `mlx_vlm/speculative/drafters/gemma4_assistant/
/// README.md::Supported pairings` — the table lists only `*-bf16`
/// targets) and the bf16 drafter on a quantized target produces biased
/// strict-equality verification at temperature > 0, collapsing the
/// chat output to a litany of high-prob tokens.
///
/// Match is case-insensitive on the canonical MLX naming used by
/// `mlx-community` (e.g. `-4bit`, `-8bit`, `-q4`, `-q8`, `-fp8`,
/// `-mxfp4`). The DFlash registry intentionally stays open: forced
/// `temp=0` on the mlx-vlm server keeps DFlash output lossless even on
/// quantized targets.
const LOSSY_QUANT_SUFFIX_RE =
  /-(?:[248]bit|q[248]|fp8|mxfp4|nf4|awq|gptq|int4|int8)(?:[-./]|$)/i

function isQuantizedTarget(modelId: string): boolean {
  return LOSSY_QUANT_SUFFIX_RE.test(modelId)
}

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

  /// MTP README's `Supported pairings` table only lists `*-bf16`
  /// targets. Quantized targets (4bit/8bit/fp8/...) break the
  /// drafter's KV-cache sharing + shared embed assumptions and
  /// degenerate the chat output. Reject them here so the toggle stays
  /// off and the user sees the standard `mtpUnsupported*` toast.
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
