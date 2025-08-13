import { renderHook, act } from '@testing-library/react'
import { ThreadMessage } from '@janhq/core'
import { useAppState } from '../useAppState'
import { 
  useStreamingContent, 
  useThreadError, 
  useTokenSpeed,
  useQueuedMessage,
  useIsThreadActive,
  useThreadState 
} from '../useThreadState'

/**
 * INTEGRATION TESTS FOR PER-THREAD STATE MANAGEMENT
 * 
 * These tests validate that the complete per-thread system works
 * correctly with real usage patterns and edge cases.
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

describe('Per-Thread State Management - Integration Tests', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  test('FULL LIFECYCLE: complete thread lifecycle with all state types', () => {
    const { result: appStateResult } = renderHook(() => useAppState())
    const { result: threadStateResult, rerender } = renderHook(() => useThreadState('integration-thread'))
    
    const testMessage = createMockThreadMessage('integration', 'Test streaming message')
    const testError = 'Test error message'
    const testQueuedMessage = 'Test queued message'
    const testTokenSpeed = {
      tokenSpeed: 50,
      tokenCount: 100,
      lastTimestamp: Date.now(),
      message: 'test-msg-id'
    }

    act(() => {
      // Set all types of state for one thread
      appStateResult.current.updateStreamingContent('integration-thread', testMessage)
      appStateResult.current.setThreadError('integration-thread', testError)
      appStateResult.current.setQueuedMessage('integration-thread', testQueuedMessage)
      appStateResult.current.updateTokenSpeed('integration-thread', testTokenSpeed)
    })
    rerender()

    // Verify all state is accessible through thread state hook
    expect(threadStateResult.current.streamingContent).toEqual(testMessage)
    expect(threadStateResult.current.error).toEqual(testError)
    expect(threadStateResult.current.queuedMessage).toEqual(testQueuedMessage)
    expect(threadStateResult.current.tokenSpeed).toEqual(testTokenSpeed)
    expect(threadStateResult.current.isActive).toBe(true)

    // Clear everything
    act(() => {
      appStateResult.current.clearThread('integration-thread')
    })
    rerender()

    // Verify complete cleanup
    expect(threadStateResult.current.streamingContent).toBeUndefined()
    expect(threadStateResult.current.error).toBeUndefined()
    expect(threadStateResult.current.queuedMessage).toBeUndefined()
    expect(threadStateResult.current.tokenSpeed).toBeUndefined()
    expect(threadStateResult.current.isActive).toBe(false)
  })

  test('CONCURRENT THREADS: multiple threads with different states', () => {
    const { result: appStateResult } = renderHook(() => useAppState())
    const { result: thread1State, rerender: rerender1 } = renderHook(() => useThreadState('concurrent-1'))
    const { result: thread2State, rerender: rerender2 } = renderHook(() => useThreadState('concurrent-2'))

    const message1 = createMockThreadMessage('msg1', 'Thread 1 message')
    const message2 = createMockThreadMessage('msg2', 'Thread 2 message')

    act(() => {
      // Thread 1: streaming + error
      appStateResult.current.updateStreamingContent('concurrent-1', message1)
      appStateResult.current.setThreadError('concurrent-1', 'Thread 1 error')
      
      // Thread 2: queued message only
      appStateResult.current.setQueuedMessage('concurrent-2', 'Thread 2 queued')
    })
    rerender1()
    rerender2()

    // Thread 1 should have streaming + error
    expect(thread1State.current.streamingContent).toEqual(message1)
    expect(thread1State.current.error).toEqual('Thread 1 error')
    expect(thread1State.current.queuedMessage).toBeUndefined()
    expect(thread1State.current.isActive).toBe(true)

    // Thread 2 should have queued message only
    expect(thread2State.current.streamingContent).toBeUndefined()
    expect(thread2State.current.error).toBeUndefined()
    expect(thread2State.current.queuedMessage).toEqual('Thread 2 queued')
    expect(thread2State.current.isActive).toBe(false)
  })

  test('BACKWARD COMPATIBILITY: legacy and new APIs work together', () => {
    const { result: appStateResult } = renderHook(() => useAppState())
    
    const legacyMessage = createMockThreadMessage('legacy', 'Legacy message')
    const newMessage = createMockThreadMessage('new', 'New API message')

    act(() => {
      // Use legacy API (single parameter)
      appStateResult.current.updateStreamingContent(legacyMessage)
      appStateResult.current.setQueuedMessage('legacy queue message')
      
      // Use new API (threadId parameter)
      appStateResult.current.updateStreamingContent('new-api-thread', newMessage)
      appStateResult.current.setQueuedMessage('new-api-thread', 'new api queue message')
    })

    // Legacy API should update global state (with assistant metadata added)
    expect(appStateResult.current.streamingContent).toMatchObject({
      ...legacyMessage,
      metadata: expect.objectContaining({
        assistant: expect.any(Object)
      })
    })
    expect(appStateResult.current.queuedMessage).toEqual('legacy queue message')

    // New API should update thread-specific state
    expect(appStateResult.current.streamingContentByThread['new-api-thread']).toEqual(newMessage)
    expect(appStateResult.current.queuedMessagesByThread['new-api-thread']).toEqual('new api queue message')
  })
})
