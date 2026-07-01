import { describe, it, expect, vi } from 'vitest'
import {
  fetchTopRemoteModels,
  supportsRemoteCatalog,
  inferLemonadeCapabilities,
} from '../remoteModelCatalog'

function mkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mkOpenAIProvider(extra: Record<string, unknown> = {}) {
  return {
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-test',
    ...extra,
  } as any
}

function mkAnthropicProvider(extra: Record<string, unknown> = {}) {
  return {
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    api_key: 'sk-ant',
    ...extra,
  } as any
}

function mkGeminiProvider(extra: Record<string, unknown> = {}) {
  return {
    provider: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api_key: 'gm-test',
    ...extra,
  } as any
}

describe('supportsRemoteCatalog', () => {
  it('returns true for built-in catalog providers', () => {
    expect(supportsRemoteCatalog('openai')).toBe(true)
    expect(supportsRemoteCatalog('anthropic')).toBe(true)
    expect(supportsRemoteCatalog('gemini')).toBe(true)
    expect(supportsRemoteCatalog('lemonade')).toBe(true)
    expect(supportsRemoteCatalog('groq')).toBe(false)
    expect(supportsRemoteCatalog('mistral')).toBe(false)
  })
})

describe('fetchTopRemoteModels gemini', () => {
  it('sorts by version desc, infers vision+tools, includes gemma, hides embeddings/imagen/veo/aqa', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          { id: 'models/gemini-1.0-pro' },
          { id: 'models/gemini-2.0-flash' },
          { id: 'models/gemini-3.5-pro' },
          { id: 'models/gemini-3-flash' },
          { id: 'models/gemini-2.5-pro' },
          { id: 'models/gemini-1.5-pro' },
          { id: 'models/gemma-3-27b-it' },
          { id: 'models/gemma-2-9b-it' },
          { id: 'models/gemini-embedding-001' },
          { id: 'models/text-embedding-004' },
          { id: 'models/imagen-3.0-generate-001' },
          { id: 'models/veo-2.0-generate-001' },
          { id: 'models/aqa' },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkGeminiProvider(), fetchImpl)
    const ids = result.map((m) => m.id)

    expect(ids).not.toContain('models/gemini-embedding-001')
    expect(ids).not.toContain('models/text-embedding-004')
    expect(ids).not.toContain('models/imagen-3.0-generate-001')
    expect(ids).not.toContain('models/veo-2.0-generate-001')
    expect(ids).not.toContain('models/aqa')

    // Version desc: 3.5 > 3 > 2.5 > 2 > 1.5 > 1
    expect(ids[0]).toBe('models/gemini-3.5-pro')
    expect(ids[1]).toBe('models/gemini-3-flash')
    expect(ids).toContain('models/gemma-3-27b-it')

    for (const m of result) {
      expect(m.capabilities).toEqual(['completion', 'tools', 'vision'])
    }
  })
})

