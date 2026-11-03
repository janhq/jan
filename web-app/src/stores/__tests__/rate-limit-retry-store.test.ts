import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAX_RATE_LIMIT_RETRIES,
  useRateLimitRetry,
} from '../rate-limit-retry-store'

const store = () => useRateLimitRetry.getState()

describe('rate-limit retry store', () => {
  beforeEach(() => {
    useRateLimitRetry.setState({ reported: {}, attempts: {}, pending: {}, gaveUp: {} })
  })

  it('schedules a retry for the wait the rate-limited request reported', () => {
    store().report('t1', 30_000)

    expect(store().schedule('t1', 'm1', 1_000)).toBe('scheduled')
    expect(store().pending.t1).toEqual({ messageId: 'm1', retryAt: 31_000, attempt: 1 })
  })

  it('schedules nothing for a failure that was not a rate limit', () => {
    expect(store().schedule('t1', 'm1', 1_000)).toBe('none')
    expect(store().pending.t1).toBeUndefined()
  })

  it(`gives up after ${MAX_RATE_LIMIT_RETRIES} automatic retries in a row`, () => {
    for (let i = 1; i <= MAX_RATE_LIMIT_RETRIES; i++) {
      store().report('t1', 10_000)
      expect(store().schedule('t1', 'm1', 0)).toBe('scheduled')
      expect(store().take('t1')?.attempt).toBe(i)
    }
    store().report('t1', 10_000)

    expect(store().schedule('t1', 'm1', 0)).toBe('exhausted')
    expect(store().pending.t1).toBeUndefined()
    // Remembered, so the failure can keep saying why Jan stopped.
    expect(store().gaveUp.t1).toBe('m1')
    expect(store().schedule('t1', 'm1', 0)).toBe('none')
    expect(store().gaveUp.t1).toBe('m1')

    store().reset('t1')
    expect(store().gaveUp.t1).toBeUndefined()
  })

  it('counts again from zero once a reply succeeds', () => {
    store().report('t1', 10_000)
    store().schedule('t1', 'm1', 0)
    store().take('t1')

    store().reset('t1')
    store().report('t1', 10_000)

    expect(store().schedule('t1', 'm1', 0)).toBe('scheduled')
    expect(store().pending.t1?.attempt).toBe(1)
  })

  it('lets the user call a scheduled retry off', () => {
    store().report('t1', 10_000)
    store().schedule('t1', 'm1', 0)

    store().cancel('t1')

    expect(store().pending.t1).toBeUndefined()
    expect(store().take('t1')).toBeUndefined()
  })

  it('keeps threads apart', () => {
    store().report('t1', 10_000)

    expect(store().schedule('t2', 'm2', 0)).toBe('none')
    expect(store().schedule('t1', 'm1', 0)).toBe('scheduled')
  })
})
