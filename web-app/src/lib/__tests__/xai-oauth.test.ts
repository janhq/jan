import { describe, expect, it } from 'vitest'
import {
  formatXaiOAuthExpiry,
  isXaiOAuthAvailable,
  isXaiOAuthConnectedSync,
  setXaiOAuthConnectedCache,
} from '@/lib/xai-oauth'

describe('xai-oauth helpers', () => {
  it('formatXaiOAuthExpiry returns null for missing values', () => {
    expect(formatXaiOAuthExpiry(undefined)).toBeNull()
    expect(formatXaiOAuthExpiry(Number.NaN)).toBeNull()
  })

  it('formatXaiOAuthExpiry formats a valid timestamp', () => {
    const formatted = formatXaiOAuthExpiry(Date.UTC(2026, 0, 15, 12, 0, 0))
    expect(formatted).toBeTruthy()
    expect(typeof formatted).toBe('string')
  })

  it('isXaiOAuthAvailable is false in vitest web runtime', () => {
    expect(isXaiOAuthAvailable()).toBe(false)
  })

  it('isXaiOAuthConnectedSync reads native connected cache', () => {
    setXaiOAuthConnectedCache(true)
    expect(isXaiOAuthConnectedSync()).toBe(true)
    setXaiOAuthConnectedCache(false)
    expect(isXaiOAuthConnectedSync()).toBe(false)
  })
})