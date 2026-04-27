import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useModelScore } from '../../hooks/useModelScores'
import { DefaultModelsService } from '../models/default'
import type { HuggingFaceRepo, CatalogModel } from '../models/types'
import { EngineManager, events, DownloadEvent } from '@janhq/core'

const { mockEvents, mockDownloadEvent } = vi.hoisted(() => ({
  mockEvents: { emit: vi.fn() },
  mockDownloadEvent: { onFileDownloadStopped: 'onFileDownloadStopped' } as Record<string, string>,
}))

vi.mock('@janhq/core', () => ({
  EngineManager: { instance: vi.fn() },
  events: mockEvents,
  DownloadEvent: mockDownloadEvent,
}))

global.fetch = vi.fn()

Object.defineProperty(global, 'MODEL_CATALOG_URL', {
  value: 'https://example.com/models',
  writable: true,
  configurable: true,
})

describe('DefaultModelsService', () => {
  let modelsService: DefaultModelsService

  const mockEngine = {
    list: vi.fn(),
    updateSettings: vi.fn(),
    update: vi.fn(),
    import: vi.fn(),
    abortImport: vi.fn(),
    delete: vi.fn(),
    getLoadedModels: vi.fn(),
    unload: vi.fn(),
    load: vi.fn(),
    isModelSupported: vi.fn(),
    isToolSupported: vi.fn(),
    checkMmprojExists: vi.fn(),
    getHubModelScore: vi.fn(),
  }

  const mockEngineManager = { get: vi.fn().mockReturnValue(mockEngine) }

  beforeEach(() => {
    useModelScore.getState().reset()
    modelsService = new DefaultModelsService()
    vi.clearAllMocks()
    ;(EngineManager.instance as any).mockReturnValue(mockEngineManager)
    mockEvents.emit.mockClear()
  })

  describe('fetchModels', () => {
    it('should fetch models successfully', async () => {
      const mockModels = [{ id: 'model1' }, { id: 'model2' }]
      mockEngine.list.mockResolvedValue(mockModels)
      expect(await modelsService.fetchModels()).toEqual(mockModels)
    })
  })

  describe('fetchModelCatalog', () => {
    it('should fetch model catalog successfully', async () => {
      const mockCatalog = [{ model_name: 'GPT-4', description: 'LLM' }]
      ;(fetch as any).mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(mockCatalog) })
      expect(await modelsService.fetchModelCatalog()).toEqual(mockCatalog)
    })

    it('should handle fetch error', async () => {
      ;(fetch as any).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
      await expect(modelsService.fetchModelCatalog()).rejects.toThrow('Failed to fetch model catalog: 404 Not Found')
    })

    it('should handle network error', async () => {
      ;(fetch as any).mockRejectedValue(new Error('Network error'))
      await expect(modelsService.fetchModelCatalog()).rejects.toThrow('Failed to fetch model catalog: Network error')
    })
  })

  describe('updateModel', () => {
    it.each([
      ['with settings', { id: 'model1', settings: [{ key: 'temp', value: 0.7 }] }, true],
      ['without settings', { id: 'model1' }, false],
      ['with different modelId', { id: 'new-id', settings: [{ key: 'temp', value: 0.7 }] }, true],
    ])('should handle model %s', async (_label, model, expectSettings) => {
      await modelsService.updateModel('model1', model as any)
      if (expectSettings) {
        expect(mockEngine.updateSettings).toHaveBeenCalledWith(model.settings)
      } else {
        expect(mockEngine.updateSettings).not.toHaveBeenCalled()
      }
      expect(mockEngine.update).not.toHaveBeenCalled()
    })
  })

  describe('pullModel', () => {
    it('should pull model successfully', async () => {
      await modelsService.pullModel('model1', '/path/to/model')
      expect(mockEngine.import).toHaveBeenCalledWith('model1', { modelPath: '/path/to/model' })
    })
  })

  describe('abortDownload', () => {
    it('should abort download and emit event', async () => {
      await modelsService.abortDownload('model1')
      expect(mockEngine.abortImport).toHaveBeenCalledWith('model1')
      expect(events.emit).toHaveBeenCalledWith(
        DownloadEvent.onFileDownloadStopped,
        expect.objectContaining({ modelId: 'model1', downloadType: 'Model' })
      )
    })
  })

  describe('deleteModel', () => {
    it('should delete model', async () => {
      await modelsService.deleteModel('model1')
      expect(mockEngine.delete).toHaveBeenCalledWith('model1')
    })
  })

  describe('getActiveModels', () => {
    it('should get active models', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(['model1', 'model2'])
      expect(await modelsService.getActiveModels()).toEqual(['model1', 'model2'])
    })
  })

  describe('stopModel / stopAllModels', () => {
    it('should stop model', async () => {
      await modelsService.stopModel('model1', 'openai')
      expect(mockEngine.unload).toHaveBeenCalledWith('model1')
    })

    it('should stop all active models from all providers', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(['model1', 'model2'])
      await modelsService.stopAllModels()
      expect(mockEngine.unload).toHaveBeenCalledTimes(4)
    })

    it('should handle empty active models', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(null)
      await modelsService.stopAllModels()
      expect(mockEngine.unload).not.toHaveBeenCalled()
    })
  })

  describe('startModel', () => {
    const makeProvider = (settings?: any) => ({
      provider: 'openai',
      models: [{ id: 'model1', settings }],
    }) as any

    const mockSettings = {
      ctx_len: { controller_props: { value: 4096 } },
      ngl: { controller_props: { value: 32 } },
    }

    it('should start model successfully', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session1' })
      const result = await modelsService.startModel(makeProvider(mockSettings), 'model1')
      expect(result).toEqual({ id: 'session1' })
      expect(mockEngine.load).toHaveBeenCalledWith('model1', { ctx_size: 4096, n_gpu_layers: 32 }, false, false)
    })

    it('should handle start model error', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockRejectedValue(new Error('Failed'))
      await expect(modelsService.startModel(makeProvider(mockSettings), 'model1')).rejects.toThrow('Failed')
    })

    it('should not load already-loaded model', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => true })
      await expect(modelsService.startModel(makeProvider(mockSettings), 'model1')).resolves.toBe(undefined)
      expect(mockEngine.load).not.toHaveBeenCalled()
    })
  })

  describe('fetchHuggingFaceRepo', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('should fetch HuggingFace repo with blobs=true', async () => {
      const mockRepoData = { modelId: 'microsoft/DialoGPT-medium', siblings: [] }
      ;(fetch as any).mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(mockRepoData) })

      const result = await modelsService.fetchHuggingFaceRepo('microsoft/DialoGPT-medium')
      expect(result).toEqual(mockRepoData)
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        { headers: {} }
      )
    })

    it.each([
      ['full URL', 'https://huggingface.co/microsoft/DialoGPT-medium'],
      ['domain prefix', 'huggingface.co/microsoft/DialoGPT-medium'],
      ['trailing slash', 'microsoft/DialoGPT-medium/'],
    ])('should clean %s input format', async (_label, input) => {
      ;(fetch as any).mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) })
      await modelsService.fetchHuggingFaceRepo(input)
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        { headers: {} }
      )
    })

    it.each(['', 'invalid-repo', '   '])('should return null for invalid input "%s"', async (input) => {
      expect(await modelsService.fetchHuggingFaceRepo(input)).toBeNull()
    })

    it('should return null for 404', async () => {
      ;(fetch as any).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
      expect(await modelsService.fetchHuggingFaceRepo('nonexistent/model')).toBeNull()
    })

    it.each([
      ['HTTP 500', () => (fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Error' })],
      ['network error', () => (fetch as any).mockRejectedValue(new Error('Network error'))],
    ])('should return null and log error on %s', async (_label, setupMock) => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setupMock()
      expect(await modelsService.fetchHuggingFaceRepo('microsoft/DialoGPT-medium')).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith('Error fetching HuggingFace repository:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it.each([
      ['no siblings', { siblings: undefined }],
      ['no GGUF files', { siblings: [{ rfilename: 'README.md', size: 1024, blobId: 'b1' }] }],
      ['mixed files', { siblings: [{ rfilename: 'model.gguf', size: 2147483648, blobId: 'b1' }, { rfilename: 'README.md', size: 1024, blobId: 'b2' }] }],
    ])('should handle repo with %s', async (_label, overrides) => {
      const mockRepoData = { id: 'microsoft/DialoGPT-medium', ...overrides }
      ;(fetch as any).mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(mockRepoData) })
      const result = await modelsService.fetchHuggingFaceRepo('microsoft/DialoGPT-medium')
      expect(result).toEqual(mockRepoData)
    })
  })

  describe('convertHfRepoToCatalogModel', () => {
    const baseRepo: HuggingFaceRepo = {
      id: 'microsoft/DialoGPT-medium',
      modelId: 'microsoft/DialoGPT-medium',
      sha: 'abc123',
      downloads: 1500,
      likes: 75,
      tags: ['pytorch', 'transformers', 'text-generation'],
      pipeline_tag: 'text-generation',
      createdAt: '2021-01-01T00:00:00Z',
      last_modified: '2021-12-01T00:00:00Z',
      private: false,
      disabled: false,
      library_name: 'mlx',
      gated: false,
      author: 'microsoft',
      siblings: [
        { rfilename: 'model-q4_0.gguf', size: 2 * 1024 * 1024 * 1024, blobId: 'blob123' },
        { rfilename: 'model-q8_0.GGUF', size: 4 * 1024 * 1024 * 1024, blobId: 'blob456' },
        { rfilename: 'tokenizer.json', size: 1024 * 1024, blobId: 'blob789' },
      ],
    }

    it('should convert HuggingFace repo to catalog model', () => {
      const result = modelsService.convertHfRepoToCatalogModel(baseRepo)
      expect(result.model_name).toBe('microsoft/DialoGPT-medium')
      expect(result.developer).toBe('microsoft')
      expect(result.downloads).toBe(1500)
      expect(result.num_quants).toBe(2)
      expect(result.is_mlx).toBe(true)
      expect(result.quants[0]).toMatchObject({ model_id: 'microsoft/model-q4_0', file_size: '2.0 GB' })
      expect(result.quants[1]).toMatchObject({ model_id: 'microsoft/model-q8_0', file_size: '4.0 GB' })
      expect(result.quants[0].path).toContain('/resolve/main/model-q4_0.gguf')
      expect(result.readme).toContain('/resolve/main/README.md')
    })

    it.each([
      ['no GGUF files', { siblings: [{ rfilename: 'tokenizer.json', size: 1024, blobId: 'b1' }] }],
      ['no siblings', { siblings: undefined }],
    ])('should handle repo with %s', (_label, overrides) => {
      const result = modelsService.convertHfRepoToCatalogModel({ ...baseRepo, ...overrides } as any)
      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should format file sizes correctly', () => {
      const repo = {
        ...baseRepo,
        siblings: [
          { rfilename: 'small.gguf', size: 500 * 1024 * 1024, blobId: 'b1' },
          { rfilename: 'large.gguf', size: 3.5 * 1024 * 1024 * 1024, blobId: 'b2' },
          { rfilename: 'unknown.gguf', blobId: 'b3' },
        ],
      }
      const result = modelsService.convertHfRepoToCatalogModel(repo as any)
      expect(result.quants[0].file_size).toBe('500.0 MB')
      expect(result.quants[1].file_size).toBe('3.5 GB')
      expect(result.quants[2].file_size).toBe('Unknown size')
    })

    it('should handle edge cases', () => {
      const repo = {
        ...baseRepo,
        tags: [],
        downloads: undefined as any,
        siblings: [
          { rfilename: 'tiny.gguf', size: 512, blobId: 'b1' },
          { rfilename: 'exactly-1gb.gguf', size: 1024 * 1024 * 1024, blobId: 'b2' },
          { rfilename: 'zero.gguf', size: 0, blobId: 'b3' },
        ],
      }
      const result = modelsService.convertHfRepoToCatalogModel(repo as any)
      expect(result.description).toBe('**Tags**: ')
      expect(result.downloads).toBe(0)
      expect(result.quants[0].file_size).toBe('0.0 MB')
      expect(result.quants[1].file_size).toBe('1.0 GB')
      expect(result.quants[2].file_size).toBe('Unknown size')
    })

    it('should handle case-insensitive GGUF matching', () => {
      const repo = {
        ...baseRepo,
        siblings: [
          { rfilename: 'a.gguf', size: 1024, blobId: 'b1' },
          { rfilename: 'b.GGUF', size: 1024, blobId: 'b2' },
          { rfilename: 'c.GgUf', size: 1024, blobId: 'b3' },
          { rfilename: 'not.txt', size: 1024, blobId: 'b4' },
        ],
      }
      const result = modelsService.convertHfRepoToCatalogModel(repo as any)
      expect(result.num_quants).toBe(3)
    })

    it('should handle minimal repo', () => {
      const minimal: HuggingFaceRepo = {
        id: 'minimal/repo', modelId: 'minimal/repo', sha: 'abc', downloads: 0, likes: 0,
        tags: [], createdAt: '2021-01-01T00:00:00Z', last_modified: '2021-12-01T00:00:00Z',
        private: false, disabled: false, gated: false, author: 'minimal',
        siblings: [{ rfilename: 'model.gguf', blobId: 'b1' }],
      }
      const result = modelsService.convertHfRepoToCatalogModel(minimal)
      expect(result.model_name).toBe('minimal/repo')
      expect(result.quants[0].file_size).toBe('Unknown size')
    })
  })

  describe('isModelSupported', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it.each([
      ['GREEN', 'GREEN', '/path/model.gguf', 4096],
      ['YELLOW', 'YELLOW', '/path/model.gguf', 8192],
      ['RED', 'RED', '/path/large.gguf', undefined],
    ])('should return %s when engine says %s', async (_label, expected, path, ctxLen) => {
      const eng = { ...mockEngine, isModelSupported: vi.fn().mockResolvedValue(expected) }
      mockEngineManager.get.mockReturnValue(eng)
      expect(await modelsService.isModelSupported(path, ctxLen)).toBe(expected)
      expect(eng.isModelSupported).toHaveBeenCalledWith(path, ctxLen)
    })

    it('should return YELLOW when engine method is not available', async () => {
      mockEngineManager.get.mockReturnValue({ ...mockEngine, isModelSupported: undefined })
      expect(await modelsService.isModelSupported('/path/model.gguf')).toBe('YELLOW')
    })

    it('should return YELLOW when engine is null', async () => {
      mockEngineManager.get.mockReturnValue(null)
      expect(await modelsService.isModelSupported('/path/model.gguf')).toBe('YELLOW')
    })

    it('should return GREY on error', async () => {
      const eng = { ...mockEngine, isModelSupported: vi.fn().mockRejectedValue(new Error('err')) }
      mockEngineManager.get.mockReturnValue(eng)
      expect(await modelsService.isModelSupported('/path/model.gguf')).toBe('GREY')
    })
  })

  describe('getHubModelScore', () => {
    const mockCatalogModel = {
      model_name: 'qwen/test-model',
      description: 'Test model',
      developer: 'qwen',
      downloads: 100,
      use_case: 'Instruction following',
      capabilities: ['tool_use'],
      created_at: '2026-03-20T00:00:00.000Z',
      tools: true,
      num_mmproj: 0,
      pinned: true,
      quants: [
        {
          model_id: 'qwen/test-model-q4_k_m',
          path: 'https://huggingface.co/qwen/test-model-q4_k_m.gguf',
          file_size: '4 GB',
        },
      ],
    } as CatalogModel

    it('delegates scoring to the llamacpp engine', async () => {
      const expectedScore = {
        status: 'ready',
        overall: 82.4,
        estimated_tps: 42,
      }
      const mockEngineWithScore = {
        ...mockEngine,
        getHubModelScore: vi.fn().mockResolvedValue(expectedScore),
      }
      mockEngineManager.get.mockReturnValue(mockEngineWithScore)

      const result = await modelsService.getHubModelScore(mockCatalogModel)

      expect(mockEngineWithScore.getHubModelScore).toHaveBeenCalledWith({
        model_name: 'qwen/test-model',
        developer: 'qwen',
        model_path: 'https://huggingface.co/qwen/test-model-q4_k_m.gguf',
        runtime: 'llamacpp',
        quantization: 'Q4_K_M',
        total_size_bytes: undefined,
        ctx_size: 8192,
        use_case: 'Instruction following',
        capabilities: ['tool_use'],
        release_date: '2026-03-20T00:00:00.000Z',
        tools: true,
        num_mmproj: 0,
        pinned: true,
      })
      expect(result).toEqual(
        expect.objectContaining({
          status: 'ready',
          overall: 82.4,
          estimated_tps: 42,
        })
      )
    })

    it('delegates MLX scoring with aggregated safetensors size', async () => {
      const mlxModel = {
        ...mockCatalogModel,
        model_name: 'mlx-community/qwen-test-7b-4bit',
        quants: [],
        is_mlx: true,
        safetensors_files: [
          {
            model_id: 'model-00001-of-00002',
            path: 'https://huggingface.co/mlx-community/qwen-test-7b-4bit/resolve/main/model-00001-of-00002.safetensors',
            file_size: '2 GB',
            size_bytes: 2_000_000_000,
          },
          {
            model_id: 'model-00002-of-00002',
            path: 'https://huggingface.co/mlx-community/qwen-test-7b-4bit/resolve/main/model-00002-of-00002.safetensors',
            file_size: '2 GB',
            size_bytes: 2_000_000_000,
          },
        ],
      } as CatalogModel
      const expectedScore = {
        status: 'ready',
        overall: 77.1,
        estimated_tps: 58,
      }
      const mockEngineWithScore = {
        ...mockEngine,
        getHubModelScore: vi.fn().mockResolvedValue(expectedScore),
      }
      mockEngineManager.get.mockReturnValue(mockEngineWithScore)

      const result = await modelsService.getHubModelScore(mlxModel)

      expect(mockEngineWithScore.getHubModelScore).toHaveBeenCalledWith({
        model_name: 'mlx-community/qwen-test-7b-4bit',
        developer: 'qwen',
        model_path:
          'https://huggingface.co/mlx-community/qwen-test-7b-4bit/resolve/main/model-00001-of-00002.safetensors',
        runtime: 'mlx',
        quantization: 'mlx-4bit',
        total_size_bytes: 4_000_000_000,
        ctx_size: 8192,
        use_case: 'Instruction following',
        capabilities: ['tool_use'],
        release_date: '2026-03-20T00:00:00.000Z',
        tools: true,
        num_mmproj: 0,
        pinned: true,
      })
      expect(result).toEqual(
        expect.objectContaining({
          status: 'ready',
          overall: 77.1,
          estimated_tps: 58,
        })
      )
    })

    it('selects the highest-quality GGUF quant when no variant is provided', async () => {
      const multiQuantModel = {
        ...mockCatalogModel,
        quants: [
          {
            model_id: 'qwen/test-model-q4_k_m',
            path: 'https://huggingface.co/qwen/test-model-q4_k_m.gguf',
            file_size: '4 GB',
          },
          {
            model_id: 'qwen/test-model-q8_0',
            path: 'https://huggingface.co/qwen/test-model-q8_0.gguf',
            file_size: '8 GB',
          },
        ],
      } as CatalogModel
      const expectedScore = {
        status: 'ready',
        overall: 90.1,
        estimated_tps: 24,
      }
      const mockEngineWithScore = {
        ...mockEngine,
        getHubModelScore: vi.fn().mockResolvedValue(expectedScore),
      }
      mockEngineManager.get.mockReturnValue(mockEngineWithScore)

      await modelsService.getHubModelScore(multiQuantModel)

      expect(mockEngineWithScore.getHubModelScore).toHaveBeenCalledWith(
        expect.objectContaining({
          model_path: 'https://huggingface.co/qwen/test-model-q8_0.gguf',
          quantization: 'Q8_0',
        })
      )
    })

    it('delegates repeated scoring requests through the engine', async () => {
      const expectedScore = {
        status: 'ready',
        overall: 82.4,
        estimated_tps: 42,
      }
      const mockEngineWithScore = {
        ...mockEngine,
        getHubModelScore: vi.fn().mockResolvedValue(expectedScore),
      }
      mockEngineManager.get.mockReturnValue(mockEngineWithScore)

      const firstResult = await modelsService.getHubModelScore(mockCatalogModel)
      const secondResult =
        await modelsService.getHubModelScore(mockCatalogModel)

      expect(mockEngineWithScore.getHubModelScore).toHaveBeenCalledTimes(2)
      expect(secondResult).toEqual(firstResult)
    })
  })
})
