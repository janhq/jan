import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { DialogAddModel } from '../AddModel'
import { predefinedProviders } from '@/constants/providers'
import { useServiceHub } from '@/hooks/useServiceHub'

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({ updateProvider: vi.fn() })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}))

// The settings page mounts this dialog for every provider, so whatever it
// fetches on mount leaves the app as soon as the page is shown.
describe('DialogAddModel - Azure endpoint', () => {
  let fetchModels: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    const hub = (useServiceHub as unknown as () => any)()
    fetchModels = vi.fn().mockResolvedValue([])
    vi.spyOn(hub, 'providers').mockReturnValue({
      fetchModelsFromProvider: fetchModels,
    } as any)
  })

  const azureProvider = (overrides: Partial<ModelProvider> = {}) =>
    ({
      ...predefinedProviders.find((p) => p.provider === 'azure'),
      api_key: 'user-azure-key',
      ...overrides,
    }) as ModelProvider

  it('does not request a model list before the user sets an endpoint', () => {
    // The shipped Azure provider plus a key, i.e. the user typed the key first.
    render(<DialogAddModel provider={azureProvider()} />)

    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('requests the model list from the endpoint the user configured', () => {
    const base_url = 'https://my-resource.openai.azure.com/openai/v1'

    render(<DialogAddModel provider={azureProvider({ base_url })} />)

    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'azure', base_url })
    )
  })
})
