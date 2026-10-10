import { describe, it, expect, vi } from 'vitest'
import { useModelProvider } from '../useModelProvider'

vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({ path: () => ({ sep: () => '/' }) })),
}))

// Earlier releases stored Azure's example endpoint as a real base_url, so an
// unconfigured install kept sending requests to a host anyone can claim.
const EXAMPLE_ENDPOINT = 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1'

const migrate = (state: unknown, version: number) => {
  const persistApi = (useModelProvider as any).persist
  return persistApi.getOptions().migrate(state, version)
}

const persistedAzure = (base_url: string) => ({
  provider: 'azure',
  active: true,
  base_url,
  models: [],
  settings: [
    {
      key: 'api-key',
      controller_type: 'input',
      controller_props: { value: '', type: 'password' },
    },
    {
      key: 'base-url',
      controller_type: 'input',
      controller_props: { placeholder: EXAMPLE_ENDPOINT, value: base_url },
    },
  ],
})

describe('useModelProvider - Azure example endpoint migration', () => {
  it('clears a stored example endpoint so it is treated as not configured', () => {
    const migrated = migrate(
      { providers: [persistedAzure(EXAMPLE_ENDPOINT)], deletedModels: [] },
      19
    )

    const azure = migrated.providers.find((p: any) => p.provider === 'azure')
    expect(azure.base_url).toBe('')
    const baseUrlSetting = azure.settings.find((s: any) => s.key === 'base-url')
    expect(baseUrlSetting.controller_props.value).toBe('')
  })

  it('keeps an endpoint the user configured', () => {
    const configured = 'https://my-resource.openai.azure.com/openai/v1'

    const migrated = migrate(
      { providers: [persistedAzure(configured)], deletedModels: [] },
      19
    )

    const azure = migrated.providers.find((p: any) => p.provider === 'azure')
    expect(azure.base_url).toBe(configured)
  })
})
