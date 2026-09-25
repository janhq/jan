// Generated from protocol/rpc-schema.json by packages/adk/scripts/generate.mjs.
// Do not edit by hand: run `node packages/adk/scripts/generate.mjs` after
// changing the Rust dispatcher, and commit the regenerated output with it.

export const PROTOCOL_VERSION = 1

/** The `type` tag of every event, which is also its `item/<tag>` method name. */
export const EVENT_TAGS = Object.freeze([
  "token",
  "reasoning",
  "step",
  "tool_call_started",
  "tool_call_args_delta",
  "tool_call",
  "tool_output_delta",
  "tool_result",
  "subagent_start",
  "subagent_queued",
  "subagent_end",
  "subagent_plan",
  "subagent",
  "notice",
  "monitors",
  "parked",
  "messages_updated",
  "ask_request",
  "ask_resolved",
  "todo_update",
  "turn_usage",
  "done",
  "error",
  "permission_request",
  "tool_request",
  "tool_request_cancelled",
  "tool_details",
  "request_provenance",
])
