import { describe, expect, it } from 'vitest'
import { isApiCompatible } from '../manifest.js'

describe('isApiCompatible', () => {
  it('locks the minor on 0.x', () => {
    expect(isApiCompatible('^0.1.0', '0.1.5')).toBe(true)
    expect(isApiCompatible('^0.1.0', '0.2.0')).toBe(false)
  })

  it('locks the major from 1.0.0 on', () => {
    expect(isApiCompatible('^1.2.0', '1.9.0')).toBe(true)
    expect(isApiCompatible('^1.2.0', '2.0.0')).toBe(false)
  })

  it('rejects a host older than the range floor', () => {
    expect(isApiCompatible('^1.2.3', '1.2.2')).toBe(false)
    expect(isApiCompatible('^0.1.3', '0.1.2')).toBe(false)
  })

  it('treats ^0.0.x as an exact pin', () => {
    expect(isApiCompatible('^0.0.3', '0.0.3')).toBe(true)
    expect(isApiCompatible('^0.0.3', '0.0.4')).toBe(false)
  })

  it('refuses anything that is not a caret range or a plain version', () => {
    expect(isApiCompatible('>=0.1.0', '0.1.0')).toBe(false)
    expect(isApiCompatible('^0.1', '0.1.0')).toBe(false)
    expect(isApiCompatible('^0.1.0', '0.1.0-beta.1')).toBe(false)
  })
})
