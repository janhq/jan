import { describe, it, expect } from 'vitest'
import { providerCanFetchWithoutKey } from '../provider-api-keys'

describe('providerCanFetchWithoutKey', () => {
  it('returns true for lemonade', () => {
    expect(providerCanFetchWithoutKey('lemonade')).toBe(true)
  })

  it('returns false for all standard cloud providers', () => {
    for (const p of ['openai', 'anthropic', 'gemini', 'groq', 'mistral', 'xai', 'huggingface', 'nvidia']) {
      expect(providerCanFetchWithoutKey(p)).toBe(false)
    }
  })
})
