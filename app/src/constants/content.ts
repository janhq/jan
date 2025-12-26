/**
 * Message content types and field names
 */

// Content part types (matches UI message part types from 'ai' SDK)
export const CONTENT_TYPE = {
  TEXT: 'text',
  REASONING: 'reasoning',
  FILE: 'file',
  REASONING_TEXT: 'reasoning_text',
  INPUT_TEXT: 'input_text',
  TOOL_CALLS: 'tool_calls',
} as const

export type ContentTypeValue = (typeof CONTENT_TYPE)[keyof typeof CONTENT_TYPE]

// Tool-related content fields
export const TOOL_CONTENT_FIELD = {
  TOOL_CALL_ID: 'tool_call_id',
  TOOL_RESULT: 'tool_result',
  MCP_CALL: 'mcp_call',
  CALL_ID: 'call_id', // deprecated
} as const

// Message roles
export const MESSAGE_ROLE = {
  TOOL: 'tool',
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const

export type MessageRoleValue = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE]
