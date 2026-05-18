import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ModelFactory,
  cleanUpstreamErrorMessage,
  createCustomFetch,
} from '../model-factory'
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

describe('createCustomFetch — max_tokens coercion', () => {
  async function captureSentBody(
    parameters: Record<string, unknown>,
    keepLlamacppOnly: boolean,
    bodyIn: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const seen: { body?: string } = {}
    const baseFetch: typeof globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      seen.body = typeof init?.body === 'string' ? init.body : ''
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch
    const wrapped = createCustomFetch(baseFetch, parameters, keepLlamacppOnly)
    await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(bodyIn),
    })
    return JSON.parse(seen.body ?? '{}') as Record<string, unknown>
  }

  it('coerces max_tokens=0 to -1 when keepLlamacppOnly is true', async () => {
    const sent = await captureSentBody({}, true, { max_tokens: 0 })
    expect(sent.max_tokens).toBe(-1)
  })

  it('does not coerce when keepLlamacppOnly is false (non-llamacpp providers)', async () => {
    const sent = await captureSentBody({}, false, { max_tokens: 0 })
    expect(sent.max_tokens).toBe(0)
  })

  it('leaves non-zero max_tokens alone', async () => {
    const sent = await captureSentBody({}, true, { max_tokens: 512 })
    expect(sent.max_tokens).toBe(512)
  })

  it('coerces max_tokens=0 even when it comes from injected parameters via max_output_tokens', async () => {
    const sent = await captureSentBody(
      { max_output_tokens: 0 },
      true,
      { messages: [] }
    )
    expect(sent.max_tokens).toBe(-1)
  })
})

describe('createCustomFetch — llamacpp 500 handling', () => {
  function fetchReturning(
    status: number,
    body: string,
    contentType = 'application/json'
  ): typeof globalThis.fetch {
    return (async () =>
      new Response(body, {
        status,
        statusText: status === 500 ? 'Internal Server Error' : 'OK',
        headers: { 'content-type': contentType },
      })) as typeof globalThis.fetch
  }

  it('synthesizes an llamacpp error body when llamacpp returns 500 with empty body', async () => {
    const onErr = vi.fn()
    const wrapped = createCustomFetch(
      fetchReturning(500, '', 'text/plain'),
      {},
      true,
      onErr
    )
    const res = await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('application/json')
    const parsed = await res.json()
    expect(parsed.error.message).toMatch(/model crashed and is being reloaded/i)
    expect(parsed.error.message).not.toMatch(/500|Internal Server Error|llama-server/i)
    expect(parsed.error.type).toBe('llamacpp_server_error')
    expect(onErr).toHaveBeenCalledTimes(1)
  })

  it('triggers the reload callback on llamacpp 500 even when the body parses', async () => {
    const onErr = vi.fn()
    const body = JSON.stringify({
      error: { code: 500, message: 'some inner crash', type: 'server_error' },
    })
    const wrapped = createCustomFetch(fetchReturning(500, body), {}, true, onErr)
    await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })
    expect(onErr).toHaveBeenCalledTimes(1)
  })

  it('does not trigger the reload callback or synthesize a body for non-llamacpp 500', async () => {
    const onErr = vi.fn()
    const wrapped = createCustomFetch(
      fetchReturning(500, '', 'text/plain'),
      {},
      false,
      onErr
    )
    const res = await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })
    expect(onErr).not.toHaveBeenCalled()
    expect(res.headers.get('content-type')).toBe('text/plain')
  })

  it('does not trigger the reload callback on llamacpp non-500 errors (e.g. 400)', async () => {
    const onErr = vi.fn()
    const body = JSON.stringify({
      error: { code: 400, message: 'bad request', type: 'invalid_request' },
    })
    const wrapped = createCustomFetch(fetchReturning(400, body), {}, true, onErr)
    await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })
    expect(onErr).not.toHaveBeenCalled()
  })
})
