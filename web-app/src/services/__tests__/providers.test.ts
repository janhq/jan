import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getProviders,
  fetchModelsFromProvider,
  updateSettings,
} from '../providers'
import { models as providerModels } from 'token.js'
import { predefinedProviders } from '@/mock/data'
import { EngineManager } from '@janhq/core'
import { fetchModels } from '../models'
import { ExtensionManager } from '@/lib/extension'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'

// Mock dependencies
vi.mock('token.js', () => ({
  models: {
    openai: {
      models: ['gpt-3.5-turbo', 'gpt-4'],
      supportsToolCalls: ['gpt-3.5-turbo', 'gpt-4'],
    },
  },
}))

vi.mock('@/mock/data', () => ({
  predefinedProviders: [
    {
      active: true,
      api_key: '',
      base_url: 'https://api.openai.com/v1',
      provider: 'openai',
      settings: [],
      models: [
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
        { id: 'gpt-4', name: 'GPT-4' },
      ],
    },
  ],
}))

vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: vi.fn(() => ({
      engines: new Map([
        [
          'llamacpp',
          {
            inferenceUrl: 'http://localhost:1337/chat/completions',
            getSettings: vi.fn(() =>
              Promise.resolve([
                {
                  key: 'apiKey',
                  title: 'API Key',
                  description: 'Your API key',
                  controllerType: 'input',
                  controllerProps: { value: '' },
                },
              ])
            ),
          },
        ],
      ]),
    })),
  },
}))

