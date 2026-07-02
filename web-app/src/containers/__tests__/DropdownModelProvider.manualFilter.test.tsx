import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'

// Minimal local types to avoid pulling ambient declarations into the test.
type Model = {
  id: string
  displayName?: string
  capabilities?: string[]
  manuallyAdded?: boolean
  imported?: boolean
  embedding?: boolean
}

type ModelProvider = {
  provider: string
  active: boolean
  models: Model[]
  settings: unknown[]
}

type MockHookReturn = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model
  getProviderByName: (name: string) => ModelProvider | undefined
  selectModelProvider: () => void
  getModelBy: (id: string) => Model | undefined
  updateProvider: () => void
}

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
  default: ({ provider }: { provider: any }) => (
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

const mockHook = (providers: ModelProvider[], selectedModel: Model) =>
  vi.mocked(useModelProvider).mockReturnValue({
    providers,
    selectedProvider: providers[0]?.provider,
    selectedModel,
    getProviderByName: vi.fn((name: string) =>
      providers.find((p) => p.provider === name)
    ),
    selectModelProvider: vi.fn(),
    getModelBy: vi.fn((id: string) =>
      providers.flatMap((p) => p.models).find((m) => m.id === id)
    ),
    updateProvider: vi.fn(),
  } as MockHookReturn)

describe('DropdownModelProvider - manual model filter', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('hides auto-fetched models when the provider has pinned models', () => {
    const provider: ModelProvider = {
      provider: 'llamacpp',
      active: true,
      settings: [],
      models: [
        { id: 'pinned.gguf', capabilities: ['completion'], manuallyAdded: true },
        { id: 'auto-1.gguf', capabilities: ['completion'] },
        { id: 'auto-2.gguf', capabilities: ['completion'] },
      ],
    }
    mockHook([provider], provider.models[0])

    render(<DropdownModelProvider />)

    expect(screen.getAllByText('pinned.gguf').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('auto-1.gguf')).not.toBeInTheDocument()
    expect(screen.queryByText('auto-2.gguf')).not.toBeInTheDocument()
  })

  it('treats imported models as pinned and hides auto-fetched ones', () => {
    const provider: ModelProvider = {
      provider: 'llamacpp',
      active: true,
      settings: [],
      models: [
        { id: 'local.gguf', capabilities: ['completion'], imported: true },
        { id: 'auto-1.gguf', capabilities: ['completion'] },
      ],
    }
    mockHook([provider], provider.models[0])

    render(<DropdownModelProvider />)

    expect(screen.getAllByText('local.gguf').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('auto-1.gguf')).not.toBeInTheDocument()
  })

  it('shows all models when the provider has no pinned models', () => {
    const provider: ModelProvider = {
      provider: 'llamacpp',
      active: true,
      settings: [],
      models: [
        { id: 'auto-1.gguf', capabilities: ['completion'] },
        { id: 'auto-2.gguf', capabilities: ['completion'] },
        { id: 'auto-3.gguf', capabilities: ['completion'] },
      ],
    }
    mockHook([provider], provider.models[0])

    render(<DropdownModelProvider />)

    expect(screen.getByText('auto-2.gguf')).toBeInTheDocument()
    expect(screen.getByText('auto-3.gguf')).toBeInTheDocument()
  })

  it('does not treat a catalog displayName as a pin', () => {
    // A displayName alone must NOT activate the filter — otherwise catalogs
    // that ship displayName would wrongly hide every other model.
    const provider: ModelProvider = {
      provider: 'llamacpp',
      active: true,
      settings: [],
      models: [
        { id: 'auto-1.gguf', displayName: 'Auto One', capabilities: ['completion'] },
        { id: 'auto-2.gguf', displayName: 'Auto Two', capabilities: ['completion'] },
      ],
    }
    mockHook([provider], provider.models[0])

    render(<DropdownModelProvider />)

    expect(screen.getByText('Auto Two')).toBeInTheDocument()
  })
})
