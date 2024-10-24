import { Model, InferenceEngine } from '@janhq/core'
import JanModelExtension from './index'

// Mock the @janhq/core module
jest.mock('@janhq/core', () => ({
  ModelExtension: class {},
  InferenceEngine: {
    nitro: 'nitro',
  },
  joinPath: jest.fn(),
  dirName: jest.fn(),
}))

// Mock the CortexAPI
jest.mock('./cortex', () => ({
  CortexAPI: jest.fn().mockImplementation(() => ({
    getModels: jest.fn(),
    importModel: jest.fn(),
  })),
}))

// Mock the model-json module
jest.mock('./model-json', () => ({
  scanModelsFolder: jest.fn(),
}))

// Import the mocked scanModelsFolder after the mock is set up
const { scanModelsFolder } = jest.requireMock('./model-json')

describe('JanModelExtension', () => {
  let extension: JanModelExtension
  let mockLocalStorage: { [key: string]: string }
  let mockCortexAPI: jest.Mock

  beforeEach(() => {
    // @ts-ignore
    extension = new JanModelExtension()
    mockLocalStorage = {}
    mockCortexAPI = extension.cortexAPI as any

    // Mock localStorage
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: jest.fn((key) => mockLocalStorage[key]),
        setItem: jest.fn((key, value) => {
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
      scanModelsFolder.mockResolvedValue(mockModels)
      extension.cortexAPI.importModel = jest
        .fn()
        .mockResolvedValueOnce(mockModels[0])
      extension.cortexAPI.getModels = jest
        .fn()
        .mockResolvedValue([mockModels[0]])
      extension.cortexAPI.importModel = jest
        .fn()
        .mockResolvedValueOnce(mockModels[1])
      extension.cortexAPI.getModels = jest
        .fn()
        .mockResolvedValue([mockModels[0], mockModels[1]])

      const result = await extension.getModels()
      expect(scanModelsFolder).toHaveBeenCalled()
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

      extension.cortexAPI.getModels = jest.fn().mockResolvedValue([])
      extension.importModel = jest.fn().mockResolvedValue(undefined)

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

      extension.cortexAPI.getModels = jest.fn().mockResolvedValue(mockModels)

      const result = await extension.getModels()

      expect(extension.cortexAPI.getModels).toHaveBeenCalled()
      expect(result).toEqual(mockModels)
    })
  })
})
