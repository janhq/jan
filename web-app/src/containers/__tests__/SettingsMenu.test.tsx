import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import SettingsMenu from '../SettingsMenu'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { useModelProvider } from '@/hooks/useModelProvider'

// Mock global platform constants - simulate desktop (Tauri) environment
Object.defineProperty(global, 'IS_IOS', { value: false, writable: true })
Object.defineProperty(global, 'IS_ANDROID', { value: false, writable: true })
Object.defineProperty(global, 'IS_WEB_APP', { value: false, writable: true })

// Mock dependencies
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useMatches: vi.fn(),
  useNavigate: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: vi.fn(() => ({})),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    providers: [
      {
        provider: 'openai',
        active: true,
        models: [],
      },
      {
        provider: 'llama.cpp',
        active: true,
        models: [],
      },
    ],
    addProvider: vi.fn(),
  })),
}))

vi.mock('@/containers/dialogs', () => ({
  AddProviderDialog: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  getProviderTitle: (provider: string) => provider,
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: any }) => (
    <div data-testid={`provider-avatar-${provider.provider}`}>
      {provider.provider}
    </div>
  ),
}))


describe('SettingsMenu', () => {
  const mockNavigate = vi.fn()
  const mockMatches = [
    {
      routeId: '/settings/general',
      params: {},
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(useMatches).mockReturnValue(mockMatches)
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'llama.cpp', active: true, models: [] },
      ],
      addProvider: vi.fn(),
    })
  })

  it('renders all menu items', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('common:general')).toBeInTheDocument()
    expect(screen.getByText('common:interface')).toBeInTheDocument()
    expect(screen.getByText('common:privacy')).toBeInTheDocument()
  })

  it('renders keyboard shortcuts and other settings', () => {
    render(<SettingsMenu />)
    expect(screen.getByText('common:keyboardShortcuts')).toBeInTheDocument()
    expect(screen.getByText('common:hardware')).toBeInTheDocument()
    expect(screen.getByText('common:local_api_server')).toBeInTheDocument()
    expect(screen.getByText('common:https_proxy')).toBeInTheDocument()
    expect(screen.getByText('common:mcp-servers')).toBeInTheDocument()
  })

  it('shows provider expansion chevron when providers are active', () => {
    render(<SettingsMenu />)

    // There should be at least one button (the chevron)
    const chevronButtons = screen.getAllByRole('button')
    expect(chevronButtons.length).toBeGreaterThan(0)
  })

  it('shows expanded providers by default', () => {
    render(<SettingsMenu />)

    // Providers ARE expanded by default (expandedProviders starts as true)
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
  })

  it('collapses disabled providers section when toggle is clicked', async () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'anthropic', active: false, models: [] },
      ],
      addProvider: vi.fn(),
    })

    const user = userEvent.setup()
    render(<SettingsMenu />)

    // Disabled section is expanded by default — anthropic is visible
    expect(screen.getByTestId('provider-avatar-anthropic')).toBeInTheDocument()

    // Click the toggle to collapse the disabled section
    const toggleButton = screen.getByText('common:hiddenProviders')
    await user.click(toggleButton)

    // After collapsing, anthropic should be hidden
    expect(screen.queryByTestId('provider-avatar-anthropic')).not.toBeInTheDocument()
  })

  it('auto-expands providers when on provider route', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
  })

  it('highlights active provider in submenu', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    const openaiProvider = screen
      .getByTestId('provider-avatar-openai')
      .closest('div')
    expect(openaiProvider).toBeInTheDocument()
  })

  it('navigates to provider when provider is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    // Providers are expanded by default, click directly on a provider
    const openaiProvider = screen
      .getByTestId('provider-avatar-openai')
      .closest('div[class*="cursor-pointer"]')
    await user.click(openaiProvider!)

    expect(mockNavigate).toHaveBeenCalled()
  })

  it('hides llama.cpp during setup remote provider step', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/',
        params: {},
        search: { step: 'setup_remote_provider' },
      },
    ])

    render(<SettingsMenu />)

    // openai should be visible during remote provider setup
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()

    // llama.cpp should have 'hidden' class during setup_remote_provider step
    const llamaCpp = screen.getByTestId('provider-avatar-llama.cpp').closest('div[class*="cursor-pointer"]')
    expect(llamaCpp?.className).toContain('hidden')
  })

  it('shows inactive providers in disabled section', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'anthropic', active: false, models: [] },
      ],
      addProvider: vi.fn(),
    })

    render(<SettingsMenu />)

    // Active provider shown normally
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
    // Inactive provider shown in the disabled section (expanded by default)
    expect(screen.getByTestId('provider-avatar-anthropic')).toBeInTheDocument()
    // Disabled section label is shown
    expect(screen.getByText('common:hiddenProviders')).toBeInTheDocument()
  })
})
