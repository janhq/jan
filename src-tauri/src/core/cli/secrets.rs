//! Secret scrubbing shared by the persistent log sink and the bug-report
//! archive.
//!
//! Two sinks now write user text to disk: `file_log` (every record, as it
//! happens) and `doctor` (the bundle a user attaches to an issue). Both need
//! the same answer to "is this a credential?", so the rules live here once.
//!
//! The rules are deliberately broad and matched on text: an upstream error can
//! echo the request's `Authorization` header back, a user can paste a key into
//! a prompt, and a provider can name a token in a message. Over-matching costs
//! a `<redacted>` in a log line; under-matching leaks a credential into a file
//! that gets attached to a public issue.

use std::borrow::Cow;
use std::sync::LazyLock;

use regex::Regex;

/// One redaction rule: a labelled regex. The regex matches the secret value
/// region only (never the surrounding label), so the whole match is replaced.
pub(crate) struct Rule {
    pub(crate) label: &'static str,
    pub(crate) re: Regex,
}

/// Strips secrets from free text and tallies how many of each kind it hit.
pub(crate) struct Redactor {
    pub(crate) rules: Vec<Rule>,
}

/// The process-wide redactor. The regexes are compiled once: the log sink runs
/// them on every record, and recompiling ten patterns per line would put real
/// work on a path that exists only to write a breadcrumb.
pub(crate) static SHARED: LazyLock<Redactor> = LazyLock::new(Redactor::new);

impl Redactor {
    pub(crate) fn new() -> Self {
        // Authorization headers first (they contain a bearer whose value other
        // rules would also match), then explicit key-like config values, then
        // well-known provider token prefixes, then long opaque tokens.
        let rules = vec![
            Rule {
                label: "authorization header",
                re: Regex::new(
                    r#"(?i)(["']?authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)[A-Za-z0-9._~+/\-=]+"#,
                )
                .expect("auth header regex"),
            },
            Rule {
                label: "api key / token value",
                // Handles both `api_key="..."` and JSON `"api_key":"..."`
                // (quotes are allowed around the key name and the value).
                re: Regex::new(
                    r#"(?i)["']?(?:api[_-]?key|apikey|secret|token|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/\-=]{12,}"#,
                )
                .expect("key regex"),
            },
            Rule {
                label: "jwt",
                re: Regex::new(
                    r"(?i)eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
                )
                .expect("jwt regex"),
            },
            Rule {
                label: "sk/pk provider key",
                re: Regex::new(r"(?i)\b(?:sk|pk)-[A-Za-z0-9_\-]{16,}")
                    .expect("sk key regex"),
            },
            Rule {
                label: "google api key",
                re: Regex::new(r"\bAIza[A-Za-z0-9_\-]{20,}").expect("google key regex"),
            },
            Rule {
                label: "github token",
                re: Regex::new(r"\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})")
                    .expect("github token regex"),
            },
            Rule {
                label: "slack token",
                re: Regex::new(r"\bxox[baprs]-[A-Za-z0-9-]{16,}").expect("slack token regex"),
            },
            Rule {
                label: "aws access key",
                re: Regex::new(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b").expect("aws key regex"),
            },
            Rule {
                label: "nvidia api key",
                re: Regex::new(r"\bnvapi-[A-Za-z0-9_-]{16,}").expect("nvidia key regex"),
            },
            Rule {
                label: "opaque oauth token",
                re: Regex::new(
                    r"\b(?:ya29\.[A-Za-z0-9_\-]{30,}|sq0atp-[A-Za-z0-9_\-]{20,}|sk_live_[A-Za-z0-9]{16,})",
                )
                .expect("opaque token regex"),
            },
        ];
        Redactor { rules }
    }

    /// Replace every match with `<redacted>`; `hits` records per-rule counts.
    pub(crate) fn redact(&self, input: &str, hits: &mut [usize]) -> String {
        let mut out = Cow::Borrowed(input);
        for (i, rule) in self.rules.iter().enumerate() {
            if let Some(replaced) = apply(&rule.re, &out, Some(&mut hits[i])) {
                out = Cow::Owned(replaced);
            }
        }
        out.into_owned()
    }

    /// Redact without tallying, borrowing the input when it holds no secret.
    ///
    /// This is the log sink's path: it runs on every record, and the
    /// overwhelmingly common case is a clean line, which must not allocate.
    pub(crate) fn scrub<'a>(&self, input: &'a str) -> Cow<'a, str> {
        let mut out = Cow::Borrowed(input);
        for rule in &self.rules {
            if let Some(replaced) = apply(&rule.re, &out, None) {
                out = Cow::Owned(replaced);
            }
        }
        out
    }
}

/// Replace every match of `re` in `text`, returning `None` when it does not
/// match at all so the caller can keep borrowing the original.
///
/// Spans are collected before any replacement so a `<redacted>` inserted by
/// this rule is never re-scanned by it.
fn apply(re: &Regex, text: &str, hits: Option<&mut usize>) -> Option<String> {
    let spans: Vec<(usize, usize)> = re.find_iter(text).map(|m| (m.start(), m.end())).collect();
    if spans.is_empty() {
        return None;
    }
    if let Some(n) = hits {
        *n += spans.len();
    }
    let mut result = String::with_capacity(text.len());
    let mut last = 0;
    for (s, e) in spans {
        result.push_str(&text[last..s]);
        result.push_str("<redacted>");
        last = e;
    }
    result.push_str(&text[last..]);
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A clean line is the common case on the log path: it must come back
    /// borrowed, with no allocation.
    #[test]
    fn scrub_borrows_a_clean_line() {
        let line = "agent: run finished outcome=ok stop=stop elapsed=6022ms";
        assert!(matches!(SHARED.scrub(line), Cow::Borrowed(_)));
    }

    /// The leak this module exists for: a provider echoed the request's
    /// `Authorization` header inside its error body, and that error is written
    /// to `jan.log` as a breadcrumb.
    #[test]
    fn scrub_strips_an_echoed_authorization_header() {
        let line = "agent: run finished outcome=error -- Body: \
                    {\"error\":{\"message\":\"bad request; authorization: Bearer \
                    sk-live-11112222333344445555\"}}";
        let out = SHARED.scrub(line);
        assert!(!out.contains("sk-live-11112222333344445555"), "leaked: {out}");
        assert!(out.contains("<redacted>"), "replacement is marked: {out}");
        assert!(out.contains("outcome=error"), "the breadcrumb survives: {out}");
    }

    /// Scrubbing must not depend on where in the line the secret sits: a key
    /// past any truncation budget is exactly the case that fooled an earlier
    /// truncation-only fix.
    #[test]
    fn scrub_strips_a_key_far_into_a_long_line() {
        let line = format!("prefix {} api_key=sk-live-99998888777766665555", "x".repeat(4000));
        let out = SHARED.scrub(&line);
        assert!(!out.contains("sk-live-99998888777766665555"), "leaked past the budget");
    }
}
