//! Conformance suite for the host-tool / embedded-session contract
//! (jan-internal#368).
//!
//! That issue defines the contract the Jan Agent SDKs are written against: two
//! message tables, a requirement per row with the consumer code that proves it,
//! and an acceptance test that already runs it (Robot Studio swaps a worker and
//! keeps every test). Step 1 of its order of work is this suite, written before
//! the SDK exists because it is the acceptance test the later steps have to
//! satisfy.
//!
//! Two rules shape it:
//!
//! 1. **Nothing is asserted against a mock.** A row conforms only if the real
//!    parser accepts the real contract line, or the real event type deserializes
//!    the real contract message.
//! 2. **A missing row is asserted missing.** Every row this build does not
//!    implement is checked to be *refused*, so a row that lands without this
//!    table moving turns the suite red. That is what stops the table from
//!    claiming coverage the build does not have, which is the only failure mode
//!    a conformance suite actually has.
//!
//! The probes are type-correct by construction: each row carries sample values
//! for the fields the contract requires, because a probe of `null`s fails to
//! deserialize *even once the row is implemented* and would let the table rot
//! without a red test.
//!
//! Transcribed from #368's "Host -> session" and "Session -> host" tables plus
//! its "fields the mapping must not lose" table. The contract as written, not as
//! this build implements it.
//!
//! The one thing this module deliberately does not re-assert is that
//! `INPUT_KINDS` and the parser agree: `stream_input`'s own
//! `the_advertised_kinds_are_the_accepted_ones` pins that, in both directions
//! and with a sample line per kind, so a second copy here would be weaker
//! coverage that reads like more.

use super::stream_input::InputMessage;
use crate::core::agent::events::StreamEvent;

/// One row of "Host -> session".
struct InputRow {
    /// The `type` the contract names.
    contract: &'static str,
    /// The `type` this build accepts for the same job today, if it has one.
    here: Option<&'static str>,
    /// The contract's payload fields, as `(key, sample JSON)`.
    fields: &'static [(&'static str, &'static str)],
}

/// One row of "Session -> host".
struct OutputRow {
    contract: &'static str,
    /// The event tag this build emits for the same job today, if it has one.
    here: Option<&'static str>,
    /// Every field the contract says the message carries, as
    /// `(key, sample JSON)`. For a row this build does not implement these build
    /// the probe. For one it does, they are the contract's requirement written
    /// down next to what is produced, so the gap is readable rather than
    /// inferred; the assertion that holds the implementation to a field list is
    /// [`build_produces`](Self::build_produces).
    contract_requires: &'static [(&'static str, &'static str)],
    /// What this build actually produces under `here`, asserted *exactly*:
    /// adding or dropping a field is a failure until this table moves, because
    /// either one changes what a client reads.
    build_produces: &'static [&'static str],
    /// The subset of `build_produces` that is on the message only when it
    /// carries a value (`skip_serializing_if`). Such a field is invisible in a
    /// sample that leaves it empty and is still on the wire for a client, so
    /// naming it in `build_produces` alone would be a claim nothing checks. The
    /// exactness test samples each row twice - once with every field empty, once
    /// with every field set - and requires the difference between the two to be
    /// exactly this list, so it cannot drift from the type.
    optional: &'static [&'static str],
}

/// What a host sends the session, in the contract's order.
///
/// `prompt` and this build's `user` are deliberately *not* one row. `prompt`
/// starts a turn and is refused while one is running; `user` is a follow-up
/// joined at the next turn boundary. They share no rule, so mapping one onto the
/// other would claim a conformance that does not exist.
const HOST_TO_SESSION: &[InputRow] = &[
    InputRow {
        contract: "prompt",
        here: None,
        fields: &[("text", "\"look at the arm\"")],
    },
    InputRow {
        contract: "abort",
        here: Some("abort"),
        fields: &[],
    },
    InputRow {
        contract: "set_model",
        here: None,
        fields: &[
            ("provider", "\"anthropic\""),
            ("model", "\"claude-sonnet-4-5\""),
        ],
    },
    InputRow {
        contract: "set_code_enabled",
        here: None,
        fields: &[("enabled", "true")],
    },
    InputRow {
        contract: "clear_history",
        here: None,
        fields: &[],
    },
    InputRow {
        contract: "tool_result",
        here: Some("tool_result"),
        // The contract answers with the tool's own `result` JSON under the
        // request's `id`; this build takes `request_id` with a `content` string
        // and an `is_error` flag, the shape a model tool message takes.
        fields: &[("id", "\"call-7\""), ("result", "{\"ok\":true}")],
    },
];