vi.mock('../models', () => ({
  fetchModels: vi.fn(() =>
    Promise.resolve([
      { id: 'llama-2-7b', name: 'Llama 2 7B', description: 'Llama model' },
    ])
  ),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(() => ({
      getEngine: vi.fn(),
    })),
  },
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('@/types/models', () => ({
  ModelCapabilities: {
    COMPLETION: 'completion',
    TOOLS: 'tools',
  },
  DefaultToolUseSupportedModels: {
    'gpt-4': 'gpt-4',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
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
      controller_props: { value: 2048 },
    },
  },
}))

describe('providers service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProviders', () => {
    it('should return builtin and runtime providers', async () => {
      const providers = await getProviders()

      expect(providers).toHaveLength(9) // 8 runtime + 1 builtin
      expect(providers.some((p) => p.provider === 'llamacpp')).toBe(true)
      expect(providers.some((p) => p.provider === 'openai')).toBe(true)
    })

    it('should map builtin provider models correctly', async () => {
      const providers = await getProviders()
      const openaiProvider = providers.find((p) => p.provider === 'openai')

      expect(openaiProvider).toBeDefined()
      expect(openaiProvider?.models).toHaveLength(2)
      expect(openaiProvider?.models[0].capabilities).toContain('completion')
      expect(openaiProvider?.models[0].capabilities).toContain('tools')
    })

    it('should create runtime providers from engine manager', async () => {
      const providers = await getProviders()
      const llamacppProvider = providers.find((p) => p.provider === 'llamacpp')

      expect(llamacppProvider).toBeDefined()
      expect(llamacppProvider?.base_url).toBe('http://localhost:1337')
      expect(llamacppProvider?.models).toHaveLength(1)
      expect(llamacppProvider?.settings).toHaveLength(1)
    })
  })

  describe('fetchModelsFromProvider', () => {
    it('should fetch models successfully with OpenAI format', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'gpt-3.5-turbo' }, { id: 'gpt-4' }],
        }),
      }
      vi.mocked(fetchTauri).mockResolvedValue(mockResponse as any)

      const provider = {
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        api_key: 'test-key',
      } as ModelProvider

      const models = await fetchModelsFromProvider(provider)

      expect(fetchTauri).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'test-key',
            'Authorization': 'Bearer test-key',
          },
        }
      )
      expect(models).toEqual(['gpt-3.5-turbo', 'gpt-4'])
    })

    it('should fetch models successfully with direct array format', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(['model1', 'model2']),
      }
      vi.mocked(fetchTauri).mockResolvedValue(mockResponse as any)

      const provider = {
        provider: 'custom',
        base_url: 'https://api.custom.com',
        api_key: '',
      } as ModelProvider

      const models = await fetchModelsFromProvider(provider)

      expect(models).toEqual(['model1', 'model2'])
    })

    it('should fetch models successfully with models array format', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          models: [{ id: 'model1' }, 'model2'],
        }),
      }
      vi.mocked(fetchTauri).mockResolvedValue(mockResponse as any)

      const provider = {
        provider: 'custom',
        base_url: 'https://api.custom.com',
      } as ModelProvider

      const models = await fetchModelsFromProvider(provider)

      expect(models).toEqual(['model1', 'model2'])
    })

    it('should throw error when provider has no base_url', async () => {
      const provider = {
        provider: 'custom',
      } as ModelProvider

      await expect(fetchModelsFromProvider(provider)).rejects.toThrow(
        'Provider must have base_url configured'
      )
    })

    it('should throw error when API response is not ok', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }
      vi.mocked(fetchTauri).mockResolvedValue(mockResponse as any)

      const provider = {
        provider: 'custom',
        base_url: 'https://api.custom.com',
      } as ModelProvider

      await expect(fetchModelsFromProvider(provider)).rejects.toThrow(
        'Cannot connect to custom at https://api.custom.com'
      )
    })

    it('should handle network errors gracefully', async () => {
      vi.mocked(fetchTauri).mockRejectedValue(new Error('fetch failed'))

      const provider = {
        provider: 'custom',
        base_url: 'https://api.custom.com',
      } as ModelProvider

      await expect(fetchModelsFromProvider(provider)).rejects.toThrow(
        'Cannot connect to custom at https://api.custom.com'
      )
    })

    it('should return empty array for unexpected response format', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ unexpected: 'format' }),
      }
      vi.mocked(fetchTauri).mockResolvedValue(mockResponse as any)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const provider = {
        provider: 'custom',
        base_url: 'https://api.custom.com',
      } as ModelProvider

      const models = await fetchModelsFromProvider(provider)

      expect(models).toEqual([])
      expect(consoleSpy).toHaveBeenCalledWith(
        'Unexpected response format from provider API:',
        { unexpected: 'format' }
      )

      consoleSpy.mockRestore()
    })
  })

  describe('updateSettings', () => {
    it('should update provider settings successfully', async () => {
      const mockEngine = {
        updateSettings: vi.fn().mockResolvedValue(undefined),
      }
      const mockExtensionManager = {
        getEngine: vi.fn().mockReturnValue(mockEngine),
      }
      vi.mocked(ExtensionManager.getInstance).mockReturnValue(
        mockExtensionManager
      )

      const settings = [
        {
          key: 'apiKey',
          title: 'API Key',
          description: 'Your API key',
          controller_type: 'input',
          controller_props: { value: 'test-key' },
        },
      ] as ProviderSetting[]

      await updateSettings('openai', settings)

      expect(mockExtensionManager.getEngine).toHaveBeenCalledWith('openai')
      expect(mockEngine.updateSettings).toHaveBeenCalledWith([
        {
          key: 'apiKey',
          title: 'API Key',
          description: 'Your API key',
          controller_type: 'input',
          controller_props: { value: 'test-key' },
          controllerType: 'input',
          controllerProps: { value: 'test-key' },
        },
      ])
    })

    it('should handle missing engine gracefully', async () => {
      const mockExtensionManager = {
        getEngine: vi.fn().mockReturnValue(null),
      }
      vi.mocked(ExtensionManager.getInstance).mockReturnValue(
        mockExtensionManager
      )

      const settings = [] as ProviderSetting[]

      const result = await updateSettings('nonexistent', settings)

      expect(result).toBeUndefined()
    })

    it('should handle settings with undefined values', async () => {
      const mockEngine = {
        updateSettings: vi.fn().mockResolvedValue(undefined),
      }
      const mockExtensionManager = {
        getEngine: vi.fn().mockReturnValue(mockEngine),
      }
      vi.mocked(ExtensionManager.getInstance).mockReturnValue(
        mockExtensionManager
      )

      const settings = [
        {
          key: 'apiKey',
          title: 'API Key',
          description: 'Your API key',
          controller_type: 'input',
          controller_props: { value: undefined },
        },
      ] as ProviderSetting[]

      await updateSettings('openai', settings)

      expect(mockEngine.updateSettings).toHaveBeenCalledWith([
        {
          key: 'apiKey',
          title: 'API Key',
          description: 'Your API key',
          controller_type: 'input',
          controller_props: { value: undefined },
          controllerType: 'input',
          controllerProps: { value: '' },
        },
      ])
    })
  })
})
