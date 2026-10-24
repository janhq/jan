// The liveness side of the worker runtime: heartbeats, crash accounting and
// what the host does with a worker that stops answering or misbehaves after
// it started. Busy workers are modelled by a fake WorkerLike that never
// pongs: a real busy loop would block the test runner too.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValidatedManifest } from '@janhq/extension-api'
import type { WorkerLike } from '@janhq/extension-runtime'
import {
  runInSandbox,
  type SandboxWorker,
} from '@janhq/extension-runtime/testing'
import type {
  InstalledExtension,
  ListResult,
} from '@janhq/tauri-plugin-extensions-api'
import { ExtensionHost } from '../host'
import type { InstalledRegistry } from '../installed-loader'
import { MESSAGE_BURST } from '../worker-runtime'
import {
  CRASH_LIMIT,
  CRASH_WINDOW_MS,
  MAX_MISSED_PONGS,
  FAILED_STARTS_KEY,
  MAX_FAILED_STARTS,
  PING_INTERVAL_MS,
  START_GRACE_MS,
  crashCounter,
  loadWithCrashLoopGuard,
  startHeartbeat,
} from '../watchdog'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startHeartbeat', () => {
  it('pings every interval and declares the worker dead after the missed pongs', () => {
    vi.useFakeTimers()
    const sent: number[] = []
    const onDead = vi.fn()
    startHeartbeat({ ping: (n) => sent.push(n), onDead })
    vi.advanceTimersByTime(PING_INTERVAL_MS * MAX_MISSED_PONGS)
    expect(sent).toEqual([1, 2, 3])
    expect(onDead).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PING_INTERVAL_MS)
    expect(onDead).toHaveBeenCalledTimes(1)
    // Nothing more once it is dead.
    vi.advanceTimersByTime(PING_INTERVAL_MS * 5)
    expect(sent).toHaveLength(3)
    expect(onDead).toHaveBeenCalledTimes(1)
  })

  it('keeps a worker that answers alive', async () => {
    vi.useFakeTimers()
    const onDead = vi.fn()
    const heartbeat = startHeartbeat({
      ping: (n) => queueMicrotask(() => heartbeat.pong(n)),
      onDead,
    })
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 20)
    expect(onDead).not.toHaveBeenCalled()
    heartbeat.dispose()
  })

  it('ignores a pong for a ping it never sent', () => {
    vi.useFakeTimers()
    const onDead = vi.fn()
    const heartbeat = startHeartbeat({ ping: () => {}, onDead })
    for (let i = 0; i <= MAX_MISSED_PONGS; i++) {
      heartbeat.pong(999)
      vi.advanceTimersByTime(PING_INTERVAL_MS)
    }
    expect(onDead).toHaveBeenCalledTimes(1)
  })

  it('stops pinging once disposed', () => {
    vi.useFakeTimers()
    const ping = vi.fn()
    const onDead = vi.fn()
    startHeartbeat({ ping, onDead }).dispose()
    vi.advanceTimersByTime(PING_INTERVAL_MS * 10)
    expect(ping).not.toHaveBeenCalled()
    expect(onDead).not.toHaveBeenCalled()
  })
})

describe('crashCounter', () => {
  it('trips on the third crash within the window, per extension', () => {
    let now = 0
    const crashed = crashCounter(() => now)
    expect(crashed('a')).toBe(false)
    now += 1000
    expect(crashed('a')).toBe(false)
    expect(crashed('b')).toBe(false)
    now += 1000
    expect(crashed('a')).toBe(true)
    expect(CRASH_LIMIT).toBe(3)
  })

  it('forgets crashes older than the window', () => {
    let now = 0
    const crashed = crashCounter(() => now)
    crashed('a')
    crashed('a')
    now += CRASH_WINDOW_MS + 1
    expect(crashed('a')).toBe(false)
  })
})

/**
 * A worker that starts, then answers pings only while `alive`; a stand-in
 * for one stuck in a busy loop, which cannot answer anything.
 */
