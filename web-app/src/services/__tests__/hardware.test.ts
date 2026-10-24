import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriHardwareService } from '../hardware/tauri'
import { HardwareData, SystemUsage } from '@/hooks/useHardware'
import { getSystemInfo, getSystemUsage } from '@janhq/tauri-plugin-hardware-api'

vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  getSystemInfo: vi.fn(),
  getSystemUsage: vi.fn(),
  refreshSystemInfo: vi.fn(),
}))

describe('TauriHardwareService', () => {
  let hardwareService: TauriHardwareService

  beforeEach(() => {
    hardwareService = new TauriHardwareService()
    vi.clearAllMocks()
  })

  describe('getHardwareInfo', () => {
    it('should read it through the hardware plugin and return hardware data', async () => {
      const mockHardwareData: HardwareData = {
        cpu: {
          arch: 'x86_64',
          core_count: 8,
          extensions: ['SSE', 'AVX'],
          name: 'Intel Core i7',
          usage: 0,
        },
        gpus: [
          {
            name: 'NVIDIA RTX 3080',
            total_memory: 10240,
            vendor: 'NVIDIA',
            uuid: 'gpu-uuid-1',
            driver_version: '472.12',
            activated: false,
            nvidia_info: {
              index: 0,
              compute_capability: '8.6',
            },
            vulkan_info: {
              index: 0,
              device_id: 123,
              device_type: 'DiscreteGpu',
              api_version: '1.2.0',
            },
          },
        ],
        os_type: 'Windows',
        os_name: 'Windows 11',
        total_memory: 16384,
      }

      vi.mocked(getSystemInfo).mockResolvedValue(mockHardwareData)

      const result = await hardwareService.getHardwareInfo()

      expect(vi.mocked(getSystemInfo)).toHaveBeenCalled()
      expect(result).toEqual(mockHardwareData)
    })

    it('should propagate a plugin rejection', async () => {
      const mockError = new Error('Failed to get hardware info')
      vi.mocked(getSystemInfo).mockRejectedValue(mockError)

      await expect(hardwareService.getHardwareInfo()).rejects.toThrow('Failed to get hardware info')
      expect(vi.mocked(getSystemInfo)).toHaveBeenCalled()
    })

    it('should return the plugin data', async () => {
      const mockHardwareData: HardwareData = {
        cpu: {
          arch: 'arm64',
          core_count: 4,
          extensions: [],
          name: 'Apple M1',
          usage: 0,
        },
        gpus: [],
        os_type: 'macOS',
        os_name: 'macOS Monterey',
        total_memory: 8192,
      }

      vi.mocked(getSystemInfo).mockResolvedValue(mockHardwareData)

      const result = await hardwareService.getHardwareInfo()

      expect(result).toBeDefined()
      expect(result.cpu).toBeDefined()
      expect(result.gpus).toBeDefined()
      expect(Array.isArray(result.gpus)).toBe(true)
      expect(result.os_type).toBeDefined()
      expect(result.os_name).toBeDefined()
      expect(result.total_memory).toBeDefined()
    })
  })

  describe('getSystemUsage', () => {
    it('should read it through the hardware plugin and return system usage data', async () => {
      const mockSystemUsage: SystemUsage = {
        cpu: 45.5,
        used_memory: 8192,
        total_memory: 16384,
        gpus: [
          {
            uuid: 'gpu-uuid-1',
            used_memory: 2048,
            total_memory: 10240,
          },
        ],
      }

      vi.mocked(getSystemUsage).mockResolvedValue(mockSystemUsage)

      const result = await hardwareService.getSystemUsage()

      expect(vi.mocked(getSystemUsage)).toHaveBeenCalled()
      expect(result).toEqual(mockSystemUsage)
    })

    it('should propagate a plugin rejection', async () => {
      const mockError = new Error('Failed to get system usage')
      vi.mocked(getSystemUsage).mockRejectedValue(mockError)

      await expect(hardwareService.getSystemUsage()).rejects.toThrow('Failed to get system usage')
      expect(vi.mocked(getSystemUsage)).toHaveBeenCalled()
    })

    it('should return the plugin data', async () => {
      const mockSystemUsage: SystemUsage = {
        cpu: 25.0,
        used_memory: 4096,
        total_memory: 8192,
        gpus: [],
      }

      vi.mocked(getSystemUsage).mockResolvedValue(mockSystemUsage)

      const result = await hardwareService.getSystemUsage()

      expect(result).toBeDefined()
      expect(typeof result.cpu).toBe('number')
      expect(typeof result.used_memory).toBe('number')
      expect(typeof result.total_memory).toBe('number')
      expect(Array.isArray(result.gpus)).toBe(true)
    })

    it('should handle system usage with multiple GPUs', async () => {
      const mockSystemUsage: SystemUsage = {
        cpu: 35.2,
        used_memory: 12288,
        total_memory: 32768,
        gpus: [
          {
            uuid: 'gpu-uuid-1',
            used_memory: 4096,
            total_memory: 8192,
          },
          {
            uuid: 'gpu-uuid-2',
            used_memory: 6144,
            total_memory: 12288,
          },
        ],
      }

      vi.mocked(getSystemUsage).mockResolvedValue(mockSystemUsage)

      const result = await hardwareService.getSystemUsage()

      expect(result.gpus).toHaveLength(2)
      expect(result.gpus[0].uuid).toBe('gpu-uuid-1')
      expect(result.gpus[1].uuid).toBe('gpu-uuid-2')
    })
  })

  describe('setActiveGpus', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('should log the provided GPU data', async () => {
      const gpuData = { gpus: [0, 1, 2] }

      await hardwareService.setActiveGpus(gpuData)

      expect(consoleSpy).toHaveBeenCalledWith(gpuData)
    })

    it('should handle empty GPU array', async () => {
      const gpuData = { gpus: [] }

      await hardwareService.setActiveGpus(gpuData)

      expect(consoleSpy).toHaveBeenCalledWith(gpuData)
    })

    it('should handle single GPU', async () => {
      const gpuData = { gpus: [1] }

      await hardwareService.setActiveGpus(gpuData)

      expect(consoleSpy).toHaveBeenCalledWith(gpuData)
    })

    it('should complete successfully', async () => {
      const gpuData = { gpus: [0, 1] }

      await expect(hardwareService.setActiveGpus(gpuData)).resolves.toBeUndefined()
    })

    it('should not throw any errors', async () => {
      const gpuData = { gpus: [0, 1, 2, 3] }

      expect(() => hardwareService.setActiveGpus(gpuData)).not.toThrow()
    })
  })

  describe('integration tests', () => {
    it('should handle concurrent calls to getHardwareInfo and getSystemUsage', async () => {
      const mockHardwareData: HardwareData = {
        cpu: {
          arch: 'x86_64',
          core_count: 16,
          extensions: ['AVX2'],
          name: 'AMD Ryzen 9',
          usage: 0,
        },
        gpus: [],
        os_type: 'Linux',
        os_name: 'Ubuntu 22.04',
        total_memory: 32768,
      }

      const mockSystemUsage: SystemUsage = {
        cpu: 15.5,
        used_memory: 16384,
        total_memory: 32768,
        gpus: [],
      }

      vi.mocked(getSystemInfo).mockResolvedValueOnce(mockHardwareData)
      vi.mocked(getSystemUsage).mockResolvedValueOnce(mockSystemUsage)

      const [hardwareResult, usageResult] = await Promise.all([
        hardwareService.getHardwareInfo(),
        hardwareService.getSystemUsage(),
      ])

      expect(hardwareResult).toEqual(mockHardwareData)
      expect(usageResult).toEqual(mockSystemUsage)
      expect(vi.mocked(getSystemInfo)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(getSystemUsage)).toHaveBeenCalledTimes(1)
    })
  })
})
