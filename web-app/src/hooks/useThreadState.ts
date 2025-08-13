import { useAppState } from './useAppState'
import { useShallow } from 'zustand/shallow'

/**
 * CONVENIENCE HOOKS FOR THREAD-SPECIFIC STATE ACCESS
 * 
 * These hooks provide clean, optimized access to per-thread state
 * without requiring components to manage thread ID prop drilling.
 */

/**
 * Get streaming content for a specific thread
 * @param threadId The thread ID to get streaming content for
 * @returns ThreadMessage or null if not streaming
 */
export const useStreamingContent = (threadId: string) =>
  useAppState(state => state.streamingContentByThread[threadId])

/**
 * Get error state for a specific thread
 * @param threadId The thread ID to get error for
 * @returns Error string/object or undefined if no error
 */
export const useThreadError = (threadId: string) =>
  useAppState(state => state.errorsByThread[threadId])

/**
 * Get token speed for a specific thread
 * @param threadId The thread ID to get token speed for
 * @returns TokenSpeed or undefined if not available
 */
export const useTokenSpeed = (threadId: string) =>
  useAppState(state => state.tokenSpeedByThread[threadId])

// Stable empty array to prevent infinite loops
const EMPTY_QUEUE: string[] = []

/**
 * Get queued messages for a specific thread
 * @param threadId The thread ID to get queued messages for
 * @returns Array of queued messages or empty array if none queued
 */
export const useQueuedMessages = (threadId: string) =>
  useAppState(state => state.queuedMessagesByThread[threadId] || EMPTY_QUEUE)

/**
 * Get queue length for a specific thread
 * @param threadId The thread ID to check queue length for
 * @returns Number of queued messages
 */
export const useThreadQueueLength = (threadId: string) =>
  useAppState(state => state.queuedMessagesByThread[threadId]?.length || 0)

/**
 * Check if a specific thread is currently active (has streaming content)
 * @param threadId The thread ID to check
 * @returns boolean indicating if thread is streaming
 */
export const useIsThreadActive = (threadId: string) =>
  useAppState(state => Boolean(state.streamingContentByThread[threadId]))

/**
 * Get complete thread state for a specific thread
 * @param threadId The thread ID to get state for
 * @returns Object with all thread-specific state
 */
export const useThreadState = (threadId: string) =>
  useAppState(
    useShallow(state => ({
      streamingContent: state.streamingContentByThread[threadId],
      tokenSpeed: state.tokenSpeedByThread[threadId],
      queuedMessages: state.queuedMessagesByThread[threadId] || EMPTY_QUEUE,
      queueLength: state.queuedMessagesByThread[threadId]?.length || 0,
      error: state.errorsByThread[threadId],
      isActive: Boolean(state.streamingContentByThread[threadId]),
    }))
  )

/**
 * Get list of all threads with active state
 * @returns Array of thread IDs that have active streaming, queued messages, or errors
 */
export const useActiveThreads = () =>
  useAppState(state => state.getAllActiveThreads())
