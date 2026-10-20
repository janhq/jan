import type { ModelQuant } from '@/services/models/types'

// llama.cpp ships some models with a companion "draft" gguf for speculative
// decoding, passed as `--spec-draft-model` with a matching `--spec-type`. Four
// flavours exist (common/speculative.cpp): multi-token prediction, Eagle3,
// DFlash, and DSpark (DFlash plus a Markov head). Upstream publishes them as
// siblings named with an `mtp-` / `eagle3-` / `dflash-` / `dspark-` prefix and
// excludes all four from its own "is this a model?" test
// (common/download.cpp: gguf_filename_is_model); in the Jan catalog they are
// mixed into the main model's quant list, sometimes under an `MTP/` model_id.
// They are NOT standalone models -- each pairs with a real quant as its draft.

/** The `--spec-type` value a sidecar implies, minus the `draft-` prefix. */
export type SpecKind = 'mtp' | 'eagle3' | 'dflash' | 'dspark'

/**
 * Checked in this order, mirroring how upstream resolves a repo that ships
 * several (common/arg.cpp: MTP first, then DSpark, which outranks DFlash
 * because its sidecar carries the extra Markov head, then Eagle3).
 */
const SPEC_KINDS: SpecKind[] = ['mtp', 'dspark', 'dflash', 'eagle3']

const basename = (pathOrId: string): string => {
  const file = pathOrId.split('/').pop() ?? pathOrId
  return file.replace(/\.gguf$/i, '')
}

// The kind marks the file when it stands alone as a token: dflash-foo,
// foo-dflash, foo-DFlash.
const kindToken = (kind: SpecKind): RegExp =>
  new RegExp(`(^|[-_.])${kind}([-_.]|$)`, 'i')

const QUANT_TOKEN =
  /(iq\d+_\w+|q\d+_k(_\w+)?|q\d+_\d+|q\d+|bf16|fp16|f16|f32|mxfp4(_moe)?|mxfp8|nvfp4|fp8)/gi

/** Which speculative draft a quant is, or undefined for a real model. */
export function specSidecarKind(
  quant: Pick<ModelQuant, 'model_id' | 'path'>
): SpecKind | undefined {
  const id = basename(quant.model_id)
  const file = basename(quant.path)
  for (const kind of SPEC_KINDS) {
    // `MTP/foo` and friends: the catalog groups sidecars under a kind prefix
    // on the model_id, which survives no token boundary once basename'd.
    if (new RegExp(`^${kind}/`, 'i').test(quant.model_id)) return kind
    const token = kindToken(kind)
    if (token.test(id) || token.test(file)) return kind
  }
  return undefined
}

export function isSpecSidecar(
  quant: Pick<ModelQuant, 'model_id' | 'path'>
): boolean {
  return specSidecarKind(quant) !== undefined
}

// Last quant-like token in the name, normalized (e.g. "...-Q8_0-MTP" -> "q8_0").
function quantLabel(name: string): string | undefined {
  const matches = basename(name).match(QUANT_TOKEN)
  return matches?.length ? matches[matches.length - 1].toLowerCase() : undefined
}

/**
 * Pick the draft companion that best pairs with the chosen main quant: the
 * highest-precedence kind present, and within it an exact quant match, then a
 * generic (quant-less) companion, then any.
 */
export function pickSpecSibling(
  quants: ModelQuant[] | undefined,
  mainQuant: Pick<ModelQuant, 'model_id' | 'path'>
): { quant: ModelQuant; kind: SpecKind } | undefined {
  if (!quants?.length) return undefined

  for (const kind of SPEC_KINDS) {
    const candidates = quants.filter((q) => specSidecarKind(q) === kind)
    if (!candidates.length) continue

    const mainLabel = quantLabel(mainQuant.path)
    const exact = mainLabel
      ? candidates.find((c) => quantLabel(c.path) === mainLabel)
      : undefined
    const generic = candidates.find((c) => quantLabel(c.path) === undefined)
    return { quant: exact ?? generic ?? candidates[0], kind }
  }
  return undefined
}
