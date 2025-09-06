/**
 * MVP Test Utilities for Simultaneous Inference Testing
 * Provides helper functions, mocks, and utilities for testing concurrent processing
 */

import { vi, type MockedFunction, expect } from 'vitest'
import { waitFor } from '@testing-library/react'

// Test data types
export interface MockThread {
  id: string
  messages: MockMessage[]
  model: string
  status: 'idle' | 'processing' | 'error'
}

export interface MockMessage {
  id: string
  threadId: string
  content: string
  timestamp: number
  type: 'user' | 'assistant'
  status?: 'pending' | 'processing' | 'complete' | 'error'
}

export interface MockQueueItem {
  id: string
  threadId: string
  messageId: string
  priority: number
  timestamp: number
  retryCount?: number
}

// Mock data generators
export const createMockThread = (overrides: Partial<MockThread> = {}): MockThread => ({
  id: `thread-${Math.random().toString(36).substr(2, 9)}`,
  messages: [],
  model: 'test-model',
  status: 'idle',
  ...overrides,
})

export const createMockMessage = (
  threadId: string,
  overrides: Partial<MockMessage> = {}
): MockMessage => ({
  id: `msg-${Math.random().toString(36).substr(2, 9)}`,
  threadId,
  content: 'Test message content',
  timestamp: Date.now(),
  type: 'user',
  status: 'pending',
  ...overrides,
})

export const createMockQueueItem = (
  threadId: string,
  messageId: string,
  overrides: Partial<MockQueueItem> = {}
): MockQueueItem => ({
  id: `queue-${Math.random().toString(36).substr(2, 9)}`,
  threadId,
  messageId,
  priority: 1,
  timestamp: Date.now(),
  retryCount: 0,
  ...overrides,
})

// Multi-thread test scenario generators
export const createMultiThreadScenario = (threadCount: number): MockThread[] => {
  return Array.from({ length: threadCount }, (_, index) => 
    createMockThread({
      id: `thread-${index}`,
      model: index % 2 === 0 ? 'model-a' : 'model-b',
    })
  )
}

export const createConcurrentMessageBatch = (
  threads: MockThread[],
  messagesPerThread: number = 3
): MockMessage[] => {
  const messages: MockMessage[] = []
  
  threads.forEach((thread, threadIndex) => {
    for (let i = 0; i < messagesPerThread; i++) {
      messages.push(createMockMessage(thread.id, {
        content: `Message ${i + 1} for thread ${threadIndex}`,
        timestamp: Date.now() + threadIndex * 100 + i * 50,
      }))
    }
  })
  
  return messages
}

// Mock implementations for sendMessage and scheduler
export interface MockSendMessageResult {
  success: boolean
  messageId: string
  threadId: string
  processingTime?: number
  error?: string
}

export const createMockSendMessage = (
  config: {
    delay?: number
    failureRate?: number
    processingTime?: number
  } = {}
): MockedFunction<(...args: any[]) => Promise<MockSendMessageResult>> => {
  const { delay = 100, failureRate = 0, processingTime = 200 } = config

  return vi.fn().mockImplementation(async (threadId: string, _content: string) => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    if (Math.random() < failureRate) {
      return {
        success: false,
        messageId: '',
        threadId,
        error: 'Mock sendMessage failure',
      }
    }

    const messageId = `msg-${Math.random().toString(36).substr(2, 9)}`
    
    return {
      success: true,
      messageId,
      threadId,
      processingTime,
    }
  })
}

export interface MockSchedulerConfig {
  maxConcurrent?: number
  processingDelay?: number
  queueDelay?: number
}

export class MockScheduler {
  private queue: MockQueueItem[] = []
  private processing = new Set<string>()
  private maxConcurrent: number
  private processingDelay: number
  private queueDelay: number
  
  constructor(config: MockSchedulerConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 2
    this.processingDelay = config.processingDelay ?? 200
    this.queueDelay = config.queueDelay ?? 50
  }

  enqueue = vi.fn().mockImplementation(async (item: MockQueueItem) => {
    this.queue.push(item)
    this.processQueue()
  })

  private processQueue = async () => {
    if (this.processing.size >= this.maxConcurrent) {
      return
    }

    const nextItem = this.queue
      .filter(item => !this.processing.has(item.id))
      .sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp)[0]

