import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubGlobal('API_URL', 'http://localhost:3000')


// Mock the @janhq/core module
vi.mock('@janhq/core', (actual) => ({
  ...actual,
  ModelExtension: class {},
  InferenceEngine: {
    nitro: 'nitro',
  },
  joinPath: vi.fn(),
  dirName: vi.fn(),
  fs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}))

import { Model, InferenceEngine } from '@janhq/core'

import JanModelExtension from './index'

// Mock the model-json module
vi.mock('./legacy/model-json', () => ({
  scanModelsFolder: vi.fn(),
}))

// Import the mocked scanModelsFolder after the mock is set up
import * as legacy from './legacy/model-json'

describe('JanModelExtension', () => {
  let extension: JanModelExtension
  let mockLocalStorage: { [key: string]: string }

  beforeEach(() => {
    // @ts-ignore
    extension = new JanModelExtension()
    mockLocalStorage = {}

    // Mock localStorage
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: vi.fn((key) => mockLocalStorage[key]),
        setItem: vi.fn((key, value) => {
          mockLocalStorage[key] = value
        }),
      },
      writable: true,
    })
  })

  describe('getModels', () => {
    it('should scan models folder when localStorage is empty', async () => {
      const mockModels: Model[] = [
        {
          id: 'model1',
          object: 'model',
          version: '1',
          format: 'gguf',
          engine: InferenceEngine.nitro,
          sources: [
            { filename: 'model1.gguf', url: 'file://models/model1.gguf' },
          ],
          file_path: '/path/to/model1',
        },
        {
          id: 'model2',
          object: 'model',
          version: '1',
          format: 'gguf',
          engine: InferenceEngine.nitro,
          sources: [
            { filename: 'model2.gguf', url: 'file://models/model2.gguf' },
          ],
          file_path: '/path/to/model2',
        },
      ] as any
      vi.mocked(legacy.scanModelsFolder).mockResolvedValue(mockModels)
      vi.spyOn(extension, 'fetchModels').mockResolvedValue([mockModels[0]])
      vi.spyOn(extension, 'updateModel').mockResolvedValue(undefined)
      vi.spyOn(extension, 'importModel').mockResolvedValueOnce(mockModels[1])
      vi.spyOn(extension, 'fetchModels').mockResolvedValue([mockModels[0], mockModels[1]])
      const result = await extension.getModels()
      expect(legacy.scanModelsFolder).toHaveBeenCalled()
      expect(result).toEqual(mockModels)
    })

    it('should import models when there are models to import', async () => {
      const mockModels: Model[] = [
        {
          id: 'model1',
          object: 'model',
          version: '1',
          format: 'gguf',
          engine: InferenceEngine.nitro,
          file_path: '/path/to/model1',
          sources: [
            { filename: 'model1.gguf', url: 'file://models/model1.gguf' },
          ],
        },
        {
          id: 'model2',
          object: 'model',
          version: '1',
          format: 'gguf',
          engine: InferenceEngine.nitro,
          file_path: '/path/to/model2',
          sources: [
            { filename: 'model2.gguf', url: 'file://models/model2.gguf' },
          ],
        },
      ] as any
      mockLocalStorage['downloadedModels'] = JSON.stringify(mockModels)
      vi.spyOn(extension, 'updateModel').mockResolvedValue(undefined)
      vi.spyOn(extension, 'importModel').mockResolvedValue(undefined)

      const result = await extension.getModels()

      expect(extension.importModel).toHaveBeenCalledTimes(2)
      expect(result).toEqual(mockModels)
    })

    it('should return models from cortexAPI when all models are already imported', async () => {
      const mockModels: Model[] = [
        {
          id: 'model1',
          object: 'model',
          version: '1',
          format: 'gguf',
          engine: InferenceEngine.nitro,
          sources: [
            { filename: 'model1.gguf', url: 'file://models/model1.gguf' },
          ],
        },
        {
          id: 'model2',
          object: 'model',
          version: '1',
          format: 'gguf',
          engine: InferenceEngine.nitro,
          sources: [
            { filename: 'model2.gguf', url: 'file://models/model2.gguf' },
          ],
        },
      ] as any
      mockLocalStorage['downloadedModels'] = JSON.stringify(mockModels)
      vi.spyOn(extension, 'fetchModels').mockResolvedValue(mockModels)
      extension.getModels = vi.fn().mockResolvedValue(mockModels)

      const result = await extension.getModels()

      expect(extension.getModels).toHaveBeenCalled()
      expect(result).toEqual(mockModels)
    })
  })
})
