import { describe, it, expect, vi } from 'vitest'
import {
  fetchModelsDevProviderModels,
  fetchTopRemoteModels,
  supportsRemoteCatalog,
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
  it('supports openai, anthropic and gemini', () => {
    expect(supportsRemoteCatalog('openai')).toBe(true)
    expect(supportsRemoteCatalog('anthropic')).toBe(true)
    expect(supportsRemoteCatalog('gemini')).toBe(true)
    expect(supportsRemoteCatalog('groq')).toBe(false)
    expect(supportsRemoteCatalog('mistral')).toBe(false)
  })
})

describe('fetchModelsDevProviderModels', () => {
  it('reads xAI text models from models.dev, pins grok-4.3, and skips image/video models', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({
        xai: {
          models: {
            'grok-imagine-image': {
              modalities: { input: ['text'], output: ['image'] },
            },
            'grok-4.20-0309-reasoning': {
              modalities: { input: ['text', 'image'], output: ['text'] },
              tool_call: true,
              release_date: '2026-03-09',
            },
            'grok-4.3': {
              modalities: { input: ['text', 'image'], output: ['text'] },
              tool_call: true,
              release_date: '2026-05-06',
            },
            'grok-imagine-video': {
              modalities: { input: ['text'], output: ['video'] },
            },
          },
        },
      })
    )

    const result = await fetchModelsDevProviderModels('xai', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('https://models.dev/api.json', {
      method: 'GET',
    })
    expect(result.map((model) => model.id)).toEqual([
      'grok-4.3',
      'grok-4.20-0309-reasoning',
    ])
    expect(result[0].capabilities).toEqual(['completion', 'tools', 'vision'])
  })

  it('returns an empty list when provider data is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse({}))
    await expect(fetchModelsDevProviderModels('xai', fetchImpl)).resolves.toEqual(
      []
    )
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
