import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import llamacpp_extension from '../index'

import { normalizeLlamacppConfig } from '@janhq/tauri-plugin-llamacpp-api'
import { getBackendSetting, setBackendSetting } from '../backend-settings'

vi.mock('../backend-settings')

// Mock fetch globally
global.fetch = vi.fn()

// Mock backend functions
vi.mock('../backend', () => ({
  isBackendInstalled: vi.fn(),
  getBackendExePath: vi.fn(),
  downloadBackend: vi.fn(),
  listSupportedBackends: vi.fn(),
  getBackendDir: vi.fn(),
  getLocalInstalledBackends: vi.fn(),
  fetchRemoteBackends: vi.fn(),
  verifyBackendInstallation: vi.fn().mockResolvedValue({
    verified: true,
    missing_libraries: [],
    resolved_libraries: [],
  }),
  probeBackendGpuLibraries: vi.fn(),
}))

// Mock tauri-plugin-llamacpp-api (partial mock)
vi.mock('@janhq/tauri-plugin-llamacpp-api', async () => {
  const actual = await vi.importActual<
    typeof import('@janhq/tauri-plugin-llamacpp-api')
  >('@janhq/tauri-plugin-llamacpp-api')

  return {
    ...actual,
    mapOldBackendToNew: vi.fn(),
    removeOldBackendVersions: vi.fn(),
    readGgufMetadata: vi.fn().mockResolvedValue({
      version: 3,
      tensor_count: 1,
      metadata: { 'general.architecture': 'llama' },
    }),
    loadLlamaModel: vi.fn(),
    unloadLlamaModel: vi.fn(),
    reloadRouterModels: vi.fn(),
    routerHealth: vi.fn().mockResolvedValue(true),
    adoptRouter: vi.fn(),
  }
})

