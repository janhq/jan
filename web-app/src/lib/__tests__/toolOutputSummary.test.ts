import { describe, expect, it } from 'vitest'
import { summarizeToolOutput } from '../toolOutputSummary'

describe('summarizeToolOutput', () => {
  it('is undefined with no output', () => {
    expect(summarizeToolOutput(undefined)).toBeUndefined()
    expect(summarizeToolOutput(null)).toBeUndefined()
  })

  it('previews the first meaningful line of a string', () => {
    expect(summarizeToolOutput('\n\n  hello there \nsecond line')).toEqual({
      key: 'tools:toolCall.summaryText',
      values: { preview: 'hello there' },
    })
  })

  it('truncates a long first line', () => {
    const summary = summarizeToolOutput('x'.repeat(400))
    expect(String(summary?.values?.preview)).toHaveLength(140)
    expect(String(summary?.values?.preview).endsWith('...')).toBe(true)
  })

  it('reports an empty string as empty', () => {
    expect(summarizeToolOutput('   \n ')).toEqual({
      key: 'tools:toolCall.summaryEmpty',
    })
  })

  it('previews a single text block from the MCP envelope', () => {
    expect(
      summarizeToolOutput({ content: [{ type: 'text', text: 'one result' }] })
    ).toEqual({
      key: 'tools:toolCall.summaryText',
      values: { preview: 'one result' },
    })
  })

  it('counts multiple text blocks alongside the preview', () => {
    expect(
      summarizeToolOutput({
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      })
    ).toEqual({
      key: 'tools:toolCall.summaryTextBlocks',
      values: { count: 2, preview: 'first' },
    })
  })

  it('counts non-text blocks separately', () => {
    expect(
      summarizeToolOutput({
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image', data: 'base64' },
        ],
      })
    ).toEqual({
      key: 'tools:toolCall.summaryBlocks',
      values: { text: 1, other: 1 },
    })
  })

  it('treats an empty envelope as empty', () => {
    expect(summarizeToolOutput({ content: [] })).toEqual({
      key: 'tools:toolCall.summaryEmpty',
    })
  })

  it('counts array items', () => {
    expect(summarizeToolOutput([1, 2, 3])).toEqual({
      key: 'tools:toolCall.summaryItems',
      values: { count: 3 },
    })
    expect(summarizeToolOutput([])).toEqual({
      key: 'tools:toolCall.summaryEmpty',
    })
  })

  it('names an objects fields, capped at four', () => {
    expect(
      summarizeToolOutput({ a: 1, b: 2, c: 3, d: 4, e: 5 })
    ).toEqual({
      key: 'tools:toolCall.summaryFields',
      values: { count: 5, fields: 'a, b, c, d' },
    })
  })

  it('treats an empty object as empty', () => {
    expect(summarizeToolOutput({})).toEqual({
      key: 'tools:toolCall.summaryEmpty',
    })
  })
})
