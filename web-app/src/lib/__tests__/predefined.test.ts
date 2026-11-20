import { describe, it, expect } from 'vitest'
import { modelSettings } from '../predefined'

describe('modelSettings.load_mode', () => {
  const setting = modelSettings.load_mode

  it('is a dropdown keyed load_mode', () => {
    expect(setting.key).toBe('load_mode')
    expect(setting.controller_type).toBe('dropdown')
  })

  // Empty is "inherit global": the extension drops the yaml key, so the model
  // section carries no load-mode line and the engine-wide value applies.
  it('defaults to inheriting the global value', () => {
    expect(setting.controller_props.value).toBe('')
    expect(setting.controller_props.options[0]).toEqual({
      value: '',
      name: 'Inherit global',
    })
  })

  it('offers the six values llama.cpp accepts after the inherit option', () => {
    expect(
      setting.controller_props.options.slice(1).map((o) => o.value)
    ).toEqual(['auto', 'none', 'mmap', 'mlock', 'mmap+mlock', 'dio'])
  })
})

describe('modelSettings.moe_cache_cpu_share', () => {
  const setting = modelSettings.moe_cache_cpu_share

  it('is a number input keyed moe_cache_cpu_share', () => {
    expect(setting.key).toBe('moe_cache_cpu_share')
    expect(setting.controller_type).toBe('input')
    expect(setting.controller_props.type).toBe('number')
  })

  // Empty leaves upstream's default of 0; llama.cpp rejects a share outside
  // [0, 1], so the stepper must not walk past either end.
  it('starts empty and is bounded to [0, 1]', () => {
    expect(setting.controller_props.value).toBe('')
    expect(setting.controller_props.min).toBe(0)
    expect(setting.controller_props.max).toBe(1)
    expect(setting.controller_props.step).toBeGreaterThan(0)
    expect(setting.controller_props.step).toBeLessThan(1)
  })
})