/// What the session sends the host, in the contract's order.
const SESSION_TO_HOST: &[OutputRow] = &[
    OutputRow {
        contract: "ready",
        here: Some("init"),
        // R5 compares `tool_specs` for value equality and R8 filters `models`
        // to the ones that accept images. `tool_specs` travels with the
        // handshake, but only when the run advertises a host tool; `models` does
        // not, and `provider` does not either: a client cannot tell which
        // provider answered.
        contract_requires: &[
            ("model", "\"claude-sonnet-4-5\""),
            ("provider", "\"anthropic\""),
            ("models", "[]"),
            ("tools", "[]"),
            ("tool_specs", "[]"),
        ],
        build_produces: &[
            "protocol_version",
            "session_id",
            "model",
            "cwd",
            "tools",
            "tool_specs",
            "input_kinds",
            "input_content_parts",
        ],
        // Skipped when the run advertises no host tool, so an ordinary run's
        // handshake is unchanged - and a host-tool run's schema round-trip reads
        // it off a field that is genuinely there.
        optional: &["tool_specs"],
    },
    OutputRow {
        contract: "tool_request",
        here: None,
        contract_requires: &[
            ("id", "\"call-7\""),
            ("name", "\"observe\""),
            ("args", "{}"),
        ],
        build_produces: &[],
        optional: &[],
    },
    OutputRow {
        contract: "turn_count",
        here: Some("step"),
        // `step` counts upstream requests, not turns, and carries no cap: R9
        // wants the cap visible *before* it is hit.
        contract_requires: &[("turns", "1"), ("maxTurns", "10")],
        build_produces: &["index", "max"],
        optional: &[],
    },
    OutputRow {
        contract: "assistant_start",
        here: None,
        contract_requires: &[],
        build_produces: &[],
        optional: &[],
    },
    OutputRow {
        contract: "text_delta",
        here: Some("token"),
        contract_requires: &[("text", "\"hi\"")],
        build_produces: &["text"],
        optional: &[],
    },
    OutputRow {
        contract: "assistant_end",
        here: None,
        contract_requires: &[("text", "\"hi\""), ("error", "null")],
        build_produces: &[],
        optional: &[],
    },
    OutputRow {
        contract: "tool_start",
        here: Some("tool_call_started"),
        // The contract carries the args with the start; this build streams them
        // separately (`tool_call_args_delta`) and assembles them in `tool_call`.
        contract_requires: &[("name", "\"command\""), ("args", "{}")],
        build_produces: &["id", "name"],
        optional: &[],
    },
    OutputRow {
        contract: "tool_end",
        here: Some("tool_result"),
        // R11 wants a failure flag (carried as `is_error`) and structured
        // `details` (absent). `content` being a `String` is R2's gap as much as
        // a naming one: an image-bearing result cannot be expressed here.
        contract_requires: &[
            ("name", "\"command\""),
            ("error", "null"),
            ("details", "null"),
        ],
        build_produces: &["id", "content", "is_error", "diff"],
        // `diff` is display-only focused-change text, carried only when the tool
        // produced one, so the empty sample cannot show it - and a client reads
        // it all the same.
        optional: &["diff"],
    },
    OutputRow {
        contract: "notice",
        here: Some("notice"),
        contract_requires: &[("text", "\"compacted\"")],
        build_produces: &["text"],
        optional: &[],
    },
    OutputRow {
        contract: "error",
        here: Some("error"),
        // The contract's `error` is one operator-facing string; this build
        // splits it into a code and a message.
        contract_requires: &[("text", "\"boom\"")],
        build_produces: &["code", "message"],
        optional: &[],
    },
    OutputRow {
        contract: "done",
        here: Some("done"),
        contract_requires: &[("stopped", "true")],
        build_produces: &["stop_reason", "usage"],
        optional: &[],
    },
    OutputRow {
        contract: "model_changed",
        here: None,
        contract_requires: &[
            ("success", "true"),
            ("provider", "\"anthropic\""),
            ("model", "\"claude-sonnet-4-5\""),
        ],
        build_produces: &[],
        optional: &[],
    },
    OutputRow {
        contract: "code_enabled",
        here: None,
        contract_requires: &[("success", "true"), ("enabled", "true"), ("tools", "[]")],
        build_produces: &[],
        optional: &[],
    },
    OutputRow {
        contract: "history_cleared",
        here: None,
        contract_requires: &[("success", "true"), ("tools", "[]"), ("tool_specs", "[]")],
        build_produces: &[],
        optional: &[],
    },
    OutputRow {
        // Synthesized by the host when stdout closes, so Jan never emits it.
        // The row is here to be checked as *not* an event, which is a real
        // invariant: a `worker_exit` on the wire would be a second, contradictory
        // source of truth for a fact the host already knows.
        contract: "worker_exit",
        here: None,
        contract_requires: &[],
        build_produces: &[],
        optional: &[],
    },
];

