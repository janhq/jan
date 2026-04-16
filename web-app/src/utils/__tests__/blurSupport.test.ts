import { describe, it, expect } from 'vitest'
import { supportsBlurEffects } from '../blurSupport'

const base = {
  cpu: {} as any,
  gpus: [] as any,
  ram: {} as any,
  os_version: '',
}

function hw(os_type: string, os_name = ''): any {
  return { ...base, os_type, os_name }
}

describe('supportsBlurEffects', () => {
  it('returns false when hardwareData is null', () => {
    expect(supportsBlurEffects(null)).toBe(false)
  })

  it('returns true for macOS', () => {
    expect(supportsBlurEffects(hw('macos', 'macOS 14'))).toBe(true)
  })

  it('returns true for Windows build >= 17134', () => {
    expect(
      supportsBlurEffects(hw('windows', 'Windows 10 Pro (build 22631)'))
    ).toBe(true)
  })

  it('returns false for Windows build < 17134', () => {
    expect(
      supportsBlurEffects(hw('windows', 'Windows 10 (build 17133)'))
    ).toBe(false)
  })

  it('returns true for Windows when build number is not detectable', () => {
    expect(supportsBlurEffects(hw('windows', 'Windows 11 Pro'))).toBe(true)
  })

  it('returns true for Linux (assumed supported)', () => {
    expect(supportsBlurEffects(hw('linux', 'Ubuntu 22.04'))).toBe(true)
  })

  it('returns false for unknown OS types', () => {
    expect(supportsBlurEffects(hw('freebsd', 'FreeBSD 14'))).toBe(false)
  })
})
