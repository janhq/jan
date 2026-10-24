import {
  API_VERSION,
  DisposableStore,
  Emitter,
  ExtensionError,
  isApiCompatible,
  toDisposable,
  type ConversationsApi,
  type Event,
  type ExtensionContext,
  type ExtensionModule,
  type PermissionString,
  type ProviderModel,
  type ValidatedManifest,
} from '@janhq/extension-api'
import { CancellationTokenSource } from '@janhq/extension-runtime'
import { z } from 'zod'
import {
  appSettings,
  createInternalToolRegistry,
  createServiceRegistry,
  downloads,
  EngineManager,
  fs,
  type InternalToolRegistry,
  type ServiceRegistry,
} from '@janhq/core'
import { toast } from 'sonner'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { i18n } from '@/i18n/react-i18next-compat'
import * as extensionsPlugin from '@janhq/tauri-plugin-extensions-api'
import type { BuiltinExtension } from './builtins'
import { createContext } from './context'
import { createConversationsApi } from './conversations'
import { ContributionStore, own, useContributions } from './contributions'
import { PermissionDispatcher } from './dispatcher'
import { createHostApi, type Notify } from './host-api'
import {
  createProviderFetch,
  type ExtensionHttp,
  type ProviderFetchMode,
} from './http'
import {
  enabledInstalled,
  startInstalled,
  type InstalledRegistry,
} from './installed-loader'
import {
  ExtensionSettingsStore,
  type AppSettingsBackend,
  type SecretBackend,
} from './settings-store'
import { toToolOutcome, type ToolCallOutcome } from './tools'
import { crashCounter } from './watchdog'
import {
  createBlobWorker,
  startWorker,
  type CreateWorker,
  type WorkerConnection,
} from './worker-runtime'

/**
 * `crashed`: the runtime stopped a running worker (it stopped answering, or
 * kept breaking the limits), as opposed to `failed` to start.
 */
export type ExtensionState =
  | 'inactive'
  | 'activating'
  | 'active'
  | 'failed'
  | 'crashed'

/**
 * Where an extension came from. Built-ins run in process; the rest run in a
 * worker: `dev` from a folder loaded unpacked, `installed` from the data
 * folder. Only `installed` ones have a network path: the plugin checks
 * every request against the grants in extensions.json, where the others
 * have no entry.
 */
export type ExtensionSource = 'builtin' | 'dev' | 'installed'

/** One extension as the host tracks it, for lists and settings pages. */
export interface HostedExtension {
  id: string
  manifest: ValidatedManifest
  source: ExtensionSource
  state: ExtensionState
  /** Why it failed to start or was stopped (`failed`, `crashed`). */
  error?: string
}

export interface SpawnWorkerOptions {
  manifest: ValidatedManifest
  /** The extension's IIFE bundle (`format: 'iife', name: 'JanExtension'`). */
  bundle: string
  /** What the user granted; never more than the manifest requests. */
  grants: readonly PermissionString[]
  source: Exclude<ExtensionSource, 'builtin'>
}

export interface ExtensionHostOptions {
  appSettings: AppSettingsBackend
  secrets: SecretBackend
  notify: Notify
  /** Defaults to a private store; the app passes `useContributions`. */
  contributions?: ContributionStore
  conversations?: ConversationsApi
  /** The network path of installed extensions; absent means none. */
  http?: ExtensionHttp
  /** The registry installed extensions are loaded and reloaded from. */
  installed?: InstalledRegistry
  /** Defaults to a blob-URL `Worker`; tests pass the sandbox harness. */
  createWorker?: CreateWorker
  /** The port of Jan's local API server, which no extension may reach. */
  localApiPort?: () => number | undefined
}

/**
 * Ids only built-ins may use: the `jan.` namespace, plus whatever id a
 * built-in of this host has, active or not. A worker extension with such
 * an id would otherwise take over the built-in's entry and settings.
 */
const RESERVED_PREFIX = 'jan.'

interface Entry {
  hosted: HostedExtension
  module?: ExtensionModule
  ctx?: ExtensionContext
  worker?: WorkerConnection
  /** Host-side registrations: contributions, settings schema, grants. */
  registrations?: DisposableStore
  /** Aborted at teardown: ends the provider streams of a stopped worker. */
  stopped?: AbortController
}

