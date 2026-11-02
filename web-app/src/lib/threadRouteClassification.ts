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
 * - An EMPTY fetched list is NOT an authoritative answer. The native
 *   `listThreads` bridge coerces a not-ready/non-array backend response to
 *   `[]`, so `[]` can mean "backend not ready" while persisted cowork
 *   threads exist on disk — resolving `undefined` on it would mount a
 *   writable chat over a hidden cowork thread. An empty list is therefore
 *   treated like a failed attempt: retry within the window, then fail
 *   closed into the typed error (recoverable Retry screen). A genuinely
 *   empty backend is indistinguishable from "not ready" without a
 *   success-only signal, so a deep link into a fresh install pays the
 *   bounded retry window before erroring — accepted. Only a NON-empty list
 *   is authoritative for the existing unknown-id (`undefined`) behavior.
 *
 * Deliberately NOT gated on `useThreads.isLoadingThreads`: DataProvider also
 * flips that flag to false when ITS fetch retries exhaust, so "not loading"
 * is not an authoritative "hydrated" signal — skipping the backend lookup on
 * it would mount a writable chat over a persisted cowork thread precisely in
 * the failure state. The store-resident record is the only authoritative
 * skip.
 *
 * DEFERRED (explicit disposition, not an oversight): the full-list fetch
 * still runs once per store-missed id even after a successful hydration
 * (unknown or deleted ids). The single `fetchThreads()` API carries no
 * success/"hydration complete" flag, so there is nothing authoritative to
 * gate on without re-opening the race above. Misses are rare (deleted or
 * mistyped ids); revisit only when a success-only hydration signal exists.
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
 * unknown to both the store and a HEALTHY backend — which requires a
 * NON-empty list, since the bridge coerces not-ready responses to `[]`
 * (existing unknown-id behavior); throws
 * {@link ThreadClassificationUnavailableError} when the backend never
 * answered (every attempt rejected OR returned an empty list), so the
 * caller can refuse to mount a writable chat.
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
      const midAwait = readThread()
      if (midAwait) return midAwait
      if (fetched.length > 0) {
        // Only a non-empty list is authoritative: the id either is in it
        // or is a genuine miss (existing unknown-id behavior).
        return fetched.find((t) => t.id === threadId)
      }
      // Empty list: the bridge coerces a not-ready backend to [], so this
      // is indistinguishable from "not ready" and may hide persisted
      // cowork threads. Treat as a failed attempt — never as a healthy
      // unknown — and fail closed if the window exhausts.
      lastError = new Error(
        'Thread list fetch returned an empty list; cannot distinguish ' +
          '"backend not ready" from "no threads exist".'
      )
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts - 1) await sleep(delayMs(attempt))
  }
  // The store can also hydrate during the FINAL failed attempt.
  const resident = readThread()
  if (resident) return resident
  throw new ThreadClassificationUnavailableError(threadId, lastError)
}
