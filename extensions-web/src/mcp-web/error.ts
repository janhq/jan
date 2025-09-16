/**
 * Error formatting utilities for MCP Tool Calls
 * Provides functions to format error messages with retry information
 */

import { MCPToolCallResult } from '@janhq/core'
import { MCPRetryManager } from './retry-manager'

/**
 * Format error message with retry information
 */
function formatErrorWithRetryInfo(
  errorMessage: string,
  callKey: string,
  retryManager: MCPRetryManager
): string {
  const retryInfo = retryManager.getRetryInfo(callKey)

  if (retryInfo.isExhausted) {
    return errorMessage // Don't add retry info if exhausted
  }

  const retryMessage = retryInfo.remainingRetries > 0
    ? ` (${retryInfo.remainingRetries} ${retryInfo.remainingRetries === 1 ? 'retry' : 'retries'} remaining for this arguments)`
    : ' (no more retries available for this arguments)'

  return `${errorMessage}${retryMessage}`
}

/**
 * Get error response for when retries are exhausted
 */
export function getExhaustedErrorResponse(
  toolName: string,
  callKey: string,
  retryManager: MCPRetryManager
): MCPToolCallResult {
  const retryInfo = retryManager.getRetryInfo(callKey)
  const attemptsText = retryInfo.attemptsUsed > 0
    ? `after ${retryInfo.attemptsUsed} failed ${retryInfo.attemptsUsed === 1 ? 'attempt' : 'attempts'}`
    : ''

  return {
    error: `Tool "${toolName}" has exceeded maximum retry attempts and is temporarily disabled`,
    content: [{
      type: 'text',
      text: `Tool "${toolName}" has failed ${attemptsText} and will not be retried. This tool may be experiencing server issues. Please try a different approach or wait before using this tool again.`
    }]
  }
}

/**
 * Create error response with retry info
 */
export function createErrorResponse(
  errorText: string,
  callKey: string,
  retryManager: MCPRetryManager
): MCPToolCallResult {
  return {
    error: errorText,
    content: [{
      type: 'text',
      text: formatErrorWithRetryInfo(errorText, callKey, retryManager)
    }]
  }
}

/**
 * Create a simple error response without retry tracking
 */
export function createSimpleErrorResponse(
  error: string,
  message?: string
): MCPToolCallResult {
  return {
    error,
    content: [{
      type: 'text',
      text: message || error
    }]
  }
}
