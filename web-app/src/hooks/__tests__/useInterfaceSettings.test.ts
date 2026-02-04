<<<<<<< HEAD
﻿import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInterfaceSettings } from '../useInterfaceSettings'
import { THREAD_SCROLL_BEHAVIOR } from '@/constants/threadScroll'
=======
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInterfaceSettings } from '../useInterfaceSettings'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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

<<<<<<< HEAD
    expect(result.current.fontSize).toBe('15px')
    expect(result.current.chatWidth).toBe('compact')
    expect(result.current.appBgColor).toEqual({
      r: 25,
      g: 25,
      b: 25,
      a: 1,
    })
    expect(result.current.threadScrollBehavior).toBe(THREAD_SCROLL_BEHAVIOR.FLOW)
    expect(typeof result.current.setThreadScrollBehavior).toBe('function')
=======
    expect(result.current.fontSize).toBe('16px')
    expect(result.current.accentColor).toBe('gray')
    expect(typeof result.current.setFontSize).toBe('function')
    expect(typeof result.current.setAccentColor).toBe('function')
    expect(typeof result.current.resetInterface).toBe('function')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('should update font size', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    act(() => {
      result.current.setFontSize('18px')
    })

    expect(result.current.fontSize).toBe('18px')
  })

<<<<<<< HEAD
  it('should update chat width', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    act(() => {
      result.current.setChatWidth('full')
    })

    expect(result.current.chatWidth).toBe('full')
  })

  describe('thread scroll behavior', () => {
    it('should update to sticky mode', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.setThreadScrollBehavior(THREAD_SCROLL_BEHAVIOR.STICKY)
      })

      expect(result.current.threadScrollBehavior).toBe(
        THREAD_SCROLL_BEHAVIOR.STICKY
      )
    })

    it('should fall back to default for invalid values', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.setThreadScrollBehavior('invalid' as any)
      })

      expect(result.current.threadScrollBehavior).toBe(
        THREAD_SCROLL_BEHAVIOR.FLOW
      )
    })
  })

  it('should update app background color', () => {
    const { result } = renderHook(() => useInterfaceSettings())
    const newColor = { r: 100, g: 100, b: 100, a: 1 }

    act(() => {
      result.current.setAppBgColor(newColor)
    })

    expect(result.current.appBgColor).toEqual(newColor)
  })

  it('should update main view background color', () => {
    const { result } = renderHook(() => useInterfaceSettings())
    const newColor = { r: 200, g: 200, b: 200, a: 1 }

    act(() => {
      result.current.setAppMainViewBgColor(newColor)
    })

    expect(result.current.appMainViewBgColor).toEqual(newColor)
  })

  it('should update primary background color', () => {
    const { result } = renderHook(() => useInterfaceSettings())
    const newColor = { r: 50, g: 100, b: 150, a: 1 }

    act(() => {
      result.current.setAppPrimaryBgColor(newColor)
    })

    expect(result.current.appPrimaryBgColor).toEqual(newColor)
  })

  it('should update accent background color', () => {
    const { result } = renderHook(() => useInterfaceSettings())
    const newColor = { r: 255, g: 100, b: 50, a: 1 }

    act(() => {
      result.current.setAppAccentBgColor(newColor)
    })

    expect(result.current.appAccentBgColor).toEqual(newColor)
  })

  it('should update destructive background color', () => {
    const { result } = renderHook(() => useInterfaceSettings())
    const newColor = { r: 255, g: 0, b: 0, a: 1 }

    act(() => {
      result.current.setAppDestructiveBgColor(newColor)
    })

    expect(result.current.appDestructiveBgColor).toEqual(newColor)
  })

=======
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

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  it('should reset interface settings to defaults', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    // Change some values first
    act(() => {
      result.current.setFontSize('18px')
<<<<<<< HEAD
      result.current.setChatWidth('full')
      result.current.setAppBgColor({ r: 100, g: 100, b: 100, a: 1 })
=======
      result.current.setAccentColor('blue')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    // Reset
    act(() => {
      result.current.resetInterface()
    })

<<<<<<< HEAD
    expect(result.current.fontSize).toBe('15px')
    // Note: resetInterface doesn't reset chatWidth, only visual properties
    expect(result.current.chatWidth).toBe('full')
    expect(result.current.appBgColor).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    })
  })


  describe('Platform-specific behavior', () => {
    it('should use alpha 1 for web environments', () => {
      Object.defineProperty(global, 'IS_WEB_APP', { value: false })
      Object.defineProperty(global, 'IS_WINDOWS', { value: true })
      
      const { result } = renderHook(() => useInterfaceSettings())
      
      expect(result.current.appBgColor.a).toBe(1)
    })
  })


