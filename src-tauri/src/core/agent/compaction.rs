//! Context compaction, in two layers.
//!
//! Before a request is dispatched, the loop estimates the prompt and compares
//! it to the route's [`CompactionBudget`]; past the trigger it compacts *then*,
//! so the prefix break happens at a point the run chose instead of at one the
//! provider forced with a rejection. The estimate is a chars-per-token
//! approximation ([`estimate_token_count`]), and a route whose window is
//! unknown - a local engine keeps its window inside the llamacpp
//! plugin/preset - carries no budget, which leaves it on the second layer.
//!
//! The second layer is reactive: a provider that rejects the request as too
//! long is caught by the caller, which compacts and retries. It stays because
//! an estimate is an estimate.
//!
//! Either way, given the conversation we preserve the leading system message(s)
//! and a recent tail, summarize the dropped middle via one model call, and
//! splice the summary back in. If summarization fails the middle is replaced
//! with a short note, so the run always makes forward progress.

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::core::agent::r#loop::ModelInvoker;
use crate::core::agent::upstream::extract_choice_message;

/// Default number of most-recent non-system messages kept verbatim.
pub(crate) const DEFAULT_KEEP_RECENT: usize = 8;

/// Per-message envelope (role, delimiters) in [`estimate_token_count`], the
/// usual OpenAI-accounting constant. CLI-only, like the estimator that reads it:
/// nothing in the desktop config estimates a history, since the providers
/// report the real prompt count there.
#[cfg(feature = "cli")]
const TOKENS_PER_MESSAGE: u64 = 4;

/// Share of the context window a prompt may fill before a run compacts ahead of
/// dispatching. `[agent].compaction_ratio` overrides it, per route if the
/// provider entry carries its own.
pub(crate) const DEFAULT_COMPACTION_RATIO: f64 = 0.80;

/// Ratios outside this range are clamped: below it a run would compact on
/// almost every turn, above it the trigger sits at or past the window, where
/// the preflight can never fire in time to be worth having.
const RATIO_RANGE: (f64, f64) = (0.10, 0.99);

/// Prompt tokens at which a preflight compaction fires.
///
/// The ratio is the primary expression because it scales with the window. A
/// fixed reserve does not: 16K is 12% of a 128K window and 1.6% of a 1M one, so
/// the same config compacts far too late on the large window, leaving the
/// prompt to grow into a rejection. An explicit `compaction_reserve_tokens`
/// still wins, so a config that asked for absolute headroom keeps the number it
/// asked for rather than having the ratio silently override it.
///
/// A non-finite ratio falls back to [`DEFAULT_COMPACTION_RATIO`] rather than
/// propagating into the comparison, where a NaN would make every prompt look
/// over the trigger.
pub(crate) fn trigger_tokens(context_window: u64, ratio: f64, reserve_tokens: Option<u64>) -> u64 {
    match reserve_tokens {
        Some(reserve) => context_window.saturating_sub(reserve),
        None => {
            let ratio = if ratio.is_finite() {
                ratio.clamp(RATIO_RANGE.0, RATIO_RANGE.1)
            } else {
                DEFAULT_COMPACTION_RATIO
            };
            (context_window as f64 * ratio).floor() as u64
        }
    }
}

/// Where a run compacts before dispatching: the route's window, the share of it
/// a prompt may fill, and whether the user pinned an absolute reserve instead.
///
/// Optional on a run because the window is not always knowable - local engines
/// keep theirs inside the llamacpp plugin/preset - and an unknown window must
/// leave compaction reactive rather than guess.
#[derive(Debug, Clone, Copy)]
pub(crate) struct CompactionBudget {
    pub(crate) context_window: u64,
    pub(crate) ratio: f64,
    /// An explicit `[agent].compaction_reserve_tokens`, which wins over `ratio`.
    pub(crate) reserve_tokens: Option<u64>,
}

impl CompactionBudget {
    /// Prompt tokens at which this run compacts ahead of dispatching.
    pub(crate) fn trigger_tokens(&self) -> u64 {
        trigger_tokens(self.context_window, self.ratio, self.reserve_tokens)
    }
}

/// Rough token count for a whole request body (~4 chars per token), tool
/// schemas and system prompt included.
///
/// The preflight measures the body it is about to send rather than the message
/// list alone: a handful of MCP servers adds several thousand tokens of schemas
/// that sit *behind* the prompt, and ignoring them would let a run sail past
/// the trigger it thinks it is respecting.
pub(crate) fn estimate_request_tokens(request: &Value) -> u64 {
    (json_text_len(request) as u64 / 4).max(1)
}

