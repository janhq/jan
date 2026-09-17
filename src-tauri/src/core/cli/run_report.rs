//! Machine-readable result envelope for a non-interactive `jan cli agent run`.
//!
//! The human output of a run is a stream: prose on stdout, progress on stderr.
//! `--output-format json` replaces it with a single object printed once the run
//! is over, so a caller can branch on `is_error` and read `result` without
//! parsing terminal chatter. The object is assembled from the same
//! [`StreamEvent`]s the printer consumes -- there is no second source of truth.
//!
//! `--output-format stream-json` is the same envelope preceded by the trace:
//! one JSON object per line on stdout, flushed as each event is produced, with
//! the envelope as the last line. The wire shape of a trace line is
//! [`StreamEvent`]'s own `#[serde(tag = "type")]` serialization, so the tags a
//! consumer matches on are the snake_case variant names: `token`, `reasoning`,
//! `step`, `tool_call_started`, `tool_call_args_delta`, `tool_call`,
//! `tool_output_delta`, `tool_result`, `subagent_start`, `subagent_queued`,
//! `subagent_end`, `subagent_plan`, `subagent`, `notice`, `monitors`,
//! `parked`, `messages_updated`, `ask_request`, `ask_resolved`, `todo_update`,
//! `turn_usage`, `done`, `error`, `permission_request`. Two tags are minted
//! here rather than by the loop: `permission_decision` (how this CLI answered a
//! `permission_request`) and the terminal `result`.
//!
//! `monitors`, `parked` and `notice` are display-only progress; a consumer that
//! only wants the outcome can read the last line alone. Unknown tags must be
//! ignored rather than treated as an error -- new variants are additive.

use crate::core::agent::events::StreamEvent;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;

/// How a non-interactive run reports itself.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum OutputFormat {
    /// Streamed prose on stdout, progress on stderr (the default).
    #[default]
    Text,
    /// A single result object on stdout when the run finishes.
    Json,
    /// One NDJSON record per event on stdout, terminated by the result object.
    StreamJson,
}

impl OutputFormat {
    /// Stdout belongs to a program rather than a person: no prose, no spinner,
    /// and the result envelope is printed even when the run failed at setup.
    pub(crate) fn is_machine(self) -> bool {
        matches!(self, OutputFormat::Json | OutputFormat::StreamJson)
    }

    pub(crate) fn is_stream_json(self) -> bool {
        matches!(self, OutputFormat::StreamJson)
    }
}

/// One NDJSON record: the compact serialization plus its terminating newline.
/// Serialization of a `StreamEvent` is infallible in practice; an encoding
/// failure yields no line rather than a truncated one a consumer would choke on.
pub(crate) fn ndjson_line<T: serde::Serialize>(value: &T) -> Option<String> {
    serde_json::to_string(value).ok().map(|mut s| {
        s.push('\n');
        s
    })
}

/// How the CLI answered a [`StreamEvent::PermissionRequest`]. The loop does not
/// emit this: the decision is made here, and without it a piped consumer sees
/// the request and never learns that the run was denied.
#[derive(serde::Serialize)]
pub(crate) struct PermissionDecisionRecord<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    request_id: &'a str,
    decision: &'static str,
}

impl<'a> PermissionDecisionRecord<'a> {
    pub(crate) fn new(request_id: &'a str, decision: PermissionDecision) -> Self {
        Self {
            kind: "permission_decision",
            request_id,
            decision: match decision {
                PermissionDecision::AllowOnce => "allow_once",
                PermissionDecision::AllowAlways => "allow_always",
                PermissionDecision::Deny => "deny",
            },
        }
    }
}

/// Terminal outcome of a run, accumulated from its event stream.
#[derive(Default)]
pub(crate) struct RunReport {
    /// Assistant prose of the turn in flight, reset at each `Step` so a failed
    /// run still reports what the model had said before it broke.
    partial: String,
    stop_reason: Option<String>,
    error: Option<(String, String)>,
    num_turns: u32,
    /// Billable tokens across every request of the run, including subagents'.
    /// The same accumulator `/usage` sums a TUI session with.
    usage: super::model_catalog::TokenUsage,
}

impl RunReport {
    /// A run that failed before the event stream existed (bad config, no
    /// reachable provider): no turns, no usage, just the failure.
    pub(crate) fn setup_failure(message: &str) -> Self {
        let mut report = Self::default();
        report.observe(&StreamEvent::Error {
            code: "setup_error".to_string(),
            message: message.to_string(),
        });
        report
    }