vi.mock('../preset', async () => {
  const actual = await vi.importActual<typeof import('../preset')>('../preset')
  return { ...actual, generatePreset: vi.fn() }
})
describe('llamacpp_extension', () => {
  let extension: llamacpp_extension

  beforeEach(async () => {
    vi.clearAllMocks()
    // Re-armed per test: afterEach's restoreAllMocks strips implementations
    // set in the vi.mock factories.
    const { verifyBackendInstallation } = await import('../backend')
    vi.mocked(verifyBackendInstallation).mockResolvedValue({
      verified: true,
      missing_libraries: [],
      resolved_libraries: [],
    })
    const { routerHealth } = await import('@janhq/tauri-plugin-llamacpp-api')
    vi.mocked(routerHealth).mockResolvedValue(true)
    extension = new llamacpp_extension()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(extension.provider).toBe('llamacpp')
      expect(extension.providerId).toBe('llamacpp')
      // autoUnload was removed in Phase 2 — replaced by `models_max` setting
      // applied at router start time.
      expect(extension.timeout).toBe(600)
    })
  })

  describe('getProviderPath', () => {
    it('should return correct provider path', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockResolvedValue('/path/to/jan/llamacpp')

      const result = await extension.getProviderPath()
      
      expect(result).toBe('/path/to/jan/llamacpp')
    })
  })

  describe('list', () => {
    it('should return empty array when models directory does not exist', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockResolvedValue('/path/to/jan/llamacpp/models')
      vi.mocked(fs.existsSync)
        .mockResolvedValueOnce(false) // models directory doesn't exist initially
        .mockResolvedValue(false) // no model.yml files exist
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.readdirSync).mockResolvedValue([]) // empty directory after creation

      const result = await extension.list()
      
      expect(result).toEqual([])
    })

    it('should return model list when models exist', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      
      // Set up providerPath first
      extension['providerPath'] = '/path/to/jan/llamacpp'
      
      const modelsDir = '/path/to/jan/llamacpp/models'
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      
      // Mock joinPath to handle the directory traversal logic
      vi.mocked(joinPath).mockImplementation((paths) => {
        if (paths.length === 1) {
          return Promise.resolve(paths[0])
        }
        return Promise.resolve(paths.join('/'))
      })
      
      vi.mocked(fs.existsSync)
        .mockResolvedValueOnce(true) // modelsDir exists
        .mockResolvedValueOnce(false) // model.yml doesn't exist at modelsDir level
        .mockResolvedValueOnce(true) // model.yml exists in test-model dir
      
      vi.mocked(fs.readdirSync).mockResolvedValue(['test-model'])
      vi.mocked(fs.fileStat).mockResolvedValue({ isDirectory: true, size: 1000 })
      
      vi.mocked(invoke).mockResolvedValue({
        model_path: 'test-model/model.gguf',
        name: 'Test Model',
        size_bytes: 1000000
      })

      const result = await extension.list()
      
      // Note: There's a bug in the original code where it pushes just the child name
      // instead of the full path, causing the model ID to be empty
      expect(result).toEqual([
        {
          id: '',
          name: 'Test Model',
          quant_type: undefined,
          providerId: 'llamacpp',
          port: 0,
          sizeBytes: 1000000,
          embedding: false,
          imported: false,
          capabilities: undefined,
          template_kwargs: [],
        }
      ])
    })
  })

  describe('import', () => {
    it('should throw error for invalid modelId', async () => {
      await expect(extension.import('invalid/model/../id', { modelPath: '/path/to/model' }))
        .rejects.toThrow('Invalid modelId')
    })

    it('should throw error if model already exists', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockResolvedValue('/path/to/jan/llamacpp/models/test-model/model.yml')
      vi.mocked(fs.existsSync).mockResolvedValue(true)

      await expect(extension.import('test-model', { modelPath: '/path/to/model' }))
        .rejects.toThrow('Model test-model already exists')
    })

    it('should import model from URL', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      const apiModule = await import('@janhq/tauri-plugin-llamacpp-api')
      vi.mocked(apiModule.readGgufMetadata).mockResolvedValue({
        version: 3,
        tensor_count: 1,
        metadata: { 'general.architecture': 'llama' },
      } as any)
      
      const mockDownloadManager = {
        downloadFiles: vi.fn().mockResolvedValue(undefined)
      }
      
      window.core.extensionManager.getByName = vi.fn().mockReturnValue(mockDownloadManager)
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) => Promise.resolve(paths.join('/')))
      vi.mocked(fs.existsSync).mockResolvedValue(false)
      vi.mocked(fs.fileStat).mockResolvedValue({ size: 1000000 })
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await extension.import('test-model', { 
        modelPath: 'https://example.com/model.gguf' 
      })

      expect(mockDownloadManager.downloadFiles).toHaveBeenCalled()
      expect(fs.mkdir).toHaveBeenCalled()
      expect(invoke).toHaveBeenCalledWith('write_yaml', expect.any(Object))
    })
  })

  describe('load', () => {
    it('should throw error if model is already loaded', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:llamacpp|find_session_by_model') {
          return {
            model_id: 'test-model',
            pid: 123,
            port: 3000,
            api_key: 'test-key',
          }
        }
        return undefined
      })

      await expect(extension.load('test-model')).rejects.toThrow('Model already loaded!!')
    })

    it('should load model successfully', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')

      const backendModule = await import('../backend')
      vi.mocked(backendModule.isBackendInstalled).mockResolvedValue(true)
      vi.mocked(backendModule.getBackendExePath).mockResolvedValue('/path/to/backend/executable')

      vi.mocked(fs.existsSync).mockResolvedValue(true)

      extension['config'] = {
        version_backend: 'v1.0.0/win-avx2-x64',
        ctx_size: 2048,
        n_gpu_layers: 10,
        threads: 4,
        chat_template: '',
        threads_batch: 0,
        n_predict: 0,
        batch_size: 0,
        ubatch_size: 0,
        device: '',
        split_mode: '',
        main_gpu: 0,
        flash_attn: false,
        cont_batching: false,
        no_mmap: false,
        mlock: false,
        no_kv_offload: false,
        cache_type_k: 'f16',
        cache_type_v: 'f16',
        defrag_thold: 0.1,
        rope_scaling: 'linear',
        rope_scale: 1.0,
        rope_freq_base: 10000,
        rope_freq_scale: 1.0,
        reasoning_budget: 0,
        auto_update_engine: false,
        auto_unload: true
      }
      
      // Set up providerPath
      extension['providerPath'] = '/path/to/jan/llamacpp'
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) => Promise.resolve(paths.join('/')))

      const expectedSession = {
        model_id: 'test-model',
        pid: 123,
        port: 3000,
        api_key: 'test-api-key',
      }

      const apiModule = await import('@janhq/tauri-plugin-llamacpp-api')
      vi.mocked(apiModule.loadLlamaModel).mockResolvedValue(expectedSession as any)

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        switch (cmd) {
          case 'plugin:llamacpp|find_session_by_model':
            return null
          case 'plugin:llamacpp|get_router_info':
            return { port: 4000, api_key: 'router-key', pid: 999 }
          case 'plugin:llamacpp|load_llama_model':
            return expectedSession
          default:
            return undefined
        }
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'ok' }),
      })

      const result = await extension.load('test-model')

      expect(result).toEqual(expectedSession)
    })
  })

  describe('unload', () => {
    it('should throw error if no active session found', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:llamacpp|find_session_by_model') {
          throw new Error('No active session found')
        }
        return undefined
      })
      await expect(extension.unload('nonexistent-model')).rejects.toThrow('No active session found')
    })

    it('should unload model successfully', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const apiModule = await import('@janhq/tauri-plugin-llamacpp-api')

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:llamacpp|find_session_by_model') {
          return {
            model_id: 'test-model',
            pid: 123,
            port: 3000,
            api_key: 'test-key',
          }
        }
        return undefined
      })
      vi.mocked(apiModule.unloadLlamaModel).mockResolvedValue({
        success: true,
        error: null,
      } as any)

      const result = await extension.unload('test-model')

      expect(result).toEqual({
        success: true,
        error: null,
      })
    })
  })

  describe('chat', () => {
    it('should throw error if no active session found', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:llamacpp|ensure_session_ready') {
          throw new Error('No active session found')
        }
        return undefined
      })

      const request = {
        model: 'nonexistent-model',
        messages: [{ role: 'user', content: 'Hello' }]
      }

      await expect(extension.chat(request)).rejects.toThrow('No active session found')
    })

    it('should handle non-streaming chat request', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:llamacpp|ensure_session_ready') {
          return {
            model_id: 'test-model',
            pid: 123,
            port: 3000,
            api_key: 'test-key',
          }
        }
        return true
      })

      const mockResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop'
        }]
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      const request = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false
      }

      const result = await extension.chat(request)
      
      expect(result).toEqual(mockResponse)
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key'
          }
        })
      )
    })
  })

  describe('delete', () => {
    it('should throw error if model does not exist', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) => Promise.resolve(paths.join('/')))
      vi.mocked(fs.existsSync).mockResolvedValue(false)

      await expect(extension.delete('nonexistent-model')).rejects.toThrow('Model nonexistent-model does not exist')
    })

    it('should delete model successfully', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) => Promise.resolve(paths.join('/')))
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.rm).mockResolvedValue(undefined)

      await extension.delete('test-model')
      
      expect(fs.rm).toHaveBeenCalledWith('/path/to/jan/llamacpp/models/test-model')
    })
  })

  describe('migrateFitOff', () => {
    beforeEach(() => {
      vi.mocked(getBackendSetting).mockResolvedValue(null)
    })

    it('should skip migration if already migrated', async () => {
      vi.mocked(getBackendSetting).mockResolvedValue('1')
      extension['config'] = { fit: true } as any
      extension['getSettings'] = vi.fn()

      await extension['migrateFitOff']()

      expect(extension['getSettings']).not.toHaveBeenCalled()
    })

    it('should set migration key without calling updateSettings when fit is already false', async () => {
      extension['config'] = { fit: false } as any
      extension['getSettings'] = vi.fn()
      extension['updateSettings'] = vi.fn()

      await extension['migrateFitOff']()

      expect(extension['getSettings']).not.toHaveBeenCalled()
      expect(extension['updateSettings']).not.toHaveBeenCalled()
      expect(setBackendSetting).toHaveBeenCalledWith('llamacpp_fit_off_v1', '1')
    })

    it('should disable fit when it is true', async () => {
      extension['config'] = { fit: true } as any
      extension['getSettings'] = vi.fn().mockResolvedValue([
        { key: 'fit', controllerProps: { value: true } },
        { key: 'ctx_size', controllerProps: { value: 2048 } },
      ])
      extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)

      await extension['migrateFitOff']()

      const updatedSettings = vi.mocked(extension['updateSettings']).mock.calls[0][0]
      expect(updatedSettings.find((s: any) => s.key === 'fit').controllerProps.value).toBe(false)
      expect(updatedSettings.find((s: any) => s.key === 'ctx_size').controllerProps.value).toBe(2048)
      expect(extension['config'].fit).toBe(false)
      expect(setBackendSetting).toHaveBeenCalledWith('llamacpp_fit_off_v1', '1')
    })

    it('should not modify other settings during fit migration', async () => {
      extension['config'] = { fit: true } as any
      extension['getSettings'] = vi.fn().mockResolvedValue([
        { key: 'fit', controllerProps: { value: true } },
        { key: 'fit_target', controllerProps: { value: '1024' } },
        { key: 'fit_ctx', controllerProps: { value: '' } },
      ])
      extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)

      await extension['migrateFitOff']()

      const updatedSettings = vi.mocked(extension['updateSettings']).mock.calls[0][0]
      expect(updatedSettings.find((s: any) => s.key === 'fit_target').controllerProps.value).toBe('1024')
      expect(updatedSettings.find((s: any) => s.key === 'fit_ctx').controllerProps.value).toBe('')
    })
  })

  describe('getLoadedModels', () => {
    it('should return list of loaded models', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:llamacpp|get_loaded_models') {
          return ['model1', 'model2']
        }
        return undefined
      })

      const result = await extension.getLoadedModels()

      expect(result).toEqual(['model1', 'model2'])
    })
  })

  describe('updateBackend', () => {
    beforeEach(() => {
      vi.stubGlobal('IS_WINDOWS', false)
      extension['config'] = {
        version_backend: 'v1.0.0/linux-avx2-x64',
        device: '',
      } as any
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    describe('validation', () => {
      it('should reject empty targetBackendString', async () => {
        const result = await extension.updateBackend('')
        expect(result).toEqual({
          wasUpdated: false,
          newBackend: 'v1.0.0/linux-avx2-x64',
        })
      })

      it('should reject targetBackendString with no slash', async () => {
        const result = await extension.updateBackend('v1.2.3')
        expect(result).toEqual({
          wasUpdated: false,
          newBackend: 'v1.0.0/linux-avx2-x64',
        })
      })

      it('should reject targetBackendString with trailing slash', async () => {
        const result = await extension.updateBackend('v1.2.3/')
        expect(result).toEqual({
          wasUpdated: false,
          newBackend: 'v1.0.0/linux-avx2-x64',
        })
      })

      it('should reject targetBackendString with leading slash', async () => {
        const result = await extension.updateBackend('/linux-avx2-x64')
        expect(result).toEqual({
          wasUpdated: false,
          newBackend: 'v1.0.0/linux-avx2-x64',
        })
      })

      it('should reject targetBackendString with extra segments', async () => {
        const result = await extension.updateBackend('v1/backend/extra')
        expect(result).toEqual({
          wasUpdated: false,
          newBackend: 'v1.0.0/linux-avx2-x64',
        })
      })

      it('should reject targetBackendString with whitespace-only parts', async () => {
        const result = await extension.updateBackend(' / ')
        expect(result).toEqual({
          wasUpdated: false,
          newBackend: 'v1.0.0/linux-avx2-x64',
        })
      })
    })

    describe('isUpdatingBackend flag', () => {
      it('should reset isUpdatingBackend to false after successful update', async () => {
        extension['ensureBackendReady'] = vi.fn().mockResolvedValue(undefined)
        extension['restartRouterAndProbe'] = vi.fn().mockResolvedValue(true)
        extension['getStoredBackendType'] = vi.fn().mockReturnValue('linux-avx2-x64')
        extension['setStoredBackendType'] = vi.fn()
        extension['getSettings'] = vi.fn().mockResolvedValue([])
        extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)

        const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
        vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
        vi.mocked(joinPath).mockResolvedValue('/path/to/jan/llamacpp/backends')

        const { mapOldBackendToNew, removeOldBackendVersions } = await import('@janhq/tauri-plugin-llamacpp-api')
        vi.mocked(mapOldBackendToNew).mockResolvedValue('linux-avx2-x64')
        vi.mocked(removeOldBackendVersions).mockResolvedValue([])

        expect(extension['isUpdatingBackend']).toBe(false)

        await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(extension['isUpdatingBackend']).toBe(false)
      })

      it('should reset isUpdatingBackend to false after failed update', async () => {
        extension['ensureBackendReady'] = vi.fn().mockRejectedValue(new Error('download failed'))

        expect(extension['isUpdatingBackend']).toBe(false)

        const result = await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(extension['isUpdatingBackend']).toBe(false)
        expect(result.wasUpdated).toBe(false)
      })

      it('queues a concurrent request instead of dropping it', async () => {
        extension['config'].llamacpp_version = 'v1.0.0'
        extension['config'].llamacpp_backend = 'linux-avx2-x64'
        extension['recomposeVersionBackend']()
        extension['getStoredBackendType'] = vi
          .fn()
          .mockResolvedValue('linux-avx2-x64')
        extension['setStoredBackendType'] = vi.fn().mockResolvedValue(undefined)
        extension['getSettings'] = vi.fn().mockResolvedValue([])
        extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)
        extension['restartRouterAndProbe'] = vi.fn().mockResolvedValue(true)
        extension['pruneOldBackendVersions'] = vi
          .fn()
          .mockResolvedValue(undefined)
        extension['recordUpdateHistory'] = vi.fn().mockResolvedValue(undefined)
        const { mapOldBackendToNew } = await import(
          '@janhq/tauri-plugin-llamacpp-api'
        )
        vi.mocked(mapOldBackendToNew).mockImplementation(async (b) => b)

        let releaseFirst: () => void = () => {}
        const firstDownload = new Promise<void>((r) => {
          releaseFirst = r
        })
        const ensureBackendReady = vi
          .fn()
          .mockImplementationOnce(() => firstDownload)
          .mockResolvedValue(undefined)
        extension['ensureBackendReady'] = ensureBackendReady

        const first = extension.updateBackend('v2.0.0/linux-avx2-x64')
        const queued = extension.updateBackend('v3.0.0/linux-avx2-x64')
        releaseFirst()

        const [firstResult, queuedResult] = await Promise.all([first, queued])

        expect(firstResult.newBackend).toBe('v2.0.0/linux-avx2-x64')
        // The queued request ran rather than being silently discarded.
        expect(queuedResult.wasUpdated).toBe(true)
        expect(queuedResult.newBackend).toBe('v3.0.0/linux-avx2-x64')
        expect(ensureBackendReady).toHaveBeenCalledTimes(2)
      })

      it('coalesces queued requests so only the newest target runs', async () => {
        extension['config'].llamacpp_version = 'v1.0.0'
        extension['config'].llamacpp_backend = 'linux-avx2-x64'
        extension['recomposeVersionBackend']()
        extension['getStoredBackendType'] = vi
          .fn()
          .mockResolvedValue('linux-avx2-x64')
        extension['setStoredBackendType'] = vi.fn().mockResolvedValue(undefined)
        extension['getSettings'] = vi.fn().mockResolvedValue([])
        extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)
        extension['restartRouterAndProbe'] = vi.fn().mockResolvedValue(true)
        extension['pruneOldBackendVersions'] = vi
          .fn()
          .mockResolvedValue(undefined)
        extension['recordUpdateHistory'] = vi.fn().mockResolvedValue(undefined)
        const { mapOldBackendToNew } = await import(
          '@janhq/tauri-plugin-llamacpp-api'
        )
        vi.mocked(mapOldBackendToNew).mockImplementation(async (b) => b)

        let releaseFirst: () => void = () => {}
        const firstDownload = new Promise<void>((r) => {
          releaseFirst = r
        })
        const ensureBackendReady = vi
          .fn()
          .mockImplementationOnce(() => firstDownload)
          .mockResolvedValue(undefined)
        extension['ensureBackendReady'] = ensureBackendReady

        const first = extension.updateBackend('v2.0.0/linux-avx2-x64')
        const superseded = extension.updateBackend('v3.0.0/linux-avx2-x64')
        const newest = extension.updateBackend('v4.0.0/linux-avx2-x64')
        releaseFirst()

        const results = await Promise.all([first, superseded, newest])

        // v3 never runs: obsolete before it could start. Both waiters on the
        // queued slot get the v4 result.
        expect(ensureBackendReady).toHaveBeenCalledTimes(2)
        expect(results[1].newBackend).toBe('v4.0.0/linux-avx2-x64')
        expect(results[2].newBackend).toBe('v4.0.0/linux-avx2-x64')
        expect(extension['config'].version_backend).toBe(
          'v4.0.0/linux-avx2-x64'
        )
      })
    })

    describe('onSettingUpdate guard', () => {
      it('does not restart the router while configureBackends is persisting settings', async () => {
        // configureBackends writes llamacpp_version/backend on every launch.
        // Reacting to that would restart the router a second time, which at
        // startup kills the router adoption just took over.
        extension['ensureBackendReady'] = vi.fn().mockResolvedValue(undefined)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        extension['isConfiguringBackends'] = true

        extension.onSettingUpdate('llamacpp_backend', 'linux-avx2-x64')
        await new Promise((r) => setTimeout(r, 0))

        expect(extension['ensureBackendReady']).not.toHaveBeenCalled()
        expect(extension['startRouter']).not.toHaveBeenCalled()
      })

      it('does not schedule a preset restart for configureBackends own writes', async () => {
        // configureBackends persists the entire settings array, so every
        // preset-affecting key echoes back through here. Debouncing a restart
        // off that echo is what killed the adopted router ~600ms into startup.
        const scheduleRouterRestart = vi.fn()
        extension['scheduleRouterRestart'] = scheduleRouterRestart
        extension['isConfiguringBackends'] = true

        extension.onSettingUpdate('ctx_size', 4096)

        expect(scheduleRouterRestart).not.toHaveBeenCalled()
        // The value is still applied; only the restart is suppressed.
        expect(extension['config'].ctx_size).toBe(4096)
      })

      it('still schedules a preset restart for a genuine user edit', async () => {
        const scheduleRouterRestart = vi.fn()
        extension['scheduleRouterRestart'] = scheduleRouterRestart
        extension['isConfiguringBackends'] = false

        extension.onSettingUpdate('ctx_size', 8192)

        expect(scheduleRouterRestart).toHaveBeenCalledTimes(1)
      })

      it('should skip ensureBackendReady in onSettingUpdate when updateBackend is in progress', async () => {
        extension['ensureBackendReady'] = vi.fn().mockResolvedValue(undefined)

        // Simulate updateBackend in progress
        extension['isUpdatingBackend'] = true

        // Call onSettingUpdate while updateBackend is "running"
        extension.onSettingUpdate('llamacpp_backend', 'linux-avx2-x64')

        // ensureBackendReady should NOT have been called from onSettingUpdate
        expect(extension['ensureBackendReady']).not.toHaveBeenCalled()
      })
    })

    describe('stored backend type', () => {
      it('should store effectiveBackendType, not the full version/backend string', async () => {
        extension['ensureBackendReady'] = vi.fn().mockResolvedValue(undefined)
        extension['restartRouterAndProbe'] = vi.fn().mockResolvedValue(true)
        extension['getStoredBackendType'] = vi.fn().mockReturnValue('old-backend-type')
        extension['setStoredBackendType'] = vi.fn()
        extension['getSettings'] = vi.fn().mockResolvedValue([])
        extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)

        const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
        vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
        vi.mocked(joinPath).mockResolvedValue('/path/to/jan/llamacpp/backends')

        const { mapOldBackendToNew, removeOldBackendVersions } = await import('@janhq/tauri-plugin-llamacpp-api')
        vi.mocked(mapOldBackendToNew).mockResolvedValue('linux-avx2-x64')
        vi.mocked(removeOldBackendVersions).mockResolvedValue([])

        await extension.updateBackend('v2.0.0/linux-avx2-x64')

        // setStoredBackendType should be called with the backend type only, not "version/backend"
        const storedValue = vi.mocked(extension['setStoredBackendType']).mock.calls[0]?.[0]
        expect(storedValue).not.toContain('/')
      })
    })

    describe('atomicity', () => {
      const armUpdate = async (extension: llamacpp_extension) => {
        extension['config'].llamacpp_version = 'v1.0.0'
        extension['config'].llamacpp_backend = 'linux-avx2-x64'
        extension['recomposeVersionBackend']()
        extension['ensureBackendReady'] = vi.fn().mockResolvedValue(undefined)
        extension['getStoredBackendType'] = vi.fn().mockResolvedValue('linux-avx2-x64')
        extension['setStoredBackendType'] = vi.fn().mockResolvedValue(undefined)
        extension['getSettings'] = vi.fn().mockResolvedValue([])
        extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)
        const { mapOldBackendToNew } = await import(
          '@janhq/tauri-plugin-llamacpp-api'
        )
        vi.mocked(mapOldBackendToNew).mockImplementation(async (b) => b)
      }

      it('restarts the router so the new binary actually serves', async () => {
        await armUpdate(extension)
        const startRouter = vi.fn().mockResolvedValue(undefined)
        extension['startRouter'] = startRouter

        const result = await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(startRouter).toHaveBeenCalledTimes(1)
        expect(result.wasUpdated).toBe(true)
        expect(result.newBackend).toBe('v2.0.0/linux-avx2-x64')
      })

      // Static dep analysis false-positives (libs dlopen'd at runtime, or
      // resolved from paths the analyzer does not search but the spawn env
      // does). A router that serves /health is proof the binary works,
      // whatever lddtree concluded.
      it('does not block a switch on a missing-library report', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        const { verifyBackendInstallation } = await import('../backend')
        vi.mocked(verifyBackendInstallation).mockResolvedValue({
          verified: false,
          missing_libraries: ['libcudart.so.12'],
          resolved_libraries: [],
        })

        const result = await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(result.wasUpdated).toBe(true)
        expect(extension['config'].version_backend).toBe(
          'v2.0.0/linux-avx2-x64'
        )
      })

      it('rolls back when the router fails its health check', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        const { routerHealth } = await import('@janhq/tauri-plugin-llamacpp-api')
        vi.mocked(routerHealth).mockResolvedValue(false)

        const result = await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(result.wasUpdated).toBe(false)
        expect(extension['config'].llamacpp_version).toBe('v1.0.0')
        // Once for the failed target, once bringing the old backend back up.
        expect(extension['startRouter']).toHaveBeenCalledTimes(2)
      })

      it('rolls back when the router process refuses to start', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi
          .fn()
          .mockRejectedValueOnce(new Error('spawn failed'))
          .mockResolvedValue(undefined)

        const result = await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(result.wasUpdated).toBe(false)
        expect(extension['config'].version_backend).toBe(
          'v1.0.0/linux-avx2-x64'
        )
      })

      it('prunes superseded installs only after the probe passes', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        const { removeOldBackendVersions } = await import(
          '@janhq/tauri-plugin-llamacpp-api'
        )
        vi.mocked(removeOldBackendVersions).mockResolvedValue([])
        const { joinPath } = await import('@janhq/core')
        vi.mocked(joinPath).mockResolvedValue('/jan/llamacpp/backends')

        await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(removeOldBackendVersions).toHaveBeenCalledWith(
          '/jan/llamacpp/backends',
          'v2.0.0',
          'linux-avx2-x64',
          2
        )
      })

      it('keeps the rollback target on disk when the probe fails', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        const { removeOldBackendVersions, routerHealth } = await import(
          '@janhq/tauri-plugin-llamacpp-api'
        )
        vi.mocked(routerHealth).mockResolvedValue(false)

        await extension.updateBackend('v2.0.0/linux-avx2-x64')

        // Pruning here would delete the version we just rolled back onto.
        expect(removeOldBackendVersions).not.toHaveBeenCalled()
      })

      it('records the outcome of a failed switch as rolled-back when the rollback target is healthy', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        const written: unknown[] = []
        extension['recordUpdateHistory'] = vi.fn(async (r) => {
          written.push(r)
        })
        const { routerHealth } = await import('@janhq/tauri-plugin-llamacpp-api')
        vi.mocked(routerHealth)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true)

        await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(written).toHaveLength(1)
        expect(written[0]).toMatchObject({
          from: 'v1.0.0/linux-avx2-x64',
          to: 'v2.0.0/linux-avx2-x64',
          outcome: 'rolled-back',
        })
      })

      it('records the outcome as rollback-failed when the rollback target also fails its health check', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        const written: unknown[] = []
        extension['recordUpdateHistory'] = vi.fn(async (r) => {
          written.push(r)
        })
        const { routerHealth } = await import('@janhq/tauri-plugin-llamacpp-api')
        vi.mocked(routerHealth).mockResolvedValue(false)

        await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(written).toHaveLength(1)
        expect(written[0]).toMatchObject({
          from: 'v1.0.0/linux-avx2-x64',
          to: 'v2.0.0/linux-avx2-x64',
          outcome: 'rollback-failed',
        })
      })

      it('does not attempt a rollback when the download fails pre-commit', async () => {
        await armUpdate(extension)
        extension['startRouter'] = vi.fn().mockResolvedValue(undefined)
        extension['ensureBackendReady'] = vi
          .fn()
          .mockRejectedValue(new Error('download failed'))

        const result = await extension.updateBackend('v2.0.0/linux-avx2-x64')

        expect(result.wasUpdated).toBe(false)
        expect(extension['startRouter']).not.toHaveBeenCalled()
        expect(extension['config'].version_backend).toBe(
          'v1.0.0/linux-avx2-x64'
        )
      })
    })

    describe('trimming', () => {
      it('should trim whitespace from version and backend before use', async () => {
        extension['ensureBackendReady'] = vi.fn().mockResolvedValue(undefined)
        extension['restartRouterAndProbe'] = vi.fn().mockResolvedValue(true)
        extension['getStoredBackendType'] = vi.fn().mockReturnValue('linux-avx2-x64')
        extension['setStoredBackendType'] = vi.fn()
        extension['getSettings'] = vi.fn().mockResolvedValue([])
        extension['updateSettings'] = vi.fn().mockResolvedValue(undefined)

        const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
        vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
        vi.mocked(joinPath).mockResolvedValue('/path/to/jan/llamacpp/backends')

        const { mapOldBackendToNew, removeOldBackendVersions } = await import('@janhq/tauri-plugin-llamacpp-api')
        vi.mocked(mapOldBackendToNew).mockResolvedValue('linux-avx2-x64')
        vi.mocked(removeOldBackendVersions).mockResolvedValue([])

        await extension.updateBackend(' v2.0.0 / linux-avx2-x64 ')

        // ensureBackendReady should receive trimmed values
        expect(extension['ensureBackendReady']).toHaveBeenCalledWith(
          'linux-avx2-x64',
          'v2.0.0'
        )
      })
    })
  })

  describe('installCudaRuntime', () => {
    it('should reject a path that does not exist', async () => {
      const { fs } = await import('@janhq/core')
      vi.mocked(fs.existsSync).mockResolvedValue(false)

      await expect(
        extension.installCudaRuntime('/tmp/cudart-llama-bin-win-cuda.zip')
      ).rejects.toThrow('Invalid path or file')
    })

    it('should reject a file with an unsupported extension', async () => {
      const { fs } = await import('@janhq/core')
      vi.mocked(fs.existsSync).mockResolvedValue(true)

      await expect(
        extension.installCudaRuntime('/tmp/cudart-llama-bin-win-cuda.rar')
      ).rejects.toThrow('Invalid path or file')
    })

    it('should reject an archive that is not a CUDA runtime archive', async () => {
      const { fs } = await import('@janhq/core')
      const { basename } = await import('@tauri-apps/api/path')
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(basename).mockResolvedValue('llama-b9193-bin-win-cuda.zip')

      await expect(
        extension.installCudaRuntime('/tmp/llama-b9193-bin-win-cuda.zip')
      ).rejects.toThrow('Not a CUDA runtime archive')
    })

    it('should throw when no matching backend is installed', async () => {
      const { fs } = await import('@janhq/core')
      const { basename } = await import('@tauri-apps/api/path')
      const backendModule = await import('../backend')
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(basename).mockResolvedValue('cudart-llama-bin-win-cuda-12.4.zip')
      vi.mocked(backendModule.getLocalInstalledBackends).mockResolvedValue([
        { backend: 'win-cpu-x64', version: 'v1.0.0' },
      ])

      await expect(
        extension.installCudaRuntime('/tmp/cudart-llama-bin-win-cuda-12.4.zip')
      ).rejects.toThrow('No installed "win-cuda-12.4" backend found')
    })

    it('should throw when matching backends lack a build/bin directory', async () => {
      const { fs, joinPath } = await import('@janhq/core')
      const { basename } = await import('@tauri-apps/api/path')
      const { invoke } = await import('@tauri-apps/api/core')
      const backendModule = await import('../backend')

      vi.mocked(basename).mockResolvedValue('cudart-llama-bin-win-cuda-12.4.zip')
      vi.mocked(backendModule.getLocalInstalledBackends).mockResolvedValue([
        { backend: 'win-cuda-12.4', version: 'v1.0.0' },
      ])
      vi.mocked(backendModule.getBackendDir).mockResolvedValue(
        '/path/to/jan/llamacpp/backends/v1.0.0/win-cuda-12.4'
      )
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      // archive path exists, build/bin dir does not
      vi.mocked(fs.existsSync)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false)

      await expect(
        extension.installCudaRuntime('/tmp/cudart-llama-bin-win-cuda-12.4.zip')
      ).rejects.toThrow('none had a build/bin directory')
      expect(invoke).not.toHaveBeenCalledWith('decompress', expect.anything())
    })

    it('should decompress into every matching backend build/bin', async () => {
      const { fs, joinPath } = await import('@janhq/core')
      const { basename } = await import('@tauri-apps/api/path')
      const { invoke } = await import('@tauri-apps/api/core')
      const backendModule = await import('../backend')

      vi.mocked(basename).mockResolvedValue('cudart-llama-bin-win-cuda-12.4.zip')
      vi.mocked(backendModule.getLocalInstalledBackends).mockResolvedValue([
        { backend: 'win-cuda-12.4', version: 'v1.0.0' },
        { backend: 'win-cuda-12.4', version: 'v2.0.0' },
        { backend: 'win-cpu-x64', version: 'v1.0.0' },
      ])
      vi.mocked(backendModule.getBackendDir).mockImplementation(
        (backend, version) =>
          Promise.resolve(
            `/path/to/jan/llamacpp/backends/${version}/${backend}`
          )
      )
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await extension.installCudaRuntime(
        '/tmp/cudart-llama-bin-win-cuda-12.4.zip'
      )

      // Only the two win-cuda-12.4 backends, not the cpu one.
      const decompressCalls = vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === 'decompress')
      expect(decompressCalls).toHaveLength(2)
      expect(invoke).toHaveBeenCalledWith('decompress', {
        path: '/tmp/cudart-llama-bin-win-cuda-12.4.zip',
        outputDir:
          '/path/to/jan/llamacpp/backends/v1.0.0/win-cuda-12.4/build/bin',
      })
      expect(invoke).toHaveBeenCalledWith('decompress', {
        path: '/tmp/cudart-llama-bin-win-cuda-12.4.zip',
        outputDir:
          '/path/to/jan/llamacpp/backends/v2.0.0/win-cuda-12.4/build/bin',
      })
    })
  })
})

