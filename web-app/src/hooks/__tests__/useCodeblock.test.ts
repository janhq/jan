import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeblock, CodeBlockStyle } from '../useCodeblock'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingCodeBlock: 'codeblock-settings',
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

describe('useCodeblock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    const store = useCodeblock.getState()
    store.resetCodeBlockStyle()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useCodeblock())

    expect(result.current.codeBlockStyle).toBe('github-light')
    expect(result.current.showLineNumbers).toBe(true)
  })

  it('should set code block style', () => {
    const { result } = renderHook(() => useCodeblock())

    act(() => {
      result.current.setCodeBlockStyle('github-dark')
    })

    expect(result.current.codeBlockStyle).toBe('github-dark')
  })

  it('should set show line numbers', () => {
    const { result } = renderHook(() => useCodeblock())

    act(() => {
      result.current.setShowLineNumbers(false)
    })

    expect(result.current.showLineNumbers).toBe(false)

    act(() => {
      result.current.setShowLineNumbers(true)
    })

    expect(result.current.showLineNumbers).toBe(true)
  })

  it('should reset code block style to defaults', () => {
    const { result } = renderHook(() => useCodeblock())

    // First change the values
    act(() => {
      result.current.setCodeBlockStyle('monokai')
      result.current.setShowLineNumbers(false)
    })

    expect(result.current.codeBlockStyle).toBe('monokai')
    expect(result.current.showLineNumbers).toBe(false)

    // Reset to defaults
    act(() => {
      result.current.resetCodeBlockStyle()
    })

    expect(result.current.codeBlockStyle).toBe('github-light')
    expect(result.current.showLineNumbers).toBe(true)
  })

  it('should handle different code block styles', () => {
    const { result } = renderHook(() => useCodeblock())

    const testStyles: CodeBlockStyle[] = [
      'github-light',
      'github-dark',
      'vsc-dark-plus',
      'monokai',
      'atom-one-dark',
    ]

    testStyles.forEach((style) => {
      act(() => {
        result.current.setCodeBlockStyle(style)
      })

      expect(result.current.codeBlockStyle).toBe(style)
    })
  })

  it('should maintain state across multiple hook instances', () => {
    const { result: result1 } = renderHook(() => useCodeblock())
    const { result: result2 } = renderHook(() => useCodeblock())

    act(() => {
      result1.current.setCodeBlockStyle('custom-theme')
      result1.current.setShowLineNumbers(false)
    })

    expect(result2.current.codeBlockStyle).toBe('custom-theme')
    expect(result2.current.showLineNumbers).toBe(false)
  })

  it('should handle empty string style', () => {
    const { result } = renderHook(() => useCodeblock())

    act(() => {
      result.current.setCodeBlockStyle('')
    })

    expect(result.current.codeBlockStyle).toBe('')
  })

  it('should preserve line numbers when changing style', () => {
    const { result } = renderHook(() => useCodeblock())

    act(() => {
      result.current.setShowLineNumbers(false)
      result.current.setCodeBlockStyle('new-theme')
    })

    expect(result.current.showLineNumbers).toBe(false)
    expect(result.current.codeBlockStyle).toBe('new-theme')
  })

  it('should preserve style when changing line numbers', () => {
    const { result } = renderHook(() => useCodeblock())

    act(() => {
      result.current.setCodeBlockStyle('preserved-theme')
      result.current.setShowLineNumbers(false)
    })

    expect(result.current.codeBlockStyle).toBe('preserved-theme')
    expect(result.current.showLineNumbers).toBe(false)
  })
})
