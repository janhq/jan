import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock all the dependencies with minimal implementation
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
    <div data-testid="card">
      {title && <div>{title}</div>}
      {children}
    </div>
  ),
  CardItem: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
    <div data-testid="card-item">
      {title && <div>{title}</div>}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked }: { checked: boolean }) => (
    <input data-testid="switch" type="checkbox" checked={checked} readOnly />
  ),
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress">Progress: {value}%</div>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: () => ({
    hardwareData: {
      os_type: 'windows',
      os_name: 'Windows 11',
      cpu: { name: 'Intel i7', arch: 'x64', core_count: 8, extensions: ['SSE'] },
      total_memory: 16384,
    },
    systemUsage: { cpu: 50, used_memory: 8192 },
    setHardwareData: vi.fn(),
    updateSystemUsage: vi.fn(),
    pollingPaused: false,
  }),
}))

vi.mock('@/hooks/useLlamacppDevices', () => ({
  useLlamacppDevices: () => ({
    devices: [{ id: 'gpu0', name: 'RTX 3080', mem: 10240, free: 8192 }],
    loading: false,
    error: null,
    activatedDevices: new Set(['gpu0']),
    toggleDevice: vi.fn(),
    fetchDevices: vi.fn(),
  }),
  getState: () => ({ setActivatedDevices: vi.fn() }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [{ provider: 'llamacpp' }],
    getProviderByName: vi.fn(() => ({ settings: [{ key: 'device', controller_props: { value: 'gpu0' } }] })),
  }),
}))

vi.mock('@/services/hardware', () => ({
  getHardwareInfo: vi.fn(() => Promise.resolve({})),
  getSystemUsage: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/services/models', () => ({ stopAllModels: vi.fn() }))
<<<<<<< HEAD
vi.mock('@/lib/utils', () => ({ formatMegaBytes: (mb: number) => `${mb} MB` }))
=======
vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb} MB`,
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
vi.mock('@/utils/number', () => ({ toNumber: (n: number) => n }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: vi.fn() }))
vi.mock('@/constants/routes', () => ({ 
  route: { 
    settings: { 
      hardware: '/settings/hardware' 
    }, 
    systemMonitor: '/monitor' 
  } 
}))
vi.mock('@/constants/windows', () => ({ windowKey: { systemMonitorWindow: 'monitor' } }))
vi.mock('@tabler/icons-react', () => ({ IconDeviceDesktopAnalytics: () => <div data-testid="icon" /> }))

// Mock the route structure properly
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => config,
}))

// Mock platform utils to enable hardware monitoring
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
  getUnavailableFeatureMessage: () => 'Feature not available',
}))

// Mock PlatformGuard to always render children
vi.mock('@/lib/platform/PlatformGuard', () => ({
  PlatformGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

global.IS_MACOS = false

// Import the actual component after all mocks are set up
import { Route } from '../hardware'

describe('Hardware Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.IS_MACOS = false
  })

  it('renders hardware settings page', () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('displays OS information', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.getByText('settings:hardware.os')).toBeInTheDocument()
      expect(screen.getByText('windows')).toBeInTheDocument()
    })
  })

  it('displays CPU information', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.getByText('settings:hardware.cpu')).toBeInTheDocument()
      expect(screen.getByText('Intel i7')).toBeInTheDocument()
    })
  })

  it('displays memory information', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.getByText('settings:hardware.memory')).toBeInTheDocument()
    })
  })

  it('displays GPU devices on non-macOS', async () => {
    global.IS_MACOS = false
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.getByText('GPUs')).toBeInTheDocument()
      expect(screen.getByText('RTX 3080')).toBeInTheDocument()
    })
  })

  it('hides GPU devices on macOS', async () => {
    global.IS_MACOS = true
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.queryByText('GPUs')).not.toBeInTheDocument()
    })
  })
})
