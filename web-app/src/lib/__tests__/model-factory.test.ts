import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory } from '../model-factory'
import type { ProviderObject } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock the Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

// Mock the AI SDK providers
const mockLanguageModel = vi.fn(() => ({ type: 'openai-compatible' }))
const mockCreateOpenAICompatible = vi.fn(() => ({
  languageModel: mockLanguageModel,
}))

vi.mock('@ai-sdk/openai-compatible', () => {
  const MockChatModel = vi.fn().mockImplementation(() => ({
    type: 'foundation-models',
    modelId: 'apple/on-device',
  }))
  return {
    createOpenAICompatible: mockCreateOpenAICompatible,
    OpenAICompatibleChatLanguageModel: MockChatModel,
    MetadataExtractor: vi.fn(),
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ type: 'google' }))),
}))

vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn(({ model }) => model),
  extractReasoningMiddleware: vi.fn(() => ({})),
}))

const mockStartModel = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        models: () => ({ startModel: mockStartModel }),
      },
    }),
  },
}))

const mockedInvoke = vi.mocked(invoke)

describe('ModelFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStartModel.mockResolvedValue(undefined)
  })

  describe('createModel', () => {
    it('should create an Anthropic model for anthropic provider', async () => {
      const provider: ProviderObject = {
        provider: 'anthropic',
        api_key: 'test-api-key',
        base_url: 'https://api.anthropic.com/v1',
        models: [],
        settings: [],
        active: true,
        custom_header: [
          { header: 'anthropic-version', value: '2023-06-01' },
        ],
      }

      const model = await ModelFactory.createModel('claude-3-opus', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('anthropic')
    })

    it('should create a Google model for google provider', async () => {
      const provider: ProviderObject = {
        provider: 'google',
        api_key: 'test-api-key',
        base_url: 'https://generativelanguage.googleapis.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gemini-pro', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create a Google model for gemini provider', async () => {
      const provider: ProviderObject = {
        provider: 'gemini',
        api_key: 'test-api-key',
        base_url: 'https://generativelanguage.googleapis.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gemini-pro', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create an OpenAI-compatible model for openai provider', async () => {
      const provider: ProviderObject = {
        provider: 'openai',
        api_key: 'test-api-key',
        base_url: 'https://api.openai.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gpt-4', provider)
      expect(model).toBeDefined()
    })

    it('should create an OpenAI-compatible model for groq provider', async () => {
      const provider: ProviderObject = {
        provider: 'groq',
        api_key: 'test-api-key',
        base_url: 'https://api.groq.com/openai/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('llama-3', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create an OpenAI-compatible model for minimax provider', async () => {
      const provider: ProviderObject = {
        provider: 'minimax',
        api_key: 'test-api-key',
        base_url: 'https://api.minimax.io/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('MiniMax-M2.7', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should handle custom headers for OpenAI-compatible providers', async () => {
      const provider: ProviderObject = {
        provider: 'custom',
        api_key: 'test-api-key',
        base_url: 'https://custom.api.com/v1',
        models: [],
        settings: [],
        active: true,
        custom_header: [
          { header: 'X-Custom-Header', value: 'custom-value' },
        ],
      }

      const model = await ModelFactory.createModel('custom-model', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })
  })

  describe('foundation-models provider', () => {
    const foundationModelsProvider: ProviderObject = {
      provider: 'foundation-models',
      models: [],
      settings: [],
      active: true,
    }

    it('should throw with notEligible message when device is not eligible', async () => {
      mockedInvoke.mockResolvedValueOnce('notEligible')

      await expect(
        ModelFactory.createModel('apple/on-device', foundationModelsProvider)
      ).rejects.toThrow(
        'Apple Intelligence is not supported on this device. An Apple Silicon Mac (M1 or later) with macOS 26+ is required.'
      )

      expect(mockedInvoke).toHaveBeenCalledWith(
        'plugin:foundation-models|check_foundation_models_availability',
        {}
      )
    })

    it('should throw when Apple Intelligence is not enabled', async () => {
      mockedInvoke.mockResolvedValueOnce('appleIntelligenceNotEnabled')

      await expect(
        ModelFactory.createModel('apple/on-device', foundationModelsProvider)
      ).rejects.toThrow(
        'Apple Intelligence is not enabled. Please enable it in System Settings > Apple Intelligence & Siri.'
      )
    })

    it('should throw when the model is not ready', async () => {
      mockedInvoke.mockResolvedValueOnce('modelNotReady')

      await expect(
        ModelFactory.createModel('apple/on-device', foundationModelsProvider)
      ).rejects.toThrow(
        'The Apple on-device model is still preparing. Please wait and try again shortly.'
      )
    })

    it('should throw when the server binary is missing', async () => {
      mockedInvoke.mockResolvedValueOnce('binaryNotFound')

      await expect(
        ModelFactory.createModel('apple/on-device', foundationModelsProvider)
      ).rejects.toThrow(
        'Apple Foundation Models are currently unavailable on this device.'
      )
    })

    it('should throw with generic unavailable message for unknown status', async () => {
      mockedInvoke.mockResolvedValueOnce('unavailable')

      await expect(
        ModelFactory.createModel('apple/on-device', foundationModelsProvider)
      ).rejects.toThrow(
        'Apple Foundation Models are currently unavailable on this device.'
      )
    })

    it('should throw when available but model is not loaded after start', async () => {
      mockedInvoke
        .mockResolvedValueOnce('available') // check_foundation_models_availability
        .mockResolvedValueOnce(false)       // is_foundation_models_loaded

      await expect(
        ModelFactory.createModel('apple/on-device', foundationModelsProvider)
      ).rejects.toThrow(
        'No running Foundation Models session. The model may have failed to load — please check the logs.'
      )

      expect(mockStartModel).toHaveBeenCalledWith(
        foundationModelsProvider,
        'apple/on-device'
      )
      expect(mockedInvoke).toHaveBeenCalledWith(
        'plugin:foundation-models|check_foundation_models_availability',
        {}
      )
      expect(mockedInvoke).toHaveBeenCalledWith(
        'plugin:foundation-models|is_foundation_models_loaded',
        {}
      )
    })

    it('should create a model when available and model is loaded', async () => {
      mockedInvoke
        .mockResolvedValueOnce('available') // check_foundation_models_availability
        .mockResolvedValueOnce(true)        // is_foundation_models_loaded

      const model = await ModelFactory.createModel(
        'apple/on-device',
        foundationModelsProvider
      )

      expect(model).toBeDefined()
      expect(mockStartModel).toHaveBeenCalledWith(
        foundationModelsProvider,
        'apple/on-device'
      )
      expect(mockedInvoke).toHaveBeenCalledWith(
        'plugin:foundation-models|check_foundation_models_availability',
        {}
      )
      expect(mockedInvoke).toHaveBeenCalledWith(
        'plugin:foundation-models|is_foundation_models_loaded',
        {}
      )
    })
  })

  describe('Cerebras provider', () => {
    const cerebrasProvider: ProviderObject = {
      provider: 'cerebras',
      api_key: 'test-cerebras-key',
      base_url: 'https://api.cerebras.ai/v1',
      models: [],
      settings: [],
      active: true,
    }

    beforeEach(() => {
      mockCreateOpenAICompatible.mockClear()
      mockLanguageModel.mockClear()
    })

    it('should route cerebras provider to createCerebrasModel', async () => {
      const model = await ModelFactory.createModel(
        'llama3.1-8b',
        cerebrasProvider
      )
      expect(model).toBeDefined()
      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
        expect.objectContaining({ includeUsage: false })
      )
    })

    it('should set includeUsage: false to prevent stream_options injection', async () => {
      await ModelFactory.createModel('llama3.1-8b', cerebrasProvider)
      const callArgs = mockCreateOpenAICompatible.mock.calls[0][0]
      expect(callArgs.includeUsage).toBe(false)
    })

    it('should strip top_k from request parameters', async () => {
      await ModelFactory.createModel('llama3.1-8b', cerebrasProvider, {
        top_k: 20,
        temperature: 0.7,
      })
      // createCustomFetch is called with the filtered params — verify top_k absent
      const callArgs = mockCreateOpenAICompatible.mock.calls[0][0]
      // The fetch wrapper receives filtered params; top_k must not be present
      expect(callArgs).not.toMatchObject({ top_k: 20 })
    })

    it('should strip repeat_penalty from request parameters', async () => {
      await ModelFactory.createModel('llama3.1-8b', cerebrasProvider, {
        repeat_penalty: 1.12,
        temperature: 0.7,
      })
      const callArgs = mockCreateOpenAICompatible.mock.calls[0][0]
      expect(callArgs).not.toMatchObject({ repeat_penalty: 1.12 })
    })

    it('should preserve supported parameters like temperature and top_p', async () => {
      await ModelFactory.createModel('llama3.1-8b', cerebrasProvider, {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 20,
      })
      expect(mockCreateOpenAICompatible).toHaveBeenCalledTimes(1)
      // Model is still created successfully with valid params
      expect(mockLanguageModel).toHaveBeenCalledWith('llama3.1-8b')
    })
  })
})
