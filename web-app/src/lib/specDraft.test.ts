import { describe, it, expect } from 'vitest'
import { isSpecSidecar, specSidecarKind, pickSpecSibling } from './specDraft'
import type { ModelQuant } from '@/services/models/types'

const q = (model_id: string, file: string): ModelQuant => ({
  model_id,
  path: `https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/${file}`,
  file_size: '0',
})

// Mirrors the real gemma-4-26B-A4B-it-GGUF catalog entry.
const GEMMA: ModelQuant[] = [
  q('MTP/gemma-4-26B-A4B-it-BF16-MTP', 'gemma-4-26B-A4B-it-BF16-MTP.gguf'),
  q('MTP/gemma-4-26B-A4B-it-Q8_0-MTP', 'gemma-4-26B-A4B-it-Q8_0-MTP.gguf'),
  q('gemma-4-26B-A4B-it-Q8_0', 'gemma-4-26B-A4B-it-Q8_0.gguf'),
  q('gemma-4-26B-A4B-it-UD-Q4_K_XL', 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf'),
  q('mtp-gemma-4-26B-A4B-it', 'mtp-gemma-4-26B-A4B-it.gguf'),
]

describe('specSidecarKind', () => {
  it('detects MTP/ model_id prefix', () => {
    expect(
      specSidecarKind(
        q('MTP/gemma-4-26B-A4B-it-Q8_0-MTP', 'gemma-4-26B-A4B-it-Q8_0-MTP.gguf')
      )
    ).toBe('mtp')
  })
  it('detects mtp- filename prefix', () => {
    expect(
      specSidecarKind(q('mtp-gemma-4-26B-A4B-it', 'mtp-gemma-4-26B-A4B-it.gguf'))
    ).toBe('mtp')
  })
  it('detects -MTP / -mtp- filename token', () => {
    expect(specSidecarKind(q('x', 'Step3.7-flash-mtp-BF16.gguf'))).toBe('mtp')
    expect(specSidecarKind(q('x', 'gemma-4-26B-A4B-it-BF16-MTP.gguf'))).toBe(
      'mtp'
    )
  })

  // The prefixes upstream publishes and excludes from gguf_filename_is_model.
  it('detects the other three sidecar flavours', () => {
    expect(specSidecarKind(q('x', 'dflash-DeepSeek-V4-Q4_K_M.gguf'))).toBe(
      'dflash'
    )
    expect(specSidecarKind(q('x', 'dspark-DeepSeek-V4-Q4_K_M.gguf'))).toBe(
      'dspark'
    )
    expect(specSidecarKind(q('x', 'eagle3-Llama-3.3-70B-BF16.gguf'))).toBe(
      'eagle3'
    )
  })

  it('does not flag normal quants', () => {
    expect(
      specSidecarKind(
        q('gemma-4-26B-A4B-it-UD-Q4_K_XL', 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf')
      )
    ).toBeUndefined()
    expect(isSpecSidecar(q('gemma-4-26B-A4B-it-Q8_0', 'gemma-4-26B-A4B-it-Q8_0.gguf'))).toBe(false)
  })

  // "dflash" as a substring of a word is not a token; a model legitimately
  // named after flash attention must not be mistaken for a draft.
  it('requires a token boundary', () => {
    expect(specSidecarKind(q('x', 'flashmtpish-Q4_K_M.gguf'))).toBeUndefined()
    expect(specSidecarKind(q('x', 'Llama-3-flash-Q4_K_M.gguf'))).toBeUndefined()
  })
})

describe('pickSpecSibling', () => {
  it('prefers an exact quant match', () => {
    const main = q('gemma-4-26B-A4B-it-Q8_0', 'gemma-4-26B-A4B-it-Q8_0.gguf')
    const picked = pickSpecSibling(GEMMA, main)
    expect(picked?.quant.model_id).toBe('MTP/gemma-4-26B-A4B-it-Q8_0-MTP')
    expect(picked?.kind).toBe('mtp')
  })

  it('falls back to the quant-less companion', () => {
    const main = q(
      'gemma-4-26B-A4B-it-UD-Q4_K_XL',
      'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf'
    )
    expect(pickSpecSibling(GEMMA, main)?.quant.model_id).toBe(
      'mtp-gemma-4-26B-A4B-it'
    )
  })

  it('returns undefined when the repo ships no companion', () => {
    const plain = [q('foo-Q8_0', 'foo-Q8_0.gguf')]
    expect(pickSpecSibling(plain, plain[0])).toBeUndefined()
  })

  it('reports the kind it picked', () => {
    const main = q('DeepSeek-V4-Q4_K_M', 'DeepSeek-V4-Q4_K_M.gguf')
    const quants = [main, q('x', 'dflash-DeepSeek-V4-Q4_K_M.gguf')]
    expect(pickSpecSibling(quants, main)?.kind).toBe('dflash')
  })

  // arg.cpp resolves a repo shipping several in a fixed order, and DSpark
  // outranks DFlash because its sidecar carries the extra Markov head.
  it('applies upstream precedence when several are present', () => {
    const main = q('DeepSeek-V4-Q4_K_M', 'DeepSeek-V4-Q4_K_M.gguf')
    const both = [
      main,
      q('x', 'dflash-DeepSeek-V4-Q4_K_M.gguf'),
      q('y', 'dspark-DeepSeek-V4-Q4_K_M.gguf'),
    ]
    expect(pickSpecSibling(both, main)?.kind).toBe('dspark')

    const withMtp = [...both, q('z', 'mtp-DeepSeek-V4-Q4_K_M.gguf')]
    expect(pickSpecSibling(withMtp, main)?.kind).toBe('mtp')
  })
})
