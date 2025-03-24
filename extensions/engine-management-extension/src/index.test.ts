import { describe, beforeEach, it, expect, vi } from 'vitest'
import JanEngineManagementExtension from './index'
import { Engines, InferenceEngine } from '@janhq/core'
import { EngineError } from './error'
import { HTTPError } from 'ky'

vi.stubGlobal('API_URL', 'http://localhost:3000')

const mockEngines: Engines = [
  {
    name: 'variant1',
    version: '1.0.0',
    type: 'local',
    engine: InferenceEngine.cortex_llamacpp,
  },
]

const mockRemoteEngines: Engines = [
  {
    name: 'openai',
    version: '1.0.0',
    type: 'remote',
    engine: InferenceEngine.openai,
  },
]

const mockRemoteModels = {
  data: [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      engine: InferenceEngine.openai,
    },
  ],
}

vi.stubGlobal('DEFAULT_REMOTE_ENGINES', mockEngines)
vi.stubGlobal('DEFAULT_REMOTE_MODELS', mockRemoteModels.data)

describe('migrate engine settings', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('engines should be migrated', async () => {
    vi.stubGlobal('VERSION', '2.0.0')

    vi.spyOn(extension, 'getEngines').mockResolvedValue([])
    const mockUpdateEngines = vi
      .spyOn(extension, 'updateEngine')
      .mockReturnThis()

    mockUpdateEngines.mockResolvedValue({
      messages: 'OK',
    })

    await extension.migrate()

    // Assert that the returned value is equal to the mockEngines object
    expect(mockUpdateEngines).toBeCalled()
  })

  it('should not migrate when extension version is not updated', async () => {
    vi.stubGlobal('VERSION', '0.0.0')
    vi.spyOn(extension, 'getEngines').mockResolvedValue([])
    const mockUpdateEngines = vi
      .spyOn(extension, 'updateEngine')
      .mockReturnThis()

    mockUpdateEngines.mockResolvedValue({
      messages: 'OK',
    })

    await extension.migrate()

    // Assert that the returned value is equal to the mockEngines object
    expect(mockUpdateEngines).not.toBeCalled()
  })
})

describe('getEngines', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should return a list of engines', async () => {
    const mockKyGet = vi.spyOn(extension, 'getEngines')
    mockKyGet.mockResolvedValue(mockEngines)

    const engines = await extension.getEngines()

    expect(engines).toEqual(mockEngines)
  })
})

describe('getRemoteModels', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should return a list of remote models', async () => {
    vi.mock('ky', () => ({
      default: {
        get: () => ({
          json: () => Promise.resolve(mockRemoteModels),
        }),
      },
    }))

    const models = await extension.getRemoteModels('openai')
    expect(models).toEqual(mockRemoteModels)
  })

  it('should return empty data array when request fails', async () => {
    vi.mock('ky', () => ({
      default: {
        get: () => ({
          json: () => Promise.reject(new Error('Failed to fetch')),
        }),
      },
    }))

    const models = await extension.getRemoteModels('openai')
    expect(models).toEqual({ data: [] })
  })
})

describe('getInstalledEngines', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should return a list of installed engines', async () => {
    const mockEngineVariants = [
      {
        name: 'windows-amd64-noavx',
        version: '1.0.0',
      },
    ]

    vi.mock('ky', () => ({
      default: {
        get: () => ({
          json: () => Promise.resolve(mockEngineVariants),
        }),
      },
    }))

    const mock = vi.spyOn(extension, 'getInstalledEngines')
    mock.mockResolvedValue(mockEngineVariants)

    const engines = await extension.getInstalledEngines(InferenceEngine.cortex_llamacpp)
    expect(engines).toEqual(mockEngineVariants)
  })
})

describe('healthz', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should perform health check successfully', async () => {
    vi.mock('ky', () => ({
      default: {
        get: () => Promise.resolve(),
      },
    }))

    await extension.healthz()
    expect(extension.queue.concurrency).toBe(Infinity)
  })
})