describe('normalizeLlamacppConfig', () => {
  describe('parallel field', () => {
    it('should default parallel to 1 when undefined', () => {
      const result = normalizeLlamacppConfig({})
      expect(result.parallel).toBe(1)
    })

    it('should default parallel to 1 when null', () => {
      const result = normalizeLlamacppConfig({ parallel: null })
      expect(result.parallel).toBe(1)
    })

    it('should default parallel to 1 when empty string', () => {
      const result = normalizeLlamacppConfig({ parallel: '' })
      expect(result.parallel).toBe(1)
    })

    it('should parse parallel as a number', () => {
      const result = normalizeLlamacppConfig({ parallel: 4 })
      expect(result.parallel).toBe(4)
    })

    it('should parse parallel from a string number', () => {
      const result = normalizeLlamacppConfig({ parallel: '2' })
      expect(result.parallel).toBe(2)
    })

    it('should allow parallel of 0 (disables the flag)', () => {
      const result = normalizeLlamacppConfig({ parallel: 0 })
      expect(result.parallel).toBe(0)
    })
  })
})
describe('refreshRouterPreset embedding slot reservation', () => {
  let extension: llamacpp_extension

  const setupRunningRouter = (opts: {
    userModelsMax: number
    routerEmbeddingBonus: number
    embeddingCount: number
  }) => {
    extension = new llamacpp_extension()
    extension['routerPort'] = 12345
    extension['routerApiKey'] = 'key'
    extension['config'] = { version_backend: 'b9100/cpu' } as never
    extension['userModelsMax'] = opts.userModelsMax
    extension['routerEmbeddingBonus'] = opts.routerEmbeddingBonus
    return (async () => {
      const { generatePreset } = await import('../preset')
      vi.mocked(generatePreset).mockResolvedValue({
        path: '/p/router.preset.ini',
        embeddingCount: opts.embeddingCount,
      })
      const { getJanDataFolderPath } = await import('@janhq/core')
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan')
      vi.spyOn(extension, 'getProviderPath').mockResolvedValue('/jan/llamacpp')
      const startRouter = vi
        .spyOn(extension as never, 'startRouter' as never)
        .mockResolvedValue(undefined as never)
      const { reloadRouterModels } = await import(
        '@janhq/tauri-plugin-llamacpp-api'
      )
      vi.mocked(reloadRouterModels).mockResolvedValue(undefined as never)
      return { startRouter, reloadRouterModels: vi.mocked(reloadRouterModels) }
    })()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restarts the router when an embedder appears after start (bonus 0 -> 1)', async () => {
    const { startRouter, reloadRouterModels } = await setupRunningRouter({
      userModelsMax: 1,
      routerEmbeddingBonus: 0,
      embeddingCount: 1,
    })
    await extension['refreshRouterPreset']()
    expect(startRouter).toHaveBeenCalledTimes(1)
    expect(reloadRouterModels).not.toHaveBeenCalled()
  })

  it('live-reloads when the embedding bonus is unchanged', async () => {
    const { startRouter, reloadRouterModels } = await setupRunningRouter({
      userModelsMax: 1,
      routerEmbeddingBonus: 1,
      embeddingCount: 1,
    })
    await extension['refreshRouterPreset']()
    expect(startRouter).not.toHaveBeenCalled()
    expect(reloadRouterModels).toHaveBeenCalledTimes(1)
  })

  it('restarts when the last embedder is removed (bonus 1 -> 0)', async () => {
    const { startRouter, reloadRouterModels } = await setupRunningRouter({
      userModelsMax: 1,
      routerEmbeddingBonus: 1,
      embeddingCount: 0,
    })
    await extension['refreshRouterPreset']()
    expect(startRouter).toHaveBeenCalledTimes(1)
    expect(reloadRouterModels).not.toHaveBeenCalled()
  })

  it('does not restart when models_max is unlimited (0)', async () => {
    const { startRouter, reloadRouterModels } = await setupRunningRouter({
      userModelsMax: 0,
      routerEmbeddingBonus: 0,
      embeddingCount: 1,
    })
    await extension['refreshRouterPreset']()
    expect(startRouter).not.toHaveBeenCalled()
    expect(reloadRouterModels).toHaveBeenCalledTimes(1)
  })
})

