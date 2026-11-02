import type { ToolImage } from '@/lib/agentTools'

/** Shared with the existing runTurn controller; not a second executor. */
export type PendingToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
}

export type ToolOutcome = {
  /** Sent to the model. */
  output: string
  isError?: boolean
  /** Display-only unified diff. Never reaches the model. */
  diff?: string
  /** Tool-returned images reach the model through tool-image-sentinel encoding
   * (image_url parts on the role: tool message), but are never persisted. */
  images?: ToolImage[]
}

/** Conversation-owned handlers. No ambient permissions, stores, or network.
 * The adapter must gate the advertised record and explicit grants BEFORE calling
 * this seam. Handlers own suspension/cancellation using their run's signal;
 * this router neither retries nor races a side effect against cancellation.
 * A Chat adapter must supply Chat-scoped handlers, never Cowork's grant context.
 */
export type ClientToolHandlers = {
  onTodo: (input: unknown) => Promise<ToolOutcome>
  onAsk: (toolCallId: string, input: unknown) => Promise<ToolOutcome>
  onTask: (toolCallId: string, input: unknown) => Promise<ToolOutcome>
  onMonitor: (input: unknown) => Promise<ToolOutcome>
}

/** undefined means unhandled, not a successful empty result. Exceptions remain
 * owned by the surface adapter's existing tool-error normalization boundary. */
export async function dispatchClientTool(
  call: PendingToolCall,
  handlers: ClientToolHandlers
): Promise<ToolOutcome | undefined> {
  switch (call.toolName) {
    case 'todo': return handlers.onTodo(call.input)
    case 'ask': return handlers.onAsk(call.toolCallId, call.input)
    case 'task': return handlers.onTask(call.toolCallId, call.input)
    case 'monitor': return handlers.onMonitor(call.input)
    default: return undefined
  }
}
