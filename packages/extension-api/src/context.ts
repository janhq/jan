import type { ModelCapability } from './capabilities.js'
import type { JsonValue, SettingValue } from './contributions.js'
import type { Disposable, DisposableStore } from './disposable.js'
import type { Event } from './event.js'

/**
 * Leveled logging. Lines are tagged with the extension id and end up in the
 * app log.
 */
export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** The extension's own settings, as declared in `contributes.settings`. */
export interface SettingsApi {
  /**
   * The current value, or the manifest default when the user has not set
   * one. Resolves undefined for an undeclared key.
   */
  get<T extends SettingValue>(key: string): Promise<T | undefined>
  /** Stores a value for a declared key; the type must match the control. */
  set(key: string, value: SettingValue): Promise<void>
  readonly onDidChange: Event<{ key: string; value: SettingValue }>
}

/** Private key-value storage of JSON values, 1 MiB per extension. */
export interface StorageApi {
  get<T extends JsonValue>(key: string): Promise<T | undefined>
  /** Rejects with `E_TOO_LARGE` when the stored total would exceed the quota. */
  set(key: string, value: JsonValue): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

/**
 * Where a command was run from, passed as its first argument. Only ids:
 * reading content needs `conversations:read`.
 */
export type CommandContext =
  | { location: 'commandPalette' }
  | { location: 'thread/context'; threadId: string }
  | {
      location: 'message/actions'
      threadId: string
      messageId: string
      role: 'user' | 'assistant'
    }
  | { location: 'chatInput/actions'; threadId: string }
  | { location: 'statusItem' }
  /** Run through `ctx.commands.execute` by the named extension. */
  | { location: 'extension'; extensionId: string }

export type CommandHandler = (
  context: CommandContext,
  ...args: JsonValue[]
) => unknown

export interface CommandsApi {
  /** Binds a handler to a command declared in `contributes.commands`. */
  registerCommand(id: string, handler: CommandHandler): Disposable
  /**
   * Runs one of the extension's own commands. Host commands and other
   * extensions' commands are not reachable.
   */
  execute<T = unknown>(id: string, ...args: JsonValue[]): Promise<T>
}

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error'

export interface UiApi {
  /** Shows a toast labelled with the extension name. Needs `ui:notify`. */
  notify(notification: { level: NotifyLevel; message: string }): void
  /** Updates a status item declared in `contributes.statusItems`. */
  setStatusItem(id: string, update: { text?: string; tooltip?: string }): void
}

/** Public, storage-independent views of threads and messages. */
export interface ThreadSummary {
  id: string
  title: string
  /** Unix epoch milliseconds. */
  updatedAt: number
}

export interface ThreadInfo extends ThreadSummary {
  /** Unix epoch milliseconds. */
  createdAt: number
}

export interface MessageInfo {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  /** The text parts of the message, concatenated. */
  text: string
  /** Unix epoch milliseconds. */
  createdAt: number
}

/** Reading needs `conversations:read`; creating needs `conversations:write`. */
export interface ConversationsApi {
  listThreads(): Promise<ThreadSummary[]>
  getThread(id: string): Promise<ThreadInfo | undefined>
  listMessages(
    threadId: string,
    opts?: { limit?: number; before?: string }
  ): Promise<MessageInfo[]>
  createThread(input: { title: string }): Promise<ThreadInfo>
  appendMessage(
    threadId: string,
    msg: { role: 'user' | 'assistant'; text: string }
  ): Promise<MessageInfo>
  readonly onDidCreateMessage: Event<{ threadId: string; message: MessageInfo }>
  readonly onDidDeleteThread: Event<{ threadId: string }>
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean
  readonly onCancellationRequested: Event<void>
}

/** What a tool returns to the model. */
export interface ToolResult {
  content: (
    | { type: 'text'; text: string }
    | { type: 'json'; value: JsonValue }
  )[]
  isError?: boolean
}

export interface ToolHandler {
  (input: unknown, token: CancellationToken): Promise<ToolResult>
}

export interface ToolsApi {
  /** Implements a tool declared in `contributes.tools`. Needs `tools`. */
  registerTool(name: string, handler: ToolHandler): Disposable
}

export interface ProviderModel {
  id: string
  displayName?: string
  /** Replaces the provider's declared `capabilities` for this model. */
  capabilities?: ModelCapability[]
}

export interface ProviderHandlers {
  /** Overrides the host's `GET <baseUrl>/models` lookup. */
  listModels?(): Promise<ProviderModel[]>
}

export interface ProvidersApi {
  /** Activates a provider declared in `contributes.providers`. Needs `providers`. */
  registerProvider(id: string, handlers: ProviderHandlers): Disposable
}

export interface HttpRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface HttpApi {
  /** Needs a `network:<host>` permission covering the URL's host. */
  fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>
}

/** A message about to be sent, as seen by a `chat.onWillSend` hook. */
export interface WillSendEvent {
  threadId: string
  text: string
}

/**
 * Proposed APIs. Only present for extensions that list the proposal in
 * `jan.proposals` and run as built-in or dev; may change in any minor.
 */
export interface ProposedApi {
  readonly chat?: {
    /** Lets the extension rewrite outgoing text. Needs `chat:hooks`. */
    onWillSend(
      handler: (e: WillSendEvent) => Promise<{ text: string } | undefined>
    ): Disposable
  }
}

/** What `activate` receives. */
export interface ExtensionContext {
  readonly extension: { id: string; version: string; displayName: string }
  /** Disposed by the host on deactivation; add every registration here. */
  readonly subscriptions: DisposableStore
  readonly log: Logger
  readonly settings: SettingsApi
  readonly storage: StorageApi
  readonly commands: CommandsApi
  readonly ui: UiApi
  readonly conversations: ConversationsApi
  readonly tools: ToolsApi
  readonly providers: ProvidersApi
  readonly http: HttpApi
  readonly proposed: ProposedApi
}

/** The shape of an extension's entry module. */
export interface ExtensionModule {
  activate(ctx: ExtensionContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
