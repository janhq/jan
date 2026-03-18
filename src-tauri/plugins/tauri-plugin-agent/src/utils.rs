//! Shared utility functions for the agent plugin.

use serde_json::Value;

// ── String helpers ─────────────────────────────────────────────────────────────

/// Truncate to at most `max_chars` Unicode scalar values; appends "…" if cut.
pub fn truncate_str(s: &str, max_chars: usize) -> String {
    let mut out   = String::with_capacity(max_chars + 3);
    let mut count = 0;
    for c in s.chars() {
        if count == max_chars { out.push('…'); break; }
        out.push(c);
        count += 1;
    }
    out
}

// ── Tool result helpers ───────────────────────────────────────────────────────

/// Build a short human-readable summary of a tool result (≤ 80 chars).
pub fn summarize_result(skill_id: &str, result: &Value) -> String {
    let raw = match skill_id {
        "code.exec" => format!(
            "exit {}  {}",
            result["exit_code"].as_i64().unwrap_or(-1),
            result["stdout"].as_str().unwrap_or("").trim()
        ),
        "web.search" => result["result"]
            .as_str()
            .unwrap_or("(no result)")
            .to_string(),
        "http.fetch" => format!(
            "HTTP {}  {} bytes{}",
            result["status"].as_u64().unwrap_or(0),
            result["body"].as_str().map(|s| s.len()).unwrap_or(0),
            if result["truncated"].as_bool().unwrap_or(false) { " (truncated)" } else { "" }
        ),
        _ => result.to_string(),
    };
    truncate_str(&raw, 80)
}

/// Compress a tool result before storing it in the message history.
///
/// - `http.fetch` — HTML body → stripped plain text.
/// - Everything else — passed through unchanged.
///
/// A hard character cap is applied after semantic compression as a last-resort safety net.
pub fn compress_tool_result(skill_id: &str, raw: String, max_chars: usize) -> String {
    let compressed = match skill_id {
        "http.fetch" => compress_http_fetch_body(raw),
        _            => raw,
    };

    let n = compressed.chars().count();
    if n > max_chars {
        let head: String = compressed.chars().take(max_chars).collect();
        format!("{head}…[{} chars omitted]", n - max_chars)
    } else {
        compressed
    }
}

/// Parse an `http.fetch` JSON result and replace the raw HTML `body` with plain text.
pub fn compress_http_fetch_body(raw: String) -> String {
    let mut v: Value = match serde_json::from_str(&raw) {
        Ok(v)  => v,
        Err(_) => return raw,
    };
    if let Some(body) = v["body"].as_str() {
        v["body"] = Value::String(extract_html_text(body));
    }
    serde_json::to_string(&v).unwrap_or(raw)
}

/// Extract readable text from an HTML string.
pub fn extract_html_text(html: &str) -> String {
    let mut out        = String::with_capacity(html.len() / 4);
    let mut in_tag     = false;
    let mut skip_block = false;
    let mut tag_buf    = String::new();
    let mut last_space = true;

    let mut chars = html.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '<' => {
                in_tag = true;
                tag_buf.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let t    = tag_buf.trim().to_ascii_lowercase();
                let name = t.trim_start_matches('/').split_whitespace().next().unwrap_or("");
                match name {
                    "script" | "style" => {
                        skip_block = !t.starts_with('/');
                    }
                    "p" | "div" | "br" | "li" | "tr" | "h1" | "h2" | "h3"
                    | "h4" | "h5" | "h6" | "td" | "th" => {
                        if !last_space {
                            out.push('\n');
                            last_space = true;
                        }
                    }
                    _ => {}
                }
            }
            _ if in_tag     => tag_buf.push(ch),
            _ if skip_block => {}
            _ => {
                if ch.is_ascii_whitespace() {
                    if !last_space { out.push(' '); last_space = true; }
                } else {
                    out.push(ch);
                    last_space = false;
                }
            }
        }
    }

    out.replace("&amp;",  "&")
       .replace("&lt;",   "<")
       .replace("&gt;",   ">")
       .replace("&quot;", "\"")
       .replace("&#39;",  "'")
       .replace("&#x27;", "'")
       .replace("&nbsp;", " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_short_unchanged() {
        assert_eq!(truncate_str("hello", 80), "hello");
    }

    #[test]
    fn truncate_long_appends_ellipsis() {
        let s = "a".repeat(90);
        let r = truncate_str(&s, 80);
        assert!(r.ends_with('…'));
        assert_eq!(r.chars().count(), 81);
    }

    #[test]
    fn compress_passes_non_fetch_unchanged() {
        let s = r#"{"result":"ok"}"#.to_string();
        assert_eq!(compress_tool_result("web.search", s.clone(), 4096), s);
    }

    #[test]
    fn compress_http_fetch_strips_html() {
        let body = "<html><head><style>body{}</style></head><body>\
                    <h1>Title</h1><p>Hello world</p>\
                    <script>var x=1</script></body></html>";
        let json = serde_json::json!({"status": 200, "body": body, "truncated": false}).to_string();
        let result = compress_tool_result("http.fetch", json, 4096);
        let v: Value = serde_json::from_str(&result).unwrap();
        let text = v["body"].as_str().unwrap();
        assert!(!text.contains("<html>"));
        assert!(!text.contains("body{}"));
        assert!(!text.contains("var x=1"));
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world"));
    }
}
