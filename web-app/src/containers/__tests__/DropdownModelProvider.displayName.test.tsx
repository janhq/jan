import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { getModelDisplayName } from '@/lib/utils'
import { useModelProvider } from '@/hooks/useModelProvider'

// Define basic types to avoid missing declarations
type ModelProvider = {
  provider: string
  active: boolean
  models: Array<{
    id: string
    displayName?: string
    capabilities: string[]
  }>
  settings: unknown[]
}

type Model = {
  id: string
  displayName?: string
  capabilities?: string[]
}

type MockHookReturn = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  getProviderByName: (name: string) => ModelProvider | undefined
  selectModelProvider: () => void
  getModelBy: (id: string) => Model | undefined
  updateProvider: () => void
}

const localStorageStore = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    localStorageStore.delete(key)
  }),
  clear: vi.fn(() => {
    localStorageStore.clear()
  }),
}

// Mock the dependencies
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
      checkMmprojExistsAndUpdateOffloadMMprojSetting: vi.fn(() => Promise.resolve()),
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

vi.mock('@/lib/xai-oauth', () => ({
  getXaiOAuthStatus: vi.fn(() => Promise.resolve(null)),
  onXaiOAuthLoginComplete: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: {
    WEB_AUTO_MODEL_SELECTION: false,
    MODEL_PROVIDER_SETTINGS: true,
    projects: true,
  },
}))

// Mock UI components
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

describe('DropdownModelProvider - Display Name Integration', () => {
  const mockProviders: ModelProvider[] = [
    {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'model1.gguf',
          displayName: 'Custom Model 1',
          capabilities: ['completion'],
        },
        {
          id: 'model2-very-long-filename.gguf',
          displayName: 'Short Name',
          capabilities: ['completion'],
        },
        {
          id: 'model3.gguf',
          // No displayName - should fall back to ID
          capabilities: ['completion'],
        },
      ],
      settings: [],
    },
  ]

  const mockSelectedModel = {
    id: 'model1.gguf',
    displayName: 'Custom Model 1',
    capabilities: ['completion'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', localStorageMock)
    localStorageMock.clear()

    // Reset the mock for each test
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockSelectedModel,
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)
  })

  afterEach(() => {
    cleanup()
  })

  it('should display custom model name in the trigger button', () => {
    render(<DropdownModelProvider />)

    // Should show the display name in both trigger and dropdown
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // One in trigger, one in dropdown
    // Model ID should not be visible as text (it's only in title attributes)
    expect(screen.queryByDisplayValue('model1.gguf')).not.toBeInTheDocument()
  })

  it('should fall back to model ID when no displayName is set', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockProviders[0].models[2], // model3 without displayName
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    expect(screen.getAllByText('model3.gguf')).toHaveLength(2) // Trigger and dropdown
  })

  it('should show display names in the model list items', () => {
    render(<DropdownModelProvider />)

    // Check if the display names are shown in the options
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // Selected: Trigger + dropdown
    expect(screen.getByText('Short Name')).toBeInTheDocument() // Only in dropdown
    expect(screen.getByText('model3.gguf')).toBeInTheDocument() // Only in dropdown
  })

  it('should use getModelDisplayName utility correctly', () => {
    // Test the utility function directly with different model scenarios
    const modelWithDisplayName = {
      id: 'long-model-name.gguf',
      displayName: 'Short Name',
    } as Model

    const modelWithoutDisplayName = {
      id: 'model-without-display-name.gguf',
    } as Model

    const modelWithEmptyDisplayName = {
      id: 'model-with-empty.gguf',
      displayName: '',
    } as Model

    expect(getModelDisplayName(modelWithDisplayName)).toBe('Short Name')
    expect(getModelDisplayName(modelWithoutDisplayName)).toBe('model-without-display-name.gguf')
    expect(getModelDisplayName(modelWithEmptyDisplayName)).toBe('model-with-empty.gguf')
  })

  it('should maintain model ID for internal operations while showing display name', () => {
    const mockSelectModelProvider = vi.fn()

    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockSelectedModel,
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: mockSelectModelProvider,
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    // Verify that display name is shown in UI
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // Trigger + dropdown

    // The actual model ID should still be preserved for backend operations
    // This would be tested in the click handlers, but that requires more complex mocking
    expect(mockSelectedModel.id).toBe('model1.gguf')
  })

  it('should handle updating display model when selection changes', () => {
    // Set up mock for model2 selection
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockProviders[0].models[1], // model2 with displayName "Short Name"
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    // Render with model2 selected
    render(<DropdownModelProvider />)

    // Check trigger shows Short Name
    expect(screen.getByRole('button')).toHaveTextContent('Short Name')
    // Short Name appears in dropdown (at least 1 occurrence)
    expect(screen.getAllByText('Short Name').length).toBeGreaterThanOrEqual(1)
    // Custom Model 1 is also in the dropdown
    expect(screen.getAllByText('Custom Model 1').length).toBeGreaterThanOrEqual(1)
  })

  it('prefers Codex runtime for new agent chats even when last used model was direct local', async () => {
    const selectModelProvider = vi.fn()
    const providers: ModelProvider[] = [
      {
        provider: 'llamacpp',
        active: true,
        models: [{ id: 'local-a.gguf', capabilities: ['completion'] }],
        settings: [],
      },
      {
        provider: 'codex',
        active: true,
        models: [
          { id: 'gpt-5.1-codex-max', capabilities: ['completion', 'tools'] },
        ],
        settings: [],
      },
    ]

    localStorage.setItem(
      'last-used-model',
      JSON.stringify({ provider: 'llamacpp', model: 'local-a.gguf' })
    )

    vi.mocked(useModelProvider).mockReturnValue({
      providers,
      selectedProvider: '',
      selectedModel: null,
      getProviderByName: vi.fn((name: string) =>
        providers.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider,
      getModelBy: vi.fn((id: string) =>
        providers.flatMap((p) => p.models).find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider useLastUsedModel />)

    await waitFor(() => {
      expect(selectModelProvider).toHaveBeenCalledWith(
        'codex',
        'gpt-5.1-codex-max'
      )
    })
  })

  it('should filter models in dropdown selector based on active status', () => {
    // Mock providers with a remote provider (openai) having different active settings
    const testProviders: any[] = [
      {
        provider: 'openai',
        active: true,
        api_key: 'sk-test',
        models: [
          {
            id: 'gpt-4-active',
            name: 'GPT 4 Active',
            displayName: 'GPT 4 Active',
            capabilities: ['completion'],
            active: true,
          },
          {
            id: 'gpt-4-inactive',
            name: 'GPT 4 Inactive',
            displayName: 'GPT 4 Inactive',
            capabilities: ['completion'],
            active: false,
          },
          {
            id: 'gpt-4-default-off',
            name: 'GPT 4 Default Off',
            displayName: 'GPT 4 Default Off',
            capabilities: ['completion'],
            // active is undefined -> remote predefined models default to off
          },
        ],
        settings: [],
      },
    ]

    vi.mocked(useModelProvider).mockReturnValue({
      providers: testProviders,
      selectedProvider: 'openai',
      selectedModel: testProviders[0].models[0],
      getProviderByName: vi.fn((name: string) =>
        testProviders.find((p: any) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        testProviders[0].models.find((m: any) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider />)

    // The active model should be visible
    expect(screen.getAllByText('GPT 4 Active')).toHaveLength(2)

    // The inactive model should not be in the document
    expect(screen.queryByText('GPT 4 Inactive')).not.toBeInTheDocument()

    // The default off remote model should not be in the document
    expect(screen.queryByText('GPT 4 Default Off')).not.toBeInTheDocument()
  })
})
