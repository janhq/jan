import { describe, it, expect } from 'vitest'
import { highlightFzfMatch } from '../highlight'

describe('highlight utility', () => {
  describe('highlightFzfMatch', () => {
    it('should highlight characters at specified positions', () => {
      const text = 'Hello World'
      const positions = [0, 6]
      const result = highlightFzfMatch(text, positions)
      
      expect(result).toBe('<span class="search-highlight">H</span>ello <span class="search-highlight">W</span>orld')
    })

    it('should handle empty positions array', () => {
      const text = 'Hello World'
      const positions: number[] = []
      const result = highlightFzfMatch(text, positions)
      
      expect(result).toBe('Hello World')
    })

    it('should handle empty text', () => {
      const text = ''
      const positions = [0, 1]
      const result = highlightFzfMatch(text, positions)
      
      expect(result).toBe('')
    })

    it('should handle positions out of bounds', () => {
      const text = 'Hello'
      const positions = [0, 10]
      const result = highlightFzfMatch(text, positions)
      
      expect(result).toBe('<span class="search-highlight">H</span>ello')
    })

    it('should handle custom highlight class', () => {
      const text = 'Hello World'
      const positions = [0]
      const result = highlightFzfMatch(text, positions, 'custom-highlight')
      
      expect(result).toBe('<span class="custom-highlight">H</span>ello World')
    })

    it('should sort positions automatically', () => {
      const text = 'Hello World'
      const positions = [6, 0]
      const result = highlightFzfMatch(text, positions)
      
      expect(result).toBe('<span class="search-highlight">H</span>ello <span class="search-highlight">W</span>orld')
    })

    it('should handle multiple consecutive positions', () => {
      const text = 'Hello'
      const positions = [0, 1, 2]
      const result = highlightFzfMatch(text, positions)
      
      expect(result).toBe('<span class="search-highlight">H</span><span class="search-highlight">e</span><span class="search-highlight">l</span>lo')
    })

    it('should handle null or undefined positions', () => {
      const text = 'Hello World'
      const result1 = highlightFzfMatch(text, null as any)
      const result2 = highlightFzfMatch(text, undefined as any)
      
      expect(result1).toBe('Hello World')
      expect(result2).toBe('Hello World')
    })
  })
})
