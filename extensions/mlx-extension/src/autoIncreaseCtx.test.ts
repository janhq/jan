import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mirror of `../llamacpp-extension/src/test/autoIncreaseCtx.test.ts`. See
// that file for the rationale behind the inline mocks. The MLX handler has
// the same contract as llamacpp — same event channels, same
// `computeNextCtxLen` ladder, same done-event payload — so we reuse the
// same assertions against the MLX class.

const { emitMock, listenMock, eventsEmitMock } = vi.hoisted(() => ({
  emitMock: vi.fn().mockResolvedValue(undefined),
  listenMock: vi.fn().mockResolvedValue(() => {}),
  eventsEmitMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: listenMock,
}))

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-mlx-api', () => ({
  loadMlxModel: vi.fn(),
  unloadMlxModel: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  readGgufMetadata: vi.fn(),
}))

vi.mock('@janhq/core', () => ({
  AIEngine: class AIEngine {
    registerSettings(_: unknown) {}
    getSetting<T>(_: string, def: T) {
      return Promise.resolve(def)
    }
    async getSettings() {
      return []
    }
    async updateSettings(_: unknown) {}
    onLoad() {}
  },
  getJanDataFolderPath: vi.fn().mockResolvedValue('/tmp/jan'),
  fs: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    fileStat: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
  joinPath: vi.fn((parts: string[]) => Promise.resolve(parts.join('/'))),
  events: {
    emit: eventsEmitMock,
    on: vi.fn(),
    off: vi.fn(),
  },
  AppEvent: { onModelImported: 'onModelImported' },
  DownloadEvent: {
    onFileDownloadStopped: 'onFileDownloadStopped',
  },
  ModelEvent: {
    OnAutoIncreasedCtxLen: 'OnAutoIncreasedCtxLen',
  },
  computeNextCtxLen: (current: number, max?: number) => {
    let next: number
    if (current < 8192) next = 8192
    else if (current < 32768) next = 32768
    else next = Math.round(current * 1.5)
    if (typeof max === 'number' && max > 0) next = Math.min(next, max)
    return next
  },
}))

import mlx_extension from './index'

type AutoIncreaseRequest = {
  request_id: string
  backend: 'llamacpp' | 'mlx'
  model_id: string
  trigger: 'error' | 'finish_length'
}

describe('mlx_extension auto_increase_ctx handler', () => {
  let ext: mlx_extension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = new mlx_extension()
    ;(ext as unknown as { config: Record<string, unknown> }).config = {
      ctx_size: 4096,
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const invokeHandler = async (
    payload: AutoIncreaseRequest
  ): Promise<void> => {
    await (
      ext as unknown as {
        handleAutoIncreaseCtx: (p: AutoIncreaseRequest) => Promise<void>
      }
    ).handleAutoIncreaseCtx(payload)
  }

  it('uses 4096 MLX default when modelCtxSize is empty', async () => {
    vi.spyOn(ext, 'unload').mockResolvedValue({ success: true })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 7777, api_key: '', model_id: 'm' } as any)

    await invokeHandler({
      request_id: 'req-mlx-1',
      backend: 'mlx',
      model_id: 'm',
      trigger: 'error',
    })

    expect(loadSpy).toHaveBeenCalledWith('m', { ctx_size: 8192 }, false, true)
    expect(emitMock).toHaveBeenCalledWith(
      'local_backend://auto_increase_ctx_done/req-mlx-1',
      { ok: true, new_ctx_len: 8192 }
    )
    expect(eventsEmitMock).toHaveBeenCalledWith('OnAutoIncreasedCtxLen', {
      provider: 'mlx',
      modelId: 'm',
      newCtxLen: 8192,
    })
  })

  it('grows 8192 → 32768 with finish_length trigger', async () => {
    vi.spyOn(ext, 'unload').mockResolvedValue({ success: true })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 1, api_key: '', model_id: 'm' } as any)

    ;(ext as any).modelCtxSize.set('m', 8192)

    await invokeHandler({
      request_id: 'req-mlx-2',
      backend: 'mlx',
      model_id: 'm',
      trigger: 'finish_length',
    })

    expect(loadSpy).toHaveBeenCalledWith('m', { ctx_size: 32768 }, false, true)
  })

  it('emits done(ok:false) when load throws', async () => {
    vi.spyOn(ext, 'unload').mockResolvedValue({ success: true })
    vi.spyOn(ext, 'load').mockRejectedValue(new Error('mlx_oom'))

    ;(ext as any).modelCtxSize.set('m', 8192)

    await invokeHandler({
      request_id: 'req-mlx-3',
      backend: 'mlx',
      model_id: 'm',
      trigger: 'error',
    })

    const [channel, body] = emitMock.mock.calls[0]
    expect(channel).toBe('local_backend://auto_increase_ctx_done/req-mlx-3')
    expect(body).toMatchObject({ ok: false })
    expect(String((body as any).reason)).toContain('mlx_oom')
  })

  it('stops at the model max ctx_train and emits at_max event', async () => {
    const unloadSpy = vi.spyOn(ext, 'unload').mockResolvedValue({
      success: true,
    })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 1, api_key: '', model_id: 'm' } as any)

    ;(ext as any).modelCtxSize.set('m', 8192)
    ;(ext as any).modelMaxCtxTrain.set('m', 8192)

    await invokeHandler({
      request_id: 'req-mlx-max',
      backend: 'mlx',
      model_id: 'm',
      trigger: 'error',
    })

    expect(unloadSpy).not.toHaveBeenCalled()
    expect(loadSpy).not.toHaveBeenCalled()

    const channels = emitMock.mock.calls.map(([ch]) => ch)
    expect(channels).toContain(
      'local_backend://auto_increase_ctx_done/req-mlx-max'
    )
    expect(channels).toContain('local_backend://auto_increase_ctx_at_max')

    const doneCall = emitMock.mock.calls.find(
      ([ch]) => ch === 'local_backend://auto_increase_ctx_done/req-mlx-max'
    )
    expect(doneCall?.[1]).toEqual({ ok: false, reason: 'at_max' })

    const atMaxCall = emitMock.mock.calls.find(
      ([ch]) => ch === 'local_backend://auto_increase_ctx_at_max'
    )
    expect(atMaxCall?.[1]).toMatchObject({
      provider: 'mlx',
      modelId: 'm',
      maxCtxLen: 8192,
      currentCtxLen: 8192,
    })
  })
})
