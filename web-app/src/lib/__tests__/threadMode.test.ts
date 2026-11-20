import { describe, it, expect } from 'vitest'
import { getThreadMode, isCoworkThread } from '../threadMode'

describe('threadMode', () => {
  it('treats absent mode and absent metadata as chat', () => {
    expect(getThreadMode({})).toBe('chat')
    expect(getThreadMode({ metadata: {} })).toBe('chat')
    expect(getThreadMode({ metadata: null })).toBe('chat')
    expect(getThreadMode(undefined)).toBe('chat')
  })

  it('reads cowork and ignores unknown values', () => {
    expect(getThreadMode({ metadata: { mode: 'cowork' } })).toBe('cowork')
    expect(isCoworkThread({ metadata: { mode: 'cowork' } })).toBe(true)
    expect(getThreadMode({ metadata: { mode: 'weird' } })).toBe('chat')
  })
})
