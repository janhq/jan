import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalEngineExtension } from './index'
import {
  loadLocalModel,
  unloadLocalModel,
  getLocalLoadedModels,
} from './test/setup'
import { fs } from '@janhq/core'

class TestEngine extends LocalEngineExtension {
  readonly provider = 'test-engine'
  readonly providerId = 'test-engine'
}

/** Builds a fetch response that streams the given server-sent events. */
function sseResponse(events: string[]): Response {
  const body = events.join('')
  const encoder = new TextEncoder()
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let done = false
        return {
          async read() {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: encoder.encode(body) }
          },
        }
      },
    },
  } as unknown as Response
}

describe('LocalEngineExtension', () => {
  let engine: TestEngine

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockResolvedValue(true as never)
    engine = new TestEngine()
  })

  it('reports its provider', () => {
    expect(engine.provider).toBe('test-engine')
    expect(engine.providerId).toBe('test-engine')
  })

  it('applies settings changes', () => {
    engine.onSettingUpdate('ctx_size', 8192)
    engine.onSettingUpdate('threads', 6)
    engine.onSettingUpdate('auto_unload', false)
    expect(engine.ctxSize).toBe(8192)
    expect(engine.threads).toBe(6)
    expect(engine.autoUnload).toBe(false)
  })

  it('starts the engine for a model and keeps the session', async () => {
    loadLocalModel.mockResolvedValue({
      engine: 'test-engine',
      model_id: 'my-model',
      model_path: '/models/my-model/model.bin',
      port: 4242,
      api_key: 'secret',
      pid: 1234,
    })

    const session = await engine.load('my-model', { ctx_size: 2048 })

    expect(loadLocalModel).toHaveBeenCalledWith(
      'test-engine',
      'my-model',
      expect.any(String),
      0,
      expect.objectContaining({ ctx_size: 2048 }),
      expect.any(Number),
      expect.any(String)
    )
    expect(session.port).toBe(4242)
    expect(session.api_key).toBe('secret')
  })

  it('asks the plugin to stop a session', async () => {
    unloadLocalModel.mockResolvedValue({ success: true })
    loadLocalModel.mockResolvedValue({
      engine: 'test-engine',
      model_id: 'my-model',
      model_path: '/models/my-model/model.bin',
      port: 4242,
      api_key: 'secret',
      pid: 1234,
    })
    await engine.load('my-model')

    // The model service hands over the model id.
    const result = await engine.unload('my-model')
    expect(unloadLocalModel).toHaveBeenCalledWith(1234)
    expect(result.success).toBe(true)
  })

  it('reports a session it does not know about', async () => {
    unloadLocalModel.mockResolvedValue({ success: true })
    const result = await engine.unload('not-loaded')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not-loaded')
  })

  it('lists the models the plugin knows about', async () => {
    getLocalLoadedModels.mockResolvedValue(['a', 'b'])
    expect(await engine.getLoadedModels()).toEqual(['a', 'b'])
  })

  it('turns a streamed completion into chat chunks', async () => {
    loadLocalModel.mockResolvedValue({
      engine: 'test-engine',
      model_id: 'my-model',
      model_path: '/models/my-model/model.bin',
      port: 4242,
      api_key: 'secret',
      pid: 1234,
    })
    await engine.load('my-model')

    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"my-model","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"my-model","choices":[{"index":0,"delta":{"content":"Red"}}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"my-model","choices":[{"index":0,"delta":{"reasoning_content":"thinking"}}]}\n\n',
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"my-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const stream = (await engine.chat({
      model: 'my-model',
      messages: [{ role: 'user', content: 'Name a color' }],
      stream: true,
    } as never)) as AsyncIterable<{ choices: { delta: { content?: string } }[] }>

    const contents: string[] = []
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) contents.push(content)
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4242/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      })
    )
    expect(contents.join('')).toBe('Redthinking')
  })

  it('reports a failing engine instead of hanging', async () => {
    loadLocalModel.mockResolvedValue({
      engine: 'test-engine',
      model_id: 'my-model',
      model_path: '/models/my-model/model.bin',
      port: 4242,
      api_key: 'secret',
      pid: 1234,
    })
    await engine.load('my-model')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'model exploded',
      })
    )

    await expect(
      engine.chat({
        model: 'my-model',
        messages: [{ role: 'user', content: 'hi' }],
      } as never)
    ).rejects.toThrow(/500: model exploded/)
  })
})
