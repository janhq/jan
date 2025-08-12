import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  fetchModels,
  fetchModelCatalog,
  fetchHuggingFaceRepo,
  convertHfRepoToCatalogModel,
  updateModel,
  pullModel,
  abortDownload,
  deleteModel,
  getActiveModels,
  stopModel,
  stopAllModels,
  startModel,
  HuggingFaceRepo,
  CatalogModel,
} from '../models'
import { EngineManager, Model } from '@janhq/core'

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

      await updateModel(model as any)

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
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'
      const mockSession = { id: 'session1' }

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockResolvedValue(mockSession)

      const result = await startModel(provider, model)

      expect(result).toEqual(mockSession)
      expect(mockEngine.load).toHaveBeenCalledWith(model, {
        ctx_size: 4096,
        n_gpu_layers: 32,
      })
    })

    it('should handle start model error', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'
      const error = new Error('Failed to start model')

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockRejectedValue(error)

      await expect(startModel(provider, model)).rejects.toThrow(error)
    })
    it('should not load model again', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => true,
      })
      expect(mockEngine.load).toBeCalledTimes(0)
      await expect(startModel(provider, model)).resolves.toBe(undefined)
    })
  })

  describe('fetchHuggingFaceRepo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should fetch HuggingFace repository successfully with blobs=true', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational', 'pytorch'],
        pipeline_tag: 'text-generation',
        created_at: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'model-Q4_K_M.gguf',
            size: 2147483648,
            blobId: 'blob123',
          },
          {
            rfilename: 'model-Q8_0.gguf',
            size: 4294967296,
            blobId: 'blob456',
          },
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
        ],
        readme: '# DialoGPT Model\nThis is a conversational AI model.',
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await fetchHuggingFaceRepo('microsoft/DialoGPT-medium')

      expect(result).toEqual(mockRepoData)
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true',
        {
          headers: {},
        }
      )
    })

    it('should clean repository ID from various input formats', async () => {
      const mockRepoData = { modelId: 'microsoft/DialoGPT-medium' }
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      // Test with full URL
      await fetchHuggingFaceRepo(
        'https://huggingface.co/microsoft/DialoGPT-medium'
      )
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true',
        {
          headers: {},
        }
      )

      // Test with domain prefix
      await fetchHuggingFaceRepo('huggingface.co/microsoft/DialoGPT-medium')
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true',
        {
          headers: {},
        }
      )

      // Test with trailing slash
      await fetchHuggingFaceRepo('microsoft/DialoGPT-medium/')
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true',
        {
          headers: {},
        }
      )
    })

    it('should return null for invalid repository IDs', async () => {
      // Test empty string
      expect(await fetchHuggingFaceRepo('')).toBeNull()

      // Test string without slash
      expect(await fetchHuggingFaceRepo('invalid-repo')).toBeNull()

      // Test whitespace only
      expect(await fetchHuggingFaceRepo('   ')).toBeNull()
    })

    it('should return null for 404 responses', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await fetchHuggingFaceRepo('nonexistent/model')

      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/nonexistent/model?blobs=true',
        {
          headers: {},
        }
      )
    })

    it('should handle other HTTP errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const result = await fetchHuggingFaceRepo('microsoft/DialoGPT-medium')

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error fetching HuggingFace repository:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should handle network errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ;(fetch as any).mockRejectedValue(new Error('Network error'))

      const result = await fetchHuggingFaceRepo('microsoft/DialoGPT-medium')

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error fetching HuggingFace repository:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should handle repository with no siblings', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        created_at: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: undefined,
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await fetchHuggingFaceRepo('microsoft/DialoGPT-medium')

      expect(result).toEqual(mockRepoData)
    })

    it('should handle repository with no GGUF files', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        created_at: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob101',
          },
        ],
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await fetchHuggingFaceRepo('microsoft/DialoGPT-medium')

      expect(result).toEqual(mockRepoData)
    })

    it('should handle repository with mixed file types including GGUF', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        created_at: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'model-Q4_K_M.gguf',
            size: 2147483648, // 2GB
            blobId: 'blob123',
          },
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob101',
          },
        ],
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await fetchHuggingFaceRepo('microsoft/DialoGPT-medium')

      expect(result).toEqual(mockRepoData)
      // Verify the GGUF file is present in siblings
      expect(result?.siblings?.some((s) => s.rfilename.endsWith('.gguf'))).toBe(
        true
      )
    })
  })

  describe('convertHfRepoToCatalogModel', () => {
    const mockHuggingFaceRepo: HuggingFaceRepo = {
      id: 'microsoft/DialoGPT-medium',
      modelId: 'microsoft/DialoGPT-medium',
      sha: 'abc123',
      downloads: 1500,
      likes: 75,
      tags: ['pytorch', 'transformers', 'text-generation'],
      pipeline_tag: 'text-generation',
      created_at: '2021-01-01T00:00:00Z',
      last_modified: '2021-12-01T00:00:00Z',
      private: false,
      disabled: false,
      gated: false,
      author: 'microsoft',
      siblings: [
        {
          rfilename: 'model-q4_0.gguf',
          size: 2 * 1024 * 1024 * 1024, // 2GB
          blobId: 'blob123',
        },
        {
          rfilename: 'model-q8_0.GGUF', // Test case-insensitive matching
          size: 4 * 1024 * 1024 * 1024, // 4GB
          blobId: 'blob456',
        },
        {
          rfilename: 'tokenizer.json', // Non-GGUF file (should be filtered out)
          size: 1024 * 1024, // 1MB
          blobId: 'blob789',
        },
      ],
    }

    it('should convert HuggingFace repo to catalog model format', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      const expected: CatalogModel = {
        model_name: 'microsoft/DialoGPT-medium',
        description: '**Tags**: pytorch, transformers, text-generation',
        developer: 'microsoft',
        downloads: 1500,
        num_quants: 2,
        quants: [
          {
            model_id: 'model-q4_0',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q4_0.gguf',
            file_size: '2.0 GB',
          },
          {
            model_id: 'model-q8_0',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q8_0.GGUF',
            file_size: '4.0 GB',
          },
        ],
        created_at: '2021-01-01T00:00:00Z',
        readme:
          'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/README.md',
      }

      expect(result).toEqual(expected)
    })

    it('should handle repository with no GGUF files', () => {
      const repoWithoutGGUF: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'tokenizer.json',
            size: 1024 * 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 2048,
            blobId: 'blob101',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithoutGGUF)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should handle repository with no siblings', () => {
      const repoWithoutSiblings: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: undefined,
      }

      const result = convertHfRepoToCatalogModel(repoWithoutSiblings)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should format file sizes correctly', () => {
      const repoWithVariousFileSizes: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'small-model.gguf',
            size: 500 * 1024 * 1024, // 500MB
            blobId: 'blob1',
          },
          {
            rfilename: 'large-model.gguf',
            size: 3.5 * 1024 * 1024 * 1024, // 3.5GB
            blobId: 'blob2',
          },
          {
            rfilename: 'unknown-size.gguf',
            // No size property
            blobId: 'blob3',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithVariousFileSizes)

      expect(result.quants[0].file_size).toBe('500.0 MB')
      expect(result.quants[1].file_size).toBe('3.5 GB')
      expect(result.quants[2].file_size).toBe('Unknown size')
    })

    it('should handle empty or undefined tags', () => {
      const repoWithEmptyTags: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        tags: [],
      }

      const result = convertHfRepoToCatalogModel(repoWithEmptyTags)

      expect(result.description).toBe('**Tags**: ')
    })

    it('should handle missing downloads count', () => {
      const repoWithoutDownloads: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        downloads: undefined as any,
      }

      const result = convertHfRepoToCatalogModel(repoWithoutDownloads)

      expect(result.downloads).toBe(0)
    })

    it('should correctly remove .gguf extension from model IDs', () => {
      const repoWithVariousGGUF: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'model.gguf',
            size: 1024,
            blobId: 'blob1',
          },
          {
            rfilename: 'MODEL.GGUF',
            size: 1024,
            blobId: 'blob2',
          },
          {
            rfilename: 'complex-model-name.gguf',
            size: 1024,
            blobId: 'blob3',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithVariousGGUF)

      expect(result.quants[0].model_id).toBe('model')
      expect(result.quants[1].model_id).toBe('MODEL')
      expect(result.quants[2].model_id).toBe('complex-model-name')
    })

    it('should generate correct download paths', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.quants[0].path).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q4_0.gguf'
      )
      expect(result.quants[1].path).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q8_0.GGUF'
      )
    })

    it('should generate correct readme URL', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.readme).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/README.md'
      )
    })

    it('should handle GGUF files with case-insensitive extension matching', () => {
      const repoWithMixedCase: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'model-1.gguf',
            size: 1024,
            blobId: 'blob1',
          },
          {
            rfilename: 'model-2.GGUF',
            size: 1024,
            blobId: 'blob2',
          },
          {
            rfilename: 'model-3.GgUf',
            size: 1024,
            blobId: 'blob3',
          },
          {
            rfilename: 'not-a-model.txt',
            size: 1024,
            blobId: 'blob4',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithMixedCase)

      expect(result.num_quants).toBe(3)
      expect(result.quants).toHaveLength(3)
      expect(result.quants[0].model_id).toBe('model-1')
      expect(result.quants[1].model_id).toBe('model-2')
      expect(result.quants[2].model_id).toBe('model-3')
    })

    it('should handle edge cases with file size formatting', () => {
      const repoWithEdgeCases: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'tiny.gguf',
            size: 512, // < 1MB
            blobId: 'blob1',
          },
          {
            rfilename: 'exactly-1gb.gguf',
            size: 1024 * 1024 * 1024, // Exactly 1GB
            blobId: 'blob2',
          },
          {
            rfilename: 'zero-size.gguf',
            size: 0,
            blobId: 'blob3',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithEdgeCases)

      expect(result.quants[0].file_size).toBe('0.0 MB')
      expect(result.quants[1].file_size).toBe('1.0 GB')
      expect(result.quants[2].file_size).toBe('Unknown size') // 0 is falsy, so it returns 'Unknown size'
    })

    it('should handle missing optional fields gracefully', () => {
      const minimalRepo: HuggingFaceRepo = {
        id: 'minimal/repo',
        modelId: 'minimal/repo',
        sha: 'abc123',
        downloads: 0,
        likes: 0,
        tags: [],
        created_at: '2021-01-01T00:00:00Z',
        last_modified: '2021-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'minimal',
        siblings: [
          {
            rfilename: 'model.gguf',
            blobId: 'blob1',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(minimalRepo)

      expect(result.model_name).toBe('minimal/repo')
      expect(result.developer).toBe('minimal')
      expect(result.downloads).toBe(0)
      expect(result.description).toBe('**Tags**: ')
      expect(result.quants[0].file_size).toBe('Unknown size')
    })
  })
})
