import { getServiceHub } from '@/hooks/useServiceHub'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

/**
 * Result from a full-text thread search.
 * `matchSource` indicates where the search term was found.
 * `snippet` is a short excerpt around the match (only present for content matches).
 */
export interface ThreadSearchResult {
  thread: Thread
  matchSource: 'title' | 'content' | 'both'
  snippet?: string
}

interface CorpusEntry {
  thread: Thread
  /** Concatenated text content from all messages in this thread. */
  contentText: string
}

/**
 * Extract plain text from a ThreadMessage's content array.
 * Only pulls text-type content parts and strips XML-like tags (e.g. think blocks).
 */
function extractTextFromContent(
  content: Array<{ type: string; text?: { value: string } }> | undefined
): string {
  if (!content) return ''
  const parts: string[] = []
  for (const c of content) {
    if (c.type === 'text' && c.text?.value) {
      // Strip reasoning blocks that may have been saved with think tags
      const clean = c.text.value
        .replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .trim()
      if (clean) parts.push(clean)
    }
  }
  return parts.join(' ')
}

/**
 * Extract a short text snippet around the first match of `term` in `text`.
 * Returns a ~120-char window centred on the match.
 */
function extractSnippet(text: string, term: string): string | undefined {
  const lower = text.toLowerCase()
  const idx = lower.indexOf(term.toLowerCase())
  if (idx === -1) return undefined

  const margin = 55
  const start = Math.max(0, idx - margin)
  const end = Math.min(text.length, idx + term.length + margin)
  let snippet = text.slice(start, end)
  if (start > 0) snippet = '…' + snippet
  if (end < text.length) snippet = snippet + '…'
  return snippet
}

/**
 * Fetch and concatenate the text content for a single thread from disk.
 * Capped at 5000 chars to prevent runaway memory use on very long chats.
 */
async function buildEntryForThread(thread: Thread): Promise<CorpusEntry> {
  const messages = await getServiceHub().messages().fetchMessages(thread.id)
  const contentText = messages
    .map((m) => extractTextFromContent(m.content as any))
    .join(' ')
    .slice(0, 5000)
  return { thread, contentText }
}

/**
 * A lazily-initialised, cached full-text search index that searches both
 * thread titles and message content.
 *
 * Usage:
 * ```ts
 * const index = getThreadSearchIndex()
 * await index.build(threads)        // loads messages for all threads
 * const results = index.search(...) // fast fzf query
 * index.invalidateThread(threadId)  // re-fetches just that thread next time
 * ```
 */
class ThreadSearchIndex {
  /** Thread ID -> corpus entry. Null until first build() completes. */
  private entriesByThreadId: Map<string, CorpusEntry> | null = null
  /** Thread IDs whose content needs to be re-fetched on next search/build. */
  private staleThreadIds = new Set<string>()
  /** Thread IDs that have been deleted and should be evicted from the index. */
  private deletedThreadIds = new Set<string>()

  private buildPromise: Promise<void> | null = null

  /**
   * Build (or refresh) the search corpus.  Re-fetches messages for any
   * threads marked stale and for any new threads not yet in the index.
   * Safe to call multiple times — subsequent calls only do incremental work.
   */
  async build(threads: Record<string, Thread>): Promise<void> {
    if (this.buildPromise) return this.buildPromise

    this.buildPromise = this.doBuild(threads)
    try {
      await this.buildPromise
    } finally {
      this.buildPromise = null
    }
  }

  private async doBuild(threads: Record<string, Thread>): Promise<void> {
    const isFirstBuild = this.entriesByThreadId === null
    if (!this.entriesByThreadId) this.entriesByThreadId = new Map()

    // Evict deleted threads
    for (const id of this.deletedThreadIds) this.entriesByThreadId.delete(id)
    this.deletedThreadIds.clear()

    // Determine which threads need (re)fetching
    const threadList = Object.values(threads).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID && t.title
    )
    const toFetch: Thread[] = []
    for (const thread of threadList) {
      const isNew = !this.entriesByThreadId.has(thread.id)
      const isStale = this.staleThreadIds.has(thread.id)
      if (isNew || isStale) toFetch.push(thread)
    }
    this.staleThreadIds.clear()

