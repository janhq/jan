import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route } from '../index'
import { useModelProvider } from '@/hooks/useModelProvider'

// Mock all dependencies
vi.mock('@/containers/ChatInput', () => ({
  default: ({ model, showSpeedToken, initialMessage }: any) => (
    <div data-testid="chat-input">
      ChatInput - Model: {model?.id || 'none'}, Speed: {showSpeedToken ? 'yes' : 'no'}, Initial: {initialMessage ? 'yes' : 'no'}
    </div>
  ),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/SetupScreen', () => ({
  default: () => <div data-testid="setup-screen">SetupScreen</div>,
}))

vi.mock('@/containers/DropdownAssistant', () => ({
  default: () => <div data-testid="dropdown-assistant">DropdownAssistant</div>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'chat:welcome': 'Welcome to Jan',
        'chat:description': 'Start chatting with AI models',
      }
      return translations[key] || key
    },
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    providers: [
      {
        provider: 'openai',
        api_key: 'test-key',
        models: [],
      },
    ],
  })),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({
    setCurrentThreadId: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (route: string) => (config: any) => ({ 
    ...config,
    route,
  }),
  useSearch: () => ({
    model: undefined,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    home: '/',
  },
}))

describe('routes/index.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default mock
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        {
          provider: 'openai',
          api_key: 'test-key',
          models: [],
        },
      ],
    })
  })
  it('should render welcome page when providers are valid', () => {
    const Component = Route.component
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeDefined()
    expect(screen.getByTestId('dropdown-assistant')).toBeDefined()
    expect(screen.getByTestId('chat-input')).toBeDefined()
    expect(screen.getByText('Welcome to Jan')).toBeDefined()
    expect(screen.getByText('Start chatting with AI models')).toBeDefined()
  })

  it('should render setup screen when no valid providers', () => {
    // Re-mock useModelProvider to return no valid providers
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        {
          provider: 'openai',
          api_key: '',
          models: [],
        },
      ],
    })

    const Component = Route.component
    render(<Component />)

    expect(screen.getByTestId('setup-screen')).toBeDefined()
    expect(screen.queryByTestId('header-page')).toBeNull()
  })

  it('should pass correct props to ChatInput', () => {
    const Component = Route.component
    render(<Component />)

    const chatInput = screen.getByTestId('chat-input')
    expect(chatInput.textContent).toContain('Model: none')
    expect(chatInput.textContent).toContain('Speed: no')
    expect(chatInput.textContent).toContain('Initial: yes')
  })

  it('should validate search params correctly', () => {
    const searchParams = Route.validateSearch({
      model: { id: 'test-model', provider: 'openai' },
      other: 'ignored',
    })

    expect(searchParams).toEqual({
      model: { id: 'test-model', provider: 'openai' },
    })
  })

  it('should handle llamacpp provider with models', () => {
    // Re-mock useModelProvider to return llamacpp with models
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        {
          provider: 'llamacpp',
          api_key: '',
          models: ['model1'],
        },
      ],
    })

    const Component = Route.component
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeDefined()
    expect(screen.queryByTestId('setup-screen')).toBeNull()
  })
})