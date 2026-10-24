import {
  ExtensionError,
  toDisposable,
  type CommandContext,
  type ConversationsApi,
  type HttpRequestInit,
  type HttpResponse,
  type Logger,
  type NotifyLevel,
  type ValidatedManifest,
} from '@janhq/extension-api'
import {
  MAX_MESSAGE_BYTES,
  type HostArgs,
  type HostMethod,
  type HostResult,
  type LogLevel,
} from '@janhq/extension-runtime'
import { own, type ContributionStore } from './contributions'
import type { PermissionDispatcher } from './dispatcher'
import type {
  AppSettingsBackend,
  ExtensionSettingsStore,
} from './settings-store'
import { createExtensionStorage } from './storage'

export type Notify = (notification: {
  extensionName: string
  level: NotifyLevel
  message: string
}) => void

/**
 * The network primitive behind `ctx.http.fetch`. `maxRedirections: 0` is
 * how `@tauri-apps/plugin-http` is told not to follow redirects, so each hop
 * comes back here to be checked against the grants.
 */
export type FetchLike = (
  url: string,
  init: RequestInit & { maxRedirections: number }
) => Promise<Response>

/** What every extension of one host shares. */
export interface HostApiDeps {
  dispatcher: PermissionDispatcher
  contributions: ContributionStore
  settings: ExtensionSettingsStore
  storage: AppSettingsBackend
  notify: Notify
  conversations?: ConversationsApi
  /**
   * Absent where the app has no network path for extensions. Worker
   * extensions get none until P3 (see `ExtensionHost.apiDeps`).
   */
  fetch?: FetchLike
}

/** Per-call context the dispatcher hands to an implementation. */
export interface CallOptions {
  /** Aborted when the caller cancels or its worker goes away. */
  signal?: AbortSignal
}

/** The host methods of one extension, before any check. */
export type HostApi = {
  [M in HostMethod]: (
    call: CallOptions,
    ...args: HostArgs<M>
  ) => HostResult<M>
}

/**
 * Cap on a response body read for an extension: well under the RPC
 * message cap, so the reply of a worker's fetch can always cross (the
 * final size is checked again after JSON escaping, see `fetchChecked`).
 */
export const MAX_RESPONSE_BYTES = MAX_MESSAGE_BYTES / 4
/** Requests one extension may have running at once. */
export const MAX_CONCURRENT_FETCHES = 8
/** Listeners one extension may hold on one event. */
export const MAX_SUBSCRIPTIONS_PER_EVENT = 16
/** What one log line may carry, after the level. */
export const MAX_LOG_ARGS = 16
export const MAX_LOG_CHARS = 4096
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 30_000
// Never forwarded either way: the host's cookie jar is not the extension's.
const COOKIE_HEADERS = new Set(['cookie', 'cookie2', 'set-cookie', 'set-cookie2'])
// What may follow a redirect to another origin. Anything else (Authorization,
// x-api-key and other custom credentials) was meant for the first origin.
const CORS_SAFELISTED_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-language',
  'content-type',
])

/**
 * A token bucket: `capacity` calls at once, refilled at `perSecond`.
 * Bounds what one extension can push at the main thread, the toasts and
 * app.log, whatever loop it runs.
 */
export function rateLimiter(
  capacity: number,
  perSecond: number,
  now: () => number = Date.now
): () => boolean {
  let tokens = capacity
  let last = now()
  return () => {
    const t = now()
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * perSecond)
    last = t
    if (tokens < 1) return false
    tokens -= 1
    return true
  }
}

function logText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** At most MAX_LOG_ARGS arguments and MAX_LOG_CHARS characters in all. */
function capLogArgs(args: unknown[]): string[] {
  let budget = MAX_LOG_CHARS
  const out: string[] = []
  for (const arg of args.slice(0, MAX_LOG_ARGS)) {
    if (budget <= 0) break
    const text = logText(arg)
    out.push(
      text.length > budget ? `${text.slice(0, budget)}... [truncated]` : text
    )
    budget -= text.length
  }
  if (args.length > MAX_LOG_ARGS) out.push(`... [${args.length - MAX_LOG_ARGS} more]`)
  return out
}

const tooMany = (what: string) =>
  new ExtensionError('E_TOO_LARGE', `Too many ${what}`)

