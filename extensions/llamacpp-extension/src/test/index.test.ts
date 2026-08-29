import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import llamacpp_extension from '../index'

import { getBackendSetting, setBackendSetting } from '../backend-settings'

vi.mock('../backend-settings')

// Mock fetch globally
global.fetch = vi.fn()

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
    startEngine: vi.fn().mockResolvedValue({
      port: 39271,
      api_key: 'k',
      pid: 1234,
      models: [],
    }),
    stopEngine: vi.fn(),
    getEngineInfo: vi.fn(),
    reloadEngineModels: vi.fn().mockResolvedValue({
      added: [],
      changed: [],
      removed: [],
      kept: [],
      models_max: 1,
    }),
    engineDevices: vi.fn().mockResolvedValue([]),
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
    const { startEngine, getEngineInfo } = await import(
      '@janhq/tauri-plugin-llamacpp-api'
    )
    vi.mocked(startEngine).mockResolvedValue({
      port: 39271,
      api_key: 'k',
      pid: 1234,
      models: [],
    })
    vi.mocked(getEngineInfo).mockResolvedValue({
      port: 39271,
      api_key: 'k',
      pid: 1234,
      models: [],
    })
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

  describe('resolveThreadCacheBudget', () => {
    const budget = (cfg: Record<string, unknown>): number => {
      // `config` is populated by onLoad, which is not run here.
      ;(extension as any).config = {
        ...((extension as any).config ?? {}),
        ...cfg,
      }
      return (extension as any).resolveThreadCacheBudget()
    }

    it('reports the configured size when persistence is on', () => {
      expect(
        budget({ persist_thread_cache: true, thread_cache_size: 4096 })
      ).toBe(4096)
    })

    // 0 is the worker's off switch, so the toggle and the size collapse into
    // one number rather than being forwarded separately.
    it('reports 0 when the toggle is off, whatever the size says', () => {
      expect(
        budget({ persist_thread_cache: false, thread_cache_size: 4096 })
      ).toBe(0)
    })

    it('treats an unusable size as off rather than passing it through', () => {
      for (const thread_cache_size of [0, -1, NaN, undefined, 'lots']) {
        expect(budget({ persist_thread_cache: true, thread_cache_size })).toBe(
          0
        )
      }
    })

    it('truncates a fractional size, since the flag is an integer of MiB', () => {
      expect(
        budget({ persist_thread_cache: true, thread_cache_size: 2048.7 })
      ).toBe(2048)
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
      vi.mocked(fs.fileStat).mockResolvedValue({
        isDirectory: true,
        size: 1000,
      })

      vi.mocked(invoke).mockResolvedValue({
        model_path: 'test-model/model.gguf',
        name: 'Test Model',
        size_bytes: 1000000,
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
        },
      ])
    })
  })

  describe('import', () => {
    it('should throw error for invalid modelId', async () => {
      await expect(
        extension.import('invalid/model/../id', { modelPath: '/path/to/model' })
      ).rejects.toThrow('Invalid modelId')
    })

    it('should throw error if model already exists', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockResolvedValue(
        '/path/to/jan/llamacpp/models/test-model/model.yml'
      )
      vi.mocked(fs.existsSync).mockResolvedValue(true)

      await expect(
        extension.import('test-model', { modelPath: '/path/to/model' })
      ).rejects.toThrow('Model test-model already exists')
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
        downloadFiles: vi.fn().mockResolvedValue(undefined),
      }

      window.core.extensionManager.getByName = vi
        .fn()
        .mockReturnValue(mockDownloadManager)

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      vi.mocked(fs.existsSync).mockResolvedValue(false)
      vi.mocked(fs.fileStat).mockResolvedValue({ size: 1000000 })
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await extension.import('test-model', {
        modelPath: 'https://example.com/model.gguf',
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

      await expect(extension.load('test-model')).rejects.toThrow(
        'Model already loaded!!'
      )
    })

    it('should load model successfully', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')

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
        auto_unload: true,
      }

      // Set up providerPath
      extension['providerPath'] = '/path/to/jan/llamacpp'

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )

      const expectedSession = {
        model_id: 'test-model',
        pid: 123,
        port: 3000,
        api_key: 'test-api-key',
      }

      const apiModule = await import('@janhq/tauri-plugin-llamacpp-api')
      vi.mocked(apiModule.loadLlamaModel).mockResolvedValue(
        expectedSession as any
      )

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
      await expect(extension.unload('nonexistent-model')).rejects.toThrow(
        'No active session found'
      )
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
        messages: [{ role: 'user', content: 'Hello' }],
      }

      await expect(extension.chat(request)).rejects.toThrow(
        'No active session found'
      )
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
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const request = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }

      const result = await extension.chat(request)

      expect(result).toEqual(mockResponse)
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
          },
        })
      )
    })
  })

  describe('delete', () => {
    it('should throw error if model does not exist', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      vi.mocked(fs.existsSync).mockResolvedValue(false)

      await expect(extension.delete('nonexistent-model')).rejects.toThrow(
        'Model nonexistent-model does not exist'
      )
    })

    it('should delete model successfully', async () => {
      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.rm).mockResolvedValue(undefined)

      await extension.delete('test-model')

      expect(fs.rm).toHaveBeenCalledWith(
        '/path/to/jan/llamacpp/models/test-model'
      )
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

      const updatedSettings = vi.mocked(extension['updateSettings']).mock
        .calls[0][0]
      expect(
        updatedSettings.find((s: any) => s.key === 'fit').controllerProps.value
      ).toBe(false)
      expect(
        updatedSettings.find((s: any) => s.key === 'ctx_size').controllerProps
          .value
      ).toBe(2048)
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

      const updatedSettings = vi.mocked(extension['updateSettings']).mock
        .calls[0][0]
      expect(
        updatedSettings.find((s: any) => s.key === 'fit_target').controllerProps
          .value
      ).toBe('1024')
      expect(
        updatedSettings.find((s: any) => s.key === 'fit_ctx').controllerProps
          .value
      ).toBe('')
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
})

