import { describe, it, expect } from 'vitest'
import type { SettingComponentProps } from '@janhq/core'
import settingsJson from '../settings.json'
import { applyPlatformFitDefault } from './fit-default'

const shipped = (): SettingComponentProps[] =>
  structuredClone(settingsJson) as unknown as SettingComponentProps[]

const fitOf = (settings: SettingComponentProps[]) =>
  settings.find((s) => s.key === 'fit')?.controllerProps.value

describe('fit default', () => {
  it('ships on', () => {
    expect(fitOf(shipped())).toBe(true)
  })

  it('stays on off macOS', () => {
    const settings = shipped()
    applyPlatformFitDefault(settings, false)
    expect(fitOf(settings)).toBe(true)
  })

  // janhq/jan#9198: with mmap on, Metal counts the mapped file against the
  // working set, which fit does not model.
  it('is off on macOS', () => {
    const settings = shipped()
    applyPlatformFitDefault(settings, true)
    expect(fitOf(settings)).toBe(false)
  })
})
