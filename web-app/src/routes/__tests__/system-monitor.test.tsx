import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, component: config.component }),
}))
vi.mock('@/constants/routes', () => ({ route: { systemMonitor: '/system-monitor' } }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: any) => <div data-testid="progress" data-value={value} />,
}))
vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb} MB`,
}))
vi.mock('@tabler/icons-react', () => ({ IconDeviceDesktopAnalytics: () => <span /> }))
vi.mock('@/utils/number', () => ({ toNumber: (v: number) => (isNaN(v) ? 0 : v) }))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: () => ({
    hardwareData: {
      cpu: { name: 'TestCPU', core_count: 8, arch: 'x86_64' },
      total_memory: 16000,
    },
    systemUsage: { cpu: 25.5, used_memory: 8000 },
    updateSystemUsage: vi.fn(),
  }),
}))
vi.mock('@/hooks/useLlamacppDevices', () => ({
  useLlamacppDevices: () => ({ devices: [], fetchDevices: vi.fn() }),
}))

global.IS_MACOS = false

import { Route } from '../system-monitor'

describe('SystemMonitor', () => {
  const Component = Route.component as React.ComponentType

  it('renders title', () => {
    render(<Component />)
    expect(screen.getByText('system-monitor:title')).toBeInTheDocument()
  })

  it('renders CPU info', () => {
    render(<Component />)
    expect(screen.getByText('TestCPU')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('x86_64')).toBeInTheDocument()
  })

  it('renders CPU usage percentage', () => {
    render(<Component />)
    expect(screen.getByText('25.50%')).toBeInTheDocument()
  })

  it('renders no GPUs message', () => {
    render(<Component />)
    expect(screen.getByText('system-monitor:noGpus')).toBeInTheDocument()
  })
})
