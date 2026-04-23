import { describe, it, expect } from 'vitest'
import { paramsSettings } from '../predefinedParams'

describe('predefinedParams', () => {
  it('exports paramsSettings object', () => {
    expect(paramsSettings).toBeDefined()
    expect(typeof paramsSettings).toBe('object')
  })

  it('has expected parameter keys', () => {
    const keys = Object.keys(paramsSettings)
    expect(keys).toContain('stream')
    expect(keys).toContain('temperature')
    expect(keys).toContain('max_output_tokens')
    expect(keys).toContain('max_context_tokens')
    expect(keys).toContain('auto_compact')
    expect(keys).toContain('frequency_penalty')
    expect(keys).toContain('presence_penalty')
    expect(keys).toContain('top_p')
    expect(keys).toContain('top_k')
  })

  it('each param has key, value, title, description', () => {
    for (const [name, param] of Object.entries(paramsSettings)) {
      expect(param.key).toBe(name)
      expect(param.value).toBeDefined()
      expect(typeof param.title).toBe('string')
      expect(typeof param.description).toBe('string')
    }
  })

  it('stream defaults to true', () => {
    expect(paramsSettings.stream.value).toBe(true)
  })

  it('temperature defaults to 0.7', () => {
    expect(paramsSettings.temperature.value).toBe(0.7)
  })

  it('max_output_tokens defaults to 2048', () => {
    expect(paramsSettings.max_output_tokens.value).toBe(2048)
  })

  it('auto_compact defaults to false', () => {
    expect(paramsSettings.auto_compact.value).toBe(false)
  })

  it('top_p has controllerType slider', () => {
    expect((paramsSettings.top_p as any).controllerType).toBe('slider')
  })
})
