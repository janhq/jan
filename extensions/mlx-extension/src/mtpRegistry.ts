/**
 * MTP (Multi-Token Prediction) draft model registry.
 *
 * A pure, network-free static manifest mapping base MLX model identifiers to
 * matching MTP drafters. Three drafter families share the single `mtp`
 * `--draft-kind` (mlx-vlm auto-detects the exact head from the drafter's
 * `config.json :: model_type`):
 *   - Gemma 4 "assistant" heads (`mlx-community/gemma-4-*-it-assistant-bf16`,
 *     `model_type: gemma4_assistant`) — https://ai.google.dev/gemma/docs/mtp/mtp.
 *   - Qwen 3.5 / 3.6 MTP heads (`mlx-community/Qwen3.*-MTP-bf16`,
 *     `model_type: qwen3_5_mtp`) — split out of the UDT target weights and
 *     republished as standalone drafter repos by `mlx-community`.
 *   - DeepSeek V4 Flash MTP head (`mlx-community/DeepSeek-V4-Flash-MTP-bf16`,
 *     `model_type: deepseek_v4_mtp`).
 *
 * Mirrors the shape of `dflashRegistry.ts` / `eagle3Registry.ts` so the MLX
 * extension can route every speculative-decoding kind through the same
 * local-first resolution and direct-download path. This module only carries
 * the static lookup data; no `huggingface.co/api/...` calls happen here.
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

  /// Qwen 3.5 / 3.6 MTP heads (`model_type: qwen3_5_mtp`). The drafter is the
  /// MTP module split out of the corresponding UDT target and republished as a
  /// standalone single-file `model.safetensors` + `config.json` repo. Verified
  /// against the `mlx-community` MTP collection. The tokenizer comes from the
  /// target model, so only the two weight/config files are required.
  'qwen3.5-4b': {
    repo: 'mlx-community/Qwen3.5-4B-MTP-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.5-9b': {
    repo: 'mlx-community/Qwen3.5-9B-MTP-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.6-27b': {
    repo: 'mlx-community/Qwen3.6-27B-MTP-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.6-35b-a3b': {
    repo: 'mlx-community/Qwen3.6-35B-A3B-MTP-bf16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },

  /// DeepSeek V4 Flash MTP head (`model_type: deepseek_v4_mtp`). Same
  /// split-and-republish story as the Qwen heads.
  'deepseek-v4-flash': {
    repo: 'mlx-community/DeepSeek-V4-Flash-MTP-bf16',
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
  /// Reverse lookup: caller already passed a fully-qualified drafter id
  /// (Gemma `*-it-assistant-*` or a `*-MTP-*` head) — match against manifest
  /// values rather than running it through `normalizeBaseId` (which would
  /// strip the `-bf16` suffix and try to look it up as a target).
  if (/-assistant(?:-|$)/i.test(modelId) || /-mtp(?:-|$)/i.test(modelId)) {
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

  /// Quantized targets (e.g. `gemma-4-E4B-it-4bit`) are now allowed.
  /// The original block was a precaution against biased strict-equality
  /// verification when the bf16 drafter was paired with a quantized
  /// target — but the mlx-vlm server forces ``temp=0`` in
  /// ``_run_speculative`` (greedy verify), so a quantization mismatch
  /// only reduces acceptance rate (drafter argmax may diverge from
  /// target argmax), it does not corrupt output. The long-prompt SWA
  /// mask bug that previously turned this into "Just/Just/Just" cascades
  /// is fixed upstream by Blaizzy/mlx-vlm#1139 (commit ``2bc33a6``).
  /// ``normalizeBaseId`` strips the quant + ``-it`` suffixes so e.g.
  /// ``gemma-4-E4B-it-4bit`` -> ``gemma-4-e4b`` and resolves to the
  /// same bf16 drafter as the bf16 target.
  const baseId = normalizeBaseId(modelId)
  const manifest = STATIC_MTP_MAP[baseId]
  if (!manifest) return null

  return {
    repo: manifest.repo,
    required: manifest.required,
    optional: manifest.optional ?? [],
  }
}
