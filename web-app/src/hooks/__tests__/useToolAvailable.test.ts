import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolAvailable, createToolKey } from '../useToolAvailable'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolAvailability: 'tool-availability-settings',
  },
}))

// Mock zustand persist to a passthrough so the store is fully in-memory.
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

const SERVER = 'exa'
const TOOL = 'web_search_exa'
const KEY = createToolKey(SERVER, TOOL)

describe('useToolAvailable (global tool availability)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToolAvailable.setState({ disabledTools: [], defaultsInitialized: false })
  })

  it('initializes with an empty global disabled set', () => {
    const { result } = renderHook(() => useToolAvailable())
    expect(result.current.disabledTools).toEqual([])
    expect(typeof result.current.setToolDisabled).toBe('function')
    expect(typeof result.current.isToolDisabled).toBe('function')
    expect(typeof result.current.getDisabledTools).toBe('function')
    expect(typeof result.current.setDisabledTools).toBe('function')
  })

  it('createToolKey builds a server::tool composite key', () => {
    expect(createToolKey('s', 't')).toBe('s::t')
  })

  describe('setToolDisabled', () => {
    it('disables a tool globally', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => result.current.setToolDisabled(SERVER, TOOL, false))
      expect(result.current.disabledTools).toEqual([KEY])
      expect(result.current.isToolDisabled(SERVER, TOOL)).toBe(true)
    })

    it('re-enables a disabled tool', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => result.current.setToolDisabled(SERVER, TOOL, false))
      act(() => result.current.setToolDisabled(SERVER, TOOL, true))
      expect(result.current.disabledTools).toEqual([])
      expect(result.current.isToolDisabled(SERVER, TOOL)).toBe(false)
    })

    it('does not duplicate an already-disabled tool', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => result.current.setToolDisabled(SERVER, TOOL, false))
      act(() => result.current.setToolDisabled(SERVER, TOOL, false))
      expect(result.current.disabledTools).toEqual([KEY])
    })

    it('enabling a tool that was never disabled is a no-op', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => result.current.setToolDisabled(SERVER, TOOL, true))
      expect(result.current.disabledTools).toEqual([])
    })

    it('tracks multiple tools independently', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => {
        result.current.setToolDisabled(SERVER, 'a', false)
        result.current.setToolDisabled(SERVER, 'b', false)
      })
      expect(result.current.disabledTools).toEqual([
        createToolKey(SERVER, 'a'),
        createToolKey(SERVER, 'b'),
      ])
      act(() => result.current.setToolDisabled(SERVER, 'a', true))
      expect(result.current.disabledTools).toEqual([createToolKey(SERVER, 'b')])
    })
  })

  describe('isToolDisabled / getDisabledTools', () => {
    it('a tool absent from the set is enabled', () => {
      const { result } = renderHook(() => useToolAvailable())
      expect(result.current.isToolDisabled(SERVER, TOOL)).toBe(false)
    })

    it('getDisabledTools returns the global array', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => result.current.setDisabledTools([KEY]))
      expect(result.current.getDisabledTools()).toEqual([KEY])
    })
  })

  describe('setDisabledTools (defaults seed)', () => {
    it('replaces the whole set', () => {
      const { result } = renderHook(() => useToolAvailable())
      act(() => result.current.setDisabledTools(['a::1', 'b::2']))
      expect(result.current.disabledTools).toEqual(['a::1', 'b::2'])
      act(() => result.current.setDisabledTools([]))
      expect(result.current.disabledTools).toEqual([])
    })
  })

  describe('defaults-initialized flag', () => {
    it('starts false and flips once marked', () => {
      const { result } = renderHook(() => useToolAvailable())
      expect(result.current.isDefaultsInitialized()).toBe(false)
      act(() => result.current.markDefaultsAsInitialized())
      expect(result.current.isDefaultsInitialized()).toBe(true)
    })
  })

  it('shares one global set across hook instances (no per-thread split)', () => {
    const a = renderHook(() => useToolAvailable())
    const b = renderHook(() => useToolAvailable())
    act(() => a.result.current.setToolDisabled(SERVER, TOOL, false))
    expect(b.result.current.isToolDisabled(SERVER, TOOL)).toBe(true)
  })
})