describe('bootstrapDefaultEmbedder', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
  })

  it('imports the fallback embedder when none is installed, then marks the bootstrap done', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    // The install is confirmed by re-listing, so the second call has to reflect
    // the import having landed.
    const list = vi
      .spyOn(extension, 'list')
      .mockResolvedValueOnce([{ id: 'chat-model', embedding: false }] as never)
      .mockResolvedValue([
        { id: 'chat-model', embedding: false },
        { id: 'sentence-transformer-mini', embedding: true },
      ] as never)
    const importSpy = vi
      .spyOn(extension, 'import')
      .mockResolvedValue(undefined as never)

    await extension['bootstrapDefaultEmbedder']()

    expect(list).toHaveBeenCalled()
    expect(importSpy).toHaveBeenCalledWith(
      'sentence-transformer-mini',
      expect.objectContaining({ modelPath: expect.stringContaining('MiniLM') })
    )
    expect(setBackendSetting).toHaveBeenCalledWith(
      'llamacpp-embedder-bootstrapped',
      'true'
    )
  })

  it('skips the download when an embedder is already installed but still marks done', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    vi.spyOn(extension, 'list').mockResolvedValue([
      { id: 'custom-embedder', embedding: true },
    ] as never)
    const importSpy = vi.spyOn(extension, 'import')

    await extension['bootstrapDefaultEmbedder']()

    expect(importSpy).not.toHaveBeenCalled()
    expect(setBackendSetting).toHaveBeenCalledWith(
      'llamacpp-embedder-bootstrapped',
      'true'
    )
  })

  it('does nothing when the bootstrap already ran (respects user deletion)', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue('true')
    const list = vi.spyOn(extension, 'list')

    await extension['bootstrapDefaultEmbedder']()

    expect(list).not.toHaveBeenCalled()
    expect(setBackendSetting).not.toHaveBeenCalled()
  })

  it('does not mark done when the download fails, so it retries next launch', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    vi.spyOn(extension, 'list').mockResolvedValue([] as never)
    vi.spyOn(extension, 'import').mockRejectedValue(new Error('offline'))

    await expect(
      extension['bootstrapDefaultEmbedder']()
    ).resolves.toBeUndefined()
    expect(setBackendSetting).not.toHaveBeenCalled()
  })
})

