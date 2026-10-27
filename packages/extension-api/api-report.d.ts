// API report for @janhq/extension-api. Generated; do not edit.
// Update with: yarn workspace @janhq/extension-api api-report

// ---- api-version.d.ts ----

/**
 * The version of this API package. A host compares an extension's
 * `jan.apiVersion` caret range against it (see `isApiCompatible`).
 */
export declare const API_VERSION = "1.0.0";

// ---- capabilities.d.ts ----

/**
 * What a model of a contributed provider can do, as the host reads it:
 * `tools` turns on tool calling in chat, `vision`, `audio` and `video` allow
 * those attachments, `embeddings` marks a model for embedding rather than
 * chat, `reasoning` labels a thinking model. A model with none declared is
 * `['completion']`.
 */
export type ModelCapability = 'completion' | 'tools' | 'vision' | 'audio' | 'video' | 'embeddings' | 'reasoning';
/** Every `ModelCapability`; anything else is rejected, not ignored. */
export declare const MODEL_CAPABILITIES: readonly ModelCapability[];
/** What a model gets when neither its provider nor its listing says. */
export declare const DEFAULT_MODEL_CAPABILITIES: readonly ModelCapability[];
/** Narrows a manifest or `listModels` entry to a `ModelCapability`. */
export declare function isModelCapability(value: unknown): value is ModelCapability;

// ---- context.d.ts ----

import type { ModelCapability } from './capabilities.js';
import type { JsonValue, SettingValue } from './contributions.js';
import type { Disposable, DisposableStore } from './disposable.js';
import type { Event } from './event.js';
/**
 * Leveled logging. Lines are tagged with the extension id and end up in the
 * app log.
 */
export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
/** The extension's own settings, as declared in `contributes.settings`. */
export interface SettingsApi {
    /**
     * The current value, or the manifest default when the user has not set
     * one. Resolves undefined for an undeclared key.
     */
    get<T extends SettingValue>(key: string): Promise<T | undefined>;
    /** Stores a value for a declared key; the type must match the control. */
    set(key: string, value: SettingValue): Promise<void>;
    readonly onDidChange: Event<{
        key: string;
        value: SettingValue;
    }>;
}
/** Private key-value storage of JSON values, 1 MiB per extension. */
export interface StorageApi {
    get<T extends JsonValue>(key: string): Promise<T | undefined>;
    /** Rejects with `E_TOO_LARGE` when the stored total would exceed the quota. */
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
}
/**
 * Where a command was run from, passed as its first argument. Only ids:
 * reading content needs `conversations:read`.
 */