function fakeWorker() {
  const listeners = new Set<(e: { data: unknown }) => void>()
  const state = { alive: true, terminated: false, pings: 0 }
  const emit = (data: unknown) =>
    queueMicrotask(() => {
      if (!state.terminated) for (const l of [...listeners]) l({ data })
    })
  const worker: WorkerLike = {
    postMessage: (message) => {
      const m = message as { t: string; n?: number }
      if (m.t === 'init') emit({ v: 1, t: 'ready' })
      if (m.t === 'ping') {
        state.pings++
        if (state.alive) emit({ v: 1, t: 'pong', n: m.n })
      }
    },
    addEventListener: (type: string, l: (e: never) => void) => {
      if (type === 'message') listeners.add(l as (e: { data: unknown }) => void)
    },
    removeEventListener: (type: string, l: (e: never) => void) => {
      if (type === 'message')
        listeners.delete(l as (e: { data: unknown }) => void)
    },
    terminate: () => {
      state.terminated = true
    },
  }
  return { worker, state }
}

const BUNDLE = 'var JanExtension = { activate: function () {} };'

function newHost(
  createWorker: (source: string, name: string) => WorkerLike,
  installed?: InstalledRegistry
) {
  const notify = vi.fn()
  const host = new ExtensionHost({
    appSettings: memoryAppSettings(),
    secrets: memorySecrets(),
    notify,
    installed,
    createWorker,
  })
  return { host, notify }
}

const spawn = (host: ExtensionHost, m: ValidatedManifest) =>
  host.spawnWorkerExtension({
    manifest: m,
    bundle: BUNDLE,
    grants: [],
    source: 'dev',
  })

// Long enough for the heartbeat to give up on a silent worker.
const UNTIL_DEAD = PING_INTERVAL_MS * (MAX_MISSED_PONGS + 1)

describe('the host watchdog', () => {
  it('terminates a worker that stops answering pings and marks it crashed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    const fake = fakeWorker()
    const { host } = newHost(() => fake.worker)
    const m = manifest('acme.busy')
    expect((await spawn(host, m)).state).toBe('active')

    // Answering: still running after many intervals.
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 10)
    expect(fake.state.terminated).toBe(false)
    expect(host.list()[0].state).toBe('active')

    fake.state.alive = false
    await vi.advanceTimersByTimeAsync(UNTIL_DEAD)
    expect(fake.state.terminated).toBe(true)
    await vi.waitFor(() =>
      expect(host.list()[0]).toMatchObject({
        state: 'crashed',
        error: expect.stringMatching(/stopped responding/),
      })
    )
    // Everything it registered is released.
    expect(host.dispatcher.has('acme.busy', 'tools')).toBe(false)
  })

  it('marks a worker that floods the host after it started as crashed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const workers: SandboxWorker[] = []
    const { host: flooding } = newHost((source, name) => {
      const worker = runInSandbox(source, { name })
      workers.push(worker)
      return worker
    })
    const hosted = await flooding.spawnWorkerExtension({
      manifest: manifest('acme.flood'),
      bundle: `var JanExtension = { activate: function () {
        setTimeout(function () {
          for (var i = 0; i < ${MESSAGE_BURST * 4}; i++)
            self.postMessage({ v: 1, t: 'req', id: i + 1, method: 'log', args: ['info', 'x'] });
        }, 10);
      } };`,
      grants: [],
      source: 'dev',
    })
    expect(hosted.state).toBe('active')
    await vi.waitFor(() => expect(workers[0].terminated).toBe(true))
    await vi.waitFor(() => expect(flooding.list()[0].state).toBe('crashed'))
  })

  it('disables an extension for the session after three crashes in ten minutes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    let current = fakeWorker()
    const { host, notify } = newHost(() => {
      current = fakeWorker()
      return current.worker
    })
    const m = manifest('acme.crashy', { displayName: 'Crashy' })
    for (let i = 0; i < CRASH_LIMIT; i++) {
      expect((await spawn(host, m)).state).toBe('active')
      current.state.alive = false
      await vi.advanceTimersByTimeAsync(UNTIL_DEAD)
      await vi.waitFor(() => expect(host.list()[0].state).toBe('crashed'))
    }
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({
      extensionName: 'Crashy',
      level: 'error',
      message: expect.stringMatching(/until Jan restarts/),
    })
    // Refused for the rest of the session, without a worker.
    const created = current
    const again = await spawn(host, m)
    expect(again).toMatchObject({
      state: 'failed',
      error: expect.stringMatching(/disabled for this session/),
    })
    expect(current).toBe(created)
  })

  it('restarts a crashed installed extension from the registry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    const m = manifest('acme.inst')
    const { name, version, ...jan } = m
    const entry: InstalledExtension = {
      id: m.id,
      version,
      previous: null,
      enabled: true,
      granted: [],
      permissions: [],
      source: { kind: 'bundle', fileName: 'x.tgz', sha512: 'sha512-x' },
      verified: false,
      integrityChecked: false,
      installedAt: '2026-10-23T10:00:00Z',
      manifest: { name, version, jan },
    }
    const registry = {
      list: vi.fn(
        async (): Promise<ListResult> => ({
          safeMode: false,
          safeModeForced: false,
          recoveredFrom: null,
          extensions: [entry],
        })
      ),
      readEntry: vi.fn(async () => ({ code: BUNDLE, sha512: 'sha512-e' })),
    } satisfies InstalledRegistry
    const spawned: ReturnType<typeof fakeWorker>[] = []
    const { host } = newHost(() => {
      const fake = fakeWorker()
      spawned.push(fake)
      return fake.worker
    }, registry)
    await host.loadInstalled()
    expect(host.list()[0].state).toBe('active')

    spawned[0].state.alive = false
    await vi.advanceTimersByTimeAsync(UNTIL_DEAD)
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    await vi.waitFor(() => expect(host.list()[0].state).toBe('active'))
    expect(spawned[0].state.terminated).toBe(true)
  })
})