// listModels results come from extension code; only this shape is used.
const providerModels = z.array(
  z.object({ id: z.string().min(1), displayName: z.string().optional() })
)

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * Runs extensions and owns what they share: the contribution registries,
 * the settings store, the service registry and the permission dispatcher.
 * Built-ins run in process through `activate(ctx)`; third-party extensions
 * run in a worker each. Both reach the host only through the dispatcher.
 */
export class ExtensionHost {
  readonly services: ServiceRegistry = createServiceRegistry()
  /** Built-ins' tools, offered under their plain names (`internal.tools`). */
  readonly internalTools: InternalToolRegistry = createInternalToolRegistry()
  readonly dispatcher: PermissionDispatcher
  readonly contributions: ContributionStore
  readonly settings: ExtensionSettingsStore

  private readonly entries = new Map<string, Entry>()
  // Active ids in activation order, so teardown can run in reverse.
  private readonly activeOrder: string[] = []
  private readonly changes = new Emitter<void>()
  // Lifecycle calls are serialized: React StrictMode mounts, unmounts and
  // mounts the provider again without awaiting, and the second activate must
  // see the deactivation that came before it.
  private queue: Promise<unknown> = Promise.resolve()
  // The last reload of each installed id, so the next one runs after it.
  private readonly reloads = new Map<string, Promise<void>>()
  private readonly crashLimitReached = crashCounter()
  // Ids that crashed too often; not started again until the app restarts.
  private readonly disabledForSession = new Set<string>()

  /** Fires whenever an extension's state changes. */
  readonly onDidChange: Event<void> = this.changes.event

  constructor(private readonly options: ExtensionHostOptions) {
    this.dispatcher = new PermissionDispatcher(options.localApiPort)
    this.contributions = options.contributions ?? new ContributionStore()
    this.settings = new ExtensionSettingsStore({
      appSettings: options.appSettings,
      secrets: options.secrets,
    })
  }

  list(): HostedExtension[] {
    return [...this.entries.values()].map((e) => ({ ...e.hosted }))
  }

  /** Activates one built-in. Its `dependsOn` must already be active. */
  activateBuiltin(def: BuiltinExtension): Promise<void> {
    return this.activateBuiltins([def])
  }

  /**
   * Activates built-ins so that each one's `dependsOn` comes first. Never
   * rejects: a failure is logged and marks that extension (and whatever
   * depends on it) `failed` while the rest continue.
   */
  activateBuiltins(defs: BuiltinExtension[]): Promise<void> {
    return this.enqueue(async () => {
      const byId = new Map(defs.map((d) => [d.manifest.id, d]))
      const visiting = new Set<string>()
      const visit = async (def: BuiltinExtension): Promise<void> => {
        const { id } = def.manifest
        const state = this.entries.get(id)?.hosted.state
        if (state === 'active' || state === 'failed' || visiting.has(id)) {
          if (visiting.has(id))
            this.fail(def.manifest, new Error('dependency cycle'))
          return
        }
        visiting.add(id)
        for (const dep of def.dependsOn ?? []) {
          const depDef = byId.get(dep)
          if (depDef) await visit(depDef)
        }
        visiting.delete(id)
        // A cycle partner may have failed this one while we were visiting.
        if (this.entries.get(id)?.hosted.state === 'failed') return
        const blocker = (def.dependsOn ?? []).find(
          (dep) => this.entries.get(dep)?.hosted.state !== 'active'
        )
        if (blocker) {
          this.fail(
            def.manifest,
            new Error(`dependency '${blocker}' is not active`)
          )
          return
        }
        await this.activate(def)
      }
      for (const def of defs) await visit(def)
    })
  }

  /** Deactivates every active extension, last activated first. */
  deactivateAll(): Promise<void> {
    return this.enqueue(async () => {
      for (const id of [...this.activeOrder].reverse()) {
        const entry = this.entries.get(id)
        if (entry) await this.teardown(entry)
      }
    })
  }

