import { runInContext, createContext } from 'node:vm'
import { MessageChannel } from 'node:worker_threads'
import type { WorkerLike } from '../worker-like.js'

/**
 * Names a real dedicated worker scope carries that the prelude has to strip.
 * The fakes record calls, so a test can tell a stripped name from one that
 * slipped through.
 */
const NETWORK_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'Notification',
  'indexedDB',
  'caches',
] as const

export interface SandboxOptions {
  /** Extra or replacement globals, set as own properties of the scope. */
  globals?: Record<string, unknown>
  /** The worker `name`, as `new Worker(url, { name })` would set it. */
  name?: string
}

/** A composed worker script running in a `node:vm` realm. */
export interface SandboxWorker extends WorkerLike {
  /** The worker's global object, for inspecting what the prelude left. */
  readonly scope: Record<string, unknown>
  /** Calls user code made to a fake network or Tauri global. */
  readonly leaks: string[]
  readonly terminated: boolean
}

type Listener = (e: { data: unknown }) => void
type ErrorListener = (e: { message: string }) => void

// Built inside the realm so the prototype chain ends at the realm's own
// Object.prototype, where the prelude stops walking, as in a real worker.
const SCOPE_SETUP = `(() => {
  const eventTarget = Object.create(Object.prototype)
  const workerGlobalScope = Object.create(eventTarget)
  const dedicated = Object.create(workerGlobalScope)
  const workerNavigator = Object.create(Object.prototype)
  Object.setPrototypeOf(globalThis, dedicated)
  return { eventTarget, workerGlobalScope, dedicated, workerNavigator }
})()`

/**
 * Runs `source` the way a dedicated classic worker would: as one script, in
 * its own realm, with a WorkerGlobalScope-like prototype chain carrying
 * `fetch` and friends, and messages crossing a real `MessageChannel`, so
 * they are structured-cloned. `@vitest/web-worker` runs workers in the test
 * realm, which would exercise neither the composed source nor the stripping.
 *
 * Timers go through the test realm's current `setTimeout`, so fake timers
 * reach the sandbox too.
 */
export function runInSandbox(
  source: string,
  options: SandboxOptions = {}
): SandboxWorker {
  const { port1: hostPort, port2: workerPort } = new MessageChannel()
  const leaks: string[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const workerListeners = new Set<Listener>()
  const hostListeners = new Set<Listener>()
  const errorListeners = new Set<ErrorListener>()
  let terminated = false

  const context = createContext({})
  const realm = runInContext(SCOPE_SETUP, context) as Record<string, object>
  const scope = runInContext('globalThis', context) as Record<string, unknown>

  const define = (target: object, values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: false,
        configurable: true,
      })
  }

  const fake = (name: string) =>
    function leaked() {
      leaks.push(name)
    }

  define(realm.eventTarget, {
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') workerListeners.add(listener)
    },
    removeEventListener: (type: string, listener: Listener) => {
      if (type === 'message') workerListeners.delete(listener)
    },
  })
  define(
    realm.workerGlobalScope,
    Object.fromEntries(NETWORK_GLOBALS.map((n) => [n, fake(n)]))
  )
  define(realm.workerGlobalScope, {
    setTimeout: (fn: () => void, ms?: number) => {
      const id = setTimeout(() => {
        timers.delete(id)
        if (!terminated) fn()
      }, ms)
      timers.add(id)
      return id
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id)
      clearTimeout(id)
    },
    queueMicrotask: (fn: () => void) => queueMicrotask(fn),
    console,
  })
  Object.defineProperty(realm.workerGlobalScope, 'self', {
    get: () => scope,
    configurable: true,
  })
  Object.defineProperty(realm.workerGlobalScope, 'navigator', {
    get: () => navigatorObject,
    configurable: true,
  })
  const navigatorObject = Object.create(realm.workerNavigator) as object
  define(realm.workerNavigator, {
    storage: { getDirectory: fake('navigator.storage') },
    locks: { request: fake('navigator.locks') },
    serviceWorker: { register: fake('navigator.serviceWorker') },
    userAgent: 'jan-sandbox',
  })
  define(realm.dedicated, {
    name: options.name ?? '',
    postMessage: (message: unknown) => {
      if (!terminated) workerPort.postMessage(message)
    },
    close: () => terminate(),
  })
  // Tauri injects these into windows, not workers; a fake one here proves
  // the prelude would strip them anyway.
  define(scope, {
    __TAURI__: { invoke: fake('__TAURI__') },
    __TAURI_INTERNALS__: { invoke: fake('__TAURI_INTERNALS__') },
    __TAURI_IPC__: fake('__TAURI_IPC__'),
  })
  define(scope, options.globals ?? {})

  // A worker receives nothing until its script has run; messages the host
  // posts earlier (init, right after construction) wait until then.
  let scriptRan = false
  const early: unknown[] = []
  const deliver = (data: unknown) => {
    for (const l of [...workerListeners]) l({ data })
  }
  workerPort.addEventListener('message', (e) => {
    const { data } = e as MessageEvent
    if (scriptRan) deliver(data)
    else early.push(data)
  })
  workerPort.start()
  hostPort.addEventListener('message', (e) => {
    for (const l of [...hostListeners]) l({ data: (e as MessageEvent).data })
  })
  hostPort.start()

  const terminate = () => {
    if (terminated) return
    terminated = true
    for (const id of timers) clearTimeout(id)
    timers.clear()
    workerListeners.clear()
    hostPort.close()
    workerPort.close()
  }

  // A real worker reports an uncaught error of its script as an `error`
  // event on the Worker object, after the constructor returned.
  queueMicrotask(() => {
    try {
      runInContext(source, context, { filename: `ext:${options.name ?? ''}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const l of [...errorListeners]) l({ message })
    }
    scriptRan = true
    for (const data of early.splice(0)) deliver(data)
  })

  const worker: SandboxWorker = {
    scope,
    leaks,
    get terminated() {
      return terminated
    },
    postMessage: (message: unknown) => {
      if (!terminated) hostPort.postMessage(message)
    },
    addEventListener: (type: 'message' | 'error', listener: Listener | ErrorListener) => {
      if (type === 'message') hostListeners.add(listener as Listener)
      else errorListeners.add(listener as ErrorListener)
    },
    removeEventListener: (type: 'message' | 'error', listener: Listener | ErrorListener) => {
      if (type === 'message') hostListeners.delete(listener as Listener)
      else errorListeners.delete(listener as ErrorListener)
    },
    terminate,
  }
  return worker
}
