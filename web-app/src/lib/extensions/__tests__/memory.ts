import type { AppSettingsBackend, SecretBackend } from '../settings-store'

/** An in-memory `appSettings` that also exposes its raw data to assertions. */
export function memoryAppSettings(): AppSettingsBackend & {
  data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
  }
}

export function memorySecrets(): SecretBackend & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      if (value === '') data.delete(key)
      else data.set(key, value)
    },
  }
}
