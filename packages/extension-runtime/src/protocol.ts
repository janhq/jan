import type {
  CommandHandler,
  Disposable,
  HttpRequestInit,
  HttpResponse,
  JsonValue,
  MessageInfo,
  NotifyLevel,
  ProviderHandlers,
  SettingValue,
  ThreadInfo,
  ThreadSummary,
  ToolHandler,
  ValidatedManifest,
} from '@janhq/extension-api'
import { isErrorCode, type RpcError } from './errors.js'

/** The protocol version every message carries. */
export const PROTOCOL_VERSION = 1

/**
 * Everything that crosses the worker boundary. Both sides send `req`; a `res`
 * always answers one of the receiver's own outgoing ids, so each side keeps
 * its own counter and no direction field is needed.
 */
export type Wire =
  // Only the manifest: grants are enforced by the host alone, settings are
  // read on demand (secret ones from the keyring), and the 0.x API exposes
  // no locale, so nothing else would be read in the worker.
  | { v: 1; t: 'init'; manifest: ValidatedManifest }
  | { v: 1; t: 'ready' }
  | { v: 1; t: 'activateFailed'; error: RpcError }
  | { v: 1; t: 'req'; id: number; method: string; args: unknown[] }
  | { v: 1; t: 'res'; id: number; ok: true; value: unknown }
  | { v: 1; t: 'res'; id: number; ok: false; error: RpcError }
  | { v: 1; t: 'cancel'; id: number }
  | { v: 1; t: 'evt'; sub: number; value: unknown }
  // The P4 watchdog pings; nothing answers yet.
  | { v: 1; t: 'ping'; n: number }
  | { v: 1; t: 'pong'; n: number }

/** Lifecycle and liveness messages, which are not request traffic. */
export type ControlMessage = Extract<
  Wire,
  { t: 'init' | 'ready' | 'activateFailed' | 'ping' | 'pong' }
>

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

function parseError(v: unknown): RpcError | undefined {
  if (!isRecord(v) || typeof v.message !== 'string') return undefined
  return { code: isErrorCode(v.code) ? v.code : 'E_INTERNAL', message: v.message }
}

/**
 * Narrows anything received on a port to a `Wire` message, or undefined.
 * Messages from a worker are untrusted, so the shape is checked field by
 * field rather than cast; an unknown error code degrades to `E_INTERNAL`.
 */
export function parseWire(data: unknown): Wire | undefined {
  if (!isRecord(data) || data.v !== PROTOCOL_VERSION) return undefined
  const v = PROTOCOL_VERSION
  switch (data.t) {
    case 'init':
      // Only the host sends init, with a manifest it validated; the worker
      // trusts it as much as the rest of its bootstrap.
      return isRecord(data.manifest)
        ? {
            v,
            t: 'init',
            manifest: data.manifest as unknown as ValidatedManifest,
          }
        : undefined
    case 'ready':
      return { v, t: 'ready' }
    case 'activateFailed': {
      const error = parseError(data.error)
      return error ? { v, t: 'activateFailed', error } : undefined
    }
    case 'req':
      return isId(data.id) &&
        typeof data.method === 'string' &&
        Array.isArray(data.args)
        ? { v, t: 'req', id: data.id, method: data.method, args: data.args }
        : undefined
    case 'res': {
      if (!isId(data.id)) return undefined
      if (data.ok === true)
        return { v, t: 'res', id: data.id, ok: true, value: data.value }
      const error = data.ok === false ? parseError(data.error) : undefined
      return error ? { v, t: 'res', id: data.id, ok: false, error } : undefined
    }
    case 'cancel':
      return isId(data.id) ? { v, t: 'cancel', id: data.id } : undefined
    case 'evt':
      return isId(data.sub)
        ? { v, t: 'evt', sub: data.sub, value: data.value }
        : undefined
    case 'ping':
    case 'pong':
      return isId(data.n) ? { v, t: data.t, n: data.n } : undefined
    default:
      return undefined
  }
}

/**
 * A worker function, sent by handle where a host method takes a callback.
 * The host turns it into a function that calls `$invoke` with the handle.
 * Only those argument positions are revived; anywhere else it is plain data.
 */
