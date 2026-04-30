import { describe, it, expect } from 'vitest'
import { buildModelIdFromPath } from '../buildModelIdFromPath'

describe('buildModelIdFromPath', () => {
  it('strips extension and normalizes spaces to hyphens before sanitize', () => {
    expect(buildModelIdFromPath('/models/my model name.gguf')).toBe(
      'my-model-name'
    )
  })

  it('handles Windows-style paths', () => {
    expect(
      buildModelIdFromPath('C:\\Users\\dev\\models\\Qwen2-7B-Q4_K_M.gguf')
    ).toBe('Qwen2-7B-Q4_K_M')
  })

  it('preserves allowed punctuation via sanitizeModelId (dots become underscores)', () => {
    expect(buildModelIdFromPath('/x/model.name-v1.0.gguf')).toBe(
      'model_name-v1_0'
    )
  })

  it('strips characters not allowed in model ids', () => {
    expect(buildModelIdFromPath('/m/weird@name#stuff.gguf')).toBe('weirdnamestuff')
  })

  it('returns empty string when filename sanitizes to nothing', () => {
    expect(buildModelIdFromPath('/m/@@@.gguf')).toBe('')
    expect(buildModelIdFromPath('/m/!!!.gguf')).toBe('')
  })

  it('handles empty basename edge case', () => {
    expect(buildModelIdFromPath('/')).toBe('')
  })
})
