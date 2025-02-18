// useGetSystemResources.test.ts

import { renderHook, act } from '@testing-library/react'
import useGetSystemResources from './useGetSystemResources'
import { extensionManager } from '@/extension/ExtensionManager'

// Mock the extensionManager
jest.mock('@/extension/ExtensionManager', () => ({
  extensionManager: {
    get: jest.fn(),
  },
}))

// Mock the necessary dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: () => jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))

describe('useGetSystemResources', () => {
  const mockMonitoringExtension = {
    getHardware: jest.fn(),
    getCurrentLoad: jest.fn(),
  }

  beforeEach(() => {
    jest.useFakeTimers()
    ;(extensionManager.get as jest.Mock).mockReturnValue(
      mockMonitoringExtension
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('should fetch system resources on initial render', async () => {
    mockMonitoringExtension.getHardware.mockResolvedValue({
      cpu: { usage: 50 },
      ram: { available: 4000, total: 8000 },
    })
    mockMonitoringExtension.getCurrentLoad.mockResolvedValue({
      gpu: [],
    })

    const { result } = renderHook(() => useGetSystemResources())

    expect(mockMonitoringExtension.getHardware).toHaveBeenCalledTimes(1)
  })

  it('should start watching system resources when watch is called', () => {
    const { result } = renderHook(() => useGetSystemResources())

    act(() => {
      result.current.watch()
    })

    expect(mockMonitoringExtension.getHardware).toHaveBeenCalled()

    // Fast-forward time by 2 seconds
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    expect(mockMonitoringExtension.getHardware).toHaveBeenCalled()
  })

  it('should stop watching when stopWatching is called', () => {
    const { result } = renderHook(() => useGetSystemResources())

    act(() => {
      result.current.watch()
    })

    act(() => {
      result.current.stopWatching()
    })

    // Fast-forward time by 2 seconds
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    // Expect no additional calls after stopping
    expect(mockMonitoringExtension.getHardware).toHaveBeenCalled()
  })

  it('should not fetch resources if monitoring extension is not available', async () => {
    ;(extensionManager.get as jest.Mock).mockReturnValue(null)

    const { result } = renderHook(() => useGetSystemResources())

    await act(async () => {
      result.current.getSystemResources()
    })

    expect(mockMonitoringExtension.getHardware).not.toHaveBeenCalled()
    expect(mockMonitoringExtension.getCurrentLoad).not.toHaveBeenCalled()
  })
})
