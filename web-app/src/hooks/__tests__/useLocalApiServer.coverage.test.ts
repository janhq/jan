import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Only mock fileStorage - don't mock zustand/middleware so real persist runs and coverage is tracked
vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}))

import { useLocalApiServer } from '../useLocalApiServer'

describe('useLocalApiServer - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const store = useLocalApiServer.getState()
    store.setDefaultModelLocalApiServer(null)
    store.setLastServerModels([])
    store.setEnableServerToolExecution(false)
  })

  it('should set default model for local api server', () => {
    const { result } = renderHook(() => useLocalApiServer())

    act(() => {
      result.current.setDefaultModelLocalApiServer({ model: 'llama-3', provider: 'llamacpp' })
    })

    expect(result.current.defaultModelLocalApiServer).toEqual({ model: 'llama-3', provider: 'llamacpp' })

    act(() => {
      result.current.setDefaultModelLocalApiServer(null)
    })

    expect(result.current.defaultModelLocalApiServer).toBeNull()
  })

  it('should set last server models', () => {
    const { result } = renderHook(() => useLocalApiServer())

    const models = [
      { model: 'm1', provider: 'p1' },
      { model: 'm2', provider: 'p2' },
    ]

    act(() => {
      result.current.setLastServerModels(models)
    })

    expect(result.current.lastServerModels).toEqual(models)
  })

  it('should toggle server tool execution', () => {
    const { result } = renderHook(() => useLocalApiServer())

    expect(result.current.enableServerToolExecution).toBe(false)

    act(() => {
      result.current.setEnableServerToolExecution(true)
    })

    expect(result.current.enableServerToolExecution).toBe(true)
  })
})