export type CommandContext = {
    location: 'commandPalette';
} | {
    location: 'thread/context';
    threadId: string;
} | {
    location: 'message/actions';
    threadId: string;
    messageId: string;
    role: 'user' | 'assistant';
} | {
    location: 'chatInput/actions';
    threadId: string;
} | {
    location: 'statusItem';
}
/** Run through `ctx.commands.execute` by the named extension. */
 | {
    location: 'extension';
    extensionId: string;
};
export type CommandHandler = (context: CommandContext, ...args: JsonValue[]) => unknown;
export interface CommandsApi {
    /** Binds a handler to a command declared in `contributes.commands`. */
    registerCommand(id: string, handler: CommandHandler): Disposable;
    /**
     * Runs one of the extension's own commands. Host commands and other
     * extensions' commands are not reachable.
     */
    execute<T = unknown>(id: string, ...args: JsonValue[]): Promise<T>;
}
export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';
export interface UiApi {
    /** Shows a toast labelled with the extension name. Needs `ui:notify`. */
    notify(notification: {
        level: NotifyLevel;
        message: string;
    }): void;
    /** Updates a status item declared in `contributes.statusItems`. */
    setStatusItem(id: string, update: {
        text?: string;
        tooltip?: string;
    }): void;
}
/** Public, storage-independent views of threads and messages. */
export interface ThreadSummary {
    id: string;
    title: string;
    /** Unix epoch milliseconds. */
    updatedAt: number;
}
export interface ThreadInfo extends ThreadSummary {
    /** Unix epoch milliseconds. */
    createdAt: number;
}
export interface MessageInfo {
    id: string;
    threadId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    /** The text parts of the message, concatenated. */
    text: string;
    /** Unix epoch milliseconds. */
    createdAt: number;
}
/** Reading needs `conversations:read`; creating needs `conversations:write`. */
export interface ConversationsApi {
    listThreads(): Promise<ThreadSummary[]>;
    getThread(id: string): Promise<ThreadInfo | undefined>;
    listMessages(threadId: string, opts?: {
        limit?: number;
        before?: string;
    }): Promise<MessageInfo[]>;
    createThread(input: {
        title: string;
    }): Promise<ThreadInfo>;
    appendMessage(threadId: string, msg: {
        role: 'user' | 'assistant';
        text: string;
    }): Promise<MessageInfo>;
    readonly onDidCreateMessage: Event<{
        threadId: string;
        message: MessageInfo;
    }>;
    readonly onDidDeleteThread: Event<{
        threadId: string;
    }>;
}
export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    readonly onCancellationRequested: Event<void>;
}
/** What a tool returns to the model. */
export interface ToolResult {
    content: ({
        type: 'text';
        text: string;
    } | {
        type: 'json';
        value: JsonValue;
    })[];
    isError?: boolean;
}
export interface ToolHandler {
    (input: unknown, token: CancellationToken): Promise<ToolResult>;
}
export interface ToolsApi {
    /** Implements a tool declared in `contributes.tools`. Needs `tools`. */
    registerTool(name: string, handler: ToolHandler): Disposable;
}
export interface ProviderModel {
    id: string;
    displayName?: string;
    /** Replaces the provider's declared `capabilities` for this model. */
    capabilities?: ModelCapability[];
}
export interface ProviderHandlers {
    /** Overrides the host's `GET <baseUrl>/models` lookup. */
    listModels?(): Promise<ProviderModel[]>;
}
export interface ProvidersApi {
    /** Activates a provider declared in `contributes.providers`. Needs `providers`. */
    registerProvider(id: string, handlers: ProviderHandlers): Disposable;
}
export interface HttpRequestInit {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    headers?: Record<string, string>;
    body?: string;
}
export interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}
export interface HttpApi {
    /** Needs a `network:<host>` permission covering the URL's host. */
    fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}
/** A message about to be sent, as seen by a `chat.onWillSend` hook. */
export interface WillSendEvent {
    threadId: string;
    text: string;
}
/**
 * Proposed APIs. Only present for extensions that list the proposal in
 * `jan.proposals` and run as built-in or dev; may change in any minor.
 */
export interface ProposedApi {
    readonly chat?: {
        /** Lets the extension rewrite outgoing text. Needs `chat:hooks`. */
        onWillSend(handler: (e: WillSendEvent) => Promise<{
            text: string;
        } | undefined>): Disposable;
    };
}
/** What `activate` receives. */
export interface ExtensionContext {
    readonly extension: {
        id: string;
        version: string;
        displayName: string;
    };
    /** Disposed by the host on deactivation; add every registration here. */
    readonly subscriptions: DisposableStore;
    readonly log: Logger;
    readonly settings: SettingsApi;
    readonly storage: StorageApi;
    readonly commands: CommandsApi;
    readonly ui: UiApi;
    readonly conversations: ConversationsApi;
    readonly tools: ToolsApi;
    readonly providers: ProvidersApi;
    readonly http: HttpApi;
    readonly proposed: ProposedApi;
}
/** The shape of an extension's entry module. */
export interface ExtensionModule {
    activate(ctx: ExtensionContext): void | Promise<void>;
    deactivate?(): void | Promise<void>;
}

