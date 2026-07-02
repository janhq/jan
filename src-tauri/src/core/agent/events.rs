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
    /// A new orchestration turn began (`index` is 1-based, `max` = max_turns).
    Step { index: u32, max: u32 },
    /// The model requested a tool call. `args` is the parsed argument object
    /// (null if the model emitted non-JSON arguments).
    ToolCall {
        id: String,
        name: String,
        args: serde_json::Value,
    },
    /// A tool finished. `is_error` reflects the upstream "ERROR" encoding.
    ToolResult {
        id: String,
        content: String,
        is_error: bool,
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
        prompt_kind: String,
        offers_always: bool,
    },
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
                "prompt_kind": "write",
                "offers_always": true
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
