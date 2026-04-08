import { describe, expect, it } from 'vitest'
import {
  inferGgufQuantization,
  selectBestGgufVariant,
} from '../modelQuantization'

describe('modelQuantization', () => {
  it('infers canonical GGUF quantization names', () => {
    expect(inferGgufQuantization('model-q8_0.gguf')).toBe('Q8_0')
    expect(inferGgufQuantization('model-iq4_xs.gguf')).toBe('IQ4_XS')
    expect(inferGgufQuantization('model-unknown.gguf')).toBeUndefined()
  })

  it('selects the highest-quality available GGUF quant', () => {
    const result = selectBestGgufVariant([
      {
        model_id: 'qwen/test-model-q4_k_m',
        path: 'qwen/test-model-q4_k_m.gguf',
        file_size: '4 GB',
      },
      {
        model_id: 'qwen/test-model-q8_0',
        path: 'qwen/test-model-q8_0.gguf',
        file_size: '8 GB',
      },
    ])

    expect(result?.model_id).toBe('qwen/test-model-q8_0')
  })

  it('falls back to the first variant when quants are unknown', () => {
    const result = selectBestGgufVariant([
      {
        model_id: 'qwen/test-model-custom-a',
        path: 'qwen/test-model-custom-a.gguf',
        file_size: '4 GB',
      },
      {
        model_id: 'qwen/test-model-custom-b',
        path: 'qwen/test-model-custom-b.gguf',
        file_size: '8 GB',
      },
    ])

    expect(result?.model_id).toBe('qwen/test-model-custom-a')
  })
})