describe('router adoption after a UI crash', () => {
  let extension: llamacpp_extension

  const armStartRouter = async () => {
    extension = new llamacpp_extension()
    extension['config'] = {
      version_backend: 'b9100/cpu',
      models_max: 1,
    } as never
    extension['timeout'] = 600

    const { generatePreset } = await import('../preset')
    vi.mocked(generatePreset).mockResolvedValue({
      path: '/jan/llamacpp/router.preset.ini',
      embeddingCount: 0,
    })
    const { getJanDataFolderPath } = await import('@janhq/core')
    vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan')
    vi.spyOn(extension, 'getProviderPath').mockResolvedValue('/jan/llamacpp')

    const backendModule = await import('../backend')
    vi.mocked(backendModule.getBackendExePath).mockResolvedValue(
      '/backends/b9100/cpu/llama-server'
    )
    vi.spyOn(extension as never, 'getRandomPort' as never).mockResolvedValue(
      12345 as never
    )
    vi.spyOn(extension as never, 'generateApiKey' as never).mockResolvedValue(
      'derived-key' as never
    )

    const { invoke } = await import('@tauri-apps/api/core')
    // get_router_info: nothing running in memory, which is the post-crash state.
    vi.mocked(invoke).mockResolvedValue(null)

    const { adoptRouter } = await import('@janhq/tauri-plugin-llamacpp-api')
    return { adoptRouter: vi.mocked(adoptRouter), invoke: vi.mocked(invoke) }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reuses an adopted router instead of spawning a second one', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    adoptRouter.mockResolvedValue({
      port: 45678,
      api_key: 'adopted-key',
      pid: 999,
    })

    await extension['startRouter']()

    expect(adoptRouter).toHaveBeenCalledTimes(1)
    expect(extension['routerPort']).toBe(45678)
    expect(extension['routerApiKey']).toBe('adopted-key')
    expect(invoke).not.toHaveBeenCalledWith(
      'plugin:llamacpp|start_router',
      expect.anything()
    )
  })

  it('spawns a fresh router when there is nothing to adopt', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    adoptRouter.mockResolvedValue(null)
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:llamacpp|start_router') {
        return { port: 12345, api_key: 'fresh-key', pid: 111 }
      }
      return null
    })

    await extension['startRouter']()

    expect(invoke).toHaveBeenCalledWith(
      'plugin:llamacpp|start_router',
      expect.anything()
    )
    expect(extension['routerPort']).toBe(12345)
  })

  it('falls back to spawning when adoption itself throws', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    adoptRouter.mockRejectedValue(new Error('lock unreadable'))
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:llamacpp|start_router') {
        return { port: 12345, api_key: 'fresh-key', pid: 111 }
      }
      return null
    })

    await extension['startRouter']()

    expect(invoke).toHaveBeenCalledWith(
      'plugin:llamacpp|start_router',
      expect.anything()
    )
  })

  it('passes the effective models_max so an argv-only change is caught', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    extension['config'].models_max = 3 as never
    adoptRouter.mockResolvedValue(null)
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:llamacpp|start_router') {
        return { port: 12345, api_key: 'fresh-key', pid: 111 }
      }
      return null
    })

    await extension['startRouter']()

    expect(adoptRouter).toHaveBeenCalledWith(
      '/backends/b9100/cpu/llama-server',
      '/jan/llamacpp/router.preset.ini',
      3,
      expect.any(String)
    )
  })

  it('never stops a router before trying to adopt it', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    const calls: string[] = []
    adoptRouter.mockImplementation(async () => {
      calls.push('adopt')
      return { port: 45678, api_key: 'adopted-key', pid: 999 }
    })
    invoke.mockImplementation(async (cmd: string) => {
      calls.push(cmd)
      return null
    })

    await extension['startRouter']()

    expect(calls[0]).toBe('adopt')
    expect(calls).not.toContain('plugin:llamacpp|stop_router')
  })

  it('coalesces concurrent starts so the second cannot kill the first', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    adoptRouter.mockResolvedValue(null)
    let spawns = 0
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:llamacpp|start_router') {
        spawns += 1
        await new Promise((r) => setTimeout(r, 10))
        return { port: 12345, api_key: 'fresh-key', pid: 111 }
      }
      return null
    })

    await Promise.all([extension['startRouter'](), extension['startRouter']()])

    expect(spawns).toBe(1)
    expect(invoke).not.toHaveBeenCalledWith('plugin:llamacpp|stop_router')
    expect(extension['routerPort']).toBe(12345)
  })

  it('releases the lock so a later start can still run', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    adoptRouter.mockResolvedValue(null)
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'plugin:llamacpp|start_router'
        ? { port: 12345, api_key: 'fresh-key', pid: 111 }
        : null
    )

    await extension['startRouter']()
    await extension['startRouter']()

    expect(adoptRouter).toHaveBeenCalledTimes(2)
    expect(extension['routerStartLock']).toBeNull()
  })

  it('onUnload leaves the router running for the next instance to adopt', async () => {
    const { invoke } = await armStartRouter()
    extension['routerPort'] = 45678
    extension['routerApiKey'] = 'adopted-key'
    let adoptResolved = false
    extension['backgroundInit'] = (async () => {
      await new Promise((r) => setTimeout(r, 10))
      adoptResolved = true
    })()

    await extension.onUnload()

    expect(invoke).not.toHaveBeenCalledWith('plugin:llamacpp|stop_router')
    // Must not block on the in-flight adoption either; that ordering is what
    // pinned the kill to the moment adoption completed.
    expect(adoptResolved).toBe(false)
    expect(extension['routerPort']).toBeUndefined()
    expect(extension['routerApiKey']).toBeUndefined()
  })

  it('releases the lock even when the spawn fails', async () => {
    const { adoptRouter, invoke } = await armStartRouter()
    adoptRouter.mockResolvedValue(null)
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:llamacpp|start_router') throw new Error('no port')
      return null
    })

    await expect(extension['startRouter']()).rejects.toThrow('no port')
    expect(extension['routerStartLock']).toBeNull()
  })
})

