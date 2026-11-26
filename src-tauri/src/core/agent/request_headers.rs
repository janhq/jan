//! The headers an inference request carries beyond its transport's own: the
//! serving provider's configured custom headers, and the ones Jan owns
//! (`User-Agent`, `X-Client-Request-Id`, `X-Session-Id`).
//!
//! Built once per request by the invoker and handed to both send paths -- the
//! `genai` header override and the native converter's request -- so the two
//! cannot disagree about what reaches the wire. Names are compared
//! case-insensitively throughout: `reqwest`'s `RequestBuilder::header` appends
//! rather than replaces, so two spellings of one name would both be sent, and a
//! custom `x-api-key` would become a second credential.
//!
//! Feature-neutral, like [`super::correlation`]: the desktop's agent loop and
//! API-server orchestration send through the same paths, and the custom headers
//! the desktop registers for a provider are honoured here too.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::core::state::ProviderCustomHeader;

/// Header naming the session a request belongs to: the id the correlation
/// header carries, without its `jan-` prefix, so a gateway can group a session's
/// requests without knowing how the correlation id is derived.
pub const SESSION_ID_HEADER: &str = "X-Session-Id";

/// Names a custom header may never set, lowercase: the transport's own framing,
/// and every credential header either send path writes (the Bearer default and
/// the converters' `x-api-key` / `x-goog-api-key` / `anthropic-version`). A
/// custom value for one of these would either break the stream or send a second
/// credential alongside the real one.
pub const RESERVED: &[&str] = &[
    "authorization",
    "content-type",
    "accept",
    "accept-encoding",
    "x-api-key",
    "x-goog-api-key",
    "anthropic-version",
];

/// Whether `name` is one a custom header may not set.
pub fn is_reserved(name: &str) -> bool {
    let name = name.trim();
    RESERVED.iter().any(|r| r.eq_ignore_ascii_case(name))
}

static USER_AGENT: OnceLock<String> = OnceLock::new();

/// Set the `User-Agent` every inference request carries. Called once, by the
/// binary at startup: the agent loop is compiled into both the CLI and the
/// desktop, and only the binary knows which product it is. The desktop never
/// calls this, so its requests carry no `User-Agent`, exactly as before.
pub fn set_user_agent(value: String) {
    let _ = USER_AGENT.set(value);
}

/// The `User-Agent` set by [`set_user_agent`], if any.
pub fn user_agent() -> Option<&'static str> {
    USER_AGENT.get().map(String::as_str)
}

