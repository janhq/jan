import { describe, it, expect } from 'vitest'
import { toNumber } from '../number'

describe('toNumber', () => {
  it('converts valid number strings to numbers', () => {
    expect(toNumber('123')).toBe(123)
    expect(toNumber('0')).toBe(0)
    expect(toNumber('-45')).toBe(-45)
    expect(toNumber('3.14')).toBe(3.14)
    expect(toNumber('-2.5')).toBe(-2.5)
  })

  it('passes through actual numbers unchanged', () => {
    expect(toNumber(42)).toBe(42)
    expect(toNumber(0)).toBe(0)
    expect(toNumber(-17)).toBe(-17)
    expect(toNumber(3.14159)).toBe(3.14159)
  })

  it('returns 0 for invalid number strings', () => {
    expect(toNumber('abc')).toBe(0)
    expect(toNumber('12abc')).toBe(0)
    expect(toNumber('hello')).toBe(0)
    expect(toNumber('')).toBe(0)
    expect(toNumber(' ')).toBe(0)
  })

  it('returns 0 for null and undefined', () => {
    expect(toNumber(null)).toBe(0)
    expect(toNumber(undefined)).toBe(0)
  })

  it('handles boolean values', () => {
    expect(toNumber(true)).toBe(1)
    expect(toNumber(false)).toBe(0)
  })

  it('handles arrays and objects', () => {
    expect(toNumber([])).toBe(0)
    expect(toNumber([1])).toBe(1)
    expect(toNumber([1, 2])).toBe(0) // NaN case
    expect(toNumber({})).toBe(0)
    expect(toNumber({ a: 1 })).toBe(0)
  })

  it('handles special number cases', () => {
    expect(toNumber(Infinity)).toBe(Infinity)
    expect(toNumber(-Infinity)).toBe(-Infinity)
    expect(toNumber(NaN)).toBe(0) // NaN gets converted to 0
  })

  it('handles scientific notation strings', () => {
    expect(toNumber('1e5')).toBe(100000)
    expect(toNumber('2.5e-3')).toBe(0.0025)
    expect(toNumber('1E10')).toBe(10000000000)
  })

  it('handles hex and octal strings', () => {
    expect(toNumber('0x10')).toBe(16)
    expect(toNumber('0o10')).toBe(8)
    expect(toNumber('0b10')).toBe(2)
  })

  it('handles whitespace in strings', () => {
    expect(toNumber('  123  ')).toBe(123)
    expect(toNumber('\t42\n')).toBe(42)
    expect(toNumber('\r\n  -5.5  \t')).toBe(-5.5)
  })
})
