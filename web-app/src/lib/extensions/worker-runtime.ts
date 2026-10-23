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
import type { HostApi } from './host-api'

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
 * The app's factory: one classic Worker per extension from a blob URL, so
 * the composed script is the worker's own script (the CSP allows blob: for
 * workers but no eval). The URL is revoked once the worker has spoken,
 * which proves it loaded the script.
 */
export const createBlobWorker: CreateWorker = (source, name) => {
  const url = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' })
  )
  const worker = new Worker(url, { name })
  const revoke = () => URL.revokeObjectURL(url)
  worker.addEventListener('message', revoke, { once: true })
  worker.addEventListener('error', revoke, { once: true })
  return worker
}

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

  const endpoint: Endpoint = new Endpoint(
    workerTransport(worker),
    {
      handle: async (method, args) => {
        if (method === DISPOSE_METHOD) {
          const [id] = args
          if (typeof id === 'number') owned.dispose(id)
          return undefined
        }
        if (!isHostMethod(method))
          throw new ExtensionError('E_NOT_FOUND', `Unknown method '${method}'`)
        const result = await dispatcher.dispatch(
          manifest,
          api,
          method,
          revive(method, args)
        )
        if (REGISTRATIONS.has(method))
          return { disposable: owned.add(result as { dispose(): void }) }
        return result
      },
      onControl: (message) => {
        if (message.t === 'ready') settle()
        else if (message.t === 'activateFailed')
          settle(fromRpcError(message.error))
      },
    }
  )

  const terminate = () => {
    worker.removeEventListener('error', onError)
    endpoint.close()
    owned.disposeAll()
  }

  let settle: (error?: Error) => void = () => undefined
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
    let settled = false
    settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        terminate()
        reject(error)
        return
      }
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
