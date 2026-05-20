import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// This test file is self-contained: it stubs `@janhq/core` and Tauri
// primitives locally so the handler logic can be exercised without the
// heavy existing setup that runs the whole extension. It focuses on the
// `handleAutoIncreaseCtx` contract:
//   1. computeNextCtxLen is applied to the tracked live ctx_size
//   2. unload + load are called with the new ctx_size
//   3. a Tauri `auto_increase_ctx_done/{request_id}` event is emitted
//      with the outcome

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

vi.mock('@tauri-apps/api/path', () => ({
  basename: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  getSystemInfo: vi.fn(),
  getSystemUsage: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  loadLlamaModel: vi.fn(),
  readGgufMetadata: vi.fn(),
  getModelSize: vi.fn(),
  isModelSupported: vi.fn(),
  unloadLlamaModel: vi.fn(),
  mapOldBackendToNew: vi.fn(),
  findLatestVersionForBackend: vi.fn(),
  prioritizeBackends: vi.fn(),
  removeOldBackendVersions: vi.fn(),
  shouldMigrateBackend: vi.fn(),
  handleSettingUpdate: vi.fn(),
  installBundledBackend: vi.fn(),
  checkBackendForUpdates: vi.fn(),
}))

vi.mock('../backend', () => ({
  listSupportedBackends: vi.fn(),
  isBackendInstalled: vi.fn(),
  getBackendExePath: vi.fn(),
  getBackendDir: vi.fn(),
  getLocalInstalledBackends: vi.fn(),
  getBackendDownloadUrl: vi.fn(),
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
    onModelValidationStarted: 'onModelValidationStarted',
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

import llamacpp_extension from '../index'

type AutoIncreaseRequest = {
  request_id: string
  backend: 'llamacpp' | 'mlx'
  model_id: string
  trigger: 'error' | 'finish_length'
}

describe('llamacpp_extension auto_increase_ctx handler', () => {
  let ext: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = new llamacpp_extension()
    // Bypass the settings machinery that depends on AIEngine internals;
    // the handler only cares about `config.ctx_size`, `provider`, and the
    // `unload` / `load` methods on `this`.
    ;(ext as unknown as { config: Record<string, unknown> }).config = {
      ctx_size: 8192,
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

  it('grows 8192 → 32768 and emits done(ok:true) with new_ctx_len', async () => {
    const unloadSpy = vi
      .spyOn(ext, 'unload')
      .mockResolvedValue({ success: true })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 9999, api_key: 'k', model_id: 'm' } as any)

    ;(ext as any).modelCtxSize.set('m', 8192)

    await invokeHandler({
      request_id: 'req-1',
      backend: 'llamacpp',
      model_id: 'm',
      trigger: 'error',
    })

    expect(unloadSpy).toHaveBeenCalledWith('m')
    expect(loadSpy).toHaveBeenCalledWith('m', { ctx_size: 32768 }, false, true)

    expect(emitMock).toHaveBeenCalledWith(
      'local_backend://auto_increase_ctx_done/req-1',
      { ok: true, new_ctx_len: 32768 }
    )
    expect(eventsEmitMock).toHaveBeenCalledWith('OnAutoIncreasedCtxLen', {
      provider: 'llamacpp',
      modelId: 'm',
      newCtxLen: 32768,
    })
    expect((ext as any).modelCtxSize.get('m')).toBe(32768)
  })

  it('grows 32768 → 49152 (×1.5 step)', async () => {
    vi.spyOn(ext, 'unload').mockResolvedValue({ success: true })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 1, api_key: '', model_id: 'm' } as any)

    ;(ext as any).modelCtxSize.set('m', 32768)

    await invokeHandler({
      request_id: 'req-2',
      backend: 'llamacpp',
      model_id: 'm',
      trigger: 'finish_length',
    })

    expect(loadSpy).toHaveBeenCalledWith('m', { ctx_size: 49152 }, false, true)
    expect(emitMock).toHaveBeenCalledWith(
      'local_backend://auto_increase_ctx_done/req-2',
      { ok: true, new_ctx_len: 49152 }
    )
  })

  it('falls back to config.ctx_size when modelCtxSize has no entry', async () => {
    vi.spyOn(ext, 'unload').mockResolvedValue({ success: true })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 1, api_key: '', model_id: 'm' } as any)

    ;(ext as any).config = { ctx_size: 4096 }

    await invokeHandler({
      request_id: 'req-3',
      backend: 'llamacpp',
      model_id: 'm',
      trigger: 'error',
    })

    // 4096 is < 8192 so next step is 8192.
    expect(loadSpy).toHaveBeenCalledWith('m', { ctx_size: 8192 }, false, true)
  })

  it('emits done(ok:false, reason:exception:...) when load throws', async () => {
    vi.spyOn(ext, 'unload').mockResolvedValue({ success: true })
    vi.spyOn(ext, 'load').mockRejectedValue(new Error('OOM'))

    ;(ext as any).modelCtxSize.set('m', 8192)

    await invokeHandler({
      request_id: 'req-4',
      backend: 'llamacpp',
      model_id: 'm',
      trigger: 'error',
    })

    expect(emitMock).toHaveBeenCalledTimes(1)
    const [channel, body] = emitMock.mock.calls[0]
    expect(channel).toBe('local_backend://auto_increase_ctx_done/req-4')
    expect(body).toMatchObject({ ok: false })
    expect(String((body as any).reason)).toContain('OOM')
  })

  it('stops at the model max ctx_train and emits at_max event', async () => {
    const unloadSpy = vi.spyOn(ext, 'unload').mockResolvedValue({
      success: true,
    })
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 1, api_key: '', model_id: 'm' } as any)

    ;(ext as any).modelCtxSize.set('m', 32768)
    ;(ext as any).modelMaxCtxTrain.set('m', 32768)

    await invokeHandler({
      request_id: 'req-max',
      backend: 'llamacpp',
      model_id: 'm',
      trigger: 'error',
    })

    expect(unloadSpy).not.toHaveBeenCalled()
    expect(loadSpy).not.toHaveBeenCalled()

    const channels = emitMock.mock.calls.map(([ch]) => ch)
    expect(channels).toContain('local_backend://auto_increase_ctx_done/req-max')
    expect(channels).toContain('local_backend://auto_increase_ctx_at_max')

    const doneCall = emitMock.mock.calls.find(
      ([ch]) => ch === 'local_backend://auto_increase_ctx_done/req-max'
    )
    expect(doneCall?.[1]).toEqual({ ok: false, reason: 'at_max' })

    const atMaxCall = emitMock.mock.calls.find(
      ([ch]) => ch === 'local_backend://auto_increase_ctx_at_max'
    )
    expect(atMaxCall?.[1]).toMatchObject({
      provider: 'llamacpp',
      modelId: 'm',
      maxCtxLen: 32768,
      currentCtxLen: 32768,
    })
  })

  it('still proceeds with load when unload throws (stale session)', async () => {
    vi.spyOn(ext, 'unload').mockRejectedValue(
      new Error('No session')
    )
    const loadSpy = vi
      .spyOn(ext, 'load')
      .mockResolvedValue({ pid: 1, port: 1, api_key: '', model_id: 'm' } as any)

    ;(ext as any).modelCtxSize.set('m', 8192)

    await invokeHandler({
      request_id: 'req-5',
      backend: 'llamacpp',
      model_id: 'm',
      trigger: 'error',
    })

    expect(loadSpy).toHaveBeenCalledWith('m', { ctx_size: 32768 }, false, true)
    expect(emitMock).toHaveBeenCalledWith(
      'local_backend://auto_increase_ctx_done/req-5',
      { ok: true, new_ctx_len: 32768 }
    )
  })
})