    if (!nextItem) {
      return
    }

    this.processing.add(nextItem.id)
    this.queue = this.queue.filter(item => item.id !== nextItem.id)

    // Simulate processing delay
    setTimeout(async () => {
      await new Promise(resolve => setTimeout(resolve, this.processingDelay))
      this.processing.delete(nextItem.id)
      
      // Continue processing queue
      this.processQueue()
    }, this.queueDelay)
  }

  getQueueStatus = vi.fn().mockImplementation(() => ({
    queueLength: this.queue.length,
    processing: Array.from(this.processing),
    maxConcurrent: this.maxConcurrent,
  }))

  clearQueue = vi.fn().mockImplementation(() => {
    this.queue = []
    this.processing.clear()
  })
}

// Timing utilities for performance measurement
export class PerformanceTimer {
  private startTime: number = 0
  private endTime: number = 0
  private intervals: { name: string; time: number }[] = []

  start() {
    this.startTime = performance.now()
    this.intervals = []
  }

  mark(name: string) {
    this.intervals.push({
      name,
      time: performance.now() - this.startTime,
    })
  }

  stop() {
    this.endTime = performance.now()
    return this.getDuration()
  }

  getDuration() {
    return this.endTime - this.startTime
  }

  getIntervals() {
    return [...this.intervals]
  }

  reset() {
    this.startTime = 0
    this.endTime = 0
    this.intervals = []
  }
}

// Test assertion helpers
export const waitForQueueToProcess = async (
  getQueueLength: () => number,
  timeout: number = 5000
) => {
  await waitFor(
    () => {
      expect(getQueueLength()).toBe(0)
    },
    { timeout }
  )
}

export const waitForConcurrentOperations = async (
  operations: Promise<any>[],
  _timeout: number = 10000
) => {
  const timer = new PerformanceTimer()
  timer.start()

  const results = await Promise.allSettled(operations)
  const duration = timer.stop()

  return {
    results,
    duration,
    successful: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}

// Memory leak detection helpers
export const createMemoryMonitor = () => {
  // Type assertion for performance.memory which is not in all environments
  const perfMemory = (performance as any).memory
  const initialMemory = perfMemory ? {
    used: perfMemory.usedJSHeapSize,
    total: perfMemory.totalJSHeapSize,
  } : null

  return {
    getMemoryDelta: () => {
      const currentMemory = (performance as any).memory
      if (!currentMemory || !initialMemory) {
        return null
      }

      return {
        usedDelta: currentMemory.usedJSHeapSize - initialMemory.used,
        totalDelta: currentMemory.totalJSHeapSize - initialMemory.total,
      }
    },
    getCurrentMemory: () => {
      const currentMemory = (performance as any).memory
      return currentMemory ? {
        used: currentMemory.usedJSHeapSize,
        total: currentMemory.totalJSHeapSize,
      } : null
    },
  }
}

// State update efficiency helpers
export const createStateUpdateTracker = () => {
  const updates: { timestamp: number; componentName?: string }[] = []

  return {
    track: (componentName?: string) => {
      updates.push({
        timestamp: performance.now(),
        componentName,
      })
    },
    getUpdateCount: () => updates.length,
    getUpdateRate: (timeWindow: number = 1000) => {
      const cutoff = performance.now() - timeWindow
      const recentUpdates = updates.filter(u => u.timestamp > cutoff)
      return recentUpdates.length / (timeWindow / 1000)
    },
    reset: () => {
      updates.length = 0
    },
    getUpdates: () => [...updates],
  }
}

// Test timeout utilities
export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise])
}

// Batch operation utilities
export const createBatchOperationTester = (batchSize: number = 10) => {
  return {
    async runInBatches<T, R>(
      items: T[],
      operation: (item: T, index: number) => Promise<R>,
      options: { concurrency?: number; delay?: number } = {}
    ) {
      const { concurrency: _concurrency = 3, delay = 100 } = options
      const results: R[] = []
      const batches = []

      // Create batches
      for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize))
      }

      // Process batches with controlled concurrency
      for (const batch of batches) {
        const batchPromises = batch.map((item, index) => 
          operation(item, index)
        )

        const batchResults = await Promise.all(batchPromises)
        results.push(...batchResults)

        if (delay > 0 && batches.indexOf(batch) < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      return results
    },
  }
}
