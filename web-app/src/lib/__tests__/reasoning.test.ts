import { describe, expect, it } from 'vitest'
import { splitReasoningParagraphs } from '../reasoning'

describe('splitReasoningParagraphs', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(splitReasoningParagraphs('')).toEqual([])
    expect(splitReasoningParagraphs('   \n  ')).toEqual([])
  })

  it('splits on blank lines, keeping single newlines within a step', () => {
    const text = 'First thought\nstill first\n\nSecond thought'
    expect(splitReasoningParagraphs(text)).toEqual([
      'First thought\nstill first',
      'Second thought',
    ])
  })

  it('collapses runs of 3+ newlines into one boundary', () => {
    expect(splitReasoningParagraphs('a\n\n\n\nb')).toEqual(['a', 'b'])
  })

  it('treats a trailing in-progress paragraph as the last element', () => {
    const streaming = 'Done paragraph\n\nHalf-written para'
    const parts = splitReasoningParagraphs(streaming)
    expect(parts).toHaveLength(2)
    expect(parts[parts.length - 1]).toBe('Half-written para')
  })

  it('returns a single step when there are no blank lines', () => {
    expect(splitReasoningParagraphs('one continuous thought')).toEqual([
      'one continuous thought',
    ])
  })

  it('ignores blank-line-only gaps between paragraphs with trailing spaces', () => {
    expect(splitReasoningParagraphs('a  \n   \nb')).toEqual(['a', 'b'])
  })
})
