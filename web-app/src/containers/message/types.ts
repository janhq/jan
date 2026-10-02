import type { ToolUIPart } from 'ai'

export const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

export const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

/** Minimal shape shared by the message-part renderers. */
export type MessagePartLike = {
  type: string
  text?: string
  state?: ToolUIPart['state']
  toolCallId?: string
  input?: ToolUIPart['input']
  output?: ToolUIPart['output']
  errorText?: string
  error?: string
  filename?: string
  url?: string
  mediaType?: string
}

export type PartEntry = { part: MessagePartLike; index: number }

/** A tool part carrying the lifecycle state the SDK attaches once it is live. */
export type ToolPartLike = MessagePartLike & { state: ToolUIPart['state'] }

/** A tool part only renders once the SDK has attached a lifecycle state. */
export const isToolPart = (part: MessagePartLike): part is ToolPartLike =>
  part.type.startsWith('tool-') && part.state !== undefined
