import { renderHook, act } from '@testing-library/react'
import { ThreadMessage } from '@janhq/core'
import { useAppState } from '../useAppState'

/**
 * MOCK DATA HELPERS
 * These helpers create consistent test data for different scenarios
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
 * PER-THREAD STATE MANAGEMENT TESTS
 * 
 * These tests validate that the app state can manage multiple threads independently,
 * where each thread maintains its own streaming content, token speed, errors, and queued messages.
 * 
 * Key requirements being validated:
 * - Thread isolation (changes to one thread don't affect others)
 * - State consistency during concurrent operations
 * - Proper cleanup and memory management
 * - Backward compatibility during migration
 */
describe('useAppState - Per-Thread State Management', () => {
  beforeEach(() => {
    // SETUP: Reset store to clean state before each test
    // This ensures no test interference and predictable initial conditions
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  /**
   * STREAMING CONTENT TESTS
   * Validates that AI response streaming can happen independently per thread
   */
  describe('Thread-isolated streaming content management', () => {
    test('CORE: should maintain separate streaming content for multiple threads simultaneously', () => {
      // GOAL: Prove that thread-1 and thread-2 can have different streaming messages
      // without interfering with each other
      
      const { result } = renderHook(() => useAppState())
      
      const thread1Message = createMockThreadMessage('msg1', 'AI response for work chat')
      const thread2Message = createMockThreadMessage('msg2', 'AI response for personal chat')
      
      act(() => {
        // WHEN: Setting streaming content for two different threads
        result.current.updateStreamingContent('work-thread', thread1Message)
        result.current.updateStreamingContent('personal-thread', thread2Message)
      })
      
      // THEN: Each thread should maintain its own content independently
      expect(result.current.streamingContentByThread['work-thread']).toEqual(thread1Message)
      expect(result.current.streamingContentByThread['personal-thread']).toEqual(thread2Message)
      
      // VERIFY: Threads are truly isolated
      expect(result.current.streamingContentByThread['work-thread']).not.toEqual(thread2Message)
    })

    test('EDGE CASE: should handle clearing streaming content without affecting other threads', () => {
      // GOAL: Ensure clearing streaming content is thread-specific
      
      const { result } = renderHook(() => useAppState())
      
      const thread1Message = createMockThreadMessage('msg1', 'Thread 1 streaming')
      const thread2Message = createMockThreadMessage('msg2', 'Thread 2 streaming')
      
      act(() => {
        // SETUP: Both threads have streaming content
        result.current.updateStreamingContent('thread-1', thread1Message)
        result.current.updateStreamingContent('thread-2', thread2Message)
        
        // WHEN: Clear only thread-1's streaming content
        result.current.updateStreamingContent('thread-1', undefined)
      })
      
      // THEN: Only thread-1 should be cleared, thread-2 should remain unchanged
      expect(result.current.streamingContentByThread['thread-1']).toBeUndefined()
      expect(result.current.streamingContentByThread['thread-2']).toEqual(thread2Message)
    })

    test('UPDATE SCENARIO: should handle streaming content updates without cross-thread contamination', () => {
      // GOAL: Validate that rapid updates to one thread don't corrupt another thread's state
      
      const { result } = renderHook(() => useAppState())
      
      const initialMessage1 = createMockThreadMessage('initial1', 'Initial content thread 1')
      const initialMessage2 = createMockThreadMessage('initial2', 'Initial content thread 2')
      const updatedMessage1 = createMockThreadMessage('updated1', 'Updated content thread 1')
      
      act(() => {
        // SETUP: Both threads have initial streaming content
        result.current.updateStreamingContent('thread-1', initialMessage1)
        result.current.updateStreamingContent('thread-2', initialMessage2)
        
        // WHEN: Update only thread-1 multiple times
        result.current.updateStreamingContent('thread-1', updatedMessage1)
      })
      
      // THEN: Thread-1 should have updated content, thread-2 should be unchanged
      expect(result.current.streamingContentByThread['thread-1']).toEqual(updatedMessage1)
      expect(result.current.streamingContentByThread['thread-2']).toEqual(initialMessage2)
    })
  })

  /**
   * TOKEN SPEED TESTS
   * Validates that token generation speed tracking works independently per thread
   */
  describe('Thread-specific token speed tracking', () => {
    test('CORE: should track different token speeds for different threads independently', () => {
      // GOAL: Verify each thread can have its own token speed without interference
      
      const { result } = renderHook(() => useAppState())
      
      const fastSpeed = createMockTokenSpeed(100) // Fast AI model
      const slowSpeed = createMockTokenSpeed(25)  // Slower AI model
      
      act(() => {
        // WHEN: Setting different speeds for different threads
        result.current.updateTokenSpeed('fast-thread', fastSpeed)
        result.current.updateTokenSpeed('slow-thread', slowSpeed)
      })
      
      // THEN: Each thread should maintain its own speed independently
      expect(result.current.tokenSpeedByThread['fast-thread']).toEqual(fastSpeed)
      expect(result.current.tokenSpeedByThread['slow-thread']).toEqual(slowSpeed)
    })

    test('LIFECYCLE: should handle token speed lifecycle (set -> update -> clear)', () => {
      // GOAL: Test complete token speed lifecycle for a single thread
      
      const { result } = renderHook(() => useAppState())
      
      const initialSpeed = createMockTokenSpeed(50)
      const updatedSpeed = createMockTokenSpeed(75)
      
      act(() => {
        // Phase 1: Set initial speed
        result.current.updateTokenSpeed('test-thread', initialSpeed)
      })
      
      expect(result.current.tokenSpeedByThread['test-thread']).toEqual(initialSpeed)
      
      act(() => {
        // Phase 2: Update speed
        result.current.updateTokenSpeed('test-thread', updatedSpeed)
      })
      
      expect(result.current.tokenSpeedByThread['test-thread']).toEqual(updatedSpeed)
      
      act(() => {
        // Phase 3: Clear speed
        result.current.updateTokenSpeed('test-thread', undefined)
      })
      
      expect(result.current.tokenSpeedByThread['test-thread']).toBeUndefined()
    })
  })

  /**
   * ERROR HANDLING TESTS
   * Validates that errors are properly isolated per thread
   */
  describe('Thread-isolated error management', () => {
    test('CORE: should store and retrieve errors independently for each thread', () => {
      // GOAL: Prove that errors in one thread don't affect other threads
      
      const { result } = renderHook(() => useAppState())
      
      const connectionError = 'Connection failed to AI service'
      const modelError = { message: 'Model loading failed', code: 500, details: 'GPU memory insufficient' }
      
      act(() => {
        // WHEN: Setting different error types for different threads
        result.current.setThreadError('connection-thread', connectionError)
        result.current.setThreadError('model-thread', modelError)
      })
      
      // THEN: Each thread should have its specific error
      expect(result.current.errorsByThread['connection-thread']).toEqual(connectionError)
      expect(result.current.errorsByThread['model-thread']).toEqual(modelError)
    })

    test('ERROR RECOVERY: should allow clearing errors without affecting other thread errors', () => {
      // GOAL: Validate error recovery doesn't clear other thread errors
      
      const { result } = renderHook(() => useAppState())
      
      const error1 = 'Thread 1 error'
      const error2 = 'Thread 2 error'
      
      act(() => {
        // SETUP: Both threads have errors
        result.current.setThreadError('thread-1', error1)
        result.current.setThreadError('thread-2', error2)
        
        // WHEN: Clear error from thread-1 only
        result.current.setThreadError('thread-1', undefined)
      })
      
      // THEN: Only thread-1 error should be cleared
      expect(result.current.errorsByThread['thread-1']).toBeUndefined()
      expect(result.current.errorsByThread['thread-2']).toEqual(error2)
    })

    test('ERROR TYPES: should handle both string and object error formats per thread', () => {
      // GOAL: Ensure error system supports different error data structures
      
      const { result } = renderHook(() => useAppState())
      
      const stringError = 'Simple error message'
      const objectError = { 
        message: 'Complex error', 
        code: 'AUTH_FAILED', 
        timestamp: Date.now(),
        retryable: true 
      }
      
      act(() => {
        result.current.setThreadError('string-error-thread', stringError)
        result.current.setThreadError('object-error-thread', objectError)
      })
      
      expect(result.current.errorsByThread['string-error-thread']).toEqual(stringError)
      expect(result.current.errorsByThread['object-error-thread']).toEqual(objectError)
    })
  })

  /**
   * QUEUED MESSAGES TESTS
   * Validates that message queuing works independently per thread
   */
  describe('Thread-specific message queue management', () => {
    test('CORE: should maintain separate message queues for each thread', () => {
      // GOAL: Verify that queued messages don't cross between threads
      
      const { result } = renderHook(() => useAppState())
      
      const workMessage = 'Please review the quarterly report'
      const personalMessage = 'What\'s the weather like today?'
      
      act(() => {
        // WHEN: Queuing messages in different threads
        result.current.setQueuedMessage('work-thread', workMessage)
        result.current.setQueuedMessage('personal-thread', personalMessage)
      })
      
      // THEN: Each thread should have its specific queued message
      expect(result.current.queuedMessagesByThread['work-thread']).toEqual(workMessage)
      expect(result.current.queuedMessagesByThread['personal-thread']).toEqual(personalMessage)
    })

    test('QUEUE LIFECYCLE: should support queue operations (set -> clear -> reset)', () => {
      // GOAL: Test complete queue lifecycle management
      
      const { result } = renderHook(() => useAppState())
      
      const queuedMessage = 'Message waiting to be sent'
      
      act(() => {
        // Phase 1: Queue a message
        result.current.setQueuedMessage('test-thread', queuedMessage)
      })
      
      expect(result.current.queuedMessagesByThread['test-thread']).toEqual(queuedMessage)
      
      act(() => {
        // Phase 2: Clear the queue (message sent)
        result.current.setQueuedMessage('test-thread', null)
      })
      
      expect(result.current.queuedMessagesByThread['test-thread']).toBeNull()
    })
  })

  /**
   * THREAD CLEANUP TESTS
   * Validates proper memory management and thread lifecycle
   */
  describe('Thread lifecycle and cleanup management', () => {
    test('CLEANUP SINGLE: should clear all state for a specific thread without affecting others', () => {
      // GOAL: Validate complete thread cleanup doesn't affect other threads
      
      const { result } = renderHook(() => useAppState())
      
      // SETUP: Create comprehensive state for multiple threads
      const thread1Message = createMockThreadMessage('msg1', 'Thread 1 content')
      const thread2Message = createMockThreadMessage('msg2', 'Thread 2 content')
      const thread1Speed = createMockTokenSpeed(50)
      const thread2Speed = createMockTokenSpeed(75)
      
      act(() => {
        // Set up full state for both threads
        result.current.updateStreamingContent('thread-1', thread1Message)
        result.current.updateStreamingContent('thread-2', thread2Message)
        result.current.updateTokenSpeed('thread-1', thread1Speed)
        result.current.updateTokenSpeed('thread-2', thread2Speed)
        result.current.setThreadError('thread-1', 'Thread 1 error')
        result.current.setThreadError('thread-2', 'Thread 2 error')
        result.current.setQueuedMessage('thread-1', 'Thread 1 queue')
        result.current.setQueuedMessage('thread-2', 'Thread 2 queue')
        
        // WHEN: Clear only thread-1
        result.current.clearThread('thread-1')
      })
      
      // THEN: Thread-1 should be completely cleared
      expect(result.current.streamingContentByThread['thread-1']).toBeUndefined()
      expect(result.current.tokenSpeedByThread['thread-1']).toBeUndefined()
      expect(result.current.errorsByThread['thread-1']).toBeUndefined()
      expect(result.current.queuedMessagesByThread['thread-1']).toBeUndefined()
      
      // AND: Thread-2 should remain completely intact
      expect(result.current.streamingContentByThread['thread-2']).toEqual(thread2Message)
      expect(result.current.tokenSpeedByThread['thread-2']).toEqual(thread2Speed)
      expect(result.current.errorsByThread['thread-2']).toEqual('Thread 2 error')
      expect(result.current.queuedMessagesByThread['thread-2']).toEqual('Thread 2 queue')
    })

    test('CLEANUP ALL: should clear all threads when global cleanup is triggered', () => {
      // GOAL: Validate global cleanup clears everything
      
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        // SETUP: Create state for multiple threads
        result.current.updateStreamingContent('thread-1', createMockThreadMessage('msg1', 'Test 1'))
        result.current.updateStreamingContent('thread-2', createMockThreadMessage('msg2', 'Test 2'))
        result.current.setThreadError('thread-1', 'Error 1')
        result.current.setQueuedMessage('thread-2', 'Queue 2')
        
        // WHEN: Global cleanup
        result.current.clearAllThreads()
      })
      
      // THEN: All thread state should be cleared
      expect(Object.keys(result.current.streamingContentByThread)).toHaveLength(0)
      expect(Object.keys(result.current.tokenSpeedByThread)).toHaveLength(0)
      expect(Object.keys(result.current.errorsByThread)).toHaveLength(0)
      expect(Object.keys(result.current.queuedMessagesByThread)).toHaveLength(0)
    })

    test('CLEANUP RESILIENCE: should handle cleanup of non-existent threads gracefully', () => {
      // GOAL: Ensure cleanup is safe even for threads that don't exist
      
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        // SETUP: Create state for one thread
        result.current.updateStreamingContent('existing-thread', createMockThreadMessage('msg1', 'Test'))
        
        // WHEN: Try to clear a non-existent thread (should not throw)
        result.current.clearThread('non-existent-thread')
      })
      
      // THEN: Existing thread should be unaffected, no errors should occur
      expect(result.current.streamingContentByThread['existing-thread']).toBeDefined()
      expect(() => result.current.clearThread('another-non-existent-thread')).not.toThrow()
    })
  })

  /**
   * CONCURRENCY AND RACE CONDITION TESTS
   * Validates that rapid operations don't cause state corruption
   */
  describe('Concurrent operations and race condition prevention', () => {
    test('RAPID UPDATES: should handle rapid state updates across multiple threads without corruption', () => {
      // GOAL: Simulate high-frequency updates that could cause race conditions
      
      const { result } = renderHook(() => useAppState())
      
      const messages = Array.from({ length: 20 }, (_, i) => 
        createMockThreadMessage(`rapid-msg-${i}`, `Rapid message ${i}`)
      )
      
      act(() => {
        // WHEN: Rapidly updating different threads
        messages.forEach((message, i) => {
          const threadId = `thread-${i % 4}` // Distribute across 4 threads
          result.current.updateStreamingContent(threadId, message)
          result.current.setQueuedMessage(threadId, `Queue ${i}`)
        })
      })
      
      // THEN: Each thread should have its latest message (no corruption)
      expect(result.current.streamingContentByThread['thread-0']).toEqual(messages[16]) // Last message for thread-0 (index 16)
      expect(result.current.queuedMessagesByThread['thread-0']).toEqual('Queue 16')
      expect(result.current.streamingContentByThread['thread-1']).toEqual(messages[17]) // Last message for thread-1 (index 17)
      expect(result.current.queuedMessagesByThread['thread-1']).toEqual('Queue 17')
    })

    test('MIXED OPERATIONS: should maintain consistency during complex operation sequences', () => {
      // GOAL: Test realistic sequences of mixed operations
      
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        // WHEN: Performing complex sequence of operations
        result.current.updateStreamingContent('complex-thread', createMockThreadMessage('msg1', 'First'))
        result.current.setThreadError('complex-thread', 'Initial error')
        result.current.updateStreamingContent('complex-thread', createMockThreadMessage('msg2', 'Second'))
        result.current.setQueuedMessage('complex-thread', 'Queued message')
        result.current.setThreadError('complex-thread', undefined) // Clear error
        result.current.updateStreamingContent('complex-thread', undefined) // Clear streaming
      })
      
      // THEN: Final state should be consistent with operation sequence
      expect(result.current.streamingContentByThread['complex-thread']).toBeUndefined()
      expect(result.current.errorsByThread['complex-thread']).toBeUndefined()
      expect(result.current.queuedMessagesByThread['complex-thread']).toEqual('Queued message')
    })
  })

  /**
   * EDGE CASES AND ERROR RESILIENCE
   * Validates system handles unusual inputs and conditions gracefully
   */
  describe('Edge cases and system resilience', () => {
    test('UNUSUAL INPUTS: should handle empty and special character thread IDs', () => {
      // GOAL: Ensure system works with unusual but valid thread IDs
      
      const { result } = renderHook(() => useAppState())
      
      const specialThreadIds = [
        '', // Empty string
        'thread-with-special-chars!@#$%^&*()',
        'thread with spaces',
        '🔥-emoji-thread-🚀',
        'very-long-thread-id-'.repeat(10) // Long ID
      ]
      
      act(() => {
        specialThreadIds.forEach((threadId, i) => {
          const message = createMockThreadMessage(`msg-${i}`, `Message for ${threadId || 'empty'}`)
          result.current.updateStreamingContent(threadId, message)
        })
      })
      
      // THEN: All special thread IDs should work correctly
      specialThreadIds.forEach((threadId) => {
        expect(result.current.streamingContentByThread[threadId]).toBeDefined()
      })
    })

    test('NULL SAFETY: should handle undefined and null values without throwing errors', () => {
      // GOAL: Ensure system is robust against null/undefined values
      
      const { result } = renderHook(() => useAppState())
      
      expect(() => {
        act(() => {
          // These operations should not throw
          result.current.updateStreamingContent('test-thread', undefined)
          result.current.updateTokenSpeed('test-thread', undefined)
          result.current.setThreadError('test-thread', undefined)
          result.current.setQueuedMessage('test-thread', null)
        })
      }).not.toThrow()
      
      // Verify safe handling
      expect(result.current.streamingContentByThread['test-thread']).toBeUndefined()
      expect(result.current.queuedMessagesByThread['test-thread']).toBeNull()
    })
  })
})
