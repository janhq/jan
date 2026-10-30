import { describe, expect, it } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }
import { API_VERSION } from '../index.js'

describe('API_VERSION', () => {
  it('equals the package version', () => {
    expect(API_VERSION).toBe(pkg.version)
  })
})