export interface CallbackRef {
  $callback: number
}

/** An event listener in the worker, sent by the sub id `evt` messages carry. */
export interface EventRef {
  $event: number
}

export const callbackRef = (handle: number): CallbackRef => ({
  $callback: handle,
})
export const eventRef = (sub: number): EventRef => ({ $event: sub })

export function isCallbackRef(v: unknown): v is CallbackRef {
  return isRecord(v) && Object.keys(v).length === 1 && isId(v.$callback)
}

export function isEventRef(v: unknown): v is EventRef {
  return isRecord(v) && Object.keys(v).length === 1 && isId(v.$event)
}

/** What `events.subscribe` can listen to, and what each event carries. */
export interface HostEvents {
  'settings.didChange': { key: string; value: SettingValue }
  'conversations.didCreateMessage': { threadId: string; message: MessageInfo }
  'conversations.didDeleteThread': { threadId: string }
}
export type HostEventName = keyof HostEvents

/** The arguments of `events.subscribe`, pairing each name with its payload. */
export type EventSubscription = {
  [E in HostEventName]: [name: E, listener: (event: HostEvents[E]) => void]
}[HostEventName]

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * The closed set of calls an extension makes into the host, as the host
 * sees them: callbacks are functions here. On the wire a worker sends a
 * `CallbackRef`/`EventRef` in their place and the host revives it before
 * dispatch, so built-ins and workers share these signatures.
 */
export interface HostMethodSignatures {
  'log': (level: LogLevel, ...args: unknown[]) => void
  'settings.get': (key: string) => Promise<SettingValue | undefined>
  'settings.set': (key: string, value: SettingValue) => Promise<void>
  'storage.get': (key: string) => Promise<JsonValue | undefined>
  'storage.set': (key: string, value: JsonValue) => Promise<void>
  'storage.delete': (key: string) => Promise<void>
  'storage.keys': () => Promise<string[]>
  'commands.register': (id: string, handler: CommandHandler) => Disposable
  'commands.execute': (id: string, ...args: JsonValue[]) => Promise<unknown>
  'ui.notify': (notification: { level: NotifyLevel; message: string }) => void
  'ui.setStatusItem': (
    id: string,
    update: { text?: string; tooltip?: string }
  ) => void
  'conversations.listThreads': () => Promise<ThreadSummary[]>
  'conversations.getThread': (id: string) => Promise<ThreadInfo | undefined>
  'conversations.listMessages': (
    threadId: string,
    opts?: { limit?: number; before?: string }
  ) => Promise<MessageInfo[]>
  'conversations.createThread': (input: { title: string }) => Promise<ThreadInfo>
  'conversations.appendMessage': (
    threadId: string,
    msg: { role: 'user' | 'assistant'; text: string }
  ) => Promise<MessageInfo>
  'tools.register': (name: string, handler: ToolHandler) => Disposable
  'providers.register': (id: string, handlers: ProviderHandlers) => Disposable
  'http.fetch': (url: string, init?: HttpRequestInit) => Promise<HttpResponse>
  'events.subscribe': (...args: EventSubscription) => Disposable
}

export type HostMethod = keyof HostMethodSignatures
export type HostArgs<M extends HostMethod> = Parameters<HostMethodSignatures[M]>
export type HostResult<M extends HostMethod> = ReturnType<
  HostMethodSignatures[M]
>

/**
 * What a host method resolves to on the wire: a registration answers with
 * the id of the host-side disposable instead of the disposable itself.
 */
export type WireResult<M extends HostMethod> =
  HostResult<M> extends Disposable
    ? RegistrationReply
    : Awaited<HostResult<M>>

/**
 * Runtime methods outside the extension API. The worker sends `$dispose`
 * with a disposable id the host returned; the host sends `$invoke` with a
 * callback handle and its arguments, and `$deactivate` before terminating.
 */
export const DISPOSE_METHOD = '$dispose'
export const INVOKE_METHOD = '$invoke'
export const DEACTIVATE_METHOD = '$deactivate'

/** The host's answer to a registration made across the boundary. */
export interface RegistrationReply {
  disposable: number
}
