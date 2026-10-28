import type { SettingComponentProps } from '@janhq/core'

/**
 * Turns the shipped `fit: true` default off on macOS, in place, before the
 * settings are registered.
 *
 * With mmap on (the default) Metal counts the whole mapped file against
 * `recommendedMaxWorkingSetSize`, which fit does not model, so it plans a load
 * that still fails (janhq/jan#9198). Only the default changes: a value the
 * user already stored wins in `registerSettings`.
 */
export function applyPlatformFitDefault(
  settings: SettingComponentProps[],
  isMac: boolean
): void {
  if (!isMac) return
  const fit = settings.find((s) => s.key === 'fit')
  if (fit) fit.controllerProps.value = false
}
