import { describe, it, expect } from 'vitest'

describe('Apiário Provider Configuration', () => {
  it('should be present in predefinedProviders', async () => {
    const { predefinedProviders } = await import('@/constants/providers')
    const apiarioProvider = predefinedProviders.find(
      (p) => p.provider === 'apiario'
    )

    expect(apiarioProvider).toBeDefined()
    expect(apiarioProvider?.active).toBe(true)
    expect(apiarioProvider?.base_url).toBe('https://api.apiario.dev/v1')
    expect(apiarioProvider?.api_key).toBe('')
    expect(apiarioProvider?.explore_models_url).toBe(
      'https://docs.apiario.dev/models'
    )
  })

  it('should have correct settings structure', async () => {
    const { predefinedProviders } = await import('@/constants/providers')
    const apiarioProvider = predefinedProviders.find(
      (p) => p.provider === 'apiario'
    )

    expect(apiarioProvider?.settings).toBeDefined()
    expect(Array.isArray(apiarioProvider?.settings)).toBe(true)

    const apiKeySetting = apiarioProvider?.settings.find(
      (s) => s.key === 'api-key'
    )
    expect(apiKeySetting).toBeDefined()
    expect(apiKeySetting?.title).toBe('API Key')
    expect(apiKeySetting?.controller_type).toBe('input')
    expect(typeof apiKeySetting?.description).toBe('string')
    expect(apiKeySetting?.description).toContain('apiario.dev')
  })

  it('should have OpenAI-compatible api_type (undefined = default openai)', async () => {
    const { predefinedProviders } = await import('@/constants/providers')
    const apiarioProvider = predefinedProviders.find(
      (p) => p.provider === 'apiario'
    )

    expect(apiarioProvider?.api_type).toBeUndefined()
  })
})
