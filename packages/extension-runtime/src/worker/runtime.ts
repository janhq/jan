import {
  ExtensionError,
  type ExtensionContext,
  type ExtensionModule,
  type ValidatedManifest,
} from '@janhq/extension-api'
import { Endpoint, type Transport } from '../endpoint.js'
import { toRpcError } from '../errors.js'
import { HandleTable } from '../handles.js'
import {
  DEACTIVATE_METHOD,
  INVOKE_METHOD,
  type ControlMessage,
} from '../protocol.js'
import { createWorkerContext, type WorkerCallback } from './context.js'
import type { Realm } from './realm.js'
import { stripGlobals } from './strip.js'

/** How long `activate` may take before the worker reports a timeout. */
export const ACTIVATE_TIMEOUT_MS = 10_000

/** The name the composed source calls once the bundle has run. */
export const BOOT_FUNCTION = '__janBoot'

/** The part of a worker global the runtime uses before it strips the rest. */
interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  removeEventListener(
    type: 'message',
    listener: (e: { data: unknown }) => void
  ): void
  close?(): void
}

const isScope = (v: object): v is WorkerScope =>
  typeof (v as Partial<WorkerScope>).postMessage === 'function' &&
  typeof (v as Partial<WorkerScope>).addEventListener === 'function'

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ExtensionError('E_TIMEOUT', `${what} took over ${ms} ms`)),
      ms
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 * Sets up the worker side before any extension code runs: captures the
 * messaging primitives, strips the network and Tauri globals, opens the RPC
 * endpoint and defines `__janBoot`. If stripping fails it reports and
 * throws, which aborts the rest of the composed script, so extension code
 * never runs with the globals still in place.
 */
export function installRuntime(realm: Realm): void {
  const scope = realm.global
  if (!isScope(scope)) throw realm.replaced('postMessage')
  // Captured first; a forged message from extension code could only reach
  // the same host-checked API, so these are not hidden afterwards.
  const post = scope.postMessage.bind(scope)
  const listen = scope.addEventListener.bind(scope)
  const unlisten = scope.removeEventListener.bind(scope)
  const closeScope = scope.close?.bind(scope)

  try {
    stripGlobals(realm, scope)
  } catch (error) {
    post({ v: 1, t: 'activateFailed', error: toRpcError(error) })
    throw error
  }

  const callbacks = new HandleTable<WorkerCallback>()
  let manifest: ValidatedManifest | undefined
  let module: ExtensionModule | null | undefined
  let ctx: ExtensionContext | undefined
  let booted = false

  const transport: Transport = {
    send: (message) => post(message),
    onMessage: (listener) => {
      const handler = (e: { data: unknown }) => listener(e.data)
      listen('message', handler)
      return { dispose: () => unlisten('message', handler) }
    },
    close: () => closeScope?.(),
  }

  const endpoint: Endpoint = new Endpoint(transport, {
    onControl: (message: ControlMessage) => {
      // The host's liveness check: a worker stuck in a loop cannot answer.
      if (message.t === 'ping') {
        endpoint.sendControl({ v: 1, t: 'pong', n: message.n })
        return
      }
      if (message.t !== 'init' || manifest) return
      manifest = message.manifest
      void start()
    },
    handle: async (method, args, token) => {
      if (method === INVOKE_METHOD) {
        const [handle, callArgs] = args
        const fn = typeof handle === 'number' ? callbacks.get(handle) : undefined
        if (!fn)
          throw new ExtensionError('E_NOT_FOUND', 'The callback was disposed')
        return fn(Array.isArray(callArgs) ? callArgs : [], token)
      }
      if (method === DEACTIVATE_METHOD) {
        try {
          await module?.deactivate?.()
        } finally {
          ctx?.subscriptions.dispose()
        }
        return undefined
      }
      throw new ExtensionError('E_NOT_FOUND', `Unknown method '${method}'`)
    },
  })

  const fail = (error: unknown) =>
    endpoint.sendControl({ v: 1, t: 'activateFailed', error: toRpcError(error) })

  // Runs once both the host's init and the bundle's module are in.
  const start = async () => {
    if (!manifest || module === undefined || booted) return
    booted = true
    const mod = module
    if (!mod || typeof mod.activate !== 'function') {
      fail(
        new ExtensionError(
          'E_INVALID_ARGS',
          "The bundle does not define 'JanExtension' with an activate function"
        )
      )
      return
    }
    const worker = createWorkerContext(manifest, endpoint, callbacks)
    ctx = worker.ctx
    try {
      await withTimeout(
        (async () => {
          await mod.activate(worker.ctx)
          await worker.settled()
        })(),
        ACTIVATE_TIMEOUT_MS,
        'activate'
      )
      endpoint.sendControl({ v: 1, t: 'ready' })
    } catch (error) {
      fail(error)
    }
  }

  realm.defineProperty(scope, BOOT_FUNCTION, {
    value: (mod: unknown) => {
      if (module !== undefined) return
      module =
        typeof mod === 'object' || typeof mod === 'function'
          ? (mod as ExtensionModule | null)
          : null
      void start()
    },
    writable: false,
    enumerable: false,
    configurable: false,
  })
}