    /// Fold one event into the report. Cheap enough to call on every event, so
    /// the collector runs in both output formats and only printing differs.
    pub(crate) fn observe(&mut self, ev: &StreamEvent) {
        match ev {
            StreamEvent::Step { index, .. } => {
                self.num_turns = self.num_turns.max(*index);
                self.partial.clear();
            }
            StreamEvent::Token { text } => self.partial.push_str(text),
            // Reasoning is display-only: it must not enter the piped/plain-text
            // report answer, which is reserved for the final completion.
            StreamEvent::Reasoning { .. } => {}
            StreamEvent::TurnUsage { usage } => self.usage.add(usage),
            // Subagent work is real spend on the same budget, so its usage
            // counts. Its `Step`/`Token` must not: those describe the child's
            // own turns and prose, not this run's.
            StreamEvent::Subagent { event, .. } => {
                if let StreamEvent::TurnUsage { .. } = **event {
                    self.observe(event);
                }
            }
            StreamEvent::Done { stop_reason, .. } => {
                self.stop_reason = Some(stop_reason.clone());
            }
            StreamEvent::Error { code, message } => {
                self.error = Some((code.clone(), message.clone()));
            }
            _ => {}
        }
    }

    /// Render the envelope. `final_text` is the completion the run returned;
    /// on failure there is none and the partial prose stands in for it.
    pub(crate) fn finish(
        self,
        session_id: Option<&str>,
        provider: Option<&str>,
        model: &str,
        duration_ms: u128,
        final_text: Option<&str>,
    ) -> RunResult {
        let is_error = self.error.is_some();
        RunResult {
            kind: "result",
            is_error,
            result: super::tui::answer_without_reasoning(final_text.unwrap_or(&self.partial)),
            stop_reason: if is_error {
                "error".to_string()
            } else {
                self.stop_reason.unwrap_or_else(|| "stop".to_string())
            },
            error: self.error.map(|(code, message)| RunError {
                code: error_code(&code, &message),
                message,
            }),
            session_id: session_id.map(str::to_string),
            model: model.to_string(),
            num_turns: self.num_turns,
            duration_ms: duration_ms as u64,
            usage: ReportUsage {
                prompt_tokens: self.usage.prompt_tokens,
                completion_tokens: self.usage.completion_tokens,
                total_tokens: self.usage.total_tokens(),
                cached_tokens: self.usage.cached_tokens,
                cache_write_tokens: self.usage.cache_write_tokens,
                // Priced from the model catalog the last `/models` listing
                // cached. Absent for a model whose provider publishes no
                // prices, rather than reported as zero.
                estimated_cost_usd: self
                    .usage
                    .cost_usd(super::model_catalog::load().get(provider, model)),
            },
        }
    }
}

/// The envelope itself. A struct rather than a `json!` literal so the fields
/// serialize in declaration order: `serde_json`'s map is sorted, which would
/// print this contract alphabetically and bury `result` in the middle.
#[derive(serde::Serialize)]
pub(crate) struct RunResult {
    #[serde(rename = "type")]
    kind: &'static str,
    is_error: bool,
    result: String,
    stop_reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RunError>,
    /// `null` when nothing was persisted, which is any run that failed before
    /// producing a completion: there is no session to resume.
    session_id: Option<String>,
    model: String,
    num_turns: u32,
    duration_ms: u64,
    usage: ReportUsage,
}

#[derive(serde::Serialize)]
struct RunError {
    code: String,
    message: String,
}

#[derive(serde::Serialize)]
struct ReportUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    cached_tokens: u64,
    cache_write_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_cost_usd: Option<f64>,
}

