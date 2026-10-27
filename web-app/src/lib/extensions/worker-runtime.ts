import {
  ExtensionError,
  type CancellationToken,
  type CommandHandler,
  type ProviderHandlers,
  type ToolHandler,
  type ValidatedManifest,
} from '@janhq/extension-api'
import {
  ACTIVATE_TIMEOUT_MS,
  DEACTIVATE_METHOD,
  DISPOSE_METHOD,
  DisposableTable,
  Endpoint,
  INVOKE_METHOD,
  composeWorkerSource,
  fromRpcError,
  isCallbackRef,
  isEventRef,
  isHostMethod,
  workerTransport,
  type HostMethod,
  type WorkerLike,
} from '@janhq/extension-runtime'
import prelude from '@janhq/extension-runtime/prelude-source'
import type { PermissionDispatcher } from './dispatcher'
import { rateLimiter, type HostApi } from './host-api'
import { startHeartbeat, type Heartbeat } from './watchdog'

/** Creates the Worker for a composed script; injectable so tests need none. */
export type CreateWorker = (source: string, name: string) => WorkerLike

/** A running worker extension, as the host holds it. */
export interface WorkerConnection {
  /** Asks the extension to run `deactivate`; never rejects. */
  deactivate(): Promise<void>
  /** Stops the worker at once and releases everything it registered. */
  terminate(): void
}

// The worker enforces its own 10 s activate cap; this one only catches a
// worker that never answers at all (a script that hangs before booting).
const HOST_ACTIVATE_TIMEOUT_MS = ACTIVATE_TIMEOUT_MS + 5_000
const DEACTIVATE_TIMEOUT_MS = 5_000
// Longer than the RPC default: a tool may legitimately take a while, and
// Stop cancels it at any time.
export const TOOL_CALL_TIMEOUT_MS = 120_000

/**
 * The policy every extension worker runs under. A blob: worker inherits the
 * CSP of the document that creates it, so the workers are created from a
 * hidden same-origin frame carrying this policy instead of from the app
 * window, whose connect-src must allow https: and loopback. The engine then
 * refuses every network primitive (fetch, XHR, WebSocket, WebSocketStream,
 * EventSource, WebTransport, import(), FontFace, ...), including ones a
 * future engine adds, whatever globals the prelude failed to strip. The
 * stripping stays as a second layer.
 *
 * - default-src 'none': no fetch directive allows any URL.
 * - script-src 'wasm-unsafe-eval': WebAssembly compiles, eval does not.
 * - worker-src blob:: what lets the frame start the worker at all.
 */
export const WORKER_CSP = [
  "default-src 'none'",
  "script-src 'wasm-unsafe-eval'",
  'worker-src blob:',
].join('; ')

