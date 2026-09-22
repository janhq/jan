//! The input half of the headless stream-json channel: newline-delimited JSON
//! read from stdin while a run is in flight.
//!
//! `--output-format stream-json` (see [`super::run_report`]) made a run
//! readable by a program. On its own that is a one-way mirror: the task is
//! baked into a single string before the process starts, a gated tool call can
//! only be denied because piped stdin has no terminal to ask, and the only way
//! to stop the run is to kill it. This module is the reply path -- the same
//! `{"type": ...}` framing in the other direction.
//!
//! Three kinds, matching the three things a caller cannot say today:
//! `user` (a follow-up joined to the run in flight at the next turn boundary,
//! via the orchestration loop's existing steering handshake), `abort`, and
//! `permission` (a decision keyed to a `permission_request` already on stdout).
//! [`INPUT_KINDS`] is that set as data: the `init` record advertises it, so a
//! client learns what it may send without being told out of band.
//! A line that parses as none of them is reported as an `input_error` record
//! and skipped: the reader is a peer process's output, so one bad line must not
//! be able to end a run that is otherwise healthy.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use tokio::sync::Notify;

/// How a non-interactive run is spoken to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum InputFormat {
    /// The positional task is the whole conversation; stdin is not read.
    #[default]
    Text,
    /// Newline-delimited JSON messages on stdin, read for the run's lifetime.
    StreamJson,
}

impl InputFormat {
    pub(crate) fn is_stream_json(self) -> bool {
        matches!(self, InputFormat::StreamJson)
    }
}

/// The message kinds the input channel accepts, in the order they are
/// documented. One list, two readers: the rejection message below names them,
/// and the `init` record advertises them to a client that has not read the
/// docs. A kind added to the parser without a line here would be a capability
/// no client is told about, so a test pins the two together.
pub(crate) const INPUT_KINDS: [&str; 3] = ["user", "abort", "permission"];

/// One well-formed line from the client.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum InputMessage {
    /// A follow-up turn for the run in flight.
    User(String),
    /// Stop the run; the terminal envelope still reports what it had produced.
    Abort,
    /// The answer to a `permission_request` this run emitted.
    Permission {
        request_id: String,
        decision: PermissionDecision,
    },
}

/// One input line, as the wire shape: the three [`INPUT_KINDS`], with the fields
/// each carries. The wire shape is a serde type rather than a hand-rolled walk
/// over a `Value` so the protocol schema can be derived from it -- `jan cli
/// agent schema` publishes this shape, and a hand-written copy of it would be
/// correct only until the parser moved.
///
/// The `type` field is read separately, before deserializing: an unknown kind is
/// reported against [`INPUT_KINDS`], which is the list `init` advertises.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum InputLine {
    /// A follow-up turn for the run in flight.
    User { text: String },
    /// Stop the run; the terminal envelope still reports what it had produced.
    Abort,
    /// The answer to a `permission_request` this run emitted.
    Permission {
        request_id: String,
        decision: InputDecision,
    },
}

/// The decisions a client may answer a `permission_request` with: the wire
/// vocabulary, which [`parse_input_line`] maps onto the tool gate's own enum.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InputDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

impl From<InputDecision> for PermissionDecision {
    fn from(decision: InputDecision) -> Self {
        match decision {
            InputDecision::AllowOnce => PermissionDecision::AllowOnce,
            InputDecision::AllowAlways => PermissionDecision::AllowAlways,
            InputDecision::Deny => PermissionDecision::Deny,
        }
    }
}

/// Parse one NDJSON line. The error is what the client is told on the stream,
/// so it names the offending value rather than just the expected shape.
pub(crate) fn parse_input_line(line: &str) -> Result<InputMessage, String> {
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("not JSON: {e}"))?;
    let Some(kind) = value.get("type").and_then(|v| v.as_str()) else {
        return Err("missing string field 'type'".to_string());
    };
    if !INPUT_KINDS.contains(&kind) {
        return Err(format!(
            "unknown type '{kind}' ({})",
            INPUT_KINDS.join(", ")
        ));
    }
    match serde_json::from_value::<InputLine>(value).map_err(|e| e.to_string())? {
        InputLine::User { text } => {
            if text.trim().is_empty() {
                return Err("'user' text is empty".to_string());
            }
            Ok(InputMessage::User(text))
        }
        InputLine::Abort => Ok(InputMessage::Abort),
        InputLine::Permission {
            request_id,
            decision,
        } => Ok(InputMessage::Permission {
            request_id,
            decision: decision.into(),
        }),
    }
}

/// A rejected input line, reported on stdout. Deliberately *not* a
/// [`StreamEvent::Error`](crate::core::agent::events::StreamEvent::Error): the
/// report folds that into the run's outcome, so a typo in one line would mark
/// an otherwise successful run as failed.
#[derive(serde::Serialize, schemars::JsonSchema)]
pub(crate) struct InputErrorRecord<'a> {
    /// The record's tag. A consumer switches on it, so the schema states the
    /// value rather than leaving it an open string.
    #[serde(rename = "type")]
    #[schemars(extend("const" = "input_error"))]
    kind: &'static str,
    message: &'a str,
    /// The line that was rejected, so the client can match it to what it wrote.
    line: &'a str,
}

impl<'a> InputErrorRecord<'a> {
    pub(crate) fn new(message: &'a str, line: &'a str) -> Self {
        Self {
            kind: "input_error",
            message,
            line,
        }
    }
}

