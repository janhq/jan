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

use crate::core::agent::continuation::{self, Caps, Gathered, HarnessContext, Role};
use crate::core::agent::events::{CompactionReport, Usage};
use crate::core::agent::r#loop::ModelInvoker;
use crate::core::agent::transcript::{CompactionPlan, Transcript};
use crate::core::agent::upstream::extract_choice_message;

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
pub(crate) fn message_tokens(msg: &Value) -> u64 {
    (json_text_len(msg) as u64).div_ceil(4) + 4
}

/// Share of the trigger each of the kept tail, the verbatim user messages and
/// the model's reply may take. Shares of the trigger rather than the window:
/// the request after a compaction has to land under the trigger, and on a
/// low `compaction_ratio` a tenth of the window is a third of the trigger, so
/// window-sized shares alone could put the next request back over it.
const SHARE_DIVISOR: u64 = 10;

/// Tokens the kept tail may hold under a `trigger`-token trigger.
pub(crate) fn tail_tokens(trigger: u64) -> u64 {
    trigger / SHARE_DIVISOR
}

/// The caps on the state's verbatim sections under a `trigger`-token trigger:
/// a share for the user messages, and twice that for the task, which is the
/// one text the run cannot do without.
pub(crate) fn caps(trigger: u64) -> Caps {
    Caps {
        user: trigger / SHARE_DIVISOR,
        task: trigger * 2 / SHARE_DIVISOR,
    }
}

/// Longest reply a compaction asks for. The sections it writes are re-sent on
/// every request until the next compaction, so a dense brief is the goal.
const SUMMARY_MAX_TOKENS: u64 = 8_192;

/// The reply cap under a `trigger`-token trigger: [`SUMMARY_MAX_TOKENS`], or
/// a share of a small trigger, so the state written fits beside the tail.
fn reply_cap(trigger: u64) -> u64 {
    SUMMARY_MAX_TOKENS.min(trigger / SHARE_DIVISOR).max(256)
}

/// What a compaction sizes against.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Sizing {
    /// The route's context window: what any request, the side request
    /// included, has to fit.
    pub(crate) window: u64,
    /// Prompt tokens at which the run compacts: what the request after the
    /// compaction has to stay under, or the next turn compacts again.
    pub(crate) trigger: u64,
    /// Tokens of the next request that are not conversation -- system prompt,
    /// tool schemas, volatile tail -- and stay whatever is compacted.
    pub(crate) overhead: u64,
}

impl Sizing {
    /// Sizing on a `window`-token route at `ratio`, with no known overhead.
    pub(crate) fn new(window: u64, ratio: f64) -> Self {
        Self {
            window,
            trigger: trigger_tokens(window, ratio, None),
            overhead: 0,
        }
    }
}

/// The tokens of `request` a compaction cannot remove: everything but its
/// non-system messages, plus the `volatile` tail placed again after one.
pub(crate) fn request_overhead(request: &Value, volatile: Option<&str>) -> u64 {
    let conversation: usize = request
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| role(m) != "system")
        .map(json_text_len)
        .sum();
    let fixed = json_text_len(request).saturating_sub(conversation) as u64 / 4;
    fixed + volatile.map_or(0, |text| message_tokens(&json!({ "content": text })))
}

/// Whether the cached path can answer `request`. A forced `tool_choice` (the
/// eager todo plan on a run's first turn) makes the model call that tool, so
/// the reply could never be the sections: the side request would be a
/// full-size request paid for nothing.
pub(crate) fn cacheable(request: &Value) -> bool {
    request
        .get("tool_choice")
        .is_none_or(|choice| choice.as_str() == Some("auto"))
}

/// A compaction whose tail and caps fit the trigger.
pub(crate) struct Fitted {
    pub(crate) plan: CompactionPlan,
    pub(crate) gathered: Gathered,
    pub(crate) caps: Caps,
}

/// Bound on the shrinking in [`fit`]: each step halves one share.
const MAX_FIT_STEPS: usize = 64;

/// Below this a share is dropped to nothing rather than halved again.
const MIN_SHARE_TOKENS: u64 = 256;

