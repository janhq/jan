import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState } from '../useAppState'

// Mock the useAssistant hook as a Zustand store
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

describe('useAppState concurrent processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store to initial state
    act(() => {
      useAppState.setState({
        processingThreads: {},
        maxConcurrency: 1,
        fallbackMode: 'single-thread',
        parallelProcessingEnabled: false,
        streamingContentByThread: {},
        tokenSpeedByThread: {},
        queuedMessagesByThread: {},
        errorsByThread: {},
        abortControllers: {}
      })
    })
  })

  describe('initialization', () => {
    it('should initialize with default concurrent processing state', () => {
      const { result } = renderHook(() => useAppState())
      
      expect(result.current.processingThreads).toEqual({})
      expect(result.current.maxConcurrency).toBe(1)
      expect(result.current.fallbackMode).toBe('single-thread')
      expect(result.current.parallelProcessingEnabled).toBe(false)
      expect(result.current.getActiveProcessingCount()).toBe(0)
      expect(result.current.getAvailableSlots()).toBe(1)
    })
  })

  describe('thread processing tracking', () => {
    it('should track processing threads correctly', () => {
      const { result } = renderHook(() => useAppState())

      // Initially no threads processing
      expect(result.current.getActiveProcessingCount()).toBe(0)
      expect(result.current.isThreadProcessing('thread-1')).toBe(false)

      // Start processing thread-1
      act(() => {
        result.current.setThreadProcessing('thread-1', true)
      })

      expect(result.current.getActiveProcessingCount()).toBe(1)
      expect(result.current.isThreadProcessing('thread-1')).toBe(true)
      expect(result.current.processingThreads['thread-1']).toBe(true)

      // Start processing thread-2
      act(() => {
        result.current.setThreadProcessing('thread-2', true)
      })

      expect(result.current.getActiveProcessingCount()).toBe(2)
      expect(result.current.isThreadProcessing('thread-2')).toBe(true)

      // Stop processing thread-1
      act(() => {
        result.current.setThreadProcessing('thread-1', false)
      })

      expect(result.current.getActiveProcessingCount()).toBe(1)
      expect(result.current.isThreadProcessing('thread-1')).toBe(false)
      expect(result.current.isThreadProcessing('thread-2')).toBe(true)
    })

    it('should handle setting same thread processing state multiple times', () => {
      const { result } = renderHook(() => useAppState())

      // Set thread-1 to processing multiple times
      act(() => {
        result.current.setThreadProcessing('thread-1', true)
        result.current.setThreadProcessing('thread-1', true)
        result.current.setThreadProcessing('thread-1', true)
      })

      expect(result.current.getActiveProcessingCount()).toBe(1)
      expect(result.current.isThreadProcessing('thread-1')).toBe(true)

      // Set thread-1 to not processing multiple times
      act(() => {
        result.current.setThreadProcessing('thread-1', false)
        result.current.setThreadProcessing('thread-1', false)
        result.current.setThreadProcessing('thread-1', false)
      })

      expect(result.current.getActiveProcessingCount()).toBe(0)
      expect(result.current.isThreadProcessing('thread-1')).toBe(false)
    })
  })

  describe('concurrency management', () => {
    it('should calculate available slots correctly', () => {
      const { result } = renderHook(() => useAppState())

      // Initially all slots available
      expect(result.current.getAvailableSlots()).toBe(1) // maxConcurrency defaults to 1

      // Set higher concurrency
      act(() => {
        result.current.setMaxConcurrency(3)
      })

      expect(result.current.getAvailableSlots()).toBe(3)

      // Start processing
      act(() => {
        result.current.setThreadProcessing('thread-1', true)
      })

      expect(result.current.getAvailableSlots()).toBe(2)

      // Start more processing
      act(() => {
        result.current.setThreadProcessing('thread-2', true)
        result.current.setThreadProcessing('thread-3', true)
      })

      expect(result.current.getAvailableSlots()).toBe(0)

      // Stop one thread
      act(() => {
        result.current.setThreadProcessing('thread-2', false)
      })

      expect(result.current.getAvailableSlots()).toBe(1)
    })

    it('should enforce minimum concurrency of 1', () => {
      const { result } = renderHook(() => useAppState())

      act(() => {
        result.current.setMaxConcurrency(0)
      })

      expect(result.current.maxConcurrency).toBe(1)

      act(() => {
        result.current.setMaxConcurrency(-5)
      })

      expect(result.current.maxConcurrency).toBe(1)

      act(() => {
        result.current.setMaxConcurrency(2.7)
      })

      expect(result.current.maxConcurrency).toBe(2.7) // Math.max preserves the value
    })

    it('should allow setting valid concurrency values', () => {
      const { result } = renderHook(() => useAppState())

      const testValues = [1, 2, 4, 8, 16]
      
      testValues.forEach(value => {
        act(() => {
          result.current.setMaxConcurrency(value)
        })
        expect(result.current.maxConcurrency).toBe(value)
      })
    })
  })

  describe('fallback mode management', () => {
    it('should manage fallback mode correctly', () => {
      const { result } = renderHook(() => useAppState())

      expect(result.current.fallbackMode).toBe('single-thread')

      const modes = ['estimated', 'detected', 'user-configured'] as const

      modes.forEach(mode => {
        act(() => {
          result.current.setFallbackMode(mode)
        })
        expect(result.current.fallbackMode).toBe(mode)
      })

      // Back to single-thread
      act(() => {
        result.current.setFallbackMode('single-thread')
      })

      expect(result.current.fallbackMode).toBe('single-thread')
    })
  })

  describe('parallel processing flag', () => {
    it('should manage parallel processing enabled flag', () => {
      const { result } = renderHook(() => useAppState())

      expect(result.current.parallelProcessingEnabled).toBe(false)

      act(() => {
        result.current.setParallelProcessingEnabled(true)
      })

      expect(result.current.parallelProcessingEnabled).toBe(true)

      act(() => {
        result.current.setParallelProcessingEnabled(false)
      })

      expect(result.current.parallelProcessingEnabled).toBe(false)
    })
  })

  describe('thread cleanup integration', () => {
    it('should clean up processing state when clearing thread', () => {
      const { result } = renderHook(() => useAppState())

      // Set up thread state
      act(() => {
        result.current.setThreadProcessing('thread-1', true)
        result.current.setThreadProcessing('thread-2', true)
        result.current.addToThreadQueue('thread-1', 'message1')
        result.current.addToThreadQueue('thread-2', 'message2')
      })

      expect(result.current.getActiveProcessingCount()).toBe(2)
      expect(result.current.isThreadProcessing('thread-1')).toBe(true)

      // Clear thread-1
      act(() => {
        result.current.clearThread('thread-1')
      })

      expect(result.current.getActiveProcessingCount()).toBe(1)
      expect(result.current.isThreadProcessing('thread-1')).toBe(false)
      expect(result.current.isThreadProcessing('thread-2')).toBe(true)
      expect(result.current.queuedMessagesByThread['thread-1']).toBeUndefined()
    })

    it('should clean up all processing state when clearing all threads', () => {
      const { result } = renderHook(() => useAppState())

      // Set up multiple threads
      act(() => {
        result.current.setThreadProcessing('thread-1', true)
        result.current.setThreadProcessing('thread-2', true)
        result.current.setThreadProcessing('thread-3', true)
        result.current.addToThreadQueue('thread-1', 'message1')
        result.current.addToThreadQueue('thread-2', 'message2')
      })

      expect(result.current.getActiveProcessingCount()).toBe(3)

      // Clear all threads
      act(() => {
        result.current.clearAllThreads()
      })

      expect(result.current.getActiveProcessingCount()).toBe(0)
      expect(result.current.processingThreads).toEqual({})
      expect(result.current.queuedMessagesByThread).toEqual({})
      expect(result.current.isThreadProcessing('thread-1')).toBe(false)
      expect(result.current.isThreadProcessing('thread-2')).toBe(false)
      expect(result.current.isThreadProcessing('thread-3')).toBe(false)
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle checking processing state for non-existent threads', () => {
      const { result } = renderHook(() => useAppState())

      expect(result.current.isThreadProcessing('non-existent-thread')).toBe(false)
    })

    it('should handle rapid state updates without issues', () => {
      const { result } = renderHook(() => useAppState())

      // Rapid updates should not cause issues
      act(() => {
        for (let i = 0; i < 100; i++) {
          result.current.setThreadProcessing(`thread-${i}`, true)
          result.current.setThreadProcessing(`thread-${i}`, false)
        }
      })

      expect(result.current.getActiveProcessingCount()).toBe(0)
    })

    it('should maintain accurate count during concurrent updates', () => {
      const { result } = renderHook(() => useAppState())

      // Set max concurrency higher
      act(() => {
        result.current.setMaxConcurrency(10)
      })

      // Start multiple threads
      act(() => {
        for (let i = 0; i < 5; i++) {
          result.current.setThreadProcessing(`thread-${i}`, true)
        }
      })

      expect(result.current.getActiveProcessingCount()).toBe(5)
      expect(result.current.getAvailableSlots()).toBe(5)

      // Stop some threads
      act(() => {
        result.current.setThreadProcessing('thread-1', false)
        result.current.setThreadProcessing('thread-3', false)
      })

      expect(result.current.getActiveProcessingCount()).toBe(3)
      expect(result.current.getAvailableSlots()).toBe(7)
    })
  })

  describe('integration with existing state', () => {
    it('should work alongside existing queue functionality', () => {
      const { result } = renderHook(() => useAppState())

      // Add messages to queue and set processing
      act(() => {
        result.current.addToThreadQueue('thread-1', 'message1')
        result.current.addToThreadQueue('thread-1', 'message2')
        result.current.setThreadProcessing('thread-1', true)
      })

      expect(result.current.getThreadQueueLength('thread-1')).toBe(2)
      expect(result.current.isThreadProcessing('thread-1')).toBe(true)

      // Remove from queue while processing
      act(() => {
        const removed = result.current.removeFromThreadQueue('thread-1')
        expect(removed).toBe('message1')
      })

      expect(result.current.getThreadQueueLength('thread-1')).toBe(1)
      expect(result.current.isThreadProcessing('thread-1')).toBe(true)
    })

    it('should not interfere with legacy state management', () => {
      const { result } = renderHook(() => useAppState())

      // Test legacy queuedMessage (non-thread-specific)
      act(() => {
        result.current.setQueuedMessage('legacy message')
        result.current.setThreadProcessing('thread-1', true)
      })

      expect(result.current.queuedMessage).toBe('legacy message')
      expect(result.current.isThreadProcessing('thread-1')).toBe(true)

      // Legacy and new state should coexist
      act(() => {
        result.current.setQueuedMessage(null)
        result.current.setThreadProcessing('thread-1', false)
      })

      expect(result.current.queuedMessage).toBe(null)
      expect(result.current.isThreadProcessing('thread-1')).toBe(false)
    })
  })

  describe('zustand store reactivity', () => {
    it('should trigger re-renders when state changes', () => {
      const { result } = renderHook(() => useAppState())

      // Test that Zustand store updates trigger re-renders
      const initialState = { ...result.current }

      act(() => {
        result.current.setThreadProcessing('thread-1', true)
      })

      // State should have changed
      expect(result.current.processingThreads).not.toEqual(
        initialState.processingThreads
      )
      expect(result.current.processingThreads['thread-1']).toBe(true)

      // Computed values should also update
      expect(result.current.getActiveProcessingCount()).toBe(1)
      expect(result.current.getAvailableSlots()).toBe(0) // maxConcurrency is 1
    })

    it('should provide consistent state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useAppState())
      const { result: result2 } = renderHook(() => useAppState())

      act(() => {
        result1.current.setThreadProcessing('thread-1', true)
        result1.current.setMaxConcurrency(4)
      })

      // Both hooks should see the same state
      expect(result2.current.isThreadProcessing('thread-1')).toBe(true)
      expect(result2.current.maxConcurrency).toBe(4)
      expect(result2.current.getActiveProcessingCount()).toBe(1)
      expect(result2.current.getAvailableSlots()).toBe(3)
    })
  })
})
