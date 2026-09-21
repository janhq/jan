//! The canonical transcript: what happened, and the request it projects to.
//!
//! Jan used to keep one message list and give it three jobs at once - it was
//! the wire request, the stored transcript, and the thing compaction rewrote.
//! Compaction therefore *replaced* history: the span it summarized was gone
//! from every one of them, so a user asking "what exactly did that command
//! print two hours ago" got the summary's paraphrase, and no later turn could
//! re-derive the prefix that a different provider, a resumed session, or a
//! changed `keep_recent` would need.
//!
//! This module splits the three jobs:
//!
//! ```text
//!   Transcript (append-only)          the record: events, never rewritten
//!        |
//!        | project(&Projection)       pure: same record + same options = same bytes
//!        v
//!   Vec<Value> (the wire request)     placed prompt + history + summarized spans
//! ```
//!
//! Three rules hold it together:
//!
//! - **The record is append-only.** Every mutator pushes; nothing removes or
//!   edits an event. A compaction point is a *boundary*, not a deletion: the
//!   events it stands in for stay in the record, and `project` is what omits
//!   them.
//! - **The wire shape is projection-owned.** Where the stable prompt sits, how
//!   a changed prompt lands behind the history instead of rewriting the head
//!   (see [`crate::core::agent::upstream::set_system_prompt`]), how the per-turn
//!   block lands below the accepted history rather than in a system slot ahead
//!   of it (see [`crate::core::agent::upstream::append_prompt_tail`]), and
//!   whether a prior turn's reasoning is resent are all parameters of
//!   [`Projection`], not edits to the record.
//! - **`project` is pure.** Two calls over an unchanged record with the same
//!   options produce byte-identical output, which is the property the
//!   prefix-stability suite asserts against.

use serde_json::Value;

use crate::core::agent::compaction::is_compaction_summary;
use crate::core::agent::r#loop::strip_assistant_reasoning;
use crate::core::agent::reminder;
use crate::core::agent::upstream::{
    append_prompt_tail, drop_malformed_tool_calls, drop_orphaned_tool_results, is_system_node,
    repair_dangling_tool_calls, set_system_prompt,
};

/// One thing that happened, in the order it happened.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Event {
    /// A wire message as it entered the conversation.
    Message(Value),
    /// A stable system prompt, in the order it was applied. The first one is
    /// the request's head; a later one is appended behind the history so the
    /// bytes an earlier request already sent are left alone.
    Prompt(String),
    /// Per-turn context that has no turn of its own: a background notice, a
    /// todo nudge. Folded into the trailing message at projection time (see
    /// [`crate::core::agent::reminder::attach`]) rather than recorded as one,
    /// so the record keeps what actually arrived.
    Reminder(String),
    /// A summary standing in for every event recorded before it. `covers` is
    /// the record index the kept tail begins at - a projection boundary, not a
    /// deletion: the events before it are still in the record.
    Compaction { summary: Value, covers: usize },
}

/// The record of a session.
#[derive(Debug, Clone, Default)]
pub(crate) struct Transcript {
    events: Vec<Event>,
}

/// What the wire needs that is not in the record.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Projection<'a> {
    /// The per-turn context block (today's date, query-specific memory recall,
    /// plan/todo state), plus any composition block `[prompt]` moved below the
    /// cache line. Per-turn by nature: it is appended behind the accepted
    /// history, so changing it cannot disturb the bytes in front of it -- which
    /// is exactly what the stable prompt (and the prefix cached behind it) is
    /// there to protect.
    pub volatile_system: Option<&'a str>,
    /// Resend a prior assistant turn's `reasoning_content`. `false` is a
    /// provider capability answer ("this route rejects the field"), so it
    /// belongs here rather than in the record: the turn that discovered it
    /// must not destroy the reasoning the next route might accept.
    pub send_reasoning: bool,
}

/// A compaction waiting to be recorded: what to summarize, and how much of the
/// record the summary will stand in for.
#[derive(Debug, Clone)]
pub(crate) struct CompactionPlan {
    /// The wire messages to hand the summarizer, in order.
    pub summarize: Vec<Value>,
    /// Record index the kept tail begins at, i.e. the number of events the
    /// summary covers.
    pub covers: usize,
}

