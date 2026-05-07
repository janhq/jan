/**
 * DFlash draft model registry.
 *
 * A pure, network-free static manifest mapping base MLX model identifiers to
 * matching `z-lab/*-DFlash*` draft repos from the curated collection at
 * https://huggingface.co/collections/z-lab/dflash.
 *
 * The MLX extension is responsible for the local-first resolution and direct
 * `/resolve/main/<file>` downloads — this module only carries the static
 * lookup data so the toggle path never touches `huggingface.co/api/...`.
 */

export interface DraftRepoManifest {
  /// Fully-qualified HF repo id, e.g. `z-lab/Qwen3.5-4B-DFlash`.
  repo: string
  /// Files that MUST be present for the draft directory to be usable.
  /// Missing required files trigger a download, and a 404 on any of these
  /// during download is a hard error.
  required: string[]
  /// Files that should be downloaded when present but whose absence is not
  /// fatal (404 is swallowed).
  optional?: string[]
}

export interface DraftResolution {
  repo: string
  required: string[]
  optional: string[]
}

/// `dflash.model_mlx.load_draft` (in the dflash package) only reads
/// `config.json` and any `*.safetensors` from the draft directory; tokenizer
/// files belong to the *target* model. Most `z-lab/*` drafts ship as a single
/// `model.safetensors`, so we only require those two files. Sharded drafts
/// (rare; e.g. >2B params) need a per-repo override.
const DEFAULT_REQUIRED = ['config.json', 'model.safetensors']

/// Currently unused — kept so per-repo overrides can opt in to additional
/// downloads (e.g. `model.safetensors.index.json` + shards) without
/// changing the type shape.
const DEFAULT_OPTIONAL: string[] = []

