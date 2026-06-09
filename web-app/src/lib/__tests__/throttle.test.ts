import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rafThrottle, throttle } from '../throttle'

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('limits calls to the requested interval', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)

    throttled()
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('rafThrottle', () => {
  it('schedules at most one update per animation frame', () => {
    const rafCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    const fn = vi.fn()
    const throttled = rafThrottle(fn)

    throttled('a')
    throttled('b')
    throttled('c')

    expect(fn).not.toHaveBeenCalled()
    expect(rafCallbacks).toHaveLength(1)

    rafCallbacks[0](0)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')

    vi.unstubAllGlobals()
  })
})