/// A stable, machine-readable code for a failure. The loop stamps every
/// terminal error `"error"`, which tells a caller nothing; the message it
/// carries is what distinguishes a blown context window from a refused
/// request, and only those two are classified -- an invented taxonomy would be
/// worse than falling back to the raw code.
fn error_code(code: &str, message: &str) -> String {
    if crate::core::agent::upstream::is_context_overflow_error(message) {
        return "context_overflow".to_string();
    }
    if message.starts_with("Upstream ") {
        return "upstream_error".to_string();
    }
    code.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::events::Usage;

    fn usage(prompt: u64, completion: u64) -> Usage {
        Usage {
            prompt_tokens: Some(prompt),
            completion_tokens: Some(completion),
            total_tokens: Some(prompt + completion),
            ..Default::default()
        }
    }

    fn value(result: RunResult) -> serde_json::Value {
        serde_json::to_value(result).unwrap()
    }

    fn token(text: &str) -> StreamEvent {
        StreamEvent::Token {
            text: text.to_string(),
        }
    }

    #[test]
    fn success_envelope_matches_the_documented_shape() {
        let mut report = RunReport::default();
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(9011, 655),
            },
            token("done"),
            StreamEvent::Done {
                stop_reason: "end_turn".to_string(),
                usage: None,
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(
            Some("3f7a91c2"),
            None,
            "tokamak-1-preview",
            48213,
            Some("done"),
        ));

        assert_eq!(out["type"], "result");
        assert_eq!(out["is_error"], false);
        assert_eq!(out["result"], "done");
        assert_eq!(out["stop_reason"], "end_turn");
        assert_eq!(out["session_id"], "3f7a91c2");
        assert_eq!(out["model"], "tokamak-1-preview");
        assert_eq!(out["num_turns"], 1);
        assert_eq!(out["duration_ms"], 48213u64);
        assert_eq!(out["usage"]["prompt_tokens"], 9011);
        assert_eq!(out["usage"]["completion_tokens"], 655);
        assert_eq!(out["usage"]["total_tokens"], 9666);
        assert!(out.get("error").is_none(), "success carries no error key");
    }

    #[test]
    fn failure_reports_the_partial_answer_and_a_classified_code() {
        let mut report = RunReport::default();
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(8123, 0),
            },
            token("I started reviewing auth.rs and"),
            StreamEvent::Error {
                code: "error".to_string(),
                message: "Upstream returned HTTP 400: tool_choice does not match".to_string(),
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(Some("3f7a91c2"), None, "tokamak-1-preview", 1204, None));

        assert_eq!(out["is_error"], true);
        assert_eq!(out["result"], "I started reviewing auth.rs and");
        assert_eq!(out["stop_reason"], "error");
        assert_eq!(out["error"]["code"], "upstream_error");
        assert_eq!(
            out["error"]["message"],
            "Upstream returned HTTP 400: tool_choice does not match"
        );
        assert_eq!(out["usage"]["total_tokens"], 8123);
    }

    #[test]
    fn partial_answer_is_the_last_turn_only_and_drops_reasoning() {
        let mut report = RunReport::default();
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            token("first turn prose"),
            StreamEvent::Step { index: 2, max: 0 },
            token("<think>deliberating</think>second turn prose"),
            StreamEvent::Error {
                code: "error".to_string(),
                message: "boom".to_string(),
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(None, None, "m", 1, None));
        assert_eq!(out["result"], "second turn prose");
        assert_eq!(out["num_turns"], 2);
        // Unclassifiable messages keep the code the loop stamped.
        assert_eq!(out["error"]["code"], "error");
        assert_eq!(out["session_id"], serde_json::Value::Null);
    }

    #[test]
    fn usage_accumulates_across_turns_and_subagents() {
        let mut report = RunReport::default();
        let child = |ev: StreamEvent| StreamEvent::Subagent {
            run_id: "r".to_string(),
            name: "child".to_string(),
            event: Box::new(ev),
        };
        for ev in [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(100, 10),
            },
            child(StreamEvent::TurnUsage {
                usage: usage(50, 5),
            }),
            // A child's own turns and prose belong to the child, not this run.
            child(StreamEvent::Step { index: 9, max: 0 }),
            child(token("child prose")),
            StreamEvent::Step { index: 2, max: 0 },
            StreamEvent::TurnUsage {
                usage: usage(200, 20),
            },
        ] {
            report.observe(&ev);
        }
        let out = value(report.finish(None, None, "m", 1, Some("answer")));
        assert_eq!(out["num_turns"], 2);
        assert_eq!(out["result"], "answer");
        assert_eq!(out["usage"]["prompt_tokens"], 350);
        assert_eq!(out["usage"]["completion_tokens"], 35);
        assert_eq!(out["usage"]["total_tokens"], 385);
    }

    /// A priced model carries its estimated cost in the envelope, so a script
    /// can budget without re-deriving prices; an unpriced one omits the field
    /// rather than reporting the run as free.
    #[test]
    fn the_envelope_prices_the_run_when_the_catalog_knows_the_model() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let mut catalog = crate::core::cli::model_catalog::Catalog::default();
            catalog.set_provider(
                "tokamak",
                std::collections::BTreeMap::from([(
                    "priced-model".to_string(),
                    crate::core::cli::model_catalog::ModelInfo {
                        prompt_usd: Some(0.000001),
                        completion_usd: Some(0.00001),
                        ..Default::default()
                    },
                )]),
            );
            catalog.save().expect("seed catalog");

            let mut report = RunReport::default();
            report.observe(&StreamEvent::TurnUsage {
                usage: usage(1_000_000, 100_000),
            });
            let out = value(report.finish(None, None, "priced-model", 1, Some("done")));
            assert_eq!(out["usage"]["estimated_cost_usd"], 2.0);

            let mut report = RunReport::default();
            report.observe(&StreamEvent::TurnUsage {
                usage: usage(1_000, 100),
            });
            let out = value(report.finish(None, None, "unknown-model", 1, Some("done")));
            assert!(
                out["usage"].get("estimated_cost_usd").is_none(),
                "an unpriced model must not report a cost"
            );
        });
    }

    /// The printed order is part of the contract: a human reading the envelope
    /// should hit `result` near the top, not alphabetically between `num_turns`
    /// and `session_id`.
    #[test]
    fn keys_serialize_in_the_documented_order() {
        let mut report = RunReport::default();
        report.observe(&StreamEvent::Error {
            code: "error".to_string(),
            message: "boom".to_string(),
        });
        let printed = serde_json::to_string(&report.finish(None, None, "m", 1, None)).unwrap();
        let order = [
            "\"type\"",
            "\"is_error\"",
            "\"result\"",
            "\"stop_reason\"",
            "\"error\"",
            "\"session_id\"",
            "\"model\"",
            "\"num_turns\"",
            "\"duration_ms\"",
            "\"usage\"",
        ];
        let mut at = 0;
        for key in order {
            let found = printed[at..]
                .find(key)
                .unwrap_or_else(|| panic!("{key} missing or out of order in {printed}"));
            at += found + key.len();
        }
    }

    /// The stream-json contract: every record is independently parseable on its
    /// own line, carries a `type` tag, and the envelope is the last one.
    #[test]
    fn the_ndjson_stream_parses_line_by_line_and_ends_with_the_result() {
        let events = [
            StreamEvent::Step { index: 1, max: 0 },
            StreamEvent::ToolCall {
                id: "call_1".to_string(),
                name: "bash".to_string(),
                args: serde_json::json!({ "command": "echo \"hi\"\nls" }),
            },
            token("done\nand done"),
            StreamEvent::Done {
                stop_reason: "end_turn".to_string(),
                usage: None,
            },
        ];
        let mut report = RunReport::default();
        let mut stream = String::new();
        for ev in &events {
            report.observe(ev);
            stream.push_str(&ndjson_line(ev).unwrap());
        }
        stream.push_str(
            &ndjson_line(&PermissionDecisionRecord::new(
                "perm-1",
                PermissionDecision::Deny,
            ))
            .unwrap(),
        );
        stream.push_str(
            &ndjson_line(&report.finish(None, None, "m", 1, Some("done\nand done"))).unwrap(),
        );

        assert!(stream.ends_with('\n'));
        let lines: Vec<&str> = stream.lines().collect();
        assert_eq!(lines.len(), events.len() + 2);
        let parsed: Vec<serde_json::Value> = lines
            .iter()
            .map(|line| serde_json::from_str(line).expect("each line parses on its own"))
            .collect();
        let tags: Vec<&str> = parsed
            .iter()
            .map(|v| v["type"].as_str().expect("every record is tagged"))
            .collect();
        assert_eq!(
            tags,
            [
                "step",
                "tool_call",
                "token",
                "done",
                "permission_decision",
                "result"
            ]
        );
        assert_eq!(parsed[4]["decision"], "deny");
        assert_eq!(parsed[4]["request_id"], "perm-1");
        assert_eq!(parsed[5]["result"], "done\nand done");
    }

    #[test]
    fn context_overflow_is_classified_from_the_marker() {
        let mut report = RunReport::default();
        report.observe(&StreamEvent::Error {
            code: "error".to_string(),
            message: "[context-overflow] Upstream returned HTTP 400: too long".to_string(),
        });
        let out = value(report.finish(None, None, "m", 1, None));
        assert_eq!(out["error"]["code"], "context_overflow");
    }
}
