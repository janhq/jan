import { renderHook, act } from '@testing-library/react'
import { useAppState } from '../useAppState'
import { useQueuedMessages, useThreadQueueLength } from '../useThreadState'

/**
 * ENHANCED QUEUE SYSTEM TESTS
 * 
 * Tests for the new multi-message, per-thread queue system that removes
 * the previous limitations:
 * - Multiple messages can be queued per thread
 * - Queues persist when switching threads  
 * - Input remains always enabled
 * - Enhanced queue display and management
 */

describe('Enhanced Multi-Message Queue System', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.clearAllThreads()
    })
  })

  describe('Multi-Message Queue Per Thread', () => {
    test('should allow multiple messages to be queued in same thread', () => {
      const { result } = renderHook(() => useAppState())
      
      const messages = [
        'First queued message',
        'Second queued message', 
        'Third queued message'
      ]
      
      act(() => {
        messages.forEach(message => {
          result.current.addToThreadQueue('multi-queue-thread', message)
        })
      })
      
      const queuedMessages = result.current.queuedMessagesByThread['multi-queue-thread']
      expect(queuedMessages).toHaveLength(3)
      expect(queuedMessages).toEqual(messages)
      expect(result.current.getThreadQueueLength('multi-queue-thread')).toBe(3)
    })

    test('should process queue in FIFO order', () => {
      const { result } = renderHook(() => useAppState())
      
      const messages = ['First', 'Second', 'Third']
      
      act(() => {
        messages.forEach(message => {
          result.current.addToThreadQueue('fifo-thread', message)
        })
      })
      
      // Process messages in order
      const firstMessage = result.current.removeFromThreadQueue('fifo-thread')
      expect(firstMessage).toBe('First')
      expect(result.current.getThreadQueueLength('fifo-thread')).toBe(2)
      
      const secondMessage = result.current.removeFromThreadQueue('fifo-thread')
      expect(secondMessage).toBe('Second')
      expect(result.current.getThreadQueueLength('fifo-thread')).toBe(1)
      
      const thirdMessage = result.current.removeFromThreadQueue('fifo-thread')
      expect(thirdMessage).toBe('Third')
      expect(result.current.getThreadQueueLength('fifo-thread')).toBe(0)
      
      // No more messages
      const noMessage = result.current.removeFromThreadQueue('fifo-thread')
      expect(noMessage).toBeUndefined()
    })
  })

  describe('Thread Isolation and Persistence', () => {
    test('should maintain separate queues for different threads', () => {
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        result.current.addToThreadQueue('work-thread', 'Work message 1')
        result.current.addToThreadQueue('work-thread', 'Work message 2')
        result.current.addToThreadQueue('personal-thread', 'Personal message 1')
        result.current.addToThreadQueue('personal-thread', 'Personal message 2')
        result.current.addToThreadQueue('personal-thread', 'Personal message 3')
      })
      
      expect(result.current.getThreadQueueLength('work-thread')).toBe(2)
      expect(result.current.getThreadQueueLength('personal-thread')).toBe(3)
      
      // Verify queue contents
      expect(result.current.queuedMessagesByThread['work-thread']).toEqual([
        'Work message 1',
        'Work message 2'
      ])
      expect(result.current.queuedMessagesByThread['personal-thread']).toEqual([
        'Personal message 1',
        'Personal message 2', 
        'Personal message 3'
      ])
    })

    test('should persist queues when simulating thread switches', () => {
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        // User is on thread-1, queues messages
        result.current.addToThreadQueue('thread-1', 'Message while on thread 1')
        result.current.addToThreadQueue('thread-1', 'Another message on thread 1')
        
        // User switches to thread-2, queues different messages
        result.current.addToThreadQueue('thread-2', 'Message while on thread 2')
        
        // User switches back to thread-1
        // Queue should still be there (no cleanup)
      })
      
      // Verify thread-1 queue persisted
      expect(result.current.getThreadQueueLength('thread-1')).toBe(2)
      expect(result.current.queuedMessagesByThread['thread-1']).toEqual([
        'Message while on thread 1',
        'Another message on thread 1'
      ])
      
      // Verify thread-2 queue also exists
      expect(result.current.getThreadQueueLength('thread-2')).toBe(1)
      expect(result.current.queuedMessagesByThread['thread-2']).toEqual([
        'Message while on thread 2'
      ])
    })
  })

  describe('Queue Management Operations', () => {
    test('should support clearing entire thread queue', () => {
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        result.current.addToThreadQueue('clear-test-thread', 'Message 1')
        result.current.addToThreadQueue('clear-test-thread', 'Message 2')
        result.current.addToThreadQueue('clear-test-thread', 'Message 3')
      })
      
      expect(result.current.getThreadQueueLength('clear-test-thread')).toBe(3)
      
      act(() => {
        result.current.clearThreadQueue('clear-test-thread')
      })
      
      expect(result.current.getThreadQueueLength('clear-test-thread')).toBe(0)
      expect(result.current.queuedMessagesByThread['clear-test-thread']).toEqual([])
    })

    test('should handle empty queue operations gracefully', () => {
      const { result } = renderHook(() => useAppState())
      
      // Operations on empty queue should not throw
      expect(() => {
        const message = result.current.removeFromThreadQueue('empty-thread')
        expect(message).toBeUndefined()
        
        const length = result.current.getThreadQueueLength('empty-thread') 
        expect(length).toBe(0)
        
        result.current.clearThreadQueue('empty-thread')
      }).not.toThrow()
    })
  })

  describe('Convenience Hooks Integration', () => {
    test('useQueuedMessages hook should return current queue for thread', () => {
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: queueResult, rerender } = renderHook(() => useQueuedMessages('hook-thread'))
      
      act(() => {
        appStateResult.current.addToThreadQueue('hook-thread', 'Hooked message 1')
        appStateResult.current.addToThreadQueue('hook-thread', 'Hooked message 2')
      })
      rerender()
      
      expect(queueResult.current).toEqual(['Hooked message 1', 'Hooked message 2'])
    })

    test('useThreadQueueLength hook should return current queue length', () => {
      const { result: appStateResult } = renderHook(() => useAppState())
      const { result: lengthResult, rerender } = renderHook(() => useThreadQueueLength('length-thread'))
      
      // Initially 0
      expect(lengthResult.current).toBe(0)
      
      act(() => {
        appStateResult.current.addToThreadQueue('length-thread', 'Message 1')
        appStateResult.current.addToThreadQueue('length-thread', 'Message 2')
      })
      rerender()
      
      expect(lengthResult.current).toBe(2)
      
      act(() => {
        appStateResult.current.removeFromThreadQueue('length-thread')
      })
      rerender()
      
      expect(lengthResult.current).toBe(1)
    })
  })

  describe('Performance and Edge Cases', () => {
    test('should handle large queues efficiently', () => {
      const { result } = renderHook(() => useAppState())
      
      const largeQueue = Array.from({ length: 100 }, (_, i) => `Message ${i + 1}`)
      
      act(() => {
        largeQueue.forEach(message => {
          result.current.addToThreadQueue('large-queue-thread', message)
        })
      })
      
      expect(result.current.getThreadQueueLength('large-queue-thread')).toBe(100)
      expect(result.current.queuedMessagesByThread['large-queue-thread'][0]).toBe('Message 1')
      expect(result.current.queuedMessagesByThread['large-queue-thread'][99]).toBe('Message 100')
    })

    test('should handle rapid queue operations without corruption', () => {
      const { result } = renderHook(() => useAppState())
      
      act(() => {
        // Rapid add/remove operations
        for (let i = 0; i < 50; i++) {
          result.current.addToThreadQueue('rapid-thread', `Rapid message ${i}`)
          if (i % 3 === 0) {
            result.current.removeFromThreadQueue('rapid-thread')
          }
        }
      })
      
      // Should have consistent state
      const finalLength = result.current.getThreadQueueLength('rapid-thread')
      expect(finalLength).toBeGreaterThan(0)
      expect(result.current.queuedMessagesByThread['rapid-thread']).toHaveLength(finalLength)
    })
  })
})
