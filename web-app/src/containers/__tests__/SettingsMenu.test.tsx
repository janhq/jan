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
  })),
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
  })

  it('renders all menu items', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('common:general')).toBeInTheDocument()
    expect(screen.getByText('common:interface')).toBeInTheDocument()
    expect(screen.getByText('common:privacy')).toBeInTheDocument()
    expect(screen.getByText('common:modelProviders')).toBeInTheDocument()
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

    // Providers should be expanded by default (expandedProviders starts as true)
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
    expect(screen.getByTestId('provider-avatar-llama.cpp')).toBeInTheDocument()
  })

  it('collapses providers submenu when chevron is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    // Providers should be visible initially
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()

    // Click the chevron to collapse
    const chevronButtons = screen.getAllByRole('button')
    const chevron = chevronButtons[0]
    await user.click(chevron)

    // After clicking, providers should be hidden
    expect(screen.queryByTestId('provider-avatar-openai')).not.toBeInTheDocument()
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

    // Providers are expanded by default, so click on a provider directly
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

  it('filters out inactive providers from submenu', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        {
          provider: 'openai',
          active: true,
          models: [],
        },
        {
          provider: 'anthropic',
          active: false,
          models: [],
        },
      ],
    })

    render(<SettingsMenu />)

    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
    expect(
      screen.queryByTestId('provider-avatar-anthropic')
    ).not.toBeInTheDocument()
  })
})
