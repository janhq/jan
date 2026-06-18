import { describe, it, expect } from 'vitest'
import {
  OUT_OF_CONTEXT_SIZE,
  isContextOverflowMessage,
  parseContextOverflow,
} from '../error'

describe('error utilities', () => {
  describe('OUT_OF_CONTEXT_SIZE', () => {
    it('should have correct error message', () => {
      expect(OUT_OF_CONTEXT_SIZE).toBe('the request exceeds the available context size.')
    })

    it('should be a string', () => {
      expect(typeof OUT_OF_CONTEXT_SIZE).toBe('string')
    })
  })

  describe('isContextOverflowMessage', () => {
    it('matches the constant and llama-server verbose variant', () => {
      expect(isContextOverflowMessage(OUT_OF_CONTEXT_SIZE)).toBe(true)
      expect(
        isContextOverflowMessage(
          'request (518 tokens) exceeds the available context size (512 tokens), try increasing it'
        )
      ).toBe(true)
    })

    it('does not match unrelated errors', () => {
      expect(isContextOverflowMessage('Could not establish connection')).toBe(false)
      expect(isContextOverflowMessage('cuda error: out of memory')).toBe(false)
    })
  })

  describe('parseContextOverflow', () => {
    it('extracts request and context token counts from the verbose variant', () => {
      expect(
        parseContextOverflow(
          'request (12450 tokens) exceeds the available context size (11008 tokens), try increasing it'
        )
      ).toEqual({ requestTokens: 12450, contextTokens: 11008 })
    })

    it('extracts counts from the "input larger than max" variant', () => {
      expect(
        parseContextOverflow(
          'input (518 tokens) is larger than the max context size (512 tokens). skipping'
        )
      ).toEqual({ requestTokens: 518, contextTokens: 512 })
    })

    it('returns null when no token counts are present', () => {
      expect(parseContextOverflow(OUT_OF_CONTEXT_SIZE)).toBeNull()
      expect(parseContextOverflow('cuda error: out of memory')).toBeNull()
    })
  })
})
