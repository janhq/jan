import { beforeEach, describe, expect, it, vi } from 'vitest'
import mlx_extension from './index'
import { fs, getJanDataFolderPath, events } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { unloadMlxModel } from '@janhq/tauri-plugin-mlx-api'
import { readGgufMetadata } from '@janhq/tauri-plugin-llamacpp-api'

const mockInvoke = vi.mocked(invoke)
const mockExistsSync = vi.mocked(fs.existsSync)
const mockRm = vi.mocked(fs.rm)
const mockFileStat = vi.mocked(fs.fileStat)
const mockJanData = vi.mocked(getJanDataFolderPath)
const mockUnload = vi.mocked(unloadMlxModel)
const mockReadGguf = vi.mocked(readGgufMetadata)

function newExt(): any {
  const ext = new mlx_extension() as any
  ext.providerPath = '/data/mlx'
  return ext
}

beforeEach(() => {
  vi.clearAllMocks()
  mockJanData.mockResolvedValue('/data')
})

describe('getProviderPath', () => {
  it('joins the jan data folder with the mlx dir and caches it', async () => {
    const ext = new mlx_extension() as any
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
    mockInvoke.mockResolvedValue({ size_bytes: 1234, embedding: true })

    const info = await ext.get('foo')
    expect(info).toEqual({
      id: 'foo',
      name: 'foo',
      providerId: 'mlx',
      port: 0,
      sizeBytes: 1234,
      embedding: true,
    })
  })

  it('prefers the configured name over the model id', async () => {
    const ext = newExt()
    mockExistsSync.mockResolvedValue(true)
    mockInvoke.mockResolvedValue({ name: 'Pretty Name' })

    const info = await ext.get('foo')
    expect(info.name).toBe('Pretty Name')
    expect(info.sizeBytes).toBe(0)
    expect(info.embedding).toBe(false)
  })
})

describe('getLoadedModels', () => {
  it('returns the plugin result', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue(['a', 'b'])
    expect(await ext.getLoadedModels()).toEqual(['a', 'b'])
    expect(mockInvoke).toHaveBeenCalledWith('plugin:mlx|get_mlx_loaded_models')
  })

  it('throws when the plugin call fails', async () => {
    const ext = newExt()
    mockInvoke.mockRejectedValue('boom')
    await expect(ext.getLoadedModels()).rejects.toThrow('boom')
  })
})

describe('unload', () => {
  it('throws when there is no active session', async () => {
    const ext = newExt()
    // findSessionByModel invokes plugin:mlx|find_mlx_session_by_model
    mockInvoke.mockResolvedValue(undefined)
    await expect(ext.unload('foo')).rejects.toThrow(
      'No active MLX session found for model: foo'
    )
  })

  it('returns the unload result on success', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue({ pid: 99, model_id: 'foo' })
    mockUnload.mockResolvedValue({ success: true })

    const result = await ext.unload('foo')
    expect(result).toEqual({ success: true })
    expect(mockUnload).toHaveBeenCalledWith(99)
  })

  it('returns a failure object when unload throws', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue({ pid: 99, model_id: 'foo' })
    mockUnload.mockRejectedValue(new Error('nope'))

    const result = await ext.unload('foo')
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})

describe('load', () => {
  it('throws when the model is already loaded', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue({ pid: 1, model_id: 'foo' })
    await expect(ext.load('foo')).rejects.toThrow('Model already loaded!')
  })

  it('deduplicates concurrent loads of the same model', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue(undefined)
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
    mockInvoke.mockResolvedValue({
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
    mockInvoke.mockResolvedValue({ model_path: '/abs/model/model.safetensors' })
    mockRm.mockResolvedValue(undefined)

    await ext.delete('foo')
    expect(mockRm).toHaveBeenCalledTimes(1)
    expect(mockRm).toHaveBeenCalledWith('/data/mlx/models/foo')
  })
})

describe('chat', () => {
  it('throws when no session is found', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue(undefined)
    await expect(ext.chat({ model: 'foo' })).rejects.toThrow(
      'No active MLX session found for model: foo'
    )
  })

  it('throws when the process is not running', async () => {
    const ext = newExt()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:mlx|find_mlx_session_by_model')
        return { pid: 5, port: 1, model_id: 'foo' }
      if (cmd === 'plugin:mlx|is_mlx_process_running') return false
      return undefined
    })
    await expect(ext.chat({ model: 'foo' })).rejects.toThrow(
      'MLX model has crashed! Please reload!'
    )
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
    mockInvoke.mockResolvedValue(
      JSON.stringify({ architectures: ['Qwen2VLForConditionalGeneration'] })
    )
    expect(await ext.isVisionSupported('/model/dir')).toBe(true)
  })

  it('detects vision from vision_config', async () => {
    const ext = newExt()
    mockFileStat.mockResolvedValue({ isDirectory: true })
    mockExistsSync.mockResolvedValue(true)
    mockInvoke.mockResolvedValue(
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
    mockInvoke.mockResolvedValue(
      JSON.stringify({ architectures: ['LlamaForCausalLM'] })
    )
    expect(await ext.isVisionSupported('/model/dir')).toBe(false)
  })
})

describe('isToolSupported', () => {
  it('detects tools from GGUF chat template metadata', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue({ model_path: '/abs/model.gguf' })
    mockReadGguf.mockResolvedValue({
      metadata: { 'tokenizer.chat_template': 'you may use tools here' },
    })
    expect(await ext.isToolSupported('foo')).toBe(true)
  })

  it('returns false when GGUF chat template has no tools', async () => {
    const ext = newExt()
    mockInvoke.mockResolvedValue({ model_path: '/abs/model.gguf' })
    mockReadGguf.mockResolvedValue({
      metadata: { 'tokenizer.chat_template': 'plain template' },
    })
    expect(await ext.isToolSupported('foo')).toBe(false)
  })

  it('detects tools from a safetensors tokenizer_config.json', async () => {
    const ext = newExt()
    mockInvoke.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'read_yaml') return { model_path: '/abs/model.safetensors' }
      if (cmd === 'read_file_sync')
        return JSON.stringify({ chat_template: 'uses tool_use blocks' })
      return undefined
    })
    mockExistsSync.mockImplementation(async (p: string) =>
      p.endsWith('tokenizer_config.json')
    )
    expect(await ext.isToolSupported('foo')).toBe(true)
  })
})
