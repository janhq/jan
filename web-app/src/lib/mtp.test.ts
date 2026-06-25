import { describe, it, expect } from 'vitest'
import { isMtpQuant, pickMtpSibling } from './mtp'
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

describe('isMtpQuant', () => {
  it('detects MTP/ model_id prefix', () => {
    expect(isMtpQuant(q('MTP/gemma-4-26B-A4B-it-Q8_0-MTP', 'gemma-4-26B-A4B-it-Q8_0-MTP.gguf'))).toBe(true)
  })
  it('detects mtp- filename prefix', () => {
    expect(isMtpQuant(q('mtp-gemma-4-26B-A4B-it', 'mtp-gemma-4-26B-A4B-it.gguf'))).toBe(true)
  })
  it('detects -MTP / -mtp- filename token', () => {
    expect(isMtpQuant(q('x', 'Step3.7-flash-mtp-BF16.gguf'))).toBe(true)
    expect(isMtpQuant(q('x', 'gemma-4-26B-A4B-it-BF16-MTP.gguf'))).toBe(true)
  })
  it('does not flag normal quants', () => {
    expect(isMtpQuant(q('gemma-4-26B-A4B-it-UD-Q4_K_XL', 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf'))).toBe(false)
    expect(isMtpQuant(q('gemma-4-26B-A4B-it-Q8_0', 'gemma-4-26B-A4B-it-Q8_0.gguf'))).toBe(false)
  })
})

describe('pickMtpSibling', () => {
  it('prefers an exact quant match', () => {
    const main = q('gemma-4-26B-A4B-it-Q8_0', 'gemma-4-26B-A4B-it-Q8_0.gguf')
    expect(pickMtpSibling(GEMMA, main)?.model_id).toBe('MTP/gemma-4-26B-A4B-it-Q8_0-MTP')
  })
  it('falls back to the generic (quant-less) companion', () => {
    const main = q('gemma-4-26B-A4B-it-UD-Q4_K_XL', 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf')
    expect(pickMtpSibling(GEMMA, main)?.model_id).toBe('mtp-gemma-4-26B-A4B-it')
  })
  it('returns undefined when no companion exists', () => {
    const onlyMain = [q('gemma-4-26B-A4B-it-Q8_0', 'gemma-4-26B-A4B-it-Q8_0.gguf')]
    expect(pickMtpSibling(onlyMain, onlyMain[0])).toBeUndefined()
  })
})
