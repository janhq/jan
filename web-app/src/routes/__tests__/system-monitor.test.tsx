/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  hardwareData: {
    cpu: { name: 'Intel i9', arch: 'x86_64', core_count: 16 },
    total_memory: 32768,
  },
  systemUsage: { cpu: 42.5, used_memory: 16384 },
  updateSystemUsage: vi.fn(),
  fetchDevices: vi.fn(),
  devices: [] as any[],
  getSystemUsage: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/system-monitor' }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: () => ({
    hardwareData: h.hardwareData,
    systemUsage: h.systemUsage,
    updateSystemUsage: h.updateSystemUsage,
  }),
}))

vi.mock('@/hooks/useLlamacppDevices', () => ({
  useLlamacppDevices: () => ({
    devices: h.devices,
    fetchDevices: h.fetchDevices,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    hardware: () => ({ getSystemUsage: h.getSystemUsage }),
  }),
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: any) => <div data-testid="progress" data-value={value} />,
}))

vi.mock('@tabler/icons-react', () => ({
  IconDeviceDesktopAnalytics: () => <span data-testid="icon" />,
}))

vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb}MB`,
  cn: (...c: any[]) => c.filter(Boolean).join(' '),
}))

vi.mock('@/utils/number', () => ({
  toNumber: (n: number) => (isNaN(n) ? 0 : n),
}))

vi.mock('@/constants/routes', () => ({
  route: { systemMonitor: '/system-monitor' },
}))

import { Route } from '../system-monitor'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('SystemMonitor route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).IS_MACOS = false
    h.hardwareData = {
      cpu: { name: 'Intel i9', arch: 'x86_64', core_count: 16 },
      total_memory: 32768,
    }
    h.systemUsage = { cpu: 42.5, used_memory: 16384 }
    h.devices = []
    h.getSystemUsage.mockResolvedValue({ cpu: 10, used_memory: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title and CPU info', () => {
    renderComponent()
    expect(screen.getByText('system-monitor:title')).toBeInTheDocument()
    expect(screen.getByText('Intel i9')).toBeInTheDocument()
    expect(screen.getByText('16')).toBeInTheDocument()
    expect(screen.getByText('x86_64')).toBeInTheDocument()
    expect(screen.getByText('42.50%')).toBeInTheDocument()
  })

  it('renders RAM info with used/available and percentage', () => {
    renderComponent()
    expect(screen.getByText('32768MB')).toBeInTheDocument()
    expect(screen.getAllByText('16384MB').length).toBe(2) // both available & used are 16384
    // ram percentage = 16384/32768 * 100 = 50
    expect(screen.getByText('50.00%')).toBeInTheDocument()
  })

  it('calls fetchDevices on mount', () => {
    renderComponent()
    expect(h.fetchDevices).toHaveBeenCalled()
  })

  it('shows noGpus message on non-mac when no devices', () => {
    renderComponent()
    expect(screen.getByText('system-monitor:noGpus')).toBeInTheDocument()
    expect(screen.getByText('system-monitor:activeGpus')).toBeInTheDocument()
  })

  it('renders GPU device entries when devices present', () => {
    h.devices = [
      { id: 'gpu-0', name: 'RTX 4090', mem: 24576, free: 20480, activated: true },
      { id: 'gpu-1', name: 'RTX 3060', mem: 12288, free: 10240, activated: false },
    ]
    renderComponent()
    expect(screen.getByText('RTX 4090')).toBeInTheDocument()
    expect(screen.getByText('RTX 3060')).toBeInTheDocument()
    expect(screen.getByText('24576MB')).toBeInTheDocument()
    expect(screen.getByText('20480MB')).toBeInTheDocument()
    expect(screen.getByText('system-monitor:active')).toBeInTheDocument()
  })

  it('hides GPU card on macOS', () => {
    ;(globalThis as any).IS_MACOS = true
    renderComponent()
    expect(screen.queryByText('system-monitor:activeGpus')).not.toBeInTheDocument()
  })

  it('polls getSystemUsage every 5s and calls updateSystemUsage', async () => {
    vi.useFakeTimers()
    h.getSystemUsage.mockResolvedValue({ cpu: 55, used_memory: 2 })
    renderComponent()
    await vi.advanceTimersByTimeAsync(5100)
    expect(h.getSystemUsage).toHaveBeenCalled()
    expect(h.updateSystemUsage).toHaveBeenCalledWith({ cpu: 55, used_memory: 2 })
  })

  it('does not call updateSystemUsage when polling returns falsy', async () => {
    vi.useFakeTimers()
    h.getSystemUsage.mockResolvedValue(null)
    renderComponent()
    await vi.advanceTimersByTimeAsync(5100)
    expect(h.getSystemUsage).toHaveBeenCalled()
    expect(h.updateSystemUsage).not.toHaveBeenCalled()
  })

  it('handles polling errors gracefully', async () => {
    vi.useFakeTimers()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getSystemUsage.mockRejectedValue(new Error('usage fail'))
    renderComponent()
    await vi.advanceTimersByTimeAsync(5100)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('clears interval on unmount', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(global, 'clearInterval')
    const { unmount } = renderComponent()
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
