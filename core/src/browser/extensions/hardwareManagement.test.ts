import { HardwareManagementExtension } from './hardwareManagement'
import { ExtensionTypeEnum } from '../extension'
import { HardwareInformation } from '../../types'

// Mock implementation of HardwareManagementExtension
class MockHardwareManagementExtension extends HardwareManagementExtension {
  private activeGpus: number[] = [0]
  private mockHardwareInfo: HardwareInformation = {
    cpu: {
      manufacturer: 'Mock CPU Manufacturer',
      brand: 'Mock CPU',
      cores: 8,
      physicalCores: 4,
      speed: 3.5,
    },
    memory: {
      total: 16 * 1024 * 1024 * 1024, // 16GB in bytes
      free: 8 * 1024 * 1024 * 1024, // 8GB in bytes
    },
    gpus: [
      {
        id: 0,
        vendor: 'Mock GPU Vendor',
        model: 'Mock GPU Model 1',
        memory: 8 * 1024 * 1024 * 1024, // 8GB in bytes
      },
      {
        id: 1,
        vendor: 'Mock GPU Vendor',
        model: 'Mock GPU Model 2',
        memory: 4 * 1024 * 1024 * 1024, // 4GB in bytes
      }
    ],
    active_gpus: [0],
  }

  constructor() {
    super('http://mock-url.com', 'mock-hardware-extension', 'Mock Hardware Extension', true, 'A mock hardware extension', '1.0.0')
  }

  onLoad(): void {
    // Mock implementation
  }

  onUnload(): void {
    // Mock implementation
  }

  async getHardware(): Promise<HardwareInformation> {
    // Return a copy to prevent test side effects
    return JSON.parse(JSON.stringify(this.mockHardwareInfo))
  }

  async setAvtiveGpu(data: { gpus: number[] }): Promise<{
    message: string
    activated_gpus: number[]
  }> {
    // Validate GPUs exist
    const validGpus = data.gpus.filter(gpuId => 
      this.mockHardwareInfo.gpus.some(gpu => gpu.id === gpuId)
    )

    if (validGpus.length === 0) {
      throw new Error('No valid GPUs selected')
    }
    
    // Update active GPUs
    this.activeGpus = validGpus
    this.mockHardwareInfo.active_gpus = validGpus
    
    return {
      message: 'GPU activation successful',
      activated_gpus: validGpus
    }
  }
}

describe('HardwareManagementExtension', () => {
  let extension: MockHardwareManagementExtension

  beforeEach(() => {
    extension = new MockHardwareManagementExtension()
  })

  test('should return the correct extension type', () => {
    expect(extension.type()).toBe(ExtensionTypeEnum.Hardware)
  })

  test('should get hardware information', async () => {
    const hardwareInfo = await extension.getHardware()
    
    // Check CPU info
    expect(hardwareInfo.cpu).toBeDefined()
    expect(hardwareInfo.cpu.manufacturer).toBe('Mock CPU Manufacturer')
    expect(hardwareInfo.cpu.cores).toBe(8)
    
    // Check memory info
    expect(hardwareInfo.memory).toBeDefined()
    expect(hardwareInfo.memory.total).toBe(16 * 1024 * 1024 * 1024)
    
    // Check GPU info
    expect(hardwareInfo.gpus).toHaveLength(2)
    expect(hardwareInfo.gpus[0].model).toBe('Mock GPU Model 1')
    expect(hardwareInfo.gpus[1].model).toBe('Mock GPU Model 2')
    
    // Check active GPUs
    expect(hardwareInfo.active_gpus).toEqual([0])
  })

  test('should set active GPUs', async () => {
    const result = await extension.setAvtiveGpu({ gpus: [1] })
    
    expect(result.message).toBe('GPU activation successful')
    expect(result.activated_gpus).toEqual([1])
    
    // Verify the change in hardware info
    const hardwareInfo = await extension.getHardware()
    expect(hardwareInfo.active_gpus).toEqual([1])
  })

  test('should set multiple active GPUs', async () => {
    const result = await extension.setAvtiveGpu({ gpus: [0, 1] })
    
    expect(result.message).toBe('GPU activation successful')
    expect(result.activated_gpus).toEqual([0, 1])
    
    // Verify the change in hardware info
    const hardwareInfo = await extension.getHardware()
    expect(hardwareInfo.active_gpus).toEqual([0, 1])
  })

  test('should throw error for invalid GPU ids', async () => {
    await expect(extension.setAvtiveGpu({ gpus: [999] })).rejects.toThrow('No valid GPUs selected')
  })

  test('should handle mix of valid and invalid GPU ids', async () => {
    const result = await extension.setAvtiveGpu({ gpus: [0, 999] })
    
    // Should only activate valid GPUs
    expect(result.activated_gpus).toEqual([0])
    
    // Verify the change in hardware info
    const hardwareInfo = await extension.getHardware()
    expect(hardwareInfo.active_gpus).toEqual([0])
  })
})