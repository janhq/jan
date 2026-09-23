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
//! Each row therefore carries two field lists: what the contract says the
//! message must carry, and what this build actually produces for it. The gap
//! between them is the row's remaining work, stated rather than inferred.
//!
//! Transcribed from #368's "Host -> session" and "Session -> host" tables plus
//! its "fields the mapping must not lose" table. The contract as written, not as
//! this build implements it.

use crate::core::agent::events::StreamEvent;

/// One row of "Host -> session".
struct InputRow {
    /// The `type` the contract names.
    contract: &'static str,
    /// The `type` this build accepts for the same job today, if it has one.
    here: Option<&'static str>,
    /// The contract's payload fields, as `(key, sample JSON value)`.
    fields: &'static [(&'static str, &'static str)],
}

/// One row of "Session -> host".
struct OutputRow {
    contract: &'static str,
    /// The event tag this build emits for the same job today, if it has one.
    here: Option<&'static str>,
    /// Every field the contract says the message carries.
    contract_requires: &'static [&'static str],
    /// What this build actually produces under `here`, asserted *exactly*:
    /// adding or dropping a field is a failure until this table moves, because
    /// either one changes what a client reads.
    build_produces: &'static [&'static str],
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
        here: None,
        fields: &[("id", "\"call-7\""), ("result", "{\"ok\":true}")],
    },
];

/// What the session sends the host, in the contract's order.
const SESSION_TO_HOST: &[OutputRow] = &[
    OutputRow {
        contract: "ready",
        here: Some("init"),
        // R5 compares `tool_specs` for value equality and R8 filters `models`
        // to the ones that accept images. Neither is carried, and `provider` is
        // not either: a client cannot tell which provider answered.
        contract_requires: &["model", "provider", "models", "tools", "tool_specs"],
        build_produces: &[
            "protocol_version",
            "session_id",
            "model",
            "cwd",
            "tools",
            "input_kinds",
            "input_content_parts",
        ],
    },
    OutputRow {
        contract: "tool_request",
        here: None,
        contract_requires: &["id", "name", "args"],
        build_produces: &[],
    },
    OutputRow {
        contract: "turn_count",
        here: Some("step"),
        // `step` counts upstream requests, not turns, and carries no cap: R9
        // wants the cap visible *before* it is hit.
        contract_requires: &["turns", "maxTurns"],
        build_produces: &["index", "max"],
    },
    OutputRow {
        contract: "assistant_start",
        here: None,
        contract_requires: &[],
        build_produces: &[],
    },
    OutputRow {
        contract: "text_delta",
        here: Some("token"),
        contract_requires: &["text"],
        build_produces: &["text"],
    },
    OutputRow {
        contract: "assistant_end",
        here: None,
        contract_requires: &["text", "error"],
        build_produces: &[],
    },
    OutputRow {
        contract: "tool_start",
        here: Some("tool_call_started"),
        // The contract carries the args with the start; this build streams them
        // separately (`tool_call_args_delta`) and assembles them in `tool_call`.
        contract_requires: &["name", "args"],
        build_produces: &["id", "name"],
    },
    OutputRow {
        contract: "tool_end",
        here: Some("tool_result"),
        // R11 wants a failure flag (carried as `is_error`) and structured
        // `details` (absent). `content` being a `String` is R2's gap as much as
        // a naming one: an image-bearing result cannot be expressed here.
        contract_requires: &["name", "error", "details"],
        build_produces: &["id", "content", "is_error"],
    },
    OutputRow {
        contract: "notice",
        here: Some("notice"),
        contract_requires: &["text"],
        build_produces: &["text"],
    },
    OutputRow {
        contract: "error",
        here: Some("error"),
        // The contract's `error` is one operator-facing string; this build
        // splits it into a code and a message.
        contract_requires: &["text"],
        build_produces: &["code", "message"],
    },
    OutputRow {
        contract: "done",
        here: Some("done"),
        contract_requires: &["stopped"],
        build_produces: &["stop_reason", "usage"],
    },
    OutputRow {
        contract: "model_changed",
        here: None,
        contract_requires: &["success"],
        build_produces: &[],
    },
    OutputRow {
        contract: "code_enabled",
        here: None,
        contract_requires: &["success", "enabled", "tools"],
        build_produces: &[],
    },
    OutputRow {
        contract: "history_cleared",
        here: None,
        contract_requires: &["success", "tools", "tool_specs"],
        build_produces: &[],
    },
    OutputRow {
        // Synthesized by the host when stdout closes, so Jan never emits it.
        // The row is here to be checked as *not* an event.
        contract: "worker_exit",
        here: None,
        contract_requires: &[],
        build_produces: &[],
    },
];

/// The contract message as a line: its tag plus every field it must carry.
///
/// Used as a probe. It is refused while the row is unimplemented and accepted
/// once the row lands, which is the whole mechanism of the "asserted missing"
/// rule: the test does not have to be remembered, it fails on its own.
fn line_for(row: &InputRow) -> String {
    let mut value = serde_json::Map::new();
    value.insert("type".to_string(), row.contract.into());
    for (key, sample) in row.fields {
        value.insert(
            (*key).to_string(),
            serde_json::from_str(sample).expect("sample"),
        );
    }
    serde_json::Value::Object(value).to_string()
}

