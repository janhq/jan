import { describe, expect, it } from 'vitest'
import { getSafeOpenUIUrl } from '../openui-url'

describe('getSafeOpenUIUrl', () => {
  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    [' http://localhost:3000/path ', 'http://localhost:3000/path'],
  ])('allows absolute web URL %s', (value, expected) => {
    expect(getSafeOpenUIUrl(value)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/unsafe',
    '/relative-path',
    'example.com/no-protocol',
    '',
    '   ',
  ])('rejects unsafe or non-absolute URL %s', (value) => {
    expect(getSafeOpenUIUrl(value)).toBeNull()
  })

  it('rejects non-string values', () => {
    expect(getSafeOpenUIUrl(null)).toBeNull()
    expect(getSafeOpenUIUrl({ url: 'https://example.com' })).toBeNull()
  })
})