describe('fetchTopRemoteModels openai', () => {
  it('filters non-chat models, infers vision+tools on gpt-4o, returns top 10 sorted by created desc', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          { id: 'gpt-3.5-turbo', created: 1000 },
          { id: 'gpt-4o', created: 5000 },
          { id: 'gpt-4o-mini', created: 4000 },
          { id: 'gpt-5', created: 9000 },
          { id: 'text-embedding-3-small', created: 8000 },
          { id: 'whisper-1', created: 7500 },
          { id: 'dall-e-3', created: 7000 },
          { id: 'gpt-4-turbo', created: 3000 },
          { id: 'gpt-4', created: 2500 },
          { id: 'o1-preview', created: 6000 },
          { id: 'o3-mini', created: 7000 },
          { id: 'gpt-4.1', created: 6500 },
        ],
      })
    )

    const result = await fetchTopRemoteModels(mkOpenAIProvider(), fetchImpl)

    expect(result.map((m) => m.id)).not.toContain('text-embedding-3-small')
    expect(result.map((m) => m.id)).not.toContain('whisper-1')
    expect(result.map((m) => m.id)).not.toContain('dall-e-3')
    expect(result.length).toBeLessThanOrEqual(10)
    expect(result[0].id).toBe('gpt-5')
    const gpt4o = result.find((m) => m.id === 'gpt-4o')!
    expect(gpt4o.capabilities).toEqual(['completion', 'tools', 'vision'])
    const gpt35 = result.find((m) => m.id === 'gpt-3.5-turbo')!
    expect(gpt35.capabilities).toEqual(['completion', 'tools'])
  })

  it('sends bearer + x-api-key headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse({ data: [] }))
    await fetchTopRemoteModels(mkOpenAIProvider(), fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'x-api-key': 'sk-test',
        }),
      })
    )
  })

  it('retries with fallback key on 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mkResponse({ error: 'bad key' }, 401))
      .mockResolvedValueOnce(mkResponse({ data: [{ id: 'gpt-4o', created: 1 }] }))
    const result = await fetchTopRemoteModels(
      mkOpenAIProvider({ api_key_fallbacks: ['sk-backup'] }),
      fetchImpl
    )
    expect(result.map((m) => m.id)).toEqual(['gpt-4o'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('drops unrecognized ids whose capabilities cannot be inferred', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          { id: 'gpt-4o', created: 5 },
          { id: 'codex-mystery', created: 4 },
          { id: 'some-unknown-model', created: 3 },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkOpenAIProvider(), fetchImpl)
    expect(result.map((m) => m.id)).toEqual(['gpt-4o'])
  })

  it('throws when all keys fail', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse({}, 401))
    await expect(
      fetchTopRemoteModels(mkOpenAIProvider(), fetchImpl)
    ).rejects.toThrow(/Failed to fetch models from openai/)
  })
})

describe('fetchTopRemoteModels anthropic', () => {
  it('parses created_at ISO and infers claude capabilities', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          { id: 'claude-3-5-sonnet-20240620', created_at: '2024-06-20T00:00:00Z' },
          { id: 'claude-3-opus-20240229', created_at: '2024-02-29T00:00:00Z' },
          { id: 'claude-2.1', created_at: '2023-11-21T00:00:00Z' },
          { id: 'claude-instant-1.2', created_at: '2023-08-09T00:00:00Z' },
          { id: 'gpt-4', created_at: '2024-01-01T00:00:00Z' },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkAnthropicProvider(), fetchImpl)
    expect(result.map((m) => m.id)).not.toContain('gpt-4')
    expect(result[0].id).toBe('claude-3-5-sonnet-20240620')
    const c35 = result.find((m) => m.id === 'claude-3-5-sonnet-20240620')!
    expect(c35.capabilities).toEqual(['completion', 'tools', 'vision'])
    const c2 = result.find((m) => m.id === 'claude-2.1')!
    expect(c2.capabilities).toEqual(['completion', 'tools'])
  })
})

function mkLemonadeProvider(extra: Record<string, unknown> = {}) {
  return {
    provider: 'lemonade',
    base_url: 'http://127.0.0.1:13305/v1',
    api_key: '',
    ...extra,
  } as any
}

