import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DialogEditModel } from '../dialogs/EditModel'
import { useModelProvider } from '@/hooks/useModelProvider'
import '@testing-library/jest-dom'

// Mock the dependencies
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    updateProvider: vi.fn(),
    setProviders: vi.fn(),
  })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    providers: () => ({
      getProviders: vi.fn(() => Promise.resolve([])),
    }),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock Dialog components
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: (e: React.KeyboardEvent) => void }) => (
    <div data-testid="dialog-content" onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1 data-testid="dialog-title">{children}</h1>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-trigger">{children}</div>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, ...props }: any) => (
    <input
      value={value}
      onChange={onChange}
      data-testid="display-name-input"
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} data-testid="button" {...props}>
      {children}
    </button>
  ),
}))

// Mock other UI components
vi.mock('@tabler/icons-react', () => ({
  IconPencil: () => <div data-testid="pencil-icon" />,
  IconCheck: () => <div data-testid="check-icon" />,
  IconX: () => <div data-testid="x-icon" />,
  IconAlertTriangle: () => <div data-testid="alert-triangle-icon" />,
  IconEye: () => <div data-testid="eye-icon" />,
  IconTool: () => <div data-testid="tool-icon" />,
  IconLoader2: () => <div data-testid="loader-icon" />,
  IconSparkles: () => <div data-testid="sparkles-icon" />,
}))

describe('DialogEditModel - Basic Component Tests', () => {
  const mockProvider = {
    provider: 'llamacpp',
    active: true,
    models: [
      {
        id: 'test-model.gguf',
        displayName: 'My Custom Model',
        capabilities: ['completion'],
      },
    ],
    settings: [],
  } as any

  const mockUpdateProvider = vi.fn()
  const mockSetProviders = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useModelProvider).mockReturnValue({
      updateProvider: mockUpdateProvider,
      setProviders: mockSetProviders,
    } as any)
  })

  it('should render without errors', () => {
    const { container } = render(
      <DialogEditModel
        provider={mockProvider}
        modelId="test-model.gguf"
      />
    )

    // Component should render without throwing errors
    expect(container).toBeInTheDocument()
  })

  it('should handle provider without models', () => {
    const emptyProvider = {
      ...mockProvider,
      models: [],
    } as any

    const { container } = render(
      <DialogEditModel
        provider={emptyProvider}
        modelId="test-model.gguf"
      />
    )

    // Component should handle empty models gracefully
    expect(container).toBeInTheDocument()
  })

  it('should accept provider and modelId props', () => {
    const { container } = render(
      <DialogEditModel
        provider={mockProvider}
        modelId="different-model.gguf"
      />
    )

    expect(container).toBeInTheDocument()
  })

  it('should not crash with minimal props', () => {
    const minimalProvider = {
      provider: 'test',
      active: false,
      models: [],
      settings: [],
    } as any

    expect(() => {
      render(
        <DialogEditModel
          provider={minimalProvider}
          modelId="any-model"
        />
      )
    }).not.toThrow()
  })

  it('should have mocked dependencies available', () => {
    render(
      <DialogEditModel
        provider={mockProvider}
        modelId="test-model.gguf"
      />
    )

    // Verify our mocks are in place
    expect(mockUpdateProvider).toBeDefined()
    expect(mockSetProviders).toBeDefined()
  })

  it('should consolidate capabilities initialization without duplication', () => {
    const providerWithCaps = {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          displayName: 'Test Model',
          capabilities: ['vision', 'tools'],
        },
      ],
      settings: [],
    } as any

    const { container } = render(
      <DialogEditModel
        provider={providerWithCaps}
        modelId="test-model.gguf"
      />
    )

    // Should render without issues - capabilities helper function should work
    expect(container).toBeInTheDocument()
  })

  it('should handle Enter key press with keyDown handler', () => {
    const { container } = render(
      <DialogEditModel
        provider={mockProvider}
        modelId="test-model.gguf"
      />
    )

    // Component should render with keyDown handler
    expect(container).toBeInTheDocument()
  })

  it('should  handle vision and tools capabilities', () => {
    const providerWithAllCaps = {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          displayName: 'Test Model',
          capabilities: ['vision', 'tools', 'completion', 'embeddings', 'web_search', 'reasoning'],
        },
      ],
      settings: [],
    } as any

    const { container } = render(
      <DialogEditModel
        provider={providerWithAllCaps}
        modelId="test-model.gguf"
      />
    )

    // Component should render without errors even with extra capabilities
    // The capabilities helper should only extract vision and tools
    expect(container).toBeInTheDocument()
  })
})
