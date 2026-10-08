//! `/goal` support: keep the agent working across turns until a completion
//! condition is met. A goal stores a user-supplied condition; after each
//! assistant turn a fast, stateless evaluator (the session's `smol` role model)
//! reads the condition plus the conversation and returns yes/no + a short
//! reason. "no" surfaces the reason as guidance and starts the next turn
//! automatically; "yes" marks the goal achieved and returns control to the
//! user. The evaluator calls no tools and has no side effects.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::core::agent::r#loop::ModelInvoker;
use crate::core::agent::upstream::extract_choice_message;

/// Hard cap on a goal condition, per the spec ("up to 4k chars").
pub(crate) const MAX_CONDITION_CHARS: usize = 4096;

/// Lifecycle of an active goal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GoalStatus {
    /// The loop is running: turns fire until the evaluator says the goal is met.
    Active,
    /// The evaluator judged the condition satisfied; control is back with the user.
    Achieved,
}

/// A session-scoped goal, serialized with the thread so it survives restart and
/// `/resume`. Times are Unix epoch seconds so they round-trip through JSON
/// without pulling in a datetime dependency.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct GoalState {
    /// The completion condition the evaluator checks after every turn.
    pub condition: String,
    /// Turns run since the goal was set (each assistant turn increments this).
    #[serde(default)]
    pub turns: u32,
    /// When the goal was set, Unix epoch seconds.
    #[serde(default)]
    pub started_at: u64,
    /// The evaluator's most recent short reason ("" until the first evaluation).
    #[serde(default)]
    pub last_reason: String,
    /// Current lifecycle state.
    #[serde(default = "default_status")]
    pub status: GoalStatus,
}

fn default_status() -> GoalStatus {
    GoalStatus::Active
}

impl GoalState {
    /// Start a fresh, active goal for `condition` (trimmed and length-capped).
    pub fn new(condition: &str) -> Self {
        Self {
            condition: clamp_condition(condition),
            turns: 0,
            started_at: now_secs(),
            last_reason: String::new(),
            status: GoalStatus::Active,
        }
    }

    /// Whether the loop should keep firing turns.
    pub fn is_active(&self) -> bool {
        self.status == GoalStatus::Active
    }

    /// Seconds elapsed since the goal was set (saturating; robust to clock skew).
    pub fn elapsed_secs(&self) -> u64 {
        now_secs().saturating_sub(self.started_at)
    }
}

/// Trim and cap a condition to [`MAX_CONDITION_CHARS`] (char-safe).
pub(crate) fn clamp_condition(condition: &str) -> String {
    let trimmed = condition.trim();
    if trimmed.chars().count() <= MAX_CONDITION_CHARS {
        return trimmed.to_string();
    }
    trimmed.chars().take(MAX_CONDITION_CHARS).collect()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The evaluator's verdict for one turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GoalVerdict {
    /// True when the condition is satisfied.
    pub met: bool,
    /// A short human-readable reason (guidance when `met` is false).
    pub reason: String,
}

const EVALUATOR_SYSTEM_PROMPT: &str = "You are a strict completion evaluator for an autonomous \
coding agent. You are given a GOAL (a condition that should become true) and a TRANSCRIPT of the \
agent's work so far. Decide whether the goal is now satisfied based ONLY on evidence in the \
transcript. Do not run tools, do not assume work that is not shown, and do not give the agent the \
benefit of the doubt. If the evidence is missing or ambiguous, the goal is NOT met.\n\n\
Reply with a single line of JSON and nothing else, in exactly this shape:\n\
{\"met\": true|false, \"reason\": \"<one concise sentence>\"}\n\
When \"met\" is false, the reason must state what still needs to happen so the agent can continue.";