/// Plan a compaction of `transcript` whose next request fits under the
/// trigger: system prompt and tools, the state at its largest (the code
/// sections plus a full reply) and the kept tail. Shares that do not fit are
/// shrunk -- the tail first, since what it drops still reaches the state, then
/// the user messages, then the task -- so a large task or a low ratio cannot
/// leave a run compacting on every turn. `None` when nothing is safe to drop.
pub(crate) fn fit(transcript: &Transcript, sizing: Sizing, harness: &HarnessContext) -> Option<Fitted> {
    let reply = reply_cap(sizing.trigger);
    let mut keep = tail_tokens(sizing.trigger);
    let mut caps = caps(sizing.trigger);
    let mut plan = transcript.compaction_plan(keep)?;
    let mut gathered = continuation::gather(&plan.summarize);
    let halve = |share: u64| if share < MIN_SHARE_TOKENS { 0 } else { share / 2 };
    for _ in 0..MAX_FIT_STEPS {
        let state = continuation::build(&gathered, harness, caps, None);
        let next = sizing.overhead + message_tokens(&state) + reply + plan.tail_tokens;
        if next <= sizing.trigger {
            break;
        }
        if plan.tail_tokens > 0 {
            keep = halve(keep);
            if let Some(smaller) = transcript.compaction_plan(keep) {
                gathered = continuation::gather(&smaller.summarize);
                plan = smaller;
            }
        } else if caps.user > 0 {
            caps.user = halve(caps.user);
        } else if caps.task > continuation::MIN_CLIP_TOKENS {
            caps.task = (caps.task / 2).max(continuation::MIN_CLIP_TOKENS);
        } else {
            log::warn!(
                "agent: the compacted request is estimated at {next} tokens, over its {} token \
                 trigger with nothing left to shrink",
                sizing.trigger
            );
            break;
        }
    }
    Some(Fitted { plan, gathered, caps })
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
/// rather than a run's record -- keeping a tail of at most `keep_tokens`, cut
/// by [`token_tail_start`] as a run's own compaction cuts it. The input comes
/// back unchanged with no report when there is nothing safe to drop. Never
/// fails: a summarizer that cannot run leaves the code-built state.
/// The caps come from `sizing`'s trigger, the same one the tail was cut from.
#[cfg(feature = "cli")]
pub(crate) async fn compact_conversation(
    messages: &[Value],
    model_id: &str,
    model: &dyn ModelInvoker,
    keep_tokens: u64,
    harness: &HarnessContext,
    sizing: Sizing,
) -> (Vec<Value>, Option<CompactionReport>) {
    let sys_end = messages
        .iter()
        .take_while(|m| role(m) == "system" && !is_compaction_summary(m))
        .count();
    let (system_msgs, rest) = messages.split_at(sys_end);

    let Some(cut) = token_tail_start(rest, keep_tokens) else {
        return (messages.to_vec(), None);
    };

    let gathered = continuation::gather(&rest[..cut]);
    // The interactive `/compact` meters nothing: it is not inside a run's
    // budget, so there is no ceiling for this request to be charged against.
    // Its usage still rides on the report, which is what `/agents` shows.
    let Continuation { state, report, .. } = continuation_state(
        &gathered,
        &rest[..cut],
        None,
        harness,
        sizing,
        caps(sizing.trigger),
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
/// run was about to send, tools and `tool_choice` included -- plus one
/// instruction, so every byte before it is a prefix the provider has cached.
///
/// The instruction goes in the way [`crate::core::agent::reminder::attach`]
/// places a reminder: appended to a trailing user message (usually the
/// volatile tail) rather than as a second user message after it, which a
/// template that demands alternating roles rejects. Appending to the text
/// leaves every byte before it where it was.
///
/// `max_tokens` is set to the reply cap whatever the user asked for: it is not
/// part of any prompt cache key, and a small user cap (or one that also covers
/// an `o*` model's reasoning) would cut the sections short or leave them empty.
pub(crate) fn cached_compaction_request(request: &Value, role: Role, trigger: u64) -> Value {
    let mut side = request.clone();
    if let Some(messages) = side.get_mut("messages").and_then(Value::as_array_mut) {
        let mut list = std::mem::take(messages);
        crate::core::agent::reminder::attach(&mut list, &compaction_instruction(role));
        *messages = list;
    }
    if let Some(map) = side.as_object_mut() {
        map.insert("max_tokens".to_string(), json!(reply_cap(trigger)));
    }
    side
}

/// `side` with `reasoning_content` removed from its assistant turns.
fn without_reasoning(side: &Value) -> Value {
    let mut out = side.clone();
    if let Some(messages) = out.get_mut("messages").and_then(Value::as_array_mut) {
        *messages = crate::core::agent::r#loop::strip_assistant_reasoning(messages);
    }
    out
}

/// Fold `more` into `total`.
fn add_usage(total: &mut Option<Usage>, more: Option<Usage>) {
    *total = match (total.take(), more) {
        (Some(a), Some(b)) => Some(a.plus(&b)),
        (a, b) => a.or(b),
    };
}

/// Ask the run's model for the sections with the cached request `side`.
///
/// A route not yet known to reject a resent `reasoning_content` rejects the
/// side request for it before the main request finds out, so the route is
/// remembered here and the side request retried once without the field. That
/// retry rewrites every earlier assistant turn and so misses the cache, but
/// only for itself: the fallback would read the whole span anyway, and it
/// also has to pay for every chunk.
///
/// `rejected` is set when the route refused the field, so the caller can stop
/// sending it on the run's own next request instead of waiting for that one
/// to be refused too.
async fn ask_cached(
    side: &Value,
    model_id: &str,
    model: &dyn ModelInvoker,
    usage: &mut Option<Usage>,
    rejected: &mut bool,
) -> Option<String> {
    // A dropped receiver: the reply is a summary, not the answer the user is
    // reading.
    let (sink, _rx) = mpsc::unbounded_channel();
    let mut stripped = None;
    loop {
        let request = stripped.as_ref().unwrap_or(side);
        match model.invoke(request, &sink).await {
            Ok(completion) => {
                add_usage(usage, Usage::from_completion(&completion));
                let sections = sections_from(&completion);
                if sections.is_none() {
                    log::warn!(
                        "agent: cached compaction on {model_id} returned no usable sections, \
                         summarizing the span instead"
                    );
                }
                return sections;
            }
            Err(e)
                if stripped.is_none()
                    && crate::core::agent::upstream::is_reasoning_field_error(&e) =>
            {
                model.reasoning_rejected(model_id);
                *rejected = true;
                let retry = without_reasoning(side);
                if retry == *side {
                    return None;
                }
                log::info!(
                    "agent: cached compaction on {model_id} rejected reasoning_content, \
                     retrying without it"
                );
                stripped = Some(retry);
            }
            Err(e) => {
                log::warn!(
                    "agent: cached compaction on {model_id} failed, summarizing the span \
                     instead: {e}"
                );
                return None;
            }
        }
    }
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

/// Heading of the harness's note on what this compaction could not do.
const NOTE_HEADING: &str = "Compaction note";

/// What [`continuation_state`] produced.
pub(crate) struct Continuation {
    /// The state message that replaces the span.
    pub(crate) state: Value,
    pub(crate) report: CompactionReport,
    /// The cached side request found that the route rejects a resent
    /// `reasoning_content`. The run's next request would carry the field
    /// too, so the run stops sending it here, at the compaction, where the
    /// prefix breaks anyway, rather than paying one more rejected round trip.
    pub(crate) reasoning_rejected: bool,
}

/// Build the continuation state for a compaction and say what it took.
///
/// The model sections come from `cached` first -- the request the run was
/// about to send, extended by one instruction -- when it fits the window. A
/// route with no usable answer there (no `cached`, a tool call, an empty
/// reply, an error) falls back to the summarizer over `span`, which tries the
/// smol model first.
///
/// A summarizer that fails part-way keeps what it wrote; one that wrote
/// nothing leaves the previous state's model sections, so a third compaction
/// that fails does not erase what the first two merged. Either way a note says
/// what went unsummarized. Only with nothing at all does the state carry the
/// code-built sections alone: the task and the user's words are never lost,
/// and the run never fails for want of a summary.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn continuation_state(
    gathered: &Gathered,
    span: &[Value],
    cached: Option<&Value>,
    harness: &HarnessContext,
    sizing: Sizing,
    caps: Caps,
    model_id: &str,
    model: &dyn ModelInvoker,
) -> Continuation {
    let mut usage: Option<Usage> = None;
    let mut written: Option<(String, String)> = None;
    let mut notes: Vec<String> = Vec::new();
    let mut reasoning_rejected = false;
    if let Some(request) = cached {
        let side = cached_compaction_request(request, harness.role, sizing.trigger);
        if estimate_request_tokens(&side) + reply_cap(sizing.trigger) <= sizing.window {
            written = ask_cached(&side, model_id, model, &mut usage, &mut reasoning_rejected)
                .await
                .map(|sections| (model_id.to_string(), sections));
        }
    }
    let mut sections = written.as_ref().map(|(_, s)| s.clone());
    if written.is_none() {
        let (chunked, spent) = summarize_in_chunks(
            span,
            gathered.previous_model.as_deref(),
            harness.role,
            sizing,
            model_id,
            model,
        )
        .await;
        add_usage(&mut usage, spent);
        if chunked.clipped {
            notes.push(
                "The compacted span was too long to summarize whole within the request limit, \
                 so the middle of its longest messages was clipped before summarizing."
                    .to_string(),
            );
        }
        // Said apart from the clipping: a clipped message was still read, a
        // dropped one was not, and only the earlier sections may cover it.
        if chunked.dropped > 0 {
            notes.push(format!(
                "The {} oldest messages of the compacted span were not summarized: even clipped, \
                 the span did not fit the request limit. Only the earlier sections cover them.",
                chunked.dropped
            ));
        }
        if chunked.done < chunked.total {
            notes.push(format!(
                "Only {} of {} parts of the compacted span were summarized before the summarizer \
                 failed: the newest part is not in the sections below. Re-check recent work on \
                 disk before relying on them.",
                chunked.done, chunked.total
            ));
        }
        written = chunked.written;
        sections = written
            .as_ref()
            .map(|(_, s)| s.clone())
            .or_else(|| gathered.previous_model.clone());
    }
    let harness = if notes.is_empty() {
        std::borrow::Cow::Borrowed(harness)
    } else {
        let mut with_notes = harness.clone();
        with_notes.push(NOTE_HEADING, notes.join("\n"));
        std::borrow::Cow::Owned(with_notes)
    };
    let state = continuation::build(gathered, &harness, caps, sections.as_deref());
    let report = CompactionReport {
        model: written.as_ref().map(|(m, _)| m.clone()),
        input_tokens: span.iter().map(message_tokens).sum(),
        usage,
        summary: written.map(|(_, s)| s).unwrap_or_default(),
    };
    Continuation { state, report, reasoning_rejected }
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
    let rendered: Vec<String> = span.iter().map(render_message).collect();
    pack(&rendered, max_chars)
}

/// Pack rendered messages, in order, into chunks of at most `max_chars`.
fn pack(rendered: &[String], max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for text in rendered {
        if current.len() + text.len() > max_chars && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if text.len() <= max_chars {
            current.push_str(text);
            continue;
        }
        chunks.extend(split_chars(text, max_chars));
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

/// `text` in pieces of at most `max_chars`, cut on char boundaries.
fn split_chars(text: &str, max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let mut end = max_chars.min(rest.len());
        while !rest.is_char_boundary(end) {
            end -= 1;
        }
        out.push(rest[..end].to_string());
        rest = &rest[end..];
    }
    out
}

/// `text` cut to `max_chars` by dropping its middle, keeping the head (what a
/// message set out to do) and the tail (what it ended on).
fn clip_text_middle(text: &str, max_chars: usize) -> String {
    const MARK: &str = "\n[... middle clipped to bound the summary requests ...]\n";
    if text.len() <= max_chars.max(MARK.len()) {
        return text.to_string();
    }
    let keep = max_chars.saturating_sub(MARK.len());
    let mut head = keep / 2;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - (keep - head);
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    format!("{}{MARK}{}", &text[..head], &text[tail..])
}

/// Bounds of one fallback chunk, in tokens. Half the writer's window leaves
/// room for the prompt, the sections carried from the chunk before and the
/// reply; the floor keeps a tiny window from fanning out into hundreds of
/// requests, and the ceiling keeps each request's price in proportion.
const CHUNK_TOKENS: (u64, u64) = (4_000, 48_000);

/// Most requests one fallback summary makes. They run one after another at
/// full price, so an unknown window or a small local model must not turn a
/// long span into a hundred of them: past this the chunks grow to what the
/// writer can take, and past that each message's middle is clipped.
pub(crate) const MAX_CHUNKS: usize = 8;

/// Window assumed for a summarizer whose own window cannot be resolved: small
/// enough for the local models a smol model usually is.
const SMOL_FALLBACK_WINDOW: u64 = 32_000;

/// The context window of the summarizer `model_id`, as the CLI resolves a
/// run's (provider listing, then catalog), or [`SMOL_FALLBACK_WINDOW`].
#[cfg(feature = "cli")]
fn summarizer_window(model_id: &str) -> u64 {
    use crate::core::cli::model_capabilities::{
        reported_window, resolve_context_window, ContextWindowSource,
    };
    let resolved = resolve_context_window(model_id, None, reported_window(None, model_id));
    match resolved.source {
        ContextWindowSource::Fallback => SMOL_FALLBACK_WINDOW,
        _ => resolved.tokens,
    }
}

/// The desktop keeps no provider listing, so only the catalog sizes it.
#[cfg(not(feature = "cli"))]
fn summarizer_window(model_id: &str) -> u64 {
    crate::core::agent::proxy_budget::catalog_window(model_id).unwrap_or(SMOL_FALLBACK_WINDOW)
}

/// The span as at most [`MAX_CHUNKS`] chunks a `window`-token writer can read,
/// whether messages had to be clipped to get there, and how many of its
/// oldest messages were left out entirely.
fn bounded_chunks(span: &[Value], window: u64) -> (Vec<String>, bool, usize) {
    let preferred = (window / 2).clamp(CHUNK_TOKENS.0, CHUNK_TOKENS.1);
    let largest = (window / 2).max(CHUNK_TOKENS.0);
    let chunks = render_chunks(span, (preferred * 4) as usize);
    if chunks.len() <= MAX_CHUNKS {
        return (chunks, false, 0);
    }
    // Larger chunks first: they read every word, only in fewer requests.
    // Grown by steps, since packing whole messages leaves each chunk short of
    // its size and the even split alone can still come out one over.
    let total: u64 = chunks.iter().map(|c| c.len() as u64).sum::<u64>().div_ceil(4);
    let mut grown = total.div_ceil(MAX_CHUNKS as u64).max(preferred);
    while grown <= largest {
        let chunks = render_chunks(span, (grown * 4) as usize);
        if chunks.len() <= MAX_CHUNKS {
            return (chunks, false, 0);
        }
        grown += grown / 4;
    }
    // Still too long: every message is cut to one per-message cap, the
    // largest whose packing fits, so short messages stay whole and the long
    // ones lose their middles. Packed on message boundaries, so no chunk
    // starts mid-word; a cap of nothing but the clip marks always fits.
    let max_chars = (largest * 4) as usize;
    let rendered: Vec<String> = span.iter().map(render_message).collect();
    let packed = |cap: usize| -> Vec<String> {
        let clipped: Vec<String> = rendered.iter().map(|t| clip_text_middle(t, cap)).collect();
        pack(&clipped, max_chars)
    };
    let (mut low, mut high) = (0usize, rendered.iter().map(String::len).max().unwrap_or(0));
    while low < high {
        let mid = (low + high).div_ceil(2);
        if packed(mid).len() <= MAX_CHUNKS {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    let clipped: Vec<String> = rendered.iter().map(|t| clip_text_middle(t, low)).collect();
    // Even marks alone can overflow a span of thousands of messages: then
    // the oldest go, which is what the previous sections already cover best.
    // Dropped whole messages rather than whole chunks, so the count the state
    // reports is exact: the newest messages are kept while they pack into
    // `MAX_CHUNKS`.
    let mut dropped = 0;
    let mut chunks = pack(&clipped, max_chars);
    if chunks.len() > MAX_CHUNKS {
        let (mut low, mut high) = (1usize, clipped.len());
        while low < high {
            let mid = (low + high) / 2;
            if pack(&clipped[mid..], max_chars).len() <= MAX_CHUNKS {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        dropped = low;
        chunks = pack(&clipped[dropped..], max_chars);
    }
    (chunks, true, dropped)
}

/// What the fallback summarizer got done.
#[derive(Debug, Default)]
struct Chunked {
    /// The sections and who wrote them, when any request in this pass
    /// answered. They already merge the earlier sections handed in.
    written: Option<(String, String)>,
    /// Chunks summarized, of `total`.
    done: usize,
    total: usize,
    /// Messages were clipped to keep within [`MAX_CHUNKS`].
    clipped: bool,
    /// Oldest messages of the span left out to keep within [`MAX_CHUNKS`].
    dropped: usize,
}

/// The fallback summarizer: the span rendered to text and summarized chunk by
/// chunk, each request carrying the sections written so far, so a span of any
/// size is read whole instead of having its middle cut out. The smol model
/// writes when it answers, with the chunks sized for its own window; any
/// failure there moves the rest of the work to the run's model. A failure on
/// the run's model stops, keeping the sections the chunks before it wrote.
/// Usage covers every request made.
async fn summarize_in_chunks(
    span: &[Value],
    previous: Option<&str>,
    role: Role,
    sizing: Sizing,
    model_id: &str,
    model: &dyn ModelInvoker,
) -> (Chunked, Option<Usage>) {
    let mut smol = model.summarizer();
    let writer_window = match smol {
        // Never larger than the run's: smol hands off to it on a failure.
        Some((smol_id, _)) => summarizer_window(smol_id).min(sizing.window),
        None => sizing.window,
    };
    let (chunks, clipped, dropped) = bounded_chunks(span, writer_window);
    let mut usage: Option<Usage> = None;
    let mut out = Chunked {
        total: chunks.len(),
        clipped,
        dropped,
        ..Chunked::default()
    };
    let prompt = fallback_prompt(role);
    let mut sections = previous.map(str::to_string);
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
            match request_summary(&prompt, &body, sizing.trigger, smol_id, smol_model).await {
                Ok((Some(text), spent)) => {
                    add_usage(&mut usage, spent);
                    answered = Some((smol_id.to_string(), text));
                }
                Ok((None, spent)) => {
                    add_usage(&mut usage, spent);
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
            match request_summary(&prompt, &body, sizing.trigger, model_id, model).await {
                Ok((Some(text), spent)) => {
                    add_usage(&mut usage, spent);
                    answered = Some((model_id.to_string(), text));
                }
                Ok((None, spent)) => {
                    add_usage(&mut usage, spent);
                    log::warn!(
                        "agent: compaction summary from {model_id} was empty at part {} of \
                         {total}, keeping the sections written so far",
                        index + 1
                    );
                    return (out, usage);
                }
                Err(e) => {
                    log::warn!(
                        "agent: compaction summary from {model_id} failed at part {} of \
                         {total}, keeping the sections written so far: {e}",
                        index + 1
                    );
                    return (out, usage);
                }
            }
        }
        if let Some((by, text)) = answered {
            sections = Some(text.clone());
            out.written = Some((by, text));
            out.done = index + 1;
        }
    }
    (out, usage)
}

/// One fallback summarizer request: the sections it wrote (`None` when the
/// reply carried none) and the reported usage.
async fn request_summary(
    prompt: &str,
    body: &str,
    trigger: u64,
    model_id: &str,
    model: &dyn ModelInvoker,
) -> Result<(Option<String>, Option<Usage>), String> {
    let request = json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": prompt },
            { "role": "user", "content": body },
        ],
        "max_tokens": reply_cap(trigger),
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
        let sizing = Sizing::new(window, DEFAULT_COMPACTION_RATIO);
        let out = continuation_state(
            &continuation::gather(span),
            span,
            cached,
            &HarnessContext::default(),
            sizing,
            caps(sizing.trigger),
            "m",
            model,
        )
        .await;
        (out.state, out.report)
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
        assert_eq!(messages.len(), 1, "folded into the trailing user message");
        let text = messages[0]["content"].as_str().unwrap();
        assert!(text.starts_with("hi\n\n<SYSTEM>\n[Compaction request from the harness]"), "{text}");
        let after_tool = json!({ "model": "m", "messages": [
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": Value::Null, "tool_calls": [{ "id": "a" }] },
            { "role": "tool", "tool_call_id": "a", "content": "out" },
        ] });
        let side_after_tool = cached_compaction_request(&after_tool, Role::Parent, 100_000);
        let last = side_after_tool["messages"].as_array().unwrap().last().unwrap().clone();
        assert!(
            crate::core::agent::reminder::is_reminder_only(&last["content"]),
            "never folded into a tool result"
        );
        assert_eq!(side["max_tokens"], SUMMARY_MAX_TOKENS);
        let small = cached_compaction_request(&request, Role::Parent, 8_000);
        assert_eq!(small["max_tokens"], 800, "a small trigger gets a smaller reply");
    }

    /// (#12) The instruction joins a trailing user message -- the volatile
    /// tail, on a real request -- instead of following it as a second one,
    /// which a template demanding alternating roles rejects. Its text is
    /// appended, so every byte of that message's text is still a prefix.
    #[test]
    fn the_instruction_folds_into_a_trailing_user_message() {
        let tail = crate::core::agent::reminder::wrap("Today's date is 2026-11-04.");
        let request = json!({
            "model": "m",
            "messages": [
                { "role": "user", "content": "the task" },
                { "role": "assistant", "content": "ok" },
                { "role": "user", "content": tail },
            ],
        });
        let side = cached_compaction_request(&request, Role::Parent, 100_000);
        let messages = side["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3, "no message is added after the tail");
        assert_eq!(&messages[..2], &request["messages"].as_array().unwrap()[..2]);
        let last = messages[2]["content"].as_str().unwrap();
        assert!(last.starts_with(&tail), "the tail's text is kept as it was: {last}");
        assert!(last.contains("[Compaction request from the harness]"));
        assert!(crate::core::agent::reminder::is_reminder_only(&messages[2]["content"]));
    }

    /// (#10) The reply cap is not the user's `max_tokens`: a small one would
    /// cut the sections short, and it is not part of any cache key.
    #[test]
    fn the_reply_cap_ignores_the_users_max_tokens() {
        for user_cap in [512, 1_000_000] {
            let request = json!({
                "model": "m",
                "max_tokens": user_cap,
                "messages": [{ "role": "user", "content": "hi" }],
            });
            let side = cached_compaction_request(&request, Role::Parent, 100_000);
            assert_eq!(side["max_tokens"], SUMMARY_MAX_TOKENS);
        }
    }

    /// (#7) A forced tool choice can only be answered with that tool call, so
    /// such a request never takes the cached path.
    #[test]
    fn a_forced_tool_choice_is_not_cacheable() {
        let forced = json!({ "tool_choice": { "type": "function", "function": { "name": "todo" } } });
        assert!(!cacheable(&forced));
        assert!(!cacheable(&json!({ "tool_choice": "required" })));
        assert!(cacheable(&json!({ "tool_choice": "auto" })));
        assert!(cacheable(&json!({ "messages": [] })));
    }

    /// A run model that rejects a resent `reasoning_content` the way a strict
    /// route does, and answers once the field is gone.
    struct RejectsReasoning {
        requests: StdMutex<Vec<Value>>,
        rejected: StdMutex<Vec<String>>,
    }
    #[async_trait]
    impl ModelInvoker for RejectsReasoning {
        async fn invoke(
            &self,
            request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            self.requests.lock().unwrap().push(request.clone());
            if serde_json::to_string(request).unwrap().contains("reasoning_content") {
                return Err("Upstream returned HTTP 400: unsupported field reasoning_content".into());
            }
            Ok(json!({ "choices": [{ "message": { "content": "## Progress\nretried" } }] }))
        }
        fn reasoning_rejected(&self, model_id: &str) {
            self.rejected.lock().unwrap().push(model_id.to_string());
        }
    }

    /// (#9) A reasoning rejection on the side request is remembered for the
    /// route and retried once without the field, rather than falling back to
    /// a full chunked summary.
    #[tokio::test]
    async fn a_reasoning_rejection_on_the_side_request_retries_without_it() {
        let model = RejectsReasoning {
            requests: StdMutex::new(Vec::new()),
            rejected: StdMutex::new(Vec::new()),
        };
        let mut span = self::span(4);
        span[1]["reasoning_content"] = json!("thinking");
        let request = json!({ "model": "m", "messages": span });
        let (state, report) = state_of(&span, Some(&request), 100_000, &model).await;
        assert!(state_text(&state).contains("## Progress\nretried"));
        assert_eq!(report.model.as_deref(), Some("m"));
        assert_eq!(*model.rejected.lock().unwrap(), vec!["m".to_string()]);
        let requests = model.requests.lock().unwrap();
        assert_eq!(requests.len(), 2, "one rejection, one retry, no fallback");
        let retry = &requests[1]["messages"];
        assert!(retry[1].get("reasoning_content").is_none());
        assert_eq!(retry.as_array().unwrap().len(), 5, "the instruction still follows");
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

    /// A previous state whose model sections say `progress`.
    fn previous_state(progress: &str) -> Value {
        let gathered = continuation::gather(&[json!({ "role": "user", "content": "the task" })]);
        continuation::build(
            &gathered,
            &HarnessContext::default(),
            caps(80_000),
            Some(&format!("## Progress\n{progress}\n## Current step\na\n## Next actions\nb")),
        )
    }

    /// (#1) Two compactions merged their sections; a third whose summarizer
    /// fails keeps them, with a note that the newest span went unsummarized,
    /// rather than replacing them with the no-summary placeholder.
    #[tokio::test]
    async fn a_failed_summarizer_keeps_the_earlier_model_sections() {
        let model = stub("## Progress\nFIRST and SECOND\n## Current step\na\n## Next actions\nb");
        let first = state_of(&span(6), None, 100_000, &model).await.0;
        let mut second_span = vec![first];
        second_span.extend(span(6).into_iter().skip(1));
        let second = state_of(&second_span, None, 100_000, &model).await.0;
        assert!(state_text(&second).contains("FIRST and SECOND"));

        let mut third_span = vec![second];
        third_span.extend(span(6).into_iter().skip(1));
        let (third, report) = state_of(&third_span, None, 100_000, &FailingModel).await;
        let text = state_text(&third);
        assert!(text.contains("## Progress\nFIRST and SECOND"), "{text}");
        assert!(!text.contains("summarizer could not run"), "{text}");
        assert!(text.contains("## Compaction note (1 lines)\nOnly 0 of 1 parts"), "{text}");
        assert_eq!(report.model, None, "no model wrote sections this time");
        // And they keep being carried: the next pass still has them to merge.
        let back = continuation::parse(&third).unwrap();
        assert!(back.model_sections.unwrap().contains("FIRST and SECOND"));
    }

    /// A summarizer that answers some chunks and then fails.
    struct FailsAfter {
        answered: StdMutex<usize>,
        limit: usize,
    }
    #[async_trait]
    impl ModelInvoker for FailsAfter {
        async fn invoke(
            &self,
            _request: &Value,
            _events: &mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
        ) -> Result<Value, String> {
            let mut answered = self.answered.lock().unwrap();
            if *answered >= self.limit {
                return Err("boom".into());
            }
            *answered += 1;
            Ok(json!({ "choices": [{ "message": {
                "content": format!("## Progress\nPART{}", *answered)
            } }] }))
        }
    }

    /// (#1) A failure at chunk k keeps the sections chunks 1 to k-1 wrote.
    #[tokio::test]
    async fn a_failure_part_way_keeps_the_chunks_already_summarized() {
        let mut big = vec![previous_state("EARLIER")];
        for i in 0..20 {
            big.push(json!({ "role": "assistant", "content": format!("m{i} {}", "x".repeat(8_000)) }));
        }
        let model = FailsAfter { answered: StdMutex::new(0), limit: 2 };
        let (state, report) = state_of(&big, None, 8_000, &model).await;
        let text = state_text(&state);
        assert!(text.contains("## Progress\nPART2"), "{text}");
        assert!(!text.contains("EARLIER"), "PART2 already merged the earlier sections: {text}");
        assert!(text.contains("Only 2 of "), "{text}");
        assert_eq!(report.model.as_deref(), Some("m"));
    }

    /// (#4) However long the span, the fallback makes at most `MAX_CHUNKS`
    /// requests: the chunks grow first, and past what the writer can read the
    /// long messages lose their middles, which the state says.
    #[tokio::test]
    async fn the_fallback_makes_a_bounded_number_of_requests() {
        let model = stub("## Progress\nok");
        // ~500K tokens on a 16K window: 125 chunks at the old sizing.
        let mut big = vec![json!({ "role": "user", "content": "the task" })];
        for i in 0..250 {
            big.push(json!({ "role": "assistant", "content": format!("HEAD{i} {} TAIL{i}", "x".repeat(8_000)) }));
        }
        let (state, _) = state_of(&big, None, 16_000, &model).await;
        let requests = model.requests.lock().await;
        assert!(requests.len() <= MAX_CHUNKS, "{} requests", requests.len());
        let sent: String = requests
            .iter()
            .map(|r| r["messages"][1]["content"].as_str().unwrap().to_string())
            .collect();
        for i in [0, 125, 249] {
            assert!(sent.contains(&format!("HEAD{i} ")) && sent.contains(&format!(" TAIL{i}")), "{i}");
        }
        for request in requests.iter() {
            let body = request["messages"][1]["content"].as_str().unwrap();
            assert!(body.len() <= 8_000 * 4 + 1_000, "a chunk past the writer's half: {}", body.len());
        }
        assert!(state_text(&state).contains("middle of its longest messages was clipped"));

        // A span that fits in eight larger chunks is read whole, unclipped.
        let model = stub("## Progress\nok");
        let mid: Vec<Value> = big[..60].to_vec();
        let (state, _) = state_of(&mid, None, 100_000, &model).await;
        assert!(model.requests.lock().await.len() <= MAX_CHUNKS);
        assert!(!state_text(&state).contains("clipped"));
    }

    /// A span so long that even its clip marks overflow the requests loses
    /// its oldest messages, and the state says how many, apart from the note
    /// on clipped middles: the reader must know that part was never read.
    #[tokio::test]
    async fn dropped_oldest_messages_are_reported_with_their_count() {
        let model = stub("## Progress\nok");
        let mut huge = vec![json!({ "role": "user", "content": "the task" })];
        // Each shorter than the clip mark, so none is clipped and every
        // message kept is found by its number.
        for i in 0..10_000 {
            huge.push(json!({ "role": "assistant", "content": format!("OLD{i}-{}", "y".repeat(20)) }));
        }
        let (chunks, clipped, dropped) = bounded_chunks(&huge, 8_000);
        assert!(clipped && chunks.len() <= MAX_CHUNKS);
        assert!(dropped > 0 && dropped < huge.len(), "{dropped}");
        let sent: String = chunks.concat();
        assert!(!sent.contains("OLD0-"), "the oldest message was dropped");
        assert!(sent.contains("OLD9999-"), "the newest message was kept");
        assert!(!sent.contains(&format!("OLD{}-", dropped - 2)), "message {} was dropped", dropped - 1);
        assert!(sent.contains(&format!("OLD{}-", dropped - 1)), "message {} was kept", dropped);

        let (state, _) = state_of(&huge, None, 8_000, &model).await;
        let text = state_text(&state);
        assert!(
            text.contains(&format!("The {dropped} oldest messages of the compacted span were not summarized")),
            "{text}"
        );
        assert!(text.contains("middle of its longest messages was clipped"), "{text}");

        let (_, _, none) = bounded_chunks(&span(16), 100_000);
        assert_eq!(none, 0);
    }

    /// (#4) Chunks are sized for the smol model's window when smol writes:
    /// one it cannot place is assumed small, not as large as the run's.
    #[tokio::test]
    async fn the_smol_writer_gets_chunks_its_window_holds() {
        let model = WithSmol { run: stub("## Progress\nrun"), smol: stub("## Progress\nsmol") };
        let mut big = vec![json!({ "role": "user", "content": "the task" })];
        for i in 0..30 {
            big.push(json!({ "role": "assistant", "content": format!("m{i} {}", "x".repeat(8_000)) }));
        }
        state_of(&big, None, 1_000_000, &model).await;
        let requests = model.smol.requests.lock().await;
        assert!(requests.len() > 1, "a 60K-token span is several chunks for a 32K writer");
        for request in requests.iter() {
            let body = request["messages"][1]["content"].as_str().unwrap();
            assert!(body.len() <= SMOL_FALLBACK_WINDOW as usize * 2 + 1_000, "{}", body.len());
        }
        assert_eq!(*model.run.calls.lock().unwrap(), 0);
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

    /// The sizing `/compact` tests run under: a 100K window at the default ratio.
    #[cfg(feature = "cli")]
    fn default_sizing() -> Sizing {
        Sizing::new(100_000, DEFAULT_COMPACTION_RATIO)
    }

    #[cfg(feature = "cli")]
    fn convo(n: usize) -> Vec<Value> {
        let mut v = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..n {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            v.push(json!({ "role": r, "content": format!("msg{i}") }));
        }
        v
    }

    /// `/compact` keeps the system prompt and a token-sized tail, and puts
    /// the state between them as a user message.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn compact_conversation_keeps_the_system_prompt_and_tail() {
        let model = stub("## Progress\nCONDENSED");
        let input = convo(20);
        // Each `msgN` message is 8 or 9 tokens by the preflight's rule: 36
        // holds the newest four.
        let (out, report) =
            compact_conversation(&input, "m", &model, 36, &HarnessContext::default(), default_sizing())
                .await;
        assert!(report.is_some());
        assert_eq!(out[0], input[0]);
        assert!(continuation::is_state(&out[1]));
        assert!(state_text(&out[1]).contains("CONDENSED"));
        assert_eq!(&out[2..], &input[input.len() - 4..]);

        // A conversation that fits the tail has nothing to drop.
        let (same, none) =
            compact_conversation(&convo(4), "m", &model, 1_000, &HarnessContext::default(), default_sizing())
                .await;
        assert_eq!(same, convo(4));
        assert!(none.is_none());
    }

    /// The tail is sized in tokens, not messages: eight large tool results no
    /// longer survive a `/compact` whole and overflow the next request.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn compact_conversation_sizes_its_tail_by_tokens() {
        let model = stub("## Progress\nCONDENSED");
        let mut input = convo(2);
        for i in 0..8 {
            input.push(call(&format!("t{i}")));
            input.push(result(&format!("t{i}"), 40_000));
        }
        let keep = tail_tokens(100_000);
        let (out, _) =
            compact_conversation(&input, "m", &model, keep, &HarnessContext::default(), default_sizing())
                .await;
        let kept: u64 = out[2..].iter().map(message_tokens).sum();
        assert!(kept <= 3 * keep, "kept {kept} tokens");
        assert_eq!(out.len(), 4, "the newest call and its result: {}", out.len());
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
        let state = continuation::build(&continuation::Gathered::default(), &HarnessContext::default(), Caps::user_only(10), None);
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
