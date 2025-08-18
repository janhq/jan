import { useAppState } from './useAppState'

/**
 * CONVENIENCE HOOKS FOR THREAD-SPECIFIC STATE ACCESS
 *
 * These hooks provide clean, optimized access to per-thread state
 * without requiring components to manage thread ID prop drilling.
 */

/**
 * Get error state for a specific thread
 * @param threadId The thread ID to get error for
 * @returns Error string/object or undefined if no error
 */
export const useThreadError = (threadId: string) =>
  useAppState((state) => state.errorsByThread[threadId])

// Stable empty array to prevent infinite loops
const EMPTY_QUEUE: string[] = []

/**
 * Get queued messages for a specific thread
 * @param threadId The thread ID to get queued messages for
 * @returns Array of queued messages or empty array if none queued
 */
export const useQueuedMessages = (threadId: string) =>
  useAppState((state) => state.queuedMessagesByThread[threadId] || EMPTY_QUEUE)

/**
 * Get queue length for a specific thread
 * @param threadId The thread ID to check queue length for
 * @returns Number of queued messages
 */
export const useThreadQueueLength = (threadId: string) =>
  useAppState((state) => state.queuedMessagesByThread[threadId]?.length || 0)


/**
 * Get list of all threads with active state
 * @returns Array of thread IDs that have active streaming, queued messages, or errors
 */
export const useActiveThreads = () =>
  useAppState((state) => state.getAllActiveThreads())