/// `Jan-Agent/<version> (<os>; <arch>)`, the CLI's product token. "Jan Agent",
/// not "Jan": the desktop's own update checks send `Jan/<version>`, and both
/// share one version number, so the product name is the only thing that tells
/// a gateway which client it is talking to.
pub fn agent_user_agent(version: &str) -> String {
    format!(
        "Jan-Agent/{} ({}; {})",
        version,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

/// The headers Jan owns on a request: the `User-Agent` when the binary set one,
/// and the correlation and session ids when the request belongs to a session.
///
/// `X-Session-Id` is derived from the correlation id rather than from the raw
/// session id, so the two always name the same session in the same sanitized
/// form -- one header is the other minus its prefix.
pub fn owned(user_agent: Option<&str>, client_request_id: Option<&str>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(ua) = user_agent.filter(|ua| !ua.trim().is_empty()) {
        out.push(("User-Agent".to_string(), ua.to_string()));
    }
    if let Some(id) = client_request_id.filter(|id| !id.is_empty()) {
        out.push((
            super::correlation::CLIENT_REQUEST_ID_HEADER.to_string(),
            id.to_string(),
        ));
        if let Some(session) = id.strip_prefix("jan-").filter(|s| !s.is_empty()) {
            out.push((SESSION_ID_HEADER.to_string(), session.to_string()));
        }
    }
    out
}

/// The extra headers for one request: the provider's custom headers, then the
/// Jan-owned ones, as one list with no name twice.
///
/// A custom header is dropped (with a warning, once per name) when its name is
/// [reserved](RESERVED) or not a valid header, or its value is not a valid
/// header value -- `reqwest` would otherwise fail the whole request at send
/// time. A custom header with the name of a Jan-owned one is dropped silently:
/// Jan's value wins, and saying so on every request would be noise. Two custom
/// headers with one name keep the later, the way a later config layer wins.
pub fn extras(
    custom: &[ProviderCustomHeader],
    owned: Vec<(String, String)>,
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for header in custom {
        let name = header.header.trim();
        let value = header.value.trim();
        if name.is_empty() {
            continue;
        }
        if is_reserved(name) {
            warn_skipped(name, "a reserved header");
            continue;
        }
        if reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err()
            || reqwest::header::HeaderValue::from_str(value).is_err()
        {
            warn_skipped(name, "not a valid header");
            continue;
        }
        if owned.iter().any(|(n, _)| n.eq_ignore_ascii_case(name)) {
            continue;
        }
        out.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
        out.push((name.to_string(), value.to_string()));
    }
    out.extend(owned);
    out
}

/// Add `extras` to headers a send path already set, skipping any whose name is
/// already there: those are the path's framing and credentials (a converter's
/// `anthropic-beta`, `chatgpt-account-id`, ...), which a custom header must not
/// displace or duplicate.
pub fn merge_onto(base: &mut Vec<(String, String)>, extras: &[(String, String)]) {
    for (name, value) in extras {
        if base.iter().any(|(n, _)| n.eq_ignore_ascii_case(name)) {
            warn_skipped(name, "set by the provider's transport");
            continue;
        }
        base.push((name.clone(), value.clone()));
    }
}

/// Custom header names worth reporting (`jan cli agent status`): the ones that
/// survive the reserved filter, in first-seen order, one per name.
pub fn reportable_names(custom: &[ProviderCustomHeader]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for header in custom {
        let name = header.header.trim();
        if name.is_empty() || is_reserved(name) {
            continue;
        }
        if !names.iter().any(|n| n.eq_ignore_ascii_case(name)) {
            names.push(name.to_string());
        }
    }
    names
}

/// Warn once per header name: the same configuration is sent on every request,
/// and a warning per request would bury the log. Names only; a header value can
/// carry a credential.
fn warn_skipped(name: &str, why: &str) {
    static WARNED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    let mut warned = WARNED.lock().unwrap_or_else(|e| e.into_inner());
    if warned
        .get_or_insert_with(HashSet::new)
        .insert(name.to_ascii_lowercase())
    {
        log::warn!("not sending custom header '{name}': {why}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(pairs: &[(&str, &str)]) -> Vec<ProviderCustomHeader> {
        pairs
            .iter()
            .map(|(h, v)| ProviderCustomHeader {
                header: (*h).to_string(),
                value: (*v).to_string(),
            })
            .collect()
    }

    fn names(headers: &[(String, String)]) -> Vec<String> {
        headers
            .iter()
            .map(|(n, _)| n.to_ascii_lowercase())
            .collect()
    }

    #[test]
    fn the_session_header_is_the_correlation_id_without_its_prefix() {
        let owned = owned(None, Some("jan-3f7a-91c2"));
        assert_eq!(
            owned,
            vec![
                (
                    "X-Client-Request-Id".to_string(),
                    "jan-3f7a-91c2".to_string()
                ),
                ("X-Session-Id".to_string(), "3f7a-91c2".to_string()),
            ]
        );
        assert!(super::owned(None, None).is_empty(), "no session, no ids");
    }

    /// The desktop never sets one, so it keeps sending none; the CLI's is the
    /// product token a gateway labels the traffic by.
    #[test]
    fn the_user_agent_is_sent_only_when_the_binary_set_one() {
        assert!(!names(&owned(None, Some("jan-s"))).contains(&"user-agent".to_string()));
        assert!(
            user_agent().is_none(),
            "nothing in the library sets a User-Agent; only the jan binary does"
        );
        let ua = agent_user_agent("0.8.5-1");
        assert!(ua.starts_with("Jan-Agent/0.8.5-1 ("), "{ua}");
        assert_eq!(owned(Some(&ua), None), vec![("User-Agent".to_string(), ua)]);
    }

    #[test]
    fn reserved_and_invalid_custom_headers_are_dropped() {
        let out = extras(
            &custom(&[
                ("Authorization", "Bearer other"),
                ("x-API-key", "second-credential"),
                ("X-Goog-Api-Key", "g"),
                ("anthropic-version", "1999-01-01"),
                ("Content-Type", "text/plain"),
                ("Accept", "*/*"),
                ("Accept-Encoding", "gzip"),
                ("Bad Name", "v"),
                ("X-Newline", "a\r\nInjected: yes"),
                ("X-Client-Name", "jan-agent"),
            ]),
            Vec::new(),
        );
        assert_eq!(
            out,
            vec![("X-Client-Name".to_string(), "jan-agent".to_string())]
        );
    }

    /// Jan's own values win over a custom header of the same name, whatever its
    /// case, and a name never appears twice.
    #[test]
    fn jan_owned_headers_win_over_custom_ones() {
        let out = extras(
            &custom(&[
                ("user-agent", "spoofed/1.0"),
                ("x-session-id", "not-this-one"),
                ("X-CLIENT-REQUEST-ID", "nor-this"),
                ("X-Tokamak-Launch-Id", "abc"),
            ]),
            owned(Some("Jan-Agent/1 (linux; x86_64)"), Some("jan-s1")),
        );
        assert_eq!(
            out,
            vec![
                ("X-Tokamak-Launch-Id".to_string(), "abc".to_string()),
                (
                    "User-Agent".to_string(),
                    "Jan-Agent/1 (linux; x86_64)".to_string()
                ),
                ("X-Client-Request-Id".to_string(), "jan-s1".to_string()),
                ("X-Session-Id".to_string(), "s1".to_string()),
            ]
        );
    }

    #[test]
    fn a_repeated_custom_name_keeps_the_later_value() {
        let out = extras(&custom(&[("X-Team", "a"), ("x-team", "b")]), Vec::new());
        assert_eq!(out, vec![("x-team".to_string(), "b".to_string())]);
    }

    /// A converter's own headers are its credentials and protocol version; a
    /// custom header with the same name must neither replace nor duplicate one.
    #[test]
    fn merging_never_duplicates_a_header_the_transport_set() {
        let mut base = vec![
            ("x-api-key".to_string(), "real".to_string()),
            ("anthropic-beta".to_string(), "oauth".to_string()),
        ];
        merge_onto(
            &mut base,
            &[
                ("Anthropic-Beta".to_string(), "custom".to_string()),
                ("X-Client-Name".to_string(), "jan-agent".to_string()),
            ],
        );
        assert_eq!(
            base,
            vec![
                ("x-api-key".to_string(), "real".to_string()),
                ("anthropic-beta".to_string(), "oauth".to_string()),
                ("X-Client-Name".to_string(), "jan-agent".to_string()),
            ]
        );
    }

    #[test]
    fn reported_names_are_the_ones_that_can_be_sent() {
        assert_eq!(
            reportable_names(&custom(&[
                ("X-Client-Name", "jan-agent"),
                ("Authorization", "x"),
                ("x-client-name", "dup"),
                ("X-Tokamak-Launch-Id", "abc"),
            ])),
            vec![
                "X-Client-Name".to_string(),
                "X-Tokamak-Launch-Id".to_string()
            ]
        );
    }
}
