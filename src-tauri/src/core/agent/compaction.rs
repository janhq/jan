//! Context compaction, in two layers.
//!
//! Before a request is dispatched, the loop estimates the prompt and compares
//! it to the route's [`CompactionBudget`]; past the trigger it compacts *then*,
//! so the prefix break happens at a point the run chose instead of at one the
//! provider forced with a rejection. The estimate is a chars-per-token
//! approximation ([`estimate_request_tokens`]), and a route whose window is
//! unknown - a local engine keeps its window inside the llamacpp
//! plugin/preset - carries no budget, which leaves it on the second layer.
//!
//! The second layer is reactive: a provider that rejects the request as too
//! long is caught by the caller, which compacts and retries. It stays because
//! an estimate is an estimate.
//!
//! Either way the covered span becomes one continuation state
//! ([`crate::core::agent::continuation`]) followed by a token-sized tail. The
//! preflight asks the run's own model for the state's model sections with the
//! exact request it was about to send plus one instruction, so the provider
//! serves the whole prefix from cache; every other path, and that one when it
//! gets no usable answer, summarizes the span in chunks instead. If no model
//! answers, the code-built sections stand alone, so the run always continues.

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::core::agent::continuation::{self, Gathered, HarnessContext, Role};
use crate::core::agent::events::{CompactionReport, Usage};
use crate::core::agent::r#loop::ModelInvoker;
use crate::core::agent::upstream::extract_choice_message;

/// Most-recent messages the TUI's automatic compaction keeps verbatim. A run's
/// own compaction sizes its tail by tokens instead ([`tail_tokens`]).
#[cfg(feature = "cli")]
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
    /// `context_window` is an explicit `[agent].context_window`, which holds
    /// for every model. Otherwise it was resolved for this run's model, and a
    /// subagent on a different model must re-resolve its own.
    pub(crate) window_pinned: bool,
}

impl CompactionBudget {
    /// Prompt tokens at which this run compacts ahead of dispatching.
    pub(crate) fn trigger_tokens(&self) -> u64 {
        trigger_tokens(self.context_window, self.ratio, self.reserve_tokens)
    }

