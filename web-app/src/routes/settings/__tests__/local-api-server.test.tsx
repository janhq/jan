import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, component: config.component }),
}))
vi.mock('@/constants/routes', () => ({ route: { settings: { local_api_server: '/settings/local-api-server' } } }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: any) => <div data-testid="header-page">{children}</div> }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => <div data-testid="settings-menu" /> }))
vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: any) => <div data-testid="card">{header}{children}</div>,
  CardItem: ({ title, description, actions }: any) => (
    <div data-testid="card-item">
      <span>{typeof title === 'string' ? title : ''}</span>
      <div>{description}</div>
      {actions}
    </div>
  ),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => <input type="checkbox" data-testid="switch" checked={checked} onChange={(e: any) => onCheckedChange?.(e.target.checked)} />,
}))
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: any) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: any) => <div>{children}</div>,
  CollapsibleContent: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('@tabler/icons-react', () => ({
  IconSettings2: () => <span />, IconChevronDown: () => <span />, IconChevronUp: () => <span />,
  IconExternalLink: () => <span />, IconLoader2: () => <span />,
}))
vi.mock('lucide-react', () => ({ ChevronsUpDown: () => <span /> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }))
vi.mock('@/containers/ServerHostSwitcher', () => ({ ServerHostSwitcher: () => <div /> }))
vi.mock('@/containers/PortInput', () => ({ PortInput: () => <div /> }))
vi.mock('@/containers/ProxyTimeoutInput', () => ({ ProxyTimeoutInput: () => <div /> }))
vi.mock('@/containers/ApiPrefixInput', () => ({ ApiPrefixInput: () => <div /> }))
vi.mock('@/containers/TrustedHostsInput', () => ({ TrustedHostsInput: () => <div /> }))
vi.mock('@/containers/ApiKeyInput', () => ({ ApiKeyInput: () => <div /> }))
vi.mock('@/components/LogViewer', () => ({ LogViewer: () => <div data-testid="log-viewer" /> }))
vi.mock('@/utils/ensureModelForServer', () => ({ ensureModelForServer: vi.fn() }))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    corsEnabled: false, setCorsEnabled: vi.fn(), verboseLogs: false, setVerboseLogs: vi.fn(),
    enableOnStartup: false, setEnableOnStartup: vi.fn(), serverHost: 'localhost',
    serverPort: 1337, setServerPort: vi.fn(), apiPrefix: '/v1', apiKey: 'test-key',
    trustedHosts: [], proxyTimeout: 30000, enableServerToolExecution: false,
    setEnableServerToolExecution: vi.fn(), setLastServerModels: vi.fn(),
    defaultModelLocalApiServer: null, setDefaultModelLocalApiServer: vi.fn(),
  }),
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: (sel?: any) => {
    const state = { serverStatus: 'stopped', setServerStatus: vi.fn(), setActiveModels: vi.fn() }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/hooks/useModelProvider', () => {
  const fn = (sel?: any) => {
    const state = { providers: [] }
    return sel ? sel(state) : state
  }
  fn.getState = () => ({ providers: [] })
  return { useModelProvider: fn }
})

global.IS_MACOS = false

import { Route } from '../local-api-server'

describe('LocalAPIServerSettings', () => {
  const Component = Route.component as React.ComponentType

  it('renders the page', () => {
    render(<Component />)
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('renders server status text when stopped', () => {
    render(<Component />)
    expect(screen.getByText('The server is stopped.')).toBeInTheDocument()
  })

  it('renders Configuration button', () => {
    render(<Component />)
    expect(screen.getByText('Configuration')).toBeInTheDocument()
  })
})