describe('verifyEmbeddingModel', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    // The probe is gated on a configured backend, since the router it needs
    // cannot exist before one is selected.
    extension.config = {
      ...(extension.config ?? {}),
      version_backend: 'b6099/linux-cuda-12-common_cpus-x64',
    } as never
    vi.spyOn(extension as never, 'ensureEmbeddingModelLoaded').mockResolvedValue(
      { model_id: 'sentence-transformer-mini', port: 1234 } as never
    )
  })

  const armEmbed = (embedding: unknown) =>
    vi
      .spyOn(extension, 'embed')
      .mockResolvedValue({ data: [{ embedding, index: 0 }] } as never)

  it('reports pending instead of probing before a backend is configured', async () => {
    extension['config'] = { version_backend: '' } as never
    const embed = armEmbed([0.1])

    const result = await extension.verifyEmbeddingModel()

    expect(result.pending).toBe(true)
    expect(result.status).toBe('ok')
    expect(embed).not.toHaveBeenCalled()
  })

  // The startup install failing is the specific, actionable cause; the load
  // error it produces downstream is not.
  it('prefers the bootstrap error over the downstream load error', async () => {
    vi.spyOn(extension as never, 'getEmbedderBootstrapError').mockReturnValue(
      'download failed: HTTP 403' as never
    )
    vi.spyOn(extension as never, 'ensureEmbeddingModelLoaded').mockRejectedValue(
      new Error('model not found in router preset') as never
    )

    const result = await extension.verifyEmbeddingModel()

    expect(result.status).toBe('warning')
    expect(result.error).toBe('download failed: HTTP 403')
  })

  it('reports the model id and dimension of a healthy embedder', async () => {
    armEmbed([0.1, 0.2, 0.3])

    const result = await extension.verifyEmbeddingModel()

    expect(result.status).toBe('ok')
    expect(result.modelId).toBe('sentence-transformer-mini')
    expect(result.dimension).toBe(3)
  })

  it('actually sends a probe request rather than trusting the install', async () => {
    const embed = armEmbed([0.1])

    await extension.verifyEmbeddingModel()

    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed.mock.calls[0][0]).toHaveLength(1)
  })

  it('warns on a degenerate vector that would break cosine similarity', async () => {
    armEmbed([0, 0, 0])

    const result = await extension.verifyEmbeddingModel()

    expect(result.status).toBe('warning')
    expect(result.problem).toBe('degenerate')
  })

  it('warns when the embedder returns no vector at all', async () => {
    armEmbed(undefined)

    const result = await extension.verifyEmbeddingModel()

    expect(result.status).toBe('warning')
    expect(result.problem).toBe('missing')
  })

  // Warn-never-block: a failed probe must not reject and strand onboarding.
  it('reports a load failure as a warning instead of throwing', async () => {
    vi.spyOn(extension as never, 'ensureEmbeddingModelLoaded').mockRejectedValue(
      new Error('router is not running')
    )

    const result = await extension.verifyEmbeddingModel()

    expect(result.status).toBe('warning')
    expect(result.error).toContain('router is not running')
  })

  it('reports a failed embed request as a warning', async () => {
    vi.spyOn(extension, 'embed').mockRejectedValue(new Error('HTTP 400'))

    const result = await extension.verifyEmbeddingModel()

    expect(result.status).toBe('warning')
    expect(result.error).toContain('HTTP 400')
  })
})

