import { describe, expect, it } from 'vitest'
import { describeNativeToolCall, parseWebFetchOutput } from '../toolPresentation'

const search = { kind: 'web-search', detail: 'Exa' } as const
const fetchOrigin = { kind: 'web-fetch' } as const

describe('describeNativeToolCall', () => {
  it('builds a search bar from the query', () => {
    expect(describeNativeToolCall(search, 'web_search', { query: 'rust async', count: 5 })).toEqual(
      { variant: 'search', query: 'rust async', count: 5 }
    )
  })

  // Arguments stream in a character at a time; a partial query must still show.
  it('accepts a partially streamed query', () => {
    expect(describeNativeToolCall(search, 'web_search', { query: 'rust as' })).toEqual({
      variant: 'search',
      query: 'rust as',
    })
  })

  it('yields an empty bar before any argument has arrived', () => {
    expect(describeNativeToolCall(search, 'web_search', undefined)).toEqual({
      variant: 'search',
      query: '',
    })
  })

  it('ignores a non-numeric count', () => {
    expect(describeNativeToolCall(search, 'web_search', { query: 'q', count: 'five' })).toEqual({
      variant: 'search',
      query: 'q',
    })
  })

  it('builds an address bar for web fetch', () => {
    expect(describeNativeToolCall(fetchOrigin, 'web_fetch', { url: 'https://a.dev/x' })).toEqual({
      variant: 'address',
      url: 'https://a.dev/x',
    })
  })

  it('builds a documents bar for a RAG retrieve', () => {
    expect(
      describeNativeToolCall({ kind: 'rag' }, 'retrieve', {
        query: 'refund policy',
        top_k: 4,
        file_ids: ['a', 'b'],
      })
    ).toEqual({
      variant: 'documents',
      query: 'refund policy',
      count: 4,
      fileCount: 2,
    })
  })

  it('omits absent RAG modifiers', () => {
    expect(
      describeNativeToolCall({ kind: 'rag' }, 'retrieve', { query: 'q' })
    ).toEqual({ variant: 'documents', query: 'q' })
  })

  it('has no bar for other RAG tools or for MCP', () => {
    expect(
      describeNativeToolCall({ kind: 'rag' }, 'list_attachments', {})
    ).toBeUndefined()
    expect(
      describeNativeToolCall({ kind: 'rag' }, 'get_chunks', { file_id: 'f' })
    ).toBeUndefined()
    expect(
      describeNativeToolCall({ kind: 'mcp', detail: 'fs' }, 'read_file', {})
    ).toBeUndefined()
    expect(describeNativeToolCall(undefined, 'x', {})).toBeUndefined()
  })
})

describe('parseWebFetchOutput', () => {
  it('splits the title, url and body', () => {
    const page = parseWebFetchOutput(
      'Title: Async Rust\nURL: https://a.dev/x\n\nbody text here'
    )
    expect(page).toEqual({
      title: 'Async Rust',
      url: 'https://a.dev/x',
      content: 'body text here',
      truncated: false,
    })
  })

  it('detects the truncation marker without leaking it into the body', () => {
    const page = parseWebFetchOutput(
      'Title: T\nURL: https://a.dev\n\nbody\n\n[content truncated]'
    )
    expect(page?.truncated).toBe(true)
    expect(page?.content).toBe('body')
  })

  it('keeps a multi-line body intact', () => {
    const page = parseWebFetchOutput(
      'Title: T\nURL: https://a.dev\n\nline one\n\nline two'
    )
    expect(page?.content).toBe('line one\n\nline two')
  })

  it('treats an unprefixed blob as body-only', () => {
    expect(parseWebFetchOutput('just content')).toEqual({
      content: 'just content',
      truncated: false,
    })
  })

  it('unwraps a { content } envelope', () => {
    expect(parseWebFetchOutput({ content: 'inner' })?.content).toBe('inner')
  })

  it('omits empty header values', () => {
    const page = parseWebFetchOutput('Title: \nURL: \n\nbody')
    expect(page?.title).toBeUndefined()
    expect(page?.url).toBeUndefined()
  })

  it('is undefined for a non-text payload', () => {
    expect(parseWebFetchOutput({ kind: 'web' })).toBeUndefined()
    expect(parseWebFetchOutput(undefined)).toBeUndefined()
  })
})
