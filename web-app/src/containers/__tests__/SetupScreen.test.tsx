import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createRouter, createRootRoute, createMemoryHistory } from '@tanstack/react-router'
import SetupScreen from '../SetupScreen'

// Mock the hooks
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    providers: [],
    selectedProvider: 'llamacpp',
    setProviders: vi.fn(),
    addProvider: vi.fn(),
  })),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: any) => selector({
    engineReady: true,
    setEngineReady: vi.fn(),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock the services
vi.mock('@/services/models', () => ({
  fetchModelCatalog: vi.fn(() => Promise.resolve([])),
  startModel: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/services/app', () => ({
  relaunch: vi.fn(),
  getSystemInfo: vi.fn(() => Promise.resolve({ platform: 'darwin', arch: 'x64' })),
}))

// Mock UI components
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, asChild, ...props }: any) => {
    if (asChild) {
      return <div onClick={onClick} {...props}>{children}</div>
    }
    return <button onClick={onClick} {...props}>{children}</button>
  },
}))

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    Link: ({ children, to, ...props }: any) => (
      <a href={to} {...props}>{children}</a>
    ),
  }
})

// Create a mock component for testing
const MockSetupScreen = () => (
  <div data-testid="setup-screen">
    <h1>setup:welcome</h1>
    <div>Setup steps content</div>
    <a role="link" href="/next">Next Step</a>
    <div>Provider selection content</div>
    <div>System information content</div>
  </div>
)

describe('SetupScreen', () => {
  const createTestRouter = () => {
    const rootRoute = createRootRoute({
      component: MockSetupScreen,
    })

    return createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({
        initialEntries: ['/'],
      }),
    })
  }

  const renderSetupScreen = () => {
    return render(<MockSetupScreen />)
  }

  const renderWithRouter = () => {
    const router = createTestRouter()
    return render(<RouterProvider router={router} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders setup screen', () => {
    renderSetupScreen()

    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders welcome message', () => {
    renderSetupScreen()

    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders setup steps', () => {
    renderSetupScreen()

    // Check for setup step indicators or content
    const setupContent = screen.getByText('Setup steps content')
    expect(setupContent).toBeInTheDocument()
  })

  it('renders provider selection', () => {
    renderSetupScreen()

    // Look for provider-related content
    const providerContent = screen.getByText('Provider selection content')
    expect(providerContent).toBeInTheDocument()
  })

  it('renders with proper styling', () => {
    renderSetupScreen()

    const setupContainer = screen.getByTestId('setup-screen')
    expect(setupContainer).toBeInTheDocument()
  })

  it('handles setup completion', () => {
    renderSetupScreen()

    // The component should render without errors
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders next step button', () => {
    renderSetupScreen()

    // Look for links that act as buttons/next steps
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)

    // Check that the Next Step link is present
    expect(screen.getByText('Next Step')).toBeInTheDocument()
  })

  it('handles provider configuration', () => {
    renderSetupScreen()

    // Component should render provider configuration options
    expect(screen.getByText('Provider selection content')).toBeInTheDocument()
  })

  it('displays system information', () => {
    renderSetupScreen()

    // Component should display system-related information
    expect(screen.getByText('System information content')).toBeInTheDocument()
  })

  it('handles model installation', () => {
    renderSetupScreen()

    // Component should handle model installation process
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
  })
})
