import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useCodexSettings } from '../useCodexSettings'

describe('useCodexSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes with defaults when storage is empty', () => {
    const { result } = renderHook(() => useCodexSettings())

    expect(result.current.settings).toEqual({ model: null })
  })

  it('loads the saved model from storage', () => {
    localStorage.setItem('codex-helper-settings', JSON.stringify({ model: 'jan-nano' }))

    const { result } = renderHook(() => useCodexSettings())

    expect(result.current.settings.model).toBe('jan-nano')
  })

  it('persists a selected model', () => {
    const { result } = renderHook(() => useCodexSettings())

    act(() => {
      result.current.setModel('jan-pro')
    })

    expect(result.current.settings.model).toBe('jan-pro')
    expect(JSON.parse(localStorage.getItem('codex-helper-settings')!).model).toBe('jan-pro')
  })

  it('clears settings', () => {
    const { result } = renderHook(() => useCodexSettings())

    act(() => {
      result.current.setModel('jan-pro')
    })

    act(() => {
      result.current.clearSettings()
    })

    expect(result.current.settings).toEqual({ model: null })
  })
})