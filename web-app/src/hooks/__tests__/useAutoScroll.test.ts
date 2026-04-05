import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useAutoScroll } from '../useAutoScroll'

describe('useAutoScroll', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    // jsdom doesn't compute layout, so we stub the scroll properties
    Object.defineProperty(container, 'scrollHeight', {
      value: 500,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 200,
      writable: true,
      configurable: true,
    })
  })

  it('should return all expected properties', () => {
    const { result } = renderHook(() => useAutoScroll())

    expect(result.current.containerRef).toBeDefined()
    expect(result.current.isAtBottom).toBe(true)
    expect(typeof result.current.handleScroll).toBe('function')
    expect(typeof result.current.scrollToBottom).toBe('function')
    expect(typeof result.current.forceScrollToBottom).toBe('function')
    expect(typeof result.current.reset).toBe('function')
  })

  it('should auto-scroll to bottom by default (stuck state)', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    act(() => {
      result.current.scrollToBottom()
    })

    expect(container.scrollTop).toBe(500)
    expect(result.current.isAtBottom).toBe(true)
  })

  it('should NOT auto-scroll when user has scrolled away from the bottom', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    // Simulate user scrolling to somewhere in the middle (not at bottom)
    // scrollHeight=500, clientHeight=200, scrollTop=100 => distFromBottom=200
    container.scrollTop = 100

    act(() => {
      result.current.handleScroll()
    })

    expect(result.current.isAtBottom).toBe(false)

    container.scrollTop = 100

    act(() => {
      result.current.scrollToBottom()
    })

    // Should remain at 100, not jump to 500
    expect(container.scrollTop).toBe(100)
  })

  it('should resume auto-scroll when user scrolls back to bottom', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    // User scrolls away
    container.scrollTop = 100
    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.isAtBottom).toBe(false)

    // User scrolls back to bottom (scrollHeight - scrollTop - clientHeight <= 20)
    container.scrollTop = 290 // 500 - 290 - 200 = 10, which is <= 20
    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.isAtBottom).toBe(true)

    act(() => {
      result.current.scrollToBottom()
    })

    expect(container.scrollTop).toBe(500)
  })

  it('should re-enable auto-scroll on reset()', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    // User scrolls away
    container.scrollTop = 50
    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.isAtBottom).toBe(false)

    // Verify auto-scroll is paused
    container.scrollTop = 50
    act(() => {
      result.current.scrollToBottom()
    })
    expect(container.scrollTop).toBe(50)

    // Reset (as if a new streaming session started)
    act(() => {
      result.current.reset()
    })
    expect(result.current.isAtBottom).toBe(true)

    act(() => {
      result.current.scrollToBottom()
    })

    expect(container.scrollTop).toBe(500)
  })

  it('should treat positions within the threshold as "at bottom"', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    // Position within the 20px threshold: 500 - 285 - 200 = 15, <= 20
    container.scrollTop = 285
    act(() => {
      result.current.handleScroll()
    })

    expect(result.current.isAtBottom).toBe(true)

    act(() => {
      result.current.scrollToBottom()
    })

    expect(container.scrollTop).toBe(500)
  })

  it('should treat positions just beyond the threshold as "scrolled away"', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    // Position just beyond threshold: 500 - 279 - 200 = 21, > 20
    container.scrollTop = 279
    act(() => {
      result.current.handleScroll()
    })

    expect(result.current.isAtBottom).toBe(false)

    container.scrollTop = 279
    act(() => {
      result.current.scrollToBottom()
    })

    // Should NOT auto-scroll
    expect(container.scrollTop).toBe(279)
  })

  it('should force-scroll to bottom regardless of stuck state', () => {
    const { result } = renderHook(() => useAutoScroll())

    Object.defineProperty(result.current.containerRef, 'current', {
      value: container,
      writable: true,
    })

    // User scrolls away
    container.scrollTop = 100
    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.isAtBottom).toBe(false)

    // Normal scrollToBottom should be a no-op
    container.scrollTop = 100
    act(() => {
      result.current.scrollToBottom()
    })
    expect(container.scrollTop).toBe(100)

    // forceScrollToBottom ignores stuck state
    act(() => {
      result.current.forceScrollToBottom()
    })
    expect(container.scrollTop).toBe(500)
    expect(result.current.isAtBottom).toBe(true)
  })

  it('should be a no-op when containerRef has no element', () => {
    const { result } = renderHook(() => useAutoScroll())

    // containerRef.current is null by default — nothing should throw
    expect(() => {
      act(() => {
        result.current.handleScroll()
        result.current.scrollToBottom()
        result.current.forceScrollToBottom()
        result.current.reset()
      })
    }).not.toThrow()
  })
})
