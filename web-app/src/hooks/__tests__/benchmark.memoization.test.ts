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
 * BENCHMARK TESTING FOR MEMOIZATION APPROACHES
 *
 * This test demonstrates the performance difference between:
 * 1. Individual hooks approach (new) - only re-renders when specific values change
 * 2. useThreadState approach (less optimal) - creates new object on every render
 *
 * We'll measure:
 * - Object creation frequency
 * - Reference stability
 * - Performance characteristics
 */

describe('Benchmark: Individual Hooks vs useThreadState', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  describe('Performance Characteristics', () => {
    test('individual hooks maintain stable references', () => {
      const threadId = 'benchmark-thread'

      // Set up some state
      const { result: appStateResult } = renderHook(() => useAppState())
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Message 1')
        appStateResult.current.addToThreadQueue(threadId, 'Message 2')
      })

      // Test individual hooks
      const { result: queueResult, rerender: rerenderQueue } = renderHook(() =>
        useQueuedMessages(threadId)
      )

      const initialReference = queueResult.current

      // Multiple re-renders without state changes
      for (let i = 0; i < 100; i++) {
        rerenderQueue()
        // Reference should remain stable
        expect(queueResult.current).toBe(initialReference)
      }

      // Update queue
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Message 3')
      })
      rerenderQueue()

      // Now reference should change (because value actually changed)
      expect(queueResult.current).not.toBe(initialReference)
      expect(queueResult.current).toHaveLength(3)
    })

    test('useThreadState creates new objects on every render', () => {
      const threadId = 'benchmark-thread'

      // Set up some state
      const { result: appStateResult } = renderHook(() => useAppState())
      act(() => {
        appStateResult.current.addToThreadQueue(threadId, 'Message 1')
        appStateResult.current.addToThreadQueue(threadId, 'Message 2')
      })

      // Test useThreadState
      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      const initialReference = threadStateResult.current
      const references: any[] = [initialReference]

      // Multiple re-renders without state changes
      for (let i = 0; i < 100; i++) {
        rerenderThreadState()
        references.push(threadStateResult.current)

        // Each render creates a new object
        expect(threadStateResult.current).not.toBe(initialReference)

        // But content remains the same
        expect(threadStateResult.current).toEqual(initialReference)
      }

      // Verify we have 101 different object references
      const uniqueReferences = new Set(references)
      expect(uniqueReferences.size).toBe(101)
    })
  })

  describe('Memory Efficiency', () => {
    test('individual hooks are memory efficient', () => {
      const threadId = 'memory-benchmark-thread'

      const { result: queueResult, rerender: rerenderQueue } = renderHook(() =>
        useQueuedMessages(threadId)
      )

      const initialReference = queueResult.current

      // Simulate many re-renders (like in a chat component)
      for (let i = 0; i < 1000; i++) {
        rerenderQueue()
        // Reference should remain stable
        expect(queueResult.current).toBe(initialReference)
      }

      // Only one object was created for the empty array
      expect(queueResult.current).toBe(initialReference)
    })

    test('useThreadState creates many objects', () => {
      const threadId = 'memory-benchmark-thread'

      const { result: threadStateResult, rerender: rerenderThreadState } =
        renderHook(() => useThreadState(threadId))

      const initialReference = threadStateResult.current
      const references: any[] = [initialReference]

      // Simulate many re-renders
      for (let i = 0; i < 1000; i++) {
        rerenderThreadState()
        references.push(threadStateResult.current)

        // Each render creates a new object
        expect(threadStateResult.current).not.toBe(initialReference)
      }

      // We have 1001 different object references
      const uniqueReferences = new Set(references)
      expect(uniqueReferences.size).toBe(1001)
    })
  })

  describe('Real-world Scenarios', () => {
    test('chat component with frequent updates', () => {
      const threadId = 'chat-component-thread'

      const { result: appStateResult } = renderHook(() => useAppState())

      // Simulate chat component that re-renders frequently
      const { result: queueResult, rerender: rerenderQueue } = renderHook(() =>
        useQueuedMessages(threadId)
      )
      const { result: streamingResult, rerender: rerenderStreaming } =
        renderHook(() => useStreamingContent(threadId))

      const initialQueueReference = queueResult.current
      const initialStreamingReference = streamingResult.current

      // Simulate rapid state changes (like typing indicators, message updates)
      for (let i = 0; i < 50; i++) {
        // Update streaming content
        act(() => {
          appStateResult.current.updateThreadStreamingContent(threadId, {
            id: `streaming-${i}`,
          } as any)
        })
        rerenderStreaming()

        // Update queue
        act(() => {
          appStateResult.current.addToThreadQueue(threadId, `Message ${i}`)
        })
        rerenderQueue()

        // Queue reference should change when queue changes
        if (i === 0) {
          expect(queueResult.current).not.toBe(initialQueueReference)
        }

        // Streaming reference should change when streaming changes
        expect(streamingResult.current).not.toBe(initialStreamingReference)
      }
    })

    test('dashboard component with multiple thread states', () => {
      const threads = ['work', 'personal', 'project-a', 'project-b']

      const { result: appStateResult } = renderHook(() => useAppState())

      // Set up multiple threads
      threads.forEach((threadId) => {
        act(() => {
          appStateResult.current.addToThreadQueue(
            threadId,
            `Initial message for ${threadId}`
          )
        })
      })

      // Create hooks for each thread
      const threadHooks = threads.map((threadId) =>
        renderHook(() => useQueuedMessages(threadId))
      )

      const initialReferences = threadHooks.map((hook) => hook.result.current)

      // Update only one thread
      act(() => {
        appStateResult.current.addToThreadQueue(
          'work',
          'Additional work message'
        )
      })

      // Re-render all hooks
      threadHooks.forEach(({ rerender }) => rerender())

      // Only work thread should have changed reference
      expect(threadHooks[0].result.current).not.toBe(initialReferences[0])
      expect(threadHooks[1].result.current).toBe(initialReferences[1])
      expect(threadHooks[2].result.current).toBe(initialReferences[2])
      expect(threadHooks[3].result.current).toBe(initialReferences[3])
    })
  })

  describe('Performance Recommendations', () => {
    test('should demonstrate optimal usage patterns', () => {
      const threadId = 'recommendation-thread'

      // ✅ GOOD: Use individual hooks when you only need specific data
      const { result: queueLengthResult } = renderHook(() =>
        useThreadQueueLength(threadId)
      )
      expect(queueLengthResult.current).toBe(0)

      // ✅ GOOD: Use individual hooks for different concerns
      const { result: streamingResult } = renderHook(() =>
        useStreamingContent(threadId)
      )
      expect(streamingResult.current).toBeUndefined()

      // ⚠️ LESS OPTIMAL: Use useThreadState only when you need everything
      const { result: threadStateResult } = renderHook(() =>
        useThreadState(threadId)
      )
      expect(threadStateResult.current.queueLength).toBe(0)
      expect(threadStateResult.current.streamingContent).toBeUndefined()

      // Recommendation: Use individual hooks for better performance
      // Only use useThreadState when you actually need all properties together
    })
  })
})
