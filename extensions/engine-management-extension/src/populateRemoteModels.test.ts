import { describe, beforeEach, it, expect, vi } from 'vitest'
import JanEngineManagementExtension from './index'
import { InferenceEngine } from '@janhq/core'

describe('populateRemoteModels', () => {
  let extension: JanEngineManagementExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanEngineManagementExtension()
    vi.resetAllMocks()
  })

  it('should populate remote models successfully', async () => {
    const mockEngineConfig = {
      engine: InferenceEngine.openai,
    }

    const mockRemoteModels = {
      data: [
        {
          id: 'gpt-4',
          name: 'GPT-4',
        },
      ],
    }

    const mockGetRemoteModels = vi.spyOn(extension, 'getRemoteModels')
    mockGetRemoteModels.mockResolvedValue(mockRemoteModels)

    const mockAddRemoteModel = vi.spyOn(extension, 'addRemoteModel')
    mockAddRemoteModel.mockResolvedValue(undefined)

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        events: {
          emit: vi.fn(),
        },
      }
    })

    // Use the private method through index.ts
    // @ts-ignore - Accessing private method for testing
    await extension.populateRemoteModels(mockEngineConfig)

    expect(mockGetRemoteModels).toHaveBeenCalledWith(mockEngineConfig.engine)
    expect(mockAddRemoteModel).toHaveBeenCalledWith({
      ...mockRemoteModels.data[0],
      engine: mockEngineConfig.engine,
      model: 'gpt-4',
    })
  })

  it('should handle empty data from remote models', async () => {
    const mockEngineConfig = {
      engine: InferenceEngine.openai,
    }

    const mockGetRemoteModels = vi.spyOn(extension, 'getRemoteModels')
    mockGetRemoteModels.mockResolvedValue({ data: [] })

    const mockAddRemoteModel = vi.spyOn(extension, 'addRemoteModel')

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        events: {
          emit: vi.fn(),
        },
      }
    })

    // @ts-ignore - Accessing private method for testing
    await extension.populateRemoteModels(mockEngineConfig)

    expect(mockGetRemoteModels).toHaveBeenCalledWith(mockEngineConfig.engine)
    expect(mockAddRemoteModel).not.toHaveBeenCalled()
  })

  it('should handle errors when getting remote models', async () => {
    const mockEngineConfig = {
      engine: InferenceEngine.openai,
    }

    const mockGetRemoteModels = vi.spyOn(extension, 'getRemoteModels')
    mockGetRemoteModels.mockRejectedValue(new Error('Failed to fetch models'))

    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // @ts-ignore - Accessing private method for testing
    await extension.populateRemoteModels(mockEngineConfig)

    expect(mockGetRemoteModels).toHaveBeenCalledWith(mockEngineConfig.engine)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('should handle errors when adding remote models', async () => {
    const mockEngineConfig = {
      engine: InferenceEngine.openai,
    }

    const mockRemoteModels = {
      data: [
        {
          id: 'gpt-4',
          name: 'GPT-4',
        },
      ],
    }

    const mockGetRemoteModels = vi.spyOn(extension, 'getRemoteModels')
    mockGetRemoteModels.mockResolvedValue(mockRemoteModels)

    const mockAddRemoteModel = vi.spyOn(extension, 'addRemoteModel')
    mockAddRemoteModel.mockRejectedValue(new Error('Failed to add model'))

    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    vi.mock('@janhq/core', async (importOriginal) => {
      const actual = (await importOriginal()) as any
      return {
        ...actual,
        events: {
          emit: vi.fn(),
        },
      }
    })

    // @ts-ignore - Accessing private method for testing
    await extension.populateRemoteModels(mockEngineConfig)

    expect(mockGetRemoteModels).toHaveBeenCalledWith(mockEngineConfig.engine)
    expect(mockAddRemoteModel).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
  })
})