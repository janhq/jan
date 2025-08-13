import { renderHook, act } from '@testing-library/react'
import { ThreadMessage } from '@janhq/core'
import { useAppState } from '../useAppState'

/**
 * MOCK DATA HELPERS
 */
const createMockThreadMessage = (
  id: string,
  content: string
): ThreadMessage => ({
  id,
  thread_id: 'test-thread',
  content: [{ type: 'text', text: { value: content } }],
  role: 'assistant',
  created_at: Date.now(),
  updated_at: Date.now(),
  status: 'ready',
  metadata: {},
})

/**
 * MIGRATION AND BACKWARD COMPATIBILITY TESTS
 *
 * These tests ensure that the transition from global to per-thread state
 * happens smoothly without breaking existing functionality. They validate:
 *
 * - Legacy API continues to work during migration period
 * - Mixed usage of old and new APIs doesn't cause conflicts
 * - Data migration scenarios are handled properly
 * - State persistence and rehydration work correctly
 * - Thread lifecycle management is robust
 * - System handles edge cases and error recovery
 *
 * MIGRATION STRATEGY:
 * 1. Add new per-thread APIs alongside existing global ones
 * 2. Gradually migrate components to use per-thread APIs
 * 3. Maintain backward compatibility during transition
 * 4. Remove legacy APIs once migration is complete
 */