  /**
   * Starts a third-party extension in its own worker. Resolves with its
   * entry once it is active, or failed with the reason; never rejects for
   * the extension's own faults. Grants beyond what the manifest requests
   * are dropped.
   */
  spawnWorkerExtension(options: SpawnWorkerOptions): Promise<HostedExtension> {
    const { manifest, source } = options
    return this.enqueue(async () => {
      if (
        manifest.id.startsWith(RESERVED_PREFIX) ||
        this.entries.get(manifest.id)?.hosted.source === 'builtin'
      )
        throw new ExtensionError(
          'E_PERMISSION',
          `The id '${manifest.id}' is reserved for Jan's built-in extensions`
        )
      const existing = this.entries.get(manifest.id)?.hosted
      if (existing?.state === 'active' || existing?.state === 'activating')
        throw new ExtensionError(
          'E_INVALID_ARGS',
          `Extension '${manifest.id}' is already running`
        )
      // An installed copy and a development copy of one id would share its
      // settings and contributions; whichever came first keeps it.
      if (existing && existing.source !== source)
        throw new ExtensionError(
          'E_INVALID_ARGS',
          `Extension '${manifest.id}' is already loaded from another source`
        )
      const entry: Entry = {
        hosted: { id: manifest.id, manifest, source, state: 'activating' },
      }
      this.entries.set(manifest.id, entry)
      this.changes.fire()
      try {
        if (this.disabledForSession.has(manifest.id))
          throw new Error(
            'it crashed too often and is disabled for this session'
          )
        if (!isApiCompatible(manifest.apiVersion, API_VERSION)) {
          throw new Error(
            `needs extension API ${manifest.apiVersion}, host provides ${API_VERSION}`
          )
        }
        // Proposed APIs may change in any minor, so only a developer's own
        // unpacked folder may opt into them.
        if (source !== 'dev' && manifest.proposals?.length)
          throw new Error('proposals are only allowed when loaded unpacked')
        const requested = new Set(manifest.permissions)
        entry.registrations = this.register(
          manifest,
          options.grants.filter((g) => requested.has(g))
        )
        entry.worker = await startWorker({
          manifest,
          bundle: options.bundle,
          createWorker: this.options.createWorker ?? createBlobWorker,
          dispatcher: this.dispatcher,
          api: createHostApi(manifest, {
            ...this.apiDeps(),
            http: source === 'installed' ? this.options.http : undefined,
          }),
          onCrash: (error) => this.onCrash(entry, error),
        })
        entry.stopped = new AbortController()
        entry.hosted.state = 'active'
        this.activeOrder.push(manifest.id)
        this.changes.fire()
      } catch (error) {
        await this.teardown(entry)
        this.fail(manifest, error, source)
      }
    }).then(() => ({ ...this.entries.get(manifest.id)!.hosted }))
  }

