import { describe, expect, it } from 'vitest'
import { providerModels } from '../models'
import { predefinedProviders } from '../providers'

describe('NEAR AI predefined provider', () => {
  it('registers NEAR AI Cloud as an OpenAI-compatible remote provider', () => {
    const provider = predefinedProviders.find((p) => p.provider === 'nearai')

    expect(provider).toBeDefined()
    expect(provider?.base_url).toBe('https://cloud-api.near.ai/v1')
    expect(provider?.explore_models_url).toBe(
      'https://cloud-api.near.ai/v1/model/list'
    )
    expect(provider?.settings.map((s) => s.key)).toEqual([
      'api-key',
      'base-url',
    ])
  })

  it('uses the live model catalog instead of a static model list', () => {
    expect(providerModels.nearai.models).toBe(true)
    expect(providerModels.nearai.supportsStreaming).toBe(true)
    expect(providerModels.nearai.supportsToolCalls).toBe(true)
  })
})
