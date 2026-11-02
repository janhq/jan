/**
 * Route-local thread classification for `/threads/$threadId` deep links that
 * arrive before the threads store has hydrated (R3).
 *
 * Why this exists (bot follow-up on #9549):
 *
 * - On a NORMAL startup the Conversational extension registers after the
 *   first route render, so a single `fetchThreads()` throws "Conversational
 *   extension not available yet" and the deep link strands on the global
 *   error screen with no retry. The lookup therefore retries over a bounded
 *   startup window before giving up.
 *
 * - When every attempt fails the classification is UNKNOWN, and a writable
 *   chat must never mount over an undecidable thread (it would fork a cowork
 *   transcript into `messages.jsonl`). The failure surfaces as a typed
 *   {@link ThreadClassificationUnavailableError} that the route renders as a
 *   recoverable Retry screen instead of a dead end.
 *
 * - The store is re-read before every attempt AND after every successful
 *   fetch: a hydration (or a cowork commit) landing DURING an await is newer
 *   than the fetched backend snapshot, and deciding on the stale snapshot
 *   could classify a just-committed cowork thread as an ordinary chat.
 *   Nothing fetched is ever written back into the store.
 *
 * Deliberately NOT gated on `useThreads.isLoadingThreads`: DataProvider also
 * flips that flag to false when ITS fetch retries exhaust, so "not loading"
 * is not an authoritative "hydrated" signal — skipping the backend lookup on
 * it would mount a writable chat over a persisted cowork thread precisely in
 * the failure state. The store-resident record is the only authoritative
 * skip; the full-list fetch runs on a store miss only (unknown or deleted ids
 * after hydration), which is rare enough to stay acceptable until a
 * success-only hydration flag exists.
 */

export class ThreadClassificationUnavailableError extends Error {
  readonly threadId: string
  /** The last fetch rejection; named to avoid depending on ES2022 `cause`. */
  readonly causeError: unknown

  constructor(threadId: string, causeError: unknown) {
    super(
      `Could not determine whether conversation "${threadId}" is a chat or a ` +
        'Cowork session: the conversation backend is not ready yet.'
    )
    this.name = 'ThreadClassificationUnavailableError'
    this.threadId = threadId
    this.causeError = causeError
  }
}

/** Bounded startup window: 6 attempts, backoff 150/300/450/600/750ms. */
export const THREAD_LOOKUP_ATTEMPTS = 6

export const threadLookupDelayMs = (attempt: number): number =>
  Math.min(1000, 150 * (attempt + 1))

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface ResolveThreadForRouteOptions<T extends { id: string }> {
  threadId: string
  /** Live store read; consulted before every attempt and after every fetch. */
  readThread: () => T | undefined
  /** Backend lookup; may reject while the extension is still registering. */
  fetchThreads: () => Promise<T[]>
  attempts?: number
  delayMs?: (attempt: number) => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Resolves the thread record a route decision needs, retrying backend
 * startup failures over a bounded window. Resolves `undefined` for an id
 * unknown to both the store and a HEALTHY backend (existing unknown-id
 * behavior); throws {@link ThreadClassificationUnavailableError} when the
 * backend never answered, so the caller can refuse to mount a writable chat.
 */
export async function resolveThreadForRoute<T extends { id: string }>(
  options: ResolveThreadForRouteOptions<T>
): Promise<T | undefined> {
  const {
    threadId,
    readThread,
    fetchThreads,
    attempts = THREAD_LOOKUP_ATTEMPTS,
    delayMs = threadLookupDelayMs,
    sleep = defaultSleep,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    // A hydration may have landed while we backed off.
    const resident = readThread()
    if (resident) return resident
    try {
      const fetched = await fetchThreads()
      // Mid-await store-wins: a record committed during the fetch is newer
      // than the backend snapshot the fetch was issued against.
      return readThread() ?? fetched.find((t) => t.id === threadId)
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await sleep(delayMs(attempt))
    }
  }
  // The store can also hydrate during the FINAL failed attempt.
  const resident = readThread()
  if (resident) return resident
  throw new ThreadClassificationUnavailableError(threadId, lastError)
}
