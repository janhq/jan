//! Machine-readable result envelope for a non-interactive `jan cli agent run`.
//!
//! The human output of a run is a stream: prose on stdout, progress on stderr.
//! `--output-format json` replaces it with a single object printed once the run
//! is over, so a caller can branch on `is_error` and read `result` without
//! parsing terminal chatter. The object is assembled from the same
//! [`StreamEvent`]s the printer consumes -- there is no second source of truth.

use crate::core::agent::events::StreamEvent;

/// How a non-interactive run reports itself.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum OutputFormat {
    /// Streamed prose on stdout, progress on stderr (the default).
    #[default]
    Text,
    /// A single result object on stdout when the run finishes.
    Json,
}

impl OutputFormat {
    pub(crate) fn is_json(self) -> bool {
        matches!(self, OutputFormat::Json)
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
    prompt_tokens: u64,
    completion_tokens: u64,
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
            StreamEvent::TurnUsage { usage } => {
                self.prompt_tokens += usage.prompt_tokens.unwrap_or(0);
                self.completion_tokens += usage.completion_tokens.unwrap_or(0);
            }
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
                prompt_tokens: self.prompt_tokens,
                completion_tokens: self.completion_tokens,
                total_tokens: self.prompt_tokens + self.completion_tokens,
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
        let out = value(report.finish(Some("3f7a91c2"), "tokamak-1-preview", 48213, Some("done")));

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
        let out = value(report.finish(Some("3f7a91c2"), "tokamak-1-preview", 1204, None));

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
        let out = value(report.finish(None, "m", 1, None));
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
        let out = value(report.finish(None, "m", 1, Some("answer")));
        assert_eq!(out["num_turns"], 2);
        assert_eq!(out["result"], "answer");
        assert_eq!(out["usage"]["prompt_tokens"], 350);
        assert_eq!(out["usage"]["completion_tokens"], 35);
        assert_eq!(out["usage"]["total_tokens"], 385);
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
        let printed = serde_json::to_string(&report.finish(None, "m", 1, None)).unwrap();
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

    #[test]
    fn context_overflow_is_classified_from_the_marker() {
        let mut report = RunReport::default();
        report.observe(&StreamEvent::Error {
            code: "error".to_string(),
            message: "[context-overflow] Upstream returned HTTP 400: too long".to_string(),
        });
        let out = value(report.finish(None, "m", 1, None));
        assert_eq!(out["error"]["code"], "context_overflow");
    }
}
