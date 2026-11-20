import { describe, it, expect } from 'vitest'
import {
  OUT_OF_CONTEXT_SIZE,
  isContextOverflowMessage,
  isLocalContextOverflowMessage,
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

    it('matches Anthropic overflow errors', () => {
      expect(
        isContextOverflowMessage('prompt is too long: 210000 tokens > 200000 maximum')
      ).toBe(true)
      expect(
        isContextOverflowMessage(
          'input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000, decrease input length or `max_tokens` and try again'
        )
      ).toBe(true)
    })

    it('tells llama-server wording apart from cloud provider wording', () => {
      expect(isLocalContextOverflowMessage(OUT_OF_CONTEXT_SIZE)).toBe(true)
      expect(
        isLocalContextOverflowMessage(
          'request (518 tokens) exceeds the available context size (512 tokens)'
        )
      ).toBe(true)
      expect(
        isLocalContextOverflowMessage('prompt is too long: 210000 tokens > 200000 maximum')
      ).toBe(false)
    })

    it('does not treat a 413 payload-size error as a context overflow', () => {
      // A byte limit on the HTTP body (often images/files): regenerating the
      // same request cannot help, so the provider text must stay visible.
      expect(isContextOverflowMessage('request_too_large')).toBe(false)
      expect(isContextOverflowMessage('Request exceeds the maximum size')).toBe(false)
    })

    it('matches OpenAI overflow errors', () => {
      expect(
        isContextOverflowMessage(
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens."
        )
      ).toBe(true)
      expect(isContextOverflowMessage('context_length_exceeded')).toBe(true)
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
      // Cloud messages use other layouts; never misread them as counts.
      expect(
        parseContextOverflow('prompt is too long: 210000 tokens > 200000 maximum')
      ).toBeNull()
      expect(
        parseContextOverflow(
          'input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000'
        )
      ).toBeNull()
      expect(
        parseContextOverflow(
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens."
        )
      ).toBeNull()
      expect(parseContextOverflow('cuda error: out of memory')).toBeNull()
    })
  })
})
