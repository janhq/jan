import { describe, expect, it } from 'vitest'

import { normalizeBrowserAddress } from '../browser-address'

describe('normalizeBrowserAddress', () => {
  it('returns null for empty or protocol-only input', () => {
    expect(normalizeBrowserAddress('')).toBeNull()
    expect(normalizeBrowserAddress('   ')).toBeNull()
    expect(normalizeBrowserAddress('https://')).toBeNull()
    expect(normalizeBrowserAddress('http://')).toBeNull()
  })

  it('normalizes bare domains', () => {
    expect(normalizeBrowserAddress('google.com')).toBe('https://google.com')
    expect(normalizeBrowserAddress('docs.github.com/en')).toBe(
      'https://docs.github.com/en'
    )
    expect(normalizeBrowserAddress('localhost:3000')).toBe(
      'https://localhost:3000'
    )
  })

  it('preserves explicit URLs', () => {
    expect(normalizeBrowserAddress('https://example.com/path')).toBe(
      'https://example.com/path'
    )
    expect(normalizeBrowserAddress('http://127.0.0.1:8080')).toBe(
      'http://127.0.0.1:8080/'
    )
  })

  it('treats free-form text as a Google search', () => {
    expect(normalizeBrowserAddress('google')).toBe(
      'https://www.google.com/search?q=google'
    )
    expect(normalizeBrowserAddress('how to use rust')).toBe(
      'https://www.google.com/search?q=how%20to%20use%20rust'
    )
  })
})
