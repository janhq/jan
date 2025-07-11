import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from '../useMediaQuery'

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

  it('should handle matchMedia not being available', () => {
    // @ts-ignore
    delete window.matchMedia

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(false)
  })
})