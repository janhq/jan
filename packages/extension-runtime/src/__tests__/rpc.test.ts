import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExtensionError,
  toDisposable,
  type Disposable,
} from '@janhq/extension-api'
import {
  CancellationTokenSource,
  DisposableTable,
  Endpoint,
  HandleTable,
  callbackRef,
  isCallbackRef,
  parseWire,
  portTransport,
  type EndpointOptions,
  type Wire,
} from '../index.js'

const open: Endpoint[] = []

function pair(
  left: EndpointOptions = {},
  right: EndpointOptions = {}
): [Endpoint, Endpoint] {
  const { port1, port2 } = new MessageChannel()
  const a = new Endpoint(portTransport(port1), left)
  const b = new Endpoint(portTransport(port2), right)
  open.push(a, b)
  return [a, b]
}

afterEach(() => {
  for (const e of open.splice(0)) e.close()
})

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Endpoint', () => {
  it('correlates interleaved requests in both directions', async () => {
    const slow = deferred<string>()
    const [host, worker] = pair(
      {
        handle: async (method, args) =>
          method === 'slow' ? slow.promise : `host:${String(args[0])}`,
      },
      { handle: async (_method, args) => `worker:${String(args[0])}` }
    )
    const first = worker.request('slow', [])
    const second = worker.request('fast', [2])
    const third = host.request('fast', [3])
    await expect(second).resolves.toBe('host:2')
    await expect(third).resolves.toBe('worker:3')
    slow.resolve('late')
    await expect(first).resolves.toBe('late')
  })

  it('propagates error codes and maps unknown errors to E_INTERNAL', async () => {
    const [host, worker] = pair({
      handle: async (method) => {
        if (method === 'denied')
          throw new ExtensionError('E_PERMISSION', 'no grant')
        throw new Error('boom')
      },
    })
    void host
    await expect(worker.request('denied', [])).rejects.toMatchObject({
      code: 'E_PERMISSION',
      message: 'no grant',
    })
    await expect(worker.request('other', [])).rejects.toMatchObject({
      code: 'E_INTERNAL',
      message: 'boom',
    })
    await expect(worker.request('other', [])).rejects.toBeInstanceOf(
      ExtensionError
    )
  })

  it('times out and tells the other side to stop', async () => {
    let token: { isCancellationRequested: boolean } | undefined
    const [, worker] = pair({
      handle: (_m, _a, t) => {
        token = t
        return new Promise(() => {})
      },
    })
    await expect(
      worker.request('hang', [], { timeoutMs: 30 })
    ).rejects.toMatchObject({ code: 'E_TIMEOUT' })
    await vi.waitFor(() => expect(token?.isCancellationRequested).toBe(true))
  })

  it('uses a 30 s default timeout', async () => {
    vi.useFakeTimers()
    try {
      const [, worker] = pair({ handle: () => new Promise(() => {}) })
      const pending = worker.request('hang', [])
      const settled = vi.fn()
      pending.catch(settled)
      await vi.advanceTimersByTimeAsync(29_000)
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_500)
      expect(settled).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'E_TIMEOUT' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels at once and flips the handler token', async () => {
    const seen = deferred<void>()
    const flipped = vi.fn()
    const [host] = pair(
      {},
      {
        handle: (_m, _a, token) => {
          token.onCancellationRequested(flipped)
          seen.resolve()
          return new Promise(() => {})
        },
      }
    )
    const source = new CancellationTokenSource()
    const call = host.request('$invoke', [1, []], { token: source.token })
    await seen.promise
    source.cancel()
    await expect(call).rejects.toMatchObject({ code: 'E_CANCELLED' })
    await vi.waitFor(() => expect(flipped).toHaveBeenCalledTimes(1))
  })

  it('rejects a request already cancelled without sending it', async () => {
    const handle = vi.fn()
    const [host] = pair({}, { handle })
    const source = new CancellationTokenSource()
    source.cancel()
    await expect(
      host.request('x', [], { token: source.token })
    ).rejects.toMatchObject({ code: 'E_CANCELLED' })
    await new Promise((r) => setTimeout(r, 20))
    expect(handle).not.toHaveBeenCalled()
  })

  it('refuses oversized payloads in either direction', async () => {
    const [host, worker] = pair(
      {
        maxMessageBytes: 1024,
        handle: async () => 'x'.repeat(4096),
      },
      { handle: async () => 'y'.repeat(4096) }
    )
    // Outgoing: never sent.
    await expect(
      host.request('big', ['z'.repeat(4096)])
    ).rejects.toMatchObject({ code: 'E_TOO_LARGE' })
    // Incoming response over the receiver's limit.
    await expect(host.request('reply', [])).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
    // A response the host would send that exceeds its own limit.
    await expect(worker.request('reply', [])).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
  })

  it('caps the number of requests in flight', async () => {
    const [, worker] = pair({ handle: () => new Promise(() => {}) })
    const calls = Array.from({ length: 256 }, () =>
      worker.request('hang', []).catch(() => undefined)
    )
    await expect(worker.request('hang', [])).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
    void calls
  })

  it('refuses incoming requests beyond the in-flight cap', async () => {
    const [host, worker] = pair({
      maxInFlight: 2,
      handle: () => new Promise(() => {}),
    })
    void host
    void worker.request('a', []).catch(() => undefined)
    void worker.request('b', []).catch(() => undefined)
    // The worker side does not cap itself here; the host does.
    await expect(worker.request('c', [])).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
  })

  it('carries a disposable across and disposes it on request', async () => {
    // Worker side: callbacks by handle.
    const callbacks = new HandleTable<(args: unknown[]) => unknown>()
    // Host side: what each registration holds.
    const owned = new DisposableTable()
    const unregistered = vi.fn()
    let invokeWorker: ((handle: number, args: unknown[]) => unknown) | undefined

    const [host, worker] = pair(
      {
        handle: async (method, args) => {
          if (method === 'commands.register') {
            const [, ref] = args
            if (!isCallbackRef(ref)) throw new Error('expected a callback')
            invokeWorker = (handle, a) => host.request('$invoke', [handle, a])
            const registration: Disposable = toDisposable(unregistered)
            return { disposable: owned.add(registration), handle: ref.$callback }
          }
          if (method === '$dispose') {
            owned.dispose(args[0] as number)
            return undefined
          }
          throw new ExtensionError('E_NOT_FOUND', method)
        },
      },
      {
        handle: async (method, args) => {
          if (method !== '$invoke') throw new Error(method)
          const [handle, a] = args as [number, unknown[]]
          const fn = callbacks.get(handle)
          if (!fn) throw new ExtensionError('E_NOT_FOUND', 'no handler')
          return fn(a)
        },
      }
    )

    const handle = callbacks.add((a) => `hello ${String(a[0])}`)
    const reply = (await worker.request('commands.register', [
      'greet',
      callbackRef(handle),
    ])) as { disposable: number; handle: number }
    expect(reply.handle).toBe(handle)
    await expect(invokeWorker?.(reply.handle, ['jan'])).resolves.toBe(
      'hello jan'
    )

    await worker.request('$dispose', [reply.disposable])
    expect(unregistered).toHaveBeenCalledTimes(1)
    callbacks.delete(handle)
    await expect(invokeWorker?.(handle, [])).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    })
  })

  it('fans events out to every subscriber of a sub id', async () => {
    const one = vi.fn()
    const two = vi.fn()
    const other = vi.fn()
    const [host, worker] = pair()
    worker.onEvent(1, one)
    worker.onEvent(1, two)
    worker.onEvent(2, other)
    host.notify(1, { key: 'greeting', value: 'Hi' })
    await vi.waitFor(() => expect(two).toHaveBeenCalled())
    expect(one).toHaveBeenCalledWith({ key: 'greeting', value: 'Hi' })
    expect(other).not.toHaveBeenCalled()
  })

  it('stops delivering an event to a disposed listener', async () => {
    const listener = vi.fn()
    const [host, worker] = pair()
    worker.onEvent(7, listener).dispose()
    host.notify(7, 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(listener).not.toHaveBeenCalled()
  })

  it('cleans up when the port closes', async () => {
    let token: { isCancellationRequested: boolean } | undefined
    const [host, worker] = pair(
      {},
      {
        handle: (_m, _a, t) => {
          token = t
          return new Promise(() => {})
        },
      }
    )
    const closed = vi.fn()
    host.onDidClose(closed)
    const pending = host.request('hang', [])
    await vi.waitFor(() => expect(token).toBeDefined())
    worker.close()
    await expect(pending).rejects.toMatchObject({ code: 'E_DISPOSED' })
    expect(token?.isCancellationRequested).toBe(true)
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    await expect(host.request('after', [])).rejects.toMatchObject({
      code: 'E_DISPOSED',
    })
  })

  it('passes control messages through and ignores malformed ones', async () => {
    const control = vi.fn()
    const { port1, port2 } = new MessageChannel()
    const host = new Endpoint(portTransport(port1), { onControl: control })
    open.push(host)
    port2.postMessage({ t: 'ready' })
    port2.postMessage({ v: 2, t: 'ready' })
    port2.postMessage({ v: 1, t: 'res', id: 'x', ok: true })
    port2.postMessage('hello')
    port2.postMessage({ v: 1, t: 'ready' })
    await vi.waitFor(() => expect(control).toHaveBeenCalledTimes(1))
    expect(control).toHaveBeenCalledWith({ v: 1, t: 'ready' })
    port2.close()
  })
})

