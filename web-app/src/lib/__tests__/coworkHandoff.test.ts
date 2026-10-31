import { describe, it, expect, beforeEach } from 'vitest'
import {
  claimCoworkHandoff,
  clearCoworkHandoff,
  discardStaleCoworkHandoffs,
  peekCoworkHandoff,
  releaseCoworkHandoff,
  writeCoworkHandoff,
  COWORK_HANDOFF_PREFIX,
} from '../coworkHandoff'

describe('coworkHandoff', () => {
  beforeEach(() => {
    sessionStorage.clear()
    for (const id of ['a', 'b', 'gone']) clearCoworkHandoff(id)
  })

  it('stores text in sessionStorage and returns it without removing it', () => {
    writeCoworkHandoff('a', { text: 'hello', draft: 'hello' })
    expect(peekCoworkHandoff('a')?.text).toBe('hello')
    expect(peekCoworkHandoff('a')?.text).toBe('hello')
  })

  it('never serializes attachments into sessionStorage, but returns them by session id', () => {
    const files = [{ type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }]
    writeCoworkHandoff('a', { text: 'x', files })
    expect(sessionStorage.getItem(`${COWORK_HANDOFF_PREFIX}a`)).not.toContain('base64')
    expect(peekCoworkHandoff('a')?.files).toEqual(files)
  })

  it('is claimable exactly once (StrictMode double effect), and again after a release', () => {
    expect(claimCoworkHandoff('a')).toBe(true)
    expect(claimCoworkHandoff('a')).toBe(false)
    releaseCoworkHandoff('a')
    expect(claimCoworkHandoff('a')).toBe(true)
  })

  it('clear removes the text, the attachments and the claim', () => {
    writeCoworkHandoff('a', { text: 'x', files: [{ type: 'file', mediaType: 'a/b', url: 'u' }] })
    claimCoworkHandoff('a')
    clearCoworkHandoff('a')
    expect(peekCoworkHandoff('a')).toBeNull()
    expect(claimCoworkHandoff('a')).toBe(true)
  })

  it('drops a corrupt entry instead of throwing', () => {
    sessionStorage.setItem(`${COWORK_HANDOFF_PREFIX}a`, '{nope')
    expect(peekCoworkHandoff('a')).toBeNull()
    expect(sessionStorage.getItem(`${COWORK_HANDOFF_PREFIX}a`)).toBeNull()
  })

  it('discards handoffs whose session no longer exists, keeps live ones', () => {
    writeCoworkHandoff('a', { text: 'live' })
    writeCoworkHandoff('gone', { text: 'stale' })
    discardStaleCoworkHandoffs(new Set(['a']))
    expect(peekCoworkHandoff('a')).not.toBeNull()
    expect(peekCoworkHandoff('gone')).toBeNull()
  })
})
