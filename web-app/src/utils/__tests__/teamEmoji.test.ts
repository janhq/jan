import { describe, it, expect } from 'vitest'
import { teamEmoji } from '../teamEmoji'

describe('teamEmoji utility', () => {
  describe('teamEmoji', () => {
    it('should contain team member data', () => {
      expect(teamEmoji).toBeInstanceOf(Array)
      expect(teamEmoji.length).toBeGreaterThan(0)
    })

    it('should have correct structure for team members', () => {
      const member = teamEmoji[0]
      expect(member).toHaveProperty('names')
      expect(member).toHaveProperty('imgUrl')
      expect(member).toHaveProperty('id')
      expect(Array.isArray(member.names)).toBe(true)
      expect(typeof member.imgUrl).toBe('string')
      expect(typeof member.id).toBe('string')
    })

    it('should contain expected team members', () => {
      const memberIds = teamEmoji.map(m => m.id)
      expect(memberIds).toContain('louis')
      expect(memberIds).toContain('emre')
      expect(memberIds).toContain('alex')
      expect(memberIds).toContain('daniel')
      expect(memberIds).toContain('bach')
    })

    it('should have unique IDs', () => {
      const ids = teamEmoji.map(m => m.id)
      const uniqueIds = [...new Set(ids)]
      expect(ids.length).toBe(uniqueIds.length)
    })

    it('should have valid image URLs', () => {
      teamEmoji.forEach(member => {
        expect(member.imgUrl).toMatch(/^\/images\/emoji\/.*\.png$/)
      })
    })
  })
})
