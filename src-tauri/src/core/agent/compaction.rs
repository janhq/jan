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

const SUMMARY_SYSTEM_PROMPT: &str = "Summarize the AI agent conversation transcript below into a \
dense, factual brief that preserves everything needed to continue the task: the user's goals and \
constraints, decisions made, files and commands touched with their outcomes, and any unresolved \
questions. Omit pleasantries and redundant tool output. Write only the summary.";

const FALLBACK_NOTE: &str = "[Earlier conversation was omitted to fit the model's context window.]";

/// Character budget for the transcript handed to the summarizer (~12K tokens).
/// Compaction runs *because* the conversation overflowed, so replaying it whole
/// would guarantee the summarizer overflows too: the dropped span is rendered to
/// text and clamped head-and-tail to something a small window can still accept.
const SUMMARY_INPUT_CHARS: usize = 48_000;

const SUMMARY_ELISION: &str = "\n\n[... middle of the dropped transcript omitted ...]\n\n";

fn role(msg: &Value) -> &str {
    msg.get("role").and_then(|r| r.as_str()).unwrap_or("")
}

/// Where the kept tail may begin, given the ideal boundary `target`. The tail
/// must not open on an orphaned tool result whose `tool_calls` message sits in
/// the dropped prefix, so the boundary moves to the nearest message that is not
/// one. Forward first, since that drops the most; but a long agentic run under
/// a single prompt can end on a fan-out whose results reach the end of the
/// conversation, and walking forward there runs off the end and abandons
/// compaction on exactly the history that needed it. So fall back to walking
/// back onto the call that owns the batch, keeping the group whole.
///
/// `None` when the tail would leave nothing worth dropping: the summary is
/// itself a message, so a prefix of one shrinks nothing.
fn tail_start(rest: &[Value], target: usize) -> Option<usize> {
    let mut cut = target;
    while cut < rest.len() && role(&rest[cut]) == "tool" {
        cut += 1;
    }
    if cut >= rest.len() {
        cut = target;
        while cut > 0 && role(&rest[cut]) == "tool" {
            cut -= 1;
        }
    }
    (cut >= 2).then_some(cut)
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

    let Some(cut) = tail_start(rest, rest.len() - keep_recent) else {
        return messages.to_vec();
    };

    let kept = &rest[cut..];
    let summary = summarize(&rest[..cut], model_id, model).await;

    let mut out = Vec::with_capacity(system_msgs.len() + 1 + kept.len());
    out.extend_from_slice(system_msgs);
    out.push(json!({
        "role": "system",
        "content": format!("[Summary of earlier conversation, condensed to save context]\n\n{summary}")
    }));
    out.extend_from_slice(kept);
    out
}

/// Flatten a span of wire messages into a plain-text transcript. Rendering
/// rather than replaying keeps the request small and sidesteps tool pairing:
/// the dropped span is a slice, so its trailing assistant `tool_calls` may have
/// their results in the kept tail, and an upstream rejects that conversation.
fn render_transcript(messages: &[Value]) -> String {
    let mut out = String::new();
    for msg in messages {
        out.push_str(role(msg));
        out.push_str(": ");
        match msg.get("content") {
            Some(Value::String(text)) => out.push_str(text),
            Some(Value::Array(parts)) => {
                for part in parts {
                    match part.get("text").and_then(|t| t.as_str()) {
                        Some(text) => out.push_str(text),
                        None => out.push_str("[non-text content]"),
                    }
                }
            }
            _ => {}
        }
        for call in msg
            .get("tool_calls")
            .and_then(|c| c.as_array())
            .into_iter()
            .flatten()
        {
            let f = call.get("function");
            let name = f
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args = f
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("");
            out.push_str(&format!("\n[tool call] {name}({args})"));
        }
        out.push('\n');
    }
    out
}

/// Clamp to `max` characters by dropping the middle: the start of a task and
/// its most recent state both matter more than what sits between them.
fn clamp_middle(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let keep = max.saturating_sub(SUMMARY_ELISION.chars().count());
    let head_len = keep / 2;
    let tail_len = keep - head_len;
    let chars: Vec<char> = text.chars().collect();
    let head: String = chars[..head_len].iter().collect();
    let tail: String = chars[chars.len() - tail_len..].iter().collect();
    format!("{head}{SUMMARY_ELISION}{tail}")
}

