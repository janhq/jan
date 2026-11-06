import type { InternalExtensionContext } from '@janhq/core'

export type SettingsApi = InternalExtensionContext['settings']
export type SettingValue = Parameters<SettingsApi['set']>[1]

/**
 * Where the pre-host extension kept its settings: a localStorage array of
 * `{ key, controllerProps: { value } }` under the package name.
 */
export const LEGACY_SETTINGS_KEY = '@janhq/rag-extension'

// Older profiles stored the chunk sizes under token-named keys.
const LEGACY_ALIASES: Record<string, string> = {
  chunk_size_tokens: 'chunk_size_chars',
  overlap_tokens: 'overlap_chars',
}

interface LegacySetting {
  key?: unknown
  controllerProps?: { value?: unknown }
}

// The legacy input controls could hand back numbers as strings; the stored
// value takes the type of the declared default instead.
function coerce(value: unknown, like: SettingValue): SettingValue | undefined {
  if (typeof like === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    return typeof value !== 'boolean' && value !== '' && Number.isFinite(n) ? n : undefined
  }
  if (typeof like === 'boolean') return typeof value === 'boolean' ? value : undefined
  return typeof value === 'string' ? value : undefined
}

/**
 * Copies the legacy settings into the host settings store once, then removes
 * the legacy key, so a second run finds nothing to do. A value the declared
 * control does not accept (out of range, unknown option) is dropped and that
 * setting stays on its default; an undeclared key is ignored.
 */
export async function migrateLegacySettings(
  settings: SettingsApi,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage
): Promise<void> {
  const raw = storage.getItem(LEGACY_SETTINGS_KEY)
  if (raw === null) return
  let legacy: unknown
  try {
    legacy = JSON.parse(raw)
  } catch {
    legacy = undefined
  }
  const values = new Map<string, unknown>()
  for (const entry of Array.isArray(legacy) ? (legacy as LegacySetting[]) : []) {
    if (typeof entry?.key !== 'string') continue
    const value = entry.controllerProps?.value
    if (value === undefined || value === null) continue
    const alias = LEGACY_ALIASES[entry.key]
    // The current key wins over its legacy alias, in whichever order they come.
    if (alias) {
      if (!values.has(alias)) values.set(alias, value)
    } else values.set(entry.key, value)
  }
  for (const [key, value] of values) {
    const current = await settings.get(key)
    if (current === undefined) continue
    const next = coerce(value, current)
    if (next === undefined) continue
    try {
      await settings.set(key, next)
    } catch {
      // Rejected by the declared control; the default stays.
    }
  }
  storage.removeItem(LEGACY_SETTINGS_KEY)
}
