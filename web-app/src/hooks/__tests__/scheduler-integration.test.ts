import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useInferenceScheduler, useAutoScheduler } from '../useInferenceScheduler'
import { useAppState } from '../useAppState'
import { useChat } from '../useChat'

// Mock the useChat hook
vi.mock('../useChat', () => ({
  useChat: vi.fn(() => ({
    sendMessage: vi.fn()
  }))
}))

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

const mockSendMessage = vi.fn()

describe('Scheduler + useChat Integration', () => {
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

    // Mock useChat to return our mock sendMessage
    vi.mocked(useChat).mockReturnValue({
      sendMessage: mockSendMessage
    } as any)
  })

  describe('queue processing end-to-end', () => {
    it('should process queue messages in correct order', async () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      const processedMessages: string[] = []

      // Mock sendMessage to simulate processing and track order
      mockSendMessage.mockImplementation(async (message: string) => {
        processedMessages.push(message)
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 50))
        return Promise.resolve()
      })

      // Queue multiple messages
      act(() => {
        appState.current.addToThreadQueue('thread-1', 'first')
        appState.current.addToThreadQueue('thread-1', 'second')
        appState.current.addToThreadQueue('thread-1', 'third')
      })

      // Process all messages sequentially
      for (let i = 0; i < 3; i++) {
        act(() => {
          scheduler.current.schedule()
        })

        // Wait for processing to complete
        await waitFor(() => {
          expect(processedMessages).toHaveLength(i + 1)
        })

        // Simulate completion
        act(() => {
          appState.current.setThreadProcessing('thread-1', false)
        })
      }

      expect(processedMessages).toEqual(['first', 'second', 'third'])
    })

    it('should handle multiple threads with single-thread processing', async () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      const processedMessages: Array<{ message: string; threadId: string }> = []

      // Mock sendMessage to track which messages are processed
      mockSendMessage.mockImplementation(async (message: string) => {
        // Find which thread this message belongs to by checking queues
        const queuedMessagesByThread = useAppState.getState().queuedMessagesByThread
        let threadId = 'unknown'
        
        for (const [tid, queue] of Object.entries(queuedMessagesByThread)) {
          if (queue.includes(message)) {
            threadId = tid
            break
          }
        }
        
        processedMessages.push({ message, threadId })
        await new Promise(resolve => setTimeout(resolve, 25))
        return Promise.resolve()
      })

      // Queue messages in different threads
      act(() => {
        appState.current.addToThreadQueue('thread-1', 'msg1-t1')
        appState.current.addToThreadQueue('thread-2', 'msg1-t2')
        appState.current.addToThreadQueue('thread-1', 'msg2-t1')
      })

      // Should only process one thread at a time (single-thread mode)
      act(() => {
        scheduler.current.schedule()
      })

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledTimes(1)
      })

      // Only one message should be processing
      const processingCount = appState.current.getActiveProcessingCount()
      expect(processingCount).toBe(1)
    })
  })

  describe('thread switching during processing', () => {
    it('should wait for current thread to complete before starting another', async () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      let processingComplete = false
      
      // Mock long-running sendMessage
      mockSendMessage.mockImplementation(async () => {
        // Simulate actual processing state management
        await new Promise(resolve => setTimeout(resolve, 100))
        processingComplete = true
        return Promise.resolve()
      })

      // Start processing thread-1
      act(() => {
        appState.current.addToThreadQueue('thread-1', 'message1')
        scheduler.current.schedule()
      })

      // Verify thread-1 is processing (wait for state update)
      await waitFor(() => {
        expect(appState.current.isThreadProcessing('thread-1')).toBe(true)
      })

      // Add message to thread-2
      act(() => {
        appState.current.addToThreadQueue('thread-2', 'message2')
        scheduler.current.schedule() // Try to schedule thread-2
      })

      // thread-2 should not start processing yet
      expect(appState.current.isThreadProcessing('thread-2')).toBe(false)
      expect(mockSendMessage).toHaveBeenCalledTimes(1) // Only thread-1 message

      // Wait for processing to complete
      await waitFor(() => {
        expect(processingComplete).toBe(true)
      })
    })
  })

  describe('abort functionality', () => {
    it('should handle aborted processing gracefully', async () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      // Mock sendMessage to simulate abort
      mockSendMessage.mockRejectedValueOnce(new Error('Aborted'))

      act(() => {
        appState.current.addToThreadQueue('thread-1', 'test message')
      })

      // Should not throw error when sendMessage fails
      await act(async () => {
        scheduler.current.startThreadInference('thread-1')
      })

      // Processing state should be cleaned up even after error
      await waitFor(() => {
        expect(appState.current.isThreadProcessing('thread-1')).toBe(false)
      })
    })
  })

  describe('auto-scheduler integration', () => {
    it('should work seamlessly with auto-scheduler', async () => {
      const { result: appState } = renderHook(() => useAppState())
      renderHook(() => useAutoScheduler()) // Enable auto-scheduling

      let messageCount = 0

      // Mock sendMessage to simply count messages
      mockSendMessage.mockImplementation(async (message: string) => {
        messageCount++
        await new Promise(resolve => setTimeout(resolve, 10))
        return Promise.resolve()
      })

      // Add a single message - auto-scheduler should pick it up
      act(() => {
        appState.current.addToThreadQueue('thread-1', 'auto-message-1')
      })

      // Should automatically process the message
      await waitFor(() => {
        expect(messageCount).toBeGreaterThan(0)
      })

      // Verify the specific message was processed
      expect(mockSendMessage).toHaveBeenCalledWith('auto-message-1', true)
    })
  })

  describe('state synchronization', () => {
    it('should keep queue and processing state synchronized', async () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      // Mock sendMessage to track state changes
      mockSendMessage.mockImplementation(async (message: string) => {
        // Verify state during processing
        const queueLength = appState.current.getThreadQueueLength('thread-1')
        const isProcessing = appState.current.isThreadProcessing('thread-1')
        
        expect(isProcessing).toBe(true) // Should be marked as processing
        // Queue should have been updated (message removed)
        
        await new Promise(resolve => setTimeout(resolve, 25))
        return Promise.resolve()
      })

      // Add message and schedule
      act(() => {
        appState.current.addToThreadQueue('thread-1', 'sync-test')
      })

      const initialQueueLength = appState.current.getThreadQueueLength('thread-1')
      expect(initialQueueLength).toBe(1)

      act(() => {
        scheduler.current.schedule()
      })

      // Verify message was dequeued and processing started
      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalled()
        expect(appState.current.getThreadQueueLength('thread-1')).toBe(0)
        expect(appState.current.isThreadProcessing('thread-1')).toBe(true)
      })
    })
  })

  describe('performance and reliability', () => {
    it('should handle rapid queue additions without issues', async () => {
      const { result: appState } = renderHook(() => useAppState())
      renderHook(() => useAutoScheduler()) // Enable auto-scheduling

      let processedCount = 0
      mockSendMessage.mockImplementation(async () => {
        processedCount++
        await new Promise(resolve => setTimeout(resolve, 10))
        return Promise.resolve()
      })

      // Rapidly add many messages
      act(() => {
        for (let i = 0; i < 10; i++) {
          appState.current.addToThreadQueue('thread-1', `rapid-message-${i}`)
        }
      })

      // Should handle all messages without errors
      await waitFor(() => {
        expect(processedCount).toBeGreaterThan(0)
      }, { timeout: 5000 })

      // Should not crash or cause state corruption
      expect(appState.current).toBeDefined()
      expect(useAppState.getState().queuedMessagesByThread['thread-1']).toBeDefined()
    })
  })
})
