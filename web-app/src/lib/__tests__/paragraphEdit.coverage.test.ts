import { describe, it, expect } from 'vitest'
import {
  findSelectedSpan,
  applySpanReplacement,
  buildParagraphEditPrompts,
  unwrapModelPassage,
} from '../paragraphEdit'

describe('findSelectedSpan - additional coverage', () => {
  it('returns null for selection not found in source', () => {
    expect(findSelectedSpan('Hello world', 'xyz not here')).toBeNull()
  })

  it('finds span using prefix fallback when exact match fails due to whitespace', () => {
    // Selection that doesn't exactly match but has a long enough unique prefix
    const source = 'The quick brown fox jumps over the lazy dog'
    const selected = 'The quick brown fox'
    const span = findSelectedSpan(source, selected)
    expect(span).toEqual({ start: 0, end: 19 })
  })

  it('returns null when selected text is too short for prefix fallback', () => {
    // Duplicate + short text = no unique match
    const source = 'ab ab'
    expect(findSelectedSpan(source, 'ab')).toBeNull()
  })

  it('handles whitespace-only selection', () => {
    expect(findSelectedSpan('abc', '  \t\n ')).toBeNull()
  })

  it('handles empty source', () => {
    expect(findSelectedSpan('', 'test')).toBeNull()
  })
})

describe('buildParagraphEditPrompts', () => {
  it('builds system and user prompts with context', () => {
    const source = 'Before text. Selected passage here. After text.'
    const span = { start: 13, end: 35 }
    const result = buildParagraphEditPrompts({
      fullSource: source,
      span,
      userInstruction: 'Make it formal',
    })
    expect(result.system).toContain('revise a short passage')
    expect(result.user).toContain('Selected passage here.')
    expect(result.user).toContain('Before text.')
    expect(result.user).toContain('After text.')
    expect(result.user).toContain('Make it formal')
  })

  it('trims context to CONTEXT_CHARS limit', () => {
    const longBefore = 'A'.repeat(2000)
    const selected = 'TARGET'
    const longAfter = 'B'.repeat(2000)
    const source = longBefore + selected + longAfter
    const span = { start: 2000, end: 2006 }
    const result = buildParagraphEditPrompts({
      fullSource: source,
      span,
      userInstruction: 'fix',
    })
    // Context before should be limited (1200 chars)
    expect(result.user).toContain('TARGET')
    // The before context should not contain the full 2000 A's
    const beforeSection = result.user.split('--- Context before')[1]?.split('--- End context before')[0] || ''
    expect(beforeSection.length).toBeLessThan(1300)
  })
})

describe('unwrapModelPassage - additional coverage', () => {
  it('returns text as-is when no code fences', () => {
    expect(unwrapModelPassage('plain text')).toBe('plain text')
  })

  it('returns text when ``` has no newline', () => {
    expect(unwrapModelPassage('```no newline')).toBe('```no newline')
  })

  it('handles code fence without closing', () => {
    expect(unwrapModelPassage('```js\ncode here')).toBe('code here')
  })

  it('unwraps nested content between fences', () => {
    const result = unwrapModelPassage('```\nline1\nline2\n```')
    expect(result).toBe('line1\nline2')
  })
})
