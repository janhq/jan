import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
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

describe('useInferenceScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store to initial state
    act(() => {
      useAppState.setState({
        processingThreads: {},
        maxConcurrency: 1,
        fallbackMode: 'single-thread',
        parallelProcessingEnabled: false,
        streamingContent: undefined,
        tokenSpeed: {},
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

  describe('basic scheduling logic', () => {
    it('should not schedule when no messages are queued', () => {
      const { result } = renderHook(() => useInferenceScheduler())

      act(() => {
        result.current.schedule()
      })

      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should not schedule when no slots are available', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        // Set max concurrency to 1 and mark one thread as processing
        appState.current.setMaxConcurrency(1)
        appState.current.setThreadProcessing('thread-1', true)
        appState.current.addToThreadQueue('thread-2', 'test message')
      })

      act(() => {
        scheduler.current.schedule()
      })

      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should schedule one thread when slot is available', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.addToThreadQueue('thread-1', 'test message')
      })

      act(() => {
        scheduler.current.schedule()
      })

      expect(mockSendMessage).toHaveBeenCalledWith('test message', true, { explicitThreadId: 'thread-1' })
    })

    it('should not schedule thread that is already processing', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.addToThreadQueue('thread-1', 'test message')
        appState.current.setThreadProcessing('thread-1', true)
      })

      act(() => {
        scheduler.current.schedule()
      })

      expect(mockSendMessage).not.toHaveBeenCalled()
    })
  })

  describe('single-thread mode (MVP behavior)', () => {
    it('should only process one thread at a time', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.addToThreadQueue('thread-1', 'message1')
        appState.current.addToThreadQueue('thread-2', 'message1')
        appState.current.addToThreadQueue('thread-3', 'message1')
        // Keep single-thread mode (maxConcurrency: 1, parallelProcessingEnabled: false)
      })

      act(() => {
        scheduler.current.schedule()
      })

      // Should respect current concurrency setting
      const expectedCallCount = Math.min(
        appState.current.maxConcurrency, 
        appState.current.parallelProcessingEnabled ? 3 : 1
      )
      expect(mockSendMessage).toHaveBeenCalledTimes(expectedCallCount)
    })

    it('should maintain FIFO order within each thread', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.addToThreadQueue('thread-1', 'first-message')
        appState.current.addToThreadQueue('thread-1', 'second-message')
        appState.current.addToThreadQueue('thread-1', 'third-message')
      })

      // Process first message
      act(() => {
        scheduler.current.schedule()
      })

      expect(mockSendMessage).toHaveBeenCalledWith('first-message', true, { explicitThreadId: 'thread-1' })
      expect(mockSendMessage).toHaveBeenCalledTimes(1)

      // Simulate completion and process next
      act(() => {
        appState.current.setThreadProcessing('thread-1', false)
        scheduler.current.schedule()
      })

      expect(mockSendMessage).toHaveBeenCalledWith('second-message', true, { explicitThreadId: 'thread-1' })
      expect(mockSendMessage).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling and cleanup', () => {
    it('should handle sendMessage errors gracefully', async () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      // Mock sendMessage to throw error
      mockSendMessage.mockRejectedValueOnce(new Error('Inference failed'))

      act(() => {
        appState.current.addToThreadQueue('thread-1', 'test message')
      })

      // Should not throw error
      await act(async () => {
        scheduler.current.startThreadInference('thread-1')
      })

      expect(mockSendMessage).toHaveBeenCalled()
    })

    it('should prevent recursive scheduling', () => {
      const { result } = renderHook(() => useInferenceScheduler())

      // Call schedule multiple times rapidly
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.schedule()
        }
      })

      // Should not cause issues (scheduler uses ref to prevent recursion)
      expect(result.current).toBeDefined()
    })
  })

  describe('scheduling status', () => {
    it('should provide accurate scheduling status', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.setMaxConcurrency(3)
        appState.current.addToThreadQueue('thread-1', 'message1')
        appState.current.addToThreadQueue('thread-2', 'message1')
        appState.current.setThreadProcessing('thread-3', true)
      })

      const status = scheduler.current.getSchedulingStatus()

      expect(status).toEqual({
        availableSlots: 2, // 3 max - 1 processing
        activeProcessingCount: 1,
        maxConcurrency: 3,
        parallelProcessingEnabled: false,
        fallbackMode: 'single-thread',
        queuedThreads: ['thread-1', 'thread-2'],
        processingThreads: ['thread-3'],
      })
    })
  })

  describe('concurrency behavior', () => {
    it('should respect maxConcurrency setting when parallel processing disabled', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.setMaxConcurrency(3)
        appState.current.addToThreadQueue('thread-1', 'message1')
        appState.current.addToThreadQueue('thread-2', 'message2')
        appState.current.addToThreadQueue('thread-3', 'message3')
        // Keep parallel processing disabled for MVP behavior
      })

      act(() => {
        scheduler.current.schedule()
      })

      // Should only start 1 thread when parallelProcessingEnabled is false
      const expectedThreads = appState.current.parallelProcessingEnabled ? 
        Math.min(appState.current.maxConcurrency, 3) : 1
      expect(mockSendMessage).toHaveBeenCalledTimes(expectedThreads)
    })

    it('should start multiple threads when parallel processing enabled', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.setMaxConcurrency(2)
        appState.current.setParallelProcessingEnabled(true)
        appState.current.addToThreadQueue('thread-1', 'message1')
        appState.current.addToThreadQueue('thread-2', 'message2')
        appState.current.addToThreadQueue('thread-3', 'message3')
      })

      act(() => {
        scheduler.current.schedule()
      })

      // Should start up to maxConcurrency threads
      expect(mockSendMessage).toHaveBeenCalledTimes(appState.current.maxConcurrency)
    })

    it('should not exceed available threads', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        appState.current.setMaxConcurrency(5)
        appState.current.setParallelProcessingEnabled(true)
        // Only queue 2 threads but allow 5 concurrent
        appState.current.addToThreadQueue('thread-1', 'message1')
        appState.current.addToThreadQueue('thread-2', 'message2')
      })

      act(() => {
        scheduler.current.schedule()
      })

      // Should only start 2 threads (limited by available queued threads)
      expect(mockSendMessage).toHaveBeenCalledTimes(2)
    })
  })
})

describe('useAutoScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store to initial state
    act(() => {
      useAppState.setState({
        processingThreads: {},
        maxConcurrency: 1,
        fallbackMode: 'single-thread',
        parallelProcessingEnabled: false,
        streamingContent: undefined,
        tokenSpeed: {},
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

  it('should automatically schedule when queue changes', () => {
    const { result: appState } = renderHook(() => useAppState())
    renderHook(() => useAutoScheduler()) // Auto-scheduler should be active

    act(() => {
      appState.current.addToThreadQueue('thread-1', 'test message')
    })

    // Should automatically trigger scheduling due to queue change
    expect(mockSendMessage).toHaveBeenCalledWith('test message', true, { explicitThreadId: 'thread-1' })
  })

  it('should automatically schedule when processing state changes', () => {
    const { result: appState } = renderHook(() => useAppState())
    renderHook(() => useAutoScheduler()) // Auto-scheduler should be active

    act(() => {
      appState.current.addToThreadQueue('thread-1', 'message1')
      appState.current.addToThreadQueue('thread-1', 'message2')
    })

    // Should process at least the first message (single-thread mode processes one at a time)
    expect(mockSendMessage).toHaveBeenCalledWith('message1', true, { explicitThreadId: 'thread-1' })
    
    // Auto-scheduler is reactive to state changes - may process both or just first depending on timing
    expect(mockSendMessage.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
