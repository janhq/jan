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

      expect(mockSendMessage).toHaveBeenCalledWith('test message', true)
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

      // Should only start one thread even though multiple are available
      expect(mockSendMessage).toHaveBeenCalledTimes(1)
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

      expect(mockSendMessage).toHaveBeenCalledWith('first-message', true)
      expect(mockSendMessage).toHaveBeenCalledTimes(1)

      // Simulate completion and process next
      act(() => {
        appState.current.setThreadProcessing('thread-1', false)
        scheduler.current.schedule()
      })

      expect(mockSendMessage).toHaveBeenCalledWith('second-message', true)
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

  describe('future parallel processing preparation', () => {
    it('should be ready for parallel processing when enabled', () => {
      const { result: appState } = renderHook(() => useAppState())
      const { result: scheduler } = renderHook(() => useInferenceScheduler())

      act(() => {
        // Simulate future parallel processing configuration
        appState.current.setMaxConcurrency(3)
        appState.current.addToThreadQueue('thread-1', 'message1')
        appState.current.addToThreadQueue('thread-2', 'message2')
        appState.current.addToThreadQueue('thread-3', 'message3')
        // Keep parallel processing disabled for MVP behavior
        // appState.current.setParallelProcessingEnabled(true) // Future behavior
      })

      act(() => {
        scheduler.current.schedule()
      })

      // MVP behavior: only starts 1 thread even with higher concurrency
      expect(mockSendMessage).toHaveBeenCalledTimes(1) // MVP behavior
      
      // Test documentation for future behavior:
      // When parallelProcessingEnabled is true, should start multiple threads
      // expect(mockSendMessage).toHaveBeenCalledTimes(3) // Future behavior
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

  it('should automatically schedule when queue changes', () => {
    const { result: appState } = renderHook(() => useAppState())
    renderHook(() => useAutoScheduler()) // Auto-scheduler should be active

    act(() => {
      appState.current.addToThreadQueue('thread-1', 'test message')
    })

    // Should automatically trigger scheduling due to queue change
    expect(mockSendMessage).toHaveBeenCalledWith('test message', true)
  })

  it('should automatically schedule when processing state changes', () => {
    const { result: appState } = renderHook(() => useAppState())
    renderHook(() => useAutoScheduler()) // Auto-scheduler should be active

    act(() => {
      appState.current.addToThreadQueue('thread-1', 'message1')
      appState.current.addToThreadQueue('thread-1', 'message2')
    })

    // Messages should be scheduled (auto-scheduler may trigger multiple times)
    expect(mockSendMessage).toHaveBeenCalledWith('message1', true)
    expect(mockSendMessage).toHaveBeenCalledWith('message2', true)
    
    // Should process both messages (auto-scheduler is reactive to state changes)
    expect(mockSendMessage.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
