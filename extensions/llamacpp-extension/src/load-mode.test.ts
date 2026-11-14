import { describe, it, expect } from 'vitest'
import type { SettingComponentProps } from '@janhq/core'
import settingsJson from '../settings.json'
import {
  LOAD_MODES,
  applyLegacyLoadMode,
  legacyLoadMode,
  parseLoadMode,
} from './load-mode'

const entry = (key: string, value: unknown): SettingComponentProps =>
  ({
    key,
    title: key,
    description: '',
    controllerType: 'checkbox',
    controllerProps: { value },
  }) as SettingComponentProps

const shipped = (): SettingComponentProps[] =>
  structuredClone(settingsJson) as unknown as SettingComponentProps[]

const loadModeOf = (settings: SettingComponentProps[]) =>
  settings.find((s) => s.key === 'load_mode')?.controllerProps.value

describe('parseLoadMode', () => {
  it('accepts exactly the values llama.cpp accepts', () => {
    expect([...LOAD_MODES]).toEqual([
      'auto',
      'none',
      'mmap',
      'mlock',
      'mmap+mlock',
      'dio',
    ])
    for (const mode of LOAD_MODES) expect(parseLoadMode(mode)).toBe(mode)
  })

  it('rejects anything else, including near misses', () => {
    for (const bad of ['', 'MMAP', ' mmap', 'mmap+', 'direct', 1, true, null, undefined]) {
      expect(parseLoadMode(bad), String(bad)).toBeNull()
    }
  })
})

describe('legacyLoadMode', () => {
  // The mapping the preset used to derive from the two checkboxes.
  it.each([
    [false, false, 'auto'],
    [false, true, 'none'],
    [true, false, 'mmap+mlock'],
    [true, true, 'mlock'],
  ] as const)('mlock=%s no_mmap=%s -> %s', (mlock, noMmap, expected) => {
    expect(legacyLoadMode(mlock, noMmap)).toBe(expected)
  })
})

describe('shipped load_mode setting', () => {
  it('is a dropdown of the six upstream values defaulting to auto', () => {
    const setting = shipped().find((s) => s.key === 'load_mode')
    expect(setting?.controllerType).toBe('dropdown')
    const props = setting?.controllerProps as {
      value: string
      options: { value: string; name: string }[]
    }
    expect(props.value).toBe('auto')
    expect(props.options.map((o) => o.value)).toEqual([...LOAD_MODES])
  })

  it('no longer ships the two checkboxes it replaced', () => {
    const keys = shipped().map((s) => s.key)
    expect(keys).not.toContain('no_mmap')
    expect(keys).not.toContain('mlock')
  })
})

describe('applyLegacyLoadMode', () => {
  it.each([
    [false, false, 'auto'],
    [false, true, 'none'],
    [true, false, 'mmap+mlock'],
    [true, true, 'mlock'],
  ] as const)(
    'carries mlock=%s no_mmap=%s over as %s',
    (mlock, noMmap, expected) => {
      const settings = shipped()
      applyLegacyLoadMode(settings, [
        entry('no_mmap', noMmap),
        entry('mlock', mlock),
      ])
      expect(loadModeOf(settings)).toBe(expected)
    }
  )

  it('treats a missing half as off', () => {
    const settings = shipped()
    applyLegacyLoadMode(settings, [entry('mlock', true)])
    expect(loadModeOf(settings)).toBe('mmap+mlock')
  })

  it('leaves the default alone when the old file had neither key', () => {
    const settings = shipped()
    applyLegacyLoadMode(settings, [entry('fit', true)])
    expect(loadModeOf(settings)).toBe('auto')
  })

  // A user who already picked a load mode must not be overwritten by stale
  // booleans that happen to still sit in the file.
  it('never overrides a load_mode the user already stored', () => {
    const settings = shipped()
    applyLegacyLoadMode(settings, [
      entry('no_mmap', true),
      entry('mlock', true),
      entry('load_mode', 'dio'),
    ])
    expect(loadModeOf(settings)).toBe('auto')
  })

  it('is idempotent once the old keys are gone', () => {
    const settings = shipped()
    applyLegacyLoadMode(settings, [entry('no_mmap', true)])
    expect(loadModeOf(settings)).toBe('none')
    // What registerSettings writes back has no legacy keys, so a rerun is a no-op.
    applyLegacyLoadMode(settings, [entry('load_mode', 'none')])
    expect(loadModeOf(settings)).toBe('none')
  })
})