describe('fetchTopRemoteModels lemonade', () => {
  it('carries max_context_window as contextLength and omits it when absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          { id: 'Qwen3-0.6B-GGUF', created: 1700000000, labels: [], max_context_window: 40960 },
          { id: 'Qwen3-8B-GGUF', created: 1700000001, labels: [] },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkLemonadeProvider(), fetchImpl)
    const small = result.find((m) => m.id === 'Qwen3-0.6B-GGUF')!
    const large = result.find((m) => m.id === 'Qwen3-8B-GGUF')!
    expect(small.contextLength).toBe(40960)
    expect(large.contextLength).toBeUndefined()
  })

  it('maps vision and tool-calling labels to capabilities', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          {
            id: 'Qwen3-8B-GGUF',
            created: 1700000000,
            labels: ['vision', 'tool-calling'],
          },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkLemonadeProvider(), fetchImpl)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('Qwen3-8B-GGUF')
    expect(result[0].capabilities).toContain('completion')
    expect(result[0].capabilities).toContain('vision')
    expect(result[0].capabilities).toContain('tools')
  })

  it('excludes non-chat models (transcription, tts, image, embeddings, reranking, upscaling)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          { id: 'Whisper-Large', created: 1700000001, labels: ['transcription'] },
          { id: 'Kokoro-v1', created: 1700000002, labels: ['tts'] },
          { id: 'SD-Turbo', created: 1700000003, labels: ['image'] },
          { id: 'bge-large', created: 1700000004, labels: ['embeddings'] },
          { id: 'cross-encoder', created: 1700000005, labels: ['reranking'] },
          { id: 'upscaler-model', created: 1700000007, labels: ['upscaling'] },
          { id: 'Qwen3-0.6B-GGUF', created: 1700000006, labels: [] },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkLemonadeProvider(), fetchImpl)
    const ids = result.map((m) => m.id)
    expect(ids).not.toContain('Whisper-Large')
    expect(ids).not.toContain('Kokoro-v1')
    expect(ids).not.toContain('SD-Turbo')
    expect(ids).not.toContain('bge-large')
    expect(ids).not.toContain('cross-encoder')
    expect(ids).not.toContain('upscaler-model')
    expect(ids).toContain('Qwen3-0.6B-GGUF')
  })

  it('maps chat-transcription label to audio capability', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        data: [
          {
            id: 'LMX-Omni-5.5B',
            created: 1700000000,
            labels: ['vision', 'chat-transcription'],
          },
        ],
      })
    )
    const result = await fetchTopRemoteModels(mkLemonadeProvider(), fetchImpl)
    expect(result[0].capabilities).toContain('audio')
  })

  it('includes all chat models without TOP_N=10 cap', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      id: `model-${i}`,
      created: 1700000000 + i,
      labels: [],
    }))
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse({ data: rows }))
    const result = await fetchTopRemoteModels(mkLemonadeProvider(), fetchImpl)
    expect(result.length).toBe(15)
  })

  it('works without an API key (empty string)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({ data: [{ id: 'Qwen3-0.6B-GGUF', created: 1700000000, labels: [] }] })
    )
    const result = await fetchTopRemoteModels(
      mkLemonadeProvider({ api_key: '' }),
      fetchImpl
    )
    expect(result).toHaveLength(1)
    // Should not have set Authorization header with empty key
    const calledHeaders = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>
    expect(calledHeaders?.Authorization).toBeUndefined()
  })
})

describe('inferLemonadeCapabilities', () => {
  it('returns completion only for empty labels', () => {
    expect(inferLemonadeCapabilities([])).toEqual(['completion'])
  })

  it('returns completion only for informational-only labels (hot, reasoning, coding)', () => {
    expect(inferLemonadeCapabilities(['hot', 'reasoning', 'coding'])).toEqual(['completion'])
  })

  it('non-chat label wins even when capability labels are also present', () => {
    expect(inferLemonadeCapabilities(['image', 'vision'])).toBeNull()
    expect(inferLemonadeCapabilities(['transcription', 'tool-calling'])).toBeNull()
    expect(inferLemonadeCapabilities(['tts', 'chat-transcription'])).toBeNull()
    expect(inferLemonadeCapabilities(['embeddings', 'vision', 'tool-calling'])).toBeNull()
  })

  it('returns all matching capabilities when multiple capability labels present', () => {
    const caps = inferLemonadeCapabilities(['vision', 'tool-calling', 'chat-transcription'])
    expect(caps).toContain('completion')
    expect(caps).toContain('vision')
    expect(caps).toContain('tools')
    expect(caps).toContain('audio')
    expect(caps).toHaveLength(4)
  })
})
