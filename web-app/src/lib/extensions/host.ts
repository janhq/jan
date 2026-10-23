import {
  API_VERSION,
  DisposableStore,
  Emitter,
  isApiCompatible,
  toDisposable,
  type ConversationsApi,
  type Event,
  type ExtensionContext,
  type ExtensionModule,
  type HttpApi,
  type ValidatedManifest,
} from '@janhq/extension-api'
import {
  appSettings,
  createServiceRegistry,
  downloads,
  fs,
  type ServiceRegistry,
} from '@janhq/core'
import { toast } from 'sonner'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { BuiltinExtension } from './builtins'
import { createContext, type Notify } from './context'
import { ContributionStore, useContributions } from './contributions'
import { PermissionDispatcher } from './dispatcher'
import {
  ExtensionSettingsStore,
  type AppSettingsBackend,
  type SecretBackend,
} from './settings-store'

export type ExtensionState = 'inactive' | 'activating' | 'active' | 'failed'

/** One extension as the host tracks it, for lists and settings pages. */
export interface HostedExtension {
  id: string
  manifest: ValidatedManifest
  source: 'builtin'
  state: ExtensionState
  /** Why activation failed, when `state` is `failed`. */
  error?: string
}

export interface ExtensionHostOptions {
  appSettings: AppSettingsBackend
  secrets: SecretBackend
  notify: Notify
  /** Defaults to a private store; the app passes `useContributions`. */
  contributions?: ContributionStore
  conversations?: ConversationsApi
  http?: HttpApi
}

interface Entry {
  hosted: HostedExtension
  module?: ExtensionModule
  ctx?: ExtensionContext
  /** Host-side registrations: contributions, settings schema, grants. */
  registrations?: DisposableStore
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * Runs extensions through `activate(ctx)` and owns what they share: the
 * contribution registries, the settings store, the service registry and the
 * permission dispatcher. Built-ins run in process (P1); workers join in P2.
 */
export class ExtensionHost {
  readonly services: ServiceRegistry = createServiceRegistry()
  readonly dispatcher = new PermissionDispatcher()
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

  /** Fires whenever an extension's state changes. */
  readonly onDidChange: Event<void> = this.changes.event

  constructor(private readonly options: ExtensionHostOptions) {
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
      const registrations = new DisposableStore()
      entry.registrations = registrations
      registrations.add(this.contributions.registerExtension(manifest))
      registrations.add(this.settings.register(manifest))
      // P1: a built-in gets exactly what its manifest requests.
      this.dispatcher.grant(manifest.id, manifest.permissions)
      registrations.add(
        toDisposable(() => this.dispatcher.revokeAll(manifest.id))
      )

      entry.module = await def.load()
      entry.ctx = createContext(
        manifest,
        {
          dispatcher: this.dispatcher,
          contributions: this.contributions,
          settings: this.settings,
          storage: this.options.appSettings,
          notify: this.options.notify,
          conversations: this.options.conversations,
          http: this.options.http,
        },
        { services: this.services, fs, appSettings, downloads }
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

  private fail(manifest: ValidatedManifest, error: unknown): void {
    console.error(`Extension '${manifest.id}' failed to activate:`, error)
    const entry = this.entries.get(manifest.id)
    const hosted: HostedExtension = {
      id: manifest.id,
      manifest,
      source: 'builtin',
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
    }
    for (const store of [entry.ctx?.subscriptions, entry.registrations]) {
      try {
        store?.dispose()
      } catch (error) {
        console.error(`Extension '${id}' failed to dispose:`, error)
      }
    }
    entry.module = undefined
    entry.ctx = undefined
    entry.registrations = undefined
    const index = this.activeOrder.indexOf(id)
    if (index >= 0) this.activeOrder.splice(index, 1)
    if (wasActive) {
      entry.hosted = { ...entry.hosted, state: 'inactive' }
      this.changes.fire()
    }
  }
}

const notify: Notify = ({ extensionName, level, message }) => {
  const show = {
    info: toast.info,
    success: toast.success,
    warning: toast.warning,
    error: toast.error,
  }[level]
  show(extensionName, { description: message })
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
  })
  return host
}
