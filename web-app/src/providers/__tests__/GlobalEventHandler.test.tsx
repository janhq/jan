import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GlobalEventHandler } from '../GlobalEventHandler'
import { events } from '@janhq/core'

const mockSetProviders = vi.fn()
const mockGetProviders = vi.fn()
const mockRefreshHardware = vi.fn()
const mockGetHardware = vi.fn()
const mockSetHardwareData = vi.fn()

vi.mock('@janhq/core', () => ({
  events: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    setProviders: mockSetProviders,
  })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    providers: () => ({ getProviders: mockGetProviders }),
    hardware: () => ({
      refreshHardwareInfo: mockRefreshHardware,
      getHardwareInfo: mockGetHardware,
    }),
  })),
}))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: vi.fn((selector: any) => {
    if (selector) return selector({ setHardwareData: mockSetHardwareData })
    return { setHardwareData: mockSetHardwareData }
  }),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn(() => false),
}))

describe('GlobalEventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes to settingsChanged on mount and unsubscribes on unmount', () => {
    const { unmount } = render(<GlobalEventHandler />)
    expect(events.on).toHaveBeenCalledWith('settingsChanged', expect.any(Function))
    unmount()
    expect(events.off).toHaveBeenCalledWith('settingsChanged', expect.any(Function))
  })

  it('refreshes providers on version_backend change', async () => {
    const providers = [{ provider: 'openai' }]
    mockGetProviders.mockResolvedValue(providers)
    render(<GlobalEventHandler />)

    // Get the handler that was passed to events.on
    const handler = vi.mocked(events.on).mock.calls.find(
      (c) => c[0] === 'settingsChanged'
    )?.[1] as Function

    await act(async () => {
      await handler({ key: 'version_backend', value: '1.0' })
    })
    expect(mockGetProviders).toHaveBeenCalled()
    expect(mockSetProviders).toHaveBeenCalledWith(providers)
  })

  it('ignores non-version_backend settings', async () => {
    render(<GlobalEventHandler />)
    const handler = vi.mocked(events.on).mock.calls.find(
      (c) => c[0] === 'settingsChanged'
    )?.[1] as Function

    await act(async () => {
      await handler({ key: 'other_setting', value: 'x' })
    })
    expect(mockGetProviders).not.toHaveBeenCalled()
  })

  it('handles provider refresh error gracefully', async () => {
    mockGetProviders.mockRejectedValue(new Error('fail'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<GlobalEventHandler />)
    const handler = vi.mocked(events.on).mock.calls.find(
      (c) => c[0] === 'settingsChanged'
    )?.[1] as Function

    await act(async () => {
      await handler({ key: 'version_backend', value: '1.0' })
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
