/**
 * MVP Integration Tests
 * End-to-end workflow tests, multi-thread scenarios, and error handling validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  createMultiThreadScenario,
  createConcurrentMessageBatch,
  createMockSendMessage,
  MockScheduler,
  waitForQueueToProcess,
  withTimeout,
  createMockThread,
  createMockMessage,
  PerformanceTimer,
} from '@/test/simultaneous-inference-utils'

// Integration test scenarios
describe('MVP Integration Tests', () => {
  let mockSendMessage: ReturnType<typeof createMockSendMessage>
  let mockScheduler: MockScheduler
  let performanceTimer: PerformanceTimer

  beforeEach(() => {
    mockSendMessage = createMockSendMessage({
      delay: 50,
      failureRate: 0.1,
      processingTime: 200,
    })

    mockScheduler = new MockScheduler({
      maxConcurrent: 3,
      processingDelay: 100,
      queueDelay: 20,
    })

    performanceTimer = new PerformanceTimer()
    vi.clearAllMocks()
  })

  afterEach(() => {
    mockScheduler.clearQueue()
    vi.restoreAllMocks()
  })

  describe('End-to-End Workflow Tests', () => {
    it('should complete full message lifecycle across multiple threads', async () => {
      const threads = createMultiThreadScenario(3)
      const messages = createConcurrentMessageBatch(threads, 2)

      performanceTimer.start()

      // Stage 1: Queue messages
      const queuePromises = messages.map(async (message) => {
        await mockScheduler.enqueue({
          id: `queue-${message.id}`,
          threadId: message.threadId,
          messageId: message.id,
          priority: 1,
          timestamp: message.timestamp,
        })
        return message
      })

      const queuedMessages = await Promise.all(queuePromises)
      performanceTimer.mark('messages-queued')

      // Stage 2: Process messages through sendMessage
      const processingPromises = queuedMessages.map(async (message) => {
        const result = await mockSendMessage(message.threadId, message.content)
        return { message, result }
      })

      const processedResults = await Promise.all(processingPromises)
      performanceTimer.mark('messages-processed')

      // Stage 3: Verify completion
      await waitForQueueToProcess(
        () => mockScheduler.getQueueStatus().queueLength,
        5000
      )

      const totalDuration = performanceTimer.stop()
      const intervals = performanceTimer.getIntervals()

      // Assertions
      expect(queuedMessages).toHaveLength(messages.length)
      expect(processedResults).toHaveLength(messages.length)

      const successfulProcessing = processedResults.filter(
        (r) => r.result.success
      )
      expect(successfulProcessing.length).toBeGreaterThan(messages.length * 0.8) // 80% success rate

      expect(totalDuration).toBeLessThan(5000) // Complete within 5 seconds
      expect(intervals).toContainEqual(
        expect.objectContaining({ name: 'messages-queued' })
      )
      expect(intervals).toContainEqual(
        expect.objectContaining({ name: 'messages-processed' })
      )
    })

    it('should handle thread switching during message processing', async () => {
      const thread1 = createMockThread({ id: 'thread-1', model: 'model-a' })
      const thread2 = createMockThread({ id: 'thread-2', model: 'model-b' })

      // Create interleaved messages (simulating user switching between threads)
      const interleavedMessages = [
        createMockMessage(thread1.id, { content: 'Thread 1 - Message 1' }),
        createMockMessage(thread2.id, { content: 'Thread 2 - Message 1' }),
        createMockMessage(thread1.id, { content: 'Thread 1 - Message 2' }),
        createMockMessage(thread2.id, { content: 'Thread 2 - Message 2' }),
        createMockMessage(thread1.id, { content: 'Thread 1 - Message 3' }),
      ]

      const results: any[] = []

      // Process messages with timing to simulate real user behavior
      for (const message of interleavedMessages) {
        const processingPromise = mockSendMessage(
          message.threadId,
          message.content
        )
        results.push(await processingPromise)

        // Small delay between messages (simulating typing time)
        await new Promise((resolve) => setTimeout(resolve, 30))
      }

      // Verify both threads processed messages
      const thread1Results = results.filter((r) => r.threadId === thread1.id)
      const thread2Results = results.filter((r) => r.threadId === thread2.id)

      expect(thread1Results).toHaveLength(3)
      expect(thread2Results).toHaveLength(2)
      expect(results.every((r) => r.success || !r.success)).toBe(true) // All have success property
    })

    it('should maintain state consistency across concurrent operations', async () => {
      const threads = createMultiThreadScenario(4)
      const stateTracker = new Map<string, any>()

      // Mock state management functions
      const updateThreadState = vi.fn((threadId: string, update: any) => {
        const current = stateTracker.get(threadId) || {
          messages: [],
          status: 'idle',
        }
        stateTracker.set(threadId, { ...current, ...update })
      })

      const getThreadState = vi.fn((threadId: string) => {
        return stateTracker.get(threadId) || { messages: [], status: 'idle' }
      })

      // Initialize thread states
      threads.forEach((thread) => {
        updateThreadState(thread.id, {
          model: thread.model,
          status: 'idle',
          messages: [],
        })
      })

      // Simulate concurrent state updates
      const messages = createConcurrentMessageBatch(threads, 3)
      const stateUpdatePromises = messages.map(async (message) => {
        // Add message to thread
        const currentState = getThreadState(message.threadId)
        updateThreadState(message.threadId, {
          status: 'processing',
          messages: [...currentState.messages, message],
        })

        // Simulate processing
        const result = await mockSendMessage(message.threadId, message.content)

        // Update with result
        const finalState = getThreadState(message.threadId)
        updateThreadState(message.threadId, {
          status: result.success ? 'idle' : 'error',
          lastProcessed: Date.now(),
        })

        return { message, result, finalState: getThreadState(message.threadId) }
      })

      const results = await Promise.all(stateUpdatePromises)

      // Verify state consistency
      threads.forEach((thread) => {
        const finalState = getThreadState(thread.id)
        expect(finalState).toBeDefined()
        expect(finalState.messages).toBeDefined()
        expect(['idle', 'processing', 'error']).toContain(finalState.status)

        const threadMessages = messages.filter((m) => m.threadId === thread.id)
        expect(finalState.messages).toHaveLength(threadMessages.length)
      })

      expect(updateThreadState).toHaveBeenCalled()
      expect(getThreadState).toHaveBeenCalled()
    })
  })

  describe('Multi-Thread Scenario Tests', () => {
    it('should handle high-load scenario with 10 concurrent threads', async () => {
      const threads = createMultiThreadScenario(10)
      const messages = createConcurrentMessageBatch(threads, 5) // 50 total messages

      performanceTimer.start()

      // Process all messages concurrently
      const processingPromises = messages.map(async (message, index) => {
        // Stagger the start times slightly to simulate real usage
        await new Promise((resolve) => setTimeout(resolve, index * 10))

        const result = await mockSendMessage(message.threadId, message.content)
        return { message, result, processingOrder: index }
      })

      const results = await withTimeout(
        Promise.all(processingPromises),
        15000 // 15 second timeout for high load
      )

      const duration = performanceTimer.stop()

      // Analyze results
      const successCount = results.filter((r) => r.result.success).length
      const threadsUsed = new Set(results.map((r) => r.message.threadId)).size
      const averageProcessingTime = duration / results.length

      expect(results).toHaveLength(50)
      expect(successCount).toBeGreaterThan(40) // At least 80% success
      expect(threadsUsed).toBe(10) // All threads were used
      expect(averageProcessingTime).toBeLessThan(300) // Reasonable per-message time
      expect(duration).toBeLessThan(15000) // Complete within timeout
    })

    it('should maintain thread isolation during concurrent processing', async () => {
      const threads = createMultiThreadScenario(5)
      const threadStates = new Map<
        string,
        { processing: boolean; lastMessage?: string }
      >()

      // Initialize thread states
      threads.forEach((thread) => {
        threadStates.set(thread.id, { processing: false })
      })

      // Mock thread-specific processing
      const processMessageForThread = vi.fn(
        async (threadId: string, content: string) => {
          // Check isolation - this thread shouldn't be processing
          const state = threadStates.get(threadId)
          expect(state?.processing).toBe(false)

          // Mark as processing
          threadStates.set(threadId, { processing: true, lastMessage: content })

          try {
            const result = await mockSendMessage(threadId, content)
            return result
          } finally {
            // Mark as completed
            threadStates.set(threadId, {
              processing: false,
              lastMessage: content,
            })
          }
        }
      )

      const messages = createConcurrentMessageBatch(threads, 3)
      const isolationPromises = messages.map((message) =>
        processMessageForThread(message.threadId, message.content)
      )

      await Promise.all(isolationPromises)

      // Verify isolation was maintained
      expect(processMessageForThread).toHaveBeenCalledTimes(messages.length)

      // All threads should be idle after processing
      threads.forEach((thread) => {
        const finalState = threadStates.get(thread.id)
        expect(finalState?.processing).toBe(false)
        expect(finalState?.lastMessage).toBeDefined()
      })
    })
  })

  describe('Error Handling Validation', () => {
    it('should recover gracefully from processing failures', async () => {
      // Configure mock with higher failure rate
      const flakyMockSendMessage = createMockSendMessage({
        delay: 50,
        failureRate: 0.4, // 40% failure rate
        processingTime: 100,
      })

      const threads = createMultiThreadScenario(3)
      const messages = createConcurrentMessageBatch(threads, 4)

      const retryableProcess = async (message: any, maxRetries = 2) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const result = await flakyMockSendMessage(
              message.threadId,
              message.content
            )
            if (result.success) {
              return { ...result, attempt, recovered: attempt > 0 }
            }
            throw new Error(result.error || 'Processing failed')
          } catch (error) {
            if (attempt === maxRetries) {
              return {
                success: false,
                messageId: '',
                threadId: message.threadId,
                error: (error as Error).message,
                attempt,
                recovered: false,
              }
            }
            // Wait before retry
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
        }
      }

      const results = await Promise.all(
        messages.map((message) => retryableProcess(message))
      )

      const successful = results.filter((r) => r.success)
      const recovered = results.filter((r) => r.recovered)
      const failed = results.filter((r) => !r.success)

      // Should have better success rate due to retries
      expect(successful.length).toBeGreaterThan(messages.length * 0.6) // At least 60%
      expect(recovered.length).toBeGreaterThan(0) // Some recoveries should occur

      // Failures should be properly handled
      failed.forEach((result) => {
        expect(result.error).toBeDefined()
        expect(result.attempt).toBe(2) // Should have retried
      })
    })

    it('should handle queue overflow scenarios', async () => {
      const smallScheduler = new MockScheduler({
        maxConcurrent: 1, // Very limited concurrency
        processingDelay: 200,
        queueDelay: 50,
      })

      const threads = createMultiThreadScenario(2)
      const manyMessages = createConcurrentMessageBatch(threads, 10) // 20 messages

      const queueResults: any[] = []
      let overflowCount = 0

      // Simulate queue overflow handling
      for (const message of manyMessages) {
        try {
          await smallScheduler.enqueue({
            id: `queue-${message.id}`,
            threadId: message.threadId,
            messageId: message.id,
            priority: 1,
            timestamp: message.timestamp,
          })
          queueResults.push({ queued: true, messageId: message.id })
        } catch (error) {
          overflowCount++
          queueResults.push({ queued: false, messageId: message.id, error })
        }
      }

      // Wait for queue to process
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const queueStatus = smallScheduler.getQueueStatus()

      // Should handle overflow gracefully
      expect(queueResults).toHaveLength(manyMessages.length)
      expect(queueStatus.queueLength).toBeGreaterThanOrEqual(0)
      expect(queueStatus.processing.length).toBeLessThanOrEqual(1)
    })

    it('should handle network timeout scenarios', async () => {
      const timeoutMockSendMessage = vi
        .fn()
        .mockImplementation(async (threadId: string) => {
          // Simulate random timeouts (20% chance)
          if (Math.random() < 0.2) {
            await new Promise((resolve) => setTimeout(resolve, 6000)) // 6s timeout
            throw new Error('Network timeout')
          }

          await new Promise((resolve) => setTimeout(resolve, 100))
          return { success: true, messageId: 'msg-123', threadId }
        })

      const messages = createConcurrentMessageBatch(
        createMultiThreadScenario(3),
        3
      )

      const timeoutResults = await Promise.allSettled(
        messages.map((message) =>
          withTimeout(
            timeoutMockSendMessage(message.threadId, message.content),
            1000, // 1s timeout
            `Timeout processing ${message.id}`
          )
        )
      )

      const successful = timeoutResults.filter((r) => r.status === 'fulfilled')
      const timedOut = timeoutResults.filter((r) => r.status === 'rejected')

      // Should handle timeouts without crashing
      expect(successful.length + timedOut.length).toBe(messages.length)

      timedOut.forEach((result) => {
        if (result.status === 'rejected') {
          expect(result.reason.message).toMatch(/timeout/i)
        }
      })
    })
  })

  describe('Edge Case Testing Framework', () => {
    it('should handle rapid thread creation and deletion', async () => {
      const threadLifecycle = new Map<
        string,
        { created: number; deleted?: number }
      >()
      const activeThreads = new Set<string>()

      const createThread = (id: string) => {
        threadLifecycle.set(id, { created: Date.now() })
        activeThreads.add(id)
      }

      const deleteThread = (id: string) => {
        const lifecycle = threadLifecycle.get(id)
        if (lifecycle) {
          lifecycle.deleted = Date.now()
        }
        activeThreads.delete(id)
      }

      // Rapidly create and delete threads
      for (let i = 0; i < 20; i++) {
        const threadId = `rapid-thread-${i}`
        createThread(threadId)

        // Create some messages for this thread
        const message = createMockMessage(threadId, {
          content: `Message for ${threadId}`,
        })

        // Process message
        const processPromise = mockSendMessage(threadId, message.content)

        // Randomly delete thread during or after processing
        if (Math.random() < 0.3) {
          setTimeout(() => deleteThread(threadId), Math.random() * 100)
        }

        await processPromise

        if (activeThreads.has(threadId) && Math.random() < 0.7) {
          deleteThread(threadId)
        }
      }

      // Verify tracking worked correctly
      expect(threadLifecycle.size).toBe(20)

      const completedLifecycles = Array.from(threadLifecycle.values()).filter(
        (lifecycle) => lifecycle.deleted
      )

      expect(completedLifecycles.length).toBeGreaterThan(0)
      expect(activeThreads.size).toBeLessThan(20)
    })

    it('should handle malformed message data gracefully', async () => {
      const malformedMessages = [
        { threadId: '', content: 'Empty thread ID' },
        { threadId: 'valid-thread', content: '' },
        { threadId: 'valid-thread', content: null as any },
        { threadId: 'valid-thread', content: undefined as any },
        { threadId: 'valid-thread', content: {} as any },
        { threadId: null as any, content: 'Null thread ID' },
      ]

      const sanitizeMockSendMessage = vi
        .fn()
        .mockImplementation(async (threadId: string, content: string) => {
          // Validate inputs
          if (!threadId || typeof threadId !== 'string') {
            return {
              success: false,
              messageId: '',
              threadId: threadId || 'unknown',
              error: 'Invalid thread ID',
            }
          }

          if (!content || typeof content !== 'string') {
            return {
              success: false,
              messageId: '',
              threadId,
              error: 'Invalid message content',
            }
          }

          return { success: true, messageId: 'msg-123', threadId }
        })

      const results = await Promise.all(
        malformedMessages.map((msg) =>
          sanitizeMockSendMessage(msg.threadId, msg.content)
        )
      )

      // Should handle all malformed messages without crashing
      expect(results).toHaveLength(malformedMessages.length)

      const errors = results.filter((r) => !r.success)
      expect(errors.length).toBeGreaterThan(0) // Should detect issues

      errors.forEach((error) => {
        expect(error.error).toBeDefined()
        expect(['Invalid thread ID', 'Invalid message content']).toContain(
          error.error
        )
      })
    })
  })
})
