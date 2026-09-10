/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  hardwareData: {
    cpu: { name: 'Intel i9', arch: 'x86_64', core_count: 16 },
    total_memory: 32768,
    gpus: [] as any[],
  },
  systemUsage: { cpu: 42.5, used_memory: 16384, gpus: [] as any[] },
  updateSystemUsage: vi.fn(),
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
      gpus: [],
    }
    h.systemUsage = { cpu: 42.5, used_memory: 16384, gpus: [] }
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

  it('shows noGpus message on non-mac when no GPUs reported', () => {
    renderComponent()
    expect(screen.getByText('system-monitor:noGpus')).toBeInTheDocument()
    expect(screen.getByText('system-monitor:gpus')).toBeInTheDocument()
  })

  it('renders GPUs from hardware data with backend and usage', () => {
    h.hardwareData.gpus = [
      {
        uuid: 'uuid-0',
        name: 'RTX 4090',
        total_memory: 24576,
        vendor: 'NVIDIA',
        driver_version: '560.35',
        nvidia_info: { index: 0, compute_capability: '8.9' },
        vulkan_info: { index: 0, api_version: '1.3' },
      },
      {
        uuid: 'uuid-1',
        name: 'Radeon RX 7800',
        total_memory: 16384,
        vendor: 'AMD',
        driver_version: '',
        nvidia_info: { index: -1, compute_capability: '' },
        vulkan_info: { index: 1, api_version: '1.3.290' },
      },
    ]
    h.systemUsage.gpus = [
      { uuid: 'uuid-0', used_memory: 6144, total_memory: 24576 },
    ]
    renderComponent()
    expect(screen.getByText('RTX 4090')).toBeInTheDocument()
    expect(screen.getByText('Radeon RX 7800')).toBeInTheDocument()
    expect(screen.getByText('CUDA')).toBeInTheDocument()
    expect(screen.getByText('Vulkan')).toBeInTheDocument()
    expect(screen.getByText('24576MB')).toBeInTheDocument()
    expect(screen.getByText('560.35')).toBeInTheDocument()
    // 6144/24576 = 25%
    expect(screen.getByText('25.00%')).toBeInTheDocument()
  })

  it('hides GPU card on macOS', () => {
    ;(globalThis as any).IS_MACOS = true
    renderComponent()
    expect(screen.queryByText('system-monitor:gpus')).not.toBeInTheDocument()
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
