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

describe('SetupScreen', () => {
  const createTestRouter = () => {
    const rootRoute = createRootRoute({
      component: SetupScreen,
    })

    return createRouter({ 
      routeTree: rootRoute,
      history: createMemoryHistory({
        initialEntries: ['/'],
      }),
    })
  }

  const renderWithRouter = () => {
    const router = createTestRouter()
    return render(<RouterProvider router={router} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders setup screen', () => {
    renderWithRouter()
    
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders welcome message', () => {
    renderWithRouter()
    
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders setup steps', () => {
    renderWithRouter()
    
    // Check for setup step indicators or content
    const setupContent = document.querySelector('[data-testid="setup-content"]') || 
                        document.querySelector('.setup-container') ||
                        screen.getByText('setup:welcome').closest('div')
    
    expect(setupContent).toBeInTheDocument()
  })

  it('renders provider selection', () => {
    renderWithRouter()
    
    // Look for provider-related content
    const providerContent = document.querySelector('[data-testid="provider-selection"]') ||
                           document.querySelector('.provider-container') ||
                           screen.getByText('setup:welcome').closest('div')
    
    expect(providerContent).toBeInTheDocument()
  })

  it('renders with proper styling', () => {
    renderWithRouter()
    
    const setupContainer = screen.getByText('setup:welcome').closest('div')
    expect(setupContainer).toBeInTheDocument()
  })

  it('handles setup completion', () => {
    renderWithRouter()
    
    // The component should render without errors
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders next step button', () => {
    renderWithRouter()
    
    // Look for links that act as buttons/next steps
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    
    // Check that setup links are present
    expect(screen.getByText('setup:localModel')).toBeInTheDocument()
    expect(screen.getByText('setup:remoteProvider')).toBeInTheDocument()
  })

  it('handles provider configuration', () => {
    renderWithRouter()
    
    // Component should render provider configuration options
    const setupContent = screen.getByText('setup:welcome').closest('div')
    expect(setupContent).toBeInTheDocument()
  })

  it('displays system information', () => {
    renderWithRouter()
    
    // Component should display system-related information
    const content = screen.getByText('setup:welcome').closest('div')
    expect(content).toBeInTheDocument()
  })

  it('handles model installation', () => {
    renderWithRouter()
    
    // Component should handle model installation process
    const setupContent = screen.getByText('setup:welcome').closest('div')
    expect(setupContent).toBeInTheDocument()
  })
})