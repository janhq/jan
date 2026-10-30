import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRateLimitRetry } from '@/stores/rate-limit-retry-store'
import { useRateLimitAutoRetry } from '../useRateLimitAutoRetry'

const store = () => useRateLimitRetry.getState()

const scheduleIn = (threadId: string, messageId: string, delayMs: number) => {
  act(() => {
    store().report(threadId, delayMs)
    store().schedule(threadId, messageId, Date.now())
  })
}

describe('useRateLimitAutoRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useRateLimitRetry.setState({ reported: {}, attempts: {}, pending: {}, gaveUp: {} })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('regenerates the failed message once the wait is over', () => {
    const retry = vi.fn()
    renderHook(() => useRateLimitAutoRetry('t1', retry, { status: 'error' }))

    scheduleIn('t1', 'm1', 30_000)
    act(() => vi.advanceTimersByTime(29_999))
    expect(retry).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(retry).toHaveBeenCalledWith('m1')
    expect(store().pending.t1).toBeUndefined()
  })

  it('does not retry once the user called it off', () => {
    const retry = vi.fn()
    renderHook(() => useRateLimitAutoRetry('t1', retry, { status: 'error' }))

    scheduleIn('t1', 'm1', 30_000)
    act(() => store().cancel('t1'))
    act(() => vi.advanceTimersByTime(60_000))

    expect(retry).not.toHaveBeenCalled()
  })

  it("ignores another thread's retry", () => {
    const retry = vi.fn()
    renderHook(() => useRateLimitAutoRetry('t1', retry, { status: 'error' }))

    scheduleIn('t2', 'm2', 1_000)
    act(() => vi.advanceTimersByTime(5_000))

    expect(retry).not.toHaveBeenCalled()
  })

  it('starts counting again after a reply succeeds', () => {
    const retry = vi.fn()
    const { rerender } = renderHook(
      ({ status }) => useRateLimitAutoRetry('t1', retry, { status }),
      { initialProps: { status: 'error' as const as string } }
    )
    scheduleIn('t1', 'm1', 1_000)
    act(() => vi.advanceTimersByTime(1_000))
    expect(store().attempts.t1).toBe(1)

    rerender({ status: 'streaming' })
    expect(store().attempts.t1).toBe(1)
    rerender({ status: 'ready' })

    expect(store().attempts.t1).toBeUndefined()
  })
})
