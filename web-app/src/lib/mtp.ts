import type { ModelQuant } from '@/services/models/types'

// llama.cpp ships some models with a companion "draft" gguf for Multi-Token
// Prediction (speculative decoding via `--spec-type draft-mtp`). In the Jan
// catalog these companions are mixed into the main model's quant list under an
// `MTP/` model_id or an `mtp-` / `-MTP` filename. They are NOT standalone
// models — each pairs with a real quant as its draft model.

const basename = (pathOrId: string): string => {
  const file = pathOrId.split('/').pop() ?? pathOrId
  return file.replace(/\.gguf$/i, '')
}

// Token marks the file as MTP when "mtp" stands alone (mtp-foo, foo-mtp, foo-MTP).
const MTP_TOKEN = /(^|[-_.])mtp([-_.]|$)/i

const QUANT_TOKEN =
  /(iq\d+_\w+|q\d+_k(_\w+)?|q\d+_\d+|q\d+|bf16|fp16|f16|f32|mxfp4(_moe)?|mxfp8|nvfp4|fp8)/gi

export function isMtpQuant(quant: Pick<ModelQuant, 'model_id' | 'path'>): boolean {
  if (/^mtp\//i.test(quant.model_id)) return true
  return MTP_TOKEN.test(basename(quant.model_id)) || MTP_TOKEN.test(basename(quant.path))
}

// Last quant-like token in the name, normalized (e.g. "...-Q8_0-MTP" -> "q8_0").
function quantLabel(name: string): string | undefined {
  const matches = basename(name).match(QUANT_TOKEN)
  return matches?.length ? matches[matches.length - 1].toLowerCase() : undefined
}

// Pick the MTP companion that best pairs with the chosen main quant: exact
// quant match wins, then a generic (quant-less) companion, then any companion.
export function pickMtpSibling(
  quants: ModelQuant[] | undefined,
  mainQuant: Pick<ModelQuant, 'model_id' | 'path'>
): ModelQuant | undefined {
  if (!quants?.length) return undefined
  const candidates = quants.filter(isMtpQuant)
  if (!candidates.length) return undefined

  const mainLabel = quantLabel(mainQuant.path)
  if (mainLabel) {
    const exact = candidates.find((c) => quantLabel(c.path) === mainLabel)
    if (exact) return exact
  }
  const generic = candidates.find((c) => quantLabel(c.path) === undefined)
  return generic ?? candidates[0]
}
