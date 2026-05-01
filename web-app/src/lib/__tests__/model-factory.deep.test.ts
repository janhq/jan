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
    return vi.fn(() => ({ type: 'openai' }))
  }),
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn((config: any) => {
    ;(globalThis as any).__capturedXaiCfg = config
    return vi.fn(() => ({ type: 'xai' }))
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

import { ModelFactory } from '../model-factory'
import { invoke } from '@tauri-apps/api/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'

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

  /* foundation-models */
  describe('foundation-models fetch', () => {
    it('non-streaming returns Response', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce('available')
        .mockResolvedValueOnce(true)
      await ModelFactory.createModel('fm', mkProvider('foundation-models'), {})
      const opts = getOpts()
      vi.mocked(invoke).mockResolvedValueOnce('{"choices":[]}')
      const resp = await opts.fetch('fm://x', { method: 'POST', body: JSON.stringify({ messages: [], stream: false }) })
      expect(resp.status).toBe(200)
      expect(await resp.text()).toBe('{"choices":[]}')
    })

    it('streaming creates ReadableStream', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce('available')
        .mockResolvedValueOnce(true)
      await ModelFactory.createModel('fm', mkProvider('foundation-models'), {})
      const opts = getOpts()

      const { listen } = await import('@tauri-apps/api/event')
      let cb: any = null
      vi.mocked(listen).mockImplementation(async (_ev: string, fn: any) => {
        cb = fn
        return () => {}
      })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      const resp = await opts.fetch('fm://x', { method: 'POST', body: JSON.stringify({ messages: [], stream: true }) })
      expect(resp.headers.get('Content-Type')).toBe('text/event-stream')

      const reader = resp.body!.getReader()
      const dec = new TextDecoder()

      cb({ payload: { data: '{"c":1}' } })
      const c1 = await reader.read()
      expect(dec.decode(c1.value)).toContain('{"c":1}')

      cb({ payload: { done: true } })
      const c2 = await reader.read()
      expect(dec.decode(c2.value)).toContain('[DONE]')
    })

    it('streaming handles error payload', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce('available')
        .mockResolvedValueOnce(true)
      await ModelFactory.createModel('fm', mkProvider('foundation-models'), {})
      const opts = getOpts()

      const { listen } = await import('@tauri-apps/api/event')
      let cb: any = null
      vi.mocked(listen).mockImplementation(async (_ev: string, fn: any) => {
        cb = fn
        return () => {}
      })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      const resp = await opts.fetch('fm://x', { method: 'POST', body: JSON.stringify({ messages: [], stream: true }) })
      const reader = resp.body!.getReader()
      cb({ payload: { error: 'boom' } })
      await expect(reader.read()).rejects.toThrow('boom')
    })

    it('streaming handles invoke error', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce('available')
        .mockResolvedValueOnce(true)
      await ModelFactory.createModel('fm', mkProvider('foundation-models'), {})
      const opts = getOpts()

      const { listen } = await import('@tauri-apps/api/event')
      vi.mocked(listen).mockImplementation(async (_ev: string, _fn: any) => {
        return () => {}
      })
      vi.mocked(invoke).mockRejectedValueOnce(new Error('invoke fail'))

      const resp = await opts.fetch('fm://x', { method: 'POST', body: JSON.stringify({ messages: [], stream: true }) })
      const reader = resp.body!.getReader()
      await expect(reader.read()).rejects.toThrow('invoke fail')
    })

    it('startModel error is wrapped', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('available')
      mockStartModel.mockRejectedValueOnce(new Error('FM fail'))
      await expect(ModelFactory.createModel('fm', mkProvider('foundation-models'), {})).rejects.toThrow('Failed to start model: FM fail')
    })
  })

  /* custom headers on google, openai, xai */
  describe('custom headers', () => {
    it('google passes custom headers', async () => {
      await ModelFactory.createModel('g', mkProvider('google', { custom_header: [{ header: 'X-G', value: 'v' }] }), {})
      expect((globalThis as any).__capturedGoogleCfg.headers).toEqual({ 'X-G': 'v' })
    })

    it('openai passes custom headers', async () => {
      await ModelFactory.createModel('o', mkProvider('openai', { custom_header: [{ header: 'X-O', value: 'v' }] }), {})
      expect((globalThis as any).__capturedOpenAICfg.headers).toEqual({ 'X-O': 'v' })
    })

    it('xai passes custom headers', async () => {
      await ModelFactory.createModel('x', mkProvider('xai', { custom_header: [{ header: 'X-X', value: 'v' }] }), {})
      expect((globalThis as any).__capturedXaiCfg.headers).toEqual({ 'X-X': 'v' })
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
