import {
  Emitter,
  ExtensionError,
  type CancellationToken,
  type Disposable,
  type Event as ApiEvent,
} from '@janhq/extension-api'
import { fromRpcError, toRpcError, type RpcError } from './errors.js'
import { CancellationTokenSource } from './handles.js'
import { parseWire, type ControlMessage, type Wire } from './protocol.js'

/** Per-message cap, on the JSON size estimate of the whole message. */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024
/** Requests one side may have outstanding, and may be serving, at once. */
export const MAX_IN_FLIGHT = 256
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * A message channel to the other side. The worker global, a `Worker` and a
 * `MessagePort` all fit with a thin adapter, so the endpoint never touches
 * globals itself (which matters once the prelude has stripped them).
 */
export interface Transport {
  send(message: Wire): void
  onMessage(listener: (data: unknown) => void): Disposable
  /** Fires when the other side went away, where the channel can tell. */
  onClose?(listener: () => void): Disposable
  close(): void
}

/** What `portTransport` needs; node and DOM message ports both have it. */
export interface PortLike {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (e: Event) => void): void
  removeEventListener(type: string, listener: (e: Event) => void): void
  start?(): void
  close(): void
}

export function portTransport(port: PortLike): Transport {
  return {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => {
      const handler = (e: Event) => listener((e as MessageEvent).data)
      port.addEventListener('message', handler)
      port.start?.()
      return { dispose: () => port.removeEventListener('message', handler) }
    },
    // Node ports fire `close` on both ends; DOM ports do not, and there the
    // host closes the channel itself when it terminates the worker.
    onClose: (listener) => {
      port.addEventListener('close', listener)
      return { dispose: () => port.removeEventListener('close', listener) }
    },
    close: () => port.close(),
  }
}

export type RequestHandler = (
  method: string,
  args: unknown[],
  token: CancellationToken
) => unknown

export interface EndpointOptions {
  /** Serves the other side's requests; absent means every request fails. */
  handle?: RequestHandler
  /** Receives lifecycle messages (`init`, `ready`, `ping`, ...). */
  onControl?: (message: ControlMessage) => void
  /**
   * Hears about every message refused without reaching a handler: one that
   * is malformed or over the size cap. The host counts them to stop a
   * worker that floods it.
   */
  onRejected?: (error: ExtensionError) => void
  maxMessageBytes?: number
  maxInFlight?: number
  defaultTimeoutMs?: number
}

export interface RequestOptions {
  /** Milliseconds before `E_TIMEOUT`; null waits until cancelled or closed. */
  timeoutMs?: number | null
  token?: CancellationToken
}

interface Pending {
  resolve(value: unknown): void
  reject(error: ExtensionError): void
  cleanup(): void
}

// Structured clone and JSON differ, but JSON length is a cheap, safe upper
// bound for the strings and plain objects this protocol carries.
function estimateSize(message: Wire): number | undefined {
  try {
    return JSON.stringify(message)?.length ?? 0
  } catch {
    return undefined
  }
}

const tooLarge = (limit: number) =>
  new ExtensionError('E_TOO_LARGE', `Message exceeds ${limit} bytes`)

/**
 * One side of the RPC channel. It correlates requests and responses, runs
 * the timeout and in-flight limits, carries cancellation both ways and
 * delivers pushed events. It knows nothing about methods: the host
 * dispatcher and the worker context decide what each one means.
 */
export class Endpoint {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly serving = new Map<number, CancellationTokenSource>()
  private readonly events = new Map<number, Set<(value: unknown) => void>>()
  private readonly subscriptions: Disposable[] = []
  private readonly closed = new Emitter<void>()
  private isClosed = false
  private readonly maxBytes: number
  private readonly maxInFlight: number
  private readonly defaultTimeout: number

  /** Fires once, when either side closes the channel. */
  readonly onDidClose: ApiEvent<void> = this.closed.event

  constructor(
    private readonly transport: Transport,
    private readonly options: EndpointOptions = {}
  ) {
    this.maxBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES
    this.maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT
    this.defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.subscriptions.push(transport.onMessage((data) => this.receive(data)))
    const onClose = transport.onClose?.(() => this.close())
    if (onClose) this.subscriptions.push(onClose)
  }

  get disposed(): boolean {
    return this.isClosed
  }

