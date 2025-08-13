import { renderHook, act } from '@testing-library/react'
import { describe, test, expect, beforeEach } from 'vitest'
import { useAppState } from '../useAppState'
import {
  useThreadState,
  useStreamingContent,
  useQueuedMessages,
  useThreadQueueLength,
} from '../useThreadState'

/**
 * PERFORMANCE TESTING FOR MEMOIZATION APPROACHES
 *
 * This test suite measures the performance difference between:
 * 1. useShallow approach (old) - creates new object every render
 * 2. Individual hooks approach (new) - only re-renders when specific values change
 *
 * We'll measure:
 * - Object creation frequency
 * - Reference stability
 * - Memory efficiency
 */

describe('Performance: useShallow vs Individual Hooks', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  describe('Object Creation Tests', () => {
    test('individual hooks should not create new objects on every render', () => {
      const threadId = 'object-test-thread'

      const { result: streamingResult, rerender: rerenderStreaming } =
        renderHook(() => useStreamingContent(threadId))

      // Get initial reference
      const initialStreaming = streamingResult.current

      // Re-render without any state changes
      rerenderStreaming()

      // Reference should be the same (no new object created)
      expect(streamingResult.current).toBe(initialStreaming)
    })

    test('useThreadState creates new object on every render', () => {
      const threadId = 'object-test-thread'

      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      // Get initial reference
      const initialThreadState = threadStateResult.current

      // Re-render without any state changes
      rerenderThreadState()

      // Reference should be different (new object created)
      expect(threadStateResult.current).not.toBe(initialThreadState)
      expect(threadStateResult.current).toEqual(initialThreadState) // But content is the same
    })
  })

  describe('Reference Stability Tests', () => {
    test('individual hooks maintain stable references when values are the same', () => {
      const threadId = 'stability-test-thread'

      const { result: appStateResult } = renderHook(() => useAppState())

      // Set up some initial state
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Initial message')
      })

      const { result: queueResult, rerender: rerenderQueue } = renderHook(() =>
        useQueuedMessages(threadId)
      )

      const initialReference = queueResult.current

      // Update unrelated state (streaming content)
      act(() => {
        appStateResult.current.updateThreadStreamingContent(threadId, {
          id: 'unrelated',
        } as any)
      })
      rerenderQueue()

      // Queue reference should remain stable (no re-render needed)
      expect(queueResult.current).toBe(initialReference)
    })

    test('useThreadState creates new object even when only unrelated properties change', () => {
      const threadId = 'stability-test-thread'

      const { result: appStateResult } = renderHook(() => useAppState())

      // Set up some initial state
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Initial message')
      })

      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      const initialReference = threadStateResult.current

      // Update only streaming content (unrelated to queue)
      act(() => {
        appStateResult.current.updateThreadStreamingContent(threadId, {
          id: 'unrelated',
        } as any)
      })
      rerenderThreadState()

      // Thread state reference should change because it includes streaming content
      expect(threadStateResult.current).not.toBe(initialReference)
    })
  })

  describe('Memory Efficiency Tests', () => {
    test('individual hooks should not create unnecessary intermediate objects', () => {
      const threadId = 'memory-test-thread'

      // Track object creation by monitoring array references
      const { result: queueResult, rerender: rerenderQueue } = renderHook(() =>
        useQueuedMessages(threadId)
      )

      const initialArray = queueResult.current

      // Re-render multiple times
      for (let i = 0; i < 5; i++) {
        rerenderQueue()
        // Array reference should remain stable
        expect(queueResult.current).toBe(initialArray)
      }
    })

    test('useThreadState creates new objects on every render', () => {
      const threadId = 'memory-test-thread'

      const { result: appStateResult } = renderHook(() => useAppState())

      // Set up some actual state to make the test more realistic
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Test message')
      })

      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      const initialObject = threadStateResult.current

      // Re-render multiple times
      for (let i = 0; i < 5; i++) {
        rerenderThreadState()
        // Object reference should change each time
        expect(threadStateResult.current).not.toBe(initialObject)
      }
    })
  })

  describe('Real-world Performance Patterns', () => {
    test('individual hooks should handle frequent re-renders efficiently', () => {
      const threadId = 'frequent-render-thread'

      const { result: appStateResult } = renderHook(() => useAppState())

      // Set up initial state
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Message 1')
        appStateResult.current.addToThreadQueue(threadId, 'Message 2')
      })

      const { result: queueResult, rerender: rerenderQueue } = renderHook(() =>
        useQueuedMessages(threadId)
      )

      const initialReference = queueResult.current

      // Simulate frequent re-renders (like in a chat component)
      for (let i = 0; i < 10; i++) {
        rerenderQueue()
        // Reference should remain stable
        expect(queueResult.current).toBe(initialReference)
      }
    })

    test('useThreadState creates new objects on frequent re-renders', () => {
      const threadId = 'frequent-render-thread'

      const { result: appStateResult } = renderHook(() => useAppState())

      // Set up initial state
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Message 1')
        appStateResult.current.addToThreadQueue(threadId, 'Message 2')
      })

      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      const initialReference = threadStateResult.current

      // Simulate frequent re-renders
      for (let i = 0; i < 10; i++) {
        rerenderThreadState()
        // Reference should change each time
        expect(threadStateResult.current).not.toBe(initialReference)
      }
    })
  })

  describe('Performance Recommendations', () => {
    test('should demonstrate when to use individual hooks vs useThreadState', () => {
      const threadId = 'recommendation-test-thread'

      // Scenario 1: Component only needs queue length
      const { result: queueLengthResult, rerender: rerenderQueueLength } =
        renderHook(() => useThreadQueueLength(threadId))

      const initialLength = queueLengthResult.current
      rerenderQueueLength()

      // Individual hook maintains stable reference
      expect(queueLengthResult.current).toBe(initialLength)

      // Scenario 2: Component needs multiple properties
      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      const initialState = threadStateResult.current
      rerenderThreadState()

      // useThreadState creates new object
      expect(threadStateResult.current).not.toBe(initialState)

      // Recommendation: Use individual hooks when you only need specific properties
      // Use useThreadState only when you need all properties together
    })
  })
})
