/**
 * Agent service types. `StreamEvent` mirrors the Rust `core::agent::events`
 * enum (serde tag = "type", snake_case) emitted over a Tauri Channel by
 * `agent_run`.
 */

export interface AgentUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'step'; index: number; max: number }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; content: string; is_error: boolean }
  | { type: 'done'; stop_reason: string; usage: AgentUsage | null }
  | { type: 'error'; code: string; message: string }

export interface AgentRunMessage {
  role: string
  content: string
}

export interface AgentRunBody {
  messages: AgentRunMessage[]
  model?: string
  max_turns?: number
  /** Per-run MCP tool allowlist (by tool name). Omit for all tools; empty
   * array for none. */
  allowed_tools?: string[]
  [key: string]: unknown
}

export interface AgentService {
  /** Run the agent loop; `onEvent` fires for each streamed event until a
   * terminal `done`/`error`. Resolves when the run finishes or is cancelled. */
  run(
    runId: string,
    body: AgentRunBody,
    onEvent: (event: StreamEvent) => void
  ): Promise<void>
  /** Cancel an in-flight run by id. No-op if it already finished. */
  cancel(runId: string): Promise<void>
}
