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
})
