import { describe, expect, it } from 'vitest'
import { getVariantDisplayName, isBestQuantVariant } from '../score-utils'

describe('hub score utils', () => {
  it('strips format suffixes from variant ids', () => {
    expect(getVariantDisplayName('qwen/test-model-q4_k_m-GGUF')).toBe(
      'qwen/test-model-q4_k_m'
    )
    expect(getVariantDisplayName('qwen/test-model-q4_k_m_TensorRT')).toBe(
      'qwen/test-model-q4_k_m'
    )
  })

  it('matches best quant case-insensitively', () => {
    expect(isBestQuantVariant('qwen/test-model-q4_k_m-GGUF', 'Q4_K_M')).toBe(
      true
    )
    expect(isBestQuantVariant('qwen/test-model-q8_0-GGUF', 'Q4_K_M')).toBe(
      false
    )
  })

  it('returns false when best quant is missing', () => {
    expect(isBestQuantVariant('qwen/test-model-q4_k_m-GGUF')).toBe(false)
  })
})
