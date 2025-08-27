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

describe('Token Speed Calculation Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    
    // Reset Zustand store
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

  it('should initialize token speed correctly on first call', () => {
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

    expect(result.current.tokenSpeed).toEqual({
      lastTimestamp: expect.any(Number),
      tokenSpeed: 0,
      tokenCount: 1,
      message: 'msg-1'
    })
  })

  it('should calculate token speed correctly for subsequent calls', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    // First call
    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    // Advance time by 1 second
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Second call - should calculate tokens/second
    act(() => {
      result.current.updateTokenSpeed(message, 2)
    })

    // Should have total 3 tokens over 1 second = 3 tokens/sec
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(3)
    expect(result.current.tokenSpeed?.tokenCount).toBe(3)
  })

  it('should handle same message ID consistently', () => {
    const { result } = renderHook(() => useAppState())
    
    const messageId = 'consistent-msg-id'
    const message1 = {
      id: messageId,
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }
    
    const message2 = {
      id: messageId,
      content: 'Hello world',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    // First call
    act(() => {
      result.current.updateTokenSpeed(message1, 1)
    })

    // Advance time
    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Second call with same message ID
    act(() => {
      result.current.updateTokenSpeed(message2, 1)
    })

    // Should accumulate tokens and continue calculation
    expect(result.current.tokenSpeed?.tokenCount).toBe(2)
    expect(result.current.tokenSpeed?.message).toBe(messageId)
  })

  it('should handle zero time difference correctly', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    // First call
    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    // Second call immediately (0ms time difference)
    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    // Should use fallback of 1 second to avoid division by zero
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(2) // 2 tokens / 1 second
  })

  it('should calculate correct average speed over multiple updates', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello',
      role: 'assistant' as const,
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    // First call (t=0, count=1)
    act(() => {
      result.current.updateTokenSpeed(message, 1)
    })

    // Second call (t=1s, count=3 total)
    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.updateTokenSpeed(message, 2)
    })

    // Third call (t=2s, count=5 total)
    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.updateTokenSpeed(message, 2)
    })

    // Average: 5 tokens / 2 seconds = 2.5 tokens/sec
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(2.5)
    expect(result.current.tokenSpeed?.tokenCount).toBe(5)
  })

  it('should reset token speed correctly', () => {
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
  })
})