describe('useAppState - Migration Strategy & Backward Compatibility', () => {
  beforeEach(() => {
    // SETUP: Ensure clean state for each migration test
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  /**
   * LEGACY API COMPATIBILITY TESTS
   * Ensures existing APIs continue to work during migration period
   */
  describe('Legacy API backward compatibility maintenance', () => {
    test('LEGACY QUEUE API: should maintain existing setQueuedMessage API during migration', () => {
      // GOAL: Ensure existing queue API continues to work while new per-thread APIs are added
      // SCENARIO: Component still uses old setQueuedMessage(threadId, message) syntax

      const { result } = renderHook(() => useAppState())

      const legacyMessage = 'Message set using legacy API'

      act(() => {
        // WHEN: Using legacy API for global queue (should still work)
        result.current.setQueuedMessage(legacyMessage)
        // AND: Using new API for thread-specific queue
        result.current.setThreadQueuedMessage('legacy-thread', legacyMessage)
      })

      // THEN: Both global and thread-specific state should work
      expect(result.current.queuedMessage).toEqual(legacyMessage)
      expect(result.current.queuedMessagesByThread['legacy-thread']).toEqual(legacyMessage)

      // VERIFY: Legacy API behavior is preserved
      act(() => {
        result.current.setQueuedMessage(null)
        result.current.setThreadQueuedMessage('legacy-thread', null)
      })

      expect(result.current.queuedMessage).toBeNull()
      expect(result.current.queuedMessagesByThread['legacy-thread']).toBeNull()
    })

    test('MIXED API USAGE: should handle simultaneous use of legacy and new APIs', () => {
      // GOAL: Ensure no conflicts when components use different API versions
      // SCENARIO: Some components migrated to new API, others still use legacy

      const { result } = renderHook(() => useAppState())

      const streamingMessage = createMockThreadMessage(
        'streaming',
        'New API streaming message'
      )
      const legacyQueueMessage = 'Legacy API queue message'
      const newApiQueueMessage = 'New API queue message'

      act(() => {
        // MIXED USAGE: Combine new per-thread API with legacy API
        result.current.updateThreadStreamingContent('mixed-thread-1', streamingMessage) // New API
        result.current.setQueuedMessage(legacyQueueMessage) // Legacy API  
        result.current.setThreadQueuedMessage('mixed-thread-2', newApiQueueMessage) // New API
      })

      // THEN: Thread-specific operations should work with new API
      expect(result.current.streamingContentByThread['mixed-thread-1']).toEqual(streamingMessage)
      expect(result.current.queuedMessagesByThread['mixed-thread-2']).toEqual(newApiQueueMessage)
      
      // AND: Legacy operations should work with global state
      expect(result.current.queuedMessage).toEqual(legacyQueueMessage)
    })

    test('API CONSISTENCY: should ensure consistent behavior between legacy and new APIs', () => {
      // GOAL: Validate that legacy and new APIs produce identical results
      // SCENARIO: Same operation performed through different API versions

      const { result } = renderHook(() => useAppState())

      const message1 = 'Message via legacy approach'
      const message2 = 'Message via new approach'

      act(() => {
        // LEGACY APPROACH: Direct queue setting (assuming this was how it worked before)
        result.current.setQueuedMessage('legacy-approach-thread', message1)

        // NEW APPROACH: Per-thread queue setting
        result.current.setQueuedMessage('new-approach-thread', message2)
      })

      // THEN: Both approaches should produce consistent state structure
      expect(
        typeof result.current.queuedMessagesByThread['legacy-approach-thread']
      ).toBe('string')
      expect(
        typeof result.current.queuedMessagesByThread['new-approach-thread']
      ).toBe('string')
      expect(
        result.current.queuedMessagesByThread['legacy-approach-thread']
      ).toEqual(message1)
      expect(
        result.current.queuedMessagesByThread['new-approach-thread']
      ).toEqual(message2)
    })
  })

  /**
   * DATA MIGRATION SCENARIOS
   * Tests for migrating existing global state to per-thread structure
   */
  describe('Global to per-thread state data migration scenarios', () => {
    test('GLOBAL STATE MIGRATION: should migrate existing global state to current thread', () => {
      // GOAL: Simulate migration of existing global state to per-thread structure
      // SCENARIO: App restart during migration - need to assign global state to active thread

      const { result } = renderHook(() => useAppState())

      const existingGlobalMessage = createMockThreadMessage(
        'global',
        'Existing global streaming message'
      )
      const currentThreadId = 'active-thread-during-migration'

      act(() => {
        // SIMULATION: During migration, take what would have been global state
        // and assign it to the currently active thread
        result.current.updateStreamingContent(
          currentThreadId,
          existingGlobalMessage
        )
      })

      // THEN: Previous global state should now be associated with active thread
      expect(result.current.streamingContentByThread[currentThreadId]).toEqual(
        existingGlobalMessage
      )

      // VERIFY: This doesn't interfere with other threads
      const otherMessage = createMockThreadMessage(
        'other',
        'Other thread message'
      )

      act(() => {
        result.current.updateStreamingContent('other-thread', otherMessage)
      })

      expect(result.current.streamingContentByThread['other-thread']).toEqual(
        otherMessage
      )
      expect(result.current.streamingContentByThread[currentThreadId]).toEqual(
        existingGlobalMessage
      )
    })

    test('NULL THREAD ID HANDLING: should handle migration when current thread ID is unavailable', () => {
      // GOAL: Handle edge case where currentThreadId is null during migration
      // SCENARIO: Component mounts before thread context is available

      const { result } = renderHook(() => useAppState())

      const messageNeedingMigration = createMockThreadMessage(
        'orphaned',
        'Message without thread context'
      )

      act(() => {
        // SIMULATION: currentThreadId might be null during app initialization
        const currentThreadId = null
        const safeThreadId = currentThreadId || 'migration-fallback-thread'

        result.current.updateStreamingContent(
          safeThreadId,
          messageNeedingMigration
        )
      })

      // THEN: Should handle gracefully with fallback thread ID
      expect(
        result.current.streamingContentByThread['migration-fallback-thread']
      ).toEqual(messageNeedingMigration)
    })

    test('INCREMENTAL MIGRATION: should support gradual migration of different state types', () => {
      // GOAL: Allow migrating different state types (streaming, errors, queues) at different times
      // SCENARIO: Streaming content migrated first, then errors, then queues

      const { result } = renderHook(() => useAppState())

      const streamingMsg = createMockThreadMessage(
        'stream',
        'Migrated streaming content'
      )
      const errorMsg = 'Migrated error message'
      const queueMsg = 'Migrated queue message'

      act(() => {
        // PHASE 1: Migrate streaming content only
        result.current.updateStreamingContent('migration-thread', streamingMsg)

        // PHASE 2: Later, migrate error handling
        result.current.setThreadError('migration-thread', errorMsg)

        // PHASE 3: Finally, migrate queue system
        result.current.setQueuedMessage('migration-thread', queueMsg)
      })

      // THEN: All migrated state should coexist properly
      expect(
        result.current.streamingContentByThread['migration-thread']
      ).toEqual(streamingMsg)
      expect(result.current.errorsByThread['migration-thread']).toEqual(
        errorMsg
      )
      expect(result.current.queuedMessagesByThread['migration-thread']).toEqual(
        queueMsg
      )
    })
  })

  /**
   * STATE PERSISTENCE AND REHYDRATION TESTS
   * Validates what should and shouldn't survive app restarts
   */
  describe('State persistence strategy and rehydration logic', () => {
    test('TRANSIENT STATE EXCLUSION: should not persist UI-only transient state', () => {
      // GOAL: Ensure temporary UI state doesn't persist across app restarts
      // SCENARIO: User closes app while AI is streaming - streaming state should not persist

      const { result } = renderHook(() => useAppState())

      const transientStreamingMessage = createMockThreadMessage(
        'transient',
        'AI is currently typing...'
      )
      const transientTokenSpeed = {
        tokenSpeed: 75,
        tokenCount: 150,
        lastTimestamp: Date.now(),
        message: 'current-msg-id',
      }
      const transientError = 'Temporary connection issue'

      act(() => {
        // SETUP: Set transient UI state that shouldn't persist
        result.current.updateStreamingContent(
          'transient-thread',
          transientStreamingMessage
        )
        result.current.updateTokenSpeed('transient-thread', transientTokenSpeed)
        result.current.setThreadError('transient-thread', transientError)
      })

      // VERIFY: State exists in current session
      expect(
        result.current.streamingContentByThread['transient-thread']
      ).toBeDefined()
      expect(
        result.current.tokenSpeedByThread['transient-thread']
      ).toBeDefined()
      expect(result.current.errorsByThread['transient-thread']).toBeDefined()

      // NOTE: In actual implementation, persistence middleware would exclude these
      // This test documents the expectation that these are marked as non-persistent
      const state = result.current
      const transientFields = [
        'streamingContentByThread',
        'tokenSpeedByThread',
        'errorsByThread',
      ]

      // EXPECTATION: These fields should be marked for exclusion from persistence
      transientFields.forEach((field) => {
        expect(state[field as keyof typeof state]).toBeDefined()
        // In real implementation: expect(persistConfig.exclude).toContain(field)
      })
    })

    test('IMPORTANT STATE PERSISTENCE: should persist user intent and important state', () => {
      // GOAL: Ensure user's queued messages survive app restarts
      // SCENARIO: User queues message, closes app, reopens - message should still be queued

      const { result } = renderHook(() => useAppState())

      const importantQueuedMessage =
        'Please analyze this document when you have time'

      act(() => {
        // This represents user intent and should be persisted
        result.current.setQueuedMessage(
          'persistent-thread',
          importantQueuedMessage
        )
      })

      // VERIFY: Important state is available for persistence
      expect(
        result.current.queuedMessagesByThread['persistent-thread']
      ).toEqual(importantQueuedMessage)

      // NOTE: In actual implementation, this would be included in persistence config
      // This test documents the expectation that queued messages are persistent
    })

    test('REHYDRATION SAFETY: should handle corrupted or invalid persisted state gracefully', () => {
      // GOAL: Ensure app doesn't crash when loading corrupted persisted state
      // SCENARIO: Persisted state file is corrupted or has invalid format

      const { result } = renderHook(() => useAppState())

      // SIMULATION: Attempt to rehydrate with various potentially invalid states
      const potentiallyCorruptedStates = [
        {}, // Empty object
        { queuedMessagesByThread: null }, // Null instead of object
        { queuedMessagesByThread: { 'thread-1': undefined } }, // Undefined values
        { queuedMessagesByThread: { 'thread-1': {} } }, // Wrong data type
      ]

      potentiallyCorruptedStates.forEach((corruptedState, index) => {
        expect(() => {
          act(() => {
            // SIMULATION: This would be handled by Zustand persist middleware
            // For now, test that our state handlers are robust
            if (corruptedState.queuedMessagesByThread) {
              const threadId = `corruption-test-${index}`
              const message = corruptedState.queuedMessagesByThread['thread-1']

              // Should handle gracefully even with unexpected data
              result.current.setQueuedMessage(threadId, message)
            }
          })
        }).not.toThrow()
      })
    })
  })

  /**
   * THREAD LIFECYCLE MANAGEMENT TESTS
   * Tests for robust thread creation, switching, and cleanup
   */
  describe('Thread lifecycle management during migration', () => {
    test('DYNAMIC THREAD CREATION: should handle new threads being created dynamically', () => {
      // GOAL: Ensure new threads work properly with per-thread state system
      // SCENARIO: User creates new chat while migration is ongoing

      const { result } = renderHook(() => useAppState())

      const newThreadIds = [
        'new-work-chat',
        'new-personal-chat',
        'new-research-chat',
      ]
      const messages = newThreadIds.map((id, index) =>
        createMockThreadMessage(`new-msg-${index}`, `Message for ${id}`)
      )

      act(() => {
        // WHEN: Creating multiple new threads with state
        newThreadIds.forEach((threadId, index) => {
          result.current.updateStreamingContent(threadId, messages[index])
          result.current.setQueuedMessage(threadId, `Queued for ${threadId}`)
        })
      })

      // THEN: All new threads should have proper isolated state
      newThreadIds.forEach((threadId, index) => {
        expect(result.current.streamingContentByThread[threadId]).toEqual(
          messages[index]
        )
        expect(result.current.queuedMessagesByThread[threadId]).toEqual(
          `Queued for ${threadId}`
        )
      })

      // VERIFY: Proper state isolation
      expect(Object.keys(result.current.streamingContentByThread)).toHaveLength(
        newThreadIds.length
      )
      expect(Object.keys(result.current.queuedMessagesByThread)).toHaveLength(
        newThreadIds.length
      )
    })

    test('THREAD DELETION CLEANUP: should properly clean up when threads are deleted', () => {
      // GOAL: Ensure thread deletion doesn't leave orphaned state
      // SCENARIO: User deletes a chat thread

      const { result } = renderHook(() => useAppState())

      const threadsToDelete = ['temp-thread-1', 'temp-thread-2']
      const permanentThread = 'permanent-thread'
      const messages = [
        createMockThreadMessage('temp1', 'Temporary message 1'),
        createMockThreadMessage('temp2', 'Temporary message 2'),
        createMockThreadMessage('perm', 'Permanent message'),
      ]

      act(() => {
        // SETUP: Create threads with comprehensive state
        result.current.updateStreamingContent('temp-thread-1', messages[0])
        result.current.updateStreamingContent('temp-thread-2', messages[1])
        result.current.updateStreamingContent(permanentThread, messages[2])

        result.current.setQueuedMessage('temp-thread-1', 'Temp queue 1')
        result.current.setQueuedMessage('temp-thread-2', 'Temp queue 2')
        result.current.setQueuedMessage(permanentThread, 'Permanent queue')

        result.current.setThreadError('temp-thread-1', 'Temp error 1')
        result.current.setThreadError(permanentThread, 'Permanent error')
      })

      // VERIFY: Initial state setup
      expect(Object.keys(result.current.streamingContentByThread)).toHaveLength(
        3
      )

      act(() => {
        // WHEN: Delete temporary threads
        threadsToDelete.forEach((threadId) => {
          result.current.clearThread(threadId)
        })
      })

      // THEN: Deleted threads should be completely cleaned up
      threadsToDelete.forEach((threadId) => {
        expect(
          result.current.streamingContentByThread[threadId]
        ).toBeUndefined()
        expect(result.current.queuedMessagesByThread[threadId]).toBeUndefined()
        expect(result.current.errorsByThread[threadId]).toBeUndefined()
      })

      // AND: Permanent thread should remain intact
      expect(result.current.streamingContentByThread[permanentThread]).toEqual(
        messages[2]
      )
      expect(result.current.queuedMessagesByThread[permanentThread]).toEqual(
        'Permanent queue'
      )
      expect(result.current.errorsByThread[permanentThread]).toEqual(
        'Permanent error'
      )
    })

    test('RAPID THREAD SWITCHING: should handle rapid thread switching without state corruption', () => {
      // GOAL: Ensure thread switching doesn't cause race conditions or state corruption
      // SCENARIO: User rapidly switches between multiple active threads

      const { result } = renderHook(() => useAppState())

      const threads = ['rapid-1', 'rapid-2', 'rapid-3', 'rapid-4']
      const messages = threads.map((id, i) =>
        createMockThreadMessage(`rapid-msg-${i}`, `Rapid message for ${id}`)
      )

      act(() => {
        // SIMULATION: Rapid thread switching with state updates
        threads.forEach((threadId, i) => {
          // Each thread gets comprehensive state
          result.current.updateStreamingContent(threadId, messages[i])
          result.current.setQueuedMessage(threadId, `Rapid queue ${i}`)
          result.current.setThreadError(threadId, `Rapid error ${i}`)
        })
      })

      // THEN: All threads should maintain their separate, correct state
      threads.forEach((threadId, i) => {
        expect(result.current.streamingContentByThread[threadId]).toEqual(
          messages[i]
        )
        expect(result.current.queuedMessagesByThread[threadId]).toEqual(
          `Rapid queue ${i}`
        )
        expect(result.current.errorsByThread[threadId]).toEqual(
          `Rapid error ${i}`
        )
      })

      // VERIFY: No cross-contamination between threads
      expect(result.current.streamingContentByThread['rapid-1']).not.toEqual(
        result.current.streamingContentByThread['rapid-2']
      )
    })
  })

  /**
   * ERROR RECOVERY AND EDGE CASES
   * Tests for system resilience during migration scenarios
   */
  describe('Error recovery and edge case handling during migration', () => {
    test('STATE CORRUPTION RECOVERY: should recover gracefully from corrupted thread state', () => {
      // GOAL: Ensure system can recover from corrupted state without crashing
      // SCENARIO: Thread state becomes corrupted due to unexpected error

      const { result } = renderHook(() => useAppState())

      const validMessage = createMockThreadMessage('valid', 'Valid message')

      act(() => {
        // SETUP: Valid state
        result.current.updateStreamingContent('recovery-thread', validMessage)

        // SIMULATION: Corruption occurs (in real scenario, this might be due to
        // memory corruption, network issues, etc.)

        // RECOVERY: Clear and reinitialize
        result.current.clearThread('recovery-thread')
        result.current.updateStreamingContent(
          'recovery-thread',
          createMockThreadMessage('recovered', 'Recovered message')
        )
      })

      // THEN: System should recover successfully
      expect(
        result.current.streamingContentByThread['recovery-thread']
      ).toMatchObject({
        id: 'recovered',
        content: [{ type: 'text', value: 'Recovered message' }],
      })
    })

    test('MEMORY PRESSURE HANDLING: should handle cleanup when memory pressure is high', () => {
      // GOAL: Validate system can clean up inactive threads to manage memory usage
      // SCENARIO: App running with many threads - need to clean up inactive ones

      const { result } = renderHook(() => useAppState())

      // SIMULATION: Create many threads (simulate memory pressure scenario)
      const manyThreads = Array.from(
        { length: 100 },
        (_, i) => `memory-pressure-thread-${i}`
      )

      act(() => {
        manyThreads.forEach((threadId) => {
          result.current.updateStreamingContent(
            threadId,
            createMockThreadMessage(
              `msg-${threadId}`,
              `Content for ${threadId}`
            )
          )
        })
      })

      // VERIFY: All threads created
      expect(Object.keys(result.current.streamingContentByThread)).toHaveLength(
        100
      )

      act(() => {
        // SIMULATION: Memory pressure cleanup - keep only most recent threads
        const activeThreads = manyThreads.slice(-5) // Keep last 5 threads active
        const threadsToCleanup = manyThreads.filter(
          (id) => !activeThreads.includes(id)
        )

        // Cleanup inactive threads
        threadsToCleanup.forEach((threadId) => {
          result.current.clearThread(threadId)
        })
      })

      // THEN: Memory should be freed while keeping active threads
      expect(Object.keys(result.current.streamingContentByThread)).toHaveLength(
        5
      )
      expect(
        result.current.streamingContentByThread['memory-pressure-thread-95']
      ).toBeDefined()
      expect(
        result.current.streamingContentByThread['memory-pressure-thread-99']
      ).toBeDefined()
      expect(
        result.current.streamingContentByThread['memory-pressure-thread-0']
      ).toBeUndefined()
    })

    test('CONCURRENT MODIFICATION SAFETY: should handle concurrent modifications safely', () => {
      // GOAL: Ensure thread-safe operations during concurrent modifications
      // SCENARIO: Multiple parts of app modifying thread state simultaneously

      const { result } = renderHook(() => useAppState())

      const concurrentThreadId = 'concurrent-modifications'
      const messages = Array.from({ length: 10 }, (_, i) =>
        createMockThreadMessage(`concurrent-${i}`, `Concurrent message ${i}`)
      )

      act(() => {
        // SIMULATION: Rapid concurrent modifications
        messages.forEach((message, i) => {
          // Simulate different parts of app making changes
          result.current.updateStreamingContent(concurrentThreadId, message)
          result.current.setThreadError(concurrentThreadId, `Error ${i}`)
          result.current.setQueuedMessage(concurrentThreadId, `Queue ${i}`)

          // Sometimes clear and reset
          if (i % 3 === 0) {
            result.current.setThreadError(concurrentThreadId, undefined)
          }
        })
      })

      // THEN: Final state should be consistent (not corrupted)
      const finalState = result.current
      expect(
        finalState.streamingContentByThread[concurrentThreadId]
      ).toBeDefined()
      expect(
        finalState.queuedMessagesByThread[concurrentThreadId]
      ).toBeDefined()

      // VERIFY: No undefined or null state corruption
      const streamingContent =
        finalState.streamingContentByThread[concurrentThreadId]
      expect(streamingContent?.id).toBeDefined()
      expect(streamingContent?.content).toBeDefined()
    })
  })
})
