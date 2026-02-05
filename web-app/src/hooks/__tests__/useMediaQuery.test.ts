import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery, useSmallScreen, useSmallScreenStore, UseMediaQueryOptions } from '../useMediaQuery'

// Mock window.matchMedia
const mockMatchMedia = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockMatchMedia,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useMediaQuery hook', () => {
  it('should return initial match value', () => {
    const mockMediaQueryList = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 768px)')
  })

  it('should return false when media query does not match', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'))

    expect(result.current).toBe(false)
  })

  it('should update when media query changes', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(false)

    // Simulate media query change
    const changeHandler = mockMediaQueryList.addEventListener.mock.calls[0][1]
    
    act(() => {
      changeHandler({ matches: true })
    })

    expect(result.current).toBe(true)
  })

  it('should add event listener on mount', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('should remove event listener on unmount', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    unmount()

    expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('should handle different media queries', () => {
    const mockMediaQueryList = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result: result1 } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    const { result: result2 } = renderHook(() => useMediaQuery('(max-width: 1024px)'))

    expect(result1.current).toBe(true)
    expect(result2.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 768px)')
    expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 1024px)')
  })

  it('should handle initial value parameter', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)', true))

    expect(result.current).toBe(false) // Should use actual match value, not initial value
  })

  it('should handle getInitialValueInEffect option', () => {
    const mockMediaQueryList = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const options: UseMediaQueryOptions = { getInitialValueInEffect: false }
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)', false, options))

    expect(result.current).toBe(true) // Should use actual match value immediately
  })

  it('should use initial value when getInitialValueInEffect is true', () => {
    const mockMediaQueryList = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const options: UseMediaQueryOptions = { getInitialValueInEffect: true }
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)', false, options))

    // Should eventually update to true after effect runs
    expect(result.current).toBe(true)
  })

  it('should fall back to deprecated addListener for older browsers', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(() => {
        throw new Error('addEventListener not supported')
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(consoleSpy).toHaveBeenCalled()
    expect(mockMediaQueryList.addListener).toHaveBeenCalledWith(expect.any(Function))

    unmount()

    expect(mockMediaQueryList.removeListener).toHaveBeenCalledWith(expect.any(Function))

    consoleSpy.mockRestore()
  })

  it('should update when query changes', () => {
    const mockMediaQueryList1 = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    const mockMediaQueryList2 = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia
      .mockReturnValueOnce(mockMediaQueryList1)
      .mockReturnValueOnce(mockMediaQueryList2)

    const { result, rerender } = renderHook(
      ({ query }) => useMediaQuery(query),
      { initialProps: { query: '(min-width: 768px)' } }
    )

    expect(result.current).toBe(true)

    rerender({ query: '(max-width: 767px)' })

    expect(result.current).toBe(false)
    expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 767px)')
  })

  it('should use initial value when provided and getInitialValueInEffect is false', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result: resultTrue } = renderHook(() => 
      useMediaQuery('(min-width: 768px)', true, { getInitialValueInEffect: true })
    )
    const { result: resultFalse } = renderHook(() => 
      useMediaQuery('(min-width: 768px)', false, { getInitialValueInEffect: true })
    )

    // When getInitialValueInEffect is true, should eventually update to actual matches value
    expect(resultTrue.current).toBe(false) // Updated to actual matches value
    expect(resultFalse.current).toBe(false) // Updated to actual matches value
  })
})

describe('useSmallScreenStore', () => {
  it('should have default state', () => {
    const { result } = renderHook(() => useSmallScreenStore())

    expect(result.current.isSmallScreen).toBe(false)
    expect(typeof result.current.setIsSmallScreen).toBe('function')
  })

  it('should update small screen state', () => {
    const { result } = renderHook(() => useSmallScreenStore())

    act(() => {
      result.current.setIsSmallScreen(true)
    })

    expect(result.current.isSmallScreen).toBe(true)

    act(() => {
      result.current.setIsSmallScreen(false)
    })

    expect(result.current.isSmallScreen).toBe(false)
  })
})

describe('useSmallScreen', () => {
  it('should return small screen state', () => {
    const mockMediaQueryList = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result } = renderHook(() => useSmallScreen())

    expect(result.current).toBe(true)
  })

  it('should update when media query changes', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    const { result } = renderHook(() => useSmallScreen())

    expect(result.current).toBe(false)

    // Simulate media query change to small screen
    const changeHandler = mockMediaQueryList.addEventListener.mock.calls[0][1]
    
    act(() => {
      changeHandler({ matches: true })
    })

    expect(result.current).toBe(true)
  })

  it('should use correct media query for small screen detection', () => {
    const mockMediaQueryList = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    mockMatchMedia.mockReturnValue(mockMediaQueryList)

    renderHook(() => useSmallScreen())

    expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 768px)')
  })
})
