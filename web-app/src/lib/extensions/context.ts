import {
  DisposableStore,
  ExtensionError,
  isLocalHost,
  type CommandContext,
  type ConversationsApi,
  type Event,
  type ExtensionContext,
  type HttpApi,
  type JsonValue,
  type Logger,
  type NotifyLevel,
  type PermissionString,
  type SettingValue,
  type ValidatedManifest,
} from '@janhq/extension-api'
import type { InternalExtensionContext } from '@janhq/core'
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

/** What a context is built on; shared by every extension of one host. */
export interface ContextDeps {
  dispatcher: PermissionDispatcher
  contributions: ContributionStore
  settings: ExtensionSettingsStore
  storage: AppSettingsBackend
  notify: Notify
  /** Absent until the conversations service exists (P1-4). */
  conversations?: ConversationsApi
  /** Absent until the network path exists (P2). */
  http?: HttpApi
}

function createLogger(extensionId: string): Logger {
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

/**
 * Builds the `ExtensionContext` for one extension. Every gated call checks
 * the dispatcher at call time rather than at creation, so a later revoke
 * takes effect without rebuilding the context.
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
  const { id } = manifest
  const { dispatcher, contributions, settings } = deps
  const check = (permission: PermissionString) =>
    dispatcher.check(id, permission)
  // Async API methods report denials as rejections, never as sync throws.
  const gated =
    <A extends unknown[], R>(
      permission: PermissionString,
      fn: (...args: A) => Promise<R>
    ) =>
    async (...args: A): Promise<R> => {
      check(permission)
      return fn(...args)
    }
  const gatedEvent =
    <T>(permission: PermissionString, event: () => Event<T>): Event<T> =>
    (listener) => {
      check(permission)
      return event()(listener)
    }
  const conversations = (): ConversationsApi => {
    if (!deps.conversations) throw notProvided('Conversations')
    return deps.conversations
  }

  const ctx: ExtensionContext = {
    extension: {
      id,
      version: manifest.version,
      displayName: manifest.displayName,
    },
    subscriptions: new DisposableStore(),
    log: createLogger(id),
    settings: {
      get: async <T extends SettingValue>(key: string) =>
        (await settings.getSettingValue(id, key)) as T | undefined,
      set: (key, value) => settings.setSettingValue(id, key, value),
      onDidChange: (listener) =>
        settings.onDidChange((change) => {
          if (change.extensionId === id)
            listener({ key: change.key, value: change.value })
        }),
    },
    storage: createExtensionStorage(id, deps.storage),
    commands: {
      registerCommand: (commandId, handler) =>
        contributions.registerCommand(id, commandId, handler),
      execute: async <T>(commandId: string, ...args: JsonValue[]) => {
        const context: CommandContext = {
          location: 'extension',
          extensionId: id,
        }
        if (contributions.getState().commands[id]?.[commandId]) {
          return (await contributions.executeCommand(
            id,
            commandId,
            context,
            ...args
          )) as T
        }
        check('commands:execute')
        // The allowlist of host commands arrives with the first host command.
        throw new ExtensionError(
          'E_NOT_FOUND',
          `Command '${commandId}' is not available`
        )
      },
    },
    ui: {
      notify: ({ level, message }) => {
        check('ui:notify')
        deps.notify({ extensionName: manifest.displayName, level, message })
      },
      setStatusItem: (itemId, update) =>
        contributions.setStatusItem(id, itemId, update),
    },
    conversations: {
      listThreads: gated('conversations:read', async () =>
        conversations().listThreads()
      ),
      getThread: gated('conversations:read', async (threadId: string) =>
        conversations().getThread(threadId)
      ),
      listMessages: gated(
        'conversations:read',
        async (threadId: string, opts?: { limit?: number; before?: string }) =>
          conversations().listMessages(threadId, opts)
      ),
      createThread: gated(
        'conversations:write',
        async (input: { title: string }) => conversations().createThread(input)
      ),
      appendMessage: gated(
        'conversations:write',
        async (
          threadId: string,
          msg: { role: 'user' | 'assistant'; text: string }
        ) => conversations().appendMessage(threadId, msg)
      ),
      onDidCreateMessage: gatedEvent(
        'conversations:read',
        () => conversations().onDidCreateMessage
      ),
      onDidDeleteThread: gatedEvent(
        'conversations:read',
        () => conversations().onDidDeleteThread
      ),
    },
    tools: {
      registerTool: (name, handler) => {
        check('tools')
        return contributions.registerTool(id, name, handler)
      },
    },
    providers: {
      registerProvider: (providerId, handlers) => {
        check('providers')
        return contributions.registerProvider(id, providerId, handlers)
      },
    },
    http: {
      fetch: async (url, init) => {
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          throw new ExtensionError(
            'E_INVALID_ARGS',
            `'${url}' is not an absolute URL`
          )
        }
        const host = parsed.hostname
        const secure =
          parsed.protocol === 'https:' ||
          (parsed.protocol === 'http:' && isLocalHost(host))
        if (!secure)
          throw new ExtensionError(
            'E_PERMISSION',
            `Only https is allowed for '${host}'`
          )
        check(`network:${host}`)
        if (!deps.http) throw notProvided('Network access')
        return deps.http.fetch(url, init)
      },
    },
    // No proposal is implemented yet.
    proposed: {},
  }
  return internal ? { ...ctx, internal } : ctx
}
