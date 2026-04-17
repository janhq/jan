import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, component: config.component }),
}))
vi.mock('@/constants/routes', () => ({ route: { settings: { https_proxy: '/settings/https-proxy' } } }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: any) => <div data-testid="header-page">{children}</div> }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => <div data-testid="settings-menu" /> }))
vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: any) => <div data-testid="card">{header}{children}</div>,
  CardItem: ({ title, description, actions, className }: any) => (
    <div data-testid="card-item"><span>{typeof title === 'string' ? title : ''}</span>{typeof description === 'string' ? <span>{description}</span> : description}{actions}</div>
  ),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => <input type="checkbox" data-testid="switch" checked={checked} onChange={(e: any) => onCheckedChange?.(e.target.checked)} />,
}))
vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, ...p }: any) => <input data-testid="input" value={value} onChange={onChange} placeholder={placeholder} {...p} />,
}))
vi.mock('lucide-react', () => ({ EyeOff: () => <span>EyeOff</span>, Eye: () => <span>Eye</span> }))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))

vi.mock('@/hooks/useProxyConfig', () => ({
  useProxyConfig: () => ({
    proxyUrl: 'http://proxy.test', proxyEnabled: true, proxyUsername: 'user',
    proxyPassword: 'pass', proxyIgnoreSSL: false, noProxy: 'localhost',
    setProxyEnabled: vi.fn(), setProxyUsername: vi.fn(), setProxyPassword: vi.fn(),
    setProxyIgnoreSSL: vi.fn(), setNoProxy: vi.fn(), setProxyUrl: vi.fn(),
  }),
}))

global.IS_MACOS = false

import { Route } from '../https-proxy'

describe('HTTPSProxySettings', () => {
  const Component = Route.component as React.ComponentType

  it('renders the page', () => {
    render(<Component />)
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('renders proxy section title', () => {
    render(<Component />)
    expect(screen.getByText('settings:httpsProxy.proxy')).toBeInTheDocument()
  })

  it('renders proxy URL input', () => {
    render(<Component />)
    expect(screen.getByDisplayValue('http://proxy.test')).toBeInTheDocument()
  })
})
