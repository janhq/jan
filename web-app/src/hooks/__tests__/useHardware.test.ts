import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useHardware,
  HardwareData,
  SystemUsage,
  CPU,
  GPU,
  OS,
  RAM,
} from '../useHardware'

// Mock dependencies
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingHardware: 'hardware-storage-key',
  },
}))

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
        instructions: [],
      },
      ram: {
        available: 0,
        total: 0,
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

  describe('setOS', () => {
    it('should update OS data', () => {
      const { result } = renderHook(() => useHardware())

      const os: OS = {
        name: 'Windows',
        version: '11',
      }

      act(() => {
        result.current.setOS(os)
      })

      expect(result.current.hardwareData.os).toEqual(os)
    })
  })

  describe('setRAM', () => {
    it('should update RAM data', () => {
      const { result } = renderHook(() => useHardware())

      const ram: RAM = {
        available: 16384,
        total: 32768,
      }

      act(() => {
        result.current.setRAM(ram)
      })

      expect(result.current.hardwareData.ram).toEqual(ram)
    })
  })

  describe('updateGPU', () => {
    it('should update specific GPU at index', () => {
      const { result } = renderHook(() => useHardware())

      const initialGpus: GPU[] = [
        {
          name: 'GPU 1',
          total_memory: 8192,
          vendor: 'NVIDIA',
          uuid: 'gpu-1',
          driver_version: '1.0',
          activated: false,
          nvidia_info: { index: 0, compute_capability: '8.0' },
          vulkan_info: {
            index: 0,
            device_id: 1,
            device_type: 'discrete',
            api_version: '1.0',
          },
        },
        {
          name: 'GPU 2',
          total_memory: 4096,
          vendor: 'AMD',
          uuid: 'gpu-2',
          driver_version: '2.0',
          activated: false,
          nvidia_info: { index: 1, compute_capability: '7.0' },
          vulkan_info: {
            index: 1,
            device_id: 2,
            device_type: 'discrete',
            api_version: '1.0',
          },
        },
      ]

      act(() => {
        result.current.setGPUs(initialGpus)
      })

      const updatedGpu: GPU = {
        ...initialGpus[0],
        name: 'Updated GPU 1',
        activated: true,
      }

      act(() => {
        result.current.updateGPU(0, updatedGpu)
      })

      expect(result.current.hardwareData.gpus[0].name).toBe('Updated GPU 1')
      expect(result.current.hardwareData.gpus[0].activated).toBe(true)
      expect(result.current.hardwareData.gpus[1]).toEqual(initialGpus[1])
    })

    it('should handle invalid index gracefully', () => {
      const { result } = renderHook(() => useHardware())

      const initialGpus: GPU[] = [
        {
          name: 'GPU 1',
          total_memory: 8192,
          vendor: 'NVIDIA',
          uuid: 'gpu-1',
          driver_version: '1.0',
          activated: false,
          nvidia_info: { index: 0, compute_capability: '8.0' },
          vulkan_info: {
            index: 0,
            device_id: 1,
            device_type: 'discrete',
            api_version: '1.0',
          },
        },
      ]

      act(() => {
        result.current.setGPUs(initialGpus)
      })

      const updatedGpu: GPU = {
        ...initialGpus[0],
        name: 'Updated GPU',
      }

      act(() => {
        result.current.updateGPU(5, updatedGpu)
      })

      expect(result.current.hardwareData.gpus[0]).toEqual(initialGpus[0])
    })
  })

  describe('setHardwareData with GPU activation', () => {
    it('should initialize GPUs as inactive when activated is not specified', () => {
      const { result } = renderHook(() => useHardware())

      const hardwareData: HardwareData = {
        cpu: {
          arch: 'x86_64',
          core_count: 4,
          extensions: [],
          name: 'CPU',
          usage: 0,
        },
        gpus: [
          {
            name: 'GPU 1',
            total_memory: 8192,
            vendor: 'NVIDIA',
            uuid: 'gpu-1',
            driver_version: '1.0',
            nvidia_info: { index: 0, compute_capability: '8.0' },
            vulkan_info: {
              index: 0,
              device_id: 1,
              device_type: 'discrete',
              api_version: '1.0',
            },
          },
        ],
        os_type: 'windows',
        os_name: 'Windows 11',
        total_memory: 16384,
      }

      act(() => {
        result.current.setHardwareData(hardwareData)
      })

      expect(result.current.hardwareData.gpus[0].activated).toBe(false)
    })

    it('should preserve existing activation states when set', () => {
      const { result } = renderHook(() => useHardware())

      const hardwareData: HardwareData = {
        cpu: {
          arch: 'x86_64',
          core_count: 4,
          extensions: [],
          name: 'CPU',
          usage: 0,
        },
        gpus: [
          {
            name: 'GPU 1',
            total_memory: 8192,
            vendor: 'NVIDIA',
            uuid: 'gpu-1',
            driver_version: '1.0',
            activated: true,
            nvidia_info: { index: 0, compute_capability: '8.0' },
            vulkan_info: {
              index: 0,
              device_id: 1,
              device_type: 'discrete',
              api_version: '1.0',
            },
          },
        ],
        os_type: 'windows',
        os_name: 'Windows 11',
        total_memory: 16384,
      }

      act(() => {
        result.current.setHardwareData(hardwareData)
      })

      expect(result.current.hardwareData.gpus[0].activated).toBe(true)
    })
  })
})
