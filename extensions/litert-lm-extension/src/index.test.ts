import { describe, it, expect } from 'vitest'
import litert_lm_extension from './index'

describe('litert_lm_extension', () => {
  it('has correct provider id', () => {
    const ext = new litert_lm_extension()
    expect(ext.provider).toBe('litert-lm')
    expect(ext.providerId).toBe('litert-lm')
  })

  it('is a local engine', () => {
    const ext = new litert_lm_extension()
    expect(ext.autoUnload).toBe(true)
    expect(ext.ctxSize).toBeGreaterThan(0)
  })
})
