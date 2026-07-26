import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ContentType, type ThreadContent } from '@janhq/core'

// Mock the service hub so build() reads message content from an in-memory map.
const messagesByThread: Record<
  string,
  Array<{ content: ThreadContent[] }>
> = {}
const fetchMessages = vi.fn(async (threadId: string) =>
  messagesByThread[threadId] ?? []
)

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    messages: () => ({ fetchMessages }),
  }),
}))

import {
  extractTextFromContent,
  extractSnippet,
  getThreadSearchIndex,
  __resetThreadSearchIndexForTests,
} from '../search-index'

function textContent(value: string): ThreadContent {
  return { type: ContentType.Text, text: { value, annotations: [] } }
}

function makeThread(id: string, title: string, updated = 0): Thread {
  return { id, title, updated } as Thread
}

beforeEach(() => {
  __resetThreadSearchIndexForTests()
  for (const k of Object.keys(messagesByThread)) delete messagesByThread[k]
  fetchMessages.mockClear()
})

describe('extractTextFromContent', () => {
  it('returns empty string for undefined content', () => {
    expect(extractTextFromContent(undefined)).toBe('')
  })

  it('joins text parts with a space', () => {
    const text = extractTextFromContent([textContent('hello'), textContent('world')])
    expect(text).toBe('hello world')
  })

  it('ignores non-text content parts', () => {
    const content: ThreadContent[] = [
      textContent('keep me'),
      { type: ContentType.Image, image_url: { url: 'http://x/y.png' } },
    ]
    expect(extractTextFromContent(content)).toBe('keep me')
  })

  it('strips think/reasoning blocks', () => {
    const content = [
      textContent('<think>secret reasoning</think>visible answer'),
    ]
    expect(extractTextFromContent(content)).toBe('visible answer')
  })

  it('drops parts that are empty after stripping', () => {
    const content = [textContent('<thinking>only reasoning</thinking>'), textContent('real')]
    expect(extractTextFromContent(content)).toBe('real')
  })
})

describe('extractSnippet', () => {
  it('returns undefined when the term is absent', () => {
    expect(extractSnippet('the quick brown fox', 'zebra')).toBeUndefined()
  })

  it('is case-insensitive', () => {
    expect(extractSnippet('Hello World', 'world')).toContain('World')
  })

  it('adds leading/trailing ellipses when truncating', () => {
    const long = 'a'.repeat(200) + 'NEEDLE' + 'b'.repeat(200)
    const snippet = extractSnippet(long, 'NEEDLE')!
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('NEEDLE')
  })

  it('omits ellipses when the match is near the edges', () => {
    const snippet = extractSnippet('short text', 'short')!
    expect(snippet).toBe('short text')
  })
})

describe('ThreadSearchIndex', () => {
  it('matches on title only', async () => {
    const threads = { a: makeThread('a', 'Banana bread recipe') }
    messagesByThread['a'] = [textContent('unrelated body')].map((c) => ({
      content: [c],
    }))

    const index = getThreadSearchIndex()
    await index.build(threads)
    const results = index.search('banana')

    expect(results).toHaveLength(1)
    expect(results[0].matchSource).toBe('title')
    expect(results[0].snippet).toBeUndefined()
  })

  it('matches on content only and returns a snippet', async () => {
    const threads = { a: makeThread('a', 'Untitled chat') }
    messagesByThread['a'] = [{ content: [textContent('we discussed kubernetes networking')] }]

    const index = getThreadSearchIndex()
    await index.build(threads)
    const results = index.search('kubernetes')

    expect(results).toHaveLength(1)
    expect(results[0].matchSource).toBe('content')
    expect(results[0].snippet).toContain('kubernetes')
  })

  it('reports matchSource "both" and still includes a content snippet', async () => {
    const threads = { a: makeThread('a', 'kubernetes notes') }
    messagesByThread['a'] = [{ content: [textContent('more kubernetes details here')] }]

    const index = getThreadSearchIndex()
    await index.build(threads)
    const results = index.search('kubernetes')

    expect(results[0].matchSource).toBe('both')
    expect(results[0].snippet).toContain('kubernetes')
  })

  it('uses strict substring matching (no fuzzy false positives)', async () => {
    const threads = { a: makeThread('a', 'xylophone buzz') }
    messagesByThread['a'] = [{ content: [textContent('nothing relevant')] }]

    const index = getThreadSearchIndex()
    await index.build(threads)
    expect(index.search('xyz')).toHaveLength(0)
  })

  it('sorts title matches ahead of content matches', async () => {
    const threads = {
      content: makeThread('content', 'Some chat', 100),
      title: makeThread('title', 'apple pie', 1),
    }
    messagesByThread['content'] = [{ content: [textContent('talking about apple')] }]
    messagesByThread['title'] = [{ content: [textContent('no fruit here')] }]

    const index = getThreadSearchIndex()
    await index.build(threads)
    const results = index.search('apple')

    expect(results.map((r) => r.thread.id)).toEqual(['title', 'content'])
  })

  it('search returns [] before the index is built', () => {
    const index = getThreadSearchIndex()
    expect(index.search('anything')).toEqual([])
  })
})

