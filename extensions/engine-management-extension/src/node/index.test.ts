import { describe, expect, it } from '@jest/globals'
import engine from './index'
import { GpuSetting } from '@janhq/core/node'
import { cpuInfo } from 'cpu-instructions'
import { fork } from 'child_process'

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

jest.mock('@janhq/core/node', () => ({
  appResourcePath: () => '.',
  log: jest.fn(),
}))
jest.mock('child_process', () => ({
  fork: jest.fn(),
}))
const mockFork = fork as jest.Mock

describe('test executable cortex file', () => {
  afterAll(function () {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
  })

  it('executes on MacOS', () => {
    const mockProcess = {
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('noavx')
        }
      }),
      send: jest.fn(),
    }
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    })
    Object.defineProperty(process, 'arch', {
      value: 'arm64',
    })

    mockFork.mockReturnValue(mockProcess)
    expect(engine.engineVariant(testSettings)).resolves.toEqual('mac-arm64')
  })

  it('executes on MacOS', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    })
    Object.defineProperty(process, 'arch', {
      value: 'arm64',
    })

    const mockProcess = {
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('noavx')
        }
      }),
      send: jest.fn(),
    }
    mockFork.mockReturnValue(mockProcess)
    Object.defineProperty(process, 'arch', {
      value: 'x64',
    })

    expect(engine.engineVariant(testSettings)).resolves.toEqual('mac-amd64')
  })

  it('executes on Windows CPU', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })
    const settings: GpuSetting = {
      ...testSettings,
      run_mode: 'cpu',
    }
    const mockProcess = {
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('avx')
        }
      }),
      send: jest.fn(),
    }
    mockFork.mockReturnValue(mockProcess)

    expect(engine.engineVariant()).resolves.toEqual('windows-amd64-avx')
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

    const mockProcess = {
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('avx2')
        }
      }),
      send: jest.fn(),
    }
    mockFork.mockReturnValue(mockProcess)

    expect(engine.engineVariant(settings)).resolves.toEqual(
      'windows-amd64-avx2-cuda-11-7'
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
    mockFork.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('noavx')
        }
      }),
      send: jest.fn(),
    })

    expect(engine.engineVariant(settings)).resolves.toEqual(
      'windows-amd64-noavx-cuda-12-0'
    )
    mockFork.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('avx512')
        }
      }),
      send: jest.fn(),
    })
    expect(engine.engineVariant(settings)).resolves.toEqual(
      'windows-amd64-avx2-cuda-12-0'
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
    mockFork.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('noavx')
        }
      }),
      send: jest.fn(),
    })

    expect(engine.engineVariant()).resolves.toEqual('linux-amd64-noavx')
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

    mockFork.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('avx512')
        }
      }),
      send: jest.fn(),
    })

    expect(engine.engineVariant(settings)).resolves.toBe(
      'linux-amd64-avx2-cuda-11-7'
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
    mockFork.mockReturnValue({
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          callback('avx2')
        }
      }),
      send: jest.fn(),
    })

    expect(engine.engineVariant(settings)).resolves.toEqual(
      'linux-amd64-avx2-cuda-12-0'
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
      mockFork.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'message') {
            callback(instruction)
          }
        }),
        send: jest.fn(),
      })

      expect(engine.engineVariant(settings)).resolves.toEqual(
        `linux-amd64-${instruction}`
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
      mockFork.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'message') {
            callback(instruction)
          }
        }),
        send: jest.fn(),
      })
      expect(engine.engineVariant(settings)).resolves.toEqual(
        `windows-amd64-${instruction}`
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
      mockFork.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'message') {
            callback(instruction)
          }
        }),
        send: jest.fn(),
      })
      expect(engine.engineVariant(settings)).resolves.toEqual(
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
      mockFork.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'message') {
            callback(instruction)
          }
        }),
        send: jest.fn(),
      })
      expect(engine.engineVariant(settings)).resolves.toEqual(
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
      mockFork.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'message') {
            callback(instruction)
          }
        }),
        send: jest.fn(),
      })
      expect(engine.engineVariant(settings)).resolves.toEqual(
        `linux-amd64-vulkan`
      )
    })
  })
})
