jest.mock('fetch-retry', () => ({
  default: () => () => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          model_loaded: true,
        }),
      text: () => Promise.resolve(''),
    })
  },
}))

jest.mock('path', () => ({
  default: {
    isAbsolute: jest.fn(),
    join: jest.fn(),
    parse: () => {
      return { dir: 'dir' }
    },
    delimiter: { concat: () => '' },
  },
}))

jest.mock('decompress', () => ({
  default: () => {
    return Promise.resolve()
  },
}))

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

jest.mock('tcp-port-used', () => ({
  default: {
    waitUntilFree: () => Promise.resolve(true),
    waitUntilUsed: () => Promise.resolve(true),
  },
}))

jest.mock('./execute', () => ({
  executableNitroFile: () => {
    return {
      enginePath: 'enginePath',
      executablePath: 'executablePath',
      cudaVisibleDevices: 'cudaVisibleDevices',
      vkVisibleDevices: 'vkVisibleDevices',
    }
  },
}))

jest.mock('terminate', () => ({
  default: (id: String, func: Function) => {
    console.log(id)
    func()
  },
}))

import * as execute from './execute'
import index from './index'

let executeMock = execute

const modelInitOptions: any = {
  modelFolder: '/path/to/model',
  model: {
    id: 'test',
    name: 'test',
    engine: 'nitro',
    version: '0.0',
    format: 'GGUF',
    object: 'model',
    sources: [],
    created: 0,
    description: 'test',
    parameters: {},
    metadata: {
      author: '',
      tags: [],
      size: 0,
    },
    settings: {
      prompt_template: '{prompt}',
      llama_model_path: 'model.gguf',
    },
  },
}

describe('loadModel', () => {
  it('should load a model successfully', async () => {
    // Mock the necessary parameters and system information

    const systemInfo = {
      // Mock the system information if needed
    }

    // Call the loadModel function
    const result = await index.loadModel(modelInitOptions, systemInfo)

    // Assert that the result is as expected
    expect(result).toBeUndefined()
  })

  it('should reject with an error message if the model is not a nitro model', async () => {
    // Mock the necessary parameters and system information

    const systemInfo = {
      // Mock the system information if needed
    }
    modelInitOptions.model.engine = 'not-nitro'
    // Call the loadModel function
    try {
      await index.loadModel(modelInitOptions, systemInfo)
    } catch (error) {
      // Assert that the error message is as expected
      expect(error).toBe('Not a cortex model')
    }
    modelInitOptions.model.engine = 'nitro'
  })

  it('should reject if model load failed with an error message', async () => {
    // Mock the necessary parameters and system information

    const systemInfo = {
      // Mock the system information if needed
    }
    // Mock the fetch-retry module to return a failed response
    jest.mock('fetch-retry', () => ({
      default: () => () => {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({
              model_loaded: false,
            }),
          text: () => Promise.resolve('Failed to load model'),
        })
      },
    }))

    // Call the loadModel function
    try {
      await index.loadModel(modelInitOptions, systemInfo)
    } catch (error) {
      // Assert that the error message is as expected
      expect(error).toBe('Failed to load model')
    }
  })

  it('should reject if port not available', async () => {
    // Mock the necessary parameters and system information

    const systemInfo = {
      // Mock the system information if needed
    }

    // Mock the tcp-port-used module to return false
    jest.mock('tcp-port-used', () => ({
      default: {
        waitUntilFree: () => Promise.resolve(false),
        waitUntilUsed: () => Promise.resolve(false),
      },
    }))

    // Call the loadModel function
    try {
      await index.loadModel(modelInitOptions, systemInfo)
    } catch (error) {
      // Assert that the error message is as expected
      expect(error).toBe('Port not available')
    }
  })

  it('should run on GPU model if ngl is set', async () => {
    const systemInfo: any = {
      gpuSetting: {
        run_mode: 'gpu',
      },
    }
    // Spy executableNitroFile
    jest.spyOn(executeMock, 'executableNitroFile').mockReturnValue({
      enginePath: '',
      executablePath: '',
      cudaVisibleDevices: '',
      vkVisibleDevices: '',
    })

    Object.defineProperty(process, 'platform', { value: 'win32' })
    await index.loadModel(
      {
        ...modelInitOptions,
        model: {
          ...modelInitOptions.model,
          settings: {
            ...modelInitOptions.model.settings,
            ngl: 40,
          },
        },
      },
      systemInfo
    )
    expect(executeMock.executableNitroFile).toHaveBeenCalledWith({
      run_mode: 'gpu',
    })
  })

  it('should run on correct CPU instructions if ngl is not set', async () => {
    const systemInfo: any = {
      gpuSetting: {
        run_mode: 'gpu',
      },
    }
    // Spy executableNitroFile
    jest.spyOn(executeMock, 'executableNitroFile').mockReturnValue({
      enginePath: '',
      executablePath: '',
      cudaVisibleDevices: '',
      vkVisibleDevices: '',
    })

    Object.defineProperty(process, 'platform', { value: 'win32' })
    await index.loadModel(
      {
        ...modelInitOptions,
        model: {
          ...modelInitOptions.model,
          settings: {
            ...modelInitOptions.model.settings,
            ngl: undefined,
          },
        },
      },
      systemInfo
    )
    expect(executeMock.executableNitroFile).toHaveBeenCalledWith({
      run_mode: 'cpu',
    })
  })

  it('should run on correct CPU instructions if ngl is 0', async () => {
    const systemInfo: any = {
      gpuSetting: {
        run_mode: 'gpu',
      },
    }
    // Spy executableNitroFile
    jest.spyOn(executeMock, 'executableNitroFile').mockReturnValue({
      enginePath: '',
      executablePath: '',
      cudaVisibleDevices: '',
      vkVisibleDevices: '',
    })

    Object.defineProperty(process, 'platform', { value: 'win32' })
    await index.loadModel(
      {
        ...modelInitOptions,
        model: {
          ...modelInitOptions.model,
          settings: {
            ...modelInitOptions.model.settings,
            ngl: 0,
          },
        },
      },
      systemInfo
    )
    expect(executeMock.executableNitroFile).toHaveBeenCalledWith({
      run_mode: 'cpu',
    })
  })
})

