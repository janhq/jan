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
import type { HttpResponse as PluginHttpResponse } from '@janhq/tauri-plugin-extensions-api'
import { own, type ContributionStore } from './contributions'
import type { PermissionDispatcher } from './dispatcher'
import {
  fetchHop,
  firstHop,
  nextHop,
  withoutCookies,
  type ExtensionHttp,
} from './http'
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

/** What every extension of one host shares. */
export interface HostApiDeps {
  dispatcher: PermissionDispatcher
  contributions: ContributionStore
  settings: ExtensionSettingsStore
  storage: AppSettingsBackend
  notify: Notify
  conversations?: ConversationsApi
  /**
   * The network path of `ctx.http.fetch`. Only installed extensions get
   * one: the plugin checks their grants in extensions.json, where neither
   * built-ins nor folders loaded for development have an entry.
   */
  http?: ExtensionHttp
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

/** Requests one extension may have running at once. */
export const MAX_CONCURRENT_FETCHES = 8
/** Listeners one extension may hold on one event. */
export const MAX_SUBSCRIPTIONS_PER_EVENT = 16
/** What one log line may carry, after the level. */
export const MAX_LOG_ARGS = 16
export const MAX_LOG_CHARS = 4096
/** Log lines one extension may write: a burst, then this many a second. */
export const LOG_LINES_BURST = 50
export const LOG_LINES_PER_SECOND = 10
/**
 * Characters one extension may log per window. app.log rotates at
 * 10 MB x 5, so one extension can push at most a fraction of it out.
 */
export const LOG_WINDOW_MS = 10 * 60_000
export const MAX_LOG_CHARS_PER_WINDOW = 1024 * 1024

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

/**
 * The limits a worker extension runs under. Built-ins are Jan's own code
 * and get none: a download built-in may toast progress, hold many
 * listeners or run many requests (see `createHostApi`).
 */
export interface HostApiLimits {
  /** Notifications: a burst of 5, then one every 2 s. */
  notifyRate: boolean
  /** MAX_SUBSCRIPTIONS_PER_EVENT listeners per event. */
  subscriptions: boolean
  /** MAX_CONCURRENT_FETCHES requests at once. */
  fetchConcurrency: boolean
}

export const WORKER_LIMITS: HostApiLimits = {
  notifyRate: true,
  subscriptions: true,
  fetchConcurrency: true,
}

export const BUILTIN_LIMITS: HostApiLimits = {
  notifyRate: false,
  subscriptions: false,
  fetchConcurrency: false,
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

const cancelled = () => new ExtensionError('E_CANCELLED', 'The request was cancelled')

/**
 * `http.fetch`: each hop goes through the plugin's `http_fetch`, which
 * re-checks the grants from extensions.json, keeps no cookie jar, caps the
 * body at 1 MiB and follows no redirect. Redirects are followed here so
 * every hop is checked against the grants too, with only CORS-safelisted
 * headers kept once one leaves the origin. `signal` (the worker cancelled
 * or went away) cancels the request in Rust.
 */
async function fetchChecked(
  extensionId: string,
  deps: HostApiDeps,
  signal: AbortSignal | undefined,
  url: string,
  init: HttpRequestInit = {}
): Promise<HttpResponse> {
  const http = deps.http
  if (!http)
    throw new ExtensionError(
      'E_NOT_FOUND',
      'ctx.http.fetch is only available to installed extensions'
    )
  let hop = firstHop(url, init.method ?? 'GET', init.headers, init.body)
  for (let redirects = 0; ; redirects++) {
    // The worker may cancel while a redirect is on its way back; its abort
    // event has fired by then, so nothing else would stop the next hop.
    if (signal?.aborted) throw cancelled()
    deps.dispatcher.checkUrl(extensionId, hop.url)
    let response: PluginHttpResponse
    try {
      response = await fetchHop(http, extensionId, hop, signal)
    } catch (error) {
      if (signal?.aborted) throw cancelled()
      throw error
    }
    const next = nextHop(hop, response.status, response.headers.location, redirects)
    if (next) {
      hop = next
      continue
    }
    const result: HttpResponse = {
      status: response.status,
      headers: withoutCookies(response.headers),
      body: response.body,
    }
    // JSON escaping can grow a body several times over; a reply the RPC
    // would drop is refused here, with a reason, instead.
    if (JSON.stringify(result).length > MAX_MESSAGE_BYTES - 1024)
      throw new ExtensionError(
        'E_TOO_LARGE',
        'The response is too large to return to the extension'
      )
    return result
  }
}

/**
 * The host side of every `ExtensionContext` method for one extension, with
 * no permission or argument checks: `PermissionDispatcher.dispatch` runs
 * those first, for in-process built-ins and workers alike. The only checks
 * here are the ones that depend on runtime state the policy cannot see:
 * redirect targets, what the contribution store holds, and `limits`.
 * Worker logging is always limited; built-ins log through `createLogger`
 * directly and never reach `log` here.
 */
export function createHostApi(
  manifest: ValidatedManifest,
  deps: HostApiDeps,
  limits: HostApiLimits = WORKER_LIMITS
): HostApi {
  const { id } = manifest
  const { contributions, settings } = deps
  const logger = createLogger(id)
  const storage = createExtensionStorage(id, deps.storage)
  let fetches = 0
  const subscriptions = new Map<string, number>()
  const logAllowed = rateLimiter(LOG_LINES_BURST, LOG_LINES_PER_SECOND)
  const notifyAllowed = rateLimiter(5, 0.5)
  let logDropped = false
  let logWindowStart = Date.now()
  let logWindowChars = 0
  // Counts the listeners of one event and releases the slot on dispose.
  const capped = (name: string, subscribe: () => { dispose(): void }) => {
    const count = subscriptions.get(name) ?? 0
    if (limits.subscriptions && count >= MAX_SUBSCRIPTIONS_PER_EVENT)
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
      const now = Date.now()
      if (now - logWindowStart >= LOG_WINDOW_MS) {
        logWindowStart = now
        logWindowChars = 0
      }
      const line = logAllowed() ? capLogArgs(args) : undefined
      const chars = line?.reduce((n, s) => n + s.length, 0) ?? 0
      if (!line || logWindowChars + chars > MAX_LOG_CHARS_PER_WINDOW) {
        if (!logDropped)
          logger.warn('Logging too much; dropping lines for a while')
        logDropped = true
        return
      }
      logDropped = false
      logWindowChars += chars
      logger[level](...line)
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
      // API 1.0 reaches no host command and no other extension's command.
      throw new ExtensionError(
        'E_NOT_FOUND',
        `Command '${commandId}' is not available`
      )
    },
    'ui.notify': (_call, { level, message }) => {
      if (limits.notifyRate && !notifyAllowed()) throw tooMany('notifications')
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
      if (limits.fetchConcurrency && fetches >= MAX_CONCURRENT_FETCHES)
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
