import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHardware } from '../useHardware'

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

describe('useHardware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with default hardware state', () => {
    const { result } = renderHook(() => useHardware())

    expect(result.current.hardwareData).toEqual({
      cpu: {
        arch: '',
        core_count: 0,
        extensions: [],
        name: '',
        usage: 0,
      },
      gpus: [],
      os_type: '',
      os_name: '',
      total_memory: 0,
    })
    expect(result.current.systemUsage).toEqual({
      cpu: 0,
      used_memory: 0,
      total_memory: 0,
      gpus: [],
    })
    expect(result.current.gpuLoading).toEqual({})
    expect(result.current.pollingPaused).toBe(false)
  })

  it('should set hardware data', () => {
    const { result } = renderHook(() => useHardware())

    const testHardwareData = {
      cpu: {
        arch: 'x86_64',
        core_count: 8,
        extensions: ['SSE', 'AVX'],
        name: 'Intel Core i7',
        usage: 25.5,
      },
      gpus: [
        {
          name: 'NVIDIA RTX 3080',
          total_memory: 10737418240,
          vendor: 'NVIDIA',
          uuid: 'GPU-12345',
          driver_version: '470.57.02',
          activated: true,
          nvidia_info: {
            index: 0,
            compute_capability: '8.6',
          },
          vulkan_info: {
            index: 0,
            device_id: 8704,
            device_type: 'discrete',
            api_version: '1.2.0',
          },
        },
      ],
      os_type: 'linux',
      os_name: 'Ubuntu',
      total_memory: 17179869184,
    }

    act(() => {
      result.current.setHardwareData(testHardwareData)
    })

    expect(result.current.hardwareData).toEqual(testHardwareData)
  })

  it('should set CPU data', () => {
    const { result } = renderHook(() => useHardware())

    const testCPU = {
      arch: 'x86_64',
      core_count: 8,
      extensions: ['SSE', 'AVX'],
      name: 'Intel Core i7',
      usage: 25.5,
    }

    act(() => {
      result.current.setCPU(testCPU)
    })

    expect(result.current.hardwareData.cpu).toEqual(testCPU)
  })

  it('should set GPUs data', () => {
    const { result } = renderHook(() => useHardware())

    const testGPUs = [
      {
        name: 'NVIDIA RTX 3080',
        total_memory: 10737418240,
        vendor: 'NVIDIA',
        uuid: 'GPU-12345',
        driver_version: '470.57.02',
        activated: true,
        nvidia_info: {
          index: 0,
          compute_capability: '8.6',
        },
        vulkan_info: {
          index: 0,
          device_id: 8704,
          device_type: 'discrete',
          api_version: '1.2.0',
        },
      },
    ]

    act(() => {
      result.current.setGPUs(testGPUs)
    })

    expect(result.current.hardwareData.gpus).toEqual(testGPUs)
  })

  it('should update system usage', () => {
    const { result } = renderHook(() => useHardware())

    const testSystemUsage = {
      cpu: 45.2,
      used_memory: 8589934592,
      total_memory: 17179869184,
      gpus: [
        {
          uuid: 'GPU-12345',
          used_memory: 2147483648,
          total_memory: 10737418240,
        },
      ],
    }

    act(() => {
      result.current.updateSystemUsage(testSystemUsage)
    })

    expect(result.current.systemUsage).toEqual(testSystemUsage)
  })

  it('should manage GPU loading state', () => {
    const { result } = renderHook(() => useHardware())

    // First set up some GPU data so we have a UUID to work with
    const testGPUs = [
      {
        name: 'NVIDIA RTX 3080',
        total_memory: 10737418240,
        vendor: 'NVIDIA',
        uuid: 'GPU-12345',
        driver_version: '470.57.02',
        activated: true,
        nvidia_info: {
          index: 0,
          compute_capability: '8.6',
        },
        vulkan_info: {
          index: 0,
          device_id: 8704,
          device_type: 'discrete',
          api_version: '1.2.0',
        },
      },
    ]

    act(() => {
      result.current.setGPUs(testGPUs)
    })

    act(() => {
      result.current.setGpuLoading(0, true)
    })

    expect(result.current.gpuLoading['GPU-12345']).toBe(true)

    act(() => {
      result.current.setGpuLoading(0, false)
    })

    expect(result.current.gpuLoading['GPU-12345']).toBe(false)
  })

  it('should manage polling state', () => {
    const { result } = renderHook(() => useHardware())

    expect(result.current.pollingPaused).toBe(false)

    act(() => {
      result.current.pausePolling()
    })

    expect(result.current.pollingPaused).toBe(true)

    act(() => {
      result.current.resumePolling()
    })

    expect(result.current.pollingPaused).toBe(false)
  })

  it('should get activated device string', () => {
    const { result } = renderHook(() => useHardware())

    const testHardwareData = {
      cpu: {
        arch: 'x86_64',
        core_count: 8,
        extensions: ['SSE', 'AVX'],
        name: 'Intel Core i7',
        usage: 25.5,
      },
      gpus: [
        {
          name: 'NVIDIA RTX 3080',
          total_memory: 10737418240,
          vendor: 'NVIDIA',
          uuid: 'GPU-12345',
          driver_version: '470.57.02',
          activated: true,
          nvidia_info: {
            index: 0,
            compute_capability: '8.6',
          },
          vulkan_info: {
            index: 0,
            device_id: 8704,
            device_type: 'discrete',
            api_version: '1.2.0',
          },
        },
      ],
      os_type: 'linux',
      os_name: 'Ubuntu',
      total_memory: 17179869184,
    }

    act(() => {
      result.current.setHardwareData(testHardwareData)
    })

    const deviceString = result.current.getActivatedDeviceString()
    expect(typeof deviceString).toBe('string')
  })
})