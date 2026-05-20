/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  productAnalyticPrompt: false,
  showJanModelPrompt: false,
  leftPanelOpen: true,
  sidebarWidth: 260,
  setLeftPanel: vi.fn(),
  setLeftPanelWidth: vi.fn(),
}))

// Tanstack router — avoid real router internals.
vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (config: any) => ({ ...config, id: '__root' }),
  Outlet: () => <div data-testid="outlet" />,
}))

// Tauri API
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    startDragging: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Providers
vi.mock('@/providers/ThemeProvider', () => ({
  ThemeProvider: () => <div data-testid="theme-provider" />,
}))
vi.mock('@/providers/InterfaceProvider', () => ({
  InterfaceProvider: () => <div data-testid="interface-provider" />,
}))
vi.mock('@/providers/KeyboardShortcuts', () => ({
  KeyboardShortcutsProvider: () => <div data-testid="keyboard-provider" />,
}))
vi.mock('@/providers/DataProvider', () => ({
  DataProvider: () => <div data-testid="data-provider" />,
}))
vi.mock('@/providers/ExtensionProvider', () => ({
  ExtensionProvider: ({ children }: any) => (
    <div data-testid="extension-provider">{children}</div>
  ),
}))
vi.mock('@/providers/ToasterProvider', () => ({
  ToasterProvider: () => <div data-testid="toaster-provider" />,
}))
vi.mock('@/providers/AnalyticProvider', () => ({
  AnalyticProvider: () => <div data-testid="analytic-provider" />,
}))
vi.mock('@/providers/GlobalEventHandler', () => ({
  GlobalEventHandler: () => <div data-testid="global-event" />,
}))
vi.mock('@/providers/ServiceHubProvider', () => ({
  ServiceHubProvider: ({ children }: any) => (
    <div data-testid="service-hub">{children}</div>
  ),
}))

// i18n
vi.mock('@/i18n/TranslationContext', () => ({
  TranslationProvider: ({ children }: any) => (
    <div data-testid="translation">{children}</div>
  ),
}))

// Dialogs / containers
vi.mock('@/containers/dialogs/AppUpdater', () => ({
  default: () => <div data-testid="app-updater" />,
}))
vi.mock('@/containers/dialogs/BackendUpdater', () => ({
  default: () => <div data-testid="backend-updater" />,
}))
vi.mock('@/containers/dialogs/ToolApproval', () => ({
  default: () => <div data-testid="tool-approval" />,
}))
vi.mock('@/containers/dialogs/OutOfContextDialog', () => ({
  default: () => <div data-testid="oocp" />,
}))
vi.mock('@/containers/dialogs/AttachmentIngestionDialog', () => ({
  default: () => <div data-testid="attach-ingest" />,
}))
vi.mock('@/containers/dialogs/ErrorDialog', () => ({
  default: () => <div data-testid="error-dialog" />,
}))
vi.mock('@/containers/analytics/PromptAnalytic', () => ({
  PromptAnalytic: () => <div data-testid="prompt-analytic" />,
}))
vi.mock('@/containers/PromptJanModel', () => ({
  PromptJanModel: () => <div data-testid="prompt-jan" />,
}))
vi.mock('@/containers/GlobalError', () => ({
  default: ({ error }: any) => <div data-testid="global-error">{error?.message}</div>,
}))

// Components
vi.mock('@/components/left-sidebar', () => ({
  LeftSidebar: () => <div data-testid="left-sidebar" />,
}))
vi.mock('@/components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  SidebarInset: ({ children }: any) => (
    <div data-testid="sidebar-inset">{children}</div>
  ),
}))

