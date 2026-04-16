import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMobileScreen, useTabletScreen, useDesktopScreen, usePortrait, useLandscape, useTouchDevice } from '../useMediaQuery'

const mockMatchMedia = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockMatchMedia,
  })
  vi.clearAllMocks()
})

describe('useMediaQuery screen size hooks', () => {
  const setup = () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })

  it('useMobileScreen should query max-width: 640px', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => useMobileScreen())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 640px)')
  })

  it('useTabletScreen should query 641-1024px', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => useTabletScreen())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 641px) and (max-width: 1024px)')
  })

  it('useDesktopScreen should query min-width: 1025px', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => useDesktopScreen())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 1025px)')
  })

  it('usePortrait should query orientation: portrait', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => usePortrait())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(orientation: portrait)')
  })

  it('useLandscape should query orientation: landscape', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => useLandscape())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(orientation: landscape)')
  })

  it('useTouchDevice should query pointer: coarse', () => {
    mockMatchMedia.mockReturnValue(setup())
    const { result } = renderHook(() => useTouchDevice())
    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })
})