// The worker is a separate process precisely so a GGML_ASSERT or an OOM kill
// costs the model rather than the app, which only pays off if Jan notices the
// death and respawns. get_engine_info is where that is noticed.
describe('a dead worker is noticed rather than cached', () => {
  let extension: llamacpp_extension

  beforeEach(async () => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
  })

  it('re-asks the command even after a successful answer', async () => {
    const { getEngineInfo } = await import('@janhq/tauri-plugin-llamacpp-api')
    vi.mocked(getEngineInfo).mockResolvedValue({
      port: 39271,
      api_key: 'k',
      pid: 1234,
      models: [],
    })
    expect(await extension.getEngineInfo()).toEqual({
      port: 39271,
      apiKey: 'k',
    })

    // The worker died: the command reaps the handle and reports nothing.
    vi.mocked(getEngineInfo).mockResolvedValue(null as never)
    expect(await extension.getEngineInfo()).toBeNull()
    expect(vi.mocked(getEngineInfo)).toHaveBeenCalledTimes(2)
  })

  it('respawns instead of handing out the closed port', async () => {
    const { getEngineInfo } = await import('@janhq/tauri-plugin-llamacpp-api')
    vi.mocked(getEngineInfo).mockResolvedValue({
      port: 39271,
      api_key: 'k',
      pid: 1234,
      models: [],
    })
    await extension.getEngineInfo()

    vi.mocked(getEngineInfo).mockResolvedValue(null as never)
    vi.spyOn(
      extension as never,
      'ensureProvisioned' as never
    ).mockResolvedValue(undefined as never)
    const spawn = vi
      .spyOn(extension as never, 'startEngine' as never)
      .mockResolvedValue(undefined as never)
    await extension['ensureEngineReady']()
    expect(spawn).toHaveBeenCalled()
  })
})

