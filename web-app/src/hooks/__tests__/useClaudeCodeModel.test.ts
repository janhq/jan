import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClaudeCodeModel } from '../useClaudeCodeModel'

describe('useClaudeCodeModel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should initialize with default values when localStorage is empty', () => {
    const { result } = renderHook(() => useClaudeCodeModel())

    expect(result.current.models).toEqual({
      big: null,
      medium: null,
      small: null,
      envVars: [],
      customCli: '',
    })
  })

  it('should load from localStorage on init', () => {
    const stored = {
      big: 'claude-opus',
      medium: 'claude-sonnet',
      small: 'claude-haiku',
      envVars: [{ key: 'API_KEY', value: 'test' }],
      customCli: '--verbose',
    }
    localStorage.setItem('claude-code-helper-models', JSON.stringify(stored))

    const { result } = renderHook(() => useClaudeCodeModel())

    expect(result.current.models.big).toBe('claude-opus')
    expect(result.current.models.medium).toBe('claude-sonnet')
    expect(result.current.models.small).toBe('claude-haiku')
    expect(result.current.models.envVars).toEqual([{ key: 'API_KEY', value: 'test' }])
    expect(result.current.models.customCli).toBe('--verbose')
  })

  it('should fall back to defaults for invalid localStorage data', () => {
    localStorage.setItem('claude-code-helper-models', 'not-json')

    const { result } = renderHook(() => useClaudeCodeModel())

    expect(result.current.models.big).toBeNull()
  })

  it('should fall back to defaults for incomplete localStorage data', () => {
    localStorage.setItem('claude-code-helper-models', JSON.stringify({ big: 'x' }))

    const { result } = renderHook(() => useClaudeCodeModel())

    // Missing required fields -> defaults
    expect(result.current.models.big).toBeNull()
  })

  it('should set a model by type', () => {
    const { result } = renderHook(() => useClaudeCodeModel())

    act(() => {
      result.current.setModel('big', 'claude-opus-4')
    })

    expect(result.current.models.big).toBe('claude-opus-4')
    expect(JSON.parse(localStorage.getItem('claude-code-helper-models')!).big).toBe('claude-opus-4')
  })

  it('should set model to null', () => {
    const { result } = renderHook(() => useClaudeCodeModel())

    act(() => {
      result.current.setModel('big', 'claude-opus')
    })
    act(() => {
      result.current.setModel('big', null)
    })

    expect(result.current.models.big).toBeNull()
  })

  it('should set env vars', () => {
    const { result } = renderHook(() => useClaudeCodeModel())

    const envVars = [
      { key: 'API_KEY', value: 'key123' },
      { key: 'DEBUG', value: 'true' },
    ]

    act(() => {
      result.current.setEnvVars(envVars)
    })

    expect(result.current.models.envVars).toEqual(envVars)
  })

  it('should set custom CLI', () => {
    const { result } = renderHook(() => useClaudeCodeModel())

    act(() => {
      result.current.setCustomCli('--model opus')
    })

    expect(result.current.models.customCli).toBe('--model opus')
  })

  it('should clear all models', () => {
    const { result } = renderHook(() => useClaudeCodeModel())

    act(() => {
      result.current.setModel('big', 'opus')
      result.current.setModel('medium', 'sonnet')
      result.current.setEnvVars([{ key: 'K', value: 'V' }])
      result.current.setCustomCli('--x')
    })

    act(() => {
      result.current.clearModels()
    })

    expect(result.current.models).toEqual({
      big: null,
      medium: null,
      small: null,
      envVars: [],
      customCli: '',
    })
  })

  it('should handle localStorage.setItem failure gracefully', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useClaudeCodeModel())

    act(() => {
      result.current.setModel('big', 'opus')
    })

    // State still updates even if storage fails
    expect(result.current.models.big).toBe('opus')

    spy.mockRestore()
    warnSpy.mockRestore()
  })
})
