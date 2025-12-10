/**
 * Shared MCP utilities for extensions-web
 * Provides common functions for handling MCP tool call results
 */

import type { MCPToolCallResult, MCPToolCallResultContent } from '@janhq/core'

/** Create an error result with the given message */
export const createErrorResult = (error: string, text?: string): MCPToolCallResult => ({
  error,
  content: [{ type: 'text' as const, text: text || error }]
})

/** Normalize content item to proper MCPToolCallResultContent type */
export const normalizeContentItem = (item: { type?: string; text?: string; data?: string; mimeType?: string }): MCPToolCallResultContent => {
  if (item.type === 'image' && item.data && item.mimeType) {
    return { type: 'image' as const, data: item.data, mimeType: item.mimeType }
  }
  return { type: 'text' as const, text: item.text || '' }
}

/** Normalize tool call result content array */
export const normalizeResult = (result: { error?: string; content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }> }): MCPToolCallResult => ({
  error: result.error || '',
  content: (result.content || []).map(normalizeContentItem)
})
