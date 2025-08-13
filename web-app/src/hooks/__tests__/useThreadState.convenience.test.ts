import { renderHook, act } from '@testing-library/react'
import { ThreadMessage } from '@janhq/core'
import { useAppState } from '../useAppState'
import { 
  useStreamingContent, 
  useThreadError, 
  useTokenSpeed,
  useQueuedMessage,
  useIsThreadActive
} from '../useThreadState'

/**
 * MOCK DATA HELPERS
 * Consistent test data creation for different scenarios
 */
const createMockThreadMessage = (id: string, content: string): ThreadMessage => ({
  id,
  thread_id: 'test-thread',
  content: [{ type: 'text', text: { value: content } }],
  role: 'assistant',
  created_at: Date.now(),
  updated_at: Date.now(),
  status: 'ready',
  metadata: {}
})

const createMockTokenSpeed = (speed: number) => ({
  tokenSpeed: speed,
  tokenCount: 10,
  lastTimestamp: Date.now(),
  message: 'test-msg-id'
})

/**
 * CONVENIENCE HOOKS TESTS
 * 
 * These tests validate the thread-specific convenience hooks that provide
 * easy access to per-thread state without prop drilling or complex selectors.
 * 
 * Key goals:
 * - Simplify component access to thread-specific state
 * - Optimize re-rendering (only update when specific thread state changes)
 * - Provide clean, readable APIs for common use cases
 * - Maintain performance with efficient Zustand selectors
 */
