// Generated from protocol/rpc-schema.json by packages/agent-sdk/scripts/generate.mjs.
// Do not edit by hand: run `node packages/agent-sdk/scripts/generate.mjs` after
// changing the Rust dispatcher, and commit the regenerated output with it.

export declare const PROTOCOL_VERSION: 1

/** The JSON-RPC methods this protocol accepts, in schema order. */
export type RpcMethod =
  | "initialize"
  | "session/list"
  | "session/start"
  | "session/resume"
  | "session/fork"
  | "session/archive"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt"
  | "permission/respond"
  | "tool/respond"
  | "session/tools/get"
  | "session/tools/set"
  | "session/model/set"
  | "session/reset"

/** The `type` tag of an event, which is also its `item/<tag>` method name. */
export type EventTag =
  | "token"
  | "reasoning"
  | "step"
  | "tool_call_started"
  | "tool_call_args_delta"
  | "tool_call"
  | "tool_output_delta"
  | "tool_result"
  | "subagent_start"
  | "subagent_queued"
  | "subagent_end"
  | "subagent_plan"
  | "subagent"
  | "notice"
  | "monitors"
  | "parked"
  | "messages_updated"
  | "ask_request"
  | "ask_resolved"
  | "todo_update"
  | "turn_usage"
  | "done"
  | "error"
  | "permission_request"
  | "tool_request"
  | "tool_request_cancelled"
  | "tool_details"

export declare const EVENT_TAGS: readonly EventTag[]

// ---------------------------------------------------------------------------
// Shared definitions
// ---------------------------------------------------------------------------

export interface AskRequest {
  "questions": Question[]
}

export interface ClientInfo {
  "name": string
  "version": string
}

/** What a host says a tool does, which decides how the loop treats it. Absent means opaque: prompted unless `auto_approve`, sequential, withheld in Plan mode -- the plugin/MCP default. */
export type HostCapability = "read" | "actuator"

/** The declaration shape, for the document only: the dispatcher parses the real `HostToolDecl`, which lives outside this module and carries no schema. */
export interface HostToolDeclSchema {
  "name": string
  "description"?: string
  /** JSON Schema for the arguments, advertised to the model verbatim. */
  "parameters"?: Record<string, unknown> | null
  "capability"?: HostCapability | null
}

/** Display-only view of one active monitor, for a status panel. */
export interface MonitorSnapshot {
  "monitorId": string
  "name": string
  "script": string
  "polls": number
}

export interface OptionItem {
  "label": string
  "description"?: string | null
}

/** A subagent in a not-yet-started phase of a phased dispatch: its name (unique across the plan, and its blackboard file) and 1-based phase number. Carried by [`StreamEvent::SubagentPlan`] so a consumer can show it waiting on the phase before it. */
export interface PendingSubagent {
  "name": string
  "phase": number
}

/** Who gates host tool calls. `jan` prompts through `permission_request` the way any opaque tool is prompted; `host` means the host's own callback is the gate, so Jan never asks about a host tool. */
export type PermissionOwner = "jan" | "host"

export interface Question {
  "id": string
  "question": string
  "options": OptionItem[]
  "multi"?: boolean
  "recommended"?: number | null
}

export interface TodoItem {
  "content": string
  "status": TodoStatus
}

export interface TodoList {
  "phases": TodoPhase[]
}