    /// This budget for a run on `model` under a dispatcher running
    /// `parent_model`, with `resolve` sizing a window for a model. Kept when
    /// the model is the same, the window was configured (which holds for
    /// every model), or `resolve` cannot size one; otherwise the window is
    /// the resolved one. Ratio and reserve are the project's and carry over.
    pub(crate) fn for_model(
        self,
        model: &str,
        parent_model: &str,
        resolve: impl FnOnce(&str) -> Option<u64>,
    ) -> Self {
        if model == parent_model || self.window_pinned {
            return self;
        }
        match resolve(model) {
            Some(context_window) => Self {
                context_window,
                ..self
            },
            None => self,
        }
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

/// What one image part is assumed to cost. Providers bill an image by its
/// resolution, not by the length of its base64: Anthropic caps a resized image
/// near 1.6K tokens, and OpenAI and Gemini typically charge less for the same
/// frame. Counting the data URL as text scored one three-camera observation at
/// ~560K tokens and compacted before nearly every request.
const IMAGE_PART_TOKENS: usize = 1_600;

/// Total length of every string in `value`, at any depth, with each
/// `image_url` part counted as [`IMAGE_PART_TOKENS`] rather than its payload.
/// Walks the value instead of serializing it: this runs on the first dispatch
/// of every turn, and the request is already the largest allocation in the loop.
fn json_text_len(value: &Value) -> usize {
    match value {
        Value::String(text) => text.len(),
        Value::Array(items) => items.iter().map(json_text_len).sum(),
        Value::Object(fields) if fields.get("type").and_then(Value::as_str) == Some("image_url") => {
            IMAGE_PART_TOKENS * 4
        }
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

/// Leading text of a compaction summary written before the continuation
/// state existed: a `system` message. Saved sessions still carry it, so it is
/// still recognized on load (and its text merged into the next state), but
/// nothing writes it any more.
pub(crate) const SUMMARY_MARKER: &str = "[Summary of earlier conversation, condensed to save context]";

/// Whether `msg` is a compaction summary: the continuation state, or the
/// `system` form older sessions saved.
pub(crate) fn is_compaction_summary(msg: &Value) -> bool {
    continuation::is_state(msg) || legacy_summary_text(msg).is_some()
}

/// The text of a pre-continuation `system` summary, marker removed.
pub(crate) fn legacy_summary_text(msg: &Value) -> Option<&str> {
    if role(msg) != "system" {
        return None;
    }
    msg.get("content")?
        .as_str()?
        .strip_prefix(SUMMARY_MARKER)
        .map(str::trim)
}

/// A summary in the form older sessions saved, for the tests that prove such
/// a session still loads.
#[cfg(test)]
pub(crate) fn summary_message(summary: &str) -> Value {
    json!({
        "role": "system",
        "content": format!("{SUMMARY_MARKER}\n\n{summary}")
    })
}

fn role(msg: &Value) -> &str {
    msg.get("role").and_then(|r| r.as_str()).unwrap_or("")
}

/// Rough tokens of one wire message, by the preflight's own rule.
fn message_tokens(msg: &Value) -> u64 {
    (json_text_len(msg) as u64).div_ceil(4) + 4
}

/// Share of the window each of the kept tail and the verbatim user messages
/// may take: together with the model's sections and the harness context they
/// leave the next request well under a 0.80 trigger, so it cannot compact
/// again straight away.
const SHARE_DIVISOR: u64 = 10;

/// Tokens the kept tail may hold on a `window`-token route.
pub(crate) fn tail_tokens(window: u64) -> u64 {
    window / SHARE_DIVISOR
}

/// Tokens the verbatim user messages may take on a `window`-token route.
fn user_cap_tokens(window: u64) -> u64 {
    window / SHARE_DIVISOR
}

/// Longest reply a compaction asks for. The sections it writes are re-sent on
/// every request until the next compaction, so a dense brief is the goal.
const SUMMARY_MAX_TOKENS: u64 = 8_192;

/// The reply cap on a `window`-token route: [`SUMMARY_MAX_TOKENS`], or a
/// tenth of a small window, so the state written fits beside the tail.
fn reply_cap(window: u64) -> u64 {
    SUMMARY_MAX_TOKENS.min(window / SHARE_DIVISOR).max(256)
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
#[cfg(feature = "cli")]
pub(crate) fn tail_start(rest: &[Value], target: usize) -> Option<usize> {
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

/// Where a tail of at most `keep_tokens` begins. Walks back over whole groups
/// -- a message and the tool results answering it -- so a call is never kept
/// without its results or the reverse. Sized by tokens because a count is not
/// a size: eight large tool results kept verbatim left the request over the
/// trigger, and the next request overflowed again.
///
/// The newest group may use [`NEWEST_GROUP_SHARE`] times the budget, so the
/// last complete tool call and its result -- where the run is right now --
/// survive even when one result is large. One larger still is left to the
/// state: keeping it verbatim is what would overflow.
///
/// `None` when nothing worth dropping is left in front of the tail.
pub(crate) fn token_tail_start(rest: &[Value], keep_tokens: u64) -> Option<usize> {
    let mut used = 0u64;
    let mut cut = rest.len();
    while cut > 0 {
        let mut start = cut - 1;
        while start > 0 && role(&rest[start]) == "tool" {
            start -= 1;
        }
        let cost: u64 = rest[start..cut].iter().map(message_tokens).sum();
        let limit = if cut == rest.len() {
            keep_tokens.saturating_mul(NEWEST_GROUP_SHARE)
        } else {
            keep_tokens
        };
        if used + cost > limit {
            break;
        }
        used += cost;
        cut = start;
    }
    (cut >= 2).then_some(cut)
}

/// How many tail budgets the newest group may take (see [`token_tail_start`]).
const NEWEST_GROUP_SHARE: u64 = 3;

/// Fire the run's `PreCompact` hooks for a conversation about to be compacted.
/// The project is the one `ctx` already points at.
///
/// Compaction is the one lifecycle point that discards conversation, so a team
/// that wants a transcript archived or a summary pinned has to be told before
/// it happens rather than after. It lives here, beside the compaction itself,
/// so every path that compacts fires it: the preflight, the reactive overflow
/// retry, and the TUI's `/compact`.
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
    // Every compaction path passes through here, so this is telemetry's one
    // compaction count too. Inert unless the exporter is on.
    crate::core::agent::otel::compaction(message_count);
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

/// Compact a plain message list -- the TUI's `/compact`, which holds a history
/// rather than a run's record -- keeping the last `keep_recent` messages. The
/// input comes back unchanged with no report when there is nothing safe to
/// drop. Never fails: a summarizer that cannot run leaves the code-built state.
#[cfg(feature = "cli")]
pub(crate) async fn compact_conversation(
    messages: &[Value],
    model_id: &str,
    model: &dyn ModelInvoker,
    keep_recent: usize,
    harness: &HarnessContext,
    window: u64,
) -> (Vec<Value>, Option<CompactionReport>) {
    let sys_end = messages
        .iter()
        .take_while(|m| role(m) == "system" && !is_compaction_summary(m))
        .count();
    let (system_msgs, rest) = messages.split_at(sys_end);

    if rest.len() <= keep_recent {
        return (messages.to_vec(), None);
    }
    let Some(cut) = tail_start(rest, rest.len() - keep_recent) else {
        return (messages.to_vec(), None);
    };

    let gathered = continuation::gather(&rest[..cut]);
    // The interactive `/compact` meters nothing: it is not inside a run's
    // budget, so there is no ceiling for this request to be charged against.
    // Its usage still rides on the report, which is what `/agents` shows.
    let (state, report) = continuation_state(
        &gathered,
        &rest[..cut],
        None,
        harness,
        window,
        model_id,
        model,
    )
    .await;

    let mut out = Vec::with_capacity(system_msgs.len() + 1 + rest.len() - cut);
    out.extend_from_slice(system_msgs);
    out.push(state);
    out.extend_from_slice(&rest[cut..]);
    (out, Some(report))
}

/// The instruction appended to the cached compaction request, before the
/// role's own guidance. Wrapped like every other harness notice, so the model
/// reads it as the harness and not as the user.
const COMPACTION_INSTRUCTION: &str = "[Compaction request from the harness] The conversation \
above is about to be compacted to fit the context window. Do not call any tools and do not \
continue the task in this reply. Reply only with these sections, in this order, each heading on \
its own line:\n\n## Progress\n## Decisions\n## Findings\n## Errors & dead ends\n\
## Current step\n## Next actions\n\nCurrent step and Next actions are required, never empty: \
they are what carries the plan forward. Progress: what is done so far. Decisions: choices made \
and why. Findings: facts learned, with file:line references. Errors & dead ends: what failed, so \
it is not retried. Current step: what you were doing at this moment. Next actions: the concrete \
next steps, in order. Be dense and factual. The task, the user's messages, the files touched and \
the workspace state are recorded separately by the harness: do not repeat them. If an earlier \
continuation state is above, merge its Progress, Decisions, Findings and Errors & dead ends into \
yours so nothing in them is lost.";

/// What the parent's sections keep: it holds the global context and guides
/// its children, so it must not lose what each was asked and found.
const PARENT_FOCUS: &str = "You coordinate this work: keep the decisions that span tasks, and \
for each subagent you dispatched, what it was asked and what it found, in a line or two. Its full \
answer stays on the blackboard (the harness lists each path), so cite the path rather than \
copying the answer.";

/// What a child's sections keep: its own task, nothing wider.
const CHILD_FOCUS: &str = "You are a subagent with one task: keep only what that task needs. \
Leave out anything about the wider plan or other agents.";

/// The instruction a compaction for `role` appends.
pub(crate) fn compaction_instruction(role: Role) -> String {
    let focus = match role {
        Role::Parent => PARENT_FOCUS,
        Role::Child => CHILD_FOCUS,
    };
    format!("{COMPACTION_INSTRUCTION}\n\n{focus}")
}

/// System prompt of the fallback summarizer, which reads the span as text.
const FALLBACK_SYSTEM_PROMPT: &str = "You condense part of an AI agent's working transcript so the \
agent can continue its task after the transcript is dropped. Reply only with these sections, in \
this order, each heading on its own line:\n\n## Progress\n## Decisions\n## Findings\n\
## Errors & dead ends\n## Current step\n## Next actions\n\nCurrent step and Next actions are \
required, never empty: say what the agent was doing at the end of the transcript and the concrete \
next steps in order, since they are what carries its plan forward. Findings carry file:line \
references. The task, the user's messages and the files touched are recorded separately: do not \
repeat them. When earlier sections are given, merge them into yours so nothing in them is lost. \
Omit pleasantries and redundant tool output.";

/// What the fallback summarizer keeps for each role: the same focus as the
/// cached instruction, in the third person, so both paths write one kind of
/// state.
const PARENT_FALLBACK_FOCUS: &str = "The agent coordinates this work: keep the decisions that \
span tasks, and for each subagent it dispatched, what it was asked and what it found, in a line \
or two. Cite each subagent's blackboard path rather than copying its answer.";
const CHILD_FALLBACK_FOCUS: &str = "The agent is a subagent with one task: keep only what its \
task needs. Leave out anything about the wider plan or other agents.";

fn fallback_prompt(role: Role) -> String {
    let focus = match role {
        Role::Parent => PARENT_FALLBACK_FOCUS,
        Role::Child => CHILD_FALLBACK_FOCUS,
    };
    format!("{FALLBACK_SYSTEM_PROMPT}\n\n{focus}")
}

/// The request a cached compaction sends: exactly `request` -- the body the
/// run was about to send, tools and `tool_choice` included -- plus one user
/// instruction, so every byte before it is a prefix the provider has cached.
/// Only `max_tokens` changes, which is not part of any prompt cache key.
pub(crate) fn cached_compaction_request(request: &Value, role: Role, window: u64) -> Value {
    let mut side = request.clone();
    if let Some(messages) = side.get_mut("messages").and_then(Value::as_array_mut) {
        messages.push(json!({
            "role": "user",
            "content": crate::core::agent::reminder::wrap(&compaction_instruction(role)),
        }));
    }
    let cap = side
        .get("max_tokens")
        .and_then(Value::as_u64)
        .map_or(reply_cap(window), |v| v.min(reply_cap(window)));
    if let Some(map) = side.as_object_mut() {
        map.insert("max_tokens".to_string(), json!(cap));
    }
    side
}

/// Drop `<think>` blocks a route inlines into content: the state keeps the
/// model's answer, never its reasoning.
fn strip_think(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<think>") {
        out.push_str(&rest[..start]);
        rest = match rest[start..].find("</think>") {
            Some(end) => &rest[start + end + "</think>".len()..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// The model sections in a compaction reply, or `None` when the reply cannot
/// be used: it called a tool (the instruction said not to, and the call would
/// be for a request nobody will answer) or said nothing. Reasoning is dropped;
/// only the text from the first section heading on is kept.
fn sections_from(completion: &Value) -> Option<String> {
    let message = extract_choice_message(completion)?;
    if message
        .get("tool_calls")
        .and_then(Value::as_array)
        .is_some_and(|calls| !calls.is_empty())
    {
        return None;
    }
    let text = strip_think(message.get("content")?.as_str()?);
    let text = text.trim();
    let start = continuation::MODEL_HEADINGS
        .iter()
        .filter_map(|heading| {
            text.match_indices(heading)
                .find(|(at, _)| *at == 0 || text.as_bytes()[at - 1] == b'\n')
                .map(|(at, _)| at)
        })
        .min()
        .unwrap_or(0);
    let text = text[start..].trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Build the continuation state for a compaction and say what it took.
///
/// The model sections come from `cached` first -- the request the run was
/// about to send, extended by one instruction -- when it fits the window. A
/// route with no usable answer there (no `cached`, a tool call, an empty
/// reply, an error) falls back to the summarizer over `span`, which tries the
/// smol model first. If that fails too, the state carries the code-built
/// sections alone: the task and the user's words are never lost, and the run
/// never fails for want of a summary.
pub(crate) async fn continuation_state(
    gathered: &Gathered,
    span: &[Value],
    cached: Option<&Value>,
    harness: &HarnessContext,
    window: u64,
    model_id: &str,
    model: &dyn ModelInvoker,
) -> (Value, CompactionReport) {
    let mut usage: Option<Usage> = None;
    let mut charge = |more: Option<Usage>| {
        usage = match (usage.take(), more) {
            (Some(a), Some(b)) => Some(a.plus(&b)),
            (a, b) => a.or(b),
        };
    };
    let mut written: Option<(String, String)> = None;
    if let Some(request) = cached {
        let side = cached_compaction_request(request, harness.role, window);
        if estimate_request_tokens(&side) + reply_cap(window) <= window {
            // A dropped receiver: the reply is a summary, not the answer the
            // user is reading.
            let (sink, _rx) = mpsc::unbounded_channel();
            match model.invoke(&side, &sink).await {
                Ok(completion) => {
                    charge(Usage::from_completion(&completion));
                    match sections_from(&completion) {
                        Some(sections) => written = Some((model_id.to_string(), sections)),
                        None => log::warn!(
                            "agent: cached compaction on {model_id} returned no usable sections, \
                             summarizing the span instead"
                        ),
                    }
                }
                Err(e) => log::warn!(
                    "agent: cached compaction on {model_id} failed, summarizing the span \
                     instead: {e}"
                ),
            }
        }
    }
    if written.is_none() {
        let (sections, spent) =
            summarize_in_chunks(
                span,
                gathered.previous_model.as_deref(),
                harness.role,
                window,
                model_id,
                model,
            )
            .await;
        charge(spent);
        written = sections;
    }
    let sections = written.as_ref().map(|(_, s)| s.as_str());
    let state = continuation::build(gathered, harness, user_cap_tokens(window), sections);
    let report = CompactionReport {
        model: written.as_ref().map(|(m, _)| m.clone()),
        input_tokens: span.iter().map(message_tokens).sum(),
        usage,
        summary: sections.unwrap_or_default().to_string(),
    };
    (state, report)
}

/// Flatten one wire message to text for the fallback summarizer. Reasoning is
/// rendered too: it is often the only place a decision's reason was written.
/// A continuation state is skipped -- its model sections are handed over as
/// the sections to merge, and its code sections are rebuilt from the record.
fn render_message(msg: &Value) -> String {
    if is_compaction_summary(msg) {
        return String::new();
    }
    let mut out = format!("{}: ", role(msg));
    if let Some(reasoning) = msg.get("reasoning_content").and_then(Value::as_str) {
        out.push_str(&format!("[reasoning] {reasoning}\n"));
    }
    out.push_str(&continuation::content_text(msg.get("content").unwrap_or(&Value::Null)));
    for call in msg
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let f = call.get("function");
        let name = f.and_then(|f| f.get("name")).and_then(Value::as_str).unwrap_or("");
        let args = f
            .and_then(|f| f.get("arguments"))
            .and_then(Value::as_str)
            .unwrap_or("");
        out.push_str(&format!("\n[tool call] {name}({args})"));
    }
    out.push('\n');
    out
}

/// Split `span` into rendered chunks of at most `max_chars`, on message
/// boundaries where a message fits and on char boundaries where one does not.
fn render_chunks(span: &[Value], max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for msg in span {
        let text = render_message(msg);
        if current.len() + text.len() > max_chars && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if text.len() <= max_chars {
            current.push_str(&text);
            continue;
        }
        let mut rest = text.as_str();
        while !rest.is_empty() {
            let mut end = max_chars.min(rest.len());
            while !rest.is_char_boundary(end) {
                end -= 1;
            }
            chunks.push(rest[..end].to_string());
            rest = &rest[end..];
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Bounds of one fallback chunk, in tokens. Half the window leaves room for
/// the prompt, the sections carried from the chunk before and the reply; the
/// floor keeps a tiny window from fanning out into hundreds of requests.
const CHUNK_TOKENS: (u64, u64) = (4_000, 48_000);

/// The fallback summarizer: the span rendered to text and summarized chunk by
/// chunk, each request carrying the sections written so far, so a span of any
/// size is read whole instead of having its middle cut out. The smol model
/// writes when it answers; any failure there moves the rest of the work to the
/// run's model. A failure on the run's model gives up -- `None` -- and the
/// caller keeps the code-built sections. Usage covers every request made.
async fn summarize_in_chunks(
    span: &[Value],
    previous: Option<&str>,
    role: Role,
    window: u64,
    model_id: &str,
    model: &dyn ModelInvoker,
) -> (Option<(String, String)>, Option<Usage>) {
    let chunk_tokens = (window / 2).clamp(CHUNK_TOKENS.0, CHUNK_TOKENS.1);
    let chunks = render_chunks(span, (chunk_tokens * 4) as usize);
    let mut usage: Option<Usage> = None;
    let mut add = |more: Option<Usage>| {
        usage = match (usage.take(), more) {
            (Some(a), Some(b)) => Some(a.plus(&b)),
            (a, b) => a.or(b),
        };
    };
    if chunks.is_empty() {
        return (previous.map(|p| (model_id.to_string(), p.to_string())), None);
    }
    let prompt = fallback_prompt(role);
    let mut sections = previous.map(str::to_string);
    let mut smol = model.summarizer();
    let mut writer = model_id.to_string();
    let total = chunks.len();
    for (index, chunk) in chunks.iter().enumerate() {
        let body = match &sections {
            Some(earlier) => format!(
                "Earlier sections, to merge:\n{earlier}\n\nTranscript part {} of {total}:\n{chunk}",
                index + 1
            ),
            None => format!("Transcript part {} of {total}:\n{chunk}", index + 1),
        };
        let mut answered = None;
        if let Some((smol_id, smol_model)) = smol {
            match request_summary(&prompt, &body, window, smol_id, smol_model).await {
                Ok((Some(text), spent)) => {
                    add(spent);
                    answered = Some((smol_id.to_string(), text));
                }
                Ok((None, spent)) => {
                    add(spent);
                    log::warn!(
                        "agent: compaction summary from {smol_id} was empty, retrying on \
                         {model_id}"
                    );
                }
                Err(e) => log::warn!(
                    "agent: compaction summary from {smol_id} failed, retrying on {model_id}: {e}"
                ),
            }
            if answered.is_none() {
                smol = None;
            }
        }
        if answered.is_none() {
            match request_summary(&prompt, &body, window, model_id, model).await {
                Ok((Some(text), spent)) => {
                    add(spent);
                    answered = Some((model_id.to_string(), text));
                }
                Ok((None, spent)) => {
                    add(spent);
                    log::warn!("agent: compaction summary from {model_id} was empty");
                    return (None, usage);
                }
                Err(e) => {
                    log::warn!(
                        "agent: compaction summary from {model_id} failed, keeping the \
                         code-built state only: {e}"
                    );
                    return (None, usage);
                }
            }
        }
        if let Some((by, text)) = answered {
            writer = by;
            sections = Some(text);
        }
    }
    (sections.map(|s| (writer, s)), usage)
}

/// One fallback summarizer request: the sections it wrote (`None` when the
/// reply carried none) and the reported usage.
async fn request_summary(
    prompt: &str,
    body: &str,
    window: u64,
    model_id: &str,
    model: &dyn ModelInvoker,
) -> Result<(Option<String>, Option<Usage>), String> {
    let request = json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": prompt },
            { "role": "user", "content": body },
        ],
        "max_tokens": reply_cap(window),
    });
    // Discard the summarizer's streamed tokens: a dropped receiver means these
    // never reach the user-facing event stream.
    let (sink, _rx) = mpsc::unbounded_channel();
    let completion = model.invoke(&request, &sink).await?;
    // Charged whatever the body said: a completion whose text was empty still
    // cost what the provider reported for it.
    Ok((sections_from(&completion), Usage::from_completion(&completion)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    /// A budget re-sized for another model takes that model's window and
    /// keeps the project's ratio; the same model, or a configured window,
    /// keeps the budget as it was.
    #[test]
    fn a_budget_for_another_model_takes_that_models_window() {
        let parent = CompactionBudget {
            context_window: 1_000_000,
            ratio: 0.7,
            reserve_tokens: None,
            window_pinned: false,
        };
        let child = parent.for_model("small", "big", |_| Some(200_000));
        assert_eq!(child.context_window, 200_000);
        assert_eq!(child.ratio, 0.7);
        assert_eq!(parent.for_model("big", "big", |_| Some(1)).context_window, 1_000_000);
        let pinned = CompactionBudget {
            window_pinned: true,
            ..parent
        };
        assert_eq!(pinned.for_model("small", "big", |_| Some(1)).context_window, 1_000_000);
        // A build that cannot size a window keeps the one it has.
        assert_eq!(parent.for_model("small", "big", |_| None).context_window, 1_000_000);
    }

    /// The `PreCompact` call site: the hook runs, and it is told how much
    /// conversation is about to be summarized away -- the one fact a hook that
    /// archives a transcript needs.
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
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
                command: format!("cat > {}", crate::core::agent::shell_quoted_path(&seen)),
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

    /// A summarizer that overflows its own window, as a smaller model would.
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

    /// A run model whose summaries go to a configured smol model first.
    struct WithSmol<M, S> {
        run: M,
        smol: S,
    }
    #[async_trait]
    impl<M: ModelInvoker, S: ModelInvoker> ModelInvoker for WithSmol<M, S> {
        async fn invoke(
            &self,
            request: &Value,
            events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            self.run.invoke(request, events).await
        }
        fn summarizer(&self) -> Option<(&str, &dyn ModelInvoker)> {
            Some(("smol", &self.smol))
        }
    }

    fn stub(summary: &str) -> StubModel {
        StubModel {
            summary: summary.into(),
            calls: StdMutex::new(0),
            requests: tokio::sync::Mutex::new(Vec::new()),
        }
    }

    /// A model answering `content` and reporting `prompt`/`completion` tokens.
    struct Billed(&'static str, u64, u64);
    #[async_trait]
    impl ModelInvoker for Billed {
        async fn invoke(
            &self,
            _request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            Ok(json!({
                "choices": [{ "message": { "content": self.0 } }],
                "usage": {
                    "prompt_tokens": self.1,
                    "completion_tokens": self.2,
                    "total_tokens": self.1 + self.2,
                },
            }))
        }
    }

    fn span(n: usize) -> Vec<Value> {
        let mut v = vec![json!({ "role": "user", "content": "the task" })];
        for i in 1..n {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            v.push(json!({ "role": r, "content": format!("msg{i}") }));
        }
        v
    }

    async fn state_of(
        span: &[Value],
        cached: Option<&Value>,
        window: u64,
        model: &dyn ModelInvoker,
    ) -> (Value, CompactionReport) {
        continuation_state(
            &continuation::gather(span),
            span,
            cached,
            &HarnessContext::default(),
            window,
            "m",
            model,
        )
        .await
    }

    fn state_text(state: &Value) -> &str {
        state["content"].as_str().unwrap()
    }

    /// The cached request is the run's next request plus one instruction, so
    /// a provider serves every byte before the instruction from cache. Tools
    /// and `tool_choice` are untouched: changing them would move the prefix.
    #[test]
    fn the_cached_request_extends_the_next_request() {
        let request = json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "tool_choice": "auto",
            "tools": [{ "type": "function", "function": { "name": "read" } }],
        });
        let side = cached_compaction_request(&request, Role::Parent, 100_000);
        assert_eq!(side["tools"], request["tools"]);
        assert_eq!(side["tool_choice"], request["tool_choice"]);
        let messages = side["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0], request["messages"][0]);
        assert!(crate::core::agent::reminder::is_reminder_only(&messages[1]["content"]));
        assert_eq!(side["max_tokens"], SUMMARY_MAX_TOKENS);
        let small = cached_compaction_request(&request, Role::Parent, 8_000);
        assert_eq!(small["max_tokens"], 800, "a small window gets a smaller reply");
    }

    /// Each role is told what to keep: the parent the cross-task decisions
    /// and what each child was asked and found, a child only its own task.
    /// Current step and Next actions are required for both, on both paths.
    #[test]
    fn the_instruction_is_role_specific() {
        let parent = compaction_instruction(Role::Parent);
        let child = compaction_instruction(Role::Child);
        assert!(parent.contains("what it was asked and what it found"));
        assert!(!child.contains("what it was asked"));
        assert!(child.contains("keep only what that task needs"));
        for text in [parent, child, fallback_prompt(Role::Parent), fallback_prompt(Role::Child)] {
            assert!(text.contains("Current step and Next actions are"), "{text}");
            assert!(text.contains("required, never empty"), "{text}");
        }
        assert!(fallback_prompt(Role::Child).contains("keep only what its"));
    }

    /// The cached path answers on the run model and its sections land in the
    /// state, reasoning and preamble dropped; the summarizer is never asked.
    #[tokio::test]
    async fn the_cached_path_writes_the_model_sections() {
        let model = WithSmol {
            run: stub("<think>hmm</think>Sure.\n## Progress\ncached work\n## Next actions\nmore"),
            smol: stub("SMOL"),
        };
        let request = json!({ "model": "m", "messages": span(6) });
        let (state, report) = state_of(&span(6), Some(&request), 100_000, &model).await;
        let text = state_text(&state);
        assert!(text.contains("## Progress\ncached work\n## Next actions\nmore"), "{text}");
        assert!(!text.contains("hmm") && !text.contains("Sure."), "{text}");
        assert_eq!(report.model.as_deref(), Some("m"));
        assert_eq!(*model.smol.calls.lock().unwrap(), 0, "smol is the fallback only");
    }

    /// A tool call or an empty reply on the cached path falls through to the
    /// summarizer rather than being taken as the summary.
    #[tokio::test]
    async fn a_tool_call_or_empty_cached_reply_falls_back() {
        struct CallsATool;
        #[async_trait]
        impl ModelInvoker for CallsATool {
            async fn invoke(
                &self,
                request: &Value,
                _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
            ) -> Result<Value, String> {
                if request.get("tools").is_some() {
                    return Ok(json!({ "choices": [{ "message": {
                        "content": "## Progress\nignored",
                        "tool_calls": [{ "id": "x", "function": { "name": "read" } }]
                    } }] }));
                }
                Ok(json!({ "choices": [{ "message": { "content": "## Progress\nfallback" } }] }))
            }
        }
        let request = json!({ "model": "m", "messages": span(6), "tools": [{}] });
        let (state, _) = state_of(&span(6), Some(&request), 100_000, &CallsATool).await;
        assert!(state_text(&state).contains("## Progress\nfallback"));

        let model = WithSmol { run: stub(" "), smol: stub("## Progress\nsmol wrote it") };
        let (state, report) = state_of(&span(6), Some(&request), 100_000, &model).await;
        assert!(state_text(&state).contains("smol wrote it"));
        assert_eq!(report.model.as_deref(), Some("smol"));
    }

    /// The fallback reads the whole span, in chunks, instead of cutting the
    /// middle out: every part is sent, each carrying the sections so far.
    #[tokio::test]
    async fn the_fallback_summarizes_a_large_span_in_chunks() {
        let model = stub("## Progress\nso far");
        let mut big = vec![json!({ "role": "user", "content": "the task" })];
        for i in 0..40 {
            big.push(json!({ "role": "assistant", "content": format!("MARK{i} {}", "x".repeat(8_000)) }));
        }
        let (state, _) = state_of(&big, None, 8_000, &model).await;
        let requests = model.requests.lock().await;
        assert!(requests.len() > 1, "one request per chunk");
        let sent: String = requests
            .iter()
            .map(|r| r["messages"][1]["content"].as_str().unwrap().to_string())
            .collect();
        for i in 0..40 {
            assert!(sent.contains(&format!("MARK{i} ")), "chunk with MARK{i} was never read");
        }
        assert!(requests[1]["messages"][1]["content"]
            .as_str()
            .unwrap()
            .starts_with("Earlier sections, to merge:\n## Progress\nso far"));
        assert!(state_text(&state).contains("## Progress\nso far"));
    }

    /// Reasoning reaches the fallback summarizer: it is often the only place a
    /// decision's reason was written.
    #[tokio::test]
    async fn the_fallback_renders_reasoning_and_tool_calls() {
        let model = stub("## Progress\nx");
        let span = vec![
            json!({ "role": "user", "content": "Update the configuration." }),
            json!({ "role": "assistant", "content": Value::Null,
                "reasoning_content": "config.toml is the one",
                "tool_calls": [{ "id": "w", "type": "function",
                    "function": { "name": "write", "arguments": "{\"path\":\"config.toml\"}" } }] }),
            json!({ "role": "tool", "tool_call_id": "w", "content": "Wrote config.toml" }),
        ];
        state_of(&span, None, 100_000, &model).await;
        let requests = model.requests.lock().await;
        let body = requests[0]["messages"][1]["content"].as_str().unwrap();
        assert!(body.contains("[reasoning] config.toml is the one"));
        assert!(body.contains("[tool call] write("));
        assert!(body.contains("Wrote config.toml"));
        assert_eq!(requests[0]["messages"].as_array().unwrap().len(), 2);
    }

    /// (e) A summarizer that overflows or fails leaves the code-built state:
    /// the task is still there verbatim, and nothing errors.
    #[tokio::test]
    async fn a_failing_summarizer_leaves_the_code_built_state() {
        let overflowing = WithSmol { run: OverflowingModel, smol: OverflowingModel };
        let failing = WithSmol { run: FailingModel, smol: FailingModel };
        for model in [&overflowing as &dyn ModelInvoker, &failing] {
            let (state, report) = state_of(&span(10), None, 100_000, model).await;
            let text = state_text(&state);
            assert!(continuation::is_state(&state));
            assert!(text.contains("the task"), "{text}");
            assert!(text.contains("summarizer could not run"), "{text}");
            assert_eq!(report.model, None);
        }
    }

    /// An empty smol reply was still billed, so its usage is charged along
    /// with the run model's retry rather than dropped with the empty text.
    #[tokio::test]
    async fn every_summarizer_request_is_charged() {
        let model = WithSmol { run: Billed("## Progress\nRUN", 1_000, 50), smol: Billed(" ", 900, 7) };
        let (_, report) = state_of(&span(16), None, 100_000, &model).await;
        assert_eq!(report.model.as_deref(), Some("m"), "the run model wrote it");
        let usage = report.usage.expect("both requests reported usage");
        assert_eq!(usage.prompt_tokens, Some(1_900));
        assert_eq!(usage.completion_tokens, Some(57));

        // Still charged when the run model's retry then fails.
        let model = WithSmol { run: FailingModel, smol: Billed("", 900, 7) };
        let (_, report) = state_of(&span(16), None, 100_000, &model).await;
        assert_eq!(report.usage.expect("the smol request was billed").completion_tokens, Some(7));
        assert_eq!(report.model, None, "no model wrote the sections");
    }

    /// A later compaction merges the previous model sections instead of
    /// re-summarizing them, and an older `system` summary counts as one.
    #[tokio::test]
    async fn the_previous_model_sections_are_handed_over_to_merge() {
        let model = stub("## Progress\nmerged");
        let mut span = vec![summary_message("we built a.txt")];
        span.extend(self::span(4));
        state_of(&span, None, 100_000, &model).await;
        let requests = model.requests.lock().await;
        let body = requests[0]["messages"][1]["content"].as_str().unwrap();
        assert!(body.starts_with("Earlier sections, to merge:\n## Progress\nwe built a.txt"), "{body}");
        assert!(!body.contains(SUMMARY_MARKER), "the old summary is not rendered as transcript");
    }

    fn convo(n: usize) -> Vec<Value> {
        let mut v = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..n {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            v.push(json!({ "role": r, "content": format!("msg{i}") }));
        }
        v
    }

    /// `/compact` keeps the system prompt and the tail, and puts the state
    /// between them as a user message.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn compact_conversation_keeps_the_system_prompt_and_tail() {
        let model = stub("## Progress\nCONDENSED");
        let input = convo(20);
        let (out, report) =
            compact_conversation(&input, "m", &model, 4, &HarnessContext::default(), 100_000).await;
        assert!(report.is_some());
        assert_eq!(out[0], input[0]);
        assert!(continuation::is_state(&out[1]));
        assert!(state_text(&out[1]).contains("CONDENSED"));
        assert_eq!(&out[2..], &input[input.len() - 4..]);

        let (same, none) =
            compact_conversation(&convo(4), "m", &model, 8, &HarnessContext::default(), 100_000).await;
        assert_eq!(same, convo(4));
        assert!(none.is_none());
    }

    fn call(id: &str) -> Value {
        json!({ "role": "assistant", "content": Value::Null,
            "tool_calls": [{ "id": id, "function": { "name": "read" } }] })
    }

    fn result(id: &str, size: usize) -> Value {
        json!({ "role": "tool", "tool_call_id": id, "content": "r".repeat(size) })
    }

    /// (f) The tail is sized by tokens: a run of large tool results keeps only
    /// what fits, so the compacted request is well under the trigger.
    #[test]
    fn a_tail_of_large_tool_results_is_sized_by_tokens() {
        let mut rest = vec![json!({ "role": "user", "content": "task" })];
        for i in 0..8 {
            rest.push(call(&format!("t{i}")));
            rest.push(result(&format!("t{i}"), 40_000));
        }
        // 10K tokens of tail on a 100K window; each result is ~10K tokens.
        let cut = token_tail_start(&rest, tail_tokens(100_000)).unwrap();
        let kept: u64 = rest[cut..].iter().map(message_tokens).sum();
        assert!(kept <= 3 * tail_tokens(100_000), "kept {kept} tokens");
        assert_eq!(rest[cut], rest[rest.len() - 2], "the last complete call is kept");
        assert_eq!(rest.len() - cut, 2, "with its result and nothing more");
    }

    /// A call is never kept without its results, a parallel batch included.
    #[test]
    fn the_token_tail_keeps_a_batch_whole() {
        let mut rest = vec![json!({ "role": "user", "content": "task" })];
        for i in 0..4 {
            rest.push(call(&format!("t{i}")));
            rest.push(result(&format!("t{i}"), 100));
        }
        let calls: Vec<Value> = (0..6)
            .map(|i| json!({ "id": format!("p{i}"), "function": { "name": "read" } }))
            .collect();
        rest.push(json!({ "role": "assistant", "content": Value::Null, "tool_calls": calls }));
        let batch = rest.len() - 1;
        for i in 0..6 {
            rest.push(result(&format!("p{i}"), 100));
        }
        let cut = token_tail_start(&rest, 300).unwrap();
        assert_ne!(role(&rest[cut]), "tool");
        assert!(cut <= batch);
        // A budget too small for the batch drops it whole rather than split
        // it: the tail is then empty, and the state carries everything.
        assert_eq!(token_tail_start(&rest, 10), Some(rest.len()));
    }

    /// Nothing worth dropping in front of the tail is no compaction.
    #[test]
    fn a_short_conversation_has_no_token_tail_cut() {
        let rest = vec![json!({ "role": "user", "content": "task" }), call("a"), result("a", 10)];
        assert!(token_tail_start(&rest, 1_000).is_none());
    }

    /// The old `system` summary still reads as one, and the new state too.
    #[test]
    fn both_summary_forms_are_recognized() {
        assert!(is_compaction_summary(&summary_message("x")));
        assert_eq!(legacy_summary_text(&summary_message("x")), Some("x"));
        let state = continuation::build(&continuation::Gathered::default(), &HarnessContext::default(), 10, None);
        assert!(is_compaction_summary(&state));
        assert!(!is_compaction_summary(&json!({ "role": "system", "content": "prompt" })));
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

    #[test]
    fn an_image_part_costs_a_fixed_estimate_not_its_base64_length() {
        // Three ~750 KB camera frames: as text, ~560K tokens, far past a 128K
        // window's trigger; as images, a few thousand.
        let frame = |_| json!({
            "type": "image_url",
            "image_url": { "url": format!("data:image/png;base64,{}", "A".repeat(750_000)) },
        });
        let observation = json!({
            "model": "m",
            "messages": [
                { "role": "user", "content": "look" },
                { "role": "tool", "tool_call_id": "c1", "content": (0..3).map(frame).collect::<Vec<_>>() },
            ],
        });
        let estimate = estimate_request_tokens(&observation);
        assert!(estimate >= 3 * IMAGE_PART_TOKENS as u64, "images still count: {estimate}");
        assert!(
            estimate < trigger_tokens(128_000, DEFAULT_COMPACTION_RATIO, None),
            "one observation must not trigger compaction: {estimate}"
        );
    }
}
