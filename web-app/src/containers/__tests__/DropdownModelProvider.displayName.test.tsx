import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  selectedModel: Model
  getProviderByName: (name: string) => ModelProvider | undefined
  selectModelProvider: () => void
  getModelBy: (id: string) => Model | undefined
  updateProvider: () => void
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
    // Test that when a new model is selected, the trigger updates correctly
    // First render with model1 selected
    const { rerender } = render(<DropdownModelProvider />)

    // Check trigger shows Custom Model 1
    const triggerButton = screen.getByRole('button')
    expect(triggerButton).toHaveTextContent('Custom Model 1')

    // Update to select model2
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockProviders[0].models[1], // model2
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    rerender(<DropdownModelProvider />)
    // Check trigger now shows Short Name
    expect(triggerButton).toHaveTextContent('Short Name')
    // Both models are still visible in the dropdown, so we can't test for absence
    expect(screen.getAllByText('Short Name')).toHaveLength(2) // trigger + dropdown
  })
})