/// A JSON object from a tag and `(key, sample JSON)` pairs.
fn probe(tag: &str, fields: &[(&str, &str)]) -> serde_json::Value {
    let mut value = serde_json::Map::new();
    value.insert("type".to_string(), tag.into());
    for (key, sample) in fields {
        value.insert(
            (*key).to_string(),
            serde_json::from_str(sample).expect("sample"),
        );
    }
    serde_json::Value::Object(value)
}

/// The contract message a host would send for this row: its tag plus every
/// field the contract says it carries.
fn line_for(row: &InputRow) -> String {
    probe(row.contract, row.fields).to_string()
}

/// Every host -> session row this build implements parses, as its own kind.
#[test]
fn the_implemented_host_rows_parse_as_their_own_kind() {
    for row in HOST_TO_SESSION.iter().filter(|r| r.here.is_some()) {
        let here = row.here.expect("filtered");
        // Built the way a client that read `init.input_kinds` would build it,
        // not from the contract's fields, which neither row shares.
        let (line, expected) = match here {
            "abort" => (
                serde_json::json!({ "type": "abort" }).to_string(),
                InputMessage::Abort,
            ),
            "tool_result" => (
                serde_json::json!({
                    "type": "tool_result",
                    "request_id": "call-7",
                    "content": "ok",
                })
                .to_string(),
                InputMessage::ToolResult {
                    request_id: "call-7".to_string(),
                    result: crate::core::agent::host_tools::HostToolResult {
                        content: "ok".to_string(),
                        parts: None,
                        details: None,
                        is_error: false,
                    },
                },
            ),
            other => panic!("{other} is claimed as implemented and has no sample line"),
        };
        assert_eq!(
            super::stream_input::parse_input_line(&line)
                .unwrap_or_else(|e| panic!("{here} is advertised but refused: {e}")),
            expected,
            "{here} must parse as the kind the table names, not merely parse"
        );
    }
}

/// Rows the build does not implement are refused, and the refusal names the kind
/// that was rejected.
///
/// This is the guard that keeps the table honest: implementing `tool_result`
/// makes this test fail until the row moves, so the suite cannot rot into a list
/// of good intentions.
#[test]
fn every_unimplemented_host_row_is_refused_by_name() {
    for row in HOST_TO_SESSION.iter().filter(|r| r.here.is_none()) {
        let error = match super::stream_input::parse_input_line(&line_for(row)) {
            Err(e) => e,
            Ok(message) => panic!(
                "'{}' is now accepted as {message:?} - move this row in HOST_TO_SESSION",
                row.contract
            ),
        };
        // The client sent several lines; without the kind in the refusal it
        // cannot tell which one was rejected.
        assert!(
            error.contains(row.contract),
            "the refusal should name the offending kind: {error}"
        );
    }
}

/// Rows the build does not emit are not events yet.
///
/// Probed with the contract's own message, so the row stops failing here the
/// moment a variant lands and the table has to move with it.
#[test]
fn every_unimplemented_session_row_is_not_an_event_yet() {
    for row in SESSION_TO_HOST.iter().filter(|r| r.here.is_none()) {
        let message = probe(row.contract, row.contract_requires);
        if let Ok(event) = serde_json::from_value::<StreamEvent>(message) {
            panic!(
                "'{}' is now an event ({event:?}) - move this row in SESSION_TO_HOST",
                row.contract
            );
        }
    }
}

