import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'

type TestModel = {
  id: string
  displayName?: string
  capabilities: string[]
}

type TestProvider = {
  provider: string
  active: boolean
  models: TestModel[]
  settings: unknown[]
}

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    updateCurrentThreadModel: vi.fn(),
  })),
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
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: vi.fn(() => ({
    favoriteModels: [],
  })),
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
  default: ({ capabilities }: { capabilities: string[] }) => (
    <div data-testid="capabilities">{capabilities.join(',')}</div>
  ),
}))

vi.mock('../ModelSetting', () => ({
  ModelSetting: () => <div data-testid="model-setting" />,
}))

vi.mock('../ModelSupportStatus', () => ({
  ModelSupportStatus: () => <div data-testid="model-support-status" />,
}))

// A user-added custom provider: it lists its models without an API key, so
// every model below is searchable.
const providers: TestProvider[] = [
  {
    provider: 'my-gateway',
    active: true,
    models: [
      { id: 'gpt-4o', capabilities: ['completion'] },
      { id: 'gpt-4o-mini', capabilities: ['completion'] },
      // g…p…t appear only scattered across the id.
      { id: 'gemini-pro-turbo', capabilities: ['completion'] },
      {
        id: 'deploy-a1',
        displayName: 'GPT Team Deployment',
        capabilities: ['completion'],
      },
      {
        id: 'claude-sonnet',
        displayName: 'Claude Sonnet',
        capabilities: ['completion'],
      },
    ],
    settings: [],
  },
]

const allModelIds = providers[0].models.map((m) => m.id)

function search(query: string) {
  fireEvent.change(screen.getByPlaceholderText('common:searchModels'), {
    target: { value: query },
  })
}

function visibleModelIds(): string[] {
  return allModelIds.filter(
    (id) => screen.queryByTestId(`model-option-${id}`) !== null
  )
}

describe('DropdownModelProvider - model search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModelProvider).mockReturnValue({
      providers,
      selectedProvider: 'my-gateway',
      selectedModel: providers[0].models[4],
      getProviderByName: vi.fn((name: string) =>
        providers.find((p) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        providers[0].models.find((m) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as unknown as ReturnType<typeof useModelProvider>)
  })

  afterEach(() => {
    cleanup()
  })

  it('lists every model when the query is empty', () => {
    render(<DropdownModelProvider />)

    expect(visibleModelIds()).toEqual(allModelIds)
  })

  it('only lists models whose name or id contains the query as a substring', () => {
    render(<DropdownModelProvider />)

    search('gpt')

    expect(visibleModelIds()).toEqual(['gpt-4o', 'gpt-4o-mini', 'deploy-a1'])
  })

  it('matches case-insensitively', () => {
    render(<DropdownModelProvider />)

    search('GPT-4O')

    expect(visibleModelIds()).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('matches against the display name as well as the id', () => {
    render(<DropdownModelProvider />)

    search('claude sonnet')

    expect(visibleModelIds()).toEqual(['claude-sonnet'])
  })

  it('requires every whitespace-separated term to match', () => {
    render(<DropdownModelProvider />)

    search('  gpt   mini ')

    expect(visibleModelIds()).toEqual(['gpt-4o-mini'])
  })

  it('shows the empty state when no model contains the query', () => {
    render(<DropdownModelProvider />)

    search('gpx')

    expect(visibleModelIds()).toEqual([])
    expect(screen.getByText('common:noModelsFoundFor')).toBeInTheDocument()
  })
})
