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
