import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock events
const mockOn = vi.fn()
const mockOff = vi.fn()
const mockEmit = vi.fn()

vi.mock('@janhq/core', () => ({
  events: {
    on: mockOn,
    off: mockOff,
    emit: mockEmit,
  },
}))

// Mock useModelProvider
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: vi.fn().mockReturnValue({
      getProviderByName: vi.fn().mockReturnValue({ active: true }),
    }),
  },
}))

// Mock ExtensionManager
const mockGetByName = vi.fn()
const mockListExtensions = vi.fn().mockReturnValue([])

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      getByName: mockGetByName,
      listExtensions: mockListExtensions,
    }),
  },
}))

describe('useBackendUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetByName.mockReturnValue(null)
    mockListExtensions.mockReturnValue([])
  })

  it('should initialize with default state', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    expect(result.current.updateState.isUpdateAvailable).toBe(false)
    expect(result.current.updateState.updateInfo).toBeNull()
    expect(result.current.updateState.isUpdating).toBe(false)
    expect(result.current.updateState.remindMeLater).toBe(false)
    expect(typeof result.current.checkForUpdate).toBe('function')
    expect(typeof result.current.updateBackend).toBe('function')
    expect(typeof result.current.setRemindMeLater).toBe('function')
    expect(typeof result.current.installBackend).toBe('function')
  })

  it('should subscribe to onBackendUpdateStateSync event', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    renderHook(() => useBackendUpdater())

    expect(mockOn).toHaveBeenCalledWith(
      'onBackendUpdateStateSync',
      expect.any(Function)
    )
  })

  it('should unsubscribe on unmount', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { unmount } = renderHook(() => useBackendUpdater())

    unmount()

    expect(mockOff).toHaveBeenCalledWith(
      'onBackendUpdateStateSync',
      expect.any(Function)
    )
  })

  it('should set remindMeLater', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    act(() => {
      result.current.setRemindMeLater(true)
    })

    expect(result.current.updateState.remindMeLater).toBe(true)
    expect(mockEmit).toHaveBeenCalledWith('onBackendUpdateStateSync', {
      remindMeLater: true,
    })
  })

  it('checkForUpdate returns null when extension not found', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    let updateResult: any
    await act(async () => {
      updateResult = await result.current.checkForUpdate()
    })

    expect(updateResult).toBeNull()
  })

  it('checkForUpdate returns update info when available', async () => {
    const mockUpdateInfo = {
      updateNeeded: true,
      newVersion: '2.0.0',
      currentVersion: '1.0.0',
    }
    mockGetByName.mockReturnValue({
      checkBackendForUpdates: vi.fn().mockResolvedValue(mockUpdateInfo),
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    let updateResult: any
    await act(async () => {
      updateResult = await result.current.checkForUpdate()
    })

    expect(updateResult).toEqual(mockUpdateInfo)
    expect(result.current.updateState.isUpdateAvailable).toBe(true)
  })

  it('checkForUpdate returns null when no update needed', async () => {
    mockGetByName.mockReturnValue({
      checkBackendForUpdates: vi.fn().mockResolvedValue({ updateNeeded: false, newVersion: '' }),
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    let updateResult: any
    await act(async () => {
      updateResult = await result.current.checkForUpdate()
    })

    expect(updateResult).toBeNull()
    expect(result.current.updateState.isUpdateAvailable).toBe(false)
  })
})