/// What the reader task and the run share: the queue the steering handshake
/// drains, and the abort latch the run selects on.
#[derive(Default)]
pub(crate) struct StreamInput {
    queued: Mutex<VecDeque<serde_json::Value>>,
    aborted: AtomicBool,
    abort: Notify,
    gone: AtomicBool,
}

impl StreamInput {
    pub(crate) fn queue_user(&self, text: String) {
        self.lock()
            .push_back(serde_json::json!({ "role": "user", "content": text }));
    }

    /// Hand the queue to a steering handshake. Empty is the normal answer: the
    /// loop asks at every turn boundary whether anything is waiting.
    pub(crate) fn take_queued(&self) -> Vec<serde_json::Value> {
        self.lock().drain(..).collect()
    }

    /// A std mutex is enough because nothing awaits while it is held, and it
    /// keeps `queue_user` callable from the reader without an await point.
    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<serde_json::Value>> {
        self.queued.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The reader has stopped, so nothing on stdin can answer a permission
    /// request any more. Latched rather than signalled: the question is asked
    /// once per request, at whatever point in the run it arrives.
    pub(crate) fn mark_client_gone(&self) {
        self.gone.store(true, Ordering::SeqCst);
    }

    pub(crate) fn client_gone(&self) -> bool {
        self.gone.load(Ordering::SeqCst)
    }

    pub(crate) fn abort(&self) {
        self.aborted.store(true, Ordering::SeqCst);
        self.abort.notify_waiters();
    }

    /// Resolve once the client has asked to stop. Parks forever otherwise, so
    /// it is safe as a `select!` arm for the whole run.
    pub(crate) async fn aborted(&self) {
        // The latch is checked first: an abort that arrived before this future
        // was polled has already fired its notification and would be missed.
        if self.aborted.load(Ordering::SeqCst) {
            return;
        }
        self.abort.notified().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_message_kinds_parse() {
        assert_eq!(
            parse_input_line(r#"{"type":"user","text":"also check the tests"}"#).unwrap(),
            InputMessage::User("also check the tests".to_string())
        );
        assert_eq!(
            parse_input_line(r#"{"type":"abort"}"#).unwrap(),
            InputMessage::Abort
        );
        assert_eq!(
            parse_input_line(
                r#"{"type":"permission","request_id":"perm-1","decision":"allow_once"}"#
            )
            .unwrap(),
            InputMessage::Permission {
                request_id: "perm-1".to_string(),
                decision: PermissionDecision::AllowOnce,
            }
        );
    }

    /// The advertised kinds and the accepted ones are one list. A kind the
    /// parser takes but the handshake never names is a capability no client can
    /// discover; one it names but cannot parse is a lie a client acts on. The
    /// `panic!` arm is the prompt to add a sample line when the list grows.
    #[test]
    fn the_advertised_kinds_are_the_accepted_ones() {
        let err = parse_input_line(r#"{"type":"steer","text":"hi"}"#).expect_err("unknown type");
        for kind in INPUT_KINDS {
            assert!(
                err.contains(kind),
                "the rejection does not name '{kind}': {err}"
            );
            let line = match kind {
                "user" => r#"{"type":"user","text":"hello"}"#,
                "abort" => r#"{"type":"abort"}"#,
                "permission" => r#"{"type":"permission","request_id":"p1","decision":"deny"}"#,
                other => panic!("'{other}' is advertised but has no sample line here"),
            };
            assert!(
                parse_input_line(line).is_ok(),
                "'{kind}' is advertised in init but the parser rejects it"
            );
        }
    }

    /// Every rejection names what was wrong: the client sees this text on the
    /// stream and has nothing else to debug against.
    #[test]
    fn malformed_lines_are_rejected_with_a_reason() {
        for (line, marker) in [
            ("not json at all", "not JSON"),
            (r#"{"text":"hi"}"#, "missing string field 'type'"),
            (r#"{"type":"steer","text":"hi"}"#, "unknown type 'steer'"),
            (r#"{"type":"user"}"#, "missing field `text`"),
            (r#"{"type":"user","text":"  "}"#, "is empty"),
            (r#"{"type":"permission","decision":"deny"}"#, "missing field `request_id`"),
            (r#"{"type":"permission","request_id":"p"}"#, "missing field `decision`"),
            (
                r#"{"type":"permission","request_id":"p","decision":"maybe"}"#,
                "unknown variant `maybe`, expected one of `allow_once`, `allow_always`, `deny`",
            ),
        ] {
            let err = parse_input_line(line).expect_err(line);
            assert!(err.contains(marker), "{line}: {err} lacks {marker}");
        }
    }

    #[test]
    fn queued_turns_drain_once_and_in_order() {
        let input = StreamInput::default();
        assert!(input.take_queued().is_empty());
        input.queue_user("first".to_string());
        input.queue_user("second".to_string());
        let drained = input.take_queued();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0]["role"], "user");
        assert_eq!(drained[0]["content"], "first");
        assert_eq!(drained[1]["content"], "second");
        assert!(input.take_queued().is_empty());
    }

    /// The latch, not just the notification: an abort landing before the run
    /// parks on it must still be seen, or the client's stop is swallowed.
    #[tokio::test]
    async fn an_abort_that_arrives_early_is_still_observed() {
        let input = StreamInput::default();
        input.abort();
        input.aborted().await;
    }
}