export interface TodoPhase {
  "name": string
  "tasks": TodoItem[]
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned"

/** A host tool's answer: text, or OpenAI content parts (`text` / `image_url` with a base64 `data:` URL) under the same caps as a user message. */
export type ToolResultContent = string | unknown[]

export interface Usage {
  "prompt_tokens"?: number | null
  "completion_tokens"?: number | null
  "total_tokens"?: number | null
  /** Prompt tokens served from the provider's prompt cache (a read/hit). OpenAI reports it under `prompt_tokens_details.cached_tokens`; Anthropic under `cache_read_input_tokens`. A thrashing cache shows here as a low value against a high `prompt_tokens`. */
  "cached_tokens"?: number | null
  /** Prompt tokens written into the provider cache this request (a write). Only Anthropic bills this separately (`cache_creation_input_tokens`); absent for providers that do not distinguish reads from writes. */
  "cache_write_tokens"?: number | null
}

// ---------------------------------------------------------------------------
// Request parameters, one type per Rust params struct
// ---------------------------------------------------------------------------

/** `initialize` */
export interface InitializeParams {
  "protocolVersion": number
  "clientInfo": ClientInfo
  "capabilities"?: unknown
}

/** `session/list` */
export type SessionListParams = Record<string, unknown>

/** `session/start` */
export interface SessionStartParams {
  "cwd": string
  "model"?: string | null
  "ephemeral"?: boolean
  /** Host tools this session may call. Kept as raw values until declaration so a malformed entry is reported as `invalid_tools` with the reason, rather than as a generic params error that names nothing. */
  "tools"?: HostToolDeclSchema[]
  /** `false` advertises only the host tools: no built-ins, MCP, plugin, `ask`, `todo`, subagent or monitor tools. */
  "builtins"?: boolean
  "permissions"?: PermissionOwner
}

/** `session/resume`, `session/fork`, `session/archive`, `turn/interrupt`, `session/tools/get`, `session/reset` */
export interface SessionIdParams {
  "sessionId": string
}

/** `turn/start` */
export interface TurnStartParams {
  "sessionId": string
  "input": unknown
}

/** `turn/steer` */
export interface TurnSteerParams {
  "sessionId": string
  "input": string
}

/** `permission/respond` */
export interface PermissionResponseParams {
  "requestId": string
  "decision": string
}

/** `tool/respond` */
export interface ToolRespondParams {
  "requestId": string
  "content": ToolResultContent
  "isError"?: boolean
  /** Host/UI-only data, echoed as `item/tool_details` and never sent to the model. */
  "details"?: Record<string, unknown> | null
}

/** `session/tools/set` */
export interface SessionToolsSetParams {
  "sessionId": string
  "tools": HostToolDeclSchema[]
}

/** `session/model/set` */
export interface SessionModelSetParams {
  "sessionId": string
  "model": string
}

/** The params a given method accepts, refused at compile time when they mismatch. */
export type RpcParams<M extends RpcMethod> =
  | (M extends "initialize" ? InitializeParams : never)
  | (M extends "session/list" ? SessionListParams : never)
  | (M extends "session/start" ? SessionStartParams : never)
  | (M extends "session/resume" | "session/fork" | "session/archive" | "turn/interrupt" | "session/tools/get" | "session/reset" ? SessionIdParams : never)
  | (M extends "turn/start" ? TurnStartParams : never)
  | (M extends "turn/steer" ? TurnSteerParams : never)
  | (M extends "permission/respond" ? PermissionResponseParams : never)
  | (M extends "tool/respond" ? ToolRespondParams : never)
  | (M extends "session/tools/set" ? SessionToolsSetParams : never)
  | (M extends "session/model/set" ? SessionModelSetParams : never)

// ---------------------------------------------------------------------------
// Events: the payload of an `item/<tag>` notification
// ---------------------------------------------------------------------------

/** A streamed content delta from the model. */
export interface TokenEvent {
  "text": string
  "type": "token"
}

/** A streamed reasoning delta, carried natively when the upstream exposes it as a dedicated field (`reasoning_content`). Display-only: reasoning never joins the assistant `content` that is resent as history, and it must never leak into piped stdout. Providers that instead inline `<think>` tags in `content` stream those through [`Token`]; consumers fall back to stripping the tags manually. */
export interface ReasoningEvent {
  "text": string
  "type": "reasoning"
}

/** A new orchestration turn began (`index` is 1-based; `max` is the turn cap, `0` when the run is unbounded, which is the normal case). */
export interface StepEvent {
  "index": number
  "max": number
  "type": "step"
}

/** A tool call started streaming: emitted mid-stream the instant the model's tool-call `id` and `name` are known, before its arguments finish streaming. Lets a consumer show an in-progress indicator during the (potentially long) argument-streaming window; the full [`ToolCall`] with parsed `args` follows once the completion is assembled. */
export interface ToolCallStartedEvent {
  "id": string
  "name": string
  "type": "tool_call_started"
}

/** A chunk of a tool call's raw JSON arguments, exactly as it arrived on the wire. Emitted between [`ToolCallStarted`] and [`ToolCall`] so a consumer can render the arguments as they land -- the difference between a featureless spinner and a live preview while a large `write` streams. Deltas, not the accumulated buffer: re-sending the whole prefix on every chunk is quadratic in a file-sized argument. Consumers concatenate. The result is *incomplete JSON* until [`ToolCall`] arrives; parse it leniently or not at all. */
export interface ToolCallArgsDeltaEvent {
  "id": string
  "delta": string
  "type": "tool_call_args_delta"
}

/** The model requested a tool call. `args` is the parsed argument object (null if the model emitted non-JSON arguments). */
export interface ToolCallEvent {
  "id": string
  "name": string
  "args": unknown
  "type": "tool_call"
}

/** A chunk of a tool's output, as it is produced. Emitted between [`ToolCall`] and [`ToolResult`] so a consumer can show a command's output while it runs instead of only once it exits. Deltas, not the accumulated buffer, for the same reason as [`ToolCallArgsDelta`]: resending the prefix on every chunk is quadratic in the output size. Chunks are raw fragments and may split a line. Keeps arriving after a `bash` call has backgrounded itself, so a long-running job reports progress under the id of the call that started it. */
export interface ToolOutputDeltaEvent {
  "id": string
  "delta": string
  "type": "tool_output_delta"
}

/** A tool finished. `is_error` reflects the upstream "ERROR" encoding. `diff` is display-only focused-change text (line-prefixed `-`/`+`) for `write`/`edit`; `None` for other tools. */
export interface ToolResultEvent {
  "id": string
  "content": string
  "is_error": boolean
  "diff"?: string | null
  "type": "tool_result"
}

/** A backgrounded subagent run began. `run_id` identifies the run so a consumer can attribute concurrent children; brackets the child's wrapped events with `SubagentEnd`. */
export interface SubagentStartEvent {
  "run_id": string
  "name": string
  /** The task the child was dispatched with -- its sole user message. Carried on the event rather than left for consumers to correlate back to the `dispatch_subagent` call: two dispatches can share a `subagent_name`, so matching on name alone is ambiguous. */
  "task"?: string | null
  "type": "subagent_start"
}

/** A backgrounded subagent dispatch found the parent run's concurrency cap (`max_parallel_subagents`) exhausted and queued the child in FIFO order. `waiting` is the child's 1-based position in the queue (1 = next to start). The child's `SubagentStart` follows once a slot frees; a queued child aborted at parent teardown is closed by `SubagentEnd` like any other. */
export interface SubagentQueuedEvent {
  "run_id": string
  "name": string
  "task"?: string | null
  "waiting": number
  "type": "subagent_queued"
}

/** A backgrounded subagent run finished (success or error). Pairs with the `SubagentStart` of the same `run_id`. */
export interface SubagentEndEvent {
  "run_id": string
  "name": string
  /** Why the child failed, when it did: the same reason the parent's `<SYSTEM>` completion ping carries. Carried on the event because a background child's answer never reaches a consumer -- only the model reads it -- so without this a failed run is indistinguishable from a clean one on screen. `None` for a clean finish, and for a child cut off at parent teardown, which is not its own failure. */
  "error"?: string | null
  "type": "subagent_end"
}

/** The later phases of a phased dispatch, named up front so a consumer can show their subagents as WAITING on an earlier phase before they start. Each pending subagent is promoted by its own `SubagentStart` (or `SubagentQueued`), matched by `name`, which is unique across a plan. Display-only and never journaled; emitted only by the top-level run (children cannot dispatch), so it is never wrapped in `Subagent`. */
export interface SubagentPlanEvent {
  "pending": PendingSubagent[]
  "type": "subagent_plan"
}

/** A backgrounded subagent's own internal event, tagged with its run so a consumer can attribute it to the right child even when several run concurrently. `event` is a non-terminal child event (Token/Step/ToolCall/ ToolResult/PermissionRequest); the child's terminal Done/Error is never wrapped (its result is delivered via `await_subagent`). Never a `ToolRequest`: a client answers a request by `request_id` on stdin, and it is told nothing about this wrapper, so a nested request would be unanswerable. A child's host tool call is routed to the root channel unwrapped instead, attributed by `ToolRequest.run_id`. */
export interface SubagentEvent {
  "run_id": string
  "name": string
  "event": unknown
  "type": "subagent"
}

/** The user-facing headline of a background ping the loop just delivered to the model as a `<SYSTEM>` reminder (today: a `monitor` condition matching). Emitted at delivery, not when the ping is queued, so the transcript reads in the order the model saw things. Display-only and transient, like notes: it is never journaled. */
export interface NoticeEvent {
  "text": string
  "type": "notice"
}

/** The run's active file monitors, as a whole replacing the previous set. Emitted whenever the set changes (a `monitor` start or stop, a condition matching, a monitor finishing), so a consumer keeps a live view without bookkeeping of its own. Display-only and never journaled. Not forwarded from a child: a child's monitors are its own. */
export interface MonitorsEvent {
  "monitors": MonitorSnapshot[]
  "type": "monitors"
}

/** The model has finished its turn and the loop is parked on background work it started (a subagent still running, a monitor still watching). Nothing is being generated until a ping resumes the run, which the next `Step` marks. Lets a consumer say "watching" rather than "working". */
export interface ParkedEvent {
  "type": "parked"
}

/** The client should replace its session history with `messages` before subsequent turns. Includes accepted prompt guidance in its original position, but not a pending block from an unsuccessful request. Also carries compacted history when the loop retries a context overflow. */
export interface MessagesUpdatedEvent {
  "messages": unknown[]
  "type": "messages_updated"
}

/** The `ask` tool is waiting for structured interactive input. Carries the `ask_timeout_secs` deadline (seconds until the loop auto-selects the recommended option) as `timeout_secs`, or `None` when no timeout is configured. It travels on the event so a client can render a countdown without re-reading config: the same value both arms the loop's timer and drives the display, keeping the two in agreement. */
export interface AskRequestEvent {
  "request_id": string
  "request": AskRequest
  "timeout_secs"?: number | null
  "type": "ask_request"
}

/** An `ask` request the loop resolved without a user answer (it timed out and auto-selected). Tells a client showing the live prompt for `request_id` to dismiss it, since no `respond` from that client is coming. User-driven answers never emit this: the client clears its own prompt as it responds. */
export interface AskResolvedEvent {
  "request_id": string
  "type": "ask_resolved"
}

/** The canonical todo list changed (tool mutation or user edit in the TUI). Carries the full resulting snapshot for reconstruction. */
export interface TodoUpdateEvent {
  "list": TodoList
  "type": "todo_update"
}

/** Token usage for a single upstream request, emitted as soon as that request completes rather than waiting for the run to finish. `Done` carries only the *last* request's usage, which is too late and too little for a live display: a turn that calls tools makes many requests, and a subagent never emits `Done` into the parent stream at all. Consumers accumulate these to show context pressure, output volume, and throughput while the work is still happening -- for the parent run and, via the [`Subagent`] bracket, for each child. */
export interface TurnUsageEvent {
  "usage": Usage
  /** The provider's id for the execution that produced this usage, when it reported one. This is the handle a per-request billing lookup is keyed by, so a consumer can ask what this one request actually cost rather than only what it estimates. A sibling of `usage` rather than a field inside it, because it is a billing handle and not a token count. Absent on the default upstream path, which cannot see the response headers (see [`crate::core::agent::correlation`]); that is a limitation to report, not a reason to synthesize one. */
  "execution_id"?: string | null
  "type": "turn_usage"
}

/** Terminal success: the model returned a final (tool-free) completion. */
export interface DoneEvent {
  "stop_reason": string
  "usage"?: Usage | null
  "type": "done"
}

/** Terminal failure (setup error, upstream/tool failure, or max_turns). */
export interface ErrorEvent {
  "code": string
  "message": string
  "type": "error"
}

/** The loop needs the user to approve a gated tool call. The client replies via the `agent_permission_respond` command referencing `request_id`. */
export interface PermissionRequestEvent {
  "request_id": string
  "tool_name": string
  "capability": string
  "path"?: string | null
  /** The shell command for exec prompts (drives the command-scoped "allow always" grant); `None` for non-exec tools. */
  "command"?: string | null
  /** Focused diff preview for `write`/`edit` prompts so the user sees the change before approving; `None` for other tools. */
  "diff"?: string | null
  "prompt_kind": string
  "offers_always": boolean
  "type": "permission_request"
}

/** A host-registered tool was called and the run is waiting for the host to execute it. The client replies with a `tool_result` line carrying this `request_id`; until it does, the turn is parked on this one call. `tool_name` is the name the *host* declared, not the `host__`-prefixed name the model calls: the host dispatches on the name it chose and never has to know this layer's prefixing rule. */
export interface ToolRequestEvent {
  "request_id": string
  "tool_name": string
  /** The arguments the model produced, already parsed from the call's JSON string. Validated against nothing here -- the host owns the schema it declared and is the only party that can enforce it. */
  "args": unknown
  /** Which run raised the request: `None` for the main run, the child's run id for a subagent. Attribution only -- the host answers by `request_id` alone, and a child's request is emitted unwrapped at the top level so the same answer path serves both. */
  "run_id"?: string | null
  "type": "tool_request"
}

/** A pending [`StreamEvent::ToolRequest`] was withdrawn: the host must not answer it any more, and a late answer is reported as not pending. `reason` is `aborted` | `interrupted` | `client_gone`. */
export interface ToolRequestCancelledEvent {
  "request_id": string
  "reason": string
  "type": "tool_request_cancelled"
}

/** Host/UI-only structured data a host tool returned alongside its result, emitted right after that call's [`StreamEvent::ToolResult`] (same `id`). Never sent to the model; a display may render it or ignore it. */
export interface ToolDetailsEvent {
  "id": string
  "details": unknown
  "type": "tool_details"
}

/** Every event a session may report, discriminated on `type`. */
export type StreamEvent =
  | TokenEvent
  | ReasoningEvent
  | StepEvent
  | ToolCallStartedEvent
  | ToolCallArgsDeltaEvent
  | ToolCallEvent
  | ToolOutputDeltaEvent
  | ToolResultEvent
  | SubagentStartEvent
  | SubagentQueuedEvent
  | SubagentEndEvent
  | SubagentPlanEvent
  | SubagentEvent
  | NoticeEvent
  | MonitorsEvent
  | ParkedEvent
  | MessagesUpdatedEvent
  | AskRequestEvent
  | AskResolvedEvent
  | TodoUpdateEvent
  | TurnUsageEvent
  | DoneEvent
  | ErrorEvent
  | PermissionRequestEvent
  | ToolRequestEvent
  | ToolRequestCancelledEvent
  | ToolDetailsEvent

/** The event a given tag carries. */
export interface EventByTag {
  "token": TokenEvent
  "reasoning": ReasoningEvent
  "step": StepEvent
  "tool_call_started": ToolCallStartedEvent
  "tool_call_args_delta": ToolCallArgsDeltaEvent
  "tool_call": ToolCallEvent
  "tool_output_delta": ToolOutputDeltaEvent
  "tool_result": ToolResultEvent
  "subagent_start": SubagentStartEvent
  "subagent_queued": SubagentQueuedEvent
  "subagent_end": SubagentEndEvent
  "subagent_plan": SubagentPlanEvent
  "subagent": SubagentEvent
  "notice": NoticeEvent
  "monitors": MonitorsEvent
  "parked": ParkedEvent
  "messages_updated": MessagesUpdatedEvent
  "ask_request": AskRequestEvent
  "ask_resolved": AskResolvedEvent
  "todo_update": TodoUpdateEvent
  "turn_usage": TurnUsageEvent
  "done": DoneEvent
  "error": ErrorEvent
  "permission_request": PermissionRequestEvent
  "tool_request": ToolRequestEvent
  "tool_request_cancelled": ToolRequestCancelledEvent
  "tool_details": ToolDetailsEvent
}
