import { describe, it, expect } from 'vitest'
import { isNeedsAuthError, needsAuthDetail } from '../mcpAuthError'

describe('strict MCP OAuth error classification', () => {
  it.each(['NEEDS_AUTH: detail', new Error('NEEDS_AUTH: detail'), { message: 'NEEDS_AUTH: detail' }, 'NEEDS_AUTH: '])('accepts only explicit backend markers: %s', (error) => {
    expect(isNeedsAuthError(error)).toBe(true)
    expect(needsAuthDetail(error)).not.toBeNull()
  })
  it.each(['HTTP 401', 'wrapped NEEDS_AUTH: detail', 'NEEDS_AUTH:missing space', undefined, {}, new Error('protocol mismatch')])('rejects unrelated errors: %s', (error) => {
    expect(isNeedsAuthError(error)).toBe(false)
  })
})
