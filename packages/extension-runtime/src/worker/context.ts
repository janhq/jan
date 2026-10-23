import {
  DisposableStore,
  type CancellationToken,
  type Disposable,
  type Event,
  type ExtensionContext,
  type JsonValue,
  type SettingValue,
  type ValidatedManifest,
} from '@janhq/extension-api'
import type { Endpoint } from '../endpoint.js'
import type { HandleTable } from '../handles.js'
import {
  DISPOSE_METHOD,
  callbackRef,
  eventRef,
  type HostEventName,
  type HostEvents,
  type HostMethod,
  type LogLevel,
  type RegistrationReply,
  type WireResult,
} from '../protocol.js'

/** A worker function the host can call through `$invoke`. */
export type WorkerCallback = (
  args: unknown[],
  token: CancellationToken
) => unknown

/** The worker-side context plus what the runtime needs to finish activation. */
export interface WorkerContext {
  ctx: ExtensionContext
  /**
   * Waits for every fire-and-forget call made so far (registrations,
   * notifications) and rejects with the first failure, so a registration
   * the host refused during `activate` fails activation the way a sync
   * throw does in process.
   */
  settled(): Promise<void>
}

/**
 * Builds the `ExtensionContext` an extension sees inside its worker. Every
 * method is a request to the host, which checks permissions and arguments;
 * nothing is enforced here. Calls whose public signature is synchronous
 * (registrations, `ui.notify`) are sent at once and tracked, see `settled`.
 */
export function createWorkerContext(
  manifest: ValidatedManifest,
  endpoint: Endpoint,
  callbacks: HandleTable<WorkerCallback>
): WorkerContext {
  let nextSub = 1
  const outstanding = new Set<Promise<unknown>>()
  let firstFailure: { error: unknown } | undefined

  const call = <M extends HostMethod>(
    method: M,
    ...args: unknown[]
  ): Promise<WireResult<M>> =>
    endpoint.request(method, args) as Promise<WireResult<M>>

  const report = (what: string, error: unknown) => {
    // Through the host so the line lands in the app log, tagged like ctx.log.
    void endpoint
      .request('log', ['error', `${what} failed:`, String(error)])
      .catch(() => undefined)
  }

  const track = (what: string, p: Promise<unknown>) => {
    outstanding.add(p)
    p.then(
      () => outstanding.delete(p),
      (error: unknown) => {
        outstanding.delete(p)
        firstFailure ??= { error }
        report(what, error)
      }
    )
  }

  /**
   * Registers something on the host and returns its disposable at once. A
   * dispose before the host answered is remembered and sent when it does.
   */
  const register = (
    what: string,
    method: HostMethod,
    args: unknown[],
    releaseLocal: () => void
  ): Disposable => {
    let disposed = false
    let remote: number | undefined
    const reply = (endpoint.request(method, args) as Promise<RegistrationReply>)
      .then((r) => {
        remote = r.disposable
        if (disposed) release()
      })
    const release = () => {
      if (remote === undefined) return
      const id = remote
      remote = undefined
      void endpoint.request(DISPOSE_METHOD, [id]).catch(() => undefined)
    }
    track(what, reply)
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        releaseLocal()
        release()
      },
    }
  }

  const withCallback = (fn: WorkerCallback) => {
    const handle = callbacks.add(fn)
    return { ref: callbackRef(handle), release: () => callbacks.delete(handle) }
  }

  const subscribe =
    <E extends HostEventName>(name: E): Event<HostEvents[E]> =>
    (listener) => {
      // The sub id is chosen here, and the listener attached before the
      // request goes out, so no event can arrive before anyone listens.
      const sub = nextSub++
      const local = endpoint.onEvent(sub, (value) =>
        listener(value as HostEvents[E])
      )
      return register(`Subscribing to ${name}`, 'events.subscribe', [
        name,
        eventRef(sub),
      ], () => local.dispose())
    }

  const log = (level: LogLevel) =>
    (...args: unknown[]) => {
      // Stringified here: arbitrary values may not survive structured clone.
      const line = args.map((a) =>
        typeof a === 'string' ? a : safeStringify(a)
      )
      void endpoint.request('log', [level, ...line]).catch(() => undefined)
    }

  const ctx: ExtensionContext = {
    extension: {
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
    },
    subscriptions: new DisposableStore(),
    log: {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    },
    settings: {
      get: async <T extends SettingValue>(key: string) =>
        (await call('settings.get', key)) as T | undefined,
      set: (key, value) => call('settings.set', key, value),
      onDidChange: subscribe('settings.didChange'),
    },
    storage: {
      get: async <T extends JsonValue>(key: string) =>
        (await call('storage.get', key)) as T | undefined,
      set: (key, value) => call('storage.set', key, value),
      delete: (key) => call('storage.delete', key),
      keys: () => call('storage.keys'),
    },
    commands: {
      registerCommand: (id, handler) => {
        const cb = withCallback((args) =>
          handler(...(args as Parameters<typeof handler>))
        )
        return register(`Registering command '${id}'`, 'commands.register', [
          id,
          cb.ref,
        ], cb.release)
      },
      execute: async <T>(id: string, ...args: JsonValue[]) =>
        (await call('commands.execute', id, ...args)) as T,
    },
    ui: {
      notify: (notification) =>
        track('Notifying', call('ui.notify', notification)),
      setStatusItem: (id, update) =>
        track(
          `Updating status item '${id}'`,
          call('ui.setStatusItem', id, update)
        ),
    },
    conversations: {
      listThreads: () => call('conversations.listThreads'),
      getThread: (id) => call('conversations.getThread', id),
      listMessages: (threadId, opts) =>
        call('conversations.listMessages', threadId, ...(opts ? [opts] : [])),
      createThread: (input) => call('conversations.createThread', input),
      appendMessage: (threadId, msg) =>
        call('conversations.appendMessage', threadId, msg),
      onDidCreateMessage: subscribe('conversations.didCreateMessage'),
      onDidDeleteThread: subscribe('conversations.didDeleteThread'),
    },
    tools: {
      registerTool: (name, handler) => {
        const cb = withCallback((args, token) => handler(args[0], token))
        return register(`Registering tool '${name}'`, 'tools.register', [
          name,
          cb.ref,
        ], cb.release)
      },
    },
    providers: {
      registerProvider: (id, handlers) => {
        const { listModels } = handlers
        const cb = listModels ? withCallback(() => listModels()) : undefined
        return register(
          `Registering provider '${id}'`,
          'providers.register',
          [id, cb ? { listModels: cb.ref } : {}],
          () => cb?.release()
        )
      },
    },
    http: {
      fetch: (url, init) => call('http.fetch', url, ...(init ? [init] : [])),
    },
    // No proposal is implemented yet.
    proposed: {},
  }

  return {
    ctx,
    settled: async () => {
      // Each tracked call removes itself before allSettled resumes, and a
      // call may start another (a dispose racing its registration), so
      // drain until nothing is left.
      while (outstanding.size > 0) await Promise.allSettled([...outstanding])
      if (firstFailure) throw firstFailure.error
    },
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
