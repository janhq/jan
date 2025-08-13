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
 * SIMPLE CLEAN TESTS FOR SEPARATE METHODS APPROACH
 * 
 * These tests validate that:
 * 1. Legacy methods work exactly as before (backward compatibility)
 * 2. New thread-aware methods work independently 
 * 3. Both can be used together without conflicts
 */

const createMockThreadMessage = (id: string, content: string): ThreadMessage => ({
  id,
  thread_id: 'test-thread',
  content: [{ type: 'text', text: { value: content } }] as any,
  role: 'assistant' as any,
  created_at: Date.now(),
  updated_at: Date.now(),
  status: 'ready' as any,
  metadata: {}
})

describe('useAppState - Separate Methods Approach (Clean)', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  describe('Legacy API Backward Compatibility', () => {
    test('legacy updateStreamingContent should work unchanged', () => {
      const { result } = renderHook(() => useAppState())
      
      const content = createMockThreadMessage('legacy', 'Legacy streaming content')
      
      act(() => {
        result.current.updateStreamingContent(content)
      })
      
      expect(result.current.streamingContent).toMatchObject({
        ...content,
        metadata: expect.objectContaining({
          assistant: expect.any(Object)
        })
      })
    })

    test('legacy setQueuedMessage should work unchanged', () => {
      const { result } = renderHook(() => useAppState())
      
      const message = 'Legacy queued message'
      
      act(() => {
        result.current.setQueuedMessage(message)
      })
      
      expect(result.current.queuedMessage).toEqual(message)
      
      act(() => {
        result.current.setQueuedMessage(null)
      })
      
      expect(result.current.queuedMessage).toBeNull()
    })

    test('legacy resetTokenSpeed should work unchanged', () => {
      const { result } = renderHook(() => useAppState())
      
      const message = createMockThreadMessage('token', 'Token message')
      
      act(() => {
        result.current.updateTokenSpeed(message)
        result.current.resetTokenSpeed()
      })
      
      expect(result.current.tokenSpeed).toBeUndefined()
    })
  })

  describe('New Thread-Aware API', () => {
    test('updateThreadStreamingContent should work independently per thread', () => {
      const { result } = renderHook(() => useAppState())
      
      const content1 = createMockThreadMessage('msg1', 'Thread 1 content')
      const content2 = createMockThreadMessage('msg2', 'Thread 2 content')
      
      act(() => {
        result.current.updateThreadStreamingContent('thread-1', content1)
        result.current.updateThreadStreamingContent('thread-2', content2)
      })
      
      expect(result.current.streamingContentByThread['thread-1']).toEqual(content1)
      expect(result.current.streamingContentByThread['thread-2']).toEqual(content2)
      
      // Clear one thread, other should remain
      act(() => {
        result.current.updateThreadStreamingContent('thread-1', undefined)
      })
      
      expect(result.current.streamingContentByThread['thread-1']).toBeUndefined()
      expect(result.current.streamingContentByThread['thread-2']).toEqual(content2)
    })

    test('addToThreadQueue should work independently per thread', () => {
      const { result } = renderHook(() => useAppState())
      
      const message1 = 'Queued for thread 1'
      const message2 = 'Queued for thread 2'
      
      act(() => {
        result.current.addToThreadQueue('thread-1', message1)
        result.current.addToThreadQueue('thread-2', message2)
      })
      
      expect(result.current.queuedMessagesByThread['thread-1']).toEqual([message1])
      expect(result.current.queuedMessagesByThread['thread-2']).toEqual([message2])
      
      act(() => {
        result.current.clearThreadQueue('thread-1')
      })
      
      expect(result.current.queuedMessagesByThread['thread-1']).toEqual([])
      expect(result.current.queuedMessagesByThread['thread-2']).toEqual([message2])
    })

    test('setThreadError should work independently per thread', () => {
      const { result } = renderHook(() => useAppState())
      
      const error1 = 'Thread 1 error'
      const error2 = { message: 'Thread 2 complex error', code: 500 }
      
      act(() => {
        result.current.setThreadError('thread-1', error1)
        result.current.setThreadError('thread-2', error2)
      })
      
      expect(result.current.errorsByThread['thread-1']).toEqual(error1)
      expect(result.current.errorsByThread['thread-2']).toEqual(error2)
    })

    test('clearThread should clean up all state for specific thread', () => {
      const { result } = renderHook(() => useAppState())
      
      const content = createMockThreadMessage('cleanup', 'Content to cleanup')
      const error = 'Error to cleanup'
      const queuedMessage = 'Message to cleanup'
      
      act(() => {
        result.current.updateThreadStreamingContent('cleanup-thread', content)
        result.current.setThreadError('cleanup-thread', error)
        result.current.addToThreadQueue('cleanup-thread', queuedMessage)
        
        // Other thread should remain
        result.current.addToThreadQueue('other-thread', 'Other message')
      })
      
      act(() => {
        result.current.clearThread('cleanup-thread')
      })
      
      // Cleanup thread should be completely cleared
      expect(result.current.streamingContentByThread['cleanup-thread']).toBeUndefined()
      expect(result.current.errorsByThread['cleanup-thread']).toBeUndefined()
      expect(result.current.queuedMessagesByThread['cleanup-thread']).toBeUndefined()
      
      // Other thread should remain intact
      expect(result.current.queuedMessagesByThread['other-thread']).toEqual(['Other message'])
    })
  })

  describe('Legacy and New API Coexistence', () => {
    test('should handle legacy and new APIs being used simultaneously', () => {
      const { result } = renderHook(() => useAppState())
      
      const legacyContent = createMockThreadMessage('legacy', 'Legacy content')
      const threadContent = createMockThreadMessage('thread', 'Thread content')
      
      act(() => {
        // Use legacy API for global state
        result.current.updateStreamingContent(legacyContent)
        result.current.setQueuedMessage('Global queued message')
        
        // Use new API for thread-specific state
        result.current.updateThreadStreamingContent('specific-thread', threadContent)
        result.current.addToThreadQueue('specific-thread', 'Thread queued message')
      })
      
      // Both should work independently
      expect(result.current.streamingContent).toMatchObject({
        ...legacyContent,
        metadata: expect.objectContaining({
          assistant: expect.any(Object)
        })
      })
      expect(result.current.queuedMessage).toEqual('Global queued message')
      
      expect(result.current.streamingContentByThread['specific-thread']).toEqual(threadContent)
      expect(result.current.queuedMessagesByThread['specific-thread']).toEqual(['Thread queued message'])
    })
  })

  describe('Convenience Hooks Integration', () => {
    test('convenience hooks should work with new thread-aware methods', () => {
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: streamingResult, rerender } = renderHook(() => useStreamingContent('hook-thread'))
      
      const content = createMockThreadMessage('hook', 'Hook test content')
      
      act(() => {
        appStateResult.current.updateThreadStreamingContent('hook-thread', content)
      })
      rerender()
      
      expect(streamingResult.current).toEqual(content)
    })
  })
})