=======
    expect(result.current.fontSize).toBe('16px')
    expect(result.current.accentColor).toBe('gray')
  })

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
      
      act(() => {
        result.current.resetInterface()
      })
      
      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--font-size-base',
        '15px'
      )
      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--app-bg',
        expect.any(String)
      )
      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--app-main-view',
        expect.any(String)
      )
    })
  })


  describe('Color manipulation', () => {
    it('should handle color updates with CSS variable setting', () => {
      // Mock document.documentElement.style.setProperty
      const setPropertySpy = vi.fn()
      Object.defineProperty(document.documentElement, 'style', {
        value: {
          setProperty: setPropertySpy,
        },
        writable: true,
      })

      const { result } = renderHook(() => useInterfaceSettings())
      const testColor = { r: 128, g: 64, b: 192, a: 0.8 }

      act(() => {
        result.current.setAppBgColor(testColor)
      })

      // In web environment (IS_TAURI=false), alpha is forced to 1
      expect(result.current.appBgColor).toEqual({ ...testColor, a: 1 })
    })

    it('should handle transparent colors', () => {
      const { result } = renderHook(() => useInterfaceSettings())
      const transparentColor = { r: 100, g: 100, b: 100, a: 0 }

      act(() => {
        result.current.setAppAccentBgColor(transparentColor)
      })

      expect(result.current.appAccentBgColor).toEqual(transparentColor)
    })

    it('should preserve alpha when blur is supported (macOS)', () => {
      // Mock macOS environment
      Object.defineProperty(global, 'IS_MACOS', { value: true, writable: true })
      Object.defineProperty(global, 'IS_TAURI', { value: true, writable: true })
      Object.defineProperty(global, 'IS_WINDOWS', { value: false, writable: true })
      Object.defineProperty(global, 'IS_LINUX', { value: false, writable: true })

      const setPropertySpy = vi.fn()
      Object.defineProperty(document.documentElement, 'style', {
        value: {
          setProperty: setPropertySpy,
        },
        writable: true,
      })

      const { result } = renderHook(() => useInterfaceSettings())
      const testColor = { r: 128, g: 64, b: 192, a: 0.5 }

      act(() => {
        result.current.setAppBgColor(testColor)
      })

      // On macOS with Tauri, alpha should be preserved
      expect(result.current.appBgColor).toEqual(testColor)

      // Reset for other tests
      Object.defineProperty(global, 'IS_MACOS', { value: false, writable: true })
      Object.defineProperty(global, 'IS_TAURI', { value: false, writable: true })
    })
  })

  describe('Edge cases', () => {
    it('should handle invalid color values gracefully', () => {
      const { result } = renderHook(() => useInterfaceSettings())
      const invalidColor = { r: -10, g: 300, b: 128, a: 2 }
      
      act(() => {
        result.current.setAppPrimaryBgColor(invalidColor)
      })
      
      expect(result.current.appPrimaryBgColor).toEqual(invalidColor)
=======

      act(() => {
        result.current.resetInterface()
      })

      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--font-size-base',
        '16px'
      )
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })
  })

  describe('Type checking', () => {
    it('should only accept valid font sizes', () => {
      const { result } = renderHook(() => useInterfaceSettings())
<<<<<<< HEAD
      
=======

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      // These should work
      act(() => {
        result.current.setFontSize('14px')
      })
      expect(result.current.fontSize).toBe('14px')
<<<<<<< HEAD
      
      act(() => {
        result.current.setFontSize('15px')
      })
      expect(result.current.fontSize).toBe('15px')
      
=======

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      act(() => {
        result.current.setFontSize('16px')
      })
      expect(result.current.fontSize).toBe('16px')
<<<<<<< HEAD
      
=======

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      act(() => {
        result.current.setFontSize('18px')
      })
      expect(result.current.fontSize).toBe('18px')
    })
<<<<<<< HEAD

    it('should only accept valid chat widths', () => {
      const { result } = renderHook(() => useInterfaceSettings())
      
      act(() => {
        result.current.setChatWidth('full')
      })
      expect(result.current.chatWidth).toBe('full')
      
      act(() => {
        result.current.setChatWidth('compact')
      })
      expect(result.current.chatWidth).toBe('compact')
    })
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })
})
