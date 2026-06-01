import { describe, it, expect } from 'vitest'
import { OUT_OF_CONTEXT_SIZE, isContextOverflowMessage } from '../error'

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
})