describe('parseWire', () => {
  it('accepts every message kind of version 1', () => {
    const messages: Wire[] = [
      {
        v: 1,
        t: 'init',
        manifest: {
          name: '@acme/one',
          version: '1.0.0',
          id: 'acme.one',
          displayName: 'One',
          publisher: 'Acme',
          apiVersion: '^0.1.0',
          main: 'dist/index.js',
          permissions: ['tools'],
        },
      },
      { v: 1, t: 'ready' },
      {
        v: 1,
        t: 'activateFailed',
        error: { code: 'E_INTERNAL', message: 'x' },
      },
      { v: 1, t: 'req', id: 1, method: 'm', args: [] },
      { v: 1, t: 'res', id: 1, ok: true, value: 3 },
      {
        v: 1,
        t: 'res',
        id: 1,
        ok: false,
        error: { code: 'E_TIMEOUT', message: 'x' },
      },
      { v: 1, t: 'cancel', id: 1 },
      { v: 1, t: 'evt', sub: 1, value: null },
      { v: 1, t: 'ping', n: 1 },
      { v: 1, t: 'pong', n: 1 },
    ]
    for (const m of messages) expect(parseWire(m)).toEqual(m)
  })

  it('maps an unknown error code to E_INTERNAL', () => {
    expect(
      parseWire({
        v: 1,
        t: 'res',
        id: 1,
        ok: false,
        error: { code: 'E_WHATEVER', message: 'x' },
      })
    ).toEqual({
      v: 1,
      t: 'res',
      id: 1,
      ok: false,
      error: { code: 'E_INTERNAL', message: 'x' },
    })
  })

  it('rejects malformed messages', () => {
    for (const m of [
      null,
      1,
      { v: 1 },
      { v: 1, t: 'req', id: 1, method: 2, args: [] },
      { v: 1, t: 'req', id: 1.5, method: 'm', args: [] },
      { v: 1, t: 'req', id: 1, method: 'm', args: {} },
      { v: 1, t: 'evt', sub: 'a', value: 1 },
      { v: 1, t: 'init' },
      { v: 1, t: 'init', manifest: [] },
    ]) {
      expect(parseWire(m)).toBeUndefined()
    }
  })
})