// ---- contributions.d.ts ----

import type { ModelCapability } from './capabilities.js';
/** A JSON value as it survives `JSON.stringify` and structured clone alike. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
    [key: string]: JsonValue;
}
/** A JSON Schema whose root describes an object, as tool inputs must. */
export interface JsonSchemaObject {
    type: 'object';
    properties?: Record<string, JsonObject>;
    required?: string[];
    [keyword: string]: JsonValue | undefined;
}
/** Places in the host UI where contributed commands can appear. */
export type MenuLocation = 'commandPalette' | 'thread/context' | 'message/actions' | 'chatInput/actions';
/** The closed set of visibility conditions for menu items. */
export type WhenClause = 'always' | 'message.role == assistant' | 'message.role == user' | 'thread.hasMessages';
/**
 * Text fields accept a literal or `%key%`, which the host resolves through
 * the manifest `l10n` table.
 */
export interface CommandContribution {
    id: string;
    title: string;
    category?: string;
    /** A Tabler icon name in kebab case, for example `hand-stop`. */
    icon?: string;
}
export interface MenuItemContribution {
    /** The id of a command declared in the same manifest. */
    command: string;
    when?: WhenClause;
    group?: string;
    order?: number;
}
export interface StatusItemContribution {
    id: string;
    text: string;
    tooltip?: string;
    /** The id of a command declared in the same manifest, run on click. */
    command?: string;
    priority?: number;
}
export type SettingControl = {
    type: 'input';
    inputType?: 'text' | 'url' | 'number';
    placeholder?: string;
    default: string;
} | {
    type: 'checkbox';
    default: boolean;
} | {
    type: 'dropdown';
    options: {
        value: string;
        label: string;
    }[];
    default: string;
} | {
    type: 'slider';
    min: number;
    max: number;
    step: number;
    default: number;
} | {
    type: 'textarea';
    rows?: number;
    default: string;
};
/** A setting value; its type follows the control's `default`. */
export type SettingValue = SettingControl['default'];
export interface SettingContribution {
    key: string;
    title: string;
    description?: string;
    /** Stored in the OS keyring instead of the settings file. */
    secret?: boolean;
    control: SettingControl;
}
/** Declared statically so the consent screen can list tools before install. */
export interface ToolContribution {
    name: string;
    description: string;
    inputSchema: JsonSchemaObject;
}
export interface ProviderContribution {
    id: string;
    displayName: string;
    /** An OpenAI-compatible base URL; its host needs a `network:` permission. */
    baseUrl: string;
    /** The key of a secret setting holding the API key. */
    apiKeySetting?: string;
    /**
     * What every model of this provider can do, unless its `listModels` entry
     * says otherwise. Defaults to `['completion']`; declare `tools` for chat
     * to offer tool calls.
     */
    capabilities?: ModelCapability[];
}
export interface Contributions {
    settings?: SettingContribution[];
    commands?: CommandContribution[];
    menus?: Partial<Record<MenuLocation, MenuItemContribution[]>>;
    statusItems?: StatusItemContribution[];
    tools?: ToolContribution[];
    providers?: ProviderContribution[];
}

// ---- disposable.d.ts ----

/** Something that holds a resource or a registration until it is disposed. */
export interface Disposable {
    dispose(): void;
}
/** Wraps a cleanup function; the function runs at most once. */
export declare function toDisposable(fn: () => void): Disposable;
/**
 * A set of disposables released together. Members are disposed in reverse
 * order of addition, so a registration made on top of an earlier one is torn
 * down first.
 *
 * The state lives in private fields, which stay writable when the store is
 * frozen: an extension worker hardens its `ctx`, `subscriptions` included.
 */
export declare class DisposableStore implements Disposable {
    #private;
    /**
     * Adds a member. Adding to a disposed store disposes the member at once, so
     * a registration that races with teardown cannot leak.
     */
    add<T extends Disposable>(d: T): T;
    /**
     * Disposes every member once. A throwing member does not stop the rest;
     * the first error is rethrown after all members ran.
     */
    dispose(): void;
}

