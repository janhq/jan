import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState } from '../useAppState'

// Mock the useAssistant hook
vi.mock('../useAssistant', () => ({
  useAssistant: Object.assign(
    vi.fn(() => ({
      selectedAssistant: null,
      updateAssistantTools: vi.fn()
    })),
    {
      getState: vi.fn(() => ({
        currentAssistant: { id: 'test-assistant', name: 'Test Assistant' },
        assistants: [{ id: 'test-assistant', name: 'Test Assistant' }]
      }))
    }
  )
}))

describe('Token Speed Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    
    act(() => {
      useAppState.setState({
        streamingContent: undefined,
        loadingModel: false,
        tools: [],
        serverStatus: 'stopped',
        abortControllers: {},
        tokenSpeed: undefined,
        currentToolCall: undefined,
        showOutOfContextDialog: false
      })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle negative increment gracefully', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, -1)
    })

    expect(result.current.tokenSpeed?.tokenCount).toBe(-1)
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(0)
  })

  it('should handle zero increment', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 0)
    })

    expect(result.current.tokenSpeed?.tokenCount).toBe(0)
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(0)
  })

  it('should handle very large increments', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 1000000)
    })

    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.updateTokenSpeed(message, 1000000)
    })

    expect(result.current.tokenSpeed?.tokenCount).toBe(2000000)
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(2000000) // 2M tokens in 1 second
  })

  it('should handle fractional increments', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 0.5)
    })

    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.updateTokenSpeed(message, 0.5)
    })

    expect(result.current.tokenSpeed?.tokenCount).toBe(1)
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(1) // 1 token in 1 second
  })

  it('should handle very fast successive calls', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    // Multiple calls in rapid succession
    act(() => {
      result.current.updateTokenSpeed(message, 1)
      result.current.updateTokenSpeed(message, 1)
      result.current.updateTokenSpeed(message, 1)
      result.current.updateTokenSpeed(message, 1)
      result.current.updateTokenSpeed(message, 1)
    })

    // Should accumulate all tokens and use fallback time calculation
    expect(result.current.tokenSpeed?.tokenCount).toBe(5)
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(5) // 5 tokens / 1 second (fallback)
  })

  it('should handle empty message ID', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: '',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    expect(result.current.tokenSpeed?.message).toBe('')
    expect(result.current.tokenSpeed?.tokenCount).toBe(1)
  })

  it('should handle very long message IDs', () => {
    const { result } = renderHook(() => useAppState())
    
    const longId = 'a'.repeat(10000) // 10k character ID
    const message = {
      id: longId,
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    expect(result.current.tokenSpeed?.message).toBe(longId)
  })

  it('should handle multiple resets during streaming', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 5)
    })

    expect(result.current.tokenSpeed).toBeDefined()

    act(() => {
      result.current.resetTokenSpeed()
    })

    expect(result.current.tokenSpeed).toBeUndefined()

    act(() => {
      result.current.resetTokenSpeed() // Reset again when already undefined
    })

    expect(result.current.tokenSpeed).toBeUndefined()

    // Should work after reset
    act(() => {
      result.current.updateTokenSpeed(message, 3)
    })

    expect(result.current.tokenSpeed?.tokenCount).toBe(3)
  })

  it('should maintain precision with small time differences', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    // Advance by just 1ms
    act(() => {
      vi.advanceTimersByTime(1)
      result.current.updateTokenSpeed(message, 1)
    })

    // Should calculate: 2 tokens / 0.001 seconds = 2000 tokens/sec
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(2000)
  })
})