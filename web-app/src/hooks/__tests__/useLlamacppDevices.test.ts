import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLlamacppDevices } from '../useLlamacppDevices'
import { getLlamacppDevices } from '../../services/hardware'

// Mock the hardware service
vi.mock('@/services/hardware', () => ({
  getLlamacppDevices: vi.fn(),
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

  it('should fetch devices successfully', async () => {
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

  it('should toggle device activation', () => {
    const { result } = renderHook(() => useLlamacppDevices())

    // Initially no devices are activated
    expect(result.current.activatedDevices).toEqual(new Set())

    // Toggle a device on
    act(() => {
      result.current.toggleDevice('CUDA0')
    })

    expect(result.current.activatedDevices).toEqual(new Set(['CUDA0']))

    // Toggle the same device off
    act(() => {
      result.current.toggleDevice('CUDA0')
    })

    expect(result.current.activatedDevices).toEqual(new Set())

    // Toggle multiple devices
    act(() => {
      result.current.toggleDevice('CUDA0')
      result.current.toggleDevice('CUDA1')
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
}) 