// ---- errors.d.ts ----

/**
 * Why a host call failed. The same codes travel over the worker RPC, so
 * extensions can branch on `code` wherever their code runs.
 */
export type ExtensionErrorCode = 'E_PERMISSION' | 'E_INVALID_ARGS' | 'E_NOT_FOUND' | 'E_TIMEOUT' | 'E_CANCELLED' | 'E_DISPOSED' | 'E_TOO_LARGE' | 'E_INTERNAL';
/** An error raised by the host for a call through `ExtensionContext`. */
export declare class ExtensionError extends Error {
    readonly code: ExtensionErrorCode;
    constructor(code: ExtensionErrorCode, message: string);
}

// ---- event.d.ts ----

import type { Disposable } from './disposable.js';
/** Subscribes a listener; dispose the result to unsubscribe. */
export type Event<T> = (listener: (e: T) => void) => Disposable;
/** The producing side of an `Event`. */
export declare class Emitter<T> {
    private listeners;
    readonly event: Event<T>;
    /**
     * Delivers `e` to every current listener. A throwing listener is reported
     * and skipped, so one subscriber cannot starve the others.
     */
    fire(e: T): void;
    /** Drops every listener. */
    dispose(): void;
}

// ---- index.d.ts ----

/**
 * The stable API for Jan desktop extensions. `./manifest` re-exports the
 * manifest types and validator for tooling that only lints package.json.
 */
export { API_VERSION } from './api-version.js';
export { DEFAULT_MODEL_CAPABILITIES, isModelCapability, MODEL_CAPABILITIES, type ModelCapability, } from './capabilities.js';
export { DisposableStore, toDisposable, type Disposable } from './disposable.js';
export { Emitter, type Event } from './event.js';
export { ExtensionError, type ExtensionErrorCode } from './errors.js';
export { isLocalHost, isNetworkHost, isPermissionString, networkHostMatches, networkHostOf, type PermissionKind, type PermissionString, } from './permissions.js';
export { isApiCompatible } from './semver.js';
export { isContributionId, RESERVED_PUBLISHER, validateManifest, } from './validate.js';
export type * from './context.js';
export type * from './contributions.js';
export type { JanManifest, ManifestError, ProposalName, ValidatedManifest, ValidateOptions, ValidationResult, } from './manifest.js';

// ---- manifest.d.ts ----

import type { Contributions } from './contributions.js';
import type { PermissionString } from './permissions.js';
export { RESERVED_PUBLISHER, validateManifest } from './validate.js';
export { isApiCompatible } from './semver.js';
export { API_VERSION } from './api-version.js';
export type * from './contributions.js';
export type { PermissionString, PermissionKind } from './permissions.js';
/** Proposed API groups an extension can opt into (built-in and dev only). */
export type ProposalName = 'chat';
/** The `jan` field of an extension's package.json. */
export interface JanManifest {
    /** `<publisher>.<name>`, lowercase, for example `acme.hello-provider`. */
    id: string;
    /** A literal or `%key%` into `l10n`. */
    displayName: string;
    description?: string;
    publisher: string;
    /** A caret range on this package's version, for example `^1.0.0`. */
    apiVersion: string;
    /** Relative path to the worker bundle (IIFE assigning `JanExtension`). */
    main: string;
    permissions: PermissionString[];
    proposals?: ProposalName[];
    contributes?: Contributions;
    /** locale -> key -> text. `en` must hold every `%key%` used. */
    l10n?: Record<string, Record<string, string>>;
}
/** A manifest that passed `validateManifest`, with its package identity. */
export interface ValidatedManifest extends JanManifest {
    name: string;
    version: string;
    /** `engines.jan` of the package: the app versions it supports. */
    engines?: {
        jan: string;
    };
}
export interface ManifestError {
    /** Where the problem is, for example `jan.contributes.commands[1].id`. */
    path: string;
    message: string;
}
export interface ValidateOptions {
    /**
     * Accepts ids under the reserved `jan` publisher. Only the host sets it,
     * for the built-ins it ships; installable extensions never may.
     */
    builtin?: boolean;
}
export type ValidationResult = {
    ok: true;
    manifest: ValidatedManifest;
} | {
    ok: false;
    errors: ManifestError[];
};