/// Snapshot of https://huggingface.co/collections/z-lab/dflash.
///
/// Keys are normalized base-model ids (lowercase, separators preserved as
/// `-`) derived via `normalizeBaseId`. Values describe the matching draft
/// repo and the file set that needs to be present locally.
export const STATIC_DRAFT_MAP: Record<string, DraftRepoManifest> = {
  'qwen3.5-122b-a10b': {
    repo: 'z-lab/Qwen3.5-122B-A10B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.6-35b-a3b': {
    repo: 'z-lab/Qwen3.6-35B-A3B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'kimi-k2.5': {
    repo: 'z-lab/Kimi-K2.5-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.5-4b': {
    repo: 'z-lab/Qwen3.5-4B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.5-9b': {
    repo: 'z-lab/Qwen3.5-9B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.5-35b-a3b': {
    repo: 'z-lab/Qwen3.5-35B-A3B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3.5-27b': {
    repo: 'z-lab/Qwen3.5-27B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3-coder-next': {
    repo: 'z-lab/Qwen3-Coder-Next-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'gpt-oss-20b': {
    repo: 'z-lab/gpt-oss-20b-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'gpt-oss-120b': {
    repo: 'z-lab/gpt-oss-120b-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3-4b': {
    repo: 'z-lab/Qwen3-4B-DFlash-b16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3-8b': {
    repo: 'z-lab/Qwen3-8B-DFlash-b16',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'qwen3-coder-30b-a3b': {
    repo: 'z-lab/Qwen3-Coder-30B-A3B-DFlash',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'llama3.1-8b-instruct': {
    repo: 'z-lab/LLaMA3.1-8B-Instruct-DFlash-UltraChat',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'llama-3.1-8b-instruct': {
    repo: 'z-lab/LLaMA3.1-8B-Instruct-DFlash-UltraChat',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
  'meta-llama-3.1-8b-instruct': {
    repo: 'z-lab/LLaMA3.1-8B-Instruct-DFlash-UltraChat',
    required: DEFAULT_REQUIRED,
    optional: DEFAULT_OPTIONAL,
  },
}

/// Quantization / format suffixes that should be stripped from a model id
/// before attempting registry lookup. Order matters: longer first.
const QUANT_SUFFIX_RE =
  /-(?:4bit|8bit|6bit|5bit|3bit|2bit|q4_k_m|q4_k_s|q5_k_m|q5_k_s|q6_k|q8_0|fp16|bf16|fp8|mlx)(?:-[a-z0-9]+)?$/i

/// Trailing dimensionality / dataset hints that occasionally appear in MLX
/// repo names (e.g. `-128k`, `-it`, `-chat`). Stripped after quant suffixes.
const TRAIL_HINT_RE = /-(?:it|chat|128k|256k|1m|hf|base)$/i

/// "Lossy" quantization markers — anything that is NOT a native bf16/fp16/
/// fp32 representation. The published DFlash and MTP drafters in our
/// registries are trained against bf16 targets; pairing them with a
/// quantized target shifts the hidden-state distribution the drafter was
/// calibrated on. mlx-vlm's strict-equality speculative verification is
/// only lossless at temperature 0 — at chat-default temperatures the
/// distribution mismatch can drive the model into degenerate loops
/// (observed: `<|channel>thought` repetition on quantized Gemma 4).
///
/// Matches the suffix anywhere a quant tag is plausibly tacked on:
///   * end of string  — `gemma-4-E4B-it-4bit`
///   * before another suffix — `gemma-4-E4B-it-4bit-mlx`
///   * underscore separator — sometimes used in HF repo names.
const LOSSY_QUANT_SUFFIX_RE =
  /-(?:[2-8]bit|q[2-8]_k(?:_[ms])?|q[28]_0|fp8)(?:[-_]|$)/i

/**
 * Whether the given target model id carries a lossy-quantization marker
 * (`-4bit`, `-8bit`, `-q4_k_m`, `-q8_0`, `-fp8`, ...).
 *
 * Returns `false` for `-bf16`, `-fp16`, `-fp32`, `-mlx`, and unmarked
 * ids (assumed bf16). Speculative-decoding drafters in this codebase
 * require precision parity with the target; this helper is the gate.
 */
export function isQuantizedTarget(modelId: string): boolean {
  return LOSSY_QUANT_SUFFIX_RE.test(modelId)
}

/**
 * Normalize an arbitrary MLX model id into the registry-key form.
 *
 *   "mlx-community/Qwen3-4B-4bit" -> "qwen3-4b"
 *   "Qwen3.5-9B-mlx-bf16"         -> "qwen3.5-9b"
 *   "gpt-oss-20b"                 -> "gpt-oss-20b"
 */
export function normalizeBaseId(modelId: string): string {
  let id = modelId.trim()

  const slashIdx = id.lastIndexOf('/')
  if (slashIdx !== -1) {
    id = id.slice(slashIdx + 1)
  }

  id = id.toLowerCase()

  for (let i = 0; i < 3; i++) {
    const next = id.replace(QUANT_SUFFIX_RE, '').replace(TRAIL_HINT_RE, '')
    if (next === id) break
    id = next
  }

  return id
}

/**
 * Resolve a DFlash draft repo for the given base model.
 *
 * Pure / synchronous — relies solely on `STATIC_DRAFT_MAP` and never touches
 * the network. Returns `null` when the base model is not in the curated
 * z-lab collection.
 */
export function resolveDflashDraft(modelId: string): DraftResolution | null {
  /// If the caller already passed a fully-qualified `z-lab/<repo>` id, do a
  /// reverse lookup against the map values so we still pull the correct
  /// manifest (and not whatever `normalizeBaseId` would mangle it into).
  if (/^z-lab\//i.test(modelId)) {
    const target = modelId.toLowerCase()
    for (const manifest of Object.values(STATIC_DRAFT_MAP)) {
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

  /// Forward path: the published z-lab DFlash drafters are bf16, and
  /// mlx-vlm's strict-equality verification is only lossless at temp 0.
  /// Pairing a bf16 drafter with a 4bit/8bit target produces gibberish
  /// at chat-default temperatures — refuse the pairing here.
  if (isQuantizedTarget(modelId)) return null

  const baseId = normalizeBaseId(modelId)
  const manifest = STATIC_DRAFT_MAP[baseId]
  if (!manifest) return null

  return {
    repo: manifest.repo,
    required: manifest.required,
    optional: manifest.optional ?? [],
  }
}
