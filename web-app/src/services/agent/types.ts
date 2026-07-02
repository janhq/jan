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
  | {
      type: 'permission_request'
      request_id: string
      tool_name: string
      capability: string
      path?: string | null
      prompt_kind: string
      offers_always: boolean
    }
  | { type: 'done'; stop_reason: string; usage: AgentUsage | null }
  | { type: 'error'; code: string; message: string }

/** Mirrors the Rust `PermissionDecision` (serde snake_case). */
export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny'

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
  /** Project root; enables built-in fs tools and loads agent.toml permissions. */
  project?: string
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
  /** Answer a `permission_request` event by its `request_id`. */
  respondPermission(
    requestId: string,
    decision: PermissionDecision
  ): Promise<void>
  /** Scaffold a `.jan/agent/` project under `projectRoot`; returns the created dir. */
  initProject(projectRoot: string): Promise<string>
}