impl Transcript {
    /// Adopt a history that came from outside (a client's stored thread, a
    /// caller's request body).
    ///
    /// This is the one boundary every incoming message array passes through,
    /// so it is where the record heals: a tool call a truncated stream left
    /// with unparsable arguments is refused entry, the result it orphaned goes
    /// with it, a result whose call is not in the history at all is dropped,
    /// and a surviving call that lost its result gets the synthetic error
    /// reply. Every one of those shapes wedges a session - providers 422 the
    /// whole request - and healing here means the record only ever holds turns
    /// a strict upstream accepts.
    ///
    /// Two kinds of node are then read rather than recorded verbatim:
    ///
    /// - a stable prompt node becomes a [`Event::Prompt`], so the projection
    ///   places it the way the live list did (head, or appended behind the
    ///   history when it changed);
    /// - the per-turn block in its slot is dropped: it is projection input,
    ///   regenerated from the current turn, and recording it would accumulate
    ///   yesterday's date in the history.
    ///
    /// A compaction summary is neither: it is history under the `system` role,
    /// and it stays.
    pub(crate) fn from_history(mut messages: Vec<Value>) -> Self {
        let poisoned = drop_malformed_tool_calls(&mut messages);
        if poisoned > 0 {
            log::warn!("agent: dropped {poisoned} unusable tool call(s) from history");
        }
        let orphaned = drop_orphaned_tool_results(&mut messages);
        if orphaned > 0 {
            log::warn!("agent: dropped {orphaned} tool result(s) whose call is not in the history");
        }
        let repaired = repair_dangling_tool_calls(&mut messages);
        if repaired > 0 {
            log::warn!("agent: repaired {repaired} dangling tool call(s) with no prior result");
        }

        let volatile = volatile_index(&messages);
        let mut events = Vec::with_capacity(messages.len());
        for (index, message) in messages.into_iter().enumerate() {
            if Some(index) == volatile {
                continue;
            }
            events.push(
                if is_system_node(&message) && !is_compaction_summary(&message) {
                    match message.get("content").and_then(|c| c.as_str()) {
                        Some(text) => Event::Prompt(text.to_string()),
                        None => Event::Message(message),
                    }
                } else {
                    Event::Message(message)
                },
            );
        }
        Self { events }
    }

    /// Append a wire message (a user turn, an assistant turn, a tool result).
    pub(crate) fn record_message(&mut self, message: Value) {
        self.events.push(Event::Message(message));
    }

    /// Append a stable system prompt. Recording the same text twice is
    /// harmless: the projection deduplicates it the way the live list did.
    pub(crate) fn record_prompt(&mut self, text: &str) {
        self.events.push(Event::Prompt(text.to_string()));
    }

    /// Append per-turn context to be folded into the trailing message.
    pub(crate) fn record_reminder(&mut self, text: &str) {
        self.events.push(Event::Reminder(text.to_string()));
    }

    /// Record a compaction point: `summary` stands in for the first `covers`
    /// events, which stay in the record.
    pub(crate) fn record_compaction(&mut self, summary: Value, covers: usize) {
        debug_assert!(covers <= self.events.len(), "covers must be a record index");
        self.events.push(Event::Compaction {
            summary,
            covers: covers.min(self.events.len()),
        });
    }

    /// The record, in order. Read by the tests that assert nothing recorded is
    /// ever lost, and by callers that need the pre-compaction span.
    #[cfg(test)]
    pub(crate) fn events(&self) -> &[Event] {
        &self.events
    }

    /// How many events the summary of the latest compaction point stands in
    /// for, i.e. where its projection begins.
    fn boundary(&self) -> usize {
        self.events
            .iter()
            .rev()
            .find_map(|event| match event {
                Event::Compaction { covers, .. } => Some(*covers),
                _ => None,
            })
            .unwrap_or(0)
    }