/// Total length of every string in `value`, at any depth. Walks the value
/// instead of serializing it: this runs on the first dispatch of every turn,
/// and the request is already the largest allocation in the loop.
fn json_text_len(value: &Value) -> usize {
    match value {
        Value::String(text) => text.len(),
        Value::Array(items) => items.iter().map(json_text_len).sum(),
        Value::Object(fields) => fields.values().map(json_text_len).sum(),
        _ => 0,
    }
}

/// Rough token count (~4 chars per token) for a history the provider has not
/// reported usage for. Counts what actually goes on the wire -- text content
/// including multimodal text parts, tool-call names and arguments, tool-result
/// ids -- so a tool-heavy history is not scored as empty. Image parts are left
/// out: their cost is a provider-specific function of resolution, and inventing
/// a number there is worse than omitting one.
///
/// CLI-only: it backs the feed's fill indicator, the `/context` view and the
/// TUI's auto-compact, all of which must agree with [`trigger_tokens`] - a fill
/// reading under the trigger while the loop compacts would be a bug the user
/// sees as "it compacted for no reason". The desktop reads the provider's own
/// `prompt_tokens` instead, so it has no caller for this.
#[cfg(feature = "cli")]
pub(crate) fn estimate_token_count(messages: &[Value]) -> u64 {
    let mut total_chars: usize = 0;
    for msg in messages {
        match msg.get("content") {
            Some(Value::String(text)) => total_chars += text.len(),
            Some(Value::Array(parts)) => {
                for part in parts {
                    total_chars += part
                        .get("text")
                        .and_then(|t| t.as_str())
                        .map_or(0, str::len);
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
            // Arguments live under `function`, not on the call itself.
            if let Some(f) = call.get("function") {
                total_chars += f.get("name").and_then(|n| n.as_str()).map_or(0, str::len);
                total_chars += f
                    .get("arguments")
                    .and_then(|a| a.as_str())
                    .map_or(0, str::len);
            }
        }
        total_chars += msg
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .map_or(0, str::len);
    }
    let envelope = TOKENS_PER_MESSAGE * messages.len() as u64;
    ((total_chars / 4) as u64 + envelope).max(1)
}

/// Recent tail kept when the user explicitly runs `/compact`. Smaller than the
/// automatic threshold so a deliberate compaction is honoured on short threads.
#[cfg(feature = "cli")]
pub(crate) const MANUAL_KEEP_RECENT: usize = 2;

const SUMMARY_SYSTEM_PROMPT: &str = "Summarize the AI agent conversation transcript below into a \
dense, factual brief that preserves everything needed to continue the task: the user's goals and \
constraints, decisions made, files and commands touched with their outcomes, and any unresolved \
questions. Omit pleasantries and redundant tool output. Write only the summary.";

const FALLBACK_NOTE: &str = "[Earlier conversation was omitted to fit the model's context window.]";

/// Leading text of every compaction summary message (the model summary and the
/// [`FALLBACK_NOTE`] path both carry it). Kept as a constant so
/// [`is_compaction_summary`] and `set_system_prompt` recognise a summary without
/// re-hardcoding the string: a summary is a `system` message, but unlike the
/// rebuilt stable/volatile prompt it must survive the next turn's
/// `set_system_prompt`, or compaction would save the current run and then throw
/// its own condensed history away.
pub(crate) const SUMMARY_MARKER: &str = "[Summary of earlier conversation, condensed to save context]";

/// Whether `msg` is a compaction summary that must be preserved across turns.
pub(crate) fn is_compaction_summary(msg: &Value) -> bool {
    role(msg) == "system"
        && msg
            .get("content")
            .and_then(|c| c.as_str())
            .is_some_and(|c| c.starts_with(SUMMARY_MARKER))
}

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

/// Fire the run's `PreCompact` hooks for a conversation about to be compacted.
/// The project is the one `ctx` already points at.
///
/// Compaction is the one lifecycle point that discards conversation, so a team
/// that wants a transcript archived or a summary pinned has to be told before
/// it happens rather than after. It lives here, beside the compaction itself,
/// so every path that compacts fires it: the reactive overflow retry, the
/// end-of-run budget pass, and the TUI's `/compact`.
///
/// A deny is not honored -- refusing to compact would leave the run wedged on
/// an oversized history it cannot send -- so only `context` and the failure
/// notices come back, and they are logged rather than returned: a compaction is
/// not a turn, so there is no reminder slot to attach them to.
pub(crate) async fn fire_pre_compact(
    hooks: &tauri_plugin_agent_tools::tools::hooks::HookSet,
    ctx: &tauri_plugin_agent_tools::tools::ToolContext<'_>,
    message_count: usize,
) {
    if hooks.is_empty() {
        return;
    }
    let outcome = tauri_plugin_agent_tools::tools::hooks::run_hooks(
        hooks,
        tauri_plugin_agent_tools::tools::hooks::HookEvent::PreCompact,
        &tauri_plugin_agent_tools::tools::hooks::HookPayload {
            message_count: Some(message_count),
            ..Default::default()
        },
        ctx,
        // Never inert: PreCompact is not a tool event, and a Plan-mode run
        // compacts exactly like any other.
        false,
    )
    .await;
    for context in outcome.context {
        log::info!("agent: PreCompact hook context: {context}");
    }
    for notice in outcome.notices {
        log::warn!("agent: {}", notice.message());
    }
}

/// Compact `messages` so the result is meaningfully smaller than the input.
/// Returns the input unchanged when there is nothing safe to compact (so the
/// caller can detect a no-op and stop retrying).
///
/// The error case is one specific failure: when the *target model's* summarizer
/// itself overflows its context window, a fallback note must not be fabricated
/// (it would silently drop the whole dropped span and, for a smaller-window
/// model, the compacted request could still overflow). The `Err` is propagated
/// so the caller can preserve history and block the request instead. Every
/// other summarizer failure stays recoverable and yields a [`FALLBACK_NOTE`].
pub(crate) async fn compact_conversation(
    messages: &[Value],
    model_id: &str,
    model: &dyn ModelInvoker,
    keep_recent: usize,
) -> Result<Vec<Value>, String> {
    let sys_end = messages.iter().take_while(|m| role(m) == "system").count();
    let (system_msgs, rest) = messages.split_at(sys_end);

    if rest.len() <= keep_recent {
        return Ok(messages.to_vec());
    }

    let Some(cut) = tail_start(rest, rest.len() - keep_recent) else {
        return Ok(messages.to_vec());
    };

    let kept = &rest[cut..];
    let summary = summarize(&rest[..cut], model_id, model).await?;

    let mut out = Vec::with_capacity(system_msgs.len() + 1 + kept.len());
    out.extend_from_slice(system_msgs);
    out.push(json!({
        "role": "system",
        "content": format!("{SUMMARY_MARKER}\n\n{summary}")
    }));
    out.extend_from_slice(kept);
    Ok(out)
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
///
/// Returns an `Err` only when the target model's context window overflowed --
/// the caller must block rather than fabricate a fallback note for a
/// smaller-window model. Every other failure and empty/unreadable completion
/// stays recoverable and returns [`FALLBACK_NOTE`].
async fn summarize(dropped: &[Value], model_id: &str, model: &dyn ModelInvoker) -> Result<String, String> {
    let transcript = clamp_middle(&render_transcript(dropped), SUMMARY_INPUT_CHARS);
    if transcript.trim().is_empty() {
        return Ok(FALLBACK_NOTE.to_string());
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
        Ok(completion) => {
            let summary = extract_choice_message(&completion)
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            Ok(summary.unwrap_or_else(|| FALLBACK_NOTE.to_string()))
        }
        Err(e) => {
            // A model-switch compaction targets the (smaller) new model: if the
            // summarizer itself overflows, a note is not safe -- the request
            // could still overflow and the dropped span would be lost. Propagate.
            if crate::core::agent::upstream::is_context_overflow_error(&e) {
                Err(e)
            } else {
                Ok(FALLBACK_NOTE.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    /// The `PreCompact` call site: the hook runs, and it is told how much
    /// conversation is about to be summarized away -- the one fact a hook that
    /// archives a transcript needs.
    #[tokio::test]
    async fn pre_compact_hooks_fire_with_the_message_count() {
        let root = std::env::temp_dir().join(format!(
            "jan_precompact_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let seen = root.join("seen.json");
        let mut hooks = tauri_plugin_agent_tools::tools::hooks::HookSet::new();
        hooks.extend_from(
            vec![tauri_plugin_agent_tools::tools::hooks::HookEntry {
                event: "PreCompact".to_string(),
                matcher: None,
                command: format!("cat > {}", seen.to_string_lossy()),
                timeout_secs: None,
            }],
            std::path::Path::new("test"),
        );
        let empty: Vec<String> = Vec::new();
        let ctx = tauri_plugin_agent_tools::tools::ToolContext::new(&root, &root, &empty)
            .with_sandbox(false);
        fire_pre_compact(&hooks, &ctx, 42).await;
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&seen).unwrap()).unwrap();
        assert_eq!(written["event"], "PreCompact");
        assert_eq!(written["message_count"], 42);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A run with no hooks must not pay for the machinery, and must not create
    /// anything on the way past.
    #[tokio::test]
    async fn pre_compact_is_a_no_op_without_hooks() {
        let root = std::env::temp_dir().join(format!(
            "jan_precompact_none_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let empty: Vec<String> = Vec::new();
        let ctx = tauri_plugin_agent_tools::tools::ToolContext::new(&root, &root, &empty)
            .with_sandbox(false);
        fire_pre_compact(
            &tauri_plugin_agent_tools::tools::hooks::HookSet::new(),
            &ctx,
            10,
        )
        .await;
        let _ = std::fs::remove_dir_all(&root);
    }

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
        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT)
            .await
            .expect("no-op must not fail");
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
        let out = compact_conversation(&input, "m", &model, 4)
            .await
            .expect("successful summary must not fail");

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

        compact_conversation(&input, "m", &model, 4)
            .await
            .expect("successful summary must not fail");

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

        compact_conversation(&input, "m", &model, 2)
            .await
            .expect("successful summary must not fail");

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

        compact_conversation(&input, "m", &model, 4)
            .await
            .expect("successful summary must not fail");

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
        let out = compact_conversation(&input, "m", &FailingModel, 4)
            .await
            .expect("an ordinary summarizer error must not fail compaction");
        assert!(out[1]["content"].as_str().unwrap().contains(FALLBACK_NOTE));
        assert!(out.len() < input.len());
    }

    /// A target-model summarizer that itself overflows its context window must
    /// fail compaction rather than fabricate a fallback note: for a
    /// smaller-window model a note could still overflow, and the dropped span
    /// would be silently lost. The caller (a model switch) blocks instead.
    struct OverflowingModel;
    #[async_trait]
    impl ModelInvoker for OverflowingModel {
        async fn invoke(
            &self,
            _request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            Err(format!(
                "[{}] Upstream returned HTTP 400: prompt is too long",
                crate::core::agent::upstream::CONTEXT_OVERFLOW_MARKER
            ))
        }
    }

    #[tokio::test]
    async fn target_summary_context_overflow_is_fatal() {
        let input = convo(20);
        let error = compact_conversation(&input, "m", &OverflowingModel, 4)
            .await
            .expect_err("a summarizer context overflow must not be swallowed");
        assert!(crate::core::agent::upstream::is_context_overflow_error(&error));
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
        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT)
            .await
            .expect("successful summary must not fail");

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

        let out = compact_conversation(&input, "m", &model, DEFAULT_KEEP_RECENT)
            .await
            .expect("successful summary must not fail");

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
        let out = compact_conversation(&input, "m", &model, 4)
            .await
            .expect("successful summary must not fail");
        let first_kept = &out[2];
        assert_ne!(
            role(first_kept),
            "tool",
            "kept tail must not start with a tool result"
        );
    }

    #[test]
    fn the_ratio_scales_the_trigger_with_the_window() {
        assert_eq!(
            trigger_tokens(128_000, DEFAULT_COMPACTION_RATIO, None),
            102_400
        );
        assert_eq!(
            trigger_tokens(1_000_000, DEFAULT_COMPACTION_RATIO, None),
            800_000
        );
    }

    #[test]
    fn an_explicit_reserve_wins_over_the_ratio() {
        // 16K is 12% of a 128K window but 1.6% of a 1M one, so a config that
        // pinned absolute headroom keeps the number it asked for on both.
        assert_eq!(trigger_tokens(128_000, 0.5, Some(16_384)), 111_616);
        assert_eq!(trigger_tokens(1_000_000, 0.5, Some(16_384)), 983_616);
    }

    #[test]
    fn an_unusable_ratio_still_yields_a_sane_trigger() {
        // A ratio at or past 1 puts the trigger at the window itself, where the
        // preflight can never fire in time; a NaN would make every prompt look
        // over the trigger and compact on the first turn of every run.
        assert_eq!(trigger_tokens(100_000, 1.5, None), 99_000);
        assert_eq!(trigger_tokens(100_000, 0.0, None), 10_000);
        assert_eq!(trigger_tokens(100_000, f64::NAN, None), 80_000);
    }

    #[test]
    fn a_reserve_larger_than_the_window_does_not_underflow() {
        assert_eq!(
            trigger_tokens(1_000, DEFAULT_COMPACTION_RATIO, Some(5_000)),
            0
        );
    }

    #[test]
    fn the_request_estimate_counts_the_tool_schemas() {
        let bare = json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
        });
        let with_schemas = json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{
                "type": "function",
                "function": { "name": "read", "description": "x".repeat(8_000) },
            }],
        });
        // The schemas sit in the request prefix, ahead of the conversation:
        // measuring the message list alone would let a run sail past the
        // trigger it believes it is respecting.
        assert!(
            estimate_request_tokens(&with_schemas) > estimate_request_tokens(&bare) + 1_000,
            "tool schemas must count toward the preflight estimate"
        );
    }
}
