import { describe, it, expect } from 'vitest'
import { customProviderRequiresApiKey } from '../provider-api-keys'

describe('customProviderRequiresApiKey', () => {
  it('does not require a key for OpenAI-compatible custom providers', () => {
    expect(customProviderRequiresApiKey('openai')).toBe(false)
    expect(customProviderRequiresApiKey(undefined)).toBe(false)
  })

  it('requires a key for Anthropic-compatible custom providers', () => {
    expect(customProviderRequiresApiKey('anthropic')).toBe(true)
  })
})
