import { describe, it, expect } from 'vitest'
import { isRootDir } from '../path'

describe('isRootDir (non-Windows test env)', () => {
  it('returns true for "/"', () => {
    expect(isRootDir('/')).toBe(true)
  })

  it.each([
    ['/mnt'],
    ['/media'],
    ['/boot'],
    ['/home'],
    ['/opt'],
    ['/var'],
    ['/usr'],
  ])('returns true for known Linux root %s', (p) => {
    expect(isRootDir(p)).toBe(true)
  })

  it('returns true for root with trailing slash', () => {
    expect(isRootDir('/home/')).toBe(true)
  })

  it('returns false for non-root paths', () => {
    expect(isRootDir('/home/user')).toBe(false)
    expect(isRootDir('/etc')).toBe(false)
    expect(isRootDir('/var/log')).toBe(false)
  })

  it('normalizes backslashes and trailing separators', () => {
    expect(isRootDir('\\home\\')).toBe(true)
  })

  it('returns "/" default for empty string after normalization', () => {
    expect(isRootDir('')).toBe(true)
  })
})
