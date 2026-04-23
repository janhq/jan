import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { agentMode: 'agent-mode' },
}))

import { useAgentMode } from '../useAgentMode'

describe('useAgentMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentMode.setState({ agentThreads: {} })
  })

  it('should initialize with empty agentThreads', () => {
    const { result } = renderHook(() => useAgentMode())
    expect(result.current.agentThreads).toEqual({})
  })

  it('isAgentMode should return false for unknown thread', () => {
    const { result } = renderHook(() => useAgentMode())
    expect(result.current.isAgentMode('unknown')).toBe(false)
  })

  it('isAgentMode should return true for enabled thread', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.setAgentMode('t1', true)
    })

    expect(result.current.isAgentMode('t1')).toBe(true)
  })

  it('isAgentMode should return false when explicitly set to false', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.setAgentMode('t1', false)
    })

    expect(result.current.isAgentMode('t1')).toBe(false)
  })

  it('toggleAgentMode should enable then disable', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.toggleAgentMode('t1')
    })
    expect(result.current.agentThreads['t1']).toBe(true)

    act(() => {
      result.current.toggleAgentMode('t1')
    })
    expect(result.current.agentThreads['t1']).toBe(false)
  })

  it('setAgentMode should set value', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.setAgentMode('t1', true)
    })
    expect(result.current.agentThreads['t1']).toBe(true)

    act(() => {
      result.current.setAgentMode('t1', false)
    })
    expect(result.current.agentThreads['t1']).toBe(false)
  })

  it('removeThread should remove the thread entry', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.setAgentMode('t1', true)
      result.current.setAgentMode('t2', true)
    })

    act(() => {
      result.current.removeThread('t1')
    })

    expect(result.current.agentThreads['t1']).toBeUndefined()
    expect(result.current.agentThreads['t2']).toBe(true)
  })

  it('clearAll should clear all threads', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.setAgentMode('t1', true)
      result.current.setAgentMode('t2', true)
      result.current.setAgentMode('t3', false)
    })

    act(() => {
      result.current.clearAll()
    })

    expect(result.current.agentThreads).toEqual({})
  })

  it('should handle multiple threads independently', () => {
    const { result } = renderHook(() => useAgentMode())

    act(() => {
      result.current.setAgentMode('t1', true)
      result.current.setAgentMode('t2', false)
      result.current.setAgentMode('t3', true)
    })

    expect(result.current.isAgentMode('t1')).toBe(true)
    expect(result.current.isAgentMode('t2')).toBe(false)
    expect(result.current.isAgentMode('t3')).toBe(true)
  })
})
