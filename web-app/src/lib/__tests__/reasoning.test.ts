import { describe, expect, it } from 'vitest'
import {
  REASONING_STEP_MAX_CHARS,
  segmentReasoningSteps,
  splitReasoningParagraphs,
} from '../reasoning'

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

describe('segmentReasoningSteps', () => {
  const repeat = (unit: string, times: number) => unit.repeat(times)

  it('returns [] for empty/whitespace input', () => {
    expect(segmentReasoningSteps('')).toEqual([])
    expect(segmentReasoningSteps('  \n \n ')).toEqual([])
  })

  it('leaves text below the budget as a single step', () => {
    expect(segmentReasoningSteps('one short thought')).toEqual([
      'one short thought',
    ])
  })

  it('still honours blank-line paragraph boundaries', () => {
    expect(segmentReasoningSteps('first\n\nsecond')).toEqual([
      'first',
      'second',
    ])
  })

  // The bug: a model that never emits a blank line produced exactly one step,
  // so the "last completed step" was always empty and the UI stayed static for
  // the whole run.
  it('subdivides an unbroken blob so completed steps exist', () => {
    const blob = repeat('word ', 400).trim()
    const steps = segmentReasoningSteps(blob)
    expect(steps.length).toBeGreaterThan(1)
    expect(steps.slice(0, -1).every((s) => s.trim().length > 0)).toBe(true)
  })

  it('subdivides a single-newline-only trace', () => {
    const blob = repeat('a line of reasoning\n', 60).trim()
    const steps = segmentReasoningSteps(blob)
    expect(steps.length).toBeGreaterThan(1)
  })

  it('keeps every step within the budget', () => {
    const blob = repeat('word ', 400).trim()
    for (const step of segmentReasoningSteps(blob)) {
      expect(step.length).toBeLessThanOrEqual(REASONING_STEP_MAX_CHARS)
    }
  })

  it('prefers a sentence boundary when one is in range', () => {
    const sentence = `${repeat('x', REASONING_STEP_MAX_CHARS - 60)}. `
    const steps = segmentReasoningSteps(sentence + repeat('y', 200))
    expect(steps[0]).toBe(`${repeat('x', REASONING_STEP_MAX_CHARS - 60)}.`)
  })

  it('falls back to a newline when no sentence boundary is in range', () => {
    const head = `${repeat('x', REASONING_STEP_MAX_CHARS - 60)}\n`
    const steps = segmentReasoningSteps(head + repeat('y', 200))
    expect(steps[0]).toBe(repeat('x', REASONING_STEP_MAX_CHARS - 60))
  })

  it('falls back to a word boundary when no sentence or newline is in range', () => {
    const steps = segmentReasoningSteps(repeat('word ', 400).trim())
    expect(steps[0].endsWith('word')).toBe(true)
  })

  // CJK and other unspaced scripts have no whitespace to break on; a hard cut
  // is the only way to keep steps advancing.
  it('hard-cuts text that has no break opportunity at all', () => {
    const steps = segmentReasoningSteps(repeat('你', 900))
    expect(steps.length).toBeGreaterThan(1)
    expect(steps[0].length).toBe(REASONING_STEP_MAX_CHARS)
  })

  it('ignores a break candidate too early to be a useful step', () => {
    // A lone sentence end near the start must not emit a 2-char step.
    const steps = segmentReasoningSteps(`ok. ${repeat('y ', 400)}`.trim())
    expect(steps[0]).not.toBe('ok.')
  })

  // Guards the subdivision loop: a break offset of 0 would never consume input.
  it('terminates on a degenerate budget', () => {
    const steps = segmentReasoningSteps('a b. c\nd', 1)
    expect(steps.join('')).not.toBe('')
    expect(steps.every((s) => s.trim().length > 0)).toBe(true)
  })

  it('never emits blank steps', () => {
    const steps = segmentReasoningSteps(
      `first\n\n\n${repeat('word ', 400)}\n\n  \n\nlast`
    )
    expect(steps.every((s) => s.trim().length > 0)).toBe(true)
  })

  // The caller re-segments the whole accumulated text on every streaming tick,
  // so completed steps must not shift as more tokens arrive.
  it('keeps earlier steps stable as the text grows', () => {
    const full = repeat('word ', 500).trim()
    let previous = segmentReasoningSteps(full.slice(0, 500))
    for (let end = 600; end <= full.length; end += 100) {
      const next = segmentReasoningSteps(full.slice(0, end))
      const settled = previous.slice(0, -1)
      expect(next.slice(0, settled.length)).toEqual(settled)
      previous = next
    }
  })
})
