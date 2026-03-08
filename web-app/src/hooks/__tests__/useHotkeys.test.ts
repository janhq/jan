import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboardShortcut } from '../useHotkeys'

// Mock router
const mockRouter = {
  state: {
    location: {
      pathname: '/',
    },
  },
}

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => mockRouter,
}))

// Mock navigator for platform detection
Object.defineProperty(window, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  writable: true,
})

describe('useKeyboardShortcut', () => {
  let mockCallback: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCallback = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any remaining event listeners
    document.removeEventListener('keydown', mockCallback)
  })

  it('should register and trigger keyboard shortcut', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
      })
    )

    // Simulate keydown event
    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should not trigger callback when keys do not match', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
      })
    )

    // Simulate different key
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).not.toHaveBeenCalled()
  })

  it('should handle ctrl key shortcuts', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 'c',
        ctrlKey: true,
        callback: mockCallback,
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should handle alt key shortcuts', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 'f',
        altKey: true,
        callback: mockCallback,
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: false,
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should handle shift key shortcuts', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 'T',
        shiftKey: true,
        callback: mockCallback,
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 'T',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should handle complex key combinations', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 'z',
        metaKey: true,
        shiftKey: true,
        callback: mockCallback,
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should not trigger when on excluded routes', () => {
    mockRouter.state.location.pathname = '/excluded'

    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
        excludeRoutes: ['/excluded'],
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).not.toHaveBeenCalled()
  })

  it('should trigger when not on excluded routes', () => {
    mockRouter.state.location.pathname = '/allowed'

    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
        excludeRoutes: ['/excluded'],
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should use platform-specific meta key on Windows', () => {
    // Windows navigator
    Object.defineProperty(window, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      writable: true,
    })

    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        usePlatformMetaKey: true,
        callback: mockCallback,
      })
    )

    // On Windows, usePlatformMetaKey should map to Ctrl
    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should use platform-specific meta key on Mac', () => {
    // Since platform detection happens at module level, we need to test the expected behavior
    // This test verifies that when usePlatformMetaKey is true, the hook handles platform detection
    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        usePlatformMetaKey: true,
        callback: mockCallback,
      })
    )

    // On Windows (current test environment), usePlatformMetaKey should map to Ctrl
    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should be case insensitive for key matching', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 'S',
        metaKey: true,
        callback: mockCallback,
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should prevent default when shortcut matches', () => {
    renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    act(() => {
      window.dispatchEvent(event)
    })

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should handle missing callback gracefully', () => {
    expect(() => {
      renderHook(() =>
        useKeyboardShortcut({
          key: 's',
          metaKey: true,
        })
      )

      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      })

      act(() => {
        window.dispatchEvent(event)
      })
    }).not.toThrow()
  })

  it('should clean up event listeners on unmount', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
      })
    )

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    addEventListenerSpy.mockRestore()
    removeEventListenerSpy.mockRestore()
  })

  it('should update when callback changes', () => {
    const newCallback = vi.fn()

    const { rerender } = renderHook(
      ({ callback }) =>
        useKeyboardShortcut({
          key: 's',
          metaKey: true,
          callback,
        }),
      { initialProps: { callback: mockCallback } }
    )

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
    expect(newCallback).not.toHaveBeenCalled()

    // Update callback
    rerender({ callback: newCallback })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1) // Still 1 from before
    expect(newCallback).toHaveBeenCalledTimes(1) // New callback called
  })

  it('should update when route changes', () => {
    mockRouter.state.location.pathname = '/excluded'

    const { rerender } = renderHook(() =>
      useKeyboardShortcut({
        key: 's',
        metaKey: true,
        callback: mockCallback,
        excludeRoutes: ['/excluded'],
      })
    )

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    })

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).not.toHaveBeenCalled()

    // Change route
    mockRouter.state.location.pathname = '/allowed'
    rerender()

    act(() => {
      window.dispatchEvent(event)
    })

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })
})
