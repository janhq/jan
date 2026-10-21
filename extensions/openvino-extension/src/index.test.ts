import { describe, it, expect } from 'vitest'
import openvino_extension from './index'

describe('openvino_extension', () => {
  it('has correct provider id', () => {
    const ext = new openvino_extension()
    expect(ext.provider).toBe('openvino')
    expect(ext.providerId).toBe('openvino')
  })

  it('is a local engine', () => {
    const ext = new openvino_extension()
    expect(ext.autoUnload).toBe(true)
    expect(ext.ctxSize).toBeGreaterThan(0)
  })
})
