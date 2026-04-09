import { describe, it, expect } from 'vitest'
import { ContentType } from '@janhq/core'
import {
  stringifyToolOutputForTokenCount,
  MAX_STRINGIFY_DEPTH_FOR_COUNT,
  MAX_TOOL_OUTPUT_CHARS_FOR_COUNT,
  extractToolContextFromMetadata,
  extractToolContextFromContent,
} from '../tokenCountToolContext'
import type { ThreadMessage } from '@janhq/core'

describe('stringifyToolOutputForTokenCount', () => {
  it('returns empty string for null and undefined', () => {
    expect(stringifyToolOutputForTokenCount(null)).toBe('')
    expect(stringifyToolOutputForTokenCount(undefined)).toBe('')
  })

  it('stringifies primitives', () => {
    expect(stringifyToolOutputForTokenCount('hello')).toBe('hello')
    expect(stringifyToolOutputForTokenCount(42)).toBe('42')
    expect(stringifyToolOutputForTokenCount(true)).toBe('true')
  })

  it('joins array elements with newlines', () => {
    expect(stringifyToolOutputForTokenCount([1, 'a', false])).toBe('1\na\nfalse')
  })

  it('extracts text from objects with a content array', () => {
    const v = {
      content: [
        { type: 'text', text: 'line1' },
        { type: 'text', text: { nested: 'skip' } },
      ],
    }
    const out = stringifyToolOutputForTokenCount(v)
    expect(out).toContain('line1')
  })

  it('falls back to JSON for plain objects', () => {
    expect(stringifyToolOutputForTokenCount({ a: 1 })).toBe('{"a":1}')
  })

  it('stops recursing past max depth', () => {
    let nested: unknown = 'leaf'
    for (let i = 0; i < MAX_STRINGIFY_DEPTH_FOR_COUNT + 3; i++) {
      nested = [nested]
    }
    const out = stringifyToolOutputForTokenCount(nested)
    expect(out.length).toBe(0)
  })

  it('truncates very long strings', () => {
    const long = 'x'.repeat(MAX_TOOL_OUTPUT_CHARS_FOR_COUNT + 100)
    const out = stringifyToolOutputForTokenCount(long)
    expect(out.length).toBe(MAX_TOOL_OUTPUT_CHARS_FOR_COUNT + 1)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('extractToolContextFromMetadata', () => {
  it('formats tool_calls output', () => {
    const message = {
      metadata: {
        tool_calls: [
          {
            name: 'search',
            response: { ok: true },
          },
        ],
      },
    } as unknown as ThreadMessage
    const out = extractToolContextFromMetadata(message)
    expect(out).toContain('Tool search output')
    expect(out).toContain('"ok":true')
  })
})

describe('extractToolContextFromContent', () => {
  it('formats tool_call blocks', () => {
    const message = {
      content: [
        {
          type: ContentType.ToolCall,
          tool_name: 'exa',
          input: { q: 'test' },
          output: 'results',
        },
      ],
    } as unknown as ThreadMessage
    const out = extractToolContextFromContent(message)
    expect(out).toContain('Tool exa call')
    expect(out).toContain('Input:')
    expect(out).toContain('Output:')
  })
})
