//! Zero-PII string scrubber (Rust mirror of `web-app/src/lib/telemetry.ts`
//! `scrubPii`). Implemented without `regex` to avoid pulling a heavy new
//! dependency into the desktop binary.
//!
//! Masks, while preserving structure for debugging:
//! - OS-username path segments: `/Users/<u>/`, `/home/<u>/`, `\Users\<u>\`.
//! - Proxy/URL credentials: `scheme://<userinfo>@host` -> `scheme://<redacted>@host`.
//! - Hugging Face tokens (`hf_...`) and `Bearer <token>` headers.
//! - Values of sensitive query parameters (token/key/api_key/secret/...),
//!   keeping the parameter name and the rest of the URL.

const REDACTED: &str = "<redacted>";

/// Separators that terminate a masked path segment.
const PATH_SEPS: &[char] = &[
    '/', '\\', ' ', '"', '\'', '\n', '\r', '\t', ')', ']', '}', ',', ';', ':', '|',
];

/// Sensitive query-parameter names whose *values* are redacted. Longer keys
/// first is not required because each match is anchored to `key=` at a
/// `?`/`&` boundary.
const SECRET_QUERY_KEYS: &[&str] = &[
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "password",
    "secret",
    "signature",
    "token",
    "auth",
    "key",
    "sig",
];

pub fn scrub(input: &str) -> String {
    let s = mask_home_paths(input);
    let s = mask_proxy_creds(&s);
    let s = mask_prefixed_token(&s, "hf_");
    let s = mask_bearer(&s);
    mask_query_secrets(&s)
}

/// Replace the first path segment after each home-dir marker with `<redacted>`.
fn mask_home_paths(input: &str) -> String {
    let s = mask_segment_after(input, "/Users/");
    let s = mask_segment_after(&s, "/home/");
    mask_segment_after(&s, "\\Users\\")
}

fn mask_segment_after(input: &str, marker: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find(marker) {
        let (before, after) = rest.split_at(pos + marker.len());
        out.push_str(before);
        let seg_end = after.find(PATH_SEPS).unwrap_or(after.len());
        if seg_end > 0 {
            out.push_str(REDACTED);
        }
        rest = &after[seg_end..];
    }
    out.push_str(rest);
    out
}

/// `scheme://user:pass@host` -> `scheme://<redacted>@host`.
fn mask_proxy_creds(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find("://") {
        let (before, after) = rest.split_at(pos + 3);
        out.push_str(before);
        let at = after.find('@');
        let authority_end =
            after.find(|c: char| c == '/' || c == '?' || c == '#' || c.is_whitespace());
        match at {
            Some(at_idx) if authority_end.map_or(true, |end| at_idx < end) => {
                out.push_str(REDACTED);
                rest = &after[at_idx..]; // keep "@host..."
            }
            _ => rest = after,
        }
    }
    out.push_str(rest);
    out
}

/// Replace `prefix` + following `[A-Za-z0-9_]+` run (e.g. `hf_xxx`) with `<redacted>`.
fn mask_prefixed_token(input: &str, prefix: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find(prefix) {
        let (before, after) = rest.split_at(pos);
        out.push_str(before);
        let token_rest = &after[prefix.len()..];
        let end = token_rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(token_rest.len());
        out.push_str(REDACTED);
        rest = &token_rest[end..];
    }
    out.push_str(rest);
    out
}

/// `Bearer <token>` -> `Bearer <redacted>` (case-insensitive keyword).
fn mask_bearer(input: &str) -> String {
    const KW: &str = "bearer ";
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut idx = 0;
    while let Some(rel) = lower[idx..].find(KW) {
        let kw_end = idx + rel + KW.len();
        out.push_str(&input[idx..kw_end]);
        let token_rest = &input[kw_end..];
        let end = token_rest
            .find(char::is_whitespace)
            .unwrap_or(token_rest.len());
        if end > 0 {
            out.push_str(REDACTED);
        }
        idx = kw_end + end;
    }
    out.push_str(&input[idx..]);
    out
}

/// Redact the values of sensitive query parameters, keeping the key + URL shape.
fn mask_query_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        let Some(delim) = rest.find(|c| c == '?' || c == '&') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..=delim]);
        let after = &rest[delim + 1..];

        let mut matched = false;
        for key in SECRET_QUERY_KEYS {
            let klen = key.len();
            if after.len() > klen
                && after[..klen].eq_ignore_ascii_case(key)
                && after.as_bytes()[klen] == b'='
            {
                out.push_str(&after[..=klen]); // "key="
                let val = &after[klen + 1..];
                let val_end = val
                    .find(|c: char| {
                        c == '&' || c == '#' || c == '"' || c == '\'' || c.is_whitespace()
                    })
                    .unwrap_or(val.len());
                out.push_str(REDACTED);
                rest = &val[val_end..];
                matched = true;
                break;
            }
        }
        if !matched {
            rest = after;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::scrub;

    #[test]
    fn masks_macos_username_keeps_structure() {
        assert_eq!(
            scrub("/Users/misha/Work/Atomic/app.log"),
            "/Users/<redacted>/Work/Atomic/app.log"
        );
    }

    #[test]
    fn masks_linux_home_and_windows_user() {
        assert_eq!(scrub("/home/misha/data"), "/home/<redacted>/data");
        assert_eq!(
            scrub("C:\\Users\\misha\\AppData"),
            "C:\\Users\\<redacted>\\AppData"
        );
    }

    #[test]
    fn masks_proxy_credentials() {
        assert_eq!(
            scrub("http://user:pass@proxy.local:8080/path"),
            "http://<redacted>@proxy.local:8080/path"
        );
    }

    #[test]
    fn masks_hf_and_bearer_tokens() {
        assert_eq!(scrub("token=hf_AbC123def"), "token=<redacted>");
        assert_eq!(
            scrub("Authorization: Bearer abc.def-123"),
            "Authorization: Bearer <redacted>"
        );
    }

    #[test]
    fn masks_sensitive_query_values_keeps_names() {
        assert_eq!(
            scrub("https://hf.co/x?api_key=secret123&model=gemma"),
            "https://hf.co/x?api_key=<redacted>&model=gemma"
        );
        assert_eq!(
            scrub("https://h/o?download=true&KEY=zzz"),
            "https://h/o?download=true&KEY=<redacted>"
        );
    }

    #[test]
    fn leaves_clean_text_untouched() {
        let clean = "model gemma-4 failed to load: out of memory (n_gpu_layers=48)";
        assert_eq!(scrub(clean), clean);
    }
}
