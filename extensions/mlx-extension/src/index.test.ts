import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalExtensionContext } from '@janhq/core'
import mlx_extension, { activate } from './index'
import { fs, getJanDataFolderPath, events, ServiceKeys } from '@janhq/core'
import {
  unloadMlxModel,
  findMlxSessionByModel,
  isMlxProcessRunning,
  getMlxLoadedModels,
  getMlxRandomPort,
} from '@janhq/tauri-plugin-mlx-api'
import { readGgufMetadata } from '@janhq/tauri-plugin-llamacpp-api'

const mockReadYaml = vi.mocked(fs.readYaml)
const mockWriteYaml = vi.mocked(fs.writeYaml)
const mockReadFileSync = vi.mocked(fs.readFileSync)
const mockFindSession = vi.mocked(findMlxSessionByModel)
const mockIsRunning = vi.mocked(isMlxProcessRunning)
const mockLoadedModels = vi.mocked(getMlxLoadedModels)
const mockExistsSync = vi.mocked(fs.existsSync)
const mockRm = vi.mocked(fs.rm)
const mockFileStat = vi.mocked(fs.fileStat)
const mockJanData = vi.mocked(getJanDataFolderPath)
const mockUnload = vi.mocked(unloadMlxModel)
const mockReadGguf = vi.mocked(readGgufMetadata)

// The host service registry the engine reaches the Downloads service through.
const hostServices = { get: vi.fn() }

function newExt(): any {
  const ext = new mlx_extension(hostServices) as any
  ext.providerPath = '/data/mlx'
  return ext
}

beforeEach(() => {
  vi.clearAllMocks()
  mockJanData.mockResolvedValue('/data')
})

describe('getProviderPath', () => {
  it('joins the jan data folder with the mlx dir and caches it', async () => {
    const ext = new mlx_extension(hostServices) as any
    const path = await ext.getProviderPath()
    expect(path).toBe('/data/mlx')

    mockJanData.mockClear()
    const again = await ext.getProviderPath()
    expect(again).toBe('/data/mlx')
    expect(mockJanData).not.toHaveBeenCalled()
  })
})

describe('onSettingUpdate', () => {
  it('updates auto_unload and timeout on the instance', () => {
    const ext = newExt()
    ext.onSettingUpdate('auto_unload', false)
    expect(ext.autoUnload).toBe(false)

    ext.onSettingUpdate('timeout', 42)
    expect(ext.timeout).toBe(42)
    expect(ext.config.timeout).toBe(42)
  })

  it('stores arbitrary settings without touching autoUnload/timeout', () => {
    const ext = newExt()
    ext.onSettingUpdate('ctx_size', 8192)
    expect(ext.config.ctx_size).toBe(8192)
    expect(ext.autoUnload).toBe(true)
  })
})

describe('getModelProps', () => {
  it('returns the configured ctx_size as nCtx with the model alias', async () => {
    const ext = newExt()
    ext.onSettingUpdate('ctx_size', 8192)
    const props = await ext.getModelProps('org/model')
    expect(props).toEqual({ nCtx: 8192, modelAlias: 'org/model' })
  })

  it('falls back to a 4096 default when ctx_size is unset', async () => {
    const ext = newExt()
    const props = await ext.getModelProps('org/model')
    expect(props.nCtx).toBe(4096)
  })
})

