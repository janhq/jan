//! Stream events emitted by the agent orchestration loop. Deliberately
//! Tauri-free: CLI/TUI consume these directly and `tauri-plugin-agent` bridges
//! them to a `tauri::ipc::Channel`. The loop emits per-token `Token` deltas
//! (the upstream call streams via SSE) plus per-step progress and one terminal
//! `Done`/`Error`.

#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// A streamed content delta from the model.
    Token { text: String },
    /// A new orchestration turn began (`index` is 1-based; `max` is the turn
    /// cap, `0` when the run is unbounded, which is the normal case).
    Step { index: u32, max: u32 },
    /// The model requested a tool call. `args` is the parsed argument object
    /// (null if the model emitted non-JSON arguments).
    ToolCall {
        id: String,
        name: String,
        args: serde_json::Value,
    },
    /// A tool finished. `is_error` reflects the upstream "ERROR" encoding.
    /// `diff` is display-only focused-change text (line-prefixed `-`/`+`) for
    /// `write`/`edit`; `None` for other tools.
    ToolResult {
        id: String,
        content: String,
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
    },
    /// A backgrounded subagent run began. `run_id` identifies the run so a
    /// consumer can attribute concurrent children; brackets the child's wrapped
    /// events with `SubagentEnd`.
    SubagentStart { run_id: String, name: String },
    /// A backgrounded subagent run finished (success or error). Pairs with the
    /// `SubagentStart` of the same `run_id`.
    SubagentEnd { run_id: String, name: String },
    /// A backgrounded subagent's own internal event, tagged with its run so a
    /// consumer can attribute it to the right child even when several run
    /// concurrently. `event` is a non-terminal child event (Token/Step/ToolCall/
    /// ToolResult/PermissionRequest); the child's terminal Done/Error is never
    /// wrapped (its result is delivered via `await_subagent`).
    Subagent {
        run_id: String,
        name: String,
        event: Box<StreamEvent>,
    },
    /// The loop's compaction reduced the conversation while retrying a
    /// context overflow. The client should replace its session history with
    /// `messages` for subsequent turns.
    MessagesUpdated {
        messages: Vec<serde_json::Value>,
    },
    /// Terminal success: the model returned a final (tool-free) completion.
    Done {
        stop_reason: String,
        usage: Option<Usage>,
    },
    /// Terminal failure (setup error, upstream/tool failure, or max_turns).
    Error { code: String, message: String },
    /// The loop needs the user to approve a gated tool call. The client replies via
    /// the `agent_permission_respond` command referencing `request_id`.
    PermissionRequest {
        request_id: String,
        tool_name: String,
        capability: String,
        path: Option<String>,
        /// The shell command for exec prompts (drives the command-scoped
        /// "allow always" grant); `None` for non-exec tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        /// Focused diff preview for `write`/`edit` prompts so the user sees the
        /// change before approving; `None` for other tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
        prompt_kind: String,
        offers_always: bool,
    },
}

/// If `path` targets a file in the agent's skill or memory workspace, return the
/// kind (`"skill"`/`"memory"`) and the item name (file stem). None otherwise.
fn classify_agent_path(path: &str) -> Option<(&'static str, String)> {
    let norm = path.replace('\\', "/");
    for (needle, kind) in [
        (".jan/agent/skills/", "skill"),
        (".jan/agent/memory/", "memory"),
    ] {
        if let Some(idx) = norm.find(needle) {
            let rest = &norm[idx + needle.len()..];
            if rest.is_empty() || rest.ends_with('/') {
                return Some((kind, String::new()));
            }
            let stem = std::path::Path::new(rest)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(rest);
            return Some((kind, stem.to_string()));
        }
    }
    None
}

/// Human-facing one-line status for a tool call. Reads/writes of skill or memory
/// files get a semantic label (e.g. "Reading skill: deploy", "Updating memory:
/// decisions") instead of the raw tool name + path. Everything else falls back
/// to `name` + compact args.
pub fn describe_tool_call(name: &str, args: &serde_json::Value) -> String {
    // Dedicated skill/memory tools are self-describing via their name + `name` arg.
    let dedicated = match name {
        "memory_list" => Some(("Reading", "memory", String::new())),
        "skill_list" => Some(("Reading", "skill", String::new())),
        "memory_read" => Some(("Reading", "memory", arg_name(args))),
        "memory_write" => Some(("Updating", "memory", arg_name(args))),
        "skill_read" => Some(("Reading", "skill", arg_name(args))),
        "skill_write" => Some(("Updating", "skill", arg_name(args))),
        _ => None,
    };
    // Fallback: generic read/write/edit hitting the workspace by path.
    let labelled = dedicated.or_else(|| {
        args.get("path")
            .and_then(|v| v.as_str())
            .and_then(classify_agent_path)
            .map(|(kind, item)| {
                let verb = if matches!(name, "write" | "edit") {
                    "Updating"
                } else {
                    "Reading"
                };
                (verb, kind, item)
            })
    });
    if let Some((verb, kind, item)) = labelled {
        return if item.is_empty() {
            let plural = if kind == "memory" { "memory notes" } else { "skills" };
            format!("{verb} {plural}")
        } else {
            format!("{verb} {kind}: {item}")
        };
    }
    format!("{name} {args}")
}

fn arg_name(args: &serde_json::Value) -> String {
    args.get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_end_matches(".md").to_string())
        .unwrap_or_default()
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Usage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

