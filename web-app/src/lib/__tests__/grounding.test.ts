import { describe, it, expect } from 'vitest'
import { splitSentences } from '@/lib/grounding'

describe('splitSentences', () => {
  it('returns no sentences for empty input', () => {
    expect(splitSentences('')).toEqual([])
  })

  it('drops fragments shorter than 12 plain chars', () => {
    expect(splitSentences('Hi. Bye.')).toEqual([])
  })

  it('splits two plain sentences on terminator + space', () => {
    const result = splitSentences('Plain sentence one. Plain sentence two!')
    expect(result.map((s) => s.formatted)).toEqual([
      'Plain sentence one.',
      'Plain sentence two!',
    ])
  })

  it('keeps abbreviations like "e.g." inside a single sentence', () => {
    const result = splitSentences(
      'We find that Hawk is able to extrapolate (e.g., up to 1M tokens). Another sentence here.',
    )
    expect(result.map((s) => s.formatted)).toEqual([
      'We find that Hawk is able to extrapolate (e.g., up to 1M tokens).',
      'Another sentence here.',
    ])
  })

  it('keeps "i.e." inside the sentence', () => {
    const result = splitSentences(
      'The model variant, i.e., the small one, performs well here.',
    )
    expect(result.map((s) => s.formatted)).toEqual([
      'The model variant, i.e., the small one, performs well here.',
    ])
  })

  it('splits on question and exclamation marks followed by space', () => {
    const result = splitSentences('Is this working? Yes it is working now!')
    expect(result.map((s) => s.formatted)).toEqual([
      'Is this working?',
      'Yes it is working now!',
    ])
  })

  it('captures trailing sentence with no terminator', () => {
    const result = splitSentences(
      'First complete sentence here. Trailing sentence with no period',
    )
    expect(result.map((s) => s.formatted)).toEqual([
      'First complete sentence here.',
      'Trailing sentence with no period',
    ])
  })

  it('strips markdown when producing the plain form', () => {
    const [s] = splitSentences(
      'This **bold sentence** and `code` matter here.',
    )
    expect(s.formatted).toBe('This **bold sentence** and `code` matter here.')
    expect(s.plain).toBe('This bold sentence and code matter here.')
  })

  it('handles terminator at end of input (no trailing space)', () => {
    const result = splitSentences(
      'One full sentence here. Two full sentence here.',
    )
    expect(result).toHaveLength(2)
    expect(result[1].formatted).toBe('Two full sentence here.')
  })
})
