/**
 * Deep coverage tests for model-factory.ts internal functions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn().mockImplementation(async () => new Response('{}', { status: 200 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

vi.mock('@ai-sdk/openai-compatible', () => {
  const MCM = vi.fn().mockImplementation((_id: string, opts: any) => {
    ;(globalThis as any).__capturedModelOpts = opts
    return { type: 'openai-compatible', modelId: _id }
  })
  return {
    createOpenAICompatible: vi.fn(() => ({
      languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
    })),
    OpenAICompatibleChatLanguageModel: MCM,
    MetadataExtractor: vi.fn(),
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn((config: any) => {
    ;(globalThis as any).__capturedGoogleCfg = config
    return vi.fn(() => ({ type: 'google' }))
  }),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((config: any) => {
    ;(globalThis as any).__capturedOpenAICfg = config
    const fn: any = vi.fn(() => ({ type: 'openai' }))
    fn.chat = vi.fn(() => ({ type: 'openai' }))
    return fn
  }),
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn((config: any) => {
    ;(globalThis as any).__capturedXaiCfg = config
    const fn: any = vi.fn(() => ({ type: 'xai-chat' }))
    fn.responses = vi.fn(() => ({ type: 'xai-responses' }))
    return fn
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
        models: () => ({ startModel: (...args: any[]) => mockStartModel(...args) }),
      },
    }),
  },
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn(() => false),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteApiKeyChain: vi.fn((p: any) => {
    const primary = p.api_key?.trim()
    const fallbacks = (p.api_key_fallbacks ?? [])
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0)
    return [...(primary ? [primary] : []), ...fallbacks]
  }),
}))

vi.mock('@/lib/xai-oauth', () => ({
  getXaiOAuthAccessToken: vi.fn().mockResolvedValue(null),
}))

import { ModelFactory } from '../model-factory'
import { invoke } from '@tauri-apps/api/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { createXai } from '@ai-sdk/xai'
import { getXaiOAuthAccessToken } from '@/lib/xai-oauth'

function getOpts(): any {
  return (globalThis as any).__capturedModelOpts
}

const mkProvider = (
  provider: string,
  overrides: Partial<ProviderObject> = {}
): ProviderObject =>
  ({
    provider,
    api_key: 'test-key',
    base_url: 'https://api.test.com/v1',
    ...overrides,
  }) as ProviderObject

describe('model-factory deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).__capturedModelOpts = null
    ;(globalThis as any).__capturedGoogleCfg = null
    ;(globalThis as any).__capturedOpenAICfg = null
    ;(globalThis as any).__capturedXaiCfg = null
    vi.mocked(getXaiOAuthAccessToken).mockResolvedValue(null)
    mockStartModel.mockResolvedValue(undefined)
  })

  /* providerMetadataExtractor */
  describe('providerMetadataExtractor', () => {
    async function getExtractor() {
      vi.mocked(invoke).mockResolvedValue({ port: 8080, api_key: 'k' })
      await ModelFactory.createModel('m', mkProvider('llamacpp'), {})
      return getOpts()?.metadataExtractor
    }

    it('extractMetadata returns timings when present', async () => {
      const ext = await getExtractor()
      const result = await ext.extractMetadata({
        parsedBody: {
          timings: { prompt_n: 10, predicted_n: 20, predicted_per_second: 50, prompt_per_second: 100 },
        },
      })
      expect(result.providerMetadata.promptTokens).toBe(10)
      expect(result.providerMetadata.completionTokens).toBe(20)
    })

    it('extractMetadata returns undefined when no timings', async () => {
      const ext = await getExtractor()
      expect(await ext.extractMetadata({ parsedBody: {} })).toBeUndefined()
    })

    it('extractMetadata handles missing fields in timings', async () => {
      const ext = await getExtractor()
      const result = await ext.extractMetadata({ parsedBody: { timings: {} } })
      expect(result.providerMetadata.promptTokens).toBeNull()
    })

    it('createStreamExtractor processes chunks and builds metadata', async () => {
      const ext = await getExtractor()
      const s = ext.createStreamExtractor()
      s.processChunk({ timings: { prompt_n: 5, predicted_n: 15, predicted_per_second: 35, prompt_per_second: 65 } })
      const meta = s.buildMetadata()
      expect(meta.providerMetadata.completionTokens).toBe(15)
    })

    it('createStreamExtractor returns undefined with no timings', async () => {
      const ext = await getExtractor()
      const s = ext.createStreamExtractor()
      s.processChunk({})
      expect(s.buildMetadata()).toBeUndefined()
    })
  })

  /* llamacpp internals */
  describe('llamacpp internals', () => {
    it('url and headers', async () => {
      vi.mocked(invoke).mockResolvedValue({ port: 8080, api_key: 'llama-key' })
      await ModelFactory.createModel('m', mkProvider('llamacpp'), {})
      const opts = getOpts()
      expect(opts.url({ path: '/chat/completions' })).toBe('http://localhost:8080/v1/chat/completions')
      expect(opts.headers().Authorization).toBe('Bearer llama-key')
      expect(opts.headers().Origin).toBe('tauri://localhost')
    })

    it('custom fetch merges params and strips client-side keys', async () => {
      vi.mocked(invoke).mockResolvedValue({ port: 8080, api_key: 'k' })
      await ModelFactory.createModel('m', mkProvider('llamacpp'), {
        temperature: 0.5,
        max_output_tokens: 1024,
        ctx_len: 4096,
        auto_compact: true,
      })
      const opts = getOpts()
      await opts.fetch('http://x', { method: 'POST', body: JSON.stringify({ messages: [] }) })
      const body = JSON.parse(vi.mocked(httpFetch).mock.calls[0][1]!.body as string)
      expect(body.temperature).toBe(0.5)
      expect(body.max_tokens).toBe(1024)
      expect(body.ctx_len).toBeUndefined()
      expect(body.auto_compact).toBeUndefined()
    })

    it('throws when startModel fails with Error', async () => {
      mockStartModel.mockRejectedValueOnce(new Error('GPU fail'))
      await expect(ModelFactory.createModel('m', mkProvider('llamacpp'), {})).rejects.toThrow('Failed to start model: GPU fail')
    })

    it('throws when startModel fails with non-Error', async () => {
      mockStartModel.mockRejectedValueOnce({ code: 'ENOMEM' })
      await expect(ModelFactory.createModel('m', mkProvider('llamacpp'), {})).rejects.toThrow('Failed to start model:')
    })
  })

  /* mlx internals */
  describe('mlx internals', () => {
    it('url, headers, and param merge', async () => {
      vi.mocked(invoke).mockResolvedValue({ port: 9090, api_key: 'mlx-key' })
      await ModelFactory.createModel('m', mkProvider('mlx'), { temperature: 0.3 })
      const opts = getOpts()
      expect(opts.url({ path: '/chat/completions' })).toBe('http://localhost:9090/v1/chat/completions')
      expect(opts.headers().Authorization).toBe('Bearer mlx-key')

      await opts.fetch('http://x', { method: 'POST', body: JSON.stringify({ messages: [] }) })
      const body = JSON.parse(vi.mocked(httpFetch).mock.calls[0][1]!.body as string)
      expect(body.temperature).toBe(0.3)
    })

    it('sends cancel on abort', async () => {
      vi.mocked(invoke).mockResolvedValue({ port: 9090, api_key: 'k' })
      await ModelFactory.createModel('m', mkProvider('mlx'), {})
      const opts = getOpts()
      const ctrl = new AbortController()
      await opts.fetch('http://x', { method: 'POST', body: JSON.stringify({}), signal: ctrl.signal })
      ctrl.abort()
      await new Promise((r) => setTimeout(r, 20))
      expect(vi.mocked(httpFetch)).toHaveBeenCalledTimes(2)
      expect(vi.mocked(httpFetch).mock.calls[1][0]).toBe('http://localhost:9090/v1/cancel')
    })

    it('throws when startModel fails', async () => {
      mockStartModel.mockRejectedValueOnce(new Error('No MLX'))
      await expect(ModelFactory.createModel('m', mkProvider('mlx'), {})).rejects.toThrow('Failed to start model: No MLX')
    })
  })

  /* custom headers on google, openai, xai */
  describe('custom headers', () => {
    it('google passes custom headers via the native @ai-sdk/google client', async () => {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      vi.mocked(createGoogleGenerativeAI).mockClear()
      await ModelFactory.createModel('g', mkProvider('google', { custom_header: [{ header: 'X-G', value: 'v' }] }), {})
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-G': 'v' }),
        })
      )
    })

    it('openai passes custom headers', async () => {
      await ModelFactory.createModel('o', mkProvider('openai', { custom_header: [{ header: 'X-O', value: 'v' }] }), {})
      expect((globalThis as any).__capturedOpenAICfg.headers).toEqual({ 'X-O': 'v' })
    })

    it('xai passes custom headers', async () => {
      await ModelFactory.createModel('x', mkProvider('xai', { custom_header: [{ header: 'X-X', value: 'v' }] }), {})
      expect((globalThis as any).__capturedXaiCfg.headers).toEqual({ 'X-X': 'v' })
    })

    it('xai OAuth uses the Responses transport', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      const model = await ModelFactory.createModel(
        'grok-4.3',
        mkProvider('xai', {
          api_key: '',
          base_url: 'https://api.x.ai/v1',
        }),
        {}
      )
      const xaiClient = vi.mocked(createXai).mock.results.at(-1)?.value as {
        responses: ReturnType<typeof vi.fn>
      }

      expect(model).toEqual({ type: 'xai-responses' })
      expect((globalThis as any).__capturedXaiCfg.apiKey).toBe('oauth-token')
      expect(xaiClient.responses).toHaveBeenCalledWith('grok-4.3')
    })

    it('xai OAuth remaps stale Grok Build model ids to the SSO runtime model', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      await ModelFactory.createModel(
        'grok-build-0.1',
        mkProvider('xai', {
          api_key: '',
          base_url: 'https://api.x.ai/v1',
        }),
        {}
      )
      const xaiClient = vi.mocked(createXai).mock.results.at(-1)?.value as {
        responses: ReturnType<typeof vi.fn>
      }

      expect(xaiClient.responses).toHaveBeenCalledWith('grok-4.3')
    })

    it('xai OAuth fetch injects store:false on /responses POST', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      const downstream = vi.fn().mockResolvedValueOnce(
        new Response('{}', { status: 200 })
      )
      const origFetch = globalThis.fetch
      globalThis.fetch = downstream as typeof globalThis.fetch

      try {
        await ModelFactory.createModel(
          'grok-4.3',
          mkProvider('xai', { api_key: '', base_url: 'https://api.x.ai/v1' }),
          {}
        )

        const wrappedFetch = (globalThis as any).__capturedXaiCfg
          .fetch as typeof globalThis.fetch
        await wrappedFetch('https://api.x.ai/v1/responses', {
          method: 'POST',
          body: JSON.stringify({
            model: 'grok-4.3',
            input: [],
            previous_response_id: 'resp_abc',
          }),
        })

        const downstreamBody = JSON.parse(
          downstream.mock.calls.at(-1)?.[1]?.body as string
        )
        expect(downstreamBody.store).toBe(false)
        expect(downstreamBody.previous_response_id).toBeUndefined()
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('xai OAuth fetch leaves non-/responses POST bodies untouched', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      const downstream = vi.fn().mockResolvedValueOnce(
        new Response('{}', { status: 200 })
      )
      const origFetch = globalThis.fetch
      globalThis.fetch = downstream as typeof globalThis.fetch

      try {
        await ModelFactory.createModel(
          'grok-4.3',
          mkProvider('xai', { api_key: '', base_url: 'https://api.x.ai/v1' }),
          {}
        )

        const wrappedFetch = (globalThis as any).__capturedXaiCfg
          .fetch as typeof globalThis.fetch
        await wrappedFetch('https://api.x.ai/v1/models', {
          method: 'POST',
          body: JSON.stringify({ foo: 'bar' }),
        })

        const downstreamBody = JSON.parse(
          downstream.mock.calls.at(-1)?.[1]?.body as string
        )
        expect('store' in downstreamBody).toBe(false)
        expect(downstreamBody.foo).toBe('bar')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('xai OAuth fetch treats a bare Forbidden as unknown request failure', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      const downstream = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      )
      const origFetch = globalThis.fetch
      globalThis.fetch = downstream as typeof globalThis.fetch

      try {
        await ModelFactory.createModel(
          'grok-4.3',
          mkProvider('xai', { api_key: '', base_url: 'https://api.x.ai/v1' }),
          {}
        )

        const wrappedFetch = (globalThis as any).__capturedXaiCfg
          .fetch as typeof globalThis.fetch
        const res = await wrappedFetch('https://api.x.ai/v1/responses', {
          method: 'POST',
          body: JSON.stringify({ model: 'grok-4.3', input: [] }),
        })
        const body = await res.json()
        expect(res.status).toBe(403)
        expect(body.error.message).toMatch(/did not identify a quota\/subscription issue/i)
        expect(body.error.message).toMatch(/still sending something xAI rejects/i)
        expect(body.error.message).toMatch(/\[xai-oauth\]/)
        expect(body.error.message).toMatch(/upstream: Forbidden/)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('xai OAuth does not fall back to API key on entitlement 403', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      const downstream = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                'You have run out of available resources or do not have an active Grok subscription.',
            },
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
      const origFetch = globalThis.fetch
      globalThis.fetch = downstream as typeof globalThis.fetch

      try {
        await ModelFactory.createModel(
          'grok-4.3',
          mkProvider('xai', {
            api_key: 'xai-key-fallback',
            base_url: 'https://api.x.ai/v1',
          }),
          {}
        )

        const wrappedFetch = (globalThis as any).__capturedXaiCfg
          .fetch as typeof globalThis.fetch
        const res = await wrappedFetch('https://api.x.ai/v1/responses', {
          method: 'POST',
          headers: { Authorization: 'Bearer oauth-token' },
          body: JSON.stringify({ model: 'grok-4.3', input: [] }),
        })

        const body = await res.json()
        expect(res.status).toBe(403)
        expect(downstream).toHaveBeenCalledTimes(1)
        expect(body.error.message).toMatch(/quota\/subscription entitlement/i)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('xai OAuth never injects OpenAI-compatible params into /responses', async () => {
      vi.mocked(getXaiOAuthAccessToken).mockResolvedValueOnce('oauth-token')
      const downstream = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }))
      const origFetch = globalThis.fetch
      globalThis.fetch = downstream as typeof globalThis.fetch

      try {
        await ModelFactory.createModel(
          'grok-4.3',
          mkProvider('xai', {
            api_key: 'xai-key-fallback',
            base_url: 'https://api.x.ai/v1',
          }),
          {
            max_output_tokens: 1024,
            temperature: 0.4,
            top_k: 40,
          }
        )

        const wrappedFetch = (globalThis as any).__capturedXaiCfg
          .fetch as typeof globalThis.fetch
        await wrappedFetch('https://api.x.ai/v1/responses', {
          method: 'POST',
          body: JSON.stringify({ model: 'grok-4.3', input: [] }),
        })

        const body = JSON.parse(downstream.mock.calls.at(-1)?.[1]?.body as string)
        expect(body.store).toBe(false)
        expect(body.max_tokens).toBeUndefined()
        expect(body.max_output_tokens).toBeUndefined()
        expect(body.temperature).toBeUndefined()
        expect(body.top_k).toBeUndefined()
        expect(downstream).toHaveBeenCalledTimes(1)
      } finally {
        globalThis.fetch = origFetch
      }
    })
  })

  /* openai-compatible empty base_url */
  describe('openai-compatible', () => {
    it('uses default base_url when none provided', async () => {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      await ModelFactory.createModel('m', mkProvider('custom', { base_url: undefined }), {})
      expect(vi.mocked(createOpenAICompatible)).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://api.openai.com/v1' })
      )
    })
  })
})