// Hooks
vi.mock('@/hooks/useAnalytic', () => ({
  useAnalytic: () => ({ productAnalyticPrompt: h.productAnalyticPrompt }),
}))
vi.mock('@/hooks/useJanModelPrompt', () => ({
  useJanModelPrompt: () => ({ showJanModelPrompt: h.showJanModelPrompt }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: () => ({
    open: h.leftPanelOpen,
    setLeftPanel: h.setLeftPanel,
    width: h.sidebarWidth,
    setLeftPanelWidth: h.setLeftPanelWidth,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    localApiServerlogs: '/local-api-server/logs',
    systemMonitor: '/system-monitor',
    appLogs: '/logs',
  },
}))

import { Route } from '../__root'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('__root route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.productAnalyticPrompt = false
    h.showJanModelPrompt = false
    // reset document state
    document.body.className = ''
    const loader = document.getElementById('initial-loader')
    if (loader) loader.remove()
    // default pathname: not a logs route
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders AppLayout by default (non-logs route)', () => {
    renderComponent()
    expect(screen.getByTestId('service-hub')).toBeInTheDocument()
    expect(screen.getByTestId('theme-provider')).toBeInTheDocument()
    expect(screen.getByTestId('extension-provider')).toBeInTheDocument()
    expect(screen.getByTestId('data-provider')).toBeInTheDocument()
    expect(screen.getByTestId('left-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-provider')).toBeInTheDocument()
  })

  it('renders all persistent dialogs', () => {
    renderComponent()
    expect(screen.getByTestId('tool-approval')).toBeInTheDocument()
    expect(screen.getByTestId('attach-ingest')).toBeInTheDocument()
    expect(screen.getByTestId('error-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('oocp')).toBeInTheDocument()
    expect(screen.getByTestId('app-updater')).toBeInTheDocument()
    expect(screen.getByTestId('backend-updater')).toBeInTheDocument()
  })

  it('renders PromptAnalytic when productAnalyticPrompt is true', () => {
    h.productAnalyticPrompt = true
    renderComponent()
    expect(screen.getByTestId('prompt-analytic')).toBeInTheDocument()
  })

  it('does not render PromptAnalytic when productAnalyticPrompt is false', () => {
    h.productAnalyticPrompt = false
    renderComponent()
    expect(screen.queryByTestId('prompt-analytic')).not.toBeInTheDocument()
  })

  it('renders PromptJanModel when showJanModelPrompt is true', () => {
    h.showJanModelPrompt = true
    renderComponent()
    expect(screen.getByTestId('prompt-jan')).toBeInTheDocument()
  })

  it('uses LogsLayout on /logs path (no sidebar)', () => {
    window.history.pushState({}, '', '/logs')
    renderComponent()
    expect(screen.queryByTestId('left-sidebar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-provider')).not.toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('uses LogsLayout on /system-monitor path', () => {
    window.history.pushState({}, '', '/system-monitor')
    renderComponent()
    expect(screen.queryByTestId('left-sidebar')).not.toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('uses LogsLayout on /local-api-server/logs path', () => {
    window.history.pushState({}, '', '/local-api-server/logs')
    renderComponent()
    expect(screen.queryByTestId('left-sidebar')).not.toBeInTheDocument()
  })

  it('adds "loaded" class to body after mount timer fires', () => {
    vi.useFakeTimers()
    renderComponent()
    expect(document.body.classList.contains('loaded')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(210)
    })
    // requestAnimationFrame runs synchronously in jsdom via mock or schedules; run both
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(document.body.classList.contains('loaded')).toBe(true)
  })

  it('removes #initial-loader element after mount', () => {
    vi.useFakeTimers()
    const loader = document.createElement('div')
    loader.id = 'initial-loader'
    document.body.appendChild(loader)
    renderComponent()
    expect(document.getElementById('initial-loader')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(210)
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(document.getElementById('initial-loader')).toBeNull()
  })

  it('errorComponent renders GlobalError with provided error', () => {
    const ErrComp = (Route as any).errorComponent as React.ComponentType<{ error: Error }>
    render(<ErrComp error={new Error('broken')} />)
    expect(screen.getByTestId('global-error')).toHaveTextContent('broken')
  })
})
