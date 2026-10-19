import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({ updateCurrentThreadModel: vi.fn() })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({
      checkMmprojExists: vi.fn(() => Promise.resolve(false)),
      checkMmprojExistsAndUpdateOffloadMMprojSetting: vi.fn(() =>
        Promise.resolve()
      ),
    }),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: vi.fn(() => ({ favoriteModels: [] })),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: {
    WEB_AUTO_MODEL_SELECTION: false,
    MODEL_PROVIDER_SETTINGS: true,
    projects: true,
  },
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))

vi.mock('../ProvidersAvatar', () => ({
  default: ({ provider }: { provider: { provider: string } }) => (
    <div data-testid={`provider-avatar-${provider.provider}`} />
  ),
}))

vi.mock('../Capabilities', () => ({
  default: () => <div data-testid="capabilities" />,
}))

vi.mock('../ModelSetting', () => ({
  ModelSetting: () => <div data-testid="model-setting" />,
}))

vi.mock('../ModelSupportStatus', () => ({
  ModelSupportStatus: () => <div data-testid="model-support-status" />,
}))

const model = (id: string) => ({ id, capabilities: ['completion'] })

const azureWith = (overrides: Record<string, unknown>) => ({
  provider: 'azure',
  active: true,
  api_key: 'user-azure-key',
  base_url: 'https://my-resource.services.ai.azure.com/openai/v1',
  // A catalog refresh stored models the resource has not deployed.
  models: [model('gpt-6-astra'), model('gpt-4o'), model('Llama-3.3-70B-Instruct')],
  settings: [],
  ...overrides,
})

const mockProviders = (providers: Record<string, unknown>[]) => {
  vi.mocked(useModelProvider).mockReturnValue({
    providers,
    selectedProvider: 'azure',
    selectedModel: model('gpt-6-astra'),
    getProviderByName: vi.fn((name: string) =>
      providers.find((p) => p.provider === name)
    ),
    selectModelProvider: vi.fn(),
    getModelBy: vi.fn(),
    updateProvider: vi.fn(),
  } as unknown as ReturnType<typeof useModelProvider>)
}

const listedIds = () =>
  screen
    .queryAllByTestId(/^model-option-/)
    .map((el) => el.getAttribute('data-testid')!.replace('model-option-', ''))

describe('DropdownModelProvider - Azure deployed models only', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('offers only the deployed Azure models by default', () => {
    mockProviders([azureWith({ deployments: ['gpt-6-astra'] })])

    render(<DropdownModelProvider />)

    expect(listedIds()).toEqual(['gpt-6-astra'])
  })

  it('offers every model once the user turns the switch off', () => {
    mockProviders([
      azureWith({ deployments: ['gpt-6-astra'], deployed_models_only: false }),
    ])

    render(<DropdownModelProvider />)

    // Which models are offered is under test here, not their order.
    expect(listedIds()).toHaveLength(3)
    expect(listedIds()).toEqual(
      expect.arrayContaining(['gpt-6-astra', 'gpt-4o', 'Llama-3.3-70B-Instruct'])
    )
  })
})
