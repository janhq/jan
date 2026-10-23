import {
  ExtensionError,
  type CommandContext,
  type ConversationsApi,
  type HttpRequestInit,
  type HttpResponse,
  type Logger,
  type NotifyLevel,
  type ValidatedManifest,
} from '@janhq/extension-api'
import type {
  HostMethod,
  HostMethodSignatures,
  LogLevel,
} from '@janhq/extension-runtime'
import type { ContributionStore } from './contributions'
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
  /** Absent where the app has no network path for extensions. */
  fetch?: FetchLike
}

/** The host methods of one extension, before any check. */
export type HostApi = { [M in HostMethod]: HostMethodSignatures[M] }

/** Cap on a response body read for an extension. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 30_000
// Never forwarded either way: the host's cookie jar is not the extension's.
const COOKIE_HEADERS = new Set(['cookie', 'cookie2', 'set-cookie', 'set-cookie2'])

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

/**
 * `http.fetch`: follows redirects itself so every hop is checked against
 * the grants, drops cookies both ways, strips credentials when a redirect
 * leaves the origin, and caps the body.
 */
async function fetchChecked(
  extensionId: string,
  deps: HostApiDeps,
  url: string,
  init: HttpRequestInit = {}
): Promise<HttpResponse> {
  const fetch = deps.fetch
  if (!fetch) throw notProvided('Network access')
  const headers = new Headers()
  for (const [name, value] of Object.entries(init.headers ?? {}))
    if (!COOKIE_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  let method: string = init.method ?? 'GET'
  let body = init.body
  let current = url
  for (let hop = 0; ; hop++) {
    deps.dispatcher.checkUrl(extensionId, current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
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
          headers.delete('authorization')
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
      return {
        status: response.status,
        headers: responseHeaders,
        body: await readCapped(response),
      }
    } finally {
      clearTimeout(timer)
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
  const conversations = (): ConversationsApi => {
    if (!deps.conversations) throw notProvided('Conversations')
    return deps.conversations
  }

  return {
    'log': (level: LogLevel, ...args: unknown[]) => logger[level](...args),
    'settings.get': (key) => settings.getSettingValue(id, key),
    'settings.set': (key, value) => settings.setSettingValue(id, key, value),
    'storage.get': (key) => storage.get(key),
    'storage.set': (key, value) => storage.set(key, value),
    'storage.delete': (key) => storage.delete(key),
    'storage.keys': () => storage.keys(),
    'commands.register': (commandId, handler) =>
      contributions.registerCommand(id, commandId, handler),
    'commands.execute': async (commandId, ...args) => {
      if (contributions.getState().commands[id]?.[commandId]) {
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
    'ui.notify': ({ level, message }) =>
      deps.notify({ extensionName: manifest.displayName, level, message }),
    'ui.setStatusItem': (itemId, update) =>
      contributions.setStatusItem(id, itemId, update),
    'conversations.listThreads': () => conversations().listThreads(),
    'conversations.getThread': (threadId) =>
      conversations().getThread(threadId),
    'conversations.listMessages': (threadId, opts) =>
      conversations().listMessages(threadId, opts),
    'conversations.createThread': (input) =>
      conversations().createThread(input),
    'conversations.appendMessage': (threadId, msg) =>
      conversations().appendMessage(threadId, msg),
    'tools.register': (name, handler) =>
      contributions.registerTool(id, name, handler),
    'providers.register': (providerId, handlers) => {
      // Inference goes from the host to the provider's baseUrl, so the user
      // must have granted that host, not only the `providers` permission.
      const declared = manifest.contributes?.providers?.find(
        (p) => p.id === providerId
      )
      if (declared) deps.dispatcher.checkUrl(id, declared.baseUrl)
      return contributions.registerProvider(id, providerId, handlers)
    },
    'http.fetch': (url, init) => fetchChecked(id, deps, url, init),
    'events.subscribe': (...[name, listener]) => {
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
    },
  }
}