/** What createBlobWorker needs from the realm it builds workers in. */
export interface WorkerRealm {
  Worker: new (url: string, options: { name: string }) => Worker
  Blob: typeof Blob
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

let realmFrame: HTMLIFrameElement | undefined

/**
 * The window of a hidden about:blank frame whose only content is a meta
 * CSP of WORKER_CSP; created on first use and again if it left the
 * document. about:blank shares the app's origin, so the blob: URLs it
 * mints are same-origin and messages carry no origin checks of their own.
 * A meta CSP can only add restrictions, and the frame also inherits the
 * app's policy, so the workers get the intersection of the two: still no
 * eval, and now no network.
 */
export function workerRealm(doc: Document = document): WorkerRealm {
  if (realmFrame?.isConnected && realmFrame.contentWindow)
    return realmFrame.contentWindow as unknown as WorkerRealm
  realmFrame?.remove()
  const frame = doc.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  doc.body.appendChild(frame)
  const inner = frame.contentDocument
  if (!inner || !frame.contentWindow)
    throw new ExtensionError('E_INTERNAL', 'The worker frame did not load')
  const meta = inner.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = WORKER_CSP
  inner.head.appendChild(meta)
  realmFrame = frame
  return frame.contentWindow as unknown as WorkerRealm
}

/**
 * The app's factory: one classic Worker per extension from a blob URL, so
 * the composed script is the worker's own script, created in workerRealm
 * so that it runs under WORKER_CSP. The URL is revoked once the worker has
 * spoken, which proves it loaded the script.
 */
export const createBlobWorker: CreateWorker = (source, name) => {
  const realm = workerRealm()
  const url = realm.URL.createObjectURL(
    new realm.Blob([source], { type: 'text/javascript' })
  )
  const worker = new realm.Worker(url, { name })
  const revoke = () => realm.URL.revokeObjectURL(url)
  worker.addEventListener('message', revoke, { once: true })
  worker.addEventListener('error', revoke, { once: true })
  // A script that never posts nor throws (a top-level endless loop) would
  // otherwise keep the URL alive; revoking twice is harmless.
  return {
    postMessage: (message) => worker.postMessage(message),
    addEventListener: worker.addEventListener.bind(worker),
    removeEventListener: worker.removeEventListener.bind(worker),
    terminate: () => {
      worker.terminate()
      revoke()
    },
  }
}

/**
 * Strikes a worker may collect before it is stopped, one forgiven every
 * STRIKE_FORGIVE_MS. A strike is a message refused before any handler ran
 * (malformed, over the size cap, over the message rate) or a call the
 * dispatcher refused (no grant, bad arguments, over a limit). A real
 * extension rarely earns one; a stream of them only costs the main thread.
 */
export const MAX_REJECTED_MESSAGES = 16
const STRIKE_FORGIVE_MS = 10_000
/**
 * Messages of all kinds a worker may send: a burst, then a steady rate.
 * Checked before a message is sized, validated or dispatched, so a flood
 * of calls that would each pass costs the main thread little.
 */
export const MESSAGE_BURST = 200
const MESSAGES_PER_SECOND = 50
// What a misbehaving call is refused with, as opposed to a failure of the
// work it asked for (E_NOT_FOUND, E_TIMEOUT, ...).
const STRIKE_CODES: ReadonlySet<string> = new Set([
  'E_PERMISSION',
  'E_INVALID_ARGS',
  'E_TOO_LARGE',
])

const REGISTRATIONS: ReadonlySet<HostMethod> = new Set<HostMethod>([
  'commands.register',
  'tools.register',
  'providers.register',
  'events.subscribe',
])

/**
 * Starts one worker extension and resolves once it reported `ready`. On
 * any failure the worker is terminated and the promise rejects with the
 * reason, so the caller never holds a half-started worker.
 */
export function startWorker(options: {
  manifest: ValidatedManifest
  bundle: string
  createWorker: CreateWorker
  dispatcher: PermissionDispatcher
  api: HostApi
  /**
   * Runs once if the runtime stops the worker after it started: it stopped
   * answering pings, or kept breaking the limits. A failure before `ready`
   * rejects the start instead.
   */
  onCrash?(error: ExtensionError): void
}): Promise<WorkerConnection> {
  const { manifest, dispatcher, api } = options
  const owned = new DisposableTable()

  const invoke = (
    handle: number,
    args: unknown[],
    token?: CancellationToken,
    timeoutMs?: number
  ) => endpoint.request(INVOKE_METHOD, [handle, args], { token, timeoutMs })

  // Replaces the handle references a worker sends where a host method
  // takes a function. Anything malformed is left as is and refused by the
  // method's argument validation.
  const revive = (method: HostMethod, args: unknown[]): unknown[] => {
    const [first, second] = args
    switch (method) {
      case 'commands.register': {
        if (!isCallbackRef(second)) return args
        const handler: CommandHandler = (context, ...rest) =>
          invoke(second.$callback, [context, ...rest])
        return [first, handler]
      }
      case 'tools.register': {
        if (!isCallbackRef(second)) return args
        const handler: ToolHandler = (input, token) =>
          invoke(
            second.$callback,
            [input],
            token,
            TOOL_CALL_TIMEOUT_MS
          ) as ReturnType<ToolHandler>
        return [first, handler]
      }
      case 'providers.register': {
        if (typeof second !== 'object' || second === null) return args
        const { listModels } = second as { listModels?: unknown }
        if (listModels === undefined) return [first, {}]
        if (!isCallbackRef(listModels)) return args
        const handlers: ProviderHandlers = {
          // The host validates what comes back where it uses the models.
          listModels: () =>
            invoke(listModels.$callback, []) as ReturnType<
              NonNullable<ProviderHandlers['listModels']>
            >,
        }
        return [first, handlers]
      }
      case 'events.subscribe': {
        if (!isEventRef(second)) return args
        const sub = second.$event
        return [first, (value: unknown) => endpoint.notify(sub, value)]
      }
      default:
        return args
    }
  }

  const worker = options.createWorker(
    composeWorkerSource(prelude, options.bundle),
    `ext:${manifest.id}`
  )
  // An uncaught error in the composed script (a syntax error in the bundle,
  // a prelude that refused to start) ends startup.
  const onError = (e: { message: string }) =>
    settle(new ExtensionError('E_INTERNAL', e.message || 'The worker failed'))
  worker.addEventListener('error', onError)

  // Aborted on terminate, so host-side work (a fetch) stops with the worker.
  const lifetime = new AbortController()
  const admit = rateLimiter(MESSAGE_BURST, MESSAGES_PER_SECOND)
  // The last strike is the one the bucket has no token for.
  const strikeForgiven = rateLimiter(
    MAX_REJECTED_MESSAGES - 1,
    1000 / STRIKE_FORGIVE_MS
  )
  const strike = (error: ExtensionError) => {
    if (lifetime.signal.aborted || strikeForgiven()) return
    console.warn(
      `Extension '${manifest.id}' was stopped after ${MAX_REJECTED_MESSAGES} refused messages:`,
      error.message
    )
    crash(error)
  }
  // Ends the worker for misbehaving: before `ready` that fails the start,
  // after it the host hears about it.
  const crash = (error: ExtensionError) => {
    if (lifetime.signal.aborted) return
    const running = settled
    settle(error)
    terminate()
    if (running) options.onCrash?.(error)
  }
  let heartbeat: Heartbeat | undefined

  const endpoint: Endpoint = new Endpoint(
    workerTransport(worker),
    {
      admit,
      onRejected: strike,
      handle: async (method, args, token) => {
        if (method === DISPOSE_METHOD) {
          const [id] = args
          if (typeof id === 'number') owned.dispose(id)
          return undefined
        }
        if (!isHostMethod(method))
          throw new ExtensionError('E_NOT_FOUND', `Unknown method '${method}'`)
        // The worker's cancellation and the worker's end both abort it.
        const call = new AbortController()
        const abort = () => call.abort()
        lifetime.signal.addEventListener('abort', abort)
        const cancellation = token.onCancellationRequested(abort)
        try {
          const result = await dispatcher.dispatch(
            manifest,
            api,
            method,
            revive(method, args),
            { signal: call.signal }
          )
          if (REGISTRATIONS.has(method))
            return { disposable: owned.add(result as { dispose(): void }) }
          return result
        } catch (error) {
          if (error instanceof ExtensionError && STRIKE_CODES.has(error.code))
            strike(error)
          throw error
        } finally {
          cancellation.dispose()
          lifetime.signal.removeEventListener('abort', abort)
        }
      },
      onControl: (message) => {
        if (message.t === 'pong') heartbeat?.pong(message.n)
        else if (message.t === 'ready') settle()
        else if (message.t === 'activateFailed')
          settle(fromRpcError(message.error))
      },
    }
  )

  const terminate = () => {
    heartbeat?.dispose()
    worker.removeEventListener('error', onError)
    lifetime.abort()
    endpoint.close()
    owned.disposeAll()
  }

  let settle: (error?: Error) => void = () => undefined
  let settled = false
  return new Promise<WorkerConnection>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        settle(
          new ExtensionError(
            'E_TIMEOUT',
            `Extension '${manifest.id}' did not start in time`
          )
        ),
      HOST_ACTIVATE_TIMEOUT_MS
    )
    settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        terminate()
        reject(error)
        return
      }
      heartbeat = startHeartbeat({
        ping: (n) => {
          if (!endpoint.disposed) endpoint.sendControl({ v: 1, t: 'ping', n })
        },
        onDead: () => {
          console.warn(`Extension '${manifest.id}' stopped responding`)
          crash(
            new ExtensionError(
              'E_TIMEOUT',
              `Extension '${manifest.id}' stopped responding`
            )
          )
        },
      })
      resolve({
        deactivate: async () => {
          try {
            await endpoint.request(DEACTIVATE_METHOD, [], {
              timeoutMs: DEACTIVATE_TIMEOUT_MS,
            })
          } catch (error) {
            console.warn(`Extension '${manifest.id}' failed to deactivate:`, error)
          }
        },
        terminate,
      })
    }
    endpoint.sendControl({ v: 1, t: 'init', manifest })
  })
}
