import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory, cleanUpstreamErrorMessage } from '../model-factory'
import type { ProviderObject } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const mockGlobalFetch = vi.fn()

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
    type: 'openai-compatible-chat',
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
  createGoogleGenerativeAI: vi.fn((cfg: any) => {
    ;(globalThis as any).__capturedGoogleCfg = cfg
    return vi.fn(() => ({ type: 'google' }))
  }),
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
const mockedCreateOpenAICompatible = vi.mocked(createOpenAICompatible)

describe('ModelFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStartModel.mockResolvedValue(undefined)
    mockGlobalFetch.mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', mockGlobalFetch)
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

    it('routes google and gemini through the native @ai-sdk/google client and strips the /openai suffix', async () => {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      for (const name of ['google', 'gemini'] as const) {
        vi.mocked(createGoogleGenerativeAI).mockClear()
        const provider: ProviderObject = {
          provider: name,
          api_key: 'test-api-key',
          base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
          models: [],
          settings: [],
          active: true,
        }

        const model = await ModelFactory.createModel('gemini-2.5-flash', provider)
        expect(model).toEqual({ type: 'google' })
        expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: 'test-api-key',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta',
          })
        )
      }
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

})

describe('cleanUpstreamErrorMessage', () => {
  it('extracts the final "Error:" line from a Jinja stack trace', () => {
    const raw =
      "\n------------\nWhile executing CallExpression at line 1, column 226 in source:\n...op.index0 % 2 == 0) %}{{ raise_exception('Conversation roles must alternate user...\n                                           ^\nError: Jinja Exception: Conversation roles must alternate user/assistant/user/assistant/..."
    expect(cleanUpstreamErrorMessage(raw)).toBe(
      'Jinja Exception: Conversation roles must alternate user/assistant/user/assistant/...'
    )
  })

  it('passes through a clean message unchanged', () => {
    const raw =
      'Unable to generate parser for this template. Automatic parser generation failed: JSON schema conversion failed: Unrecognized schema: "string"'
    expect(cleanUpstreamErrorMessage(raw)).toBe(raw)
  })

  it('strips a leading rule and "While executing" prelude when no Error: line exists', () => {
    const raw =
      '------------\nWhile executing X at line 1:\n bad stuff here\n         ^\nsomething broke'
    expect(cleanUpstreamErrorMessage(raw)).toBe('something broke')
  })

  it('returns non-string inputs as-is', () => {
    // @ts-expect-error intentional misuse
    expect(cleanUpstreamErrorMessage(null)).toBe(null)
  })
})