/// Render the conversation into a plain-text transcript for the evaluator,
/// capped so a long session cannot itself overflow the evaluator's context.
/// The most recent content is kept when truncating.
fn serialize_transcript(messages: &[Value]) -> String {
    const MAX_CHARS: usize = 60_000;
    let mut lines: Vec<String> = Vec::with_capacity(messages.len());
    for msg in messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        // Skip system prompts: they describe capabilities, not progress.
        if role == "system" {
            continue;
        }
        let content = match msg.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Null) | None => String::new(),
            Some(other) => other.to_string(),
        };
        let mut line = format!("{role}: {content}");
        if let Some(calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
            let names: Vec<&str> = calls
                .iter()
                .filter_map(|c| {
                    c.get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                })
                .collect();
            if !names.is_empty() {
                line.push_str(&format!(" [tool_calls: {}]", names.join(", ")));
            }
        }
        lines.push(line);
    }
    let joined = lines.join("\n");
    if joined.len() > MAX_CHARS {
        let start = joined.len() - MAX_CHARS;
        let start = (start..joined.len())
            .find(|i| joined.is_char_boundary(*i))
            .unwrap_or(joined.len());
        format!("[...older content truncated...]\n{}", &joined[start..])
    } else {
        joined
    }
}

/// Build the stateless evaluator request body (no tools, no streaming needed).
pub(crate) fn build_evaluator_request(
    model_id: &str,
    condition: &str,
    messages: &[Value],
) -> Value {
    let user = format!(
        "GOAL:\n{condition}\n\nTRANSCRIPT:\n{}",
        serialize_transcript(messages)
    );
    json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": EVALUATOR_SYSTEM_PROMPT },
            { "role": "user", "content": user },
        ],
        // Deterministic judging: no creativity wanted.
        "temperature": 0,
    })
}

/// Parse the evaluator's reply. Accepts a bare JSON object, JSON embedded in
/// prose, or a plain yes/no line as a fallback so a non-conforming smol model
/// still yields a usable verdict.
pub(crate) fn parse_verdict(reply: &str) -> GoalVerdict {
    let trimmed = reply.trim();

    // Preferred path: a JSON object somewhere in the reply.
    if let Some(obj) = extract_json_object(trimmed) {
        let met = obj.get("met").and_then(Value::as_bool);
        let reason = obj
            .get("reason")
            .and_then(|r| r.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if let Some(met) = met {
            return GoalVerdict {
                met,
                reason: reason.unwrap_or_else(|| {
                    if met {
                        "condition satisfied".to_string()
                    } else {
                        "condition not yet satisfied".to_string()
                    }
                }),
            };
        }
    }

    // Fallback: sniff an affirmative/negative from the leading text.
    let lower = trimmed.to_lowercase();
    let met = lower.starts_with("yes")
        || lower.starts_with("true")
        || lower.contains("\"met\": true")
        || lower.contains("goal met")
        || lower.contains("condition met");
    GoalVerdict {
        met,
        reason: if trimmed.is_empty() {
            "evaluator returned no reason".to_string()
        } else {
            first_line(trimmed).to_string()
        },
    }
}

/// Extract the first balanced `{...}` JSON object from `s`, if it parses.
fn extract_json_object(s: &str) -> Option<Value> {
    let start = s.find('{')?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    for (i, ch) in s[start..].char_indices() {
        if in_str {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = start + i + 1;
                    return serde_json::from_str(&s[start..end]).ok();
                }
            }
            _ => {}
        }
    }
    None
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or(s).trim()
}

/// Run one stateless evaluation. Errors from the model call are surfaced to the
/// caller so it can decide whether to keep looping; a malformed reply degrades
/// to a best-effort verdict via [`parse_verdict`].
pub(crate) async fn evaluate(
    model_id: &str,
    condition: &str,
    messages: &[Value],
    model: &dyn ModelInvoker,
) -> Result<GoalVerdict, String> {
    let request = build_evaluator_request(model_id, condition, messages);
    // The evaluator's tokens are internal: a dropped receiver keeps them off the
    // user-facing stream.
    let (sink, _rx) = mpsc::unbounded_channel();
    let completion = model.invoke(&request, &sink).await?;
    let reply = extract_choice_message(&completion)
        .and_then(|m| m.get("content").cloned())
        .and_then(|c| c.as_str().map(str::to_string))
        .unwrap_or_default();
    Ok(parse_verdict(&reply))
}

