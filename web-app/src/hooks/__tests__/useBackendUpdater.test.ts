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

  // --- getLlamacppExtension scoped-name fallback ---

  it('installBackend works with scoped extension name', async () => {
    const mockInstall = vi.fn().mockResolvedValue(undefined)
    const mockRefresh = vi.fn().mockResolvedValue(undefined)

    mockGetByName.mockImplementation((name: string) => {
      if (name === '@janhq/llamacpp-extension') {
        return {
          installBackend: mockInstall,
          refreshBackendOptions: mockRefresh,
        }
      }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installBackend('/path/to/backend.zip')
    })

    expect(mockInstall).toHaveBeenCalledWith('/path/to/backend.zip')
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('installBackend falls back to unscoped extension name', async () => {
    const mockInstall = vi.fn().mockResolvedValue(undefined)
    const mockConfigure = vi.fn().mockResolvedValue(undefined)

    mockGetByName.mockImplementation((name: string) => {
      if (name === 'llamacpp-extension') {
        return {
          installBackend: mockInstall,
          configureBackends: mockConfigure,
        }
      }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installBackend('/path/to/backend.zip')
    })

    expect(mockInstall).toHaveBeenCalledWith('/path/to/backend.zip')
    expect(mockConfigure).toHaveBeenCalled()
  })

  it('installBackend throws when extension not found', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await expect(
      act(async () => {
        await result.current.installBackend('/path/to/backend.zip')
      })
    ).rejects.toThrow('Extension does not support backend installation')
  })

  it('installBackend prefers refreshBackendOptions over configureBackends', async () => {
    const mockInstall = vi.fn().mockResolvedValue(undefined)
    const mockRefresh = vi.fn().mockResolvedValue(undefined)
    const mockConfigure = vi.fn().mockResolvedValue(undefined)

    mockGetByName.mockImplementation((name: string) => {
      if (name === '@janhq/llamacpp-extension') {
        return {
          installBackend: mockInstall,
          refreshBackendOptions: mockRefresh,
          configureBackends: mockConfigure,
        }
      }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installBackend('/path/to/backend.zip')
    })

    expect(mockRefresh).toHaveBeenCalled()
    expect(mockConfigure).not.toHaveBeenCalled()
  })

  it('installCudaRuntime works with scoped extension name', async () => {
    const mockInstall = vi.fn().mockResolvedValue(undefined)

    mockGetByName.mockImplementation((name: string) => {
      if (name === '@janhq/llamacpp-extension') {
        return { installCudaRuntime: mockInstall }
      }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installCudaRuntime('/path/to/cuda.zip')
    })

    expect(mockInstall).toHaveBeenCalledWith('/path/to/cuda.zip')
  })

  it('installCudaRuntime falls back to unscoped extension name', async () => {
    const mockInstall = vi.fn().mockResolvedValue(undefined)

    mockGetByName.mockImplementation((name: string) => {
      if (name === 'llamacpp-extension') {
        return { installCudaRuntime: mockInstall }
      }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installCudaRuntime('/path/to/cuda.zip')
    })

    expect(mockInstall).toHaveBeenCalledWith('/path/to/cuda.zip')
  })

  it('installCudaRuntime throws when extension not found', async () => {
    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await expect(
      act(async () => {
        await result.current.installCudaRuntime('/path/to/cuda.zip')
      })
    ).rejects.toThrow('Extension does not support CUDA runtime installation')
  })

  it('installCudaRuntime throws when extension lacks installCudaRuntime method', async () => {
    mockGetByName.mockImplementation((name: string) => {
      if (name === '@janhq/llamacpp-extension') {
        return {} // no installCudaRuntime method
      }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await expect(
      act(async () => {
        await result.current.installCudaRuntime('/path/to/cuda.zip')
      })
    ).rejects.toThrow('Extension does not support CUDA runtime installation')
  })

  it('searches scoped extension name before fallback', async () => {
    // Only unscoped name yields an extension; scoped returns null.
    // This tests that the scoped lookup happens first.
    mockGetByName.mockImplementation((name: string) => {
      if (name === '@janhq/llamacpp-extension') return null
      if (name === 'llamacpp-extension')
        return {
          installBackend: vi.fn().mockResolvedValue(undefined),
          refreshBackendOptions: vi.fn().mockResolvedValue(undefined),
        }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installBackend('/path/to/backend.zip')
    })

    // Both names were consulted during the lookup.
    const llamacppCalls = mockGetByName.mock.calls.filter(
      (c) =>
        c[0] === '@janhq/llamacpp-extension' || c[0] === 'llamacpp-extension'
    )
    // At minimum one scoped + one unscoped call (there may be more from
    // the auto-update-setting check which also calls getLlamacppExtension).
    expect(llamacppCalls.length).toBeGreaterThanOrEqual(2)
    // The very first call for any llamacpp name is the scoped one.
    expect(llamacppCalls[0][0]).toBe('@janhq/llamacpp-extension')
    expect(llamacppCalls[1][0]).toBe('llamacpp-extension')
  })

  it('does not fall back when scoped name resolves', async () => {
    mockGetByName.mockImplementation((name: string) => {
      if (name === '@janhq/llamacpp-extension')
        return {
          installBackend: vi.fn().mockResolvedValue(undefined),
          refreshBackendOptions: vi.fn().mockResolvedValue(undefined),
        }
      return null
    })

    const { useBackendUpdater } = await import('../useBackendUpdater')
    const { result } = renderHook(() => useBackendUpdater())

    await act(async () => {
      await result.current.installBackend('/path/to/backend.zip')
    })

    // Scoped name was found; unscoped should not be consulted.
    expect(mockGetByName).not.toHaveBeenCalledWith('llamacpp-extension')
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