  /**
   * Stops one extension and releases everything it registered. A worker is
   * asked to deactivate first and terminated regardless.
   */
  terminate(extensionId: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.entries.get(extensionId)
      if (entry) await this.teardown(entry)
    })
  }

  /**
   * Loads every enabled installed extension from the registry, all at
   * once; nothing in safe mode. One that fails is marked `failed` and the
   * rest still load.
   */
  async loadInstalled(): Promise<void> {
    const registry = this.options.installed
    if (!registry) return
    const entries = await enabledInstalled(registry)
    await Promise.allSettled(entries.map((e) => this.reload(e.id)))
  }

  /**
   * Brings the running copy of an installed extension in line with the
   * registry after it changed (enable, grants, install, update, rollback,
   * uninstall): stops it, then starts it again from the registry if it is
   * still installed and enabled, so the new grants and version apply.
   *
   * Reloads of one id run one after another, each reading the registry
   * only once the one before it is done. Overlapping ones could let a
   * reload that read the old grants start the worker last, and the newer
   * start would then be refused as already running.
   */
  reload(extensionId: string): Promise<void> {
    const run = (this.reloads.get(extensionId) ?? Promise.resolve()).then(
      () => this.reloadNow(extensionId)
    )
    const tail = run.catch(() => undefined)
    this.reloads.set(extensionId, tail)
    void tail.then(() => {
      if (this.reloads.get(extensionId) === tail)
        this.reloads.delete(extensionId)
    })
    return run
  }

  private async reloadNow(extensionId: string): Promise<void> {
    const source = this.entries.get(extensionId)?.hosted.source
    if (source !== undefined && source !== 'installed') return
    await this.unload(extensionId)
    const registry = this.options.installed
    if (registry) await startInstalled(this, registry, extensionId)
  }

  /**
   * Records that an installed extension could not be started, so its
   * reason shows next to it. Whatever else holds the id (a built-in, a
   * development copy, a copy already running) keeps its entry.
   */
  markFailed(manifest: ValidatedManifest, error: unknown): Promise<void> {
    return this.enqueue(async () => {
      const hosted = this.entries.get(manifest.id)?.hosted
      const running =
        hosted?.state === 'active' || hosted?.state === 'activating'
      if (!hosted || (hosted.source === 'installed' && !running))
        this.fail(manifest, error, 'installed')
    })
  }

  /**
   * The `fetch` inference with a contributed provider runs on: the
   * extension's own network path, checked against its grants on every URL
   * and redirect hop, and ended when the extension stops. Undefined unless
   * it is an installed extension that is running: built-ins contribute no
   * providers, and a folder loaded for development has no network path.
   */
  providerFetch(
    extensionId: string,
    mode: ProviderFetchMode
  ): typeof globalThis.fetch | undefined {
    const entry = this.entries.get(extensionId)
    const http = this.options.http
    if (!http || entry?.hosted.source !== 'installed' || !entry.stopped)
      return undefined
    return createProviderFetch({
      extensionId,
      http,
      checkUrl: (url) => this.dispatcher.checkUrl(extensionId, url),
      stopped: entry.stopped.signal,
      mode,
    })
  }

  /**
   * Stops a worker extension and forgets it, so it leaves `list()`. Nothing
   * about a worker extension is kept host-side, so loading it again starts
   * from scratch. Built-ins cannot be unloaded.
   */
  unload(extensionId: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.entries.get(extensionId)
      if (!entry) return
      if (entry.hosted.source === 'builtin')
        throw new ExtensionError(
          'E_INVALID_ARGS',
          `Extension '${extensionId}' is a built-in and cannot be unloaded`
        )
      await this.teardown(entry)
      this.entries.delete(extensionId)
      this.changes.fire()
    })
  }

  /**
   * Runs a contributed tool. Aborting `signal` (the chat's Stop) cancels the
   * call in the extension too. Failures come back as an `error` outcome,
   * like other tool sources, rather than as a rejection.
   */
  async callTool(
    extensionId: string,
    name: string,
    input: unknown,
    options: { signal?: AbortSignal; maxOutputChars?: number } = {}
  ): Promise<ToolCallOutcome> {
    const handler = own(own(this.contributions.getState().tools, extensionId), name)
      ?.handler
    if (!handler)
      return { error: `Tool '${name}' of '${extensionId}' is not available` }
    const cancellation = new CancellationTokenSource()
    const cancel = () => cancellation.cancel()
    if (options.signal?.aborted) cancel()
    options.signal?.addEventListener('abort', cancel, { once: true })
    try {
      return toToolOutcome(
        await handler(input, cancellation.token),
        options.maxOutputChars
      )
    } catch (error) {
      return { error: message(error) }
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
  }

  /** The models a contributed provider reports through `listModels`. */
  async listProviderModels(
    extensionId: string,
    providerId: string
  ): Promise<ProviderModel[] | undefined> {
    const handler = own(
      own(this.contributions.getState().providers, extensionId),
      providerId
    )?.handler
    if (!handler?.listModels) return undefined
    const parsed = providerModels.safeParse(await handler.listModels())
    if (!parsed.success)
      throw new ExtensionError(
        'E_INVALID_ARGS',
        `'${extensionId}' returned an invalid model list`
      )
    return parsed.data
  }

  /**
   * A running worker was stopped by the runtime. It is marked `crashed` and
   * released. An installed one is started again from the registry, unless
   * it crashed CRASH_LIMIT times within the window: then it stays off until
   * the app restarts, and the user is told.
   */
  private onCrash(entry: Entry, error: Error): void {
    const { id, manifest, source } = entry.hosted
    void this.enqueue(async () => {
      if (this.entries.get(id) !== entry || entry.hosted.state !== 'active')
        return
      // Marked first, so teardown does not ask a dead worker to deactivate.
      entry.hosted = { ...entry.hosted, state: 'crashed', error: error.message }
      await this.teardown(entry)
      this.changes.fire()
    })
    if (this.crashLimitReached(id)) {
      this.disabledForSession.add(id)
      this.options.notify({
        extensionName: manifest.displayName,
        level: 'error',
        message: i18n.t('extensions:crashed.disabled'),
      })
    } else if (source === 'installed') {
      void this.reload(id)
    }
  }

  /** Registers what the host holds for an extension; dispose releases it. */
  private register(
    manifest: ValidatedManifest,
    grants: readonly PermissionString[]
  ): DisposableStore {
    const registrations = new DisposableStore()
    registrations.add(this.contributions.registerExtension(manifest))
    registrations.add(this.settings.register(manifest))
    this.dispatcher.grant(manifest.id, grants)
    registrations.add(
      toDisposable(() => this.dispatcher.revokeAll(manifest.id))
    )
    return registrations
  }

  private apiDeps() {
    return {
      dispatcher: this.dispatcher,
      contributions: this.contributions,
      settings: this.settings,
      storage: this.options.appSettings,
      notify: this.options.notify,
      conversations: this.options.conversations,
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async activate(def: BuiltinExtension): Promise<void> {
    const { manifest } = def
    const entry: Entry = {
      hosted: {
        id: manifest.id,
        manifest,
        source: 'builtin',
        state: 'activating',
      },
    }
    this.entries.set(manifest.id, entry)
    this.changes.fire()
    try {
      if (!isApiCompatible(manifest.apiVersion, API_VERSION)) {
        throw new Error(
          `needs extension API ${manifest.apiVersion}, host provides ${API_VERSION}`
        )
      }
      // P1: a built-in gets exactly what its manifest requests.
      entry.registrations = this.register(manifest, manifest.permissions)

      entry.module = await def.load()
      entry.ctx = createContext(
        manifest,
        this.apiDeps(),
        {
          services: this.services,
          fs,
          appSettings,
          downloads,
          secrets: { get: (key) => this.options.secrets.get(key) },
          engines: { register: (engine) => EngineManager.instance().register(engine) },
          tools: this.internalTools,
        }
      )
      await entry.module.activate(entry.ctx)
      entry.hosted.state = 'active'
      this.activeOrder.push(manifest.id)
      this.changes.fire()
    } catch (error) {
      // Release whatever the failed activate managed to register.
      await this.teardown(entry)
      this.fail(manifest, error)
    }
  }

  private fail(
    manifest: ValidatedManifest,
    error: unknown,
    source: ExtensionSource = 'builtin'
  ): void {
    console.error(`Extension '${manifest.id}' failed to activate:`, error)
    const entry = this.entries.get(manifest.id)
    const hosted: HostedExtension = {
      id: manifest.id,
      manifest,
      source,
      state: 'failed',
      error: message(error),
    }
    if (entry) entry.hosted = hosted
    else this.entries.set(manifest.id, { hosted })
    this.changes.fire()
  }

  private async teardown(entry: Entry): Promise<void> {
    const { id } = entry.hosted
    const wasActive = entry.hosted.state === 'active'
    if (wasActive) {
      try {
        await entry.module?.deactivate?.()
      } catch (error) {
        console.error(`Extension '${id}' failed to deactivate:`, error)
      }
      await entry.worker?.deactivate()
    }
    entry.worker?.terminate()
    entry.stopped?.abort()
    for (const store of [entry.ctx?.subscriptions, entry.registrations]) {
      try {
        store?.dispose()
      } catch (error) {
        console.error(`Extension '${id}' failed to dispose:`, error)
      }
    }
    entry.module = undefined
    entry.ctx = undefined
    entry.worker = undefined
    entry.stopped = undefined
    entry.registrations = undefined
    const index = this.activeOrder.indexOf(id)
    if (index >= 0) this.activeOrder.splice(index, 1)
    if (wasActive) {
      entry.hosted = { ...entry.hosted, state: 'inactive' }
      this.changes.fire()
    }
  }
}

/**
 * The title of an extension's toast. The display name is the extension's
 * own claim, so it never stands alone: a fixed prefix keeps an extension
 * named "Jan" from passing for the app.
 */
export const toastTitle = (extensionName: string) =>
  i18n.t('extensions:extensionLabel', { extension: extensionName })

const notify: Notify = ({ extensionName, level, message }) => {
  const show = {
    info: toast.info,
    success: toast.success,
    warning: toast.warning,
    error: toast.error,
  }[level]
  show(toastTitle(extensionName), { description: message })
}

// Secrets go through the core service's `get_secret`/`set_secret`, the same
// keyring path the provider keys and the Hugging Face token use.
const secrets: SecretBackend = {
  get: (key) =>
    getServiceHub().core().invoke<string | null>('get_secret', { key }),
  set: (key, value) =>
    getServiceHub().core().invoke<void>('set_secret', { key, value }),
}

let host: ExtensionHost | undefined

/** The app-wide host, wired to the real settings, keyring and toasts. */
export function getExtensionHost(): ExtensionHost {
  host ??= new ExtensionHost({
    appSettings,
    secrets,
    notify,
    contributions: new ContributionStore(useContributions),
    // Resolved per call: the hub is ready before any extension activates,
    // but the host may be constructed earlier.
    conversations: createConversationsApi(getServiceHub),
    http: extensionsPlugin,
    installed: extensionsPlugin,
    localApiPort: () => useLocalApiServer.getState().serverPort,
  })
  return host
}
