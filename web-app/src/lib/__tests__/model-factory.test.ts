import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory } from '../model-factory'
import type { ProviderObject } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock the Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

// Mock the AI SDK providers
vi.mock('@ai-sdk/openai-compatible', () => {
  const MockChatModel = vi.fn().mockImplementation(() => ({
    type: 'foundation-models',
    modelId: 'apple/on-device',
  }))
  return {
    createOpenAICompatible: vi.fn(() => ({
      languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
    })),
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
const mockedCreateGoogleGenerativeAI = vi.mocked(createGoogleGenerativeAI)
const mockedCreateOpenAICompatible = vi.mocked(createOpenAICompatible)

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
      expect(model.type).toBe('google')
      expect(mockedCreateGoogleGenerativeAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://generativelanguage.googleapis.com/v1',
        headers: undefined,
      })
      expect(mockedCreateOpenAICompatible).not.toHaveBeenCalled()
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
      expect(model.type).toBe('google')
      expect(mockedCreateGoogleGenerativeAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://generativelanguage.googleapis.com/v1',
        headers: undefined,
      })
      expect(mockedCreateOpenAICompatible).not.toHaveBeenCalled()
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
})
