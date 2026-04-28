import { describe, expect, it } from 'vitest'
import { normalizeAppError } from '../appError'

describe('normalizeAppError', () => {
  it('returns plain string errors as-is', () => {
    expect(normalizeAppError('startup failed')).toBe('startup failed')
  })

  it('returns error messages from Error instances', () => {
    expect(normalizeAppError(new Error('boom'))).toBe('boom')
  })

  it('returns message fields from plain objects', () => {
    expect(normalizeAppError({ message: 'from object' })).toBe('from object')
  })

  it('stringifies unexpected objects', () => {
    expect(normalizeAppError({ code: 42 })).toBe('{"code":42}')
  })

  it('falls back for empty values', () => {
    expect(normalizeAppError('   ')).toBe('Unknown error')
    expect(normalizeAppError(null)).toBe('Unknown error')
  })
})
