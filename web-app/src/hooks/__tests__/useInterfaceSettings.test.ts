import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  MESSAGE_ZOOM_LEVELS,
  sanitizeMessageZoom,
  useInterfaceSettings,
} from '../useInterfaceSettings'

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
    expect(result.current.notificationPosition).toBe('top-right')
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
    expect(result.current.notificationPosition).toBe('top-right')
  })

  it('should update notification position', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    act(() => {
      result.current.setNotificationPosition('bottom-left')
    })

    expect(result.current.notificationPosition).toBe('bottom-left')
  })

  it('should ignore invalid notification position', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    act(() => {
      result.current.setNotificationPosition('bottom-left')
    })
    act(() => {
      result.current.setNotificationPosition('top-center' as any)
    })

    expect(result.current.notificationPosition).toBe('bottom-left')
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

  describe('message zoom', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useInterfaceSettings())
      act(() => {
        result.current.resetMessageZoom()
      })
    })

    it('defaults to 1', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      expect(result.current.messageZoom).toBe(1)
    })

    it('steps up and down through the zoom levels', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.zoomInMessages()
      })
      expect(result.current.messageZoom).toBe(1.1)

      act(() => {
        result.current.zoomInMessages()
      })
      expect(result.current.messageZoom).toBe(1.25)

      act(() => {
        result.current.zoomOutMessages()
      })
      expect(result.current.messageZoom).toBe(1.1)
    })

    it('clamps at the highest and lowest levels', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        MESSAGE_ZOOM_LEVELS.forEach(() => result.current.zoomInMessages())
      })
      expect(result.current.messageZoom).toBe(
        MESSAGE_ZOOM_LEVELS[MESSAGE_ZOOM_LEVELS.length - 1]
      )

      act(() => {
        MESSAGE_ZOOM_LEVELS.forEach(() => result.current.zoomOutMessages())
      })
      expect(result.current.messageZoom).toBe(MESSAGE_ZOOM_LEVELS[0])
    })

    it('is restored by resetInterface', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.zoomInMessages()
      })
      act(() => {
        result.current.resetInterface()
      })

      expect(result.current.messageZoom).toBe(1)
    })
  })

  describe('sanitizeMessageZoom', () => {
    it('keeps values that are valid zoom levels', () => {
      expect(sanitizeMessageZoom(1.25)).toBe(1.25)
    })

    it('snaps arbitrary values to the nearest level', () => {
      expect(sanitizeMessageZoom(1.2)).toBe(1.25)
      expect(sanitizeMessageZoom(5)).toBe(2)
      expect(sanitizeMessageZoom(0.1)).toBe(0.8)
    })

    it('falls back to 1 for non-numeric values', () => {
      expect(sanitizeMessageZoom(undefined)).toBe(1)
      expect(sanitizeMessageZoom(Number.NaN)).toBe(1)
      expect(sanitizeMessageZoom('1.5' as never)).toBe(1)
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
