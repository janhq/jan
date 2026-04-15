import { describe, it, expect } from 'vitest'
import {
  removeReasoningContent,
  extractReasoningFromMessage,
} from '../reasoning'

describe('removeReasoningContent', () => {
  it('returns unchanged content without reasoning tags', () => {
    expect(removeReasoningContent('hello world')).toBe('hello world')
  })

  it('strips <think>...</think> block and trims remainder', () => {
    const input = '<think>internal thoughts</think>\n\nfinal answer'
    expect(removeReasoningContent(input)).toBe('final answer')
  })

  it('strips multiline <think> block', () => {
    const input = '<think>line1\nline2\nline3</think>result'
    expect(removeReasoningContent(input)).toBe('result')
  })

  it('returns empty string when only <think> block present', () => {
    expect(removeReasoningContent('<think>only reasoning</think>')).toBe('')
  })

  it('leaves content if opening <think> has no closing tag', () => {
    const input = '<think>unterminated reasoning'
    // Matches the literal <think> check but regex fails → returns input as-is
    expect(removeReasoningContent(input)).toBe(input)
  })

  it('strips harmony-style analysis channel block', () => {
    const input =
      '<|channel|>analysis<|message|>reasoning here<|start|>assistant<|channel|>final<|message|>the answer'
    expect(removeReasoningContent(input)).toBe('the answer')
  })

  it('strips both <think> and harmony blocks sequentially', () => {
    const input =
      '<think>t1</think>middle<|channel|>analysis<|message|>r<|start|>assistant<|channel|>final<|message|>done'
    // After <think> removal: "middle<|channel|>analysis<|message|>r<|start|>assistant<|channel|>final<|message|>done"
    // After harmony removal: "done"
    expect(removeReasoningContent(input)).toBe('done')
  })
})

describe('extractReasoningFromMessage', () => {
  it('returns null for null/undefined message', () => {
    // @ts-expect-error - testing null guard
    expect(extractReasoningFromMessage(null)).toBeNull()
    // @ts-expect-error - testing undefined guard
    expect(extractReasoningFromMessage(undefined)).toBeNull()
  })

  it('prefers reasoning_content over reasoning', () => {
    const msg = {
      role: 'assistant',
      content: 'x',
      reasoning_content: 'primary',
      reasoning: 'secondary',
    } as any
    expect(extractReasoningFromMessage(msg)).toBe('primary')
  })

  it('falls back to reasoning when reasoning_content missing', () => {
    const msg = {
      role: 'assistant',
      content: 'x',
      reasoning: 'only this',
    } as any
    expect(extractReasoningFromMessage(msg)).toBe('only this')
  })

  it('returns null when neither field present', () => {
    const msg = { role: 'assistant', content: 'x' } as any
    expect(extractReasoningFromMessage(msg)).toBeNull()
  })

  it('returns null when reasoning fields are null', () => {
    const msg = {
      role: 'assistant',
      content: 'x',
      reasoning_content: null,
      reasoning: null,
    } as any
    expect(extractReasoningFromMessage(msg)).toBeNull()
  })
})
