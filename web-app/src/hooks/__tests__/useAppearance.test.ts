import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppearance } from '../useAppearance'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    appearance: 'appearance',
  },
}))

vi.mock('../useTheme', () => ({
  useTheme: {
    getState: vi.fn(() => ({ isDark: false })),
    setState: vi.fn(),
    subscribe: vi.fn(),
    destroy: vi.fn(),
  },
}))

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

// Mock global constants
Object.defineProperty(global, 'IS_WINDOWS', { value: false, writable: true })
Object.defineProperty(global, 'IS_LINUX', { value: false, writable: true })
Object.defineProperty(global, 'IS_TAURI', { value: false, writable: true })

describe('useAppearance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useAppearance())

    expect(result.current.fontSize).toBe('15px')
    expect(result.current.chatWidth).toBe('compact')
    expect(result.current.appBgColor).toEqual({
      r: 25,
      g: 25,
      b: 25,
      a: 1,
    })
  })

  it('should update font size', () => {
    const { result } = renderHook(() => useAppearance())

    act(() => {
      result.current.setFontSize('18px')
    })

    expect(result.current.fontSize).toBe('18px')
  })

  it('should update chat width', () => {
    const { result } = renderHook(() => useAppearance())

    act(() => {
      result.current.setChatWidth('full')
    })

    expect(result.current.chatWidth).toBe('full')
  })

  it('should update app background color', () => {
    const { result } = renderHook(() => useAppearance())
    const newColor = { r: 100, g: 100, b: 100, a: 1 }

    act(() => {
      result.current.setAppBgColor(newColor)
    })

    expect(result.current.appBgColor).toEqual(newColor)
  })

  it('should update main view background color', () => {
    const { result } = renderHook(() => useAppearance())
    const newColor = { r: 200, g: 200, b: 200, a: 1 }

    act(() => {
      result.current.setAppMainViewBgColor(newColor)
    })

    expect(result.current.appMainViewBgColor).toEqual(newColor)
  })

  it('should update primary background color', () => {
    const { result } = renderHook(() => useAppearance())
    const newColor = { r: 50, g: 100, b: 150, a: 1 }

    act(() => {
      result.current.setAppPrimaryBgColor(newColor)
    })

    expect(result.current.appPrimaryBgColor).toEqual(newColor)
  })

  it('should update accent background color', () => {
    const { result } = renderHook(() => useAppearance())
    const newColor = { r: 255, g: 100, b: 50, a: 1 }

    act(() => {
      result.current.setAppAccentBgColor(newColor)
    })

    expect(result.current.appAccentBgColor).toEqual(newColor)
  })

  it('should update destructive background color', () => {
    const { result } = renderHook(() => useAppearance())
    const newColor = { r: 255, g: 0, b: 0, a: 1 }

    act(() => {
      result.current.setAppDestructiveBgColor(newColor)
    })

    expect(result.current.appDestructiveBgColor).toEqual(newColor)
  })

  it('should reset appearance to defaults', () => {
    const { result } = renderHook(() => useAppearance())

    // Change some values first
    act(() => {
      result.current.setFontSize('18px')
      result.current.setChatWidth('full')
      result.current.setAppBgColor({ r: 100, g: 100, b: 100, a: 1 })
    })

    // Reset
    act(() => {
      result.current.resetAppearance()
    })

    expect(result.current.fontSize).toBe('15px')
    // Note: resetAppearance doesn't reset chatWidth, only visual properties
    expect(result.current.chatWidth).toBe('full')
    expect(result.current.appBgColor).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    })
  })

  it('should have correct text colors for contrast', () => {
    const { result } = renderHook(() => useAppearance())

    // Light background should have dark text
    act(() => {
      result.current.setAppMainViewBgColor({ r: 255, g: 255, b: 255, a: 1 })
    })

    expect(result.current.appMainViewTextColor).toBe('#000')

    // Dark background should have light text
    act(() => {
      result.current.setAppMainViewBgColor({ r: 0, g: 0, b: 0, a: 1 })
    })

    expect(result.current.appMainViewTextColor).toBe('#FFF')
  })
})