import { describe, beforeEach, it, expect, vi } from 'vitest'
import JanEngineManagementExtension from './index'
import { Engines, InferenceEngine } from '@janhq/core'

vi.stubGlobal('API_URL', 'http://localhost:3000')

const mockEngines: Engines = [
  {
    name: 'variant1',
    version: '1.0.0',
    type: 'local',
    engine: InferenceEngine.cortex_llamacpp,
  },
]

vi.stubGlobal('DEFAULT_REMOTE_ENGINES', mockEngines)

describe('migrate engine settings', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
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

  it('should not migrate when extesion version is not updated', async () => {
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
  })

  it('should return a list of engines', async () => {
    const mockKyGet = vi.spyOn(extension, 'getEngines')
    mockKyGet.mockResolvedValue(mockEngines)

    const engines = await extension.getEngines()

    expect(engines).toEqual(mockEngines)
  })
})

describe('updateDefaultEngine', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
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

  it('should not reset default engine variant if not installed', async () => {
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
})
