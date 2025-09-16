/**
 * Retry Manager for MCP Tool Calls
 * Manages retry logic with exponential backoff and failure tracking
 */

import { sha1 } from 'hash-wasm'

export interface RetryConfig {
  maxRetries: number
  resetTimeMs: number
  enableJitter?: boolean // Adds random delay (0-1000ms) to prevent thundering herd when multiple clients retry simultaneously
}

interface FailureRecord {
  count: number
  lastFailure: number
  firstFailure: number
}

export class MCPRetryManager {
  private failureCache: Map<string, FailureRecord> = new Map()
  private readonly config: Required<RetryConfig>

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 1,
      resetTimeMs: config?.resetTimeMs ?? 300000, // 5 minutes default
      enableJitter: config?.enableJitter ?? false
    }
  }

  /**
   * Generate a unique key for a tool call based on name and arguments
   */
  async generateCallKey(toolName: string, args: Record<string, unknown>): Promise<string> {
    // Sort keys for consistent hashing regardless of property order
    const sortedArgs = this.sortObjectKeys(args)
    const input = `${toolName}:${JSON.stringify(sortedArgs)}`

    // Create a fast SHA-1 hash using hash-wasm
    return await sha1(input)
  }

  /**
   * Check if a tool call should be retried
   * If jitter is enabled and retry is allowed, applies a random delay
   */
  async shouldRetry(callKey: string): Promise<boolean> {
    const failure = this.failureCache.get(callKey)
    if (!failure) {
      return true // First attempt
    }

    const now = Date.now()

    // Reset if enough time has passed since first failure
    if (now - failure.firstFailure > this.config.resetTimeMs) {
      this.failureCache.delete(callKey)
      return true
    }

    const canRetry = failure.count <= this.config.maxRetries

    // Apply jitter if enabled and retry is allowed
    if (canRetry && this.config.enableJitter && failure.count > 0) {
      await this.applyJitter(failure.count)
    }

    return canRetry
  }

  /**
   * Apply random jitter delay to prevent thundering herd
   * Delay increases with attempt number: base 100-500ms for attempt 1, up to 500-1500ms for later attempts
   */
  private async applyJitter(attemptNumber: number): Promise<void> {
    // Base delay increases with attempt number
    const baseDelay = Math.min(100 * attemptNumber, 500)
    // Random additional delay up to 1000ms
    const randomDelay = Math.random() * 1000
    const totalDelay = baseDelay + randomDelay

    console.log(`Applying jitter delay of ${Math.round(totalDelay)}ms before retry attempt ${attemptNumber}`)
    return new Promise(resolve => setTimeout(resolve, totalDelay))
  }

  /**
   * Record a failure for a tool call
   */
  recordFailure(callKey: string): void {
    const now = Date.now()
    const failure = this.failureCache.get(callKey)

    if (failure) {
      failure.count++
      failure.lastFailure = now
    } else {
      this.failureCache.set(callKey, {
        count: 1,
        lastFailure: now,
        firstFailure: now
      })
    }
  }

  /**
   * Record a successful tool call, clearing any failure history
   */
  recordSuccess(callKey: string): void {
    this.failureCache.delete(callKey)
  }

  /**
   * Get retry information for error messages
   */
  getRetryInfo(callKey: string): {
    attemptsUsed: number
    remainingRetries: number
    isExhausted: boolean
  } {
    const failure = this.failureCache.get(callKey)
    const attemptsUsed = failure?.count || 0
    const remainingRetries = Math.max(0, this.config.maxRetries - attemptsUsed + 1)

    return {
      attemptsUsed,
      remainingRetries,
      isExhausted: attemptsUsed > this.config.maxRetries
    }
  }


  /**
   * Clear all failure records
   */
  clear(): void {
    this.failureCache.clear()
  }

  /**
   * Get statistics about current failures
   */
  getStats(): {
    totalFailures: number
    exhaustedTools: number
    activeFailures: Array<{ key: string; count: number; timeUntilReset: number }>
  } {
    const now = Date.now()
    const activeFailures: Array<{ key: string; count: number; timeUntilReset: number }> = []
    let exhaustedCount = 0

    for (const [key, failure] of this.failureCache.entries()) {
      const timeUntilReset = Math.max(0, this.config.resetTimeMs - (now - failure.firstFailure))

      if (failure.count > this.config.maxRetries) {
        exhaustedCount++
      }

      activeFailures.push({
        key,
        count: failure.count,
        timeUntilReset
      })
    }

    return {
      totalFailures: this.failureCache.size,
      exhaustedTools: exhaustedCount,
      activeFailures
    }
  }

  /**
   * Sort object keys recursively for consistent hashing
   */
  private sortObjectKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObjectKeys(item))
    }

    const sortedObj: any = {}
    Object.keys(obj).sort().forEach(key => {
      sortedObj[key] = this.sortObjectKeys(obj[key])
    })

    return sortedObj
  }
}