  request(
    method: string,
    args: unknown[],
    options: RequestOptions = {}
  ): Promise<unknown> {
    if (this.isClosed)
      return Promise.reject(
        new ExtensionError('E_DISPOSED', 'The extension channel is closed')
      )
    const { token } = options
    if (token?.isCancellationRequested)
      return Promise.reject(new ExtensionError('E_CANCELLED', 'Cancelled'))
    if (this.pending.size >= this.maxInFlight)
      return Promise.reject(
        new ExtensionError(
          'E_TOO_LARGE',
          `More than ${this.maxInFlight} requests in flight`
        )
      )
    const id = this.nextId++
    const failure = this.trySend({ v: 1, t: 'req', id, method, args })
    if (failure) return Promise.reject(failure)

    return new Promise((resolve, reject) => {
      const timeoutMs =
        options.timeoutMs === undefined ? this.defaultTimeout : options.timeoutMs
      // Giving up on a request tells the other side, so its handler can stop.
      const abandon = (error: ExtensionError) => {
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        entry.cleanup()
        this.trySend({ v: 1, t: 'cancel', id })
        reject(error)
      }
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(
              () =>
                abandon(
                  new ExtensionError(
                    'E_TIMEOUT',
                    `'${method}' timed out after ${timeoutMs} ms`
                  )
                ),
              timeoutMs
            )
      const cancellation = token?.onCancellationRequested(() =>
        abandon(new ExtensionError('E_CANCELLED', `'${method}' was cancelled`))
      )
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          if (timer !== undefined) clearTimeout(timer)
          cancellation?.dispose()
        },
      })
    })
  }

  /** Pushes an event to the other side's listeners of `sub`. */
  notify(sub: number, value: unknown): void {
    const failure = this.trySend({ v: 1, t: 'evt', sub, value })
    if (failure) console.warn(`Event ${sub} was not delivered:`, failure.message)
  }

  /** Listens to events pushed for `sub`; several listeners may share one. */
  onEvent(sub: number, listener: (value: unknown) => void): Disposable {
    let set = this.events.get(sub)
    if (!set) {
      set = new Set()
      this.events.set(sub, set)
    }
    set.add(listener)
    return {
      dispose: () => {
        const current = this.events.get(sub)
        current?.delete(listener)
        if (current?.size === 0) this.events.delete(sub)
      },
    }
  }

  sendControl(message: ControlMessage): void {
    const failure = this.trySend(message)
    if (failure) throw failure
  }

  /**
   * Closes the channel: pending requests fail with `E_DISPOSED`, handlers
   * still running see their token cancelled, and nothing more is sent.
   */
  close(): void {
    if (this.isClosed) return
    this.isClosed = true
    for (const d of this.subscriptions.splice(0)) d.dispose()
    const disposed = new ExtensionError(
      'E_DISPOSED',
      'The extension channel closed'
    )
    for (const entry of this.pending.values()) {
      entry.cleanup()
      entry.reject(disposed)
    }
    this.pending.clear()
    for (const source of this.serving.values()) source.cancel()
    this.serving.clear()
    this.events.clear()
    try {
      this.transport.close()
    } catch (error) {
      console.warn('Closing the extension channel failed:', error)
    }
    this.closed.fire()
    this.closed.dispose()
  }

  private trySend(message: Wire): ExtensionError | undefined {
    if (this.isClosed)
      return new ExtensionError('E_DISPOSED', 'The extension channel is closed')
    const size = estimateSize(message)
    if (size === undefined)
      return new ExtensionError('E_INVALID_ARGS', 'Message is not serializable')
    if (size > this.maxBytes) return tooLarge(this.maxBytes)
    try {
      this.transport.send(message)
      return undefined
    } catch (error) {
      // DataCloneError: a function or a host object in the payload.
      return new ExtensionError(
        'E_INVALID_ARGS',
        error instanceof Error ? error.message : 'Message could not be sent'
      )
    }
  }

  private receive(data: unknown): void {
    if (this.isClosed) return
    const message = parseWire(data)
    if (!message) {
      this.options.onRejected?.(
        new ExtensionError('E_INVALID_ARGS', 'Malformed message')
      )
      return
    }
    const size = estimateSize(message)
    const oversized = size === undefined || size > this.maxBytes
    if (oversized) this.options.onRejected?.(tooLarge(this.maxBytes))
    switch (message.t) {
      case 'req':
        if (oversized) return this.respondError(message.id, tooLarge(this.maxBytes))
        return this.serve(message.id, message.method, message.args)
      case 'res': {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        entry.cleanup()
        if (oversized) entry.reject(tooLarge(this.maxBytes))
        else if (message.ok) entry.resolve(message.value)
        else entry.reject(fromRpcError(message.error))
        return
      }
      case 'cancel':
        this.serving.get(message.id)?.cancel()
        return
      case 'evt': {
        if (oversized) return
        for (const listener of [...(this.events.get(message.sub) ?? [])]) {
          try {
            listener(message.value)
          } catch (error) {
            console.error('Event listener failed:', error)
          }
        }
        return
      }
      default:
        this.options.onControl?.(message)
    }
  }

  private serve(id: number, method: string, args: unknown[]): void {
    const { handle } = this.options
    if (!handle)
      return this.respondError(
        id,
        new ExtensionError('E_NOT_FOUND', `No handler for '${method}'`)
      )
    if (this.serving.size >= this.maxInFlight)
      return this.respondError(
        id,
        new ExtensionError(
          'E_TOO_LARGE',
          `More than ${this.maxInFlight} requests in flight`
        )
      )
    const source = new CancellationTokenSource()
    this.serving.set(id, source)
    void (async () => {
      let reply: Wire
      try {
        const value = await handle(method, args, source.token)
        reply = { v: 1, t: 'res', id, ok: true, value }
      } catch (error) {
        reply = { v: 1, t: 'res', id, ok: false, error: toRpcError(error) }
      }
      this.serving.delete(id)
      // The requester stopped waiting; an answer now would only be dropped.
      if (source.token.isCancellationRequested) return
      const failure = this.trySend(reply)
      if (failure && failure.code !== 'E_DISPOSED')
        this.respondError(id, failure)
    })()
  }

  private respondError(id: number, error: ExtensionError): void {
    const rpc: RpcError = toRpcError(error)
    this.trySend({ v: 1, t: 'res', id, ok: false, error: rpc })
  }
}
