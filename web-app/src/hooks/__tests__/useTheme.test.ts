import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { checkOSDarkMode, getInitialSystemDark } from '../useTheme'

// Mock Tauri API
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTheme: vi.fn().mockResolvedValue(undefined),
  }),
  Theme: {
    Dark: 'dark',
    Light: 'light',
  },
}))

// Mock localStorage
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    theme: 'theme',
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

describe('useTheme', () => {
  let originalMatchMedia: any

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock window.matchMedia
    originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn()
  })

  afterEach(() => {
    // Restore original matchMedia
    window.matchMedia = originalMatchMedia
  })

  describe('checkOSDarkMode', () => {
    it('should return true when OS prefers dark mode', () => {
      vi.mocked(window.matchMedia).mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any)

      const result = checkOSDarkMode()
      expect(result).toBe(true)
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    })

    it('should return false when OS prefers light mode', () => {
      vi.mocked(window.matchMedia).mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any)

      const result = checkOSDarkMode()
      expect(result).toBe(false)
    })

    it('should return falsy when matchMedia is not available', () => {
      const originalMatchMedia = window.matchMedia
      // @ts-ignore
      window.matchMedia = null

      const result = checkOSDarkMode()
      expect(result).toBeFalsy()
      
      // Restore
      window.matchMedia = originalMatchMedia
    })
  })

  describe('getInitialSystemDark', () => {
    afterEach(() => {
      delete window.__JAN_INITIAL_THEME__
    })

    it('prefers the backend-injected system value over matchMedia', () => {
      vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as any)
      window.__JAN_INITIAL_THEME__ = { activeTheme: 'auto', systemDark: true }
      expect(getInitialSystemDark()).toBe(true)

      vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as any)
      window.__JAN_INITIAL_THEME__ = { activeTheme: 'auto', systemDark: false }
      expect(getInitialSystemDark()).toBe(false)
    })

    it('falls back to matchMedia when the backend has no system value', () => {
      vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as any)
      window.__JAN_INITIAL_THEME__ = { activeTheme: 'auto', systemDark: null }
      expect(getInitialSystemDark()).toBe(true)
    })

    it('falls back to matchMedia when nothing was injected', () => {
      vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as any)
      expect(getInitialSystemDark()).toBe(true)
    })
  })

  describe('useTheme hook basic functionality', () => {
    beforeEach(() => {
      // Default to light mode
      vi.mocked(window.matchMedia).mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any)
    })

    it('should have the expected interface', async () => {
      const { useTheme } = await import('../useTheme')
      const { result } = renderHook(() => useTheme())

      expect(result.current).toHaveProperty('activeTheme')
      expect(result.current).toHaveProperty('isDark')
      expect(result.current).toHaveProperty('setTheme')
      expect(result.current).toHaveProperty('setIsDark')
      expect(typeof result.current.setTheme).toBe('function')
      expect(typeof result.current.setIsDark).toBe('function')
    })

    it('should initialize with auto theme', async () => {
      const { useTheme } = await import('../useTheme')
      const { result } = renderHook(() => useTheme())

      expect(result.current.activeTheme).toBe('auto')
      expect(typeof result.current.isDark).toBe('boolean')
    })

    it('should allow setting isDark directly', async () => {
      const { useTheme } = await import('../useTheme')
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.setIsDark(true)
      })

      expect(result.current.isDark).toBe(true)

      act(() => {
        result.current.setIsDark(false)
      })

      expect(result.current.isDark).toBe(false)
    })

    it('should handle theme changes', async () => {
      const { useTheme } = await import('../useTheme')
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      expect(result.current.activeTheme).toBe('dark')
      expect(result.current.isDark).toBe(true)

      await act(async () => {
        await result.current.setTheme('light')
      })

      expect(result.current.activeTheme).toBe('light')
      expect(result.current.isDark).toBe(false)
    })

    it('should handle auto theme with OS preference', async () => {
      // Mock OS dark preference
      vi.mocked(window.matchMedia).mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any)

      const { useTheme } = await import('../useTheme')
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('auto')
      })

      expect(result.current.activeTheme).toBe('auto')
      expect(result.current.isDark).toBe(true)
    })

    it('should handle auto theme with light OS preference', async () => {
      // Mock OS light preference
      vi.mocked(window.matchMedia).mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any)

      const { useTheme } = await import('../useTheme')
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('auto')
      })

      expect(result.current.activeTheme).toBe('auto')
      expect(result.current.isDark).toBe(false)
    })
  })
})
