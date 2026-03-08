import { describe, it, expect } from 'vitest'
import { OUT_OF_CONTEXT_SIZE } from '../error'

describe('error utilities', () => {
  describe('OUT_OF_CONTEXT_SIZE', () => {
    it('should have correct error message', () => {
      expect(OUT_OF_CONTEXT_SIZE).toBe('the request exceeds the available context size.')
    })

    it('should be a string', () => {
      expect(typeof OUT_OF_CONTEXT_SIZE).toBe('string')
    })
  })
})
