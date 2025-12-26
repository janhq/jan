/**
 * Tool invocation states (matches ToolUIPart states from 'ai' SDK)
 */

export const TOOL_STATE = {
  // Input states
  INPUT_STREAMING: 'input-streaming',
  INPUT_AVAILABLE: 'input-available',
  // Approval states
  APPROVAL_REQUESTED: 'approval-requested',
  APPROVAL_RESPONDED: 'approval-responded',
  // Output states
  OUTPUT_AVAILABLE: 'output-available',
  OUTPUT_ERROR: 'output-error',
  OUTPUT_DENIED: 'output-denied',
} as const

export type ToolStateValue = (typeof TOOL_STATE)[keyof typeof TOOL_STATE]

// Output states subset for easier checking
export const TOOL_OUTPUT_STATES = [
  TOOL_STATE.OUTPUT_AVAILABLE,
  TOOL_STATE.OUTPUT_ERROR,
  TOOL_STATE.OUTPUT_DENIED,
] as const
