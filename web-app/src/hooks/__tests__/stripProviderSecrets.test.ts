import { describe, it, expect, vi } from 'vitest'

vi.mock('@/constants/localStorage', () => ({ localStorageKey: {} }))
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
  createJSONStorage: () => ({}),
}))
vi.mock('@/lib/backendStorage', () => ({ backendStorage: {} }))

import { stripProviderSecrets } from '../useModelProvider'

const SECRET = 'sk-secret-key'
const FALLBACK = 'sk-fallback-key'

describe('stripProviderSecrets', () => {
  it('removes the key chain from all four storage locations', () => {
    const provider = {
      provider: 'openai',
      active: true,
      base_url: 'https://api.openai.com/v1',
      api_key: SECRET,
      api_key_fallbacks: [FALLBACK],
      models: [],
      settings: [
        {
          key: 'api-key',
          controller_props: { value: SECRET, type: 'password' },
        },
        {
          key: 'api-key-fallbacks',
          controller_props: { value: `${SECRET}\n${FALLBACK}` },
        },
        { key: 'base-url', controller_props: { value: 'https://x' } },
      ],
    } as unknown as ModelProvider

    const stripped = stripProviderSecrets(provider)

    expect(stripped.api_key).toBeUndefined()
    expect(stripped.api_key_fallbacks).toBeUndefined()
    const serialized = JSON.stringify(stripped)
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain(FALLBACK)

    // Non-secret settings and config are preserved.
    const baseUrl = stripped.settings?.find((s) => s.key === 'base-url')
    expect(baseUrl?.controller_props.value).toBe('https://x')
    expect(stripped.base_url).toBe('https://api.openai.com/v1')
    expect(stripped.active).toBe(true)
  })

  it('does not mutate the input provider', () => {
    const provider = {
      provider: 'openai',
      api_key: SECRET,
      settings: [{ key: 'api-key', controller_props: { value: SECRET } }],
      models: [],
    } as unknown as ModelProvider

    stripProviderSecrets(provider)
    expect(provider.api_key).toBe(SECRET)
    expect(provider.settings?.[0].controller_props.value).toBe(SECRET)
  })

  it('handles a provider with no settings array', () => {
    const provider = {
      provider: 'custom',
      api_key: SECRET,
      models: [],
    } as unknown as ModelProvider
    const stripped = stripProviderSecrets(provider)
    expect(stripped.api_key).toBeUndefined()
  })
})
