import {
  ExtensionError,
  type JsonObject,
  type JsonValue,
  type StorageApi,
} from '@janhq/extension-api'
import type { AppSettingsBackend } from './settings-store'

/** Per-extension cap on the serialized storage object. */
export const STORAGE_QUOTA_BYTES = 1024 * 1024

const storageKey = (extensionId: string) => `extension:${extensionId}:storage`

/**
 * `ctx.storage`: one JSON object per extension in `appSettings`. Writes are
 * chained so that two concurrent `set` calls cannot both read the old object
 * and drop each other's key.
 */
export function createExtensionStorage(
  extensionId: string,
  backend: AppSettingsBackend
): StorageApi {
  const key = storageKey(extensionId)
  let queue: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<JsonObject> => {
    const raw = await backend.get(key)
    return raw ? (JSON.parse(raw) as JsonObject) : {}
  }

  const write = (mutate: (data: JsonObject) => void): Promise<void> => {
    const run = queue.then(async () => {
      const data = await read()
      mutate(data)
      const serialized = JSON.stringify(data)
      if (new TextEncoder().encode(serialized).length > STORAGE_QUOTA_BYTES) {
        throw new ExtensionError(
          'E_TOO_LARGE',
          `Storage of '${extensionId}' would exceed 1 MiB`
        )
      }
      await backend.set(key, serialized)
    })
    queue = run.catch(() => undefined)
    return run
  }

  return {
    get: async <T extends JsonValue>(k: string) =>
      (await read())[k] as T | undefined,
    set: (k, value) =>
      write((data) => {
        data[k] = value
      }),
    delete: (k) =>
      write((data) => {
        delete data[k]
      }),
    keys: async () => Object.keys(await read()),
  }
}
