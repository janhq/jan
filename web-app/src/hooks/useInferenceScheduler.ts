import { useCallback, useEffect, useRef } from 'react'
import { useAppState } from './useAppState'
import { useChat } from './useChat'

/**
 * Inference Scheduler Hook
 *
 * Coordinates thread processing based on available slots and queue state.
 * Currently implements single-thread fallback mode with infrastructure
 * ready for future parallel processing.
 */
export const useInferenceScheduler = () => {
  // Zustand store access (direct destructuring from the store)
  const queuedMessagesByThread = useAppState(
    (state) => state.queuedMessagesByThread
  )
  const processingThreads = useAppState((state) => state.processingThreads)
  const maxConcurrency = useAppState((state) => state.maxConcurrency)
  const parallelProcessingEnabled = useAppState(
    (state) => state.parallelProcessingEnabled
  )
  const fallbackMode = useAppState((state) => state.fallbackMode)
  const getActiveProcessingCount = useAppState(
    (state) => state.getActiveProcessingCount
  )
  const getAvailableSlots = useAppState((state) => state.getAvailableSlots)
  const isThreadProcessing = useAppState((state) => state.isThreadProcessing)
  const removeFromThreadQueue = useAppState(
    (state) => state.removeFromThreadQueue
  )
  const setThreadProcessing = useAppState(
    (state) => state.setThreadProcessing
  )

  const { sendMessage } = useChat()
  const schedulerRunning = useRef(false)

  /**
   * Main scheduling logic
   * Determines which threads should start processing based on:
   * - Available processing slots
   * - Queued messages per thread
   * - Current processing state
   */
  const schedule = useCallback(() => {
    // Prevent recursive scheduling
    if (schedulerRunning.current) {
      return
    }

    schedulerRunning.current = true

    try {
      const availableSlots = getAvailableSlots()

      if (availableSlots <= 0) {
        return // No slots available
      }

      // Get threads that have queued messages and aren't currently processing
      const runnableThreads = Object.entries(queuedMessagesByThread)
        .filter(([threadId, queue]) => {
          return queue.length > 0 && !isThreadProcessing(threadId)
        })
        .map(([threadId]) => threadId)

      if (runnableThreads.length === 0) {
        return // No threads ready to run
      }

      // MVP: Always single-thread mode for now
      // In future: determine threads based on parallel processing capabilities
      const threadsToStart =
        parallelProcessingEnabled && maxConcurrency > 1
          ? Math.min(availableSlots, runnableThreads.length)
          : Math.min(1, runnableThreads.length) // Single-thread fallback mode

      // Start inference for selected threads
      for (let i = 0; i < threadsToStart; i++) {
        const threadId = runnableThreads[i]
        startThreadInference(threadId)
      }
    } finally {
      schedulerRunning.current = false
    }
  }, [
    queuedMessagesByThread,
    processingThreads,
    maxConcurrency,
    parallelProcessingEnabled,
    getAvailableSlots,
    isThreadProcessing,
  ])

  /**
   * Start inference for a specific thread
   * Dequeues the next message and initiates processing
   */
  const startThreadInference = useCallback(
    (threadId: string) => {
      const queue = queuedMessagesByThread[threadId]
      if (!queue || queue.length === 0) {
        console.warn(`No messages queued for thread ${threadId}`)
        return
      }

      if (isThreadProcessing(threadId)) {
        console.warn(`Thread ${threadId} is already processing`)
        return
      }

      // *** SET LOCK SYNCHRONOUSLY to prevent race conditions ***
      setThreadProcessing(threadId, true)

      const nextMessage = removeFromThreadQueue(threadId)
      if (!nextMessage) {
        console.warn(`Failed to dequeue message for thread ${threadId}`)
        setThreadProcessing(threadId, false) // Release lock if no message
        return
      }

      // Start processing with lock already acquired
      ;(async () => {
        try {
          await sendMessage(nextMessage, true, threadId) // Pass explicit thread ID
        } catch (error) {
          console.error(`Error processing message in thread ${threadId}:`, error)
        } finally {
          // *** ALWAYS RELEASE LOCK ***
          setThreadProcessing(threadId, false)
        }
      })()
    },
    [
      queuedMessagesByThread,
      isThreadProcessing,
      removeFromThreadQueue,
      sendMessage,
    ]
  )

  /**
   * Get scheduling status for debugging/monitoring
   */
  const getSchedulingStatus = useCallback(() => {
    return {
      availableSlots: getAvailableSlots(),
      activeProcessingCount: getActiveProcessingCount(),
      maxConcurrency,
      parallelProcessingEnabled,
      fallbackMode,
      queuedThreads: Object.keys(queuedMessagesByThread).filter(
        (threadId) => queuedMessagesByThread[threadId].length > 0
      ),
      processingThreads: Object.keys(processingThreads).filter(
        (threadId) => processingThreads[threadId]
      ),
    }
  }, [
    getAvailableSlots,
    getActiveProcessingCount,
    maxConcurrency,
    parallelProcessingEnabled,
    fallbackMode,
    queuedMessagesByThread,
    processingThreads,
  ])

  return {
    schedule,
    startThreadInference,
    getSchedulingStatus,
  }
}

/**
 * Auto-scheduling hook
 * Automatically triggers scheduling when queue state changes
 */
export const useAutoScheduler = () => {
  const { schedule } = useInferenceScheduler()
  
  // Access state for triggering effects
  const queuedMessagesByThread = useAppState(
    (state) => state.queuedMessagesByThread
  )
  const processingThreads = useAppState((state) => state.processingThreads)
  const maxConcurrency = useAppState((state) => state.maxConcurrency)

  // Trigger scheduling when queue or processing state changes
  useEffect(() => {
    // Schedule when:
    // 1. New messages are added to any queue
    // 2. Processing state changes (threads finish processing)
    // 3. Concurrency settings change
    schedule()
  }, [queuedMessagesByThread, processingThreads, maxConcurrency, schedule])

  return { schedule }
}
