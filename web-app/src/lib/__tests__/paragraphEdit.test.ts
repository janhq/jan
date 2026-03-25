import { describe, expect, it } from 'vitest'
import {
  applySpanReplacement,
  findSelectedSpan,
  unwrapModelPassage,
} from '@/lib/paragraphEdit'

describe('findSelectedSpan', () => {
  it('finds a unique exact match', () => {
    const source = 'Hello world.\n\nSecond paragraph here.'
    const span = findSelectedSpan(source, 'Second paragraph here.')
    expect(span).toEqual({ start: 14, end: 36 })
  })

  it('returns null when the selection matches multiple times', () => {
    const source = 'foo bar foo bar'
    expect(findSelectedSpan(source, 'foo')).toBeNull()
  })

  it('returns null for empty selection', () => {
    expect(findSelectedSpan('abc', '   ')).toBeNull()
  })
})

describe('applySpanReplacement', () => {
  it('splices replacement at span', () => {
    const next = applySpanReplacement(
      'aaSELECTbb',
      { start: 2, end: 8 },
      'X'
    )
    expect(next).toBe('aaXbb')
  })
})

describe('unwrapModelPassage', () => {
  it('trims plain text', () => {
    expect(unwrapModelPassage('  hello  ')).toBe('hello')
  })

  it('unwraps a single fenced block', () => {
    expect(unwrapModelPassage('```md\n**bold**\n```')).toBe('**bold**')
  })
})
