import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLeftPanel } from '../useLeftPanel'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    LeftPanel: 'left-panel-settings',
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

describe('useLeftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    const store = useLeftPanel.getState()
    store.setLeftPanel(true)
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useLeftPanel())

    expect(result.current.open).toBe(true)
    expect(typeof result.current.setLeftPanel).toBe('function')
  })

  describe('setLeftPanel', () => {
    it('should open the left panel', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanel(true)
      })

      expect(result.current.open).toBe(true)
    })

    it('should close the left panel', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanel(false)
      })

      expect(result.current.open).toBe(false)
    })

    it('should toggle panel state multiple times', () => {
      const { result } = renderHook(() => useLeftPanel())

      const testSequence = [false, true, false, true, false]

      testSequence.forEach((open) => {
        act(() => {
          result.current.setLeftPanel(open)
        })

        expect(result.current.open).toBe(open)
      })
    })

    it('should handle setting the same value multiple times', () => {
      const { result } = renderHook(() => useLeftPanel())

      // Set to false multiple times
      act(() => {
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(false)
      })
      expect(result.current.open).toBe(false)

      // Set to true multiple times
      act(() => {
        result.current.setLeftPanel(true)
        result.current.setLeftPanel(true)
        result.current.setLeftPanel(true)
      })
      expect(result.current.open).toBe(true)
    })
  })

  describe('state persistence', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useLeftPanel())
      const { result: result2 } = renderHook(() => useLeftPanel())

      act(() => {
        result1.current.setLeftPanel(false)
      })

      expect(result2.current.open).toBe(false)

      act(() => {
        result2.current.setLeftPanel(true)
      })

      expect(result1.current.open).toBe(true)
      expect(result2.current.open).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle rapid state changes', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        // Rapid toggle
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(true)
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(true)
      })

      expect(result.current.open).toBe(true)
    })

    it('should preserve state type safety', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanel(false)
      })

      expect(typeof result.current.open).toBe('boolean')
      expect(result.current.open).toBe(false)

      act(() => {
        result.current.setLeftPanel(true)
      })

      expect(typeof result.current.open).toBe('boolean')
      expect(result.current.open).toBe(true)
    })
  })
})