describe('refreshEnginePreset chat-model capacity', () => {
  let extension: llamacpp_extension

  const setupRunningEngine = (opts: {
    userModelsMax: number
    embeddingCount: number
  }) => {
    extension = new llamacpp_extension()
    extension['config'] = { models_max: opts.userModelsMax } as never
    return (async () => {
      // A running worker is what get_engine_info reports, not what the
      // extension last cached: that command is where a worker that died is
      // noticed, so getEngineInfo() always asks it.
      const { getEngineInfo } = await import('@janhq/tauri-plugin-llamacpp-api')
      vi.mocked(getEngineInfo).mockResolvedValue({
        port: 12345,
        api_key: 'key',
        pid: 1234,
        models: [],
      })
      const { generatePreset } = await import('../preset')
      vi.mocked(generatePreset).mockResolvedValue({
        path: '/p/router.preset.ini',
        embeddingCount: opts.embeddingCount,
      })
      const { getJanDataFolderPath } = await import('@janhq/core')
      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan')
      vi.spyOn(extension, 'getProviderPath').mockResolvedValue('/jan/llamacpp')
      const startEngine = vi
        .spyOn(extension as never, 'startEngine' as never)
        .mockResolvedValue(undefined as never)
      const { reloadEngineModels } = await import(
        '@janhq/tauri-plugin-llamacpp-api'
      )
      vi.mocked(reloadEngineModels).mockResolvedValue({
        added: [],
        changed: [],
        removed: [],
        kept: [],
        models_max: 1,
      })
      return { startEngine, reloadEngineModels: vi.mocked(reloadEngineModels) }
    })()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The router fixed models_max at spawn, so this case had to cold-restart and
  // evict the model the user was talking to. The worker resizes in place.
  it('reloads rather than restarting when an embedder appears', async () => {
    const { startEngine, reloadEngineModels } = await setupRunningEngine({
      userModelsMax: 1,
      embeddingCount: 1,
    })
    await extension['refreshEnginePreset']()
    expect(startEngine).not.toHaveBeenCalled()
    // models_max is the chat cap verbatim: the embedder's slot is reserved
    // worker-side, so an embedder appearing must not inflate the cap -- that
    // used to let a second chat model pile up next to the first.
    expect(reloadEngineModels).toHaveBeenCalledWith(
      '/p/router.preset.ini',
      1,
      expect.any(Number)
    )
  })

  it('reloads when the cap is unchanged', async () => {
    const { startEngine, reloadEngineModels } = await setupRunningEngine({
      userModelsMax: 1,
      embeddingCount: 0,
    })
    await extension['refreshEnginePreset']()
    expect(startEngine).not.toHaveBeenCalled()
    expect(reloadEngineModels).toHaveBeenCalledWith(
      '/p/router.preset.ini',
      1,
      expect.any(Number)
    )
  })

  // 0 means unlimited, and no bonus is ever added on top of it worker-side or
  // extension-side.
  it('keeps models_max unlimited rather than adding anything to it', async () => {
    const { reloadEngineModels } = await setupRunningEngine({
      userModelsMax: 0,
      embeddingCount: 1,
    })
    await extension['refreshEnginePreset']()
    expect(reloadEngineModels).toHaveBeenCalledWith(
      '/p/router.preset.ini',
      0,
      expect.any(Number)
    )
  })

  it('falls back to a restart when the live reload fails', async () => {
    const { startEngine, reloadEngineModels } = await setupRunningEngine({
      userModelsMax: 1,
      embeddingCount: 1,
    })
    reloadEngineModels.mockRejectedValue(new Error('worker gone'))
    await extension['refreshEnginePreset']()
    expect(startEngine).toHaveBeenCalledTimes(1)
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
    vi.spyOn(
      extension as never,
      'ensureEmbeddingModelLoaded'
    ).mockResolvedValue({
      model_id: 'sentence-transformer-mini',
      port: 1234,
    } as never)
  })

  const armEmbed = (embedding: unknown) =>
    vi
      .spyOn(extension, 'embed')
      .mockResolvedValue({ data: [{ embedding, index: 0 }] } as never)

  // The startup install failing is the specific, actionable cause; the load
  // error it produces downstream is not.
  it('prefers the bootstrap error over the downstream load error', async () => {
    vi.spyOn(extension as never, 'getEmbedderBootstrapError').mockReturnValue(
      'download failed: HTTP 403' as never
    )
    vi.spyOn(
      extension as never,
      'ensureEmbeddingModelLoaded'
    ).mockRejectedValue(new Error('model not found in router preset') as never)

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
    vi.spyOn(
      extension as never,
      'ensureEmbeddingModelLoaded'
    ).mockRejectedValue(new Error('router is not running'))

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

  const arm = async (devices: unknown[], gpus: unknown[] | undefined) => {
    extension = new llamacpp_extension()
    extension['config'] = {} as never
    vi.spyOn(extension, 'getDevices').mockResolvedValue(devices as never)
    const { getSystemInfo } = await import('@janhq/tauri-plugin-hardware-api')
    vi.mocked(getSystemInfo).mockResolvedValue(
      (gpus === undefined ? undefined : { gpus }) as never
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The backend is now read off the device the engine enumerated rather than a
  // setting, so it reports what actually loaded instead of what was chosen.
  it('names the backend from the enumerated device', async () => {
    await arm(
      [{ id: 'CUDA0', name: 'RTX 4090', mem: 24576, free: 24000 }],
      [{}]
    )
    const result = await extension.verifyGpuOffload()
    expect(result.status).toBe('ok')
    expect(result.backend).toBe('cuda')
    expect(result.gpuExpected).toBe(true)
    expect(result.engineDeviceCount).toBe(1)
  })

  // Metal is implicit on Apple Silicon; it enumerates as a device like any
  // other, so it no longer needs a special case upstream of this.
  it('names metal from an Apple device', async () => {
    await arm([{ id: 'Metal0', name: 'M3 Pro', mem: 1, free: 1 }], [{}])
    expect((await extension.verifyGpuOffload()).backend).toBe('metal')
  })

  it('passes a machine with no GPU at all', async () => {
    await arm([], [])
    const result = await extension.verifyGpuOffload()
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(false)
    expect(result.backend).toBe('')
    expect(result.reason).toBeUndefined()
  })

  // The one actionable failure: the GPU is there but the engine cannot see it.
  it('warns when a present GPU is invisible to the engine', async () => {
    await arm([], [{}])
    const result = await extension.verifyGpuOffload()
    expect(result.status).toBe('warning')
    expect(result.reason).toBe('runtimeUnreachable')
  })

  it('survives hardware detection returning nothing', async () => {
    await arm([], undefined)
    const result = await extension.verifyGpuOffload()
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(false)
  })

  // Without a device list there is no basis for a reason code, so the raw cause
  // is reported rather than a guess between "no GPU" and "unreachable GPU".
  it('reports the raw error when the device probe throws', async () => {
    extension = new llamacpp_extension()
    extension['config'] = {} as never
    vi.spyOn(extension, 'getDevices').mockRejectedValue(new Error('no worker'))
    const result = await extension.verifyGpuOffload()
    expect(result.status).toBe('warning')
    expect(result.error).toContain('no worker')
    expect(result.reason).toBeUndefined()
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

    // There is no selected variant to name any more, so the backend is
    // inferred from the library that failed to resolve.
    expect(await emitted()).toHaveBeenCalledWith(
      'onBackendVerificationFailed',
      {
        backend: 'cuda',
        missingLibraries: ['libcudart.so.12'],
      }
    )
  })

  it('infers vulkan from a vulkan loader failure', async () => {
    extension['reportMissingLibrariesFromError']({
      code: 'MISSING_SHARED_LIBRARY',
      missing_libraries: ['libvulkan.so.1'],
    })

    expect(await emitted()).toHaveBeenCalledWith(
      'onBackendVerificationFailed',
      { backend: 'vulkan', missingLibraries: ['libvulkan.so.1'] }
    )
  })

  // An unrecognised library still raises the dialog: the library name is the
  // actionable part, and withholding it would leave the user with nothing.
  it('still reports a library it cannot attribute to a backend', async () => {
    extension['reportMissingLibrariesFromError']({
      code: 'MISSING_SHARED_LIBRARY',
      missing_libraries: ['libsomething.so.3'],
    })

    expect(await emitted()).toHaveBeenCalledWith(
      'onBackendVerificationFailed',
      { backend: '', missingLibraries: ['libsomething.so.3'] }
    )
  })

  it('ignores unrelated launch failures', async () => {
    extension['reportMissingLibrariesFromError']({
      code: 'MODEL_LOAD_FAILED',
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
    expect(taskId('Jan-v3.5-4B-Q4_K_XL')).not.toBe(taskId('Jan-v3.5-4B-Q8_0'))
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

describe('embedding readiness during the first-run fetch', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    extension['config'] = {} as never
  })

  // The old gate keyed off "no backend selected yet", which happened to cover
  // this window. With the engine bundled that proxy is gone, so a normal
  // first-run download was being reported as a failed embedding check --
  // a warning on the onboarding checklist for nothing being wrong.
  it('reports pending while the embedder is downloading, not a warning', async () => {
    extension['embedderBootstrapping'] = true
    const load = vi.spyOn(
      extension as never,
      'ensureEmbeddingModelLoaded' as never
    )

    const report = await extension.verifyEmbeddingModel()

    expect(report.status).toBe('ok')
    expect(report.pending).toBe(true)
    // Probing mid-download would fail on a model that is simply not there yet.
    expect(load).not.toHaveBeenCalled()
  })

  it('reports a real failure once the fetch is done', async () => {
    extension['embedderBootstrapping'] = false
    vi.spyOn(
      extension as never,
      'ensureEmbeddingModelLoaded' as never
    ).mockRejectedValue(new Error('no embedder') as never)

    const report = await extension.verifyEmbeddingModel()

    expect(report.status).toBe('warning')
    expect(report.pending).toBeUndefined()
    expect(report.error).toContain('no embedder')
  })
})