// ---- permissions.d.ts ----

/**
 * What an extension may ask for in `jan.permissions`. Everything not listed
 * here (own settings, own contributions, logging, own storage) is implicit.
 */
export type PermissionString = 'ui:notify' | 'providers' | 'tools' | 'conversations:read' | 'conversations:write' | 'chat:hooks' | `network:${string}`;
/** A permission with any `network:<host>` collapsed to `network`. */
export type PermissionKind = Exclude<PermissionString, `network:${string}`> | 'network';
/**
 * True for a host grant usable after `network:`: `*`, an exact host
 * (`api.example.com`, `127.0.0.1`, `localhost`) or a subdomain wildcard
 * (`*.example.com`). No scheme, port or path: the scheme rule is fixed
 * (https, or http for local hosts) and ports are not a trust boundary.
 */
export declare function isNetworkHost(host: string): boolean;
/** Narrows a manifest entry to a well-formed `PermissionString`. */
export declare function isPermissionString(value: string): value is PermissionString;
/** The host part of a `network:<host>` permission, or undefined for any other. */
export declare function networkHostOf(permission: PermissionString): string | undefined;
/**
 * Whether the host grant `grant` (as returned by `networkHostOf`) covers the
 * URL host `host`. `*.example.com` covers subdomains only, not the apex, so
 * granting an API subdomain never silently grants the main site.
 */
export declare function networkHostMatches(grant: string, host: string): boolean;
/** Hosts reachable over plain http; everything else must use https. */
export declare function isLocalHost(host: string): boolean;

// ---- semver.d.ts ----

/** True for a full semver 2.0.0 version, prerelease and build parts included. */
export declare function isSemver(version: string): boolean;
/** True for the only range form manifests may use: `^MAJOR.MINOR.PATCH`. */
export declare function isCaretRange(range: string): boolean;
/**
 * Whether a host API `host` (plain `MAJOR.MINOR.PATCH`) satisfies the caret
 * range `range`, with npm's caret semantics: the left-most non-zero part is
 * locked, so before 1.0 every minor is a breaking change. Hand-rolled so the
 * package needs no dependency; anything but a caret range is incompatible.
 */
export declare function isApiCompatible(range: string, host: string): boolean;

// ---- validate.d.ts ----

import type { ValidateOptions, ValidationResult } from './manifest.js';
/**
 * The publisher part of every built-in extension id (`jan.<name>`). The host
 * refuses to run a third-party extension under it, so `validateManifest`
 * refuses it too, before anyone is asked to consent to an install.
 */
export declare const RESERVED_PUBLISHER = "jan";
/**
 * The grammar of a command, status item or provider id and of a tool name:
 * up to 64 letters, digits, `.`, `_` and `-`, starting with a letter or
 * digit. Hosts look contributions up by these ids, so none of them can be
 * `__proto__`; names such as `constructor` stay valid and hosts must look
 * them up as own properties.
 */
export declare function isContributionId(value: unknown): value is string;
/**
 * Validates a whole package.json and returns its `jan` manifest together
 * with the package name, version and `engines.jan`. The same rules run in the
 * host at install and load time, so authors can lint with this function.
 *
 * Ids under {@link RESERVED_PUBLISHER} are refused unless `options.builtin`
 * is set, which only the host does for the built-ins it ships.
 */
export declare function validateManifest(pkg: unknown, options?: ValidateOptions): ValidationResult;
