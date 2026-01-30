import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Route as InterfaceRoute } from '../interface'

// Mock all the dependencies
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div data-testid="card" data-title={title}>
      {title && <div data-testid="card-title">{title}</div>}
      {children}
    </div>
  ),
  CardItem: ({ title, description, actions, className }: { title?: string; description?: string; actions?: React.ReactNode; className?: string }) => (
    <div data-testid="card-item" data-title={title} className={className}>
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && <div data-testid="card-item-description">{description}</div>}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/containers/ThemeSwitcher', () => ({
  ThemeSwitcher: () => <div data-testid="theme-switcher">Theme Switcher</div>,
}))

vi.mock('@/containers/FontSizeSwitcher', () => ({
  FontSizeSwitcher: () => <div data-testid="font-size-switcher">Font Size Switcher</div>,
}))

vi.mock('@/containers/AccentColorPicker', () => ({
  AccentColorPicker: () => <div data-testid="accent-color-picker">Accent Color Picker</div>,
}))

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: () => ({
    resetInterface: vi.fn(),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void; [key: string]: any }) => (
    <button data-testid="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      interface: '/settings/interface',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

describe('Interface Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the interface settings page', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render interface controls', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('theme-switcher')).toBeInTheDocument()
    expect(screen.getByTestId('font-size-switcher')).toBeInTheDocument()
    expect(screen.getByTestId('accent-color-picker')).toBeInTheDocument()
  })

  it('should render reset interface button', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const resetButtons = screen.getAllByTestId('button')
    expect(resetButtons.length).toBeGreaterThan(0)
  })

  it('should render reset buttons', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const resetButtons = screen.getAllByTestId('button')
    expect(resetButtons.length).toBeGreaterThan(0)

    // Check that buttons are clickable
    resetButtons.forEach(button => {
      expect(button).toBeInTheDocument()
    })
  })

  it('should render reset functionality', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const resetButtons = screen.getAllByTestId('button')
    expect(resetButtons.length).toBeGreaterThan(0)

    // Verify buttons can be clicked without errors
    resetButtons.forEach(button => {
      fireEvent.click(button)
      expect(button).toBeInTheDocument()
    })
  })

  it('should render all card items with proper structure', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const cardItems = screen.getAllByTestId('card-item')
    expect(cardItems.length).toBeGreaterThan(0)

    // Check that cards have proper structure
    const cards = screen.getAllByTestId('card')
    expect(cards.length).toBeGreaterThan(0)
  })

  it('should have proper responsive layout classes', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const cardItems = screen.getAllByTestId('card-item')

    // Check that some card items have responsive classes
    const responsiveItems = cardItems.filter(item =>
      item.className?.includes('flex-col') ||
      item.className?.includes('sm:flex-row')
    )

    expect(responsiveItems.length).toBeGreaterThan(0)
  })

  it('should render main layout structure', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const headerPage = screen.getByTestId('header-page')
    expect(headerPage).toBeInTheDocument()

    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
  })
})
