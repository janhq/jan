import { getServiceHub } from '@/hooks/useServiceHub'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { ContentType, type ThreadContent } from '@janhq/core'

/**
 * Result from a full-text thread search.
 * `matchSource` indicates where the search term was found.
 * `snippet` is a short excerpt around the match (present for any content match).
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

/** Per-thread content cap to prevent runaway memory use on very long chats. */
const MAX_CONTENT_CHARS = 5000

/**
 * Upper bound on the number of threads kept in the in-memory corpus. When a
 * user has more threads than this, only the most-recently-updated ones are
 * indexed for content search (older threads still match by title via the fzf
 * fallback in the search dialog). At the cap the corpus holds roughly
 * MAX_INDEXED_THREADS * MAX_CONTENT_CHARS chars (~10 MB at the defaults).
 */
const MAX_INDEXED_THREADS = 2000

/**
 * Extract plain text from a ThreadMessage's content array.
 * Only pulls text-type content parts and strips XML-like tags (e.g. think blocks).
 */
export function extractTextFromContent(
  content: ThreadContent[] | undefined
): string {
  if (!content) return ''
  const parts: string[] = []
  for (const c of content) {
    if (c.type === ContentType.Text && c.text?.value) {
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
export function extractSnippet(text: string, term: string): string | undefined {
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
 * Capped at MAX_CONTENT_CHARS to prevent runaway memory use on very long chats.
 */
async function buildEntryForThread(thread: Thread): Promise<CorpusEntry> {
  const messages = await getServiceHub().messages().fetchMessages(thread.id)
  const contentText = messages
    .map((m) => extractTextFromContent(m.content))
    .join(' ')
    .slice(0, MAX_CONTENT_CHARS)
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
 * const results = index.search(...) // fast substring query
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
  /** Latest threads record seen by build(), used by in-flight rebuild loop. */
  private latestThreads: Record<string, Thread> = {}

  /**
   * The threads eligible for content indexing: real threads with a title,
   * capped to the MAX_INDEXED_THREADS most-recently-updated. Used by both
   * doBuild() and hasPendingWork() so they always agree on the target set
   * (otherwise capped-out threads would look perpetually "new").
   */
  private eligibleThreads(threads: Record<string, Thread>): Thread[] {
    const list = Object.values(threads).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID && t.title
    )
    if (list.length <= MAX_INDEXED_THREADS) return list
    return [...list]
      .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
      .slice(0, MAX_INDEXED_THREADS)
  }

  /**
   * Build (or refresh) the search corpus.  Re-fetches messages for any
   * threads marked stale and for any new threads not yet in the index.
   * Safe to call multiple times — subsequent calls only do incremental work.
   *
   * If invalidations or new threads arrive *while* a build is in flight, the
   * build loops again so that mid-build changes are never dropped.
   */
  async build(threads: Record<string, Thread>): Promise<void> {
    this.latestThreads = threads
    // Concurrent callers share the same promise. latestThreads is updated
    // above so the in-flight loop will use the newest threads on its next
    // iteration — the second caller's changes are not lost.
    if (this.buildPromise) return this.buildPromise

    this.buildPromise = (async () => {
      try {
        // Keep building until no new work has accumulated. doBuild() consumes
        // the stale/deleted sets; anything that arrived during the await shows
        // up as pending work on the next iteration.
        do {
          await this.doBuild(this.latestThreads)
        } while (this.hasPendingWork(this.latestThreads))
      } finally {
        this.buildPromise = null
      }
    })()
    return this.buildPromise
  }

  private async doBuild(threads: Record<string, Thread>): Promise<void> {
    const isFirstBuild = this.entriesByThreadId === null
    if (!this.entriesByThreadId) this.entriesByThreadId = new Map()

    // Evict deleted threads
    for (const id of this.deletedThreadIds) this.entriesByThreadId.delete(id)
    this.deletedThreadIds.clear()

    // Determine which threads need (re)fetching
    const threadList = this.eligibleThreads(threads)
    const toFetch: Thread[] = []
    for (const thread of threadList) {
      const isNew = !this.entriesByThreadId.has(thread.id)
      const isStale = this.staleThreadIds.has(thread.id)
      if (isNew || isStale) toFetch.push(thread)
    }
    this.staleThreadIds.clear()

    // Evict any threads that are no longer eligible (deleted or pushed past
    // the cap by more-recent threads).
    const liveIds = new Set(threadList.map((t) => t.id))
    for (const id of this.entriesByThreadId.keys()) {
      if (!liveIds.has(id)) this.entriesByThreadId.delete(id)
    }

    if (toFetch.length === 0 && !isFirstBuild) {
      // Nothing left to fetch (eviction above already applied).
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
  }

  /**
   * Search both title and message content. Returns de-duplicated results
   * sorted by relevance (title matches first, then content matches).
   *
   * Both titles and content use case-insensitive substring matching, so there
   * are no fuzzy false positives.
   */
  search(term: string): ThreadSearchResult[] {
    if (!term || !this.entriesByThreadId) return []
    const lowerTerm = term.toLowerCase()

    const results: ThreadSearchResult[] = []

    for (const entry of this.entriesByThreadId.values()) {
      const titleMatch = entry.thread.title?.toLowerCase().includes(lowerTerm)
      const contentMatch = entry.contentText.toLowerCase().includes(lowerTerm)
      if (!titleMatch && !contentMatch) continue
      results.push({
        thread: entry.thread,
        matchSource: titleMatch && contentMatch ? 'both' : titleMatch ? 'title' : 'content',
        // Show a content snippet whenever the term appears in the body, even
        // if the title also matched — the snippet adds useful context.
        snippet: contentMatch
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

  /**
   * Whether the next build() call would do any work for the given threads.
   * Returns true if the index hasn't been built, if there are stale/deleted
   * entries, or if `threads` contains eligible threads not yet indexed (or the
   * indexed set otherwise diverges from the eligible set).
   */
  hasPendingWork(threads: Record<string, Thread>): boolean {
    if (this.entriesByThreadId === null) return true
    if (this.staleThreadIds.size > 0) return true
    if (this.deletedThreadIds.size > 0) return true

    const eligible = this.eligibleThreads(threads)
    for (const t of eligible) {
      if (!this.entriesByThreadId.has(t.id)) return true
    }
    // A size mismatch means some indexed thread is no longer eligible.
    return this.entriesByThreadId.size !== eligible.length
  }
}

// Singleton instance
let instance: ThreadSearchIndex | null = null

export function getThreadSearchIndex(): ThreadSearchIndex {
  if (!instance) instance = new ThreadSearchIndex()
  return instance
}

/** Test-only: drop the singleton so each test starts from a clean index. */
export function __resetThreadSearchIndexForTests(): void {
  instance = null
}
