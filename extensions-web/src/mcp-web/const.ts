/**
 * MCP Web Extension Constants
 */

export const MCP_RETRY_CONFIG = {
  maxRetries: 1,
  resetTimeMs: 300000, // 5 minutes
  enableJitter: true // Enable jitter to prevent thundering herd
} as const

export const MCP_ENDPOINTS = {
  mcp: '/mcp'
} as const