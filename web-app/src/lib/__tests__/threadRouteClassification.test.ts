/**
 * Unit tests for the bounded startup retry used by /threads/$threadId
 * beforeLoad (bot follow-up on #9549): a fetchThreads that throws while the
 * Conversational extension is still registering must not strand the deep
 * link, and an exhausted window must surface as the typed recoverable error
 * (never an implicit "ordinary chat" classification). An EMPTY fetched list
 * is NOT authoritative either: the native listThreads bridge coerces a
 * not-ready backend to [], so [] retries and then fails closed.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  resolveThreadForRoute,
  ThreadClassificationUnavailableError,
  THREAD_LOOKUP_ATTEMPTS,
  threadLookupDelayMs,
} from '../threadRouteClassification'

type T = { id: string; metadata?: Record<string, unknown> }

const noSleep = vi.fn(() => Promise.resolve())

const base = (over: Partial<Parameters<typeof resolveThreadForRoute<T>>[0]>) => ({
  threadId: 't1',
  readThread: () => undefined as T | undefined,
  fetchThreads: () => Promise.resolve([] as T[]),
  sleep: noSleep,
  ...over,
})

describe('resolveThreadForRoute', () => {
  it('returns the store-resident record without fetching', async () => {
    const fetchThreads = vi.fn()
    const resident = { id: 't1' }
    const result = await resolveThreadForRoute<T>(
      base({ readThread: () => resident, fetchThreads })
    )
    expect(result).toBe(resident)
    expect(fetchThreads).not.toHaveBeenCalled()
  })

  it('startup failure then success: retries and classifies the cowork thread', async () => {
    const cowork = { id: 't1', metadata: { mode: 'cowork' } }
    const fetchThreads = vi
      .fn<() => Promise<T[]>>()
      .mockRejectedValueOnce(new Error('Conversational extension not available yet'))
      .mockRejectedValueOnce(new Error('Conversational extension not available yet'))
      .mockResolvedValueOnce([cowork])
    const result = await resolveThreadForRoute<T>(base({ fetchThreads }))
    expect(result).toBe(cowork)
    expect(fetchThreads).toHaveBeenCalledTimes(3)
  })

  it('resolves undefined for an id a HEALTHY backend does not know (NON-empty list)', async () => {
    const fetchThreads = vi.fn<() => Promise<T[]>>().mockResolvedValue([{ id: 'other' }])
    const result = await resolveThreadForRoute<T>(base({ fetchThreads }))
    expect(result).toBeUndefined()
    expect(fetchThreads).toHaveBeenCalledTimes(1)
  })

  it('empty list then success: [] is not authoritative, the retry classifies the cowork thread', async () => {
    // The bridge coerces a not-ready/non-array backend response to [], so an
    // empty list must be treated like a failed attempt, never as a healthy
    // "id unknown" — resolving undefined here would mount a writable chat
    // over a persisted cowork thread hidden behind the coercion.
    const cowork = { id: 't1', metadata: { mode: 'cowork' } }
    const fetchThreads = vi
      .fn<() => Promise<T[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cowork])
    const result = await resolveThreadForRoute<T>(base({ fetchThreads }))
    expect(result).toBe(cowork)
    expect(fetchThreads).toHaveBeenCalledTimes(3)
  })

  it('an all-empty window fails closed with the typed error, never a healthy unknown', async () => {
    const fetchThreads = vi.fn<() => Promise<T[]>>().mockResolvedValue([])
    const err = await resolveThreadForRoute<T>(base({ fetchThreads })).then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(ThreadClassificationUnavailableError)
    expect((err as ThreadClassificationUnavailableError).threadId).toBe('t1')
    expect(
      String((err as ThreadClassificationUnavailableError).causeError)
    ).toMatch(/empty list/)
    expect(fetchThreads).toHaveBeenCalledTimes(THREAD_LOOKUP_ATTEMPTS)
  })

  it('exhausted window throws the typed recoverable error, never a silent chat classification', async () => {
    const boom = new Error('Conversational extension not available yet')
    const fetchThreads = vi.fn<() => Promise<T[]>>().mockRejectedValue(boom)
    const err = await resolveThreadForRoute<T>(base({ fetchThreads })).then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(ThreadClassificationUnavailableError)
    expect((err as ThreadClassificationUnavailableError).threadId).toBe('t1')
    expect((err as ThreadClassificationUnavailableError).causeError).toBe(boom)
    expect(fetchThreads).toHaveBeenCalledTimes(THREAD_LOOKUP_ATTEMPTS)
  })

  it('a store hydration landing during a backoff wins before the next fetch', async () => {
    let store: T | undefined
    const fetchThreads = vi
      .fn<() => Promise<T[]>>()
      .mockRejectedValue(new Error('not ready'))
    const sleep = vi.fn(() => {
      store = { id: 't1', metadata: { mode: 'cowork' } }
      return Promise.resolve()
    })
    const result = await resolveThreadForRoute<T>(
      base({ readThread: () => store, fetchThreads, sleep })
    )
    expect(result).toEqual({ id: 't1', metadata: { mode: 'cowork' } })
    expect(fetchThreads).toHaveBeenCalledTimes(1)
  })

  it('mid-await store-wins: a record committed DURING a successful fetch beats the stale snapshot', async () => {
    let store: T | undefined
    const committed = { id: 't1', metadata: { mode: 'cowork' } }
    const fetchThreads = vi.fn<() => Promise<T[]>>(async () => {
      store = committed // lands while the fetch is in flight
      return [] // stale pre-commit backend snapshot
    })
    const result = await resolveThreadForRoute<T>(
      base({ readThread: () => store, fetchThreads })
    )
    expect(result).toBe(committed)
  })

  it('a hydration landing during the FINAL failed attempt still resolves instead of throwing', async () => {
    let store: T | undefined
    const fetchThreads = vi.fn<() => Promise<T[]>>(async () => {
      if (fetchThreads.mock.calls.length === THREAD_LOOKUP_ATTEMPTS) {
        store = { id: 't1' }
      }
      throw new Error('not ready')
    })
    const result = await resolveThreadForRoute<T>(
      base({ readThread: () => store, fetchThreads })
    )
    expect(result).toEqual({ id: 't1' })
    expect(fetchThreads).toHaveBeenCalledTimes(THREAD_LOOKUP_ATTEMPTS)
  })

  it('backoff stays bounded (startup window, not an unbounded spin)', () => {
    expect(threadLookupDelayMs(0)).toBe(150)
    expect(threadLookupDelayMs(THREAD_LOOKUP_ATTEMPTS - 1)).toBeLessThanOrEqual(1000)
    const total = Array.from({ length: THREAD_LOOKUP_ATTEMPTS - 1 }, (_, i) =>
      threadLookupDelayMs(i)
    ).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThan(3000)
  })
})