    /// The record's contribution to the request, before the prompt is placed:
    /// every event the boundary does not cover, in order, with the record index
    /// each message came from.
    ///
    /// The index is what lets a compaction boundary computed over *messages*
    /// (which is where the tool-pairing rule lives) be written back as a
    /// *record* index.
    fn conversation(&self) -> (Vec<Value>, Vec<usize>) {
        let boundary = self.boundary();
        let mut messages = Vec::with_capacity(self.events.len());
        let mut sources = Vec::with_capacity(self.events.len());
        // The summary stands at the head of the range it covers. A compaction
        // point is recorded *after* the tail it kept - the tail was already in
        // the record - so its position in the record is not its position in the
        // projection.
        if let Some(summary) = self.latest_summary() {
            messages.push(summary.clone());
            sources.push(boundary);
        }
        for (index, event) in self.events.iter().enumerate().skip(boundary) {
            match event {
                Event::Message(message) => {
                    messages.push(message.clone());
                    sources.push(index);
                }
                Event::Reminder(text) => {
                    // `attach` may append to the message already there or push
                    // one of its own; either way everything it wrote came from
                    // this event, so the boundary can land on it.
                    reminder::attach(&mut messages, text);
                    sources.resize(messages.len(), index);
                }
                Event::Prompt(_) | Event::Compaction { .. } => {}
            }
        }
        (messages, sources)
    }

    /// The summary of the most recent compaction point. Earlier ones are inside
    /// the range it covers, and it was summarized from a projection that
    /// already carried them.
    fn latest_summary(&self) -> Option<&Value> {
        self.events.iter().rev().find_map(|event| match event {
            Event::Compaction { summary, .. } => Some(summary),
            _ => None,
        })
    }

    /// Prompts remain active even when compaction covers the conversation
    /// around them. The initial prompt is recorded after the incoming history,
    /// and later updates can occur anywhere, so retain all covered prompts in
    /// their original order rather than only a leading run of prompt events.
    fn prompts_before(&self, boundary: usize) -> impl Iterator<Item = &str> {
        self.events
            .iter()
            .take(boundary)
            .filter_map(|event| match event {
                Event::Prompt(text) => Some(text.as_str()),
                _ => None,
            })
    }

    /// The request this record projects to. Pure: same record, same options,
    /// same bytes.
    pub(crate) fn project(&self, projection: &Projection<'_>) -> Vec<Value> {
        let boundary = self.boundary();
        let mut out = Vec::with_capacity(self.events.len() + 1);

        for text in self.prompts_before(boundary) {
            set_system_prompt(&mut out, text);
        }

        if let Some(summary) = self.latest_summary() {
            out.push(summary.clone());
        }

        for event in self.events.iter().skip(boundary) {
            match event {
                Event::Message(message) => out.push(message.clone()),
                Event::Reminder(text) => reminder::attach(&mut out, text),
                Event::Prompt(text) => set_system_prompt(&mut out, text),
                // Already emitted ahead of the range it covers.
                Event::Compaction { .. } => {}
            }
        }
        // Last, and only once: everything the record holds was accepted by an
        // earlier request (or is about to be sent), so this turn's block goes
        // after all of it.
        self.place_volatile(&mut out, projection);

        if !projection.send_reasoning {
            out = strip_assistant_reasoning(&out);
        }
        out
    }

    /// Put this turn's block below the accepted history.
    ///
    /// Not in a `system` node behind the stable prompt: the provider bridge
    /// hoists system-role content into the request's system field, ahead of the
    /// conversation, so a block that changes per turn (the date at midnight,
    /// the memory recalled for this query) would invalidate every message the
    /// previous request already sent. It takes the shape a mid-run reminder
    /// does -- marked `user` guidance appended at the tail -- which leaves the
    /// accepted bytes untouched. A run with no stable prompt has no head to
    /// cache, so the block is simply the last thing in the request.
    fn place_volatile(&self, out: &mut Vec<Value>, projection: &Projection<'_>) {
        let Some(text) = projection.volatile_system.filter(|text| !text.is_empty()) else {
            return;
        };
        append_prompt_tail(out, text);
    }

    /// What a compaction would summarize, and how far into the record its
    /// summary would reach. `None` when there is nothing safe to drop, which is
    /// how the caller detects a no-op instead of retrying.
    ///
    /// The boundary itself is computed by
    /// [`crate::core::agent::compaction::tail_start`] over the messages, where
    /// the tool-pairing rule lives.
    pub(crate) fn compaction_plan(&self, keep_recent: usize) -> Option<CompactionPlan> {
        let (messages, sources) = self.conversation();
        if messages.len() <= keep_recent {
            return None;
        }
        let cut =
            crate::core::agent::compaction::tail_start(&messages, messages.len() - keep_recent)?;
        Some(CompactionPlan {
            // Only the conversation is summarized: the prompt is not history,
            // it is placed around it.
            summarize: messages[..cut].to_vec(),
            covers: sources[cut],
        })
    }
}

