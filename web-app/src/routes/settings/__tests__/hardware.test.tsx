import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
  Card: ({
    title,
    header,
    children,
  }: {
    title?: string
    header?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div data-testid="card">
      {title && <div>{title}</div>}
      {header}
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

const llamacpp = vi.hoisted(() => ({
  devices: [
    { id: 'gpu0', name: 'RTX 3080', mem: 10240, free: 8192, activated: true },
  ] as any[],
}))

vi.mock('@/hooks/useLlamacppDevices', () => ({
  useLlamacppDevices: () => ({
    devices: llamacpp.devices,
    loading: false,
    error: null,
    setActivations: vi.fn(),
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

// A stable hub, so a test can see exactly what Refresh asked the services to do.
const hub = vi.hoisted(() => ({
  reconcile: vi.fn(),
  setActiveModels: vi.fn(),
  toast: { info: vi.fn(), warning: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: hub.toast }))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    window: () => ({ openSystemMonitorWindow: vi.fn() }),
    hardware: () => ({
      refreshHardwareInfo: vi.fn().mockResolvedValue(undefined),
      getHardwareInfo: vi.fn().mockResolvedValue(null),
      getSystemUsage: vi.fn().mockResolvedValue(null),
      reconcileLlamacppDevices: hub.reconcile,
    }),
    models: () => ({
      stopAllModels: vi.fn(),
      getActiveModels: vi.fn().mockResolvedValue([]),
    }),
  }),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (sel: (s: unknown) => unknown) =>
    sel({ setActiveModels: hub.setActiveModels }),
}))

vi.mock('@/services/hardware', () => ({
  getHardwareInfo: vi.fn(() => Promise.resolve({})),
  getSystemUsage: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/services/models', () => ({ stopAllModels: vi.fn() }))
vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb} MB`,
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))
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
vi.mock('@tabler/icons-react', () => ({
  IconDeviceDesktopAnalytics: () => <div data-testid="icon" />,
  IconRefresh: () => <div data-testid="icon-refresh" />,
}))

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
    llamacpp.devices = [
      { id: 'gpu0', name: 'RTX 3080', mem: 10240, free: 8192, activated: true },
    ]
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
      expect(screen.getByText('settings:hardware.gpus')).toBeInTheDocument()
      expect(screen.getByText('RTX 3080')).toBeInTheDocument()
    })
  })

  it('merges multi-backend devices into one card with a backend selector', async () => {
    llamacpp.devices = [
      { id: 'Vulkan0', name: 'RTX 3090', mem: 24824, free: 24240, activated: false },
      { id: 'CUDA0', name: 'RTX 3090', mem: 24127, free: 1259, activated: true },
    ]
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByText('RTX 3090').length).toBe(1)
      expect(screen.getByText('CUDA')).toBeInTheDocument()
      expect(screen.getByText('Vulkan')).toBeInTheDocument()
      expect(screen.getAllByTestId('switch').length).toBe(1)
    })
  })

  describe('Refresh and a GPU that appeared after launch', () => {
    const press = async () => {
      const Component = Route.component as React.ComponentType
      render(<Component />)
      // The page renders a placeholder until hardware data arrives.
      fireEvent.click(await screen.findByText('settings:hardware.refresh'))
    }

    it('says the engine restarted and clears the loaded-model list', async () => {
      hub.reconcile.mockResolvedValue('restarted')
      await press()
      await waitFor(() =>
        expect(hub.toast.info).toHaveBeenCalledWith(
          'settings:hardware.engineRestartedForDevices'
        )
      )
      expect(hub.setActiveModels).toHaveBeenCalledWith([])
    })

    it('asks the user to stop the busy model instead of interrupting it', async () => {
      hub.reconcile.mockResolvedValue('busy')
      await press()
      await waitFor(() =>
        expect(hub.toast.warning).toHaveBeenCalledWith(
          'settings:hardware.engineBusyDevicesChanged'
        )
      )
      expect(hub.setActiveModels).not.toHaveBeenCalled()
    })

    it('stays quiet when nothing changed', async () => {
      hub.reconcile.mockResolvedValue('unchanged')
      await press()
      await waitFor(() => expect(hub.reconcile).toHaveBeenCalled())
      expect(hub.toast.info).not.toHaveBeenCalled()
      expect(hub.toast.warning).not.toHaveBeenCalled()
    })
  })

  it('hides GPU devices on macOS', async () => {
    global.IS_MACOS = true
    const Component = Route.component as React.ComponentType
    render(<Component />)
    
    await waitFor(() => {
      expect(
        screen.queryByText('settings:hardware.gpus')
      ).not.toBeInTheDocument()
    })
  })
})
