jest.mock('@janhq/core/node', () => ({
  ...jest.requireActual('@janhq/core/node'),
  getJanDataFolderPath: () => '',
  getSystemResourceInfo: () => {
    return {
      cpu: {
        cores: 1,
        logicalCores: 1,
        threads: 1,
        model: 'model',
        speed: 1,
      },
      memory: {
        total: 1,
        free: 1,
      },
      gpu: {
        model: 'model',
        memory: 1,
        cuda: {
          version: 'version',
          devices: 'devices',
        },
        vulkan: {
          version: 'version',
          devices: 'devices',
        },
      },
    }
  },
}))

jest.mock('fs', () => ({
  default: {
    readdirSync: () => [],
  },
}))

jest.mock('child_process', () => ({
  exec: () => {
    return {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
    }
  },
  spawn: () => {
    return {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      pid: '111',
    }
  },
}))

jest.mock('./execute', () => ({
  executableCortexFile: () => {
    return {
      enginePath: 'enginePath',
      executablePath: 'executablePath',
      cudaVisibleDevices: 'cudaVisibleDevices',
      vkVisibleDevices: 'vkVisibleDevices',
    }
  },
}))

import index from './index'

describe('dispose', () => {
  it('should dispose a model successfully on Mac', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    })

    // Call the dispose function
    const result = await index.dispose()

    // Assert that the result is as expected
    expect(result).toBeUndefined()
  })

  it('should kill the subprocess successfully on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    })

    // Call the killSubprocess function
    const result = await index.dispose()

    // Assert that the result is as expected
    expect(result).toBeUndefined()
  })
})