describe('verifyGpuOffload', () => {
  let extension: llamacpp_extension

  const arm = async (
    backend: string,
    devices: unknown[],
    gpus: unknown[] | undefined
  ) => {
    extension = new llamacpp_extension()
    extension['config'] = { version_backend: `b9145/${backend}` } as never
    vi.spyOn(extension, 'getDevices').mockResolvedValue(devices as never)
    const { getSystemInfo } = await import('@janhq/tauri-plugin-hardware-api')
    vi.mocked(getSystemInfo).mockResolvedValue(
      (gpus === undefined ? undefined : { gpus }) as never
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A fresh install has no backend until a catalog fetch and a download finish.
  // Reporting that as a CPU build made a CUDA install look like it left the GPU
  // idle, and probing anyway would have blocked on the whole download.
  it('reports pending while no backend is configured', async () => {
    for (const versionBackend of ['', 'none', 'b9145', undefined]) {
      extension = new llamacpp_extension()
      extension['config'] = { version_backend: versionBackend } as never
      const getDevices = vi.spyOn(extension, 'getDevices')

      const result = await extension.verifyGpuOffload()

      expect(result.pending, String(versionBackend)).toBe(true)
      expect(result.status).toBe('ok')
      expect(result.backend).toBe('')
      expect(getDevices).not.toHaveBeenCalled()
    }
  })

  it('does not report pending once a backend is configured', async () => {
    await arm('linux-cuda-12-common_cpus-x64', [{ id: '0' }], [{ uuid: 'a' }])

    expect((await extension.verifyGpuOffload()).pending).toBeUndefined()
  })

  it('passes a CUDA backend with a visible device', async () => {
    await arm('linux-cuda-12-common_cpus-x64', [{ id: '0' }], [{ uuid: 'a' }])

    const result = await extension.verifyGpuOffload()

    expect(result.status).toBe('ok')
    expect(result.backend).toBe('linux-cuda-12-common_cpus-x64')
  })

  // The silent CPU-fallback case: the router is healthy, so nothing else notices.
  it('warns when a CUDA backend sees no devices but a GPU exists', async () => {
    await arm('linux-cuda-12-common_cpus-x64', [], [{ uuid: 'a' }])

    const result = await extension.verifyGpuOffload()

    expect(result.status).toBe('warning')
    expect(result.reason).toBe('runtimeUnreachable')
  })

  it('warns differently when the machine has no GPU at all', async () => {
    await arm('linux-cuda-12-common_cpus-x64', [], [])

    const result = await extension.verifyGpuOffload()

    expect(result.reason).toBe('noGpuHardware')
  })

  // getDevices spawns `llama-server --list-devices` with a 30s timeout, so a
  // CPU build must not pay for a probe whose answer is already known.
  it('passes a CPU backend without spawning the device probe', async () => {
    await arm('linux-common_cpus-x64', [], [])
    const getDevices = vi.spyOn(extension, 'getDevices')

    const result = await extension.verifyGpuOffload()

    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(false)
    expect(getDevices).not.toHaveBeenCalled()
  })

  // A throwing device probe means we do not know why; claiming "no GPU" would
  // send the user to buy hardware they already have.
  it('does not guess a reason when the device probe fails', async () => {
    extension = new llamacpp_extension()
    extension['config'] = {
      version_backend: 'b9145/linux-cuda-12-common_cpus-x64',
    } as never
    vi.spyOn(extension, 'getDevices').mockRejectedValue(
      new Error('libcudart.so.12: cannot open shared object file')
    )

    const result = await extension.verifyGpuOffload()

    expect(result.status).toBe('warning')
    expect(result.reason).toBeUndefined()
    expect(result.error).toContain('libcudart.so.12')
  })

  it('survives hardware detection returning nothing', async () => {
    await arm('linux-cuda-12-common_cpus-x64', [], undefined)

    const result = await extension.verifyGpuOffload()

    expect(result.reason).toBe('noGpuHardware')
  })
})

describe('bootstrapDefaultEmbedder failure reporting', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
  })

  it('records why the bootstrap failed instead of only logging it', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    vi.spyOn(extension, 'list').mockResolvedValue([] as never)
    vi.spyOn(extension, 'import').mockRejectedValue(new Error('offline'))

    await extension['bootstrapDefaultEmbedder']()

    expect(extension.getEmbedderBootstrapError()).toContain('offline')
  })

  it('leaves no error recorded on success', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    vi.spyOn(extension, 'list').mockResolvedValue([
      { id: 'e', embedding: true },
    ] as never)

    await extension['bootstrapDefaultEmbedder']()

    expect(extension.getEmbedderBootstrapError()).toBeUndefined()
  })

  it('clears a previous error once a later attempt succeeds', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    vi.spyOn(extension, 'list').mockResolvedValue([] as never)
    vi.spyOn(extension, 'import').mockRejectedValue(new Error('offline'))
    await extension['bootstrapDefaultEmbedder']()
    expect(extension.getEmbedderBootstrapError()).toBeDefined()

    vi.spyOn(extension, 'import').mockResolvedValue(undefined as never)
    vi.spyOn(extension, 'list').mockResolvedValue([
      { id: 'sentence-transformer-mini', embedding: true },
    ] as never)
    await extension['bootstrapDefaultEmbedder']()

    expect(extension.getEmbedderBootstrapError()).toBeUndefined()
  })

  // A cancelled download resolves without throwing. Trusting that resolution
  // marked the one-shot bootstrap done for a model that was never installed, so
  // it never retried and the embedder stayed permanently missing.
  it('does not mark done when the import resolves without installing anything', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)
    vi.spyOn(extension, 'list').mockResolvedValue([] as never)
    const importSpy = vi
      .spyOn(extension, 'import')
      .mockResolvedValue(undefined as never)

    await extension['bootstrapDefaultEmbedder']()

    expect(importSpy).toHaveBeenCalled()
    expect(setBackendSetting).not.toHaveBeenCalled()
    expect(extension.getEmbedderBootstrapError()).toContain('did not complete')
  })
})

describe('reportMissingLibrariesFromError', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    extension['config'] = {
      version_backend: 'b9145/linux-cuda-12-common_cpus-x64',
    } as never
  })

  const emitted = async () => {
    const { events } = await import('@janhq/core')
    return vi.mocked(events.emit)
  }

  // Reuses the dependency dialog a failed static verification raises, instead
  // of leaving the user with a generic process error.
  it('raises the dependency dialog for a launch-time missing library', async () => {
    extension['reportMissingLibrariesFromError']({
      code: 'MISSING_SHARED_LIBRARY',
      missing_libraries: ['libcudart.so.12'],
    })

    expect(await emitted()).toHaveBeenCalledWith(
      'onBackendVerificationFailed',
      {
        backend: 'linux-cuda-12-common_cpus-x64',
        version: 'b9145',
        missingLibraries: ['libcudart.so.12'],
      }
    )
  })

  it('ignores unrelated launch failures', async () => {
    extension['reportMissingLibrariesFromError']({
      code: 'LLAMA_CPP_PROCESS_ERROR',
      details: 'something else',
    })

    expect(await emitted()).not.toHaveBeenCalled()
  })

  // Nothing actionable to show, so the dialog would be an empty dead end.
  it('stays silent when no library name could be parsed', async () => {
    extension['reportMissingLibrariesFromError']({
      code: 'MISSING_SHARED_LIBRARY',
    })

    expect(await emitted()).not.toHaveBeenCalled()
  })

  it('tolerates a non-error value', async () => {
    extension['reportMissingLibrariesFromError'](undefined)
    extension['reportMissingLibrariesFromError']('boom')

    expect(await emitted()).not.toHaveBeenCalled()
  })
})

