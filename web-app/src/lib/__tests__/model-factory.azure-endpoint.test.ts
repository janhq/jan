import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModelFactory } from '../model-factory'
import { i18n } from '@/i18n/react-i18next-compat'

// Without an endpoint there is nowhere safe to send an Azure key: the
// OpenAI-compatible route falls back to api.openai.com, and a relative URL
// would post to the app's own origin.
describe('ModelFactory - Azure without an endpoint', () => {
  const fetchMock = vi.fn<typeof globalThis.fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([[''], ['   '], [undefined]])(
    'refuses to build a model when base_url is %j',
    async (base_url) => {
      const provider = {
        provider: 'azure',
        api_key: 'user-azure-key',
        base_url,
        models: [],
        settings: [],
      } as unknown as ProviderObject

      // The message reaches the chat, so it comes from the user's locale.
      await expect(
        ModelFactory.createModel('gpt-6.1-sol', provider)
      ).rejects.toThrow(
        i18n.t('model-errors:azureEndpointMissing', { provider: 'azure' })
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('has a translated message for the missing endpoint', () => {
    // An unknown key comes back verbatim.
    expect(
      i18n.t('model-errors:azureEndpointMissing', { provider: 'azure' })
    ).not.toBe('model-errors:azureEndpointMissing')
  })
})
