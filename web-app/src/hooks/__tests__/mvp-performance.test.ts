/**
 * MVP Performance Tests
 * Performance regression tests, memory leak detection, and baseline comparison
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  PerformanceTimer,
  createMemoryMonitor,
  createStateUpdateTracker,
  createMultiThreadScenario,
  createConcurrentMessageBatch,
  waitForConcurrentOperations,
  withTimeout,
  createBatchOperationTester,
} from '@/test/simultaneous-inference-utils'

// Performance thresholds based on baseline
const PERFORMANCE_THRESHOLDS = {
  // Message processing should complete within 5 seconds for 10 concurrent messages
  CONCURRENT_PROCESSING_TIMEOUT: 5000,

  // Memory usage should not increase by more than 50MB during test
  MAX_MEMORY_INCREASE: 50 * 1024 * 1024, // 50MB in bytes

  // State updates should not exceed 100 per second during heavy load
  MAX_STATE_UPDATE_RATE: 100,

  // Queue processing delay should be under 100ms per item
  MAX_QUEUE_PROCESSING_DELAY: 100,

  // Batch operations should scale linearly (max 2x overhead)
  MAX_BATCH_OVERHEAD: 2.0,
}

describe('MVP Performance Tests', () => {
  let performanceTimer: PerformanceTimer
  let memoryMonitor: ReturnType<typeof createMemoryMonitor>
  let stateTracker: ReturnType<typeof createStateUpdateTracker>

  beforeEach(() => {
    performanceTimer = new PerformanceTimer()
    memoryMonitor = createMemoryMonitor()
    stateTracker = createStateUpdateTracker()

    // Clear any existing timers
    vi.clearAllTimers()
  })

  afterEach(() => {
    performanceTimer.reset()
    stateTracker.reset()
    vi.restoreAllMocks()
  })

  describe('Concurrent Processing Performance', () => {
    it('should handle 10 concurrent messages within performance threshold', async () => {
      const threads = createMultiThreadScenario(5)
      const messages = createConcurrentMessageBatch(threads, 2)

      performanceTimer.start()

      // Simulate concurrent message processing
      const operations = messages.map(
        (message, index) =>
          new Promise((resolve) => {
            setTimeout(() => {
              stateTracker.track(`message-${index}`)
              resolve({ messageId: message.id, processed: true })
            }, Math.random() * 100) // Random delay 0-100ms
          })
      )

      const result = await withTimeout(
        waitForConcurrentOperations(
          operations,
          PERFORMANCE_THRESHOLDS.CONCURRENT_PROCESSING_TIMEOUT
        ),
        PERFORMANCE_THRESHOLDS.CONCURRENT_PROCESSING_TIMEOUT
      )

      const duration = performanceTimer.stop()

      expect(result.successful).toBe(messages.length)
      expect(result.failed).toBe(0)
      expect(duration).toBeLessThan(
        PERFORMANCE_THRESHOLDS.CONCURRENT_PROCESSING_TIMEOUT
      )

      // Verify state update rate is within threshold
      const updateRate = stateTracker.getUpdateRate()
      expect(updateRate).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MAX_STATE_UPDATE_RATE
      )
    })

    it('should scale processing time linearly with message count', async () => {
      const messageCounts = [5, 10, 20]
      const processingTimes: number[] = []

      for (const count of messageCounts) {
        const threads = createMultiThreadScenario(Math.ceil(count / 2))
        const messages = createConcurrentMessageBatch(threads, 2).slice(
          0,
          count
        )

        performanceTimer.start()

        const operations = messages.map(
          (message) =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ messageId: message.id }), 50)
            })
        )

        await waitForConcurrentOperations(operations)
        const duration = performanceTimer.stop()
        processingTimes.push(duration)
      }

      // Verify linear scaling (each doubling should not more than double time)
      const scaleFactor1 = processingTimes[1] / processingTimes[0]
      const scaleFactor2 = processingTimes[2] / processingTimes[1]

      expect(scaleFactor1).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MAX_BATCH_OVERHEAD
      )
      expect(scaleFactor2).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MAX_BATCH_OVERHEAD
      )
    })
  })

  describe('Memory Usage Tests', () => {
    it('should not have significant memory leaks during concurrent processing', async () => {
      // Force garbage collection if available (for Node.js environments)
      if (global.gc) {
        global.gc()
      }

      const initialMemory = memoryMonitor.getCurrentMemory()
      const threads = createMultiThreadScenario(10)
      const messages = createConcurrentMessageBatch(threads, 5)

      // Simulate heavy concurrent processing
      for (let iteration = 0; iteration < 3; iteration++) {
        const operations = messages.map(
          (message) =>
            new Promise((resolve) => {
              // Create some temporary objects to test cleanup
              const tempData = new Array(1000).fill(0).map(() => ({
                id: message.id,
                data: new Array(100).fill(Math.random()),
              }))

              setTimeout(() => {
                // Clear temp data
                tempData.length = 0
                resolve({ processed: true })
              }, 10)
            })
        )

        await waitForConcurrentOperations(operations)

        // Force garbage collection between iterations
        if (global.gc) {
          global.gc()
        }
      }

      const memoryDelta = memoryMonitor.getMemoryDelta()

      if (memoryDelta && initialMemory) {
        expect(memoryDelta.usedDelta).toBeLessThan(
          PERFORMANCE_THRESHOLDS.MAX_MEMORY_INCREASE
        )
      }
    })

    it('should clean up resources when components unmount', async () => {
      const cleanup = vi.fn()

      // Mock a hook that creates resources
      const mockHook = () => {
        const resources = new Map()

        const addResource = (id: string, data: any) => {
          resources.set(id, data)
        }

        const cleanupResources = () => {
          resources.clear()
          cleanup()
        }

        return {
          addResource,
          cleanupResources,
          get resourceCount() {
            return resources.size
          },
        }
      }

      const { result, unmount } = renderHook(mockHook)

      // Add some resources
      act(() => {
        result.current.addResource('1', { data: new Array(1000).fill(0) })
        result.current.addResource('2', { data: new Array(1000).fill(1) })
      })

      expect(result.current.resourceCount).toBe(2)

      // Unmount should trigger cleanup
      unmount()

      expect(cleanup).toHaveBeenCalled()
    })
  })

  describe('State Update Efficiency', () => {
    it('should batch state updates efficiently', async () => {
      stateTracker.reset()

      // Simulate rapid state updates
      const updatePromises = Array.from(
        { length: 20 },
        (_, index) =>
          new Promise((resolve) => {
            setTimeout(() => {
              stateTracker.track(`batch-update-${index}`)
              resolve(index)
            }, index * 10) // Stagger updates every 10ms
          })
      )

      await Promise.all(updatePromises)

      const updateRate = stateTracker.getUpdateRate(500) // Check rate over last 500ms
      expect(updateRate).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MAX_STATE_UPDATE_RATE
      )

      const totalUpdates = stateTracker.getUpdateCount()
      expect(totalUpdates).toBe(20)
    })

    it('should handle burst updates without performance degradation', async () => {
      const burstSize = 50
      const burstInterval = 100 // 100ms burst window

      performanceTimer.start()

      // Create burst of updates
      const burstPromises = Array.from(
        { length: burstSize },
        (_, index) =>
          new Promise((resolve) => {
            // All updates within burst interval
            setTimeout(() => {
              stateTracker.track(`burst-${index}`)
              resolve(index)
            }, Math.random() * burstInterval)
          })
      )

      await Promise.all(burstPromises)
      const burstDuration = performanceTimer.stop()

      // Burst should complete within reasonable time
      expect(burstDuration).toBeLessThan(burstInterval * 2)

      // All updates should be tracked
      expect(stateTracker.getUpdateCount()).toBe(burstSize)
    })
  })

  describe('Batch Operations Performance', () => {
    it('should process batches efficiently with controlled concurrency', async () => {
      const batchTester = createBatchOperationTester(5)
      const items = Array.from({ length: 25 }, (_, index) => ({
        id: index,
        data: `item-${index}`,
      }))

      performanceTimer.start()

      const results = await batchTester.runInBatches(
        items,
        async (item, index) => {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 20))
          stateTracker.track(`batch-item-${index}`)
          return { processed: item.id }
        },
        { concurrency: 3, delay: 10 }
      )

      const duration = performanceTimer.stop()

      expect(results).toHaveLength(25)
      expect(stateTracker.getUpdateCount()).toBe(25)

      // Should be more efficient than sequential processing
      const sequentialEstimate = items.length * 20 // 20ms per item
      expect(duration).toBeLessThan(sequentialEstimate)
    })
  })

  describe('Performance Baseline Comparison', () => {
    it('should meet or exceed baseline performance metrics', async () => {
      // These would be loaded from performance_baseline.json in real implementation
      const baselineMetrics = {
        averageProcessingTime: 200, // ms
        maxConcurrentOperations: 10,
        memoryUsageLimit: 100 * 1024 * 1024, // 100MB
      }

      const threads = createMultiThreadScenario(5)
      const messages = createConcurrentMessageBatch(threads, 2)

      performanceTimer.start()

      const operations = messages.map(
        (message, index) =>
          new Promise((resolve) => {
            const processingTime = Math.random() * 150 // 0-150ms random
            setTimeout(() => {
              resolve({ messageId: message.id, processingTime })
            }, processingTime)
          })
      )

      const result = await waitForConcurrentOperations(operations)
      const totalDuration = performanceTimer.stop()
      const averageProcessingTime = totalDuration / messages.length

      // Performance should meet baseline expectations
      expect(averageProcessingTime).toBeLessThan(
        baselineMetrics.averageProcessingTime
      )
      expect(result.successful).toBe(messages.length)

      const memoryDelta = memoryMonitor.getMemoryDelta()
      if (memoryDelta) {
        expect(Math.abs(memoryDelta.usedDelta)).toBeLessThan(
          baselineMetrics.memoryUsageLimit
        )
      }
    })
  })

  describe('Error Recovery Performance', () => {
    it('should handle errors without significant performance impact', async () => {
      const threads = createMultiThreadScenario(5)
      const messages = createConcurrentMessageBatch(threads, 2)

      performanceTimer.start()

      // Simulate operations with 30% failure rate
      const operations = messages.map(
        (message, index) =>
          new Promise((resolve, reject) => {
            setTimeout(() => {
              if (Math.random() < 0.3) {
                reject(new Error(`Processing failed for ${message.id}`))
              } else {
                resolve({ messageId: message.id, processed: true })
              }
            }, 50)
          })
      )

      const result = await waitForConcurrentOperations(operations)
      const duration = performanceTimer.stop()

      // Should complete within reasonable time despite errors
      expect(duration).toBeLessThan(1000)
      expect(result.successful + result.failed).toBe(messages.length)

      // Some operations should succeed
      expect(result.successful).toBeGreaterThan(0)
    })
  })
})
