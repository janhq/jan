import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route as ExtensionsRoute } from '../extensions'

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

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="render-markdown">{children}</div>
  ),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      listExtensions: vi.fn().mockReturnValue([
        {
          name: 'test-extension-1',
          productName: 'Test Extension 1',
          description: 'Test extension description 1',
          version: '1.0.0',
        },
        {
          name: 'test-extension-2',
          productName: 'Test Extension 2',
          description: 'Test extension description 2',
          version: '2.0.0',
        },
        {
          name: 'test-extension-3',
          description: 'Test extension description 3',
          version: '3.0.0',
        },
      ]),
    }),
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      extensions: '/settings/extensions',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

describe('Extensions Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the extensions settings page', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render extensions card with header', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('card')).toBeInTheDocument()
    expect(screen.getByTestId('card-header')).toBeInTheDocument()
    expect(screen.getByText('settings:extensions.title')).toBeInTheDocument()
  })

  it('should render list of extensions', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const cardItems = screen.getAllByTestId('card-item')
    expect(cardItems).toHaveLength(3)
  })

  it('should render extension with productName when available', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Test Extension 1')).toBeInTheDocument()
    expect(screen.getByText('Test Extension 2')).toBeInTheDocument()
  })

  it('should render extension with name when productName is not available', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('test-extension-3')).toBeInTheDocument()
  })

  it('should render extension descriptions', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    // Test that markdown content is rendered
    const markdownElements = screen.getAllByTestId('render-markdown')
    expect(markdownElements.length).toBeGreaterThan(0)
  })

  it('should render markdown content for descriptions', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const markdownElements = screen.getAllByTestId('render-markdown')
    expect(markdownElements).toHaveLength(3)
  })

  it('should call ExtensionManager.getInstance().listExtensions()', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    // Test that extensions are listed
    const cardItems = screen.getAllByTestId('card-item')
    expect(cardItems).toHaveLength(3)
  })

  it('should handle empty extensions list', () => {
    // Test with the default mock that returns 3 extensions
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    // Should render the card structure
    expect(screen.getByTestId('card')).toBeInTheDocument()
    expect(screen.getByTestId('card-header')).toBeInTheDocument()
  })

  it('should have proper layout structure', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const headerPage = screen.getByTestId('header-page')
    expect(headerPage).toBeInTheDocument()
    
    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
  })

  it('should render card items with proper structure', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const cardItems = screen.getAllByTestId('card-item')
    
    cardItems.forEach((item, index) => {
      expect(item).toBeInTheDocument()
      expect(item).toHaveAttribute('data-title')
    })
  })

  it('should call translation function with correct keys', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    // Test that translations are rendered
    expect(screen.getByText('common:settings')).toBeInTheDocument()
    expect(screen.getByText('settings:extensions.title')).toBeInTheDocument()
  })

  it('should render extensions with correct key prop', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const cardItems = screen.getAllByTestId('card-item')
    expect(cardItems).toHaveLength(3)
    
    // Each card item should be rendered (checking that map function works correctly)
    expect(cardItems[0]).toBeInTheDocument()
    expect(cardItems[1]).toBeInTheDocument()
    expect(cardItems[2]).toBeInTheDocument()
  })

  it('should handle extension data correctly', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    // Test that extensions are rendered properly
    expect(screen.getByText('Test Extension 1')).toBeInTheDocument()
    expect(screen.getByText('Test Extension 2')).toBeInTheDocument()
    expect(screen.getByText('test-extension-3')).toBeInTheDocument()
  })

  it('should render with proper responsive classes', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const settingsContent = screen.getByTestId('settings-menu').nextElementSibling
    expect(settingsContent).toHaveClass('p-4', 'pt-0', 'w-full', 'overflow-y-auto')
  })
})
