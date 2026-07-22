//! Reactive context compaction. The agent loop has no reliable view of a
//! model's context window at request time (local windows live inside the
//! llamacpp plugin/preset; remote windows are unknown), so compaction is
//! triggered by an upstream context-overflow error rather than a proactive
//! token estimate. Given the conversation, we preserve the leading system
//! message(s) and a recent tail, summarize the dropped middle via one model
//! call, and splice the summary back in. If summarization fails the middle is
//! replaced with a short note, so the run always makes forward progress.

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::core::agent::r#loop::ModelInvoker;
use crate::core::agent::upstream::extract_choice_message;

/// Default number of most-recent non-system messages kept verbatim.
pub(crate) const DEFAULT_KEEP_RECENT: usize = 8;

/// Recent tail kept when the user explicitly runs `/compact`. Smaller than the
/// automatic threshold so a deliberate compaction is honoured on short threads.
#[cfg(feature = "cli")]
pub(crate) const MANUAL_KEEP_RECENT: usize = 2;

const SUMMARY_SYSTEM_PROMPT: &str = "You are compacting an AI agent conversation that grew too long for \
the model's context window. Summarize the messages below into a dense, factual brief that preserves \
everything needed to continue the task: the user's goals and constraints, decisions made, files and \
commands touched with their outcomes, and any unresolved questions. Omit pleasantries and redundant \
tool output. Write only the summary.";

const FALLBACK_NOTE: &str = "[Earlier conversation was omitted to fit the model's context window.]";

fn role(msg: &Value) -> &str {
    msg.get("role").and_then(|r| r.as_str()).unwrap_or("")
}

/// Compact `messages` so the result is meaningfully smaller than the input.
/// Returns the input unchanged when there is nothing safe to compact (so the
/// caller can detect a no-op and stop retrying).
pub(crate) async fn compact_conversation(
    messages: &[Value],
    model_id: &str,
    model: &dyn ModelInvoker,
    keep_recent: usize,
) -> Vec<Value> {
    let sys_end = messages.iter().take_while(|m| role(m) == "system").count();
    let (system_msgs, rest) = messages.split_at(sys_end);

    if rest.len() <= keep_recent {
        return messages.to_vec();
    }

    let mut cut = rest.len() - keep_recent;
    // The kept tail must not begin with an orphaned tool result whose assistant
    // tool-call message sits in the dropped prefix; push the boundary forward
    // until the tail starts on a user/assistant message.
    while cut < rest.len() && role(&rest[cut]) == "tool" {
        cut += 1;
    }
    if cut == 0 || cut >= rest.len() {
        return messages.to_vec();
    }

    let dropped = &rest[..cut];
    let kept = &rest[cut..];
    let summary = summarize(dropped, model_id, model).await;

    let mut out = Vec::with_capacity(system_msgs.len() + 1 + kept.len());
    out.extend_from_slice(system_msgs);
    out.push(json!({
        "role": "system",
        "content": format!("[Summary of earlier conversation, condensed to save context]\n\n{summary}")
    }));
    out.extend_from_slice(kept);
    out
}

async fn summarize(dropped: &[Value], model_id: &str, model: &dyn ModelInvoker) -> String {
    let request = json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": SUMMARY_SYSTEM_PROMPT },
            { "role": "user", "content": serialize_messages(dropped) }
        ]
    });
    // Discard the summarizer's streamed tokens: a dropped receiver means these
    // never reach the user-facing event stream.
    let (sink, _rx) = mpsc::unbounded_channel();
    match model.invoke(&request, &sink).await {
        Ok(completion) => extract_choice_message(&completion)
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| FALLBACK_NOTE.to_string()),
        Err(_) => FALLBACK_NOTE.to_string(),
    }
}

