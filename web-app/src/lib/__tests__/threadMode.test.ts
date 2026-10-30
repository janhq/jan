import { describe, it, expect } from 'vitest'
import { getThreadMode, isCoworkThread, workspaceScopeFor } from '../threadMode'

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

  it('picks the sandbox scope from the mode', () => {
    expect(workspaceScopeFor({ metadata: { mode: 'cowork' } })).toBe('session')
    expect(workspaceScopeFor({ metadata: {} })).toBe('thread')
    expect(workspaceScopeFor(undefined)).toBe('thread')
  })
})