describe('a crash of an entry already being stopped', () => {
  it('neither counts nor restarts it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    const m = manifest('acme.stale')
    const { name, version, ...jan } = m
    const entry: InstalledExtension = {
      id: m.id,
      version,
      previous: null,
      enabled: true,
      granted: [],
      permissions: [],
      source: { kind: 'bundle', fileName: 'x.tgz', sha512: 'sha512-x' },
      verified: false,
      integrityChecked: false,
      installedAt: '2026-10-23T10:00:00Z',
      manifest: { name, version, jan },
    }
    const registry = {
      list: vi.fn(
        async (): Promise<ListResult> => ({
          safeMode: false,
          safeModeForced: false,
          recoveredFrom: null,
          extensions: [entry],
        })
      ),
      readEntry: vi.fn(async () => ({ code: BUNDLE, sha512: 'sha512-e' })),
    } satisfies InstalledRegistry
    const spawned: ReturnType<typeof fakeWorker>[] = []
    const { host, notify } = newHost(() => {
      const fake = fakeWorker()
      spawned.push(fake)
      return fake.worker
    }, registry)
    await host.loadInstalled()
    expect(host.list()[0].state).toBe('active')

    // The worker hangs; the user stops it while two pings are unanswered,
    // and its heartbeat expires while teardown waits on `deactivate`.
    spawned[0].state.alive = false
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * MAX_MISSED_PONGS + 1)
    const stopping = host.terminate(m.id)
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS)
    expect(spawned[0].state.terminated).toBe(true)
    await stopping
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 4)
    expect(spawned).toHaveLength(1)
    expect(host.list()[0].state).toBe('inactive')
    expect(registry.readEntry).toHaveBeenCalledTimes(1)

    // Nor did it count: after it, CRASH_LIMIT - 1 real crashes still get
    // it restarted rather than disabled.
    await host.reload(m.id)
    expect(host.list()[0].state).toBe('active')
    for (let i = 0; i < CRASH_LIMIT - 1; i++) {
      const before = spawned.length
      spawned[before - 1].state.alive = false
      await vi.advanceTimersByTimeAsync(UNTIL_DEAD)
      await vi.waitFor(() => expect(spawned).toHaveLength(before + 1))
      await vi.waitFor(() => expect(host.list()[0].state).toBe('active'))
    }
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('loadWithCrashLoopGuard', () => {
  function guard(settings = memoryAppSettings()) {
    const setSafeMode = vi.fn(async () => {})
    const onSafeMode = vi.fn()
    const onSafeModeFailed = vi.fn()
    let shutdown: (() => void) | undefined
    const run = (load: () => Promise<void>) =>
      loadWithCrashLoopGuard({
        settings,
        setSafeMode,
        onSafeMode,
        onSafeModeFailed,
        onCleanShutdown: (reset) => {
          shutdown = reset
        },
        load,
      })
    const cleanShutdown = () => shutdown?.()
    return { settings, setSafeMode, onSafeMode, onSafeModeFailed, run, cleanShutdown }
  }
  // A start that never reaches 'ready': the window dies while loading.
  const hang = () => new Promise<void>(() => {})
  const counter = (settings: ReturnType<typeof memoryAppSettings>) =>
    settings.data.get(FAILED_STARTS_KEY)

  it('keeps a start counted as failed until it ran the grace period after loading', async () => {
    vi.useFakeTimers()
    const { settings, run } = guard()
    let seen: string | undefined
    await run(async () => {
      seen = counter(settings)
    })
    expect(seen).toBe('1')
    // Loaded, but an extension could still take the window down.
    expect(counter(settings)).toBe('1')
    await vi.advanceTimersByTimeAsync(START_GRACE_MS - 1)
    expect(counter(settings)).toBe('1')
    await vi.advanceTimersByTimeAsync(1)
    expect(counter(settings)).toBe('0')
  })

  it('trips on extensions that kill the window shortly after loading', async () => {
    vi.useFakeTimers()
    const { settings, setSafeMode, onSafeMode, run } = guard()
    for (let i = 0; i < MAX_FAILED_STARTS; i++) {
      // Loading finishes; the window dies 5 s later, before the grace
      // period, so no timer of this start ever fires.
      await run(async () => {})
      await vi.advanceTimersByTimeAsync(5_000)
      expect(counter(settings)).toBe(String(i + 1))
      vi.clearAllTimers()
    }
    expect(setSafeMode).not.toHaveBeenCalled()
    await run(async () => {})
    expect(setSafeMode).toHaveBeenCalledWith(true)
    expect(onSafeMode).toHaveBeenCalledTimes(1)
  })

  it('enables safe mode before loading after two failed starts in a row', async () => {
    vi.useFakeTimers()
    const { settings, setSafeMode, onSafeMode, run } = guard()
    for (let i = 0; i < MAX_FAILED_STARTS; i++) {
      void run(hang)
      await vi.waitFor(() => expect(counter(settings)).toBe(String(i + 1)))
      expect(setSafeMode).not.toHaveBeenCalled()
    }
    const order: string[] = []
    setSafeMode.mockImplementation(async () => void order.push('safe'))
    await run(async () => void order.push('load'))
    expect(setSafeMode).toHaveBeenCalledWith(true)
    expect(onSafeMode).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['safe', 'load'])
    await vi.advanceTimersByTimeAsync(START_GRACE_MS)
    expect(counter(settings)).toBe('0')
  })

  it('does not count a start that was shut down cleanly', async () => {
    vi.useFakeTimers()
    const { settings, setSafeMode, run, cleanShutdown } = guard()
    for (let i = 0; i <= MAX_FAILED_STARTS; i++) {
      // Quit (or reload) while loading, and right after it.
      void run(i === 0 ? hang : async () => {})
      await vi.waitFor(() => expect(counter(settings)).toBe('1'))
      cleanShutdown()
      await vi.waitFor(() => expect(counter(settings)).toBe('0'))
      vi.clearAllTimers()
    }
    expect(setSafeMode).not.toHaveBeenCalled()
  })

  it('does not count a start whose loading failed cleanly once it ran on', async () => {
    vi.useFakeTimers()
    const { settings, setSafeMode, run } = guard()
    for (let i = 0; i <= MAX_FAILED_STARTS; i++) {
      await run(() => Promise.reject(new Error('registry gone'))).catch(
        () => undefined
      )
      await vi.advanceTimersByTimeAsync(START_GRACE_MS)
    }
    expect(setSafeMode).not.toHaveBeenCalled()
    expect(counter(settings)).toBe('0')
  })

  it('still skips loading and tells the user when safe mode cannot be turned on', async () => {
    vi.useFakeTimers()
    const settings = memoryAppSettings()
    settings.data.set(FAILED_STARTS_KEY, String(MAX_FAILED_STARTS))
    const { setSafeMode, onSafeMode, onSafeModeFailed, run } = guard(settings)
    const failure = new Error('registry I/O')
    setSafeMode.mockRejectedValue(failure)
    const load = vi.fn(async () => {})
    await expect(run(load)).resolves.toBeUndefined()
    expect(load).not.toHaveBeenCalled()
    expect(onSafeMode).not.toHaveBeenCalled()
    expect(onSafeModeFailed).toHaveBeenCalledWith(failure)
    // Still counted, so the next start skips loading again.
    await vi.advanceTimersByTimeAsync(START_GRACE_MS)
    expect(counter(settings)).toBe(String(MAX_FAILED_STARTS + 1))
  })

  it('treats a garbled counter as zero', async () => {
    const settings = memoryAppSettings()
    settings.data.set(FAILED_STARTS_KEY, 'lots')
    const { setSafeMode, run } = guard(settings)
    await run(async () => {})
    expect(setSafeMode).not.toHaveBeenCalled()
  })
})
