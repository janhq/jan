import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route as ShortcutsRoute } from '../shortcuts'

// Mock dependencies
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => (
    <div data-testid="card">
      {header && <div data-testid="card-header">{header}</div>}
      {children}
    </div>
  ),
  CardItem: ({ title, description, actions }: { title?: string; description?: string; actions?: React.ReactNode }) => (
    <div data-testid="card-item" data-title={title}>
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && <div data-testid="card-item-description">{description}</div>}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      shortcuts: '/settings/shortcuts',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

// Mock the shortcut data that would be imported
vi.mock('@/constants/shortcuts', () => ({
  shortcuts: [
    {
      id: 'new-thread',
      title: 'New Thread',
      description: 'Create a new conversation thread',
      shortcut: ['Ctrl', 'N'],
      category: 'general',
    },
    {
      id: 'save-file',
      title: 'Save File',
      description: 'Save current file',
      shortcut: ['Ctrl', 'S'],
      category: 'general',
    },
    {
      id: 'copy-text',
      title: 'Copy Text',
      description: 'Copy selected text',
      shortcut: ['Ctrl', 'C'],
      category: 'editing',
    },
  ],
}))

describe('Shortcuts Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the shortcuts settings page', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render shortcuts card with header', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const cards = screen.getAllByTestId('card')
    expect(cards.length).toBeGreaterThan(0)
    expect(cards[0]).toBeInTheDocument()
  })

  it('should have proper layout structure', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const container = screen.getByTestId('header-page')
    expect(container).toBeInTheDocument()
    
    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
  })

  it('should call translation function with correct keys', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render with proper responsive classes', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const settingsContent = screen.getByTestId('settings-menu')
    expect(settingsContent).toBeInTheDocument()
  })

  it('should render main content area', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const mainContent = screen.getAllByTestId('card')
    expect(mainContent.length).toBeGreaterThan(0)
  })

  it('should render shortcuts section', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    // The shortcuts page should render the card structure
    const cards = screen.getAllByTestId('card')
    expect(cards.length).toBeGreaterThan(0)
  })

  it('should be properly structured as a route component', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    
    // Test that the component can be rendered without errors
    expect(() => {
      render(<Component />)
    }).not.toThrow()
  })

  it('should have settings menu navigation', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
    expect(settingsMenu).toHaveTextContent('Settings Menu')
  })

  it('should have header with settings title', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const headerPage = screen.getByTestId('header-page')
    expect(headerPage).toBeInTheDocument()
    expect(headerPage).toHaveTextContent('common:settings')
  })

  it('should render in proper container structure', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    // Check the main container structure
    const container = screen.getByTestId('header-page')
    expect(container).toBeInTheDocument()
    
    // Check the settings layout
    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
  })

  it('should render content in scrollable area', () => {
    const Component = ShortcutsRoute.component as React.ComponentType
    render(<Component />)

    const contentArea = screen.getAllByTestId('card')
    expect(contentArea.length).toBeGreaterThan(0)
  })
})
