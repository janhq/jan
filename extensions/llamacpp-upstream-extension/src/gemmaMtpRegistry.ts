/**
 * @file Static registry mapping a Gemma 4 MTP *target* model to the separate
 * MTP *draft* head GGUF it needs for upstream llama.cpp speculative decoding
 * (`--model-draft <head> --spec-type draft-mtp`, PR ggml-org/llama.cpp#23398,
 * first tagged release `b9553`).
 *
 * Unlike Qwen 3.6 (where the MTP head lives *inside* the same GGUF and no
 * `--model-draft` is passed), Gemma 4 ships the head as a second, small GGUF
 * that must be downloaded next to the target model (the same way `mmproj`
 * files are handled).
 *
 * Upstream MTP support covers ONLY Gemma 4 **31B** (dense) and **26B-A4B**
 * (MoE). E2B/E4B drafters were deferred upstream to a follow-up and are not
 * supported here; 12B has no MTP head.
 *
 * Head files were verified against the live Hugging Face API (sha256 + size
 * pinned so the downloader validates them):
 *   - 31B     → am17an/Gemma4-31B-it-GGUF (the PR author's reference head).
 *   - 26B-A4B → AtomicChat/gemma-4-26B-A4B-it-assistant-GGUF (first-party;
 *               am17an published no 26B repo, this head is model-identical to
 *               the upstream reference and guaranteed-stable as our own org).
 */

export interface GemmaMtpDraft {
  /** Hugging Face repo id that hosts the MTP draft head GGUF. */
  repo: string
  /** Exact filename of the draft head inside the repo. */
  draftFilename: string
  /** Pinned sha256 of the head file (lowercase hex) for download validation. */
  draftSha256: string
  /** Pinned byte size of the head file for download validation. */
  draftSize: number
}

interface GemmaMtpRegistryEntry extends GemmaMtpDraft {
  /**
   * Predicate over a normalized (lowercased) model id that decides whether the
   * id refers to this target family. Kept deliberately strict so unrelated
   * Gemma sizes (12B / E2B / E4B) never resolve a head.
   */
  matches: (normalizedId: string) => boolean
}

const REGISTRY: readonly GemmaMtpRegistryEntry[] = [
  {
    // Gemma 4 31B (dense). e.g. unsloth/gemma-4-31B-it-GGUF, gemma-4-31B-it-Q4_K_M
    matches: (id) => id.includes('gemma') && id.includes('4') && id.includes('31b'),
    repo: 'am17an/Gemma4-31B-it-GGUF',
    draftFilename: 'mtp-gemma-4-31B-it.gguf',
    draftSha256:
      '9514a3a9a5f36971580c83212f59ee681a5b9a09d597a6d14e40ecd12f76e8b9',
    draftSize: 514687200,
  },
  {
    // Gemma 4 26B-A4B (MoE). Require both "26b" and "a4b" so only the MoE
    // matches. MTP gains on MoE may be marginal — that is expected.
    matches: (id) =>
      id.includes('gemma') &&
      id.includes('4') &&
      id.includes('26b') &&
      id.includes('a4b'),
    repo: 'AtomicChat/gemma-4-26B-A4B-it-assistant-GGUF',
    draftFilename: 'gemma-4-26B-A4B-it-assistant.Q8_0.gguf',
    draftSha256:
      '0ff5e851eb69aba552efb7cc5da0b37801b42554b403f8584e0b83b92296f69d',
    draftSize: 461767072,
  },
]

function normalizeId(modelId: string): string {
  return modelId.toLowerCase()
}

/**
 * Resolve the MTP draft head for a Gemma 4 target model id, or `null` if the
 * model is not a Gemma 4 MTP-capable target (31B / 26B-A4B).
 */
export function resolveGemmaMtpDraft(modelId: string): GemmaMtpDraft | null {
  const normalized = normalizeId(modelId)
  const entry = REGISTRY.find((e) => e.matches(normalized))
  if (!entry) return null
  return {
    repo: entry.repo,
    draftFilename: entry.draftFilename,
    draftSha256: entry.draftSha256,
    draftSize: entry.draftSize,
  }
}

/** Whether the given model id is a Gemma 4 MTP-capable target. */
export function checkGemmaMtpSupport(modelId: string): boolean {
  return resolveGemmaMtpDraft(modelId) !== null
}

/** Build the Hugging Face resolve URL for a draft head. */
export function gemmaMtpDraftUrl(draft: GemmaMtpDraft): string {
  return `https://huggingface.co/${draft.repo}/resolve/main/${draft.draftFilename}`
}
