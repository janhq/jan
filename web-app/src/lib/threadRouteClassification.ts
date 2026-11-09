/**
 * Route-local thread classification for `/threads/$threadId` deep links that
 * arrive before the threads store has hydrated.
 *
 * Startup and classification guarantees:
 *
 * - StartupProvider initializes services and extensions BEFORE RouterProvider
 *   loads the initial route. Root-route providers cannot do this: beforeLoad
 *   runs before the root component mounts. The bounded lookup retry is only
 *   for late/recovering extensions (including the setup watchdog), not a
 *   substitute for initializing services before route loading.
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
 * - Before successful store hydration, an empty fallback listing is treated
 *   conservatively as unknown: it cannot establish that the store's complete
 *   startup inventory has committed. Retry within the bounded window, then
 *   show the recoverable error. Once DataProvider commits a validated listing
 *   (including a genuinely empty array), its success-only flag makes a store
 *   miss authoritative and avoids the fallback entirely.
 *
 * Hydration signal: `useThreads.threadsHydrated` is a SUCCESS-ONLY flag set
 * by DataProvider's success branch after the service validated an actual
 * array response (the service now throws on a non-array, so `[]` is a real
 * zero-thread listing). It is deliberately NOT `isLoadingThreads`, which
 * DataProvider also clears when its retries exhaust. When hydrated, a
 * store miss is authoritative (`undefined`) and the backend lookup is
 * skipped; the store is still re-read first and after every await, so a
 * newer store record (cowork commit / migration race) always wins and its
 * persisted metadata drives classification. When NOT hydrated (fresh
 * startup) an empty fallback list stays UNKNOWN and fails closed.
 */

export class ThreadClassificationUnavailableError extends Error {
  readonly threadId: string
  /** The last fetch rejection; named to avoid depending on ES2022 `cause`. */
  readonly causeError: unknown

  constructor(threadId: string, causeError: unknown) {
    super(
      `Could not confirm whether conversation "${threadId}" is a chat or a ` +
        'Cowork session. Please retry; if this persists, restart the app.'
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
  /** Success-only hydration flag; true makes a store miss authoritative. */
  isHydrated?: () => boolean
  attempts?: number
  delayMs?: (attempt: number) => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Resolves the thread record a route decision needs, retrying backend
 * startup failures over a bounded window. Resolves `undefined` for an id
 * unknown to both the store and a HEALTHY backend - which requires a
 * NON-empty fallback list or successful store hydration
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
    isHydrated = () => false,
    attempts = THREAD_LOOKUP_ATTEMPTS,
    delayMs = threadLookupDelayMs,
    sleep = defaultSleep,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    // A hydration may have landed while we backed off.
    const resident = readThread()
    if (resident) return resident
    // Success-only hydration already applied the full listing: a miss is real.
    if (isHydrated()) return undefined
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
      // Hydration may have succeeded while we awaited (store re-read above
      // found no record), so a miss is authoritative now.
      if (isHydrated()) return undefined
      // Before store hydration, an empty fallback does not establish a
      // committed startup inventory. Keep the route fail-closed until a
      // record or successful hydration makes classification authoritative.
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
  if (isHydrated()) return undefined
  throw new ThreadClassificationUnavailableError(threadId, lastError)
}
