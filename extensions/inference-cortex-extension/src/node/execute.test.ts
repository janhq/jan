import { describe, expect, it } from '@jest/globals'
import { engineVariant, executableCortexFile } from './execute'
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
        enginePath: expect.stringContaining(`bin`),
        executablePath:
          originalPlatform === 'darwin'
            ? expect.stringContaining(`cortex-server`)
            : expect.anything(),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
    expect(engineVariant(testSettings)).toEqual('mac-arm64')
    Object.defineProperty(process, 'arch', {
      value: 'x64',
    })
    expect(executableCortexFile(testSettings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`bin`),
        executablePath:
          originalPlatform === 'darwin'
            ? expect.stringContaining(`cortex-server`)
            : expect.anything(),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
    expect(engineVariant(testSettings)).toEqual('mac-amd64')
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
        enginePath: expect.stringContaining(`bin`),
        executablePath: expect.stringContaining(`cortex-server.exe`),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
    expect(engineVariant()).toEqual('windows-amd64-avx')
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
    mockCpuInfo.mockReturnValue(['avx2'])
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`bin`),
        executablePath: expect.stringContaining(`cortex-server.exe`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
    expect(engineVariant(settings)).toEqual('windows-amd64-avx2-cuda-11-7')
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
    mockCpuInfo.mockReturnValue(['noavx'])
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`bin`),
        executablePath: expect.stringContaining(`cortex-server.exe`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
    expect(engineVariant(settings)).toEqual('windows-amd64-noavx-cuda-12-0')
    mockCpuInfo.mockReturnValue(['avx512'])
    expect(engineVariant(settings)).toEqual('windows-amd64-avx2-cuda-12-0')
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
        enginePath: expect.stringContaining(`bin`),
        executablePath: expect.stringContaining(`cortex-server`),
        cudaVisibleDevices: '',
        vkVisibleDevices: '',
      })
    )
    expect(engineVariant()).toEqual('linux-amd64-noavx')
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
    mockCpuInfo.mockReturnValue(['avx512'])
    expect(executableCortexFile(settings)).toEqual(
      expect.objectContaining({
        enginePath: expect.stringContaining(`bin`),
        executablePath: expect.stringContaining(`cortex-server`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
    expect(engineVariant(settings)).toEqual('linux-amd64-avx2-cuda-11-7')
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
        enginePath: expect.stringContaining(`bin`),
        executablePath: expect.stringContaining(`cortex-server`),
        cudaVisibleDevices: '0',
        vkVisibleDevices: '0',
      })
    )
    expect(engineVariant(settings)).toEqual('linux-amd64-avx2-cuda-12-0')
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
          enginePath: expect.stringContaining('bin'),
          executablePath: expect.stringContaining(`cortex-server`),

          cudaVisibleDevices: '',
          vkVisibleDevices: '',
        })
      )
      expect(engineVariant(settings)).toEqual(`linux-amd64-${instruction}`)
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
          enginePath: expect.stringContaining('bin'),
          executablePath: expect.stringContaining(`cortex-server.exe`),
          cudaVisibleDevices: '',
          vkVisibleDevices: '',
        })
      )
      expect(engineVariant(settings)).toEqual(`windows-amd64-${instruction}`)
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
          enginePath: expect.stringContaining(`bin`),
          executablePath: expect.stringContaining(`cortex-server.exe`),
          cudaVisibleDevices: '0',
          vkVisibleDevices: '0',
        })
      )
      expect(engineVariant(settings)).toEqual(
        `windows-amd64-${instruction === 'avx512' || instruction === 'avx2' ? 'avx2' : 'noavx'}-cuda-12-0`
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
          enginePath: expect.stringContaining(`bin`),
          executablePath: expect.stringContaining(`cortex-server`),
          cudaVisibleDevices: '0',
          vkVisibleDevices: '0',
        })
      )
      expect(engineVariant(settings)).toEqual(
        `linux-amd64-${instruction === 'avx512' || instruction === 'avx2' ? 'avx2' : 'noavx'}-cuda-12-0`
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
          enginePath: expect.stringContaining(`bin`),
          executablePath: expect.stringContaining(`cortex-server`),
          cudaVisibleDevices: '0',
          vkVisibleDevices: '0',
        })
      )
      expect(engineVariant(settings)).toEqual(`linux-amd64-vulkan`)
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
          enginePath: expect.stringContaining(`bin`),
          executablePath:
            originalPlatform === 'darwin'
              ? expect.stringContaining(`cortex-server`)
              : expect.anything(),
          cudaVisibleDevices: '',
          vkVisibleDevices: '',
        })
      )
    })
  })
})
