import { describe, expect, it } from '@jest/globals'
import { executableCortexFile } from './execute'
import { GpuSetting } from '@janhq/core'
import { cpuInfo } from 'cpu-instructions'

let testSettings: GpuSetting = {
  run_mode: 'cpu',
  vulkan: false,
  cuda: {
    exist: false,
    version: '11',
  },
  gpu_highest_vram: '0',
  gpus: [],
  gpus_in_use: [],
  is_initial: false,
  notify: true,
  nvidia_driver: {
    exist: false,
    version: '11',
  },
}
const originalPlatform = process.platform

jest.mock('cpu-instructions', () => ({
  cpuInfo: {
    cpuInfo: jest.fn(),
  },
}))
let mockCpuInfo = cpuInfo.cpuInfo as jest.Mock
mockCpuInfo.mockReturnValue([])

describe('test executable cortex file', () => {
  afterAll(function () {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
  })

  it('executes on MacOS', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    })
    Object.defineProperty(process, 'arch', {
      value: 'arm64',
    })
    expect(executableCortexFile(testSettings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`/bin/arm64`),
        binPath: expect.stringContaining(`/bin`),
        executablePath:
          originalPlatform === 'darwin'
            ? expect.stringContaining(`/cortex-server`)
            : expect.anything(),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
    Object.defineProperty(process, 'arch', {
      value: 'x64',
    })
    expect(executableCortexFile(testSettings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`/bin/x64`),
        binPath: expect.stringContaining(`/bin`),
        executablePath:
          originalPlatform === 'darwin'
            ? expect.stringContaining(`/cortex-server`)
            : expect.anything(),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
  })

  it('executes on Windows CPU', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'cpu',
    }
    mockCpuInfo.mockReturnValue(['avx'])
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`/bin/avx`),
        binPath: expect.stringContaining(`/bin`),
        executablePath: expect.stringContaining(`/cortex-server.exe`),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
  })

  it('executes on Windows Cuda 11', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      cuda: {
        exist: true,
        version: '11',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`cuda-11-7`),
        binPath: expect.stringContaining(`/bin`),
        executablePath: expect.stringContaining(`/cortex-server.exe`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
  })

  it('executes on Windows Cuda 12', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      cuda: {
        exist: true,
        version: '12',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`cuda-12-0`),
        binPath: expect.stringContaining(`/bin`),
        executablePath: expect.stringContaining(`/cortex-server.exe`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
  })

  it('executes on Linux CPU', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'cpu',
    }
    mockCpuInfo.mockReturnValue(['noavx'])
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`noavx`),
        executablePath: expect.stringContaining(`/cortex-server`),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
  })

  it('executes on Linux Cuda 11', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      cuda: {
        exist: true,
        version: '11',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`cuda-11-7`),
        binPath: expect.stringContaining(`/bin`),
        executablePath: expect.stringContaining(`/cortex-server`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
  })

  it('executes on Linux Cuda 12', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      cuda: {
        exist: true,
        version: '12',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`cuda-12-0`),
        binPath: expect.stringContaining(`/bin`),
        executablePath: expect.stringContaining(`/cortex-server`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
  })

  // Generate test for different cpu instructions on Linux
  it(`executes on Linux CPU with different instructions`, () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'cpu',
    }

    const cpuInstructions = ['avx512', 'avx2', 'avx', 'noavx']
    cpuInstructions.forEach((instruction) => {
      mockCpuInfo.mockReturnValue([instruction])

      expect(executableCortexFile(settings)).toEqual(
        expect.objectContaining({
          enginePath: expect.stringContaining(instruction),
          binPath: expect.stringContaining(`/bin`),
          executablePath: expect.stringContaining(`/cortex-server`),

          cudaVisibleDevices: '',
          vkVisibleDevices: '',
        })
      )
    })
  })
  // Generate test for different cpu instructions on Windows
  it(`executes on Windows CPU with different instructions`, () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'cpu',
    }
    const cpuInstructions = ['avx512', 'avx2', 'avx', 'noavx']
    cpuInstructions.forEach((instruction) => {
      mockCpuInfo.mockReturnValue([instruction])
      expect(executableCortexFile(settings)).toEqual(
        expect.objectContaining({
          enginePath: expect.stringContaining(instruction),
          binPath: expect.stringContaining(`/bin`),
          executablePath: expect.stringContaining(`/cortex-server.exe`),
          cudaVisibleDevices: '',
          vkVisibleDevices: '',
        })
      )
    })
  })

  // Generate test for different cpu instructions on Windows
  it(`executes on Windows GPU with different instructions`, () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      cuda: {
        exist: true,
        version: '12',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    const cpuInstructions = ['avx512', 'avx2', 'avx', 'noavx']
    cpuInstructions.forEach((instruction) => {
      mockCpuInfo.mockReturnValue([instruction])
      expect(executableCortexFile(settings)).toEqual(
        expect.objectContaining({
          enginePath: expect.stringContaining(`cuda-12-0`),
          binPath: expect.stringContaining(`/bin`),
          executablePath: expect.stringContaining(`/cortex-server.exe`),
          cudaVisibleDevices: '0',
          vkVisibleDevices: '0',
        })
      )
    })
  })

  // Generate test for different cpu instructions on Linux
  it(`executes on Linux GPU with different instructions`, () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const cpuInstructions = ['avx512', 'avx2', 'avx', 'noavx']
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      cuda: {
        exist: true,
        version: '12',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    cpuInstructions.forEach((instruction) => {
      mockCpuInfo.mockReturnValue([instruction])
      expect(executableCortexFile(settings)).toEqual(
        expect.objectContaining({
          enginePath: expect.stringContaining(`cuda-12-0`),
          binPath: expect.stringContaining(`/bin`),
          executablePath: expect.stringContaining(`/cortex-server`),
          cudaVisibleDevices: '0',
          vkVisibleDevices: '0',
        })
      )
    })
  })

  // Generate test for different cpu instructions on Linux
  it(`executes on Linux Vulkan should not have CPU instructions included`, () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const cpuInstructions = ['avx512', 'avx2', 'avx', 'noavx']
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'gpu',
      vulkan: true,
      cuda: {
        exist: true,
        version: '12',
      },
      nvidia_driver: {
        exist: true,
        version: '12',
      },
      gpus_in_use: ['0'],
      gpus: [
        {
          id: '0',
          name: 'NVIDIA GeForce GTX 1080',
          vram: '80000000',
        },
      ],
    }
    cpuInstructions.forEach((instruction) => {
      mockCpuInfo.mockReturnValue([instruction])
      expect(executableCortexFile(settings)).toEqual(
        expect.objectContaining({
          enginePath: expect.stringContaining(`vulkan`),
          binPath: expect.stringContaining(`/bin`),
          executablePath: expect.stringContaining(`/cortex-server`),
          cudaVisibleDevices: '0',
          vkVisibleDevices: '0',
        })
      )
    })
  })

  // Generate test for different cpu instructions on MacOS
  it(`executes on MacOS with different instructions`, () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    })
    const cpuInstructions = ['avx512', 'avx2', 'avx', 'noavx']
    cpuInstructions.forEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      })
      const settings: GpuSetting = {
        ...testSettings,
        run_mode: 'cpu',
      }
      mockCpuInfo.mockReturnValue([])
      expect(executableCortexFile(settings)).toEqual(
        expect.objectContaining({
          enginePath: expect.stringContaining(`x64`),
          binPath: expect.stringContaining(`/bin`),
          executablePath:
            originalPlatform === 'darwin'
              ? expect.stringContaining(`/cortex-server`)
              : expect.anything(),
          cudaVisibleDevices: '',
          vkVisibleDevices: '',
        })
      )
    })
  })
})
