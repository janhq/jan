import { describe, expect, it } from 'vitest'
import {
  isPlainObject,
  parseToolInput,
  stringifyToolInput,
  summarizeToolInput,
} from '../toolInputSummary'

describe('parseToolInput', () => {
  it('passes objects through untouched', () => {
    const input = { a: 1 }
    expect(parseToolInput(input)).toBe(input)
  })

  it('parses a JSON string', () => {
    expect(parseToolInput('{"a":1}')).toEqual({ a: 1 })
  })

  it('leaves unparseable text as-is', () => {
    expect(parseToolInput('not json')).toBe('not json')
  })

  // Arguments stream in, so the UI sees truncated JSON mid-call.
  it('leaves a half-streamed JSON fragment as text', () => {
    expect(parseToolInput('{"path":"src/ap')).toBe('{"path":"src/ap')
  })
})

describe('isPlainObject', () => {
  it('rejects arrays and null', () => {
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject({})).toBe(true)
  })
})

describe('stringifyToolInput', () => {
  it('pretty-prints objects', () => {
    expect(stringifyToolInput({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('returns strings unchanged', () => {
    expect(stringifyToolInput('plain')).toBe('plain')
  })

  it('survives circular structures', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => stringifyToolInput(circular)).not.toThrow()
  })
})

describe('summarizeToolInput', () => {
  it('is empty for missing input', () => {
    expect(summarizeToolInput(undefined)).toBe('')
    expect(summarizeToolInput(null)).toBe('')
    expect(summarizeToolInput({})).toBe('')
  })

  it('renders scalar arguments as key: value pairs', () => {
    expect(summarizeToolInput({ path: 'src/app.ts', limit: 5 })).toBe(
      'path: src/app.ts, limit: 5'
    )
  })

  it('keeps false and null visible', () => {
    expect(summarizeToolInput({ recursive: false, cursor: null })).toBe(
      'recursive: false, cursor: null'
    )
  })

  it('collapses nested values to a shape hint', () => {
    expect(summarizeToolInput({ files: ['a', 'b'], opts: { deep: true } })).toBe(
      'files: [2], opts: {...}'
    )
  })

  it('flattens newlines out of multi-line arguments', () => {
    expect(summarizeToolInput({ body: 'line one\n\nline two' })).toBe(
      'body: line one line two'
    )
  })

  it('skips undefined values', () => {
    expect(summarizeToolInput({ a: undefined, b: 1 })).toBe('b: 1')
  })

  it('truncates with an ascii ellipsis', () => {
    const summary = summarizeToolInput({ q: 'x'.repeat(200) }, 20)
    expect(summary).toHaveLength(20)
    expect(summary.endsWith('...')).toBe(true)
  })

  it('summarizes a JSON string argument', () => {
    expect(summarizeToolInput('{"path":"a.ts"}')).toBe('path: a.ts')
  })

  it('summarizes a bare string argument', () => {
    expect(summarizeToolInput('just text')).toBe('just text')
  })
})
