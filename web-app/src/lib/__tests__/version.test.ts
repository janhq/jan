import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to mock isDev before importing version module
vi.mock('../utils', () => ({
  isDev: vi.fn(() => false),
}))

describe('version', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('isNightly is true when VERSION contains hyphen', async () => {
    ;(globalThis as any).VERSION = '1.0.0-nightly'
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isNightly).toBe(true)
  })

  it('isBeta is true when VERSION contains beta', async () => {
    ;(globalThis as any).VERSION = '1.0.0-beta'
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isBeta).toBe(true)
  })

  it('isProd is true when VERSION has no hyphen, no beta, and not dev', async () => {
    ;(globalThis as any).VERSION = '1.0.0'
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isProd).toBe(true)
    expect(mod.isNightly).toBe(false)
    expect(mod.isBeta).toBe(false)
  })

  it('isProd is false when isDev returns true', async () => {
    ;(globalThis as any).VERSION = '1.0.0'
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => true) }))
    const mod = await import('../version')
    expect(mod.isProd).toBe(false)
  })
})