impl Usage {
    pub(crate) fn from_completion(completion: &serde_json::Value) -> Option<Self> {
        let usage = completion.get("usage")?;
        Some(Self {
            prompt_tokens: usage.get("prompt_tokens").and_then(|v| v.as_u64()),
            completion_tokens: usage.get("completion_tokens").and_then(|v| v.as_u64()),
            total_tokens: usage.get("total_tokens").and_then(|v| v.as_u64()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn token_serializes_with_snake_case_tag() {
        let v = serde_json::to_value(StreamEvent::Token { text: "hi".into() }).unwrap();
        assert_eq!(v, json!({ "type": "token", "text": "hi" }));
    }

    #[test]
    fn step_serializes_with_snake_case_tag() {
        let v = serde_json::to_value(StreamEvent::Step { index: 1, max: 8 }).unwrap();
        assert_eq!(v, json!({ "type": "step", "index": 1, "max": 8 }));
    }

    #[test]
    fn describe_labels_dedicated_skill_and_memory_tools() {
        assert_eq!(
            describe_tool_call("memory_write", &json!({"name": "decisions"})),
            "Updating memory: decisions"
        );
        assert_eq!(
            describe_tool_call("memory_read", &json!({"name": "drift.md"})),
            "Reading memory: drift"
        );
        assert_eq!(
            describe_tool_call("skill_write", &json!({"name": "deploy"})),
            "Updating skill: deploy"
        );
        assert_eq!(
            describe_tool_call("memory_list", &json!({})),
            "Reading memory notes"
        );
        assert_eq!(describe_tool_call("skill_list", &json!({})), "Reading skills");
    }

    #[test]
    fn describe_labels_fallback_path_ops() {
        assert_eq!(
            describe_tool_call("read", &json!({"path": ".jan/agent/skills/deploy.md"})),
            "Reading skill: deploy"
        );
        assert_eq!(
            describe_tool_call("write", &json!({"path": ".jan/agent/memory/decisions.md"})),
            "Updating memory: decisions"
        );
    }

    #[test]
    fn describe_falls_back_for_non_workspace_calls() {
        assert_eq!(
            describe_tool_call("read", &json!({"path": "src/main.rs"})),
            "read {\"path\":\"src/main.rs\"}"
        );
        assert_eq!(
            describe_tool_call("search", &json!({"q": "rust"})),
            "search {\"q\":\"rust\"}"
        );
    }

    #[test]
    fn tool_call_and_result_serialize_to_wire_shape() {
        let call = serde_json::to_value(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "search".into(),
            args: json!({ "q": "rust" }),
        })
        .unwrap();
        assert_eq!(
            call,
            json!({ "type": "tool_call", "id": "c1", "name": "search", "args": { "q": "rust" } })
        );

        let result = serde_json::to_value(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        })
        .unwrap();
        assert_eq!(
            result,
            json!({ "type": "tool_result", "id": "c1", "content": "ok", "is_error": false })
        );
    }

    #[test]
    fn done_and_error_serialize_to_wire_shape() {
        let done = serde_json::to_value(StreamEvent::Done {
            stop_reason: "stop".into(),
            usage: None,
        })
        .unwrap();
        assert_eq!(
            done,
            json!({ "type": "done", "stop_reason": "stop", "usage": null })
        );

        let err = serde_json::to_value(StreamEvent::Error {
            code: "error".into(),
            message: "boom".into(),
        })
        .unwrap();
        assert_eq!(
            err,
            json!({ "type": "error", "code": "error", "message": "boom" })
        );
    }

    #[test]
    fn permission_request_serializes_to_wire_shape() {
        let v = serde_json::to_value(StreamEvent::PermissionRequest {
            request_id: "perm-1".into(),
            tool_name: "write".into(),
            capability: "write".into(),
            path: Some("out.txt".into()),
            command: None,
            diff: Some("@@ created file @@\n+ hi".into()),
            prompt_kind: "write".into(),
            offers_always: true,
        })
        .unwrap();
        assert_eq!(
            v,
            json!({
                "type": "permission_request",
                "request_id": "perm-1",
                "tool_name": "write",
                "capability": "write",
                "path": "out.txt",
                "diff": "@@ created file @@\n+ hi",
                "prompt_kind": "write",
                "offers_always": true
            })
        );
    }

    #[test]
    fn subagent_bracket_events_serialize_to_wire_shape() {
        let start = serde_json::to_value(StreamEvent::SubagentStart {
            run_id: "sub-1".into(),
            name: "rust-reviewer".into(),
        })
        .unwrap();
        assert_eq!(
            start,
            json!({ "type": "subagent_start", "run_id": "sub-1", "name": "rust-reviewer" })
        );
        let end = serde_json::to_value(StreamEvent::SubagentEnd {
            run_id: "sub-1".into(),
            name: "rust-reviewer".into(),
        })
        .unwrap();
        assert_eq!(
            end,
            json!({ "type": "subagent_end", "run_id": "sub-1", "name": "rust-reviewer" })
        );
    }

    #[test]
    fn wrapped_subagent_event_nests_inner_event() {
        let v = serde_json::to_value(StreamEvent::Subagent {
            run_id: "sub-1".into(),
            name: "reviewer".into(),
            event: Box::new(StreamEvent::Token { text: "hi".into() }),
        })
        .unwrap();
        assert_eq!(
            v,
            json!({
                "type": "subagent",
                "run_id": "sub-1",
                "name": "reviewer",
                "event": { "type": "token", "text": "hi" }
            })
        );
    }

    #[test]
    fn usage_parses_present_fields_and_none_when_absent() {
        let parsed = Usage::from_completion(&json!({
            "usage": { "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15 }
        }))
        .unwrap();
        assert_eq!(parsed.prompt_tokens, Some(10));
        assert_eq!(parsed.completion_tokens, Some(5));
        assert_eq!(parsed.total_tokens, Some(15));

        assert!(Usage::from_completion(&json!({ "choices": [] })).is_none());
    }
}
