import { describe, it, expect } from 'vitest'
import {
  customHeaderRowsFor,
  customHeadersEqual,
  isValidHeaderName,
  isValidHeaderValue,
  normalizeCustomHeaders,
} from '../provider-custom-headers'

describe('isValidHeaderName', () => {
  it('accepts RFC token characters', () => {
    expect(isValidHeaderName('X-Portkey-Api-Key')).toBe(true)
    expect(isValidHeaderName('anthropic-version')).toBe(true)
    expect(isValidHeaderName('x_tracking.id')).toBe(true)
  })

  it('rejects names fetch would throw on', () => {
    expect(isValidHeaderName('')).toBe(false)
    expect(isValidHeaderName('X Custom')).toBe(false)
    expect(isValidHeaderName('X-Custom:')).toBe(false)
    expect(isValidHeaderName('Prox(y)')).toBe(false)
    expect(isValidHeaderName('ünïcode')).toBe(false)
  })
})

describe('isValidHeaderValue', () => {
  it('rejects line breaks only', () => {
    expect(isValidHeaderValue('Bearer abc.def')).toBe(true)
    expect(isValidHeaderValue('')).toBe(true)
    expect(isValidHeaderValue('a\nb')).toBe(false)
    expect(isValidHeaderValue('a\r\nb')).toBe(false)
  })
})

describe('normalizeCustomHeaders', () => {
  it('trims and drops blank rows', () => {
    expect(
      normalizeCustomHeaders([
        { header: '  X-Trace  ', value: '  abc ' },
        { header: '', value: 'ignored' },
        { header: '   ', value: '' },
      ])
    ).toEqual([{ header: 'X-Trace', value: 'abc' }])
  })

  it('drops rows with an invalid name or a multi-line value', () => {
    expect(
      normalizeCustomHeaders([
        { header: 'Bad Name', value: 'v' },
        { header: 'X-Ok', value: 'line1\nline2' },
        { header: 'X-Keep', value: 'v' },
      ])
    ).toEqual([{ header: 'X-Keep', value: 'v' }])
  })

  it('keeps an empty value so a header can be sent blank', () => {
    expect(normalizeCustomHeaders([{ header: 'X-Empty', value: '' }])).toEqual([
      { header: 'X-Empty', value: '' },
    ])
  })

  it('lets the last duplicate win, case-insensitively, keeping its position', () => {
    expect(
      normalizeCustomHeaders([
        { header: 'X-A', value: '1' },
        { header: 'X-B', value: '2' },
        { header: 'x-a', value: '3' },
      ])
    ).toEqual([
      { header: 'X-B', value: '2' },
      { header: 'x-a', value: '3' },
    ])
  })
})

describe('customHeadersEqual', () => {
  it('treats null, undefined and [] as the same', () => {
    expect(customHeadersEqual(null, undefined)).toBe(true)
    expect(customHeadersEqual([], null)).toBe(true)
  })

  it('compares names, values and order', () => {
    const a = [{ header: 'X-A', value: '1' }]
    expect(customHeadersEqual(a, [{ header: 'X-A', value: '1' }])).toBe(true)
    expect(customHeadersEqual(a, [{ header: 'X-A', value: '2' }])).toBe(false)
    expect(customHeadersEqual(a, [{ header: 'x-a', value: '1' }])).toBe(false)
    expect(
      customHeadersEqual(
        [...a, { header: 'X-B', value: '2' }],
        [{ header: 'X-B', value: '2' }, ...a]
      )
    ).toBe(false)
  })
})

describe('customHeaderRowsFor', () => {
  it('gives one blank row when the provider has no headers', () => {
    expect(customHeaderRowsFor(undefined)).toEqual([{ header: '', value: '' }])
    expect(customHeaderRowsFor([])).toEqual([{ header: '', value: '' }])
  })

  it('copies stored headers into fresh row objects', () => {
    const stored = [{ header: 'X-A', value: '1' }]
    const rows = customHeaderRowsFor(stored)
    expect(rows).toEqual(stored)
    expect(rows[0]).not.toBe(stored[0])
  })
})
