import {
  DisposableStore,
  type Event,
  type ExtensionContext,
  type JsonValue,
  type SettingValue,
  type ValidatedManifest,
} from '@janhq/extension-api'
import type {
  HostArgs,
  HostEventName,
  HostEvents,
  HostMethod,
  HostResult,
} from '@janhq/extension-runtime'
import type { InternalExtensionContext } from '@janhq/core'
import {
  BUILTIN_LIMITS,
  createHostApi,
  createLogger,
  type HostApiDeps,
} from './host-api'

export type { Notify } from './host-api'

/** What a context is built on; shared by every extension of one host. */
export type ContextDeps = HostApiDeps

/**
 * Builds the in-process `ExtensionContext` of a built-in. Every gated call
 * goes through `PermissionDispatcher.dispatch`, the path worker requests
 * take too, and is checked at call time, so a later revoke takes effect
 * without rebuilding the context.
 */
export function createContext(
  manifest: ValidatedManifest,
  deps: ContextDeps
): ExtensionContext
export function createContext(
  manifest: ValidatedManifest,
  deps: ContextDeps,
  internal: InternalExtensionContext['internal']
): InternalExtensionContext
export function createContext(
  manifest: ValidatedManifest,
  deps: ContextDeps,
  internal?: InternalExtensionContext['internal']
): ExtensionContext | InternalExtensionContext {
  const api = createHostApi(manifest, deps, BUILTIN_LIMITS)
  const call = <M extends HostMethod>(
    method: M,
    ...args: HostArgs<M>
  ): HostResult<M> => deps.dispatcher.dispatch(manifest, api, method, args)
  // Async API methods report denials as rejections, never as sync throws.
  const callAsync = async <M extends HostMethod>(
    method: M,
    ...args: HostArgs<M>
  ): Promise<Awaited<HostResult<M>>> =>
    (await call(method, ...args)) as Awaited<HostResult<M>>
  // Not through `call`: the name/listener pairing is a union TypeScript
  // cannot spread generically, and dispatch validates it anyway.
  const subscribe =
    <E extends HostEventName>(name: E): Event<HostEvents[E]> =>
    (listener) =>
      deps.dispatcher.dispatch(manifest, api, 'events.subscribe', [
        name,
        listener,
      ])

  const ctx: ExtensionContext = {
    extension: {
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
    },
    subscriptions: new DisposableStore(),
    // Logging is implicit and in process; it skips the dispatcher so a
    // built-in's log line costs nothing more than console.
    log: createLogger(manifest.id),
    settings: {
      get: async <T extends SettingValue>(key: string) =>
        (await callAsync('settings.get', key)) as T | undefined,
      set: (key, value) => callAsync('settings.set', key, value),
      onDidChange: subscribe('settings.didChange'),
    },
    storage: {
      get: async <T extends JsonValue>(key: string) =>
        (await callAsync('storage.get', key)) as T | undefined,
      set: (key, value) => callAsync('storage.set', key, value),
      delete: (key) => callAsync('storage.delete', key),
      keys: () => callAsync('storage.keys'),
    },
    commands: {
      registerCommand: (id, handler) =>
        call('commands.register', id, handler),
      execute: async <T>(id: string, ...args: JsonValue[]) =>
        (await callAsync('commands.execute', id, ...args)) as T,
    },
    ui: {
      notify: (notification) => call('ui.notify', notification),
      setStatusItem: (id, update) => call('ui.setStatusItem', id, update),
    },
    conversations: {
      listThreads: () => callAsync('conversations.listThreads'),
      getThread: (id) => callAsync('conversations.getThread', id),
      listMessages: (threadId, opts) =>
        callAsync('conversations.listMessages', threadId, opts),
      createThread: (input) => callAsync('conversations.createThread', input),
      appendMessage: (threadId, msg) =>
        callAsync('conversations.appendMessage', threadId, msg),
      onDidCreateMessage: subscribe('conversations.didCreateMessage'),
      onDidDeleteThread: subscribe('conversations.didDeleteThread'),
    },
    tools: {
      registerTool: (name, handler) => call('tools.register', name, handler),
    },
    providers: {
      registerProvider: (id, handlers) =>
        call('providers.register', id, handlers),
    },
    http: {
      fetch: (url, init) => callAsync('http.fetch', url, init),
    },
    // No proposal is implemented yet.
    proposed: {},
  }
  return internal ? { ...ctx, internal } : ctx
}
