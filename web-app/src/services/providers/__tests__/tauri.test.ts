import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [
    {
      provider: 'openai',
      active: false,
      base_url: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-4', name: 'GPT-4' }],
    },
  ],
}))

vi.mock('@/constants/models', () => ({
  providerModels: {
    openai: {
      models: ['gpt-4', 'gpt-3.5-turbo'],
    },
  },
}))

vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
  SettingComponentProps: {},
}))

vi.mock('@/types/models', () => ({
  ModelCapabilities: {
    TOOLS: 'tools',
    EMBEDDINGS: 'embeddings',
  },
}))

vi.mock('@/lib/predefined', () => ({
  modelSettings: {
    temperature: {
      key: 'temperature',
      controller_props: { value: 0.7 },
    },
    ctx_len: {
      key: 'ctx_len',
      controller_props: { value: 4096 },
    },
  },
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

vi.mock('@/lib/models', () => ({
  getModelCapabilities: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteApiKeyChain: vi.fn().mockReturnValue([]),
}))

import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { EngineManager } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import { TauriProvidersService } from '../tauri'

describe('TauriProvidersService', () => {
  let svc: TauriProvidersService

  beforeEach(() => {
    vi.clearAllMocks()
    svc = new TauriProvidersService()
  })

  describe('fetch', () => {
    it('returns Tauri fetch', () => {
      expect(svc.fetch()).toBe(fetchTauri)
    })
  })

  describe('getProviders', () => {
    it('returns builtin + runtime providers on success', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([
          { id: 'local-model', name: 'Local', description: 'desc' },
        ]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockResolvedValue(false),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['llama.cpp', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      expect(result.length).toBeGreaterThan(0)
      // Runtime provider first, then builtins
      const llama = result.find((p: any) => p.provider === 'llama.cpp')
      expect(llama).toBeDefined()
      expect(llama!.models).toHaveLength(1)
    })

    it('skips hidden providers (foundation-models)', async () => {
      const hiddenEngine = { list: vi.fn(), getSettings: vi.fn() }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['foundation-models', hiddenEngine]]),
      } as any)

      const result = await svc.getProviders()
      expect(hiddenEngine.list).not.toHaveBeenCalled()
      // Only builtins
      expect(result.every((p: any) => p.provider !== 'foundation-models')).toBe(true)
    })

    it('adds TOOLS capability when isToolSupported returns true', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([{ id: 'm1', name: 'M1', description: '' }]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockResolvedValue(true),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['test-engine', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      const provider = result.find((p: any) => p.provider === 'test-engine')
      expect(provider!.models[0].capabilities).toContain('tools')
    })

    it('adds EMBEDDINGS capability for embedding models', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([{ id: 'emb', name: 'Emb', description: '', embedding: true }]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockResolvedValue(false),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['emb-engine', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      const provider = result.find((p: any) => p.provider === 'emb-engine')
      expect(provider!.models[0].capabilities).toContain('embeddings')
    })

    it('warns but continues when isToolSupported throws', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([{ id: 'm1', name: 'M1', description: '' }]),
        getSettings: vi.fn().mockResolvedValue([]),
        isToolSupported: vi.fn().mockRejectedValue(new Error('fail')),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['test-engine', mockEngine]]),
      } as any)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await svc.getProviders()
      expect(result.find((p: any) => p.provider === 'test-engine')).toBeDefined()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('returns empty array on top-level error', async () => {
      vi.mocked(EngineManager.instance).mockImplementation(() => {
        throw new Error('boom')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await svc.getProviders()
      expect(result).toEqual([])
      errSpy.mockRestore()
    })

    it('maps engine settings correctly', async () => {
      const mockEngine = {
        list: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue([
          { key: 'api_key', title: 'API Key', description: 'Key', controllerType: 'input', controllerProps: {} },
        ]),
        inferenceUrl: 'http://localhost:1337/chat/completions',
      }
      vi.mocked(EngineManager.instance).mockReturnValue({
        engines: new Map([['test', mockEngine]]),
      } as any)

      const result = await svc.getProviders()
      const provider = result.find((p: any) => p.provider === 'test')
      expect(provider!.settings).toEqual([
        { key: 'api_key', title: 'API Key', description: 'Key', controller_type: 'input', controller_props: {} },
      ])
    })
  })

  describe('fetchModelsFromProvider', () => {
    const baseProvider = {
      provider: 'test-provider',
      base_url: 'https://api.test.com/v1',
      active: false,
    } as any

    it('throws if no base_url', async () => {
      await expect(svc.fetchModelsFromProvider({ ...baseProvider, base_url: '' }))
        .rejects.toThrow('Provider must have base_url configured')
    })

    it('returns model ids from data.data format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [{ id: 'model-1' }, { id: 'model-2' }] }),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['model-1', 'model-2'])
    })

    it('returns model ids from array format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['a', 'b'])
    })

    it('returns model ids from data.models format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ models: ['m1', 'm2'] }),
      } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['m1', 'm2'])
    })

    it('throws structured error for unexpected response format', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ unexpected: true }),
      } as any)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider)).rejects.toThrow(
        'Unexpected response format from test-provider'
      )
      warnSpy.mockRestore()
    })

    it('throws structured error on 401', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Authentication failed')
      errSpy.mockRestore()
    })

    it('throws structured error on 403', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Access forbidden')
      errSpy.mockRestore()
    })

    it('throws structured error on 404', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Models endpoint not found')
      errSpy.mockRestore()
    })

    it('throws generic error on other status codes', async () => {
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Failed to fetch models from')
      errSpy.mockRestore()
    })

    it('throws connection error on fetch failure', async () => {
      vi.mocked(fetchTauri).mockRejectedValueOnce(new Error('fetch failed'))

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Cannot connect to')
      errSpy.mockRestore()
    })

    it('throws generic fallback for non-fetch errors', async () => {
      vi.mocked(fetchTauri).mockRejectedValueOnce(new Error('something else'))

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.fetchModelsFromProvider(baseProvider))
        .rejects.toThrow('Unexpected error')
      errSpy.mockRestore()
    })

    it('adds Origin header for localhost URLs', async () => {
      const localProvider = { ...baseProvider, base_url: 'http://localhost:1234' }
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as any)

      await svc.fetchModelsFromProvider(localProvider)
      expect(fetchTauri).toHaveBeenCalledWith(
        'http://localhost:1234/models',
        expect.objectContaining({
          headers: expect.objectContaining({ Origin: 'tauri://localhost' }),
        })
      )
    })

    it('adds auth headers when api key is available', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['sk-test'])
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as any)

      await svc.fetchModelsFromProvider(baseProvider)
      expect(fetchTauri).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-test',
            Authorization: 'Bearer sk-test',
          }),
        })
      )
    })

    it('retries with next key on 401 and succeeds', async () => {
      vi.mocked(providerRemoteApiKeyChain).mockReturnValue(['bad-key', 'good-key'])
      vi.mocked(fetchTauri)
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauth' } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ data: [{ id: 'x' }] }),
        } as any)

      const result = await svc.fetchModelsFromProvider(baseProvider)
      expect(result).toEqual(['x'])
      expect(fetchTauri).toHaveBeenCalledTimes(2)
    })

    it('applies custom headers from provider', async () => {
      const customProvider = {
        ...baseProvider,
        custom_header: [{ header: 'X-Custom', value: 'val' }],
      }
      vi.mocked(fetchTauri).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as any)

      await svc.fetchModelsFromProvider(customProvider)
      expect(fetchTauri).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Custom': 'val' }),
        })
      )
    })
  })

  describe('updateSettings', () => {
    it('delegates to engine updateSettings', async () => {
      const mockUpdate = vi.fn()
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        getEngine: vi.fn().mockReturnValue({ updateSettings: mockUpdate }),
      } as any)

      await svc.updateSettings('test', [
        { key: 'k', controller_type: 'input', controller_props: { value: 'v' } } as any,
      ])

      expect(mockUpdate).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'k',
          controllerType: 'input',
          controllerProps: { value: 'v' },
        }),
      ])
    })

    it('defaults value to empty string when undefined', async () => {
      const mockUpdate = vi.fn()
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        getEngine: vi.fn().mockReturnValue({ updateSettings: mockUpdate }),
      } as any)

      await svc.updateSettings('test', [
        { key: 'k', controller_type: 'input', controller_props: {} } as any,
      ])

      expect(mockUpdate).toHaveBeenCalledWith([
        expect.objectContaining({
          controllerProps: { value: '' },
        }),
      ])
    })

    it('rethrows on error', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        getEngine: vi.fn().mockReturnValue({
          updateSettings: vi.fn().mockRejectedValue(new Error('fail')),
        }),
      } as any)

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.updateSettings('test', [])).rejects.toThrow('fail')
      errSpy.mockRestore()
    })
  })
})