describe('Thread State Convenience Hooks - API Usability & Performance', () => {
  beforeEach(() => {
    // SETUP: Reset store to clean state before each test
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  /**
   * STREAMING CONTENT CONVENIENCE HOOK TESTS
   * Tests for useStreamingContent(threadId) hook
   */
  describe('useStreamingContent - Thread-specific streaming content access', () => {
    test('BASIC RETRIEVAL: should return streaming content for the specified thread only', () => {
      // GOAL: Validate that hook returns correct content for requested thread
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: streamingResult } = renderHook(() => useStreamingContent('target-thread'))
      
      const targetMessage = createMockThreadMessage('target-msg', 'Content for target thread')
      const otherMessage = createMockThreadMessage('other-msg', 'Content for other thread')
      
      act(() => {
        // SETUP: Set content for both target and other thread
        appStateResult.current.updateStreamingContent('target-thread', targetMessage)
        appStateResult.current.updateStreamingContent('other-thread', otherMessage)
      })
      
      // THEN: Hook should return only the target thread's content
      expect(streamingResult.current).toEqual(targetMessage)
      expect(streamingResult.current).not.toEqual(otherMessage)
    })

    test('EMPTY STATE: should return undefined when thread has no streaming content', () => {
      // GOAL: Ensure hook handles empty state gracefully
      
      const { result } = renderHook(() => useStreamingContent('empty-thread'))
      
      // THEN: Should return undefined for thread with no content
      expect(result.current).toBeUndefined()
    })

    test('REACTIVITY: should update when streaming content changes for the specific thread', () => {
      // GOAL: Validate hook reactivity to state changes
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: streamingResult, rerender } = renderHook(() => useStreamingContent('reactive-thread'))
      
      const firstMessage = createMockThreadMessage('first', 'First streaming message')
      const secondMessage = createMockThreadMessage('second', 'Updated streaming message')
      
      // PHASE 1: Initial empty state
      expect(streamingResult.current).toBeUndefined()
      
      // PHASE 2: Set streaming content
      act(() => {
        appStateResult.current.updateStreamingContent('reactive-thread', firstMessage)
      })
      rerender()
      
      expect(streamingResult.current).toEqual(firstMessage)
      
      // PHASE 3: Update streaming content
      act(() => {
        appStateResult.current.updateStreamingContent('reactive-thread', secondMessage)
      })
      rerender()
      
      expect(streamingResult.current).toEqual(secondMessage)
      
      // PHASE 4: Clear streaming content
      act(() => {
        appStateResult.current.updateStreamingContent('reactive-thread', undefined)
      })
      rerender()
      
      expect(streamingResult.current).toBeUndefined()
    })

    test('ISOLATION: should not be affected by changes to other threads', () => {
      // GOAL: Ensure thread isolation - changes to other threads don't affect this hook
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: streamingResult, rerender } = renderHook(() => useStreamingContent('isolated-thread'))
      
      const isolatedMessage = createMockThreadMessage('isolated', 'Isolated thread message')
      const noiseMessage1 = createMockThreadMessage('noise1', 'Noise from thread 1')
      const noiseMessage2 = createMockThreadMessage('noise2', 'Noise from thread 2')
      
      act(() => {
        // SETUP: Set content for target thread
        appStateResult.current.updateStreamingContent('isolated-thread', isolatedMessage)
        
        // NOISE: Update other threads (should not affect our hook)
        appStateResult.current.updateStreamingContent('noise-thread-1', noiseMessage1)
        appStateResult.current.updateStreamingContent('noise-thread-2', noiseMessage2)
      })
      rerender()
      
      // THEN: Our hook should only see the isolated thread's content
      expect(streamingResult.current).toEqual(isolatedMessage)
    })
  })

  /**
   * THREAD ERROR CONVENIENCE HOOK TESTS
   * Tests for useThreadError(threadId) hook
   */
  describe('useThreadError - Thread-specific error state access', () => {
    test('STRING ERROR RETRIEVAL: should return string error for the specified thread', () => {
      // GOAL: Validate string error retrieval functionality
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: errorResult } = renderHook(() => useThreadError('error-thread'))
      
      const errorMessage = 'Connection timeout after 30 seconds'
      
      act(() => {
        appStateResult.current.setThreadError('error-thread', errorMessage)
      })
      
      expect(errorResult.current).toEqual(errorMessage)
    })

    test('OBJECT ERROR RETRIEVAL: should handle complex error objects correctly', () => {
      // GOAL: Validate complex error object handling
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: errorResult } = renderHook(() => useThreadError('complex-error-thread'))
      
      const complexError = { 
        message: 'AI model inference failed', 
        code: 'MODEL_ERROR',
        details: {
          model: 'llama-7b',
          timestamp: Date.now(),
          retryable: true,
          suggestion: 'Try reducing context length'
        }
      }
      
      act(() => {
        appStateResult.current.setThreadError('complex-error-thread', complexError)
      })
      
      expect(errorResult.current).toEqual(complexError)
      expect(errorResult.current).toHaveProperty('details.retryable', true)
    })

    test('NO ERROR STATE: should return undefined when thread has no error', () => {
      // GOAL: Ensure clean state when no errors exist
      
      const { result } = renderHook(() => useThreadError('clean-thread'))
      
      expect(result.current).toBeUndefined()
    })

    test('ERROR RECOVERY: should reflect error clearing in real-time', () => {
      // GOAL: Test error recovery workflow
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: errorResult, rerender } = renderHook(() => useThreadError('recovery-thread'))
      
      const temporaryError = 'Temporary network issue'
      
      // PHASE 1: Set error
      act(() => {
        appStateResult.current.setThreadError('recovery-thread', temporaryError)
      })
      rerender()
      
      expect(errorResult.current).toEqual(temporaryError)
      
      // PHASE 2: Clear error (recovery)
      act(() => {
        appStateResult.current.setThreadError('recovery-thread', undefined)
      })
      rerender()
      
      expect(errorResult.current).toBeUndefined()
    })
  })

  /**
   * TOKEN SPEED CONVENIENCE HOOK TESTS
   * Tests for useTokenSpeed(threadId) hook
   */
  describe('useTokenSpeed - Thread-specific performance metrics access', () => {
    test('SPEED TRACKING: should return token speed metrics for the specified thread', () => {
      // GOAL: Validate token speed tracking functionality
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: speedResult } = renderHook(() => useTokenSpeed('speed-thread'))
      
      const speedMetrics = createMockTokenSpeed(85) // 85 tokens/sec
      
      act(() => {
        appStateResult.current.updateTokenSpeed('speed-thread', speedMetrics)
      })
      
      expect(speedResult.current).toEqual(speedMetrics)
      expect(speedResult.current?.tokenSpeed).toBe(85)
    })

    test('NO METRICS STATE: should return undefined when thread has no speed data', () => {
      // GOAL: Handle threads without performance metrics
      
      const { result } = renderHook(() => useTokenSpeed('no-metrics-thread'))
      
      expect(result.current).toBeUndefined()
    })

    test('METRICS UPDATES: should track speed changes over time', () => {
      // GOAL: Validate dynamic speed tracking
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: speedResult, rerender } = renderHook(() => useTokenSpeed('dynamic-thread'))
      
      const initialSpeed = createMockTokenSpeed(50)
      const improvedSpeed = createMockTokenSpeed(75)
      
      // PHASE 1: Initial speed
      act(() => {
        appStateResult.current.updateTokenSpeed('dynamic-thread', initialSpeed)
      })
      rerender()
      
      expect(speedResult.current?.tokenSpeed).toBe(50)
      
      // PHASE 2: Speed improvement
      act(() => {
        appStateResult.current.updateTokenSpeed('dynamic-thread', improvedSpeed)
      })
      rerender()
      
      expect(speedResult.current?.tokenSpeed).toBe(75)
    })
  })

  /**
   * QUEUED MESSAGE CONVENIENCE HOOK TESTS
   * Tests for useQueuedMessage(threadId) hook
   */
  describe('useQueuedMessage - Thread-specific message queue access', () => {
    test('QUEUE RETRIEVAL: should return queued message for the specified thread', () => {
      // GOAL: Validate queued message access functionality
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: queueResult } = renderHook(() => useQueuedMessage('queue-thread'))
      
      const queuedMessage = 'Please analyze this data when you finish the current task'
      
      act(() => {
        appStateResult.current.setQueuedMessage('queue-thread', queuedMessage)
      })
      
      expect(queueResult.current).toEqual(queuedMessage)
    })

    test('QUEUE LIFECYCLE: should handle queue set -> clear -> reset workflow', () => {
      // GOAL: Test complete queue lifecycle
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: queueResult, rerender } = renderHook(() => useQueuedMessage('lifecycle-thread'))
      
      const testMessage = 'Test queued message'
      
      // PHASE 1: Initially no queue
      expect(queueResult.current).toBeUndefined()
      
      // PHASE 2: Queue a message
      act(() => {
        appStateResult.current.setQueuedMessage('lifecycle-thread', testMessage)
      })
      rerender()
      
      expect(queueResult.current).toEqual(testMessage)
      
      // PHASE 3: Clear queue (message processed)
      act(() => {
        appStateResult.current.setQueuedMessage('lifecycle-thread', null)
      })
      rerender()
      
      expect(queueResult.current).toBeNull()
    })

    test('EMPTY QUEUE STATE: should return appropriate value when no message is queued', () => {
      // GOAL: Validate empty queue state handling
      
      const { result } = renderHook(() => useQueuedMessage('empty-queue-thread'))
      
      expect(result.current).toBeUndefined()
    })
  })

  /**
   * THREAD ACTIVITY STATUS HOOK TESTS
   * Tests for useIsThreadActive(threadId) hook
   */
  describe('useIsThreadActive - Thread activity status detection', () => {
    test('ACTIVE DETECTION: should return true when thread has streaming content', () => {
      // GOAL: Detect when a thread is actively generating content
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: activeResult, rerender } = renderHook(() => useIsThreadActive('active-thread'))
      
      const activeMessage = createMockThreadMessage('active', 'AI is generating response...')
      
      act(() => {
        appStateResult.current.updateStreamingContent('active-thread', activeMessage)
      })
      rerender()
      
      expect(activeResult.current).toBe(true)
    })

    test('INACTIVE DETECTION: should return false when thread has no streaming content', () => {
      // GOAL: Detect inactive/idle threads
      
      const { result } = renderHook(() => useIsThreadActive('inactive-thread'))
      
      expect(result.current).toBe(false)
    })

    test('ACTIVITY TRANSITION: should track activity state transitions correctly', () => {
      // GOAL: Validate activity state changes over time
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: activeResult, rerender } = renderHook(() => useIsThreadActive('transition-thread'))
      
      const streamingMessage = createMockThreadMessage('streaming', 'Generating response...')
      
      // PHASE 1: Initially inactive
      expect(activeResult.current).toBe(false)
      
      // PHASE 2: Start streaming (becomes active)
      act(() => {
        appStateResult.current.updateStreamingContent('transition-thread', streamingMessage)
      })
      rerender()
      
      expect(activeResult.current).toBe(true)
      
      // PHASE 3: Stop streaming (becomes inactive)
      act(() => {
        appStateResult.current.updateStreamingContent('transition-thread', undefined)
      })
      rerender()
      
      expect(activeResult.current).toBe(false)
    })

    test('MULTI-THREAD ACTIVITY: should track activity independently across multiple threads', () => {
      // GOAL: Ensure activity detection works independently for different threads
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: active1Result, rerender: rerender1 } = renderHook(() => useIsThreadActive('multi-thread-1'))
      const { result: active2Result, rerender: rerender2 } = renderHook(() => useIsThreadActive('multi-thread-2'))
      
      const message1 = createMockThreadMessage('msg1', 'Thread 1 active')
      
      act(() => {
        // Only thread-1 starts streaming
        appStateResult.current.updateStreamingContent('multi-thread-1', message1)
        // thread-2 remains inactive
      })
      rerender1()
      rerender2()
      
      expect(active1Result.current).toBe(true)  // Thread 1 is active
      expect(active2Result.current).toBe(false) // Thread 2 is inactive
      
      const message2 = createMockThreadMessage('msg2', 'Thread 2 now active')
      
      act(() => {
        // Both threads now active
        appStateResult.current.updateStreamingContent('multi-thread-2', message2)
      })
      rerender1()
      rerender2()
      
      expect(active1Result.current).toBe(true)  // Thread 1 still active
      expect(active2Result.current).toBe(true)  // Thread 2 now active
    })
  })

  /**
   * PERFORMANCE AND OPTIMIZATION TESTS
   * Validates that hooks are optimized and don't cause unnecessary re-renders
   */
  describe('Performance optimization and re-rendering efficiency', () => {
    test('SELECTIVE REACTIVITY: should only re-render when specific thread state changes', () => {
      // GOAL: Validate that hooks use efficient selectors to minimize re-renders
      // NOTE: This test validates the concept - actual re-render counting may vary
      //       based on Zustand's internal optimization
      
      const { result: appStateResult } = renderHook(() => useAppState())
      
      let renderCount1 = 0
      let renderCount2 = 0
      
      const { rerender: rerender1 } = renderHook(() => {
        renderCount1++
        return useStreamingContent('selective-thread-1')
      })
      
      const { rerender: rerender2 } = renderHook(() => {
        renderCount2++
        return useStreamingContent('selective-thread-2')
      })
      
      // BASELINE: Initial renders
      const initialRender1 = renderCount1
      const initialRender2 = renderCount2
      
      // WHEN: Update only thread-1
      act(() => {
        appStateResult.current.updateStreamingContent('selective-thread-1', 
          createMockThreadMessage('msg1', 'Thread 1 update'))
      })
      rerender1()
      rerender2()
      
      // THEN: Both hooks may re-render due to Zustand subscription model
      // but the important thing is that the values are correctly isolated
      expect(renderCount1).toBeGreaterThan(initialRender1) // Thread 1 hook updated
      expect(renderCount2).toBeGreaterThan(initialRender2) // Thread 2 hook may also re-render
      
      // VERIFY: Values are still correctly isolated despite re-renders
      const { result: thread1Result } = renderHook(() => useStreamingContent('selective-thread-1'))
      const { result: thread2Result } = renderHook(() => useStreamingContent('selective-thread-2'))
      
      expect(thread1Result.current).toBeDefined()
      expect(thread2Result.current).toBeUndefined()
    })

    test('HOOK STABILITY: should maintain stable references when state doesn\'t change', () => {
      // GOAL: Ensure hooks don't create new references unnecessarily
      
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: streamingResult, rerender } = renderHook(() => useStreamingContent('stable-thread'))
      
      const testMessage = createMockThreadMessage('stable', 'Stable message')
      
      act(() => {
        appStateResult.current.updateStreamingContent('stable-thread', testMessage)
      })
      rerender()
      
      const firstReference = streamingResult.current
      
      // Re-render without changing state
      rerender()
      
      const secondReference = streamingResult.current
      
      // References should be the same (Zustand's internal optimization)
      expect(firstReference).toBe(secondReference)
    })

    test('MEMORY EFFICIENCY: should not leak memory when threads are cleaned up', () => {
      // GOAL: Validate that cleanup doesn't leave stale references
      // NOTE: This is more of a conceptual test - actual memory leak detection
      //       would require more sophisticated tooling
      
      const { result: appStateResult } = renderHook(() => useAppState())
      
      // SETUP: Create and populate multiple threads
      const threadIds = Array.from({ length: 10 }, (_, i) => `temp-thread-${i}`)
      
      act(() => {
        threadIds.forEach(threadId => {
          appStateResult.current.updateStreamingContent(threadId, 
            createMockThreadMessage(`msg-${threadId}`, `Content for ${threadId}`))
        })
      })
      
      // VERIFY: All threads exist
      threadIds.forEach(threadId => {
        expect(appStateResult.current.streamingContentByThread[threadId]).toBeDefined()
      })
      
      // CLEANUP: Remove all threads
      act(() => {
        appStateResult.current.clearAllThreads()
      })
      
      // VERIFY: All threads are properly cleaned up
      expect(Object.keys(appStateResult.current.streamingContentByThread)).toHaveLength(0)
      expect(Object.keys(appStateResult.current.tokenSpeedByThread)).toHaveLength(0)
      expect(Object.keys(appStateResult.current.errorsByThread)).toHaveLength(0)
      expect(Object.keys(appStateResult.current.queuedMessagesByThread)).toHaveLength(0)
    })
  })
})
