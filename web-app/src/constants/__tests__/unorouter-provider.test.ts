import { describe, expect, it } from 'vitest'
import { providerModels } from '../models'
import { predefinedProviders } from '../providers'

describe('UnoRouter predefined provider', () => {
  it('registers UnoRouter as an OpenAI-compatible remote provider', () => {
    const provider = predefinedProviders.find((p) => p.provider === 'unorouter')

    expect(provider).toBeDefined()
    expect(provider?.base_url).toBe('https://api.unorouter.com/v1')
    expect(provider?.explore_models_url).toBe('https://unorouter.com/models')
    expect(provider?.settings.map((s) => s.key)).toEqual(['api-key'])
  })

  it('uses the live model catalog with free seed models', () => {
    const provider = predefinedProviders.find((p) => p.provider === 'unorouter')

    expect(providerModels.unorouter.models).toBe(true)
    expect(providerModels.unorouter.supportsStreaming).toBe(true)
    expect(providerModels.unorouter.supportsToolCalls).toBe(true)
    expect(provider?.models.map((m) => m.id)).toContain(
      'deepseek-v4-flash:free'
    )
  })
})