export function createLogger(extensionId: string): Logger {
  const tag = `[ext:${extensionId}]`
  // console, not the Tauri log plugin: the app's console interceptor already
  // forwards to app.log, and writing to both would duplicate lines.
  return {
    debug: (...args) => console.debug(tag, ...args),
    info: (...args) => console.info(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  }
}

const notProvided = (what: string) =>
  new ExtensionError('E_NOT_FOUND', `${what} is not available in this host`)

const isRedirect = (status: number) =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      void reader.cancel()
      throw new ExtensionError(
        'E_TOO_LARGE',
        `The response exceeds ${MAX_RESPONSE_BYTES} bytes`
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

const cancelled = () => new ExtensionError('E_CANCELLED', 'The request was cancelled')

/**
 * `http.fetch`: follows redirects itself so every hop is checked against
 * the grants, drops cookies both ways, keeps only CORS-safelisted headers
 * once a redirect leaves the origin, caps the body, and aborts the request
 * when `signal` fires (the worker cancelled it or went away).
 */
async function fetchChecked(
  extensionId: string,
  deps: HostApiDeps,
  signal: AbortSignal | undefined,
  url: string,
  init: HttpRequestInit = {}
): Promise<HttpResponse> {
  const fetch = deps.fetch
  if (!fetch)
    throw new ExtensionError(
      'E_NOT_FOUND',
      'ctx.http.fetch is not available to this extension until Jan runs extension requests outside the app cookie jar (P3)'
    )
  if (signal?.aborted) throw cancelled()
  const headers = new Headers()
  for (const [name, value] of Object.entries(init.headers ?? {}))
    if (!COOKIE_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  let method: string = init.method ?? 'GET'
  let body = init.body
  let current = url
  for (let hop = 0; ; hop++) {
    deps.dispatcher.checkUrl(extensionId, current)
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timer = setTimeout(abort, FETCH_TIMEOUT_MS)
    signal?.addEventListener('abort', abort)
    try {
      const response = await fetch(current, {
        method,
        // A copy per hop: a later hop drops credentials, and the platform
        // may still read this request's headers.
        headers: new Headers(headers),
        body,
        redirect: 'manual',
        maxRedirections: 0,
        credentials: 'omit',
        signal: controller.signal,
      })
      const location = response.headers.get('location')
      if (isRedirect(response.status) && location) {
        void response.body?.cancel()
        if (hop >= MAX_REDIRECTS)
          throw new ExtensionError('E_INVALID_ARGS', 'Too many redirects')
        const next = new URL(location, current)
        if (next.origin !== new URL(current).origin)
          for (const name of [...headers.keys()])
            if (!CORS_SAFELISTED_HEADERS.has(name)) headers.delete(name)
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            method === 'POST')
        ) {
          method = 'GET'
          body = undefined
        }
        current = next.toString()
        continue
      }
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, name) => {
        if (!COOKIE_HEADERS.has(name.toLowerCase()))
          responseHeaders[name] = value
      })
      const result: HttpResponse = {
        status: response.status,
        headers: responseHeaders,
        body: await readCapped(response),
      }
      // JSON escaping can grow a body several times over; a reply the RPC
      // would drop is refused here, with a reason, instead.
      if (JSON.stringify(result).length > MAX_MESSAGE_BYTES - 1024)
        throw new ExtensionError(
          'E_TOO_LARGE',
          'The response is too large to return to the extension'
        )
      return result
    } catch (error) {
      if (signal?.aborted) throw cancelled()
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

/**
 * The host side of every `ExtensionContext` method for one extension, with
 * no permission or argument checks: `PermissionDispatcher.dispatch` runs
 * those first, for in-process built-ins and workers alike. The only checks
 * here are the ones that depend on runtime state the policy cannot see:
 * redirect targets and what the contribution store holds.
 */
export function createHostApi(
  manifest: ValidatedManifest,
  deps: HostApiDeps
): HostApi {
  const { id } = manifest
  const { contributions, settings } = deps
  const logger = createLogger(id)
  const storage = createExtensionStorage(id, deps.storage)
  let fetches = 0
  const subscriptions = new Map<string, number>()
  const logAllowed = rateLimiter(100, 50)
  const notifyAllowed = rateLimiter(5, 0.5)
  let logDropped = false
  // Counts the listeners of one event and releases the slot on dispose.
  const capped = (name: string, subscribe: () => { dispose(): void }) => {
    const count = subscriptions.get(name) ?? 0
    if (count >= MAX_SUBSCRIPTIONS_PER_EVENT)
      throw tooMany(`subscriptions to '${name}'`)
    const subscription = subscribe()
    subscriptions.set(name, count + 1)
    let disposed = false
    return toDisposable(() => {
      if (disposed) return
      disposed = true
      subscriptions.set(name, (subscriptions.get(name) ?? 1) - 1)
      subscription.dispose()
    })
  }
  const conversations = (): ConversationsApi => {
    if (!deps.conversations) throw notProvided('Conversations')
    return deps.conversations
  }

  return {
    'log': (_call, level: LogLevel, ...args: unknown[]) => {
      if (!logAllowed()) {
        if (!logDropped)
          logger.warn('Logging too fast; dropping lines for a while')
        logDropped = true
        return
      }
      logDropped = false
      logger[level](...capLogArgs(args))
    },
    'settings.get': (_call, key) => settings.getSettingValue(id, key),
    'settings.set': (_call, key, value) => settings.setSettingValue(id, key, value),
    'storage.get': (_call, key) => storage.get(key),
    'storage.set': (_call, key, value) => storage.set(key, value),
    'storage.delete': (_call, key) => storage.delete(key),
    'storage.keys': () => storage.keys(),
    'commands.register': (_call, commandId, handler) =>
      contributions.registerCommand(id, commandId, handler),
    'commands.execute': async (_call, commandId, ...args) => {
      if (own(own(contributions.getState().commands, id), commandId)) {
        const context: CommandContext = {
          location: 'extension',
          extensionId: id,
        }
        return contributions.executeCommand(id, commandId, context, ...args)
      }
      // The allowlist of host commands arrives with the first host command.
      throw new ExtensionError(
        'E_NOT_FOUND',
        `Command '${commandId}' is not available`
      )
    },
    'ui.notify': (_call, { level, message }) => {
      if (!notifyAllowed()) throw tooMany('notifications')
      deps.notify({ extensionName: manifest.displayName, level, message })
    },
    'ui.setStatusItem': (_call, itemId, update) =>
      contributions.setStatusItem(id, itemId, update),
    'conversations.listThreads': () => conversations().listThreads(),
    'conversations.getThread': (_call, threadId) =>
      conversations().getThread(threadId),
    'conversations.listMessages': (_call, threadId, opts) =>
      conversations().listMessages(threadId, opts),
    'conversations.createThread': (_call, input) =>
      conversations().createThread(input),
    'conversations.appendMessage': (_call, threadId, msg) =>
      conversations().appendMessage(threadId, msg),
    'tools.register': (_call, name, handler) =>
      contributions.registerTool(id, name, handler),
    'providers.register': (_call, providerId, handlers) => {
      // Inference goes from the host to the provider's baseUrl, so the user
      // must have granted that host, not only the `providers` permission.
      const declared = own(
        own(contributions.getState().providers, id),
        providerId
      )
      if (!declared)
        throw new ExtensionError(
          'E_NOT_FOUND',
          `'${providerId}' is not declared in contributes.providers`
        )
      deps.dispatcher.checkUrl(id, declared.baseUrl)
      return contributions.registerProvider(id, providerId, handlers)
    },
    'http.fetch': async ({ signal }, url, init) => {
      if (fetches >= MAX_CONCURRENT_FETCHES)
        throw tooMany(`requests at once (at most ${MAX_CONCURRENT_FETCHES})`)
      fetches++
      try {
        return await fetchChecked(id, deps, signal, url, init)
      } finally {
        fetches--
      }
    },
    'events.subscribe': (_call, ...[name, listener]) =>
      capped(name, () => {
        switch (name) {
          case 'settings.didChange':
            return settings.onDidChange((change) => {
              if (change.extensionId === id)
                listener({ key: change.key, value: change.value })
            })
          case 'conversations.didCreateMessage':
            return conversations().onDidCreateMessage(listener)
          case 'conversations.didDeleteThread':
            return conversations().onDidDeleteThread(listener)
        }
      }),
  }
}
