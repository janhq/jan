//! Correlating an agent request with the provider's billing record.
//!
//! A charge is recorded by the provider, keyed by an execution id. To ask what
//! a request cost you need a handle on that record, and there are exactly two
//! ways to get one:
//!
//! 1. **The execution id the provider returns** on the inference response, in
//!    the `X-Tokamak-Execution-Id` header. This is the direct handle, but it is
//!    only readable where the agent owns the HTTP response -- the native-wire
//!    converter path. The default path runs through `genai`, which drops the
//!    response headers on a successful stream (they survive only inside an
//!    error), so there is nothing to read there.
//! 2. **A correlation id the caller sends**, in `X-Client-Request-Id`. The
//!    provider records it against every execution the request produced, and it
//!    is searchable afterwards. This works on every path, including the one
//!    where the execution id is unreachable, which is why it is the mechanism
//!    the agent relies on rather than a convenience.
//!
//! The two are not equivalent and this module does not pretend otherwise. An
//! execution id names exactly one execution; a correlation id may match several
//! and is explicitly not an idempotency key, so a retried request shares it.
//! That is a property to report, not to engineer around: a turn that was
//! retried really did produce more than one execution, and more than one
//! charge.
//!
//! Feature-neutral on purpose. The header names and the id format have to be
//! identical in the desktop and `cli` builds -- a correlation id that differs
//! between them would silently fail to correlate, which is the one failure mode
//! that looks like success.

/// Header the provider returns on an inference response, naming that execution.
///
/// Readable only where the agent holds the `reqwest::Response` itself. See the
/// module docs for why the default path cannot see it.
pub const EXECUTION_ID_HEADER: &str = "X-Tokamak-Execution-Id";

/// Header the agent sends so its requests can be found later.
///
/// A correlation value can match several executions; it is not an idempotency
/// key, and nothing here treats it as one.
pub const CLIENT_REQUEST_ID_HEADER: &str = "X-Client-Request-Id";

/// Longest correlation id the agent will send.
///
/// A header a provider truncates or rejects correlates nothing, and the failure
/// is invisible at send time -- the request succeeds and only the later lookup
/// comes back empty. Bounded well under any plausible header limit so that
/// cannot happen.
const MAX_ID_LEN: usize = 96;

/// The correlation id for a session, or `None` when there is no session to
/// correlate.
///
/// Scoped to the session rather than the turn deliberately. The question this
/// answers in practice is "what did this run cost", which is a sum over every
/// execution the session produced, and a session-wide id is what makes that a
/// single lookup. Per-turn ids would answer a narrower question at the cost of
/// making the common one N queries.
pub fn session_request_id(session_id: Option<&str>) -> Option<String> {
    let session = session_id?.trim();
    if session.is_empty() {
        return None;
    }
    // Prefixed so a correlation id is recognizable as ours in a provider's
    // dashboard, where it sits beside ids from every other client.
    let id = format!("jan-{session}");
    Some(sanitize(&id))
}

/// Reduce an id to characters that are safe in an HTTP header value and stable
/// across the two builds.
///
/// Anything outside a conservative ASCII set becomes `-`: a header value with a
/// control character is rejected by `reqwest` at send time, which would turn a
/// correlation id into a failed request rather than a failed lookup.
fn sanitize(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .take(MAX_ID_LEN)
        .collect()
}

/// Where a captured execution id rides back from the send path to the agent
/// loop.
///
/// The completion JSON is the only value the invoker returns, so an id read
/// from the response headers is attached to it under this key. Namespaced with
/// a leading underscore so it cannot collide with a field a provider actually
/// sends, and stripped before the completion is stored or resent.
pub const EXECUTION_ID_FIELD: &str = "_jan_execution_id";

/// Attach a captured execution id to a completion body.
pub fn attach_execution_id(completion: &mut serde_json::Value, execution_id: &str) {
    if let Some(obj) = completion.as_object_mut() {
        obj.insert(
            EXECUTION_ID_FIELD.to_string(),
            serde_json::Value::String(execution_id.to_string()),
        );
    }
}

/// Read back an execution id attached by [`attach_execution_id`].
pub fn execution_id_of(completion: &serde_json::Value) -> Option<String> {
    completion
        .get(EXECUTION_ID_FIELD)?
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_yields_a_recognizable_id() {
        let id = session_request_id(Some("0b7c1d2e-3f45")).expect("a session has an id");
        assert_eq!(id, "jan-0b7c1d2e-3f45");
    }

    /// No session means nothing to correlate, and sending a placeholder would
    /// pollute the provider's records with an id that matches every run.
    #[test]
    fn no_session_means_no_correlation_id() {
        assert_eq!(session_request_id(None), None);
        assert_eq!(session_request_id(Some("")), None);
        assert_eq!(session_request_id(Some("   ")), None);
    }

    /// A header value with a control character is rejected at send time, which
    /// would turn a missing lookup into a failed request.
    #[test]
    fn an_id_is_reduced_to_header_safe_characters() {
        let id = session_request_id(Some("we ird\n\tvalue")).expect("still an id");
        assert!(
            id.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'),
            "{id}"
        );
        assert!(!id.contains('\n') && !id.contains(' '), "{id}");
    }

    #[test]
    fn an_id_is_bounded() {
        let id = session_request_id(Some(&"x".repeat(500))).expect("still an id");
        assert!(id.len() <= MAX_ID_LEN, "{} chars", id.len());
    }

    /// The same session must produce the same id in both builds and on every
    /// turn, or the correlation finds only part of the run.
    #[test]
    fn the_id_is_stable_for_a_session() {
        let a = session_request_id(Some("session-1"));
        let b = session_request_id(Some("session-1"));
        assert_eq!(a, b);
        assert_ne!(a, session_request_id(Some("session-2")));
    }

    #[test]
    fn an_execution_id_round_trips_through_the_completion() {
        let mut completion = serde_json::json!({"choices": [], "usage": {}});
        assert_eq!(execution_id_of(&completion), None);
        attach_execution_id(&mut completion, "exec-9");
        assert_eq!(execution_id_of(&completion), Some("exec-9".to_string()));
    }

    /// An empty header value is not an execution id; treating it as one would
    /// produce a lookup that can only come back not-found.
    #[test]
    fn an_empty_execution_id_is_not_attached_as_one() {
        let mut completion = serde_json::json!({});
        attach_execution_id(&mut completion, "");
        assert_eq!(execution_id_of(&completion), None);
    }

    /// A completion that is not an object (an error shape) must not panic the
    /// attach path.
    #[test]
    fn attaching_to_a_non_object_is_a_no_op() {
        let mut completion = serde_json::json!("not an object");
        attach_execution_id(&mut completion, "exec-1");
        assert_eq!(execution_id_of(&completion), None);
    }
}