describe('unloadModel', () => {
  it('should unload a model successfully', async () => {
    // Call the unloadModel function
    const result = await index.unloadModel()

    // Assert that the result is as expected
    expect(result).toBeUndefined()
  })

  it('should reject with an error message if the model is not a nitro model', async () => {
    // Call the unloadModel function
    try {
      await index.unloadModel()
    } catch (error) {
      // Assert that the error message is as expected
      expect(error).toBe('Not a cortex model')
    }
  })

  it('should reject if model unload failed with an error message', async () => {
    // Mock the fetch-retry module to return a failed response
    jest.mock('fetch-retry', () => ({
      default: () => () => {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({
              model_unloaded: false,
            }),
          text: () => Promise.resolve('Failed to unload model'),
        })
      },
    }))

    // Call the unloadModel function
    try {
      await index.unloadModel()
    } catch (error) {
      // Assert that the error message is as expected
      expect(error).toBe('Failed to unload model')
    }
  })

  it('should reject if port not available', async () => {
    // Mock the tcp-port-used module to return false
    jest.mock('tcp-port-used', () => ({
      default: {
        waitUntilFree: () => Promise.resolve(false),
        waitUntilUsed: () => Promise.resolve(false),
      },
    }))

    // Call the unloadModel function
    try {
      await index.unloadModel()
    } catch (error) {
      // Assert that the error message is as expected
      expect(error).toBe('Port not available')
    }
  })
})
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

describe('getCurrentNitroProcessInfo', () => {
  it('should return the current nitro process info', async () => {
    // Call the getCurrentNitroProcessInfo function
    const result = await index.getCurrentNitroProcessInfo()

    // Assert that the result is as expected
    expect(result).toEqual({
      isRunning: true,
    })
  })
})

describe('decompressRunner', () => {
  it('should decompress the runner successfully', async () => {
    jest.mock('decompress', () => ({
      default: () => {
        return Promise.resolve()
      },
    }))
    // Call the decompressRunner function
    const result = await index.decompressRunner('', '')

    // Assert that the result is as expected
    expect(result).toBeUndefined()
  })
  it('should not reject if decompression failed', async () => {
    jest.mock('decompress', () => ({
      default: () => {
        return Promise.reject('Failed to decompress')
      },
    }))
    // Call the decompressRunner function
    const result = await index.decompressRunner('', '')
    expect(result).toBeUndefined()
  })
})

describe('addAdditionalDependencies', () => {
  it('should add additional dependencies successfully', async () => {
    // Call the addAdditionalDependencies function
    const result = await index.addAdditionalDependencies({
      name: 'name',
      version: 'version',
    })

    // Assert that the result is as expected
    expect(result).toBeUndefined()
  })
})
