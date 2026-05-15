import { describe, it, expect, vi } from 'vitest'
import {
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

describe('supportsRemoteCatalog', () => {
  it('supports openai and anthropic only', () => {
    expect(supportsRemoteCatalog('openai')).toBe(true)
    expect(supportsRemoteCatalog('anthropic')).toBe(true)
    expect(supportsRemoteCatalog('groq')).toBe(false)
    expect(supportsRemoteCatalog('mistral')).toBe(false)
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
