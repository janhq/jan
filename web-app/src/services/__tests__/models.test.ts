import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchModels,
  fetchModelCatalog,
  updateModel,
  pullModel,
  abortDownload,
  deleteModel,
  getActiveModels,
  stopModel,
  stopAllModels,
  startModel,
  configurePullOptions,
} from '../models'
import { EngineManager } from '@janhq/core'

// Mock EngineManager
vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
}))

// Mock fetch
global.fetch = vi.fn()

// Mock MODEL_CATALOG_URL
Object.defineProperty(global, 'MODEL_CATALOG_URL', {
  value: 'https://example.com/models',
  writable: true,
  configurable: true,
})

describe('models service', () => {
  const mockEngine = {
    list: vi.fn(),
    updateSettings: vi.fn(),
    import: vi.fn(),
    abortImport: vi.fn(),
    delete: vi.fn(),
    getLoadedModels: vi.fn(),
    unload: vi.fn(),
    load: vi.fn(),
  }

  const mockEngineManager = {
    get: vi.fn().mockReturnValue(mockEngine),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(EngineManager.instance as any).mockReturnValue(mockEngineManager)
  })

  describe('fetchModels', () => {
    it('should fetch models successfully', async () => {
      const mockModels = [
        { id: 'model1', name: 'Model 1' },
        { id: 'model2', name: 'Model 2' },
      ]
      mockEngine.list.mockResolvedValue(mockModels)

      const result = await fetchModels()

      expect(result).toEqual(mockModels)
      expect(mockEngine.list).toHaveBeenCalled()
    })
  })

  describe('fetchModelCatalog', () => {
    it('should fetch model catalog successfully', async () => {
      const mockCatalog = [
        {
          model_name: 'GPT-4',
          description: 'Large language model',
          developer: 'OpenAI',
          downloads: 1000,
          num_quants: 5,
          quants: [],
        },
      ]

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockCatalog),
      })

      const result = await fetchModelCatalog()

      expect(result).toEqual(mockCatalog)
    })

    it('should handle fetch error', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(fetchModelCatalog()).rejects.toThrow(
        'Failed to fetch model catalog: 404 Not Found'
      )
    })

    it('should handle network error', async () => {
      ;(fetch as any).mockRejectedValue(new Error('Network error'))

      await expect(fetchModelCatalog()).rejects.toThrow(
        'Failed to fetch model catalog: Network error'
      )
    })
  })

  describe('updateModel', () => {
    it('should update model settings', async () => {
      const model = {
        id: 'model1',
        settings: [{ key: 'temperature', value: 0.7 }],
      }

      await updateModel(model)

      expect(mockEngine.updateSettings).toHaveBeenCalledWith(model.settings)
    })

    it('should handle model without settings', async () => {
      const model = { id: 'model1' }

      await updateModel(model)

      expect(mockEngine.updateSettings).not.toHaveBeenCalled()
    })
  })

  describe('pullModel', () => {
    it('should pull model successfully', async () => {
      const id = 'model1'
      const modelPath = '/path/to/model'

      await pullModel(id, modelPath)

      expect(mockEngine.import).toHaveBeenCalledWith(id, { modelPath })
    })
  })

  describe('abortDownload', () => {
    it('should abort download successfully', async () => {
      const id = 'model1'

      await abortDownload(id)

      expect(mockEngine.abortImport).toHaveBeenCalledWith(id)
    })
  })

  describe('deleteModel', () => {
    it('should delete model successfully', async () => {
      const id = 'model1'

      await deleteModel(id)

      expect(mockEngine.delete).toHaveBeenCalledWith(id)
    })
  })

  describe('getActiveModels', () => {
    it('should get active models successfully', async () => {
      const mockActiveModels = ['model1', 'model2']
      mockEngine.getLoadedModels.mockResolvedValue(mockActiveModels)

      const result = await getActiveModels()

      expect(result).toEqual(mockActiveModels)
      expect(mockEngine.getLoadedModels).toHaveBeenCalled()
    })
  })

  describe('stopModel', () => {
    it('should stop model successfully', async () => {
      const model = 'model1'
      const provider = 'openai'

      await stopModel(model, provider)

      expect(mockEngine.unload).toHaveBeenCalledWith(model)
    })
  })

  describe('stopAllModels', () => {
    it('should stop all active models', async () => {
      const mockActiveModels = ['model1', 'model2']
      mockEngine.getLoadedModels.mockResolvedValue(mockActiveModels)

      await stopAllModels()

      expect(mockEngine.unload).toHaveBeenCalledTimes(2)
      expect(mockEngine.unload).toHaveBeenCalledWith('model1')
      expect(mockEngine.unload).toHaveBeenCalledWith('model2')
    })

    it('should handle empty active models', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(null)

      await stopAllModels()

      expect(mockEngine.unload).not.toHaveBeenCalled()
    })
  })

  describe('startModel', () => {
    it('should start model successfully', async () => {
      const provider = { provider: 'openai', models: [] } as ProviderObject
      const model = 'model1'
      const mockSession = { id: 'session1' }

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockResolvedValue(mockSession)

      const result = await startModel(provider, model)

      expect(result).toEqual(mockSession)
      expect(mockEngine.load).toHaveBeenCalledWith(model)
    })

    it('should handle start model error', async () => {
      const provider = { provider: 'openai', models: [] } as ProviderObject
      const model = 'model1'
      const error = new Error('Failed to start model')

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockRejectedValue(error)

      await expect(startModel(provider, model)).rejects.toThrow(error)
    })
    it('should not load model again', async () => {
      const provider = { provider: 'openai', models: [] } as ProviderObject
      const model = 'model1'

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => true,
      })
      expect(mockEngine.load).toBeCalledTimes(0)
      await expect(startModel(provider, model)).resolves.toBe(undefined)
    })
  })
})