/// Rows the build implements parse as the kind the table names.
#[test]
fn every_implemented_host_row_parses_as_the_kind_the_table_names() {
    let probes = [
        ("abort", serde_json::json!({ "type": "abort" })),
        (
            "user",
            serde_json::json!({ "type": "user", "text": "hello" }),
        ),
        (
            "permission",
            serde_json::json!({
                "type": "permission", "request_id": "ask-1", "decision": "deny"
            }),
        ),
    ];
    for row in HOST_TO_SESSION.iter().filter(|r| r.here.is_some()) {
        let here = row.here.expect("filtered");
        let probe = probes
            .iter()
            .find(|(kind, _)| *kind == here)
            .map(|(_, probe)| probe)
            .unwrap_or_else(|| panic!("{here} is claimed as an implementation and has no probe"));
        super::stream_input::parse_input_line(&probe.to_string())
            .unwrap_or_else(|e| panic!("{here} is advertised but refused: {e}"));
    }
}

/// Rows the build does not implement are refused, and the refusal names what the
/// channel does accept.
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
        assert!(
            error.contains(row.contract),
            "the refusal should name the offending kind: {error}"
        );
        // The client is told what it may send, which is the only way it can
        // recover from a version skew without reading this build's source.
        for kind in super::stream_input::INPUT_KINDS {
            assert!(
                error.contains(kind),
                "the refusal must name every accepted kind ({kind}): {error}"
            );
        }
    }
}

/// The kinds the handshake advertises are exactly the kinds the parser accepts.
///
/// A kind added to the parser without a line in `INPUT_KINDS` is a capability no
/// client is told about; one added to `INPUT_KINDS` without a parser arm is a
/// promise the channel breaks.
#[test]
fn the_advertised_input_kinds_are_the_ones_the_channel_accepts() {
    for kind in super::stream_input::INPUT_KINDS {
        let probe = serde_json::json!({ "type": kind }).to_string();
        let unknown = format!(
            "unknown type '{kind}' ({})",
            super::stream_input::INPUT_KINDS.join(", ")
        );
        // A bare probe may legitimately fail for a missing field (`user` needs
        // `text`); what it must never do is fall through to "unknown type",
        // which is the arm a kind with no parser reaches.
        if let Err(error) = super::stream_input::parse_input_line(&probe) {
            assert_ne!(error, unknown, "{kind} is advertised but has no parser arm");
        }
    }
}

/// Rows the build does not emit are not events yet.
///
/// Probed with the contract's own fields, so the row stops failing here the
/// moment a variant lands and the table has to move with it.
#[test]
fn every_unimplemented_session_row_is_not_an_event_yet() {
    for row in SESSION_TO_HOST.iter().filter(|r| r.here.is_none()) {
        let mut value = serde_json::Map::new();
        value.insert("type".to_string(), row.contract.into());
        for field in row.contract_requires {
            value.insert((*field).to_string(), serde_json::Value::Null);
        }
        if let Ok(event) = serde_json::from_value::<StreamEvent>(serde_json::Value::Object(value)) {
            panic!(
                "'{}' is now an event ({event:?}) - move this row in SESSION_TO_HOST",
                row.contract
            );
        }
    }
}

/// Rows the build does emit carry exactly the fields the table says they do.
#[test]
fn every_implemented_session_row_carries_exactly_the_fields_claimed() {
    let sample = |here: &str| -> serde_json::Value {
        match here {
            "init" => serde_json::to_value(super::run_report::Init::new(
                "thread-1",
                "claude-sonnet-4-5",
                Some("/tmp/project".to_string()),
                vec!["bash".to_string()],
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
            "tool_result" => serde_json::to_value(StreamEvent::ToolResult {
                id: "call-1".to_string(),
                content: "ok".to_string(),
                is_error: false,
                diff: None,
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

    for row in SESSION_TO_HOST.iter().filter(|r| r.here.is_some()) {
        let here = row.here.expect("filtered");
        let value = sample(here);
        assert_eq!(
            value.get("type").and_then(|t| t.as_str()),
            Some(here),
            "the sample must carry the tag the table names"
        );
        let mut present: Vec<&str> = value
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .filter(|k| *k != "type")
            .collect();
        present.sort_unstable();
        let mut claimed: Vec<&str> = row.build_produces.to_vec();
        claimed.sort_unstable();
        assert_eq!(
            present, claimed,
            "'{}' ({here}) carries a different field set than the table claims",
            row.contract
        );
    }
}

/// Every row states its own remaining work: a row with no `here` has no
/// implementation, and a row with one produces something.
///
/// Cheap, and it is what makes the two field lists above readable as a gap
/// rather than as noise: a `here` with an empty `build_produces` would be a row
/// that claims an implementation while asserting nothing about it.
#[test]
fn the_table_states_which_rows_are_implemented() {
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
#[test]
fn the_handshake_lacks_exactly_the_three_fields_ready_requires() {
    let init = serde_json::to_value(super::run_report::Init::new(
        "thread-1",
        "claude-sonnet-4-5",
        None,
        vec![],
        vec!["user"],
        // What the handshake carries for a stream-json run; `ready` requires
        // none of it, so it does not change the gap this test names.
        Some(super::run_report::InputContentParts::current()),
    ))
    .expect("init serializes");
    for missing in ["provider", "models", "tool_specs"] {
        assert!(
            init.get(missing).is_none(),
            "`{missing}` is now on the handshake, so R5/R8's read-back is reachable - \
             move `ready` in SESSION_TO_HOST"
        );
    }
    for carried in ["model", "tools"] {
        assert!(
            init.get(carried).is_some(),
            "`{carried}` is required by `ready` and is already carried"
        );
    }
}
