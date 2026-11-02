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

/** undefined means an unknown name ONLY. A malformed known handler fails closed;
 * exceptions remain owned by the adapter's existing error-normalization boundary. */
export async function dispatchClientTool(
  call: PendingToolCall,
  handlers: ClientToolHandlers
): Promise<ToolOutcome | undefined> {
  let outcome: ToolOutcome
  switch (call.toolName) {
    case 'todo': outcome = await handlers.onTodo(call.input); break
    case 'ask': outcome = await handlers.onAsk(call.toolCallId, call.input); break
    case 'task': outcome = await handlers.onTask(call.toolCallId, call.input); break
    case 'monitor': outcome = await handlers.onMonitor(call.input); break
    default: return undefined
  }
  // JS handlers/mocks can violate the TS contract. Never let a handled name
  // become the unknown-name sentinel and execute a second/native side effect.
  if (outcome === undefined) {
    throw new Error(`The \`${call.toolName}\` client handler returned no outcome.`)
  }
  return outcome
}