describe('verifyGpuOffload missing-library probe', () => {
  let extension: llamacpp_extension

  const arm = async (
    devices: unknown[],
    probe: unknown,
    gpus: unknown[] = [{ uuid: 'a' }]
  ) => {
    extension = new llamacpp_extension()
    extension['config'] = {
      version_backend: 'b9145/linux-cuda-12-common_cpus-x64',
    } as never
    vi.spyOn(extension, 'getDevices').mockResolvedValue(devices as never)
    const { getSystemInfo } = await import('@janhq/tauri-plugin-hardware-api')
    vi.mocked(getSystemInfo).mockResolvedValue({ gpus } as never)
    const { probeBackendGpuLibraries } = await import('../backend')
    if (probe instanceof Error) {
      vi.mocked(probeBackendGpuLibraries).mockRejectedValue(probe)
    } else {
      vi.mocked(probeBackendGpuLibraries).mockResolvedValue(probe as never)
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ggml discards the loader error in a release build, so the probe is the only
  // way to name the dependency.
  it('names the missing library when a GPU backend sees no devices', async () => {
    await arm([], {
      loaded: [],
      inconclusive: false,
      failures: [
        {
          library: 'libggml-cuda.so',
          error: 'libnccl.so.2: cannot open shared object file',
          missing_libraries: ['libnccl.so.2'],
        },
      ],
    })

    const result = await extension.verifyGpuOffload()

    expect(result.status).toBe('warning')
    expect(result.reason).toBe('missingLibrary')
    expect(result.missingLibraries).toEqual(['libnccl.so.2'])
  })

  it('raises the dependency dialog with the probed libraries', async () => {
    await arm([], {
      loaded: [],
      inconclusive: false,
      failures: [
        {
          library: 'libggml-cuda.so',
          error: 'boom',
          missing_libraries: ['libnccl.so.2', 'libcublas.so.12'],
        },
      ],
    })

    await extension.verifyGpuOffload()

    const { events } = await import('@janhq/core')
    expect(vi.mocked(events.emit)).toHaveBeenCalledWith(
      'onBackendVerificationFailed',
      {
        backend: 'linux-cuda-12-common_cpus-x64',
        version: 'b9145',
        missingLibraries: ['libnccl.so.2', 'libcublas.so.12'],
      }
    )
  })

  it('deduplicates libraries reported by several failures', async () => {
    await arm([], {
      loaded: [],
      inconclusive: false,
      failures: [
        { library: 'a.so', error: 'x', missing_libraries: ['libnccl.so.2'] },
        { library: 'b.so', error: 'y', missing_libraries: ['libnccl.so.2'] },
      ],
    })

    const result = await extension.verifyGpuOffload()

    expect(result.missingLibraries).toEqual(['libnccl.so.2'])
  })

  // An inconclusive probe establishes no cause, so the symptom-level verdict
  // must stand rather than a fabricated one.
  it('falls back to the symptom verdict when the probe is inconclusive', async () => {
    await arm([], { loaded: [], failures: [], inconclusive: true })

    const result = await extension.verifyGpuOffload()

    expect(result.reason).toBe('runtimeUnreachable')
    expect(result.missingLibraries).toBeUndefined()
  })

  it('falls back when the probe finds no failures', async () => {
    await arm([], { loaded: ['libggml-cuda.so'], failures: [], inconclusive: false })

    const result = await extension.verifyGpuOffload()

    expect(result.reason).toBe('runtimeUnreachable')
  })

  it('survives the probe throwing', async () => {
    await arm([], new Error('probe exploded'))

    const result = await extension.verifyGpuOffload()

    expect(result.reason).toBe('runtimeUnreachable')
  })

  // A working GPU must never pay for the probe.
  it('does not probe when devices are present', async () => {
    await arm([{ id: '0' }], { loaded: [], failures: [], inconclusive: false })

    const result = await extension.verifyGpuOffload()

    const { probeBackendGpuLibraries } = await import('../backend')
    expect(vi.mocked(probeBackendGpuLibraries)).not.toHaveBeenCalled()
    expect(result.status).toBe('ok')
  })
})

describe('createDownloadTaskId', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
  })

  const taskId = (modelId: string) =>
    extension['createDownloadTaskId'](modelId) as string

  // The id becomes the Tauri event name `download-<taskId>`, which rejects dots.
  it('contains no dots', () => {
    expect(taskId('Jan-v3.5-4B-Q4_K_XL')).not.toContain('.')
  })

  // Truncating at the first dot collapsed every quant of a dotted model name onto
  // one id. Rust cancels an in-flight task whose id repeats and deletes its
  // partial file, so downloading one quant destroyed another's.
  it('keeps quants of the same dotted model distinct', () => {
    expect(taskId('Jan-v3.5-4B-Q4_K_XL')).not.toBe(
      taskId('Jan-v3.5-4B-Q8_0')
    )
  })

  it('keeps different versions of the same family distinct', () => {
    expect(taskId('Jan-v3.5-4B-Q4_K_XL')).not.toBe(
      taskId('Jan-v3.6-4B-Q4_K_XL')
    )
  })

  it('namespaces by provider and preserves the rest of the id', () => {
    expect(taskId('some/model-q4_k_m')).toBe('llamacpp/some/model-q4_k_m')
  })

  it('is stable for the same model id', () => {
    expect(taskId('Jan-v3.5-4B-Q4_K_XL')).toBe(taskId('Jan-v3.5-4B-Q4_K_XL'))
  })
})

describe('import deduplication', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
  })

  // Two callers racing on one model both passed the model.yml guard and then
  // registered the same download task id, which Rust resolves by cancelling the
  // first and deleting its partial file.
  it('joins a concurrent import of the same model', async () => {
    let release: (() => void) | undefined
    const runImport = vi
      .spyOn(extension as never, 'runImport')
      .mockImplementation(
        () => new Promise<void>((resolve) => (release = resolve)) as never
      )

    const first = extension.import('m', { modelPath: 'u' } as never)
    const second = extension.import('m', { modelPath: 'u' } as never)

    expect(runImport).toHaveBeenCalledTimes(1)
    release?.()
    await Promise.all([first, second])
  })

  it('does not join imports of different models', async () => {
    const runImport = vi
      .spyOn(extension as never, 'runImport')
      .mockResolvedValue(undefined as never)

    await Promise.all([
      extension.import('a', { modelPath: 'u' } as never),
      extension.import('b', { modelPath: 'u' } as never),
    ])

    expect(runImport).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh import once the previous one settled', async () => {
    const runImport = vi
      .spyOn(extension as never, 'runImport')
      .mockResolvedValue(undefined as never)

    await extension.import('m', { modelPath: 'u' } as never)
    await extension.import('m', { modelPath: 'u' } as never)

    expect(runImport).toHaveBeenCalledTimes(2)
  })

  // Both callers asked for the same work, so both must see it fail -- and the
  // slot has to clear so a retry is possible.
  it('rejects every joined caller and clears the slot', async () => {
    const runImport = vi
      .spyOn(extension as never, 'runImport')
      .mockRejectedValue(new Error('offline') as never)

    const first = extension.import('m', { modelPath: 'u' } as never)
    const second = extension.import('m', { modelPath: 'u' } as never)

    await expect(first).rejects.toThrow('offline')
    await expect(second).rejects.toThrow('offline')
    expect(runImport).toHaveBeenCalledTimes(1)

    runImport.mockResolvedValue(undefined as never)
    await extension.import('m', { modelPath: 'u' } as never)
    expect(runImport).toHaveBeenCalledTimes(2)
  })
})

describe('first-run provisioning gate', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
  })

  const armProvisioningSpies = () => ({
    configure: vi
      .spyOn(extension as never, 'configureBackends')
      .mockResolvedValue(undefined as never),
    router: vi
      .spyOn(extension as never, 'startRouter')
      .mockResolvedValue(undefined as never),
    embedder: vi
      .spyOn(extension as never, 'bootstrapDefaultEmbedder')
      .mockResolvedValue(undefined as never),
  })

  // A first run downloads hundreds of megabytes; the setup screen asks first.
  it('sets the consent flag and provisions when the setup screen asks', async () => {
    const spies = armProvisioningSpies()

    await extension.startFirstRunSetup()

    expect(setBackendSetting).toHaveBeenCalledWith(
      'llamacpp-first-run-setup-started',
      'true'
    )
    expect(spies.configure).toHaveBeenCalled()
    expect(spies.embedder).toHaveBeenCalled()
  })

  it('provisions only once however many callers ask', async () => {
    const spies = armProvisioningSpies()

    await Promise.all([
      extension.startFirstRunSetup(),
      extension.startFirstRunSetup(),
      extension['ensureProvisioned'](),
    ])

    expect(spies.configure).toHaveBeenCalledTimes(1)
    expect(spies.embedder).toHaveBeenCalledTimes(1)
  })

  // Skipping setup and later loading a local model still has to work.
  it('provisions on demand when the router is needed', async () => {
    const spies = armProvisioningSpies()
    vi.spyOn(extension as never, 'getRouterInfo').mockResolvedValue({
      port: 1234,
    } as never)

    await extension['ensureRouterReady']()

    expect(spies.configure).toHaveBeenCalledTimes(1)
  })

  it('still provisions when the persisted flag cannot be written', async () => {
    const spies = armProvisioningSpies()
    vi.mocked(setBackendSetting).mockRejectedValueOnce(new Error('disk full'))

    await extension.startFirstRunSetup()

    expect(spies.configure).toHaveBeenCalled()
  })

  it('treats an unreadable consent flag as not consented', async () => {
    vi.mocked(getBackendSetting).mockRejectedValue(new Error('unreadable'))

    expect(await extension['hasSetupConsent']()).toBe(false)
  })

  it('reads consent from the persisted flag', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue('true')
    expect(await extension['hasSetupConsent']()).toBe(true)

    vi.mocked(getBackendSetting).mockResolvedValue(null)
    expect(await extension['hasSetupConsent']()).toBe(false)
  })
})
