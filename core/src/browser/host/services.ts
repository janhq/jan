import { Emitter, toDisposable, type Disposable, type Event } from '@janhq/extension-api'
import type { AssistantInterface } from '../../types'
import type { DownloadItem } from '../download'

/**
 * A typed handle for a host service. `T` exists only at compile time; the
 * phantom field makes `ServiceKey<A>` and `ServiceKey<B>` incompatible.
 */
export class ServiceKey<T> {
  declare readonly _t?: T
  constructor(readonly id: string) {}
}

/** Where built-ins publish services and the app looks them up. */
export interface ServiceRegistry {
  /**
   * Publishes `impl` under `key` until the result is disposed. Throws when
   * another provider holds the key: two silent providers would make lookups
   * depend on activation order.
   */
  provide<T>(key: ServiceKey<T>, impl: T): Disposable
  get<T>(key: ServiceKey<T>): T | undefined
  /** Fires the key id whenever a provider appears or goes away. */
  readonly onDidChange: Event<string>
}

export function createServiceRegistry(): ServiceRegistry {
  const impls = new Map<string, unknown>()
  const changes = new Emitter<string>()
  return {
    provide<T>(key: ServiceKey<T>, impl: T): Disposable {
      if (impls.has(key.id)) throw new Error(`Service '${key.id}' is already provided`)
      impls.set(key.id, impl)
      changes.fire(key.id)
      return toDisposable(() => {
        // A newer provider may hold the key after this one was replaced.
        if (impls.get(key.id) !== impl) return
        impls.delete(key.id)
        changes.fire(key.id)
      })
    },
    get<T>(key: ServiceKey<T>): T | undefined {
      return impls.get(key.id) as T | undefined
    },
    onDidChange: changes.event,
  }
}

export type AssistantService = AssistantInterface

/** File downloads with progress, as the download built-in provides them. */
export interface DownloadService {
  downloadFile(
    url: string,
    savePath: string,
    taskId: string,
    proxyConfig?: DownloadItem['proxy'],
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void>
  downloadFiles(
    items: DownloadItem[],
    taskId: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void>
  cancelDownload(taskId: string): Promise<void>
  pauseDownload(taskId: string): Promise<void>
}

export const ServiceKeys = {
  Assistants: new ServiceKey<AssistantService>('assistants'),
  Downloads: new ServiceKey<DownloadService>('downloads'),
}