    if (toFetch.length === 0 && !isFirstBuild) {
      // Nothing to do
      return
    }

    // Fetch missing/stale threads in batches (parallel within batch)
    const BATCH = 10
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH)
      const results = await Promise.allSettled(batch.map(buildEntryForThread))
      for (const r of results) {
        if (r.status === 'fulfilled') {
          this.entriesByThreadId.set(r.value.thread.id, r.value)
        }
      }
    }

    // Also evict any threads that no longer exist in the threads record
    const liveIds = new Set(threadList.map((t) => t.id))
    for (const id of this.entriesByThreadId.keys()) {
      if (!liveIds.has(id)) this.entriesByThreadId.delete(id)
    }

    this.rebuildIndex()
  }

  /** Rebuild after all fetches are complete. */
  private rebuildIndex(): void {
    if (!this.entriesByThreadId) return
    // Entries are already in-place from doBuild(); just mark index as ready.
  }

  /**
   * Search both title and message content. Returns de-duplicated results
   * sorted by relevance (title matches first, then content matches).
   *
   * Title matches use fuzzy matching (good for short text).
   * Content matches use substring matching (better for prose / code).
   */
  search(term: string): ThreadSearchResult[] {
    if (!term || !this.entriesByThreadId) return []
    const lowerTerm = term.toLowerCase()

    const results: ThreadSearchResult[] = []

    // Substring search — no false positives.
    // Titles use smart-case (case-insensitive unless the query has uppercase).
    for (const entry of this.entriesByThreadId.values()) {
      const titleMatch = entry.thread.title?.toLowerCase().includes(lowerTerm)
      const contentMatch = entry.contentText.toLowerCase().includes(lowerTerm)
      if (!titleMatch && !contentMatch) continue
      results.push({
        thread: entry.thread,
        matchSource: titleMatch && contentMatch ? 'both' : titleMatch ? 'title' : 'content',
        snippet: contentMatch && !titleMatch
          ? extractSnippet(entry.contentText, term)
          : undefined,
      })
    }

    // Sort: title matches first (more relevant), then by thread recency
    results.sort((a, b) => {
      if (a.matchSource === 'title' && b.matchSource !== 'title') return -1
      if (a.matchSource !== 'title' && b.matchSource === 'title') return 1
      return (b.thread.updated ?? 0) - (a.thread.updated ?? 0)
    })

    return results
  }

  /** Mark a single thread as stale so its content is re-fetched next build(). */
  invalidateThread(threadId: string): void {
    this.staleThreadIds.add(threadId)
  }

  /** Mark a thread as deleted so it's evicted from the index on next build(). */
  removeThread(threadId: string): void {
    this.deletedThreadIds.add(threadId)
    this.staleThreadIds.delete(threadId)
  }

  /** Drop the entire corpus.  Useful for "clear all chats" actions. */
  invalidate(): void {
    this.entriesByThreadId = null
    this.staleThreadIds.clear()
    this.deletedThreadIds.clear()
  }

  /** Whether the index has been built at least once. */
  get isReady(): boolean {
    return this.entriesByThreadId !== null
  }

  /** Whether the next build() call would do any work. */
  get hasPendingWork(): boolean {
    return (
      this.entriesByThreadId === null ||
      this.staleThreadIds.size > 0 ||
      this.deletedThreadIds.size > 0
    )
  }
}

// Singleton instance
let instance: ThreadSearchIndex | null = null

export function getThreadSearchIndex(): ThreadSearchIndex {
  if (!instance) instance = new ThreadSearchIndex()
  return instance
}
