import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInterfaceSettings } from '../useInterfaceSettings'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingInterface: 'setting-appearance',
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
Object.defineProperty(global, 'IS_MACOS', { value: false, writable: true })
Object.defineProperty(global, 'IS_TAURI', { value: false, writable: true })
Object.defineProperty(global, 'IS_WEB_APP', { value: false, writable: true })

describe('useInterfaceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    expect(result.current.fontSize).toBe('16px')
    expect(result.current.accentColor).toBe('gray')
    expect(typeof result.current.setFontSize).toBe('function')
    expect(typeof result.current.setAccentColor).toBe('function')
    expect(typeof result.current.resetInterface).toBe('function')
  })

  it('should update font size', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    act(() => {
      result.current.setFontSize('18px')
    })

    expect(result.current.fontSize).toBe('18px')
  })

  describe('accent color', () => {
    it('should update accent color', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.setAccentColor('blue')
      })

      expect(result.current.accentColor).toBe('blue')
    })

    it('should not update for invalid accent color', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      // First reset to default state
      act(() => {
        result.current.resetInterface()
      })

      const currentColor = result.current.accentColor

      act(() => {
        result.current.setAccentColor('invalid' as any)
      })

      // Should remain unchanged
      expect(result.current.accentColor).toBe(currentColor)
    })
  })

  it('should reset interface settings to defaults', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    // Change some values first
    act(() => {
      result.current.setFontSize('18px')
      result.current.setAccentColor('blue')
    })

    // Reset
    act(() => {
      result.current.resetInterface()
    })

    expect(result.current.fontSize).toBe('16px')
    expect(result.current.accentColor).toBe('gray')
  })

  describe('Reset interface functionality', () => {
    beforeEach(() => {
      // Mock document.documentElement.style.setProperty
      Object.defineProperty(document.documentElement, 'style', {
        value: {
          setProperty: vi.fn(),
        },
        writable: true,
      })
    })

    it('should reset CSS variables when resetInterface is called', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.resetInterface()
      })

      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--font-size-base',
        '16px'
      )
    })
  })

  describe('Type checking', () => {
    it('should only accept valid font sizes', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      // These should work
      act(() => {
        result.current.setFontSize('14px')
      })
      expect(result.current.fontSize).toBe('14px')

      act(() => {
        result.current.setFontSize('16px')
      })
      expect(result.current.fontSize).toBe('16px')

      act(() => {
        result.current.setFontSize('18px')
      })
      expect(result.current.fontSize).toBe('18px')
    })
  })
})