/// Index of the per-turn block in a history that came from outside, if it has
/// one: the slot the prompt writer owns, i.e. index 1 once a system node holds
/// index 0. A summary that happens to occupy the slot is history, not a block.
fn volatile_index(messages: &[Value]) -> Option<usize> {
    let slot = usize::from(messages.first().is_some_and(is_system_node));
    messages
        .get(slot)
        .filter(|message| is_system_node(message) && !is_compaction_summary(message))
        .map(|_| slot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn convo(turns: usize) -> Vec<Value> {
        (0..turns)
            .map(|i| {
                json!({
                    "role": if i % 2 == 0 { "user" } else { "assistant" },
                    "content": format!("message {i}"),
                })
            })
            .collect()
    }

    fn nothing() -> Projection<'static> {
        Projection {
            volatile_system: None,
            send_reasoning: true,
        }
    }

    /// The property the prefix-stability suite leans on: projecting the same
    /// record twice produces the same bytes, so a request that changed nothing
    /// cannot invalidate its own prefix.
    #[test]
    fn projecting_twice_yields_byte_identical_output() {
        let mut transcript = Transcript::from_history(convo(6));
        transcript.record_prompt("you are a careful agent");
        transcript.record_message(json!({"role": "user", "content": "and now?"}));
        transcript.record_reminder("Reminder: 2 todos are still open.");
        let projection = Projection {
            volatile_system: Some("Today's date is 2026-09-18."),
            send_reasoning: true,
        };
        let first = transcript.project(&projection);
        let second = transcript.project(&projection);
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
    }

    /// A compaction point omits the span it stands in for without deleting it:
    /// the projection carries the summary and the kept tail, and the record
    /// still holds every message the summary replaced.
    #[test]
    fn a_compaction_point_keeps_the_span_it_replaced() {
        let mut transcript = Transcript::from_history(convo(20));
        let plan = transcript
            .compaction_plan(4)
            .expect("20 messages are worth compacting");
        assert_eq!(plan.summarize.len(), 16);
        transcript.record_compaction(
            json!({"role": "system", "content": "[Summary] they talked about 0..15"}),
            plan.covers,
        );

        let projected = transcript.project(&nothing());
        assert_eq!(
            projected[0]["content"], "[Summary] they talked about 0..15",
            "the summary stands at the head of the history: {projected:?}"
        );
        assert_eq!(
            projected.len(),
            1 + (20 - plan.summarize.len()),
            "the kept tail follows the summary: {projected:?}"
        );
        assert_eq!(
            projected[1]["content"],
            format!("message {}", plan.summarize.len()),
            "the tail begins where the summary stops: {projected:?}"
        );

        // ...and nothing the summary covers left the record.
        let recorded: Vec<&Value> = transcript
            .events()
            .iter()
            .filter_map(|event| match event {
                Event::Message(message) => Some(message),
                _ => None,
            })
            .collect();
        assert_eq!(recorded.len(), 20);
        for (index, message) in recorded.iter().take(16).enumerate() {
            assert_eq!(message["content"], format!("message {index}"));
        }
    }

    /// The adoption boundary heals the shape no other pass can see: a
    /// `role: "tool"` result whose call is not in the history at all. A strict
    /// upstream rejects the whole request over that one orphan, so the record
    /// must never take it in.
    #[test]
    fn from_history_drops_a_tool_result_whose_call_is_not_there() {
        let transcript = Transcript::from_history(vec![
            json!({ "role": "user", "content": "carry on" }),
            json!({ "role": "tool", "tool_call_id": "call_gone", "content": "left behind" }),
            json!({ "role": "assistant", "content": "as you asked" }),
        ]);

        let projected = transcript.project(&nothing());
        assert_eq!(
            projected.len(),
            2,
            "the orphaned result never reaches the wire: {projected:?}"
        );
        assert_eq!(projected[0]["content"], "carry on");
        assert_eq!(projected[1]["content"], "as you asked");
    }

    /// The reasoning retry is a projection option: a route that rejects the
    /// field changes what goes on the wire, not what was recorded.
    #[test]
    fn dropping_reasoning_is_a_projection_option_not_a_record_edit() {
        let mut transcript = Transcript::default();
        transcript.record_message(json!({
            "role": "assistant",
            "content": "the answer",
            "reasoning_content": "the thinking",
        }));

        let sent = transcript.project(&nothing());
        assert_eq!(sent[0]["reasoning_content"], "the thinking");

        let stripped = transcript.project(&Projection {
            volatile_system: None,
            send_reasoning: false,
        });
        assert!(stripped[0].get("reasoning_content").is_none());
        assert_eq!(stripped[0]["content"], "the answer");

        // A later route that accepts the field gets it back: the record kept it.
        let again = transcript.project(&nothing());
        assert_eq!(again[0]["reasoning_content"], "the thinking");
    }

    /// A reminder takes no turn of its own on the wire, but it is still an
    /// event: the record keeps it, the projection folds it into the message it
    /// belongs to.
    #[test]
    fn reminders_are_recorded_and_folded_at_projection_time() {
        let mut transcript = Transcript::default();
        transcript.record_message(json!({"role": "user", "content": "hello"}));
        transcript.record_reminder("Reminder: 1 todo is still open.");

        let projected = transcript.project(&nothing());
        assert_eq!(projected.len(), 1, "no extra turn: {projected:?}");
        let content = projected[0]["content"].as_str().unwrap();
        assert!(content.starts_with("hello"), "{content}");
        assert!(
            content.contains("Reminder: 1 todo is still open."),
            "{content}"
        );

        assert_eq!(
            transcript.events().len(),
            2,
            "both events are in the record"
        );
    }

    /// A history from outside carries the previous turn's blocks: the stable
    /// prompt is read back as a `Prompt` event (so it is placed the same way),
    /// the per-turn block is not recorded at all (it is regenerated), and a
    /// compaction summary stays as history.
    #[test]
    fn from_history_splits_the_previous_turns_wire_shape() {
        let summary = format!("{} stuff", crate::core::agent::compaction::SUMMARY_MARKER);
        let history = vec![
            json!({"role": "system", "content": "stable prompt"}),
            json!({"role": "system", "content": "Today's date is 2026-09-17."}),
            json!({"role": "system", "content": summary}),
            json!({"role": "user", "content": "carry on"}),
        ];
        let transcript = Transcript::from_history(history);
        assert_eq!(
            transcript.events()[0],
            Event::Prompt("stable prompt".to_string())
        );
        assert_eq!(
            transcript.events().len(),
            3,
            "the per-turn block is not history"
        );
        assert_eq!(
            transcript.events()[1],
            Event::Message(json!({
                "role": "system",
                "content": summary,
            }))
        );

        let projected = transcript.project(&Projection {
            volatile_system: Some("Today's date is 2026-09-18."),
            send_reasoning: true,
        });
        assert_eq!(projected[0]["content"], "stable prompt");
        assert_eq!(
            projected[1]["content"], summary,
            "a compaction summary is history, not a per-turn block"
        );
        assert_eq!(projected[2]["content"], "carry on");
        assert_eq!(
            projected[3],
            json!({
                "role": "user",
                "content": crate::core::agent::reminder::wrap(
                    "Today's date is 2026-09-18."
                ),
            }),
            "the current block, below the history, not yesterday's: {projected:?}"
        );
        assert_eq!(projected.len(), 4, "{projected:?}");
    }

    /// Equivalence with the live-list placement this replaced: a history and a
    /// changed prompt produce the same bytes the `set_system_prompt` +
    /// `append_prompt_tail` pair does.
    #[test]
    fn the_projection_places_the_prompt_like_the_live_list_did() {
        let history = vec![
            json!({"role": "system", "content": "old prompt"}),
            json!({"role": "system", "content": "Today's date is 2026-09-17."}),
            json!({"role": "user", "content": "hi"}),
            json!({"role": "assistant", "content": "hello"}),
        ];

        // The live list as a turn would build it: the previous per-turn block
        // is not carried forward (the projection regenerates it), the prompt is
        // updated in place by `set_system_prompt`, and this turn's block is
        // appended behind the accepted history.
        let mut live = vec![
            json!({"role": "system", "content": "old prompt"}),
            json!({"role": "user", "content": "hi"}),
            json!({"role": "assistant", "content": "hello"}),
        ];
        set_system_prompt(&mut live, "new prompt");
        append_prompt_tail(&mut live, "Today's date is 2026-09-18.");

        let mut transcript = Transcript::from_history(history);
        transcript.record_prompt("new prompt");
        let projected = transcript.project(&Projection {
            volatile_system: Some("Today's date is 2026-09-18."),
            send_reasoning: true,
        });

        assert_eq!(
            serde_json::to_string(&projected).unwrap(),
            serde_json::to_string(&live).unwrap()
        );
    }

    /// The record only ever grows: recording does not reorder or rewrite what
    /// is already there.
    #[test]
    fn the_record_is_append_only() {
        let mut transcript = Transcript::from_history(convo(4));
        let before = transcript.events().to_vec();
        transcript.record_prompt("prompt");
        transcript.record_message(json!({"role": "user", "content": "more"}));
        transcript.record_reminder("Reminder: look");
        transcript.record_compaction(json!({"role": "system", "content": "summary"}), 2);

        let after = transcript.events();
        assert_eq!(&after[..before.len()], before.as_slice());
        assert_eq!(after.len(), before.len() + 4);
    }

    #[test]
    fn compaction_preserves_a_prompt_recorded_after_the_first_user_turn() {
        let mut transcript =
            Transcript::from_history(vec![json!({"role": "user", "content": "start"})]);
        transcript.record_prompt("Follow the project instructions.");
        for message in convo(12) {
            transcript.record_message(message);
        }
        let projection = Projection {
            volatile_system: Some("Today's date is 2026-09-21."),
            send_reasoning: true,
        };
        let before = transcript.project(&projection);
        let plan = transcript.compaction_plan(4).unwrap();
        transcript.record_compaction(
            crate::core::agent::compaction::summary_message("earlier work"),
            plan.covers,
        );

        let after = transcript.project(&projection);
        assert_eq!(after[0], before[0], "compaction must retain the prompt");
        assert!(is_compaction_summary(&after[1]));
        // Everything after the summary is the kept tail plus this turn's block,
        // both of which `before` ends with: compaction changes which messages
        // are dropped, not where the per-turn block sits.
        assert_eq!(&after[2..], &before[before.len() - 5..]);
    }

    #[test]
    fn compaction_preserves_prompt_updates_across_successive_boundaries() {
        let mut transcript = Transcript::from_history(vec![
            json!({"role": "system", "content": "Original instructions."}),
            json!({"role": "user", "content": "start"}),
        ]);
        transcript.record_prompt("Updated instructions take precedence.");
        for message in convo(12) {
            transcript.record_message(message);
        }
        let projection = Projection {
            volatile_system: Some("Today's date is 2026-09-21."),
            send_reasoning: true,
        };
        let before = transcript.project(&projection);
        let expected: Vec<&Value> = before.iter().filter(|m| is_system_node(m)).collect();

        for keep_recent in [8, 4] {
            let plan = transcript.compaction_plan(keep_recent).unwrap();
            transcript.record_compaction(
                crate::core::agent::compaction::summary_message("earlier work"),
                plan.covers,
            );
            let after = transcript.project(&projection);
            let prompts: Vec<&Value> = after
                .iter()
                .filter(|m| is_system_node(m) && !is_compaction_summary(m))
                .collect();
            assert_eq!(
                prompts, expected,
                "prompt precedence must survive compaction"
            );
        }
    }

    /// Nothing safe to drop means no compaction: a short history reports no
    /// plan rather than a summary of itself.
    #[test]
    fn a_short_history_has_no_compaction_plan() {
        let transcript = Transcript::from_history(convo(4));
        assert!(transcript.compaction_plan(8).is_none());
    }

    /// A second compaction covers more of the record than the first, and the
    /// first summary is still in the record behind it.
    #[test]
    fn a_second_compaction_extends_the_boundary() {
        let mut transcript = Transcript::from_history(convo(30));
        let first = transcript.compaction_plan(8).unwrap();
        transcript.record_compaction(json!({"role": "system", "content": "first"}), first.covers);
        let second = transcript.compaction_plan(4).unwrap();
        assert!(
            second.covers > first.covers,
            "the boundary moves forward: {} then {}",
            first.covers,
            second.covers
        );
        transcript.record_compaction(
            json!({"role": "system", "content": "second"}),
            second.covers,
        );

        let projected = transcript.project(&nothing());
        assert_eq!(projected[0]["content"], "second");
        let summaries = transcript
            .events()
            .iter()
            .filter(|event| matches!(event, Event::Compaction { .. }))
            .count();
        assert_eq!(summaries, 2, "both points are in the record");
    }
}
