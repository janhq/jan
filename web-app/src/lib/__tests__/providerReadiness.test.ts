import { describe, it, expect, vi } from 'vitest'

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [
    { provider: 'openai' },
    { provider: 'anthropic' },
    { provider: 'llamacpp' },
    { provider: 'jan' },
  ],
}))

import { isProviderUsable, hasUsableProvider } from '../providerReadiness'

const provider = (over: Record<string, unknown> = {}) =>
  ({ provider: 'openai', models: [], ...over }) as never

describe('isProviderUsable', () => {
  it('accepts a predefined remote provider holding an API key', () => {
    expect(isProviderUsable(provider({ api_key: 'sk-x' }))).toBe(true)
  })

  it('accepts a predefined remote provider with only a fallback key', () => {
    expect(
      isProviderUsable(provider({ api_key_fallbacks: ['sk-fallback'] }))
    ).toBe(true)
  })

  it('rejects a predefined remote provider with no key', () => {
    expect(isProviderUsable(provider())).toBe(false)
  })

  // A remote provider listing models still cannot serve them without a key.
  it('rejects a predefined remote provider that only has models', () => {
    expect(isProviderUsable(provider({ models: [{ id: 'gpt-4' }] }))).toBe(
      false
    )
  })

  it('accepts llamacpp once it has a model, with no key', () => {
    expect(
      isProviderUsable(
        provider({ provider: 'llamacpp', models: [{ id: 'jan-v2' }] })
      )
    ).toBe(true)
  })

  it('rejects llamacpp with no models', () => {
    expect(isProviderUsable(provider({ provider: 'llamacpp' }))).toBe(false)
  })

  it('accepts jan once it has a model', () => {
    expect(
      isProviderUsable(provider({ provider: 'jan', models: [{ id: 'm' }] }))
    ).toBe(true)
  })

  // Custom providers are user-configured endpoints, so models alone qualify.
  it('accepts a custom provider with models and no key', () => {
    expect(
      isProviderUsable(provider({ provider: 'my-server', models: [{ id: 'm' }] }))
    ).toBe(true)
  })

  it('rejects a custom provider with no models', () => {
    expect(isProviderUsable(provider({ provider: 'my-server' }))).toBe(false)
  })

  // The original returned `provider.models.length`, a number, from a callback
  // typed as boolean. Keep the contract strictly boolean.
  it('always returns a boolean', () => {
    for (const p of [
      provider(),
      provider({ provider: 'llamacpp', models: [{ id: 'm' }] }),
      provider({ provider: 'custom', models: [{ id: 'm' }] }),
    ]) {
      expect(typeof isProviderUsable(p)).toBe('boolean')
    }
  })

  it('tolerates a provider with no models array', () => {
    expect(
      isProviderUsable({ provider: 'llamacpp' } as never)
    ).toBe(false)
  })

  // Jan bootstraps an embedding model during first-run setup. Counting it ended
  // onboarding before the user had any model to chat with.
  it('does not count an embedding-only local provider as usable', () => {
    expect(
      isProviderUsable({
        provider: 'llamacpp',
        models: [{ id: 'sentence-transformer-mini', embedding: true }],
      } as never)
    ).toBe(false)
  })

  it('recognises an embedding model declared only by capability', () => {
    expect(
      isProviderUsable({
        provider: 'llamacpp',
        models: [{ id: 'e5-small', capabilities: ['embeddings'] }],
      } as never)
    ).toBe(false)
  })

  it('is usable once a chat model joins the embedding model', () => {
    expect(
      isProviderUsable({
        provider: 'llamacpp',
        models: [
          { id: 'sentence-transformer-mini', embedding: true },
          { id: 'jan-v3-q4_k_xl' },
        ],
      } as never)
    ).toBe(true)
  })
})

describe('hasUsableProvider', () => {
  it('is false for an empty list', () => {
    expect(hasUsableProvider([])).toBe(false)
  })

  it('is false when every provider is unusable', () => {
    expect(
      hasUsableProvider([provider(), provider({ provider: 'llamacpp' })])
    ).toBe(false)
  })

  it('is true when any single provider is usable', () => {
    expect(
      hasUsableProvider([
        provider(),
        provider({ provider: 'llamacpp', models: [{ id: 'm' }] }),
      ])
    ).toBe(true)
  })

  it('tolerates a missing list', () => {
    expect(hasUsableProvider(undefined as never)).toBe(false)
  })
})
