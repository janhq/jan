import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route as ExtensionsRoute } from '../extensions/index'

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

const hosted = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({
    list: () => hosted.list,
    onDidChange: () => ({ dispose: () => undefined }),
  }),
}))

vi.mock('@/containers/extensions/ExtensionSettingsForm', () => ({
  ExtensionSettingsForm: ({ extensionId }: { extensionId: string }) => (
    <div data-testid={`settings-form-${extensionId}`} />
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
      extensions: '/settings/extensions',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

describe('Extensions Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hosted.list = []
  })

  it('lists host extensions with their settings form when active', () => {
    const manifest = (id: string, settings: unknown[]) => ({
      id,
      displayName: `Host ${id}`,
      version: '0.1.0',
      contributes: { settings },
    })
    const setting = {
      key: 'k',
      title: 'K',
      control: { type: 'checkbox', default: false },
    }
    hosted.list = [
      { id: 'acme.on', manifest: manifest('acme.on', [setting]), source: 'builtin', state: 'active' },
      {
        id: 'acme.off',
        manifest: manifest('acme.off', [setting]),
        source: 'builtin',
        state: 'failed',
        error: 'boom',
      },
    ]
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Host acme.on')).toBeInTheDocument()
    expect(screen.getByText('extensions:state.active')).toBeInTheDocument()
    expect(screen.getByTestId('settings-form-acme.on')).toBeInTheDocument()
    expect(screen.getByText('Host acme.off')).toBeInTheDocument()
    expect(screen.getByText('extensions:activationFailed')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-form-acme.off')).toBeNull()
  })

  it('should render the extensions settings page', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('shows the built-in section even with no hosted extension', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('extensions:sections.builtin')).toBeInTheDocument()
    expect(screen.queryByTestId('card-item')).toBeNull()
  })

  it('should render with proper responsive classes', () => {
    const Component = ExtensionsRoute.component as React.ComponentType
    render(<Component />)

    const settingsContent = screen.getByTestId('settings-menu').nextElementSibling
    expect(settingsContent).toHaveClass('p-4', 'pt-0', 'w-full', 'overflow-y-auto')
  })
})