describe('updateDefaultEngine', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should set default engine variant if not installed', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    vi.stubGlobal('CORTEX_ENGINE_VERSION', '1.0.0')

    const mockGetDefaultEngineVariant = vi.spyOn(
      extension,
      'getDefaultEngineVariant'
    )
    mockGetDefaultEngineVariant.mockResolvedValue({
      variant: 'variant1',
      version: '1.0.0',
    })

    const mockGetInstalledEngines = vi.spyOn(extension, 'getInstalledEngines')
    mockGetInstalledEngines.mockResolvedValue([])

    const mockSetDefaultEngineVariant = vi.spyOn(
      extension,
      'setDefaultEngineVariant'
    )
    mockSetDefaultEngineVariant.mockResolvedValue({ messages: 'OK' })

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        systemInformation: vi.fn().mockResolvedValue({ gpuSetting: 'high' }),
      }
    })

    vi.mock('./utils', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        engineVariant: vi.fn().mockResolvedValue('windows-amd64-noavx'),
      }
    })

    await extension.updateDefaultEngine()

    expect(mockSetDefaultEngineVariant).toHaveBeenCalledWith('llama-cpp', {
      variant: 'windows-amd64-noavx',
      version: '1.0.0',
    })
  })

  it('should not reset default engine variant if installed', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    vi.stubGlobal('CORTEX_ENGINE_VERSION', '1.0.0')

    const mockGetDefaultEngineVariant = vi.spyOn(
      extension,
      'getDefaultEngineVariant'
    )
    mockGetDefaultEngineVariant.mockResolvedValue({
      variant: 'windows-amd64-noavx',
      version: '1.0.0',
    })

    const mockGetInstalledEngines = vi.spyOn(extension, 'getInstalledEngines')
    mockGetInstalledEngines.mockResolvedValue([
      {
        name: 'windows-amd64-noavx',
        version: '1.0.0',
        type: 'local',
        engine: InferenceEngine.cortex_llamacpp,
      },
    ])

    const mockSetDefaultEngineVariant = vi.spyOn(
      extension,
      'setDefaultEngineVariant'
    )
    mockSetDefaultEngineVariant.mockResolvedValue({ messages: 'OK' })

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        systemInformation: vi.fn().mockResolvedValue({ gpuSetting: 'high' }),
      }
    })

    vi.mock('./utils', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        engineVariant: vi.fn().mockResolvedValue('windows-amd64-noavx'),
      }
    })

    await extension.updateDefaultEngine()

    expect(mockSetDefaultEngineVariant).not.toBeCalled()
  })

  it('should handle HTTPError when getting default engine variant', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    vi.stubGlobal('CORTEX_ENGINE_VERSION', '1.0.0')

    const httpError = new Error('HTTP Error') as HTTPError
    httpError.response = { status: 400 } as Response

    const mockGetDefaultEngineVariant = vi.spyOn(
      extension,
      'getDefaultEngineVariant'
    )
    mockGetDefaultEngineVariant.mockRejectedValue(httpError)

    const mockSetDefaultEngineVariant = vi.spyOn(
      extension,
      'setDefaultEngineVariant'
    )
    mockSetDefaultEngineVariant.mockResolvedValue({ messages: 'OK' })

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        systemInformation: vi.fn().mockResolvedValue({ gpuSetting: 'high' }),
      }
    })

    vi.mock('./utils', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        engineVariant: vi.fn().mockResolvedValue('windows-amd64-noavx'),
      }
    })

    await extension.updateDefaultEngine()

    expect(mockSetDefaultEngineVariant).toHaveBeenCalledWith('llama-cpp', {
      variant: 'windows-amd64-noavx',
      version: '1.0.0',
    })
  })

  it('should handle EngineError when getting default engine variant', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    vi.stubGlobal('CORTEX_ENGINE_VERSION', '1.0.0')

    const mockGetDefaultEngineVariant = vi.spyOn(
      extension,
      'getDefaultEngineVariant'
    )
    mockGetDefaultEngineVariant.mockRejectedValue(new EngineError('Test error'))

    const mockSetDefaultEngineVariant = vi.spyOn(
      extension,
      'setDefaultEngineVariant'
    )
    mockSetDefaultEngineVariant.mockResolvedValue({ messages: 'OK' })

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        systemInformation: vi.fn().mockResolvedValue({ gpuSetting: 'high' }),
      }
    })

    vi.mock('./utils', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        engineVariant: vi.fn().mockResolvedValue('windows-amd64-noavx'),
      }
    })

    await extension.updateDefaultEngine()

    expect(mockSetDefaultEngineVariant).toHaveBeenCalledWith('llama-cpp', {
      variant: 'windows-amd64-noavx',
      version: '1.0.0',
    })
  })

  it('should handle unexpected errors gracefully', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    
    const mockGetDefaultEngineVariant = vi.spyOn(
      extension,
      'getDefaultEngineVariant'
    )
    mockGetDefaultEngineVariant.mockRejectedValue(new Error('Unexpected error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    await extension.updateDefaultEngine()
    
    expect(consoleSpy).toHaveBeenCalled()
  })
})

describe('populateDefaultRemoteEngines', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should not add default remote engines if remote engines already exist', async () => {
    const mockGetEngines = vi.spyOn(extension, 'getEngines')
    mockGetEngines.mockResolvedValue(mockRemoteEngines)

    const mockAddRemoteEngine = vi.spyOn(extension, 'addRemoteEngine')
    
    await extension.populateDefaultRemoteEngines()
    
    expect(mockAddRemoteEngine).not.toBeCalled()
  })

  it('should add default remote engines if no remote engines exist', async () => {
    const mockGetEngines = vi.spyOn(extension, 'getEngines')
    mockGetEngines.mockResolvedValue([])

    const mockAddRemoteEngine = vi.spyOn(extension, 'addRemoteEngine')
    mockAddRemoteEngine.mockResolvedValue({ messages: 'OK' })

    const mockAddRemoteModel = vi.spyOn(extension, 'addRemoteModel')
    mockAddRemoteModel.mockResolvedValue(undefined)

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        events: {
          emit: vi.fn(),
        },
        joinPath: vi.fn().mockResolvedValue('/path/to/settings.json'),
        getJanDataFolderPath: vi.fn().mockResolvedValue('/path/to/data'),
        fs: {
          existsSync: vi.fn().mockResolvedValue(false),
        },
      }
    })

    await extension.populateDefaultRemoteEngines()
    
    expect(mockAddRemoteEngine).toHaveBeenCalled()
    expect(mockAddRemoteModel).toHaveBeenCalled()
  })
})