/// Render dropped messages as plain text for the summarizer, capped so a very
/// large prefix cannot itself overflow the summarization request; the most
/// recent (most relevant) content is kept when truncating.
fn serialize_messages(messages: &[Value]) -> String {
    const MAX_CHARS: usize = 120_000;
    let mut lines: Vec<String> = Vec::with_capacity(messages.len());
    for msg in messages {
        let r = role(msg);
        let content = match msg.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Null) | None => String::new(),
            Some(other) => other.to_string(),
        };
        let mut line = format!("{r}: {content}");
        if let Some(calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
            let names: Vec<&str> = calls
                .iter()
                .filter_map(|c| c.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()))
                .collect();
            if !names.is_empty() {
                line.push_str(&format!(" [tool_calls: {}]", names.join(", ")));
            }
        }
        lines.push(line);
    }
    let joined = lines.join("\n");
    if joined.len() > MAX_CHARS {
        let start = joined.len() - MAX_CHARS;
        // Snap to a char boundary so the slice is valid UTF-8.
        let start = (start..joined.len())
            .find(|i| joined.is_char_boundary(*i))
            .unwrap_or(joined.len());
        format!("[...older content truncated...]\n{}", &joined[start..])
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    struct StubModel {
        summary: String,
        calls: StdMutex<usize>,
    }
    #[async_trait]
    impl ModelInvoker for StubModel {
        async fn invoke(
            &self,
            _request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            *self.calls.lock().unwrap() += 1;
            Ok(json!({ "choices": [{ "message": { "content": self.summary.clone() } }] }))
        }
    }

    struct FailingModel;
    #[async_trait]
    impl ModelInvoker for FailingModel {
        async fn invoke(
            &self,
            _request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            Err("boom".to_string())
        }
    }

    fn convo(n: usize) -> Vec<Value> {
        let mut v = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..n {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            v.push(json!({ "role": r, "content": format!("msg{i}") }));
        }
        v
    }

    #[tokio::test]
    async fn noop_when_nothing_to_compact() {
        let model = StubModel { summary: "S".into(), calls: StdMutex::new(0) };
        let input = convo(4);
        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT).await;
        assert_eq!(out, input);
        assert_eq!(*model.calls.lock().unwrap(), 0, "no summarization on no-op");
    }

    #[tokio::test]
    async fn compacts_and_preserves_system_and_tail() {
        let model = StubModel { summary: "CONDENSED".into(), calls: StdMutex::new(0) };
        let input = convo(20);
        let out = compact_conversation(&input, "m", &model, 4).await;

        assert!(out.len() < input.len());
        assert_eq!(role(&out[0]), "system");
        assert_eq!(out[0]["content"], "sys");
        // Second message is the injected summary.
        assert_eq!(role(&out[1]), "system");
        assert!(out[1]["content"].as_str().unwrap().contains("CONDENSED"));
        // Last four originals are kept verbatim.
        assert_eq!(out[out.len() - 1]["content"], "msg19");
        assert_eq!(out[out.len() - 4]["content"], "msg16");
    }

    #[tokio::test]
    async fn falls_back_to_note_when_summarizer_fails() {
        let input = convo(20);
        let out = compact_conversation(&input, "m", &FailingModel, 4).await;
        assert!(out[1]["content"].as_str().unwrap().contains(FALLBACK_NOTE));
        assert!(out.len() < input.len());
    }

    #[tokio::test]
    async fn tail_never_starts_with_orphan_tool_result() {
        let model = StubModel { summary: "S".into(), calls: StdMutex::new(0) };
        let mut input = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..6 {
            input.push(json!({ "role": "user", "content": format!("u{i}") }));
            input.push(json!({
                "role": "assistant", "content": Value::Null,
                "tool_calls": [{ "id": "t", "function": { "name": "read" } }]
            }));
            input.push(json!({ "role": "tool", "tool_call_id": "t", "content": "res" }));
        }
        // keep_recent=4 would place the boundary mid tool-group; the guard must
        // advance it so the kept tail does not begin with a tool message.
        let out = compact_conversation(&input, "m", &model, 4).await;
        let first_kept = &out[2];
        assert_ne!(role(first_kept), "tool", "kept tail must not start with a tool result");
    }
}