/// Summarize the span being dropped. Takes only that span, never the whole
/// conversation: this runs after an overflow, so a request carrying the full
/// history plus a prompt is strictly larger than the one that just failed and
/// could only fail too, silently degrading every compaction to [`FALLBACK_NOTE`].
async fn summarize(dropped: &[Value], model_id: &str, model: &dyn ModelInvoker) -> String {
    let transcript = clamp_middle(&render_transcript(dropped), SUMMARY_INPUT_CHARS);
    if transcript.trim().is_empty() {
        return FALLBACK_NOTE.to_string();
    }
    let request = json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": SUMMARY_SYSTEM_PROMPT },
            { "role": "user", "content": transcript },
        ],
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

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    struct StubModel {
        summary: String,
        calls: StdMutex<usize>,
        requests: tokio::sync::Mutex<Vec<Value>>,
    }
    #[async_trait]
    impl ModelInvoker for StubModel {
        async fn invoke(
            &self,
            request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            self.requests.lock().await.push(request.clone());
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
        let model = StubModel {
            summary: "S".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
        let input = convo(4);
        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT).await;
        assert_eq!(out, input);
        assert_eq!(*model.calls.lock().unwrap(), 0, "no summarization on no-op");
    }

    #[tokio::test]
    async fn compacts_and_preserves_system_and_tail() {
        let model = StubModel {
            summary: "CONDENSED".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
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

    /// Compaction runs after an overflow, so the summarizer request must be
    /// *smaller* than the conversation that just failed: only the dropped span
    /// is sent, rendered to text, and never the kept tail.
    #[tokio::test]
    async fn summary_request_carries_only_the_dropped_span() {
        let model = StubModel {
            summary: "CONDENSED".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
        let input = convo(20);

        compact_conversation(&input, "m", &model, 4).await;

        let requests = model.requests.lock().await;
        let messages = requests[0]["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2, "a system prompt plus one transcript");
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], SUMMARY_SYSTEM_PROMPT);
        assert_eq!(messages[1]["role"], "user");
        let transcript = messages[1]["content"].as_str().unwrap();
        assert!(transcript.contains("msg0"), "dropped span is summarized");
        assert!(transcript.contains("msg15"), "dropped span runs to the cut");
        for kept in ["msg16", "msg17", "msg18", "msg19"] {
            assert!(
                !transcript.contains(kept),
                "the kept tail must not be re-sent: {kept}"
            );
        }
    }

    /// Tool calls carry the work the summary has to preserve, so they are
    /// rendered by name and arguments -- but as text, never as wire messages:
    /// the dropped span can end on a call whose result sits in the kept tail,
    /// and an upstream rejects that conversation outright.
    #[tokio::test]
    async fn summary_request_renders_tool_calls_as_text() {
        let model = StubModel {
            summary: "CONDENSED".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
        let input = vec![
            json!({ "role": "system", "content": "sys" }),
            json!({ "role": "user", "content": "Update the configuration." }),
            json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": [{
                    "id": "write-1",
                    "type": "function",
                    "function": {
                        "name": "write",
                        "arguments": "{\"path\":\"config.toml\",\"content\":\"updated\"}"
                    }
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "write-1",
                "content": "Wrote config.toml"
            }),
            json!({ "role": "assistant", "content": "Configuration updated." }),
            json!({ "role": "user", "content": "thanks" }),
            json!({ "role": "assistant", "content": "welcome" }),
        ];

        compact_conversation(&input, "m", &model, 2).await;

        let requests = model.requests.lock().await;
        let messages = requests[0]["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        let transcript = messages[1]["content"].as_str().unwrap();
        assert!(transcript.contains("[tool call] write("));
        assert!(transcript.contains("config.toml"));
        assert!(transcript.contains("Wrote config.toml"), "tool result kept");
        assert!(
            messages
                .iter()
                .all(|m| m.get("tool_calls").is_none() && m.get("tool_call_id").is_none()),
            "no wire tool-call structure may reach the summarizer"
        );
    }

    #[tokio::test]
    async fn summary_input_is_clamped_to_a_budget() {
        let model = StubModel {
            summary: "CONDENSED".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
        let mut input = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..40 {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            input.push(json!({ "role": r, "content": "x".repeat(8_000) }));
        }

        compact_conversation(&input, "m", &model, 4).await;

        let requests = model.requests.lock().await;
        let transcript = requests[0]["messages"][1]["content"].as_str().unwrap();
        assert!(
            transcript.chars().count() <= SUMMARY_INPUT_CHARS,
            "transcript must fit the budget: {}",
            transcript.chars().count()
        );
        assert!(transcript.contains(SUMMARY_ELISION.trim()));
    }

    #[test]
    fn clamp_middle_is_char_safe_and_keeps_both_ends() {
        let text = "\u{e9}".repeat(500);
        let out = clamp_middle(&text, 100);
        assert!(out.chars().count() <= 100);
        assert!(out.starts_with('\u{e9}') && out.ends_with('\u{e9}'));
        assert_eq!(clamp_middle("short", 100), "short");
    }

    #[test]
    fn render_transcript_keeps_multimodal_text_parts() {
        let msgs = vec![json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "look at this" },
                { "type": "image_url", "image_url": { "url": "data:..." } }
            ]
        })];
        let out = render_transcript(&msgs);
        assert!(out.contains("look at this"));
        assert!(out.contains("[non-text content]"));
        assert!(
            !out.contains("data:"),
            "image payloads must not be replayed"
        );
    }

    #[tokio::test]
    async fn falls_back_to_note_when_summarizer_fails() {
        let input = convo(20);
        let out = compact_conversation(&input, "m", &FailingModel, 4).await;
        assert!(out[1]["content"].as_str().unwrap().contains(FALLBACK_NOTE));
        assert!(out.len() < input.len());
    }

    /// One prompt driving a long agentic run is the normal shape here: a single
    /// user message followed by hundreds of assistant/tool rounds. Compaction
    /// has to bite into that from the top, or the run it was called to rescue
    /// cannot continue.
    #[tokio::test]
    async fn compacts_a_run_with_a_single_user_message() {
        let model = StubModel {
            summary: "CONDENSED".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
        let mut input = vec![
            json!({ "role": "system", "content": "sys" }),
            json!({ "role": "user", "content": "do the whole task" }),
        ];
        for i in 0..40 {
            input.push(json!({
                "role": "assistant", "content": Value::Null,
                "tool_calls": [{ "id": format!("t{i}"), "function": { "name": "bash" } }]
            }));
            input.push(json!({
                "role": "tool", "tool_call_id": format!("t{i}"), "content": format!("out{i}")
            }));
        }
        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT).await;

        assert!(out.len() < input.len(), "the run must shrink");
        assert_ne!(
            role(&out[2]),
            "tool",
            "kept tail must not start on a result"
        );
        assert_eq!(
            out[out.len() - 1],
            input[input.len() - 1],
            "the newest round is what the run resumes from"
        );
    }

    /// The cut can land inside a batch of parallel tool results with nothing
    /// but results between it and the end. Walking the boundary forward runs it
    /// off the end and compaction gives up -- on exactly the conversation that
    /// needed it. The boundary has to fall back to the call that owns the batch.
    #[tokio::test]
    async fn compacts_when_the_tail_is_one_batch_of_parallel_results() {
        let model = StubModel {
            summary: "CONDENSED".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
        let mut input = vec![
            json!({ "role": "system", "content": "sys" }),
            json!({ "role": "user", "content": "do the whole task" }),
        ];
        for i in 0..10 {
            input.push(json!({
                "role": "assistant", "content": Value::Null,
                "tool_calls": [{ "id": format!("t{i}"), "function": { "name": "bash" } }]
            }));
            input.push(json!({
                "role": "tool", "tool_call_id": format!("t{i}"), "content": format!("out{i}")
            }));
        }
        // A final fan-out: one call message, then results all the way to the end.
        let calls: Vec<Value> = (0..20)
            .map(|i| json!({ "id": format!("p{i}"), "function": { "name": "read" } }))
            .collect();
        input.push(json!({
            "role": "assistant", "content": Value::Null, "tool_calls": calls
        }));
        let batch_start = input.len() - 1;
        for i in 0..20 {
            input.push(json!({
                "role": "tool", "tool_call_id": format!("p{i}"), "content": format!("r{i}")
            }));
        }

        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT).await;

        assert!(
            out.len() < input.len(),
            "a tail of parallel results must not defeat compaction"
        );
        assert_eq!(
            out[2], input[batch_start],
            "the tail must start on the call that owns the results it keeps"
        );
    }

    #[tokio::test]
    async fn tail_never_starts_with_orphan_tool_result() {
        let model = StubModel {
            summary: "S".into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        };
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
        assert_ne!(
            role(first_kept),
            "tool",
            "kept tail must not start with a tool result"
        );
    }
}
