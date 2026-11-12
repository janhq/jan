import type { SettingComponentProps } from '@janhq/core'

/**
 * The values `--load-mode` / the INI key `load-mode` accept
 * (common/arg.cpp). Anything else makes llama.cpp throw "invalid value" and the
 * whole router fail to start, so every value is checked against this list
 * before it reaches the preset.
 */
export const LOAD_MODES = [
  'auto',
  'none',
  'mmap',
  'mlock',
  'mmap+mlock',
  'dio',
] as const

export type LoadMode = (typeof LOAD_MODES)[number]

/** The value when the user has chosen nothing: upstream's own default. */
export const DEFAULT_LOAD_MODE: LoadMode = 'auto'

/** Narrows a persisted value to a load mode, or null when it is not one. */
export function parseLoadMode(value: unknown): LoadMode | null {
  return LOAD_MODES.find((mode) => mode === value) ?? null
}

/**
 * The load mode the two removed checkboxes (`mlock`, `no_mmap`) used to derive
 * in the preset. Kept identical so an upgrade changes nothing about how a
 * model loads.
 */
export function legacyLoadMode(mlock: boolean, noMmap: boolean): LoadMode {
  if (mlock) return noMmap ? 'mlock' : 'mmap+mlock'
  return noMmap ? 'none' : DEFAULT_LOAD_MODE
}

const settingValue = (
  settings: SettingComponentProps[],
  key: string
): unknown =>
  settings.find((s) => s.key === key)?.controllerProps?.value

/**
 * Carries the stored `mlock` / `no_mmap` checkboxes over into `load_mode`, in
 * place, before the stored values are merged into the shipped settings.
 *
 * Runs against the previous settings file, so it needs no version flag of its
 * own: the file written afterwards no longer has the legacy keys and a second
 * run finds nothing to convert. A `load_mode` that is already stored is the
 * user's choice and is never replaced by stale booleans.
 */
export function applyLegacyLoadMode(
  shipped: SettingComponentProps[],
  stored: SettingComponentProps[]
): void {
  if (stored.some((s) => s.key === 'load_mode')) return
  const hasLegacy = stored.some((s) => s.key === 'mlock' || s.key === 'no_mmap')
  if (!hasLegacy) return
  const target = shipped.find((s) => s.key === 'load_mode')
  if (!target) return
  target.controllerProps.value = legacyLoadMode(
    settingValue(stored, 'mlock') === true,
    settingValue(stored, 'no_mmap') === true
  )
}