/// The guidance message injected as the next user turn when the goal is unmet.
/// Phrased as a continuation so the agent keeps working rather than re-asking.
pub(crate) fn continuation_prompt(condition: &str, reason: &str) -> String {
    format!(
        "Continue working toward this goal: {condition}\n\n\
The goal is not yet met: {reason}\n\n\
Keep going until it is satisfied. Do not stop to ask for confirmation."
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::events::StreamEvent;
    use async_trait::async_trait;

    struct StubModel {
        reply: String,
    }
    #[async_trait]
    impl ModelInvoker for StubModel {
        async fn invoke(
            &self,
            _request: &Value,
            _events: &mpsc::UnboundedSender<StreamEvent>,
        ) -> Result<Value, String> {
            Ok(json!({ "choices": [{ "message": { "content": self.reply.clone() } }] }))
        }
    }

    #[test]
    fn clamp_trims_and_caps() {
        assert_eq!(clamp_condition("  hi  "), "hi");
        let long = "x".repeat(MAX_CONDITION_CHARS + 500);
        assert_eq!(clamp_condition(&long).chars().count(), MAX_CONDITION_CHARS);
    }

    #[test]
    fn new_goal_is_active() {
        let g = GoalState::new("all tests pass");
        assert!(g.is_active());
        assert_eq!(g.turns, 0);
        assert_eq!(g.condition, "all tests pass");
    }

    #[test]
    fn parses_clean_json_verdict() {
        let v = parse_verdict(r#"{"met": true, "reason": "all tests green"}"#);
        assert!(v.met);
        assert_eq!(v.reason, "all tests green");

        let v = parse_verdict(r#"{"met": false, "reason": "3 tests still failing"}"#);
        assert!(!v.met);
        assert_eq!(v.reason, "3 tests still failing");
    }

    #[test]
    fn parses_json_embedded_in_prose() {
        let v = parse_verdict(
            "Here is my judgment:\n{\"met\": false, \"reason\": \"not done\"}\nThanks",
        );
        assert!(!v.met);
        assert_eq!(v.reason, "not done");
    }

    #[test]
    fn parses_json_with_nested_braces_in_reason() {
        let v = parse_verdict(r#"{"met": true, "reason": "the {x} block compiles"}"#);
        assert!(v.met);
        assert_eq!(v.reason, "the {x} block compiles");
    }

    #[test]
    fn falls_back_to_yes_no_sniffing() {
        assert!(parse_verdict("Yes, the condition is met.").met);
        assert!(!parse_verdict("No, still work to do.").met);
    }

    #[test]
    fn empty_reply_is_not_met() {
        let v = parse_verdict("");
        assert!(!v.met);
        assert!(!v.reason.is_empty());
    }

    #[test]
    fn transcript_omits_system_messages() {
        let msgs = vec![
            json!({ "role": "system", "content": "you are an agent" }),
            json!({ "role": "user", "content": "do the thing" }),
            json!({ "role": "assistant", "content": "done" }),
        ];
        let t = serialize_transcript(&msgs);
        assert!(!t.contains("you are an agent"));
        assert!(t.contains("do the thing"));
        assert!(t.contains("done"));
    }

    #[tokio::test]
    async fn evaluate_returns_met_verdict() {
        let model = StubModel {
            reply: r#"{"met": true, "reason": "ok"}"#.into(),
        };
        let msgs = vec![json!({ "role": "user", "content": "hi" })];
        let v = evaluate("smol", "cond", &msgs, &model).await.unwrap();
        assert!(v.met);
        assert_eq!(v.reason, "ok");
    }

    #[test]
    fn continuation_prompt_includes_condition_and_reason() {
        let p = continuation_prompt("tests pass", "2 failing");
        assert!(p.contains("tests pass"));
        assert!(p.contains("2 failing"));
    }
}
