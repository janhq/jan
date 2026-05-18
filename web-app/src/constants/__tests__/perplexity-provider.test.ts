import { describe, it, expect } from 'vitest'
import { predefinedProviders } from '../providers'
import { providerModels } from '../models'

describe('Perplexity predefined provider config', () => {
  const provider = predefinedProviders.find((p) => p.provider === 'perplexity')

  it('exists in predefinedProviders', () => {
    expect(provider).toBeDefined()
  })

  it('has the correct base_url', () => {
    expect(provider?.base_url).toBe('https://api.perplexity.ai')
  })

  it('has a valid explore_models_url', () => {
    expect(provider?.explore_models_url).toMatch(/^https:\/\//)
  })

  it('has an api-key setting with password type', () => {
    const apiKeySetting = provider?.settings.find((s) => s.key === 'api-key')
    expect(apiKeySetting).toBeDefined()
    expect(apiKeySetting?.controller_props.type).toBe('password')
  })

  it('has a base-url setting', () => {
    const baseUrlSetting = provider?.settings.find((s) => s.key === 'base-url')
    expect(baseUrlSetting).toBeDefined()
    expect(baseUrlSetting?.controller_props.value).toBe('https://api.perplexity.ai')
  })
})

describe('Perplexity providerModels config', () => {
  const config = providerModels.perplexity

  it('exists in providerModels', () => {
    expect(config).toBeDefined()
  })

  it('has models: true to allow dynamic model catalog', () => {
    expect(config.models).toBe(true)
  })

  it('has supportsCompletion: true', () => {
    expect(config.supportsCompletion).toBe(true)
  })

  it('has supportsStreaming: true', () => {
    expect(config.supportsStreaming).toBe(true)
  })

  it('has supportsImages as an array (not a boolean) for type-safe .includes() calls', () => {
    expect(Array.isArray(config.supportsImages)).toBe(true)
  })

  it('has supportsToolCalls: true', () => {
    expect(config.supportsToolCalls).toBe(true)
  })
})
