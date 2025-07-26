import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLlamacppDevices } from '../useLlamacppDevices'
import { getLlamacppDevices } from '../../services/hardware'
import { useModelProvider } from '../useModelProvider'

// Mock the hardware service
vi.mock('@/services/hardware', () => ({
  getLlamacppDevices: vi.fn(),
}))

// Mock the providers service
vi.mock('@/services/providers', () => ({
  updateSettings: vi.fn(),
}))

// Mock the useModelProvider hook
vi.mock('../useModelProvider', () => ({
  useModelProvider: {
    getState: vi.fn(() => ({
      getProviderByName: vi.fn(),
      updateProvider: vi.fn(),
    })),
  },
}))

// Mock the window.core object
Object.defineProperty(window, 'core', {
  value: {
    extensionManager: {
      getByName: vi.fn(),
    },
  },
  writable: true,
})

describe('useLlamacppDevices', () => {
  const mockGetLlamacppDevices = vi.mocked(getLlamacppDevices)

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset useModelProvider mock to return no provider by default
    vi.mocked(useModelProvider.getState).mockReturnValue({
      getProviderByName: vi.fn(() => null),
      updateProvider: vi.fn(),
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useLlamacppDevices())

    expect(result.current.devices).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.activatedDevices).toEqual(new Set())
    expect(typeof result.current.fetchDevices).toBe('function')
    expect(typeof result.current.clearError).toBe('function')
    expect(typeof result.current.setDevices).toBe('function')
    expect(typeof result.current.toggleDevice).toBe('function')
    expect(typeof result.current.setActivatedDevices).toBe('function')
  })

  it('should fetch devices successfully and auto-activate first device', async () => {
    const mockDevices = [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', mem: 24576, free: 20480 },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3080', mem: 10240, free: 8192 },
    ]

    mockGetLlamacppDevices.mockResolvedValue(mockDevices)

    const { result } = renderHook(() => useLlamacppDevices())

    await act(async () => {
      await result.current.fetchDevices()
    })

    expect(result.current.devices).toEqual(mockDevices)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.activatedDevices).toEqual(new Set(['CUDA0']))
    expect(mockGetLlamacppDevices).toHaveBeenCalledOnce()
  })

  it('should clear error', () => {
    const { result } = renderHook(() => useLlamacppDevices())

    // Set an error first
    act(() => {
      result.current.setDevices([])
    })

    // Clear the error
    act(() => {
      result.current.clearError()
    })

    expect(result.current.error).toBeNull()
  })

  it('should set devices directly', () => {
    const mockDevices = [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', mem: 24576, free: 20480 },
    ]

    const { result } = renderHook(() => useLlamacppDevices())

    act(() => {
      result.current.setDevices(mockDevices)
    })

    expect(result.current.devices).toEqual(mockDevices)
  })

  it('should toggle device activation', async () => {
    const { result } = renderHook(() => useLlamacppDevices())

    // Clear any existing activated devices first
    act(() => {
      result.current.setActivatedDevices([])
    })

    // Initially no devices are activated
    expect(result.current.activatedDevices).toEqual(new Set())

    // Toggle a device on
    await act(async () => {
      await result.current.toggleDevice('CUDA0')
    })

    expect(result.current.activatedDevices).toEqual(new Set(['CUDA0']))

    // Toggle the same device off
    await act(async () => {
      await result.current.toggleDevice('CUDA0')
    })

    expect(result.current.activatedDevices).toEqual(new Set())

    // Toggle multiple devices
    await act(async () => {
      await result.current.toggleDevice('CUDA0')
    })
    await act(async () => {
      await result.current.toggleDevice('CUDA1')
    })

    expect(result.current.activatedDevices).toEqual(new Set(['CUDA0', 'CUDA1']))
  })

  it('should set activated devices', () => {
    const { result } = renderHook(() => useLlamacppDevices())

    const deviceIds = ['CUDA0', 'CUDA1', 'Vulkan0']

    act(() => {
      result.current.setActivatedDevices(deviceIds)
    })

    expect(result.current.activatedDevices).toEqual(new Set(deviceIds))
  })

  it('should not auto-activate first device when already have activated devices', async () => {
    const mockDevices = [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', mem: 24576, free: 20480 },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3080', mem: 10240, free: 8192 },
    ]

    mockGetLlamacppDevices.mockResolvedValue(mockDevices)

    const { result } = renderHook(() => useLlamacppDevices())

    // First activate a device manually
    act(() => {
      result.current.setActivatedDevices(['CUDA1'])
    })

    await act(async () => {
      await result.current.fetchDevices()
    })

    expect(result.current.devices).toEqual(mockDevices)
    expect(result.current.activatedDevices).toEqual(new Set(['CUDA1']))
  })

  it('should clear activated devices when provider setting is "none"', async () => {
    const mockDevices = [
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', mem: 24576, free: 20480 },
      { id: 'CUDA1', name: 'NVIDIA GeForce RTX 3080', mem: 10240, free: 8192 },
    ]

    // Mock provider with "none" device setting
    const mockGetProviderByName = vi.fn(() => ({
      settings: [
        {
          key: 'device',
          controller_props: {
            value: 'none'
          }
        }
      ]
    }))

    vi.mocked(useModelProvider.getState).mockReturnValue({
      getProviderByName: mockGetProviderByName,
      updateProvider: vi.fn(),
    })

    mockGetLlamacppDevices.mockResolvedValue(mockDevices)

    const { result } = renderHook(() => useLlamacppDevices())

    // First activate some devices manually
    act(() => {
      result.current.setActivatedDevices(['CUDA0', 'CUDA1'])
    })

    expect(result.current.activatedDevices).toEqual(new Set(['CUDA0', 'CUDA1']))

    // Fetch devices should clear activated devices due to "none" setting
    await act(async () => {
      await result.current.fetchDevices()
    })

    expect(result.current.devices).toEqual(mockDevices)
    expect(result.current.activatedDevices).toEqual(new Set())
    expect(mockGetProviderByName).toHaveBeenCalledWith('llamacpp')
  })

  it('should handle fetch devices error', async () => {
    const errorMessage = 'Failed to fetch devices'
    mockGetLlamacppDevices.mockRejectedValue(new Error(errorMessage))

    const { result } = renderHook(() => useLlamacppDevices())

    // Clear any existing state first
    act(() => {
      result.current.setDevices([])
      result.current.setActivatedDevices([])
      result.current.clearError()
    })

    await act(async () => {
      await result.current.fetchDevices()
    })

    expect(result.current.devices).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(errorMessage)
    expect(result.current.activatedDevices).toEqual(new Set())
  })
}) 