describe('getModelContextLimit', () => {
  it('uses the text model limit from a multimodal config', async () => {
    const ext = new mlx_extension(hostServices)
    mockReadYaml.mockResolvedValueOnce({ model_path: '/external/model' })
    mockFileStat.mockResolvedValue({ isDirectory: true } as never)
    mockReadFileSync.mockResolvedValueOnce(JSON.stringify({
      max_position_embeddings: 1024,
      text_config: { max_position_embeddings: 32768 },
    }))
    expect(await ext.getModelContextLimit('model')).toBe(32768)
    expect(mockReadYaml).toHaveBeenCalledWith('/data/mlx/models/model/model.yml')
    expect(mockReadFileSync).toHaveBeenCalledWith('/external/model/config.json')
  })

  it('does not assume a context limit when the config omits it', async () => {
    const ext = new mlx_extension(hostServices)
    mockReadYaml.mockResolvedValueOnce({ model_path: '/external/model' })
    mockFileStat.mockResolvedValue({ isDirectory: true } as never)
    mockReadFileSync.mockResolvedValueOnce('{}')
    expect(await ext.getModelContextLimit('model')).toBeUndefined()
  })
})

describe('createDownloadTaskId', () => {
  it('prefixes the provider and strips everything after the first dot', () => {
    const ext = newExt()
    expect(ext.createDownloadTaskId('org/model.Q4_K_M')).toBe('mlx/org/model')
  })

  it('keeps the id intact when there is no dot', () => {
    const ext = newExt()
    expect(ext.createDownloadTaskId('org/model')).toBe('mlx/org/model')
  })
})

describe('get', () => {
  it('returns undefined when model.yml does not exist', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(false)
    expect(await ext.get('foo')).toBeUndefined()
  })

  it('maps model config to modelInfo with fallbacks', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(true)
    mockReadYaml.mockResolvedValue({ size_bytes: 1234, embedding: true })

    const info = await ext.get('foo')
    expect(info).toEqual({
      id: 'foo',
      name: 'foo',
      providerId: 'mlx',
      port: 0,
      sizeBytes: 1234,
      embedding: true,
    })
    expect(mockReadYaml).toHaveBeenCalledWith('/data/mlx/models/foo/model.yml')
  })

  it('prefers the configured name over the model id', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(true)
    mockReadYaml.mockResolvedValue({ name: 'Pretty Name' })

    const info = await ext.get('foo')
    expect(info.name).toBe('Pretty Name')
    expect(info.sizeBytes).toBe(0)
    expect(info.embedding).toBe(false)
  })
})

describe('getLoadedModels', () => {
  it('returns the plugin result', async () => {
    const ext = newExt()
    mockLoadedModels.mockResolvedValue(['a', 'b'])
    expect(await ext.getLoadedModels()).toEqual(['a', 'b'])
  })

  it('throws when the plugin call fails', async () => {
    const ext = newExt()
    mockLoadedModels.mockRejectedValue('boom')
    await expect(ext.getLoadedModels()).rejects.toThrow('boom')
  })
})

describe('unload', () => {
  it('throws when there is no active session', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue(null)
    await expect(ext.unload('foo')).rejects.toThrow(
      'No active MLX session found for model: foo'
    )
  })

  it('returns the unload result on success', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue({ pid: 99, model_id: 'foo' } as never)
    mockUnload.mockResolvedValue({ success: true })

    const result = await ext.unload('foo')
    expect(result).toEqual({ success: true })
    expect(mockFindSession).toHaveBeenCalledWith('foo')
    expect(mockUnload).toHaveBeenCalledWith(99)
  })

  it('returns a failure object when unload throws', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue({ pid: 99, model_id: 'foo' } as never)
    mockUnload.mockRejectedValue(new Error('nope'))

    const result = await ext.unload('foo')
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})

describe('load', () => {
  it('throws when the model is already loaded', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue({ pid: 1, model_id: 'foo' } as never)
    await expect(ext.load('foo')).rejects.toThrow('Model already loaded!')
  })

  it('deduplicates concurrent loads of the same model', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue(null)
    const sentinel = Promise.resolve({ pid: 7 })
    ext.performLoad = vi.fn().mockReturnValue(sentinel)

    const [a, b] = await Promise.all([ext.load('foo'), ext.load('foo')])
    expect(a).toEqual({ pid: 7 })
    expect(b).toEqual({ pid: 7 })
    expect(ext.performLoad).toHaveBeenCalledTimes(1)
  })
})

describe('delete', () => {
  it('throws when the model does not exist', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(false)
    await expect(ext.delete('foo')).rejects.toThrow('Model foo does not exist')
  })

  it('removes the parent dir for relative paths and the model dir', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(true)
    mockReadYaml.mockResolvedValue({
      model_path: 'mlx/models/foo/model.safetensors',
    })
    mockRm.mockResolvedValue(undefined)

    await ext.delete('foo')
    expect(mockRm).toHaveBeenCalledWith('/data/mlx/models/foo')
    expect(mockRm).toHaveBeenCalledWith('/data/mlx/models/foo')
  })

  it('does not remove a parent dir for absolute paths', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(true)
    mockReadYaml.mockResolvedValue({ model_path: '/abs/model/model.safetensors' })
    mockRm.mockResolvedValue(undefined)

    await ext.delete('foo')
    expect(mockRm).toHaveBeenCalledTimes(1)
    expect(mockRm).toHaveBeenCalledWith('/data/mlx/models/foo')
  })
})

describe('chat', () => {
  it('throws when no session is found', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue(null)
    await expect(ext.chat({ model: 'foo' })).rejects.toThrow(
      'No active MLX session found for model: foo'
    )
  })

  it('throws when the process is not running', async () => {
    const ext = newExt()
    mockFindSession.mockResolvedValue({
      pid: 5,
      port: 1,
      model_id: 'foo',
    } as never)
    mockIsRunning.mockResolvedValue(false)
    await expect(ext.chat({ model: 'foo' })).rejects.toThrow(
      'MLX model has crashed! Please reload!'
    )
    expect(mockIsRunning).toHaveBeenCalledWith(5)
  })
})

describe('isVisionSupported', () => {
  it('returns false when config.json is missing', async () => {
    const ext = newExt()
    mockFileStat.mockResolvedValue({ isDirectory: true })
    mockExistsSync.mockResolvedValue(false)
    expect(await ext.isVisionSupported('/model/dir')).toBe(false)
  })

  it('detects vision from a VLM architecture name', async () => {
    const ext = newExt()
    mockFileStat.mockResolvedValue({ isDirectory: true })
    mockExistsSync.mockResolvedValue(true)
    mockReadFileSync.mockResolvedValue(
      JSON.stringify({ architectures: ['Qwen2VLForConditionalGeneration'] })
    )
    expect(await ext.isVisionSupported('/model/dir')).toBe(true)
    expect(mockReadFileSync).toHaveBeenCalledWith('/model/dir/config.json')
  })

  it('detects vision from vision_config', async () => {
    const ext = newExt()
    mockFileStat.mockResolvedValue({ isDirectory: true })
    mockExistsSync.mockResolvedValue(true)
    mockReadFileSync.mockResolvedValue(
      JSON.stringify({ architectures: ['LlamaForCausalLM'], vision_config: {} })
    )
    expect(await ext.isVisionSupported('/model/dir')).toBe(true)
  })

  it('returns false for a plain text model', async () => {
    const ext = newExt()
    mockFileStat.mockResolvedValue({ isDirectory: true })
    // config.json exists, extra config files do not
    mockExistsSync.mockImplementation(async (p: string) =>
      p.endsWith('config.json') && !p.includes('image') && !p.includes('preprocessor')
    )
    mockReadFileSync.mockResolvedValue(
      JSON.stringify({ architectures: ['LlamaForCausalLM'] })
    )
    expect(await ext.isVisionSupported('/model/dir')).toBe(false)
  })
})

describe('isToolSupported', () => {
  it('detects tools from GGUF chat template metadata', async () => {
    const ext = newExt()
    mockReadYaml.mockResolvedValue({ model_path: '/abs/model.gguf' })
    mockReadGguf.mockResolvedValue({
      metadata: { 'tokenizer.chat_template': 'you may use tools here' },
    })
    expect(await ext.isToolSupported('foo')).toBe(true)
  })

  it('returns false when GGUF chat template has no tools', async () => {
    const ext = newExt()
    mockReadYaml.mockResolvedValue({ model_path: '/abs/model.gguf' })
    mockReadGguf.mockResolvedValue({
      metadata: { 'tokenizer.chat_template': 'plain template' },
    })
    expect(await ext.isToolSupported('foo')).toBe(false)
  })

  it('detects tools from a safetensors tokenizer_config.json', async () => {
    const ext = newExt()
    mockReadYaml.mockResolvedValue({ model_path: '/abs/model.safetensors' })
    mockReadFileSync.mockResolvedValue(
      JSON.stringify({ chat_template: 'uses tool_use blocks' })
    )
    mockExistsSync.mockImplementation(async (p: string) =>
      p.endsWith('tokenizer_config.json')
    )
    expect(await ext.isToolSupported('foo')).toBe(true)
    expect(mockReadFileSync).toHaveBeenCalledWith('/abs/tokenizer_config.json')
  })
})

describe('getRandomPort', () => {
  it('returns the port picked by the plugin', async () => {
    const ext = newExt()
    vi.mocked(getMlxRandomPort).mockResolvedValue(4321)
    expect(await ext.getRandomPort()).toBe(4321)
  })

  it('throws a readable error when no port is available', async () => {
    const ext = newExt()
    vi.mocked(getMlxRandomPort).mockRejectedValue('none')
    await expect(ext.getRandomPort()).rejects.toThrow(
      'Unable to find a suitable port for MLX model'
    )
  })
})

describe('update', () => {
  it('moves the model folder and rewrites model.yml with the new path', async () => {
    const ext = newExt()
    mockReadYaml.mockResolvedValue({
      name: 'foo',
      model_path: 'mlx/models/foo/model.safetensors',
    })
    mockExistsSync.mockResolvedValue(false)
    vi.mocked(fs.mv).mockResolvedValue(undefined)

    await ext.update('foo', { id: 'bar' })
    expect(mockReadYaml).toHaveBeenCalledWith('/data/mlx/models/foo/model.yml')
    expect(mockWriteYaml).toHaveBeenCalledWith('/data/mlx/models/bar/model.yml', {
      name: 'foo',
      model_path: 'mlx/models/bar/model.safetensors',
    })
  })
})

describe('pauseImport / abortImport', () => {
  const downloads = () => ({
    pauseDownload: vi.fn().mockResolvedValue(undefined),
    cancelDownload: vi.fn().mockResolvedValue(undefined),
  })

  it('pauses the task through the host Downloads service', async () => {
    const service = downloads()
    const getService = vi.fn().mockReturnValue(service)
    hostServices.get = getService
    await newExt().pauseImport('m1')
    expect(getService).toHaveBeenCalledWith(ServiceKeys.Downloads)
    expect(service.pauseDownload).toHaveBeenCalledWith('mlx/m1')
  })

  it('cancels the task through the host Downloads service', async () => {
    mockExistsSync.mockResolvedValue(false)
    const service = downloads()
    hostServices.get = vi.fn().mockReturnValue(service)
    await newExt().abortImport('m1')
    expect(service.cancelDownload).toHaveBeenCalledWith('mlx/m1')
  })

  it('fails loudly when no Downloads service is provided', async () => {
    hostServices.get = vi.fn().mockReturnValue(undefined)
    await expect(newExt().pauseImport('m1')).rejects.toThrow(
      'Downloads service is not available'
    )
  })
})

describe('activate', () => {
  type Disposable = { dispose(): void }

  function fakeContext() {
    const disposables: Disposable[] = []
    const provided = new Map<string, unknown>()
    const unregister = vi.fn()
    const engines = { register: vi.fn().mockReturnValue({ dispose: unregister }) }
    const services = {
      get: vi.fn((key: { id: string }) => provided.get(key.id)),
      provide: vi.fn((key: { id: string }, impl: unknown) => {
        provided.set(key.id, impl)
        return { dispose: () => provided.delete(key.id) }
      }),
    }
    const ctx = {
      subscriptions: {
        add: <T extends Disposable>(d: T) => (disposables.push(d), d),
      },
      internal: { services, engines },
    } as unknown as InternalExtensionContext
    const deactivate = () => disposables.splice(0).reverse().forEach((d) => d.dispose())
    return { ctx, engines, unregister, provided, deactivate }
  }

  it('registers the engine and provides the mlx service it backs', async () => {
    const fake = fakeContext()
    await activate(fake.ctx)
    const engine = fake.engines.register.mock.calls[0][0]
    expect(engine).toBeInstanceOf(mlx_extension)
    expect(engine.provider).toBe('mlx')
    engine.onSettingUpdate('ctx_size', 2048)
    mockUnload.mockResolvedValue({ success: true })
    mockFindSession.mockResolvedValue({ pid: 7 } as never)
    const service = fake.provided.get(ServiceKeys.Mlx.id) as {
      getModelProps(id: string): Promise<unknown>
      unload(id: string): Promise<unknown>
      findSession(id: string): Promise<unknown>
    }
    await expect(service.getModelProps('m')).resolves.toEqual({
      nCtx: 2048,
      modelAlias: 'm',
    })
    await service.unload('m')
    expect(mockFindSession).toHaveBeenCalledWith('m')
    mockFindSession.mockResolvedValueOnce(null)
    await expect(service.findSession('gone')).resolves.toBeNull()
    expect(mockFindSession).toHaveBeenCalledWith('gone')
  })

  it('reaches the Downloads service through the host registry', async () => {
    const fake = fakeContext()
    const downloads = { pauseDownload: vi.fn().mockResolvedValue(undefined) }
    fake.provided.set(ServiceKeys.Downloads.id, downloads)
    await activate(fake.ctx)
    await fake.engines.register.mock.calls[0][0].pauseImport('m1')
    expect(downloads.pauseDownload).toHaveBeenCalledWith('mlx/m1')
  })

  it('unregisters the engine and withdraws the service on deactivation', async () => {
    const fake = fakeContext()
    await activate(fake.ctx)
    fake.deactivate()
    expect(fake.unregister).toHaveBeenCalled()
    expect(fake.provided.has(ServiceKeys.Mlx.id)).toBe(false)
  })
})

describe('settings', () => {
  const KEY = '@janhq/mlx-extension'
  const defaults = () => [
    {
      key: 'auto_unload',
      title: 'Auto unload',
      description: '',
      controllerType: 'checkbox',
      controllerProps: { value: true },
    },
    {
      key: 'timeout',
      title: 'Timeout',
      description: '',
      controllerType: 'input',
      controllerProps: { value: 600 },
    },
  ]

  beforeEach(() => {
    localStorage.clear()
    ;(globalThis as any).SETTINGS = defaults()
  })

  it('keeps the values a previous run stored under the package name', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ key: 'auto_unload', controllerProps: { value: false } }])
    )
    const ext = newExt()
    await ext.start()
    expect(ext.autoUnload).toBe(false)
    expect(ext.timeout).toBe(600)
    const saved = await ext.getSettings()
    expect(saved.map((s: any) => [s.key, s.controllerProps.value])).toEqual([
      ['auto_unload', false],
      ['timeout', 600],
    ])
    expect(saved[0].extensionName).toBe(KEY)
  })

  it('stores updates and applies them to the running engine', async () => {
    const ext = newExt()
    await ext.start()
    await ext.updateSettings([{ key: 'timeout', controllerProps: { value: 30 } }])
    expect(ext.timeout).toBe(30)
    expect(JSON.parse(localStorage.getItem(KEY)!)[1].controllerProps.value).toBe(30)
  })
})