/// Rows the build does emit carry exactly the fields the table says they do.
///
/// Two samples per row, because one cannot see a `skip_serializing_if` field: the
/// empty sample is what a minimal message looks like, the full one carries every
/// field the row can put on the wire. The full sample's key set is checked against
/// `build_produces` exactly; the difference between the two samples is checked
/// against `optional`, so the list is proven rather than trusted - a field named
/// there but never set in the full sample fails, and a field that is skipped
/// without being named fails with it. Adding a field to a sampled type is a
/// compile error in the sample above until the author places it in one of the two
/// lists, which is the one step no test can do for them.
#[test]
fn every_implemented_session_row_carries_exactly_the_fields_claimed() {
    let sample = |here: &str, full: bool| -> serde_json::Value {
        let host_tool = serde_json::json!({
            "type": "function",
            "function": { "name": "bash" },
        });
        match here {
            "init" => serde_json::to_value(super::run_report::Init::new(
                "thread-1",
                "claude-sonnet-4-5",
                Some("/tmp/project".to_string()),
                vec!["bash".to_string()],
                // Only the full sample advertises a host tool, because
                // `tool_specs` is skipped when empty: the empty sample cannot
                // show it, which is exactly what the row's `optional` says.
                if full { vec![host_tool] } else { Vec::new() },
                vec!["user", "abort"],
                // The stream-json handshake's own caps, absent on a run that
                // reads no stdin. Always on the wire either way (`null`, not
                // omitted), which is why the row lists it in `build_produces`
                // and not in `optional`.
                full.then(super::run_report::InputContentParts::current),
            )),
            "step" => serde_json::to_value(StreamEvent::Step { index: 2, max: 0 }),
            "token" => serde_json::to_value(StreamEvent::Token {
                text: "hi".to_string(),
            }),
            "tool_call_started" => serde_json::to_value(StreamEvent::ToolCallStarted {
                id: "call-1".to_string(),
                name: "bash".to_string(),
            }),
            // `diff` is the row's only field that can be left out: `None` drops it
            // from the wire entirely, so the empty sample cannot show it. `done`'s
            // `usage` needs no such treatment - `None` serializes as `null`, which
            // both samples carry.
            "tool_result" => serde_json::to_value(StreamEvent::ToolResult {
                id: "call-1".to_string(),
                content: "ok".to_string(),
                is_error: false,
                diff: full.then(|| "--- a\n+++ b\n".to_string()),
            }),
            "notice" => serde_json::to_value(StreamEvent::Notice {
                text: "compacted".to_string(),
            }),
            "error" => serde_json::to_value(StreamEvent::Error {
                code: "upstream_error".to_string(),
                message: "boom".to_string(),
            }),
            "done" => serde_json::to_value(StreamEvent::Done {
                stop_reason: "stop".to_string(),
                usage: None,
            }),
            other => panic!("{other} has no sample"),
        }
        .expect("sample serializes")
    };
    let fields_of = |value: &serde_json::Value, tag: &str| -> Vec<String> {
        assert_eq!(
            value.get("type").and_then(|t| t.as_str()),
            Some(tag),
            "the sample must carry the tag the table names"
        );
        let mut present: Vec<String> = value
            .as_object()
            .expect("object")
            .keys()
            .filter(|k| *k != "type")
            .cloned()
            .collect();
        present.sort_unstable();
        present
    };
    let sorted = |fields: &[&str]| -> Vec<String> {
        let mut out: Vec<String> = fields.iter().map(|f| (*f).to_string()).collect();
        out.sort_unstable();
        out
    };

    for row in SESSION_TO_HOST.iter().filter(|r| r.here.is_some()) {
        let here = row.here.expect("filtered");
        let empty = fields_of(&sample(here, false), here);
        let full = fields_of(&sample(here, true), here);

        assert_eq!(
            full,
            sorted(row.build_produces),
            "'{}' ({here}) can carry a different field set than the table claims",
            row.contract
        );

        let conditional: Vec<String> = full
            .iter()
            .filter(|field| !empty.contains(field))
            .cloned()
            .collect();
        assert_eq!(
            conditional,
            sorted(row.optional),
            "'{}' ({here}) must list exactly the fields that are absent when empty, \
             and only those",
            row.contract
        );
    }
}

/// The table says which rows are implemented, so a row cannot claim an
/// implementation while asserting nothing about it.
#[test]
fn every_implemented_session_row_declares_what_it_produces() {
    for row in SESSION_TO_HOST {
        assert_eq!(
            row.here.is_some(),
            !row.build_produces.is_empty(),
            "'{}' claims an implementation ({:?}) but produces {:?}",
            row.contract,
            row.here,
            row.build_produces
        );
    }
}

/// The `ready` row is the one a client blocks on, so its gap is named here
/// rather than discovered by whoever ports the first SDK.
///
/// The count in the name moves with the gap: `tool_specs` landed on the
/// handshake, so what `ready` still waits for is `provider` and `models`.
#[test]
fn the_handshake_lacks_exactly_the_two_fields_ready_requires() {
    let spec = serde_json::json!({
        "type": "function",
        "function": { "name": "host__observe" },
    });
    let init = serde_json::to_value(super::run_report::Init::new(
        "thread-1",
        "claude-sonnet-4-5",
        None,
        vec!["host__observe".to_string()],
        // Non-empty, so `tool_specs` is on the record rather than skipped: a
        // sample that left it empty would pass this test with the field absent
        // from the wire, which is the failure mode R5 cannot see either.
        vec![spec],
        vec!["user"],
        // What the handshake carries for a stream-json run; `ready` requires
        // none of it, so it does not change the gap this test names.
        Some(super::run_report::InputContentParts::current()),
    ))
    .expect("init serializes");
    for missing in ["provider", "models"] {
        assert!(
            init.get(missing).is_none(),
            "`{missing}` is now on the handshake, so R5/R8's read-back is reachable - \
             move `ready` in SESSION_TO_HOST"
        );
    }
    for carried in ["model", "tools", "tool_specs"] {
        assert!(
            init.get(carried).is_some(),
            "`{carried}` is required by `ready` and is already carried"
        );
    }
}