describe('ThreadSearchIndex.hasPendingWork', () => {
  it('is true before the first build', () => {
    const index = getThreadSearchIndex()
    expect(index.hasPendingWork({ a: makeThread('a', 'A') })).toBe(true)
  })

  it('is false right after building the same threads', async () => {
    const threads = { a: makeThread('a', 'A') }
    const index = getThreadSearchIndex()
    await index.build(threads)
    expect(index.hasPendingWork(threads)).toBe(false)
  })

  it('detects newly created threads (regression: new threads were unsearchable)', async () => {
    const threads: Record<string, Thread> = { a: makeThread('a', 'A') }
    const index = getThreadSearchIndex()
    await index.build(threads)
    expect(index.hasPendingWork(threads)).toBe(false)

    // User creates a new thread after the initial build.
    threads['b'] = makeThread('b', 'B')
    expect(index.hasPendingWork(threads)).toBe(true)

    messagesByThread['b'] = [{ content: [textContent('brand new content')] }]
    await index.build(threads)
    expect(index.search('brand new')).toHaveLength(1)
  })

  it('detects stale threads after invalidateThread', async () => {
    const threads = { a: makeThread('a', 'A') }
    messagesByThread['a'] = [{ content: [textContent('old content')] }]
    const index = getThreadSearchIndex()
    await index.build(threads)
    expect(index.search('updated')).toHaveLength(0)

    messagesByThread['a'] = [{ content: [textContent('updated content')] }]
    index.invalidateThread('a')
    expect(index.hasPendingWork(threads)).toBe(true)

    await index.build(threads)
    expect(index.search('updated')).toHaveLength(1)
  })

  it('evicts removed threads on the next build', async () => {
    const threads: Record<string, Thread> = {
      a: makeThread('a', 'A'),
      b: makeThread('b', 'B'),
    }
    messagesByThread['a'] = [{ content: [textContent('alpha')] }]
    messagesByThread['b'] = [{ content: [textContent('beta')] }]
    const index = getThreadSearchIndex()
    await index.build(threads)
    expect(index.search('beta')).toHaveLength(1)

    delete threads['b']
    index.removeThread('b')
    expect(index.hasPendingWork(threads)).toBe(true)

    await index.build(threads)
    expect(index.search('beta')).toHaveLength(0)
  })

  it('invalidate() drops the whole corpus', async () => {
    const threads = { a: makeThread('a', 'A') }
    const index = getThreadSearchIndex()
    await index.build(threads)
    index.invalidate()
    expect(index.isReady).toBe(false)
    expect(index.hasPendingWork(threads)).toBe(true)
  })
})

describe('ThreadSearchIndex build lifecycle', () => {
  it('picks up invalidations that arrive mid-build (race condition)', async () => {
    const threads = { a: makeThread('a', 'A') }
    messagesByThread['a'] = [{ content: [textContent('first version')] }]

    let resolveFirst: (() => void) | undefined
    // Make the first fetch hang so we can invalidate while build() is in flight.
    fetchMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve(messagesByThread['a'])
        })
    )

    const index = getThreadSearchIndex()
    const buildPromise = index.build(threads)

    // Invalidate while the first build is still awaiting the fetch.
    messagesByThread['a'] = [{ content: [textContent('second version')] }]
    index.invalidateThread('a')

    resolveFirst!()
    await buildPromise

    // The mid-build invalidation must have triggered a re-fetch.
    expect(index.search('second version')).toHaveLength(1)
  })
})
