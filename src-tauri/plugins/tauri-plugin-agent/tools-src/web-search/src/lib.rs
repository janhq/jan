//! Multi-provider web-search WASM skill.
//!
//! Provider cascade:
//!   1. **Brave** — best results; host injects `BRAVE_API_KEY` as
//!      `X-Subscription-Token` header automatically (no key visible to WASM).
//!   2. **DuckDuckGo HTML** — zero-config fallback; host injects a browser
//!      User-Agent so DDG doesn't bot-detect the request.
//!   3. **DuckDuckGo Instant Answer** — last resort; only works for
//!      Wikipedia-style factual queries but never fails with network errors.
//!
//! Output format:
//! ```text
//! Search results for 'query' (Brave):
//!
//! 1. Title
//!    URL: https://...
//!    Description snippet.
//!
//! 2. ...
//! ```
//!
//! # Build
//! ```sh
//! cargo build --target wasm32-wasip1 --release
//! cp target/wasm32-wasip1/release/web_search_tool.wasm ../../wasm/skills/web/search.wasm
//! ```

// ── Host imports ──────────────────────────────────────────────────────────────

#[link(wasm_import_module = "host")]
extern "C" {
    fn log(ptr: i32, len: i32);
    fn http_get(url_ptr: i32, url_len: i32, buf_ptr: i32, buf_max: i32) -> i32;
}

// ── Static buffers ────────────────────────────────────────────────────────────

const HTTP_BUF_MAX: usize = 256 * 1024;
static mut HTTP_BUF: [u8; HTTP_BUF_MAX] = [0u8; HTTP_BUF_MAX];
static mut OUTPUT: Vec<u8> = Vec::new();

// ── Tool exports ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn description() -> i64 { str_to_packed(DESCRIPTION) }

#[no_mangle]
pub extern "C" fn schema() -> i64 { str_to_packed(SCHEMA) }

#[no_mangle]
pub extern "C" fn run(input_ptr: i32, input_len: i32) -> i64 {
    let input = unsafe {
        core::slice::from_raw_parts(input_ptr as *const u8, input_len as usize)
    };
    let result = execute(input);
    unsafe {
        OUTPUT = result;
        vec_to_packed(&OUTPUT)
    }
}

// ── Execution ─────────────────────────────────────────────────────────────────

fn execute(input: &[u8]) -> Vec<u8> {
    let params: serde_json::Value = match serde_json::from_slice(input) {
        Ok(v) => v,
        Err(e) => return error_json(&format!("invalid params: {e}")),
    };

    let query = match params["query"].as_str() {
        Some(q) if !q.is_empty() => q.to_owned(),
        _ => return error_json("'query' is required"),
    };

    let max_results = params["max_results"].as_u64().unwrap_or(5) as usize;

    host_log(&format!("web.search: {query:?} max={max_results}"));

    // ── 1. Brave Search (host injects BRAVE_API_KEY header) ───────────────────

    let brave_url = format!(
        "https://api.search.brave.com/res/v1/web/search?q={}&count={max_results}",
        url_encode(&query)
    );

    let n = fetch_into_buf(&brave_url);
    if n > 0 {
        let body = unsafe { &HTTP_BUF[..n as usize] };
        if let Some(output) = parse_brave(body, &query) {
            host_log("brave: ok");
            return output;
        }
        host_log("brave: no results or API key not set");
    } else {
        host_log("brave: http_get failed");
    }

    // ── 2. DuckDuckGo HTML (host injects browser User-Agent) ──────────────────

    let ddg_html_url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        url_encode(&query)
    );

    let n = fetch_into_buf(&ddg_html_url);
    if n > 0 {
        let body = unsafe { &HTTP_BUF[..n as usize] };
        let html = core::str::from_utf8(body).unwrap_or("");
        let results = parse_ddg_results(html, max_results);
        if !results.is_empty() {
            host_log(&format!("ddg-html: {} results", results.len()));
            let text = format_numbered(&query, "", &results);
            return ok_json(&query, &text, &ddg_html_url);
        }
        host_log("ddg-html: no results (bot-detected or empty page)");
    } else {
        host_log("ddg-html: http_get failed");
    }

    // ── 3. DuckDuckGo Instant Answer (last resort) ────────────────────────────

    let ddg_ia_url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        url_encode(&query)
    );

    let n = fetch_into_buf(&ddg_ia_url);
    if n > 0 {
        let body = unsafe { &HTTP_BUF[..n as usize] };
        if let Ok(resp) = serde_json::from_slice::<serde_json::Value>(body) {
            let text = resp["AbstractText"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or_else(|| resp["Answer"].as_str().filter(|s| !s.is_empty()));
            if let Some(t) = text {
                host_log("ddg-ia: instant answer hit");
                let source = resp["AbstractURL"].as_str().unwrap_or("").to_string();
                return ok_json(&query, t, &source);
            }
        }
        host_log("ddg-ia: empty response");
    }

    // All providers exhausted.
    host_log("all providers failed");
    error_json(&format!(
        "No results found for '{query}'. \
         Set BRAVE_API_KEY for full web search."
    ))
}

// ── Brave response parser ─────────────────────────────────────────────────────

fn parse_brave(body: &[u8], query: &str) -> Option<Vec<u8>> {
    let resp: serde_json::Value = serde_json::from_slice(body).ok()?;

    // 401 / error_response → API key not set
    if resp.get("type").and_then(|t| t.as_str()) == Some("error_response") {
        return None;
    }

    let web_results = resp["web"]["results"].as_array()?;
    if web_results.is_empty() {
        return None;
    }

    let items: Vec<(String, String, String)> = web_results
        .iter()
        .filter_map(|r| {
            let title = r["title"].as_str()?.to_string();
            let url   = r["url"].as_str()?.to_string();
            let desc  = r["description"].as_str().unwrap_or("").to_string();
            Some((title, url, desc))
        })
        .collect();

    if items.is_empty() {
        return None;
    }

    let text = format_numbered(query, "Brave", &items);
    let source = items[0].1.clone();
    Some(ok_json(query, &text, &source))
}

// ── DuckDuckGo HTML parser ───────────────

/// Parse DuckDuckGo HTML search results into `(title, url, snippet)` tuples.
///
/// split on `class="result__a"` to isolate each
/// result block, then extract href (with `/l/?uddg=` redirect decoding),
/// title text, and nearby snippet.
fn parse_ddg_results(html: &str, max: usize) -> Vec<(String, String, String)> {
    let mut results = Vec::new();

    for chunk in html.split("class=\"result__a\"") {
        if results.len() >= max {
            break;
        }
        if !chunk.contains("href=") {
            continue;
        }

        // Extract raw href value.
        let raw_url = match extract_between(chunk, "href=\"", "\"") {
            Some(u) => u.to_string(),
            None    => continue,
        };

        // DDG wraps results in `/l/?uddg=PERCENT_ENCODED_URL&rut=...`
        let url = if raw_url.contains("uddg=") {
            raw_url.split("uddg=")
                .nth(1)
                .and_then(|u| u.split('&').next())
                .map(urldecode)
                .unwrap_or(raw_url)
        } else {
            raw_url
        };

        let title = extract_between(chunk, ">", "</a>")
            .map(strip_html_tags)
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_default();

        let snippet = chunk.find("class=\"result__snippet\"")
            .map(|pos| {
                let after = &chunk[pos..];
                extract_between(after, ">", "</a>")
                    .or_else(|| extract_between(after, ">", "</"))
                    .map(strip_html_tags)
                    .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        if !title.is_empty() && !url.is_empty() {
            results.push((title, url, snippet));
        }
    }

    results
}

// ── Output formatters ─────────────────────────────────────────────────────────

/// Format results as a numbered list .
fn format_numbered(query: &str, provider: &str, items: &[(String, String, String)]) -> String {
    let header = if provider.is_empty() {
        format!("Search results for '{query}':\n\n")
    } else {
        format!("Search results for '{query}' ({provider}):\n\n")
    };

    items.iter().enumerate().fold(header, |mut s, (i, (title, url, snippet))| {
        s.push_str(&format!("{}. {}\n   URL: {}\n   {}\n\n", i + 1, title, url, snippet));
        s
    })
}

fn ok_json(query: &str, result: &str, source: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "query":  query,
        "result": result,
        "source": source,
    }))
    .unwrap_or_else(|_| b"{}".to_vec())
}

// ── String helpers ───────────────────────

/// Extract the substring between `start` and `end` delimiters.
fn extract_between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let s = text.find(start)? + start.len();
    let tail = &text[s..];
    let e = tail.find(end)?;
    Some(&tail[..e])
}

/// Strip HTML tags and decode common entities.
fn strip_html_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
        .replace("&amp;",  "&")
        .replace("&lt;",   "<")
        .replace("&gt;",   ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;",  "'")
        .replace("&nbsp;", " ")
}

/// Percent-decode a URL string (handles DDG's `uddg=` redirect parameter).
fn urldecode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else if ch == '+' {
            result.push(' ');
        } else {
            result.push(ch);
        }
    }
    result
}

/// Percent-encode a query string for use in URLs.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            b    => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Issue an HTTP GET and write the response into `HTTP_BUF`.
fn fetch_into_buf(url: &str) -> i32 {
    unsafe {
        http_get(
            url.as_ptr() as i32,
            url.len() as i32,
            HTTP_BUF.as_ptr() as i32,
            HTTP_BUF_MAX as i32,
        )
    }
}

// ── Logging + error helpers ───────────────────────────────────────────────────

fn host_log(msg: &str) {
    unsafe { log(msg.as_ptr() as i32, msg.len() as i32) }
}

fn error_json(msg: &str) -> Vec<u8> {
    host_log(&format!("error: {msg}"));
    format!(r#"{{"error":"{msg}"}}"#).into_bytes()
}

// ── ABI helpers ───────────────────────────────────────────────────────────────

fn str_to_packed(s: &'static str) -> i64 {
    (s.as_ptr() as i64) << 32 | s.len() as i64
}

fn vec_to_packed(v: &[u8]) -> i64 {
    (v.as_ptr() as i64) << 32 | v.len() as i64
}

// ── Metadata ──────────────────────────────────────────────────────────────────

const DESCRIPTION: &str =
    "Search the web. Tries Brave Search API first (set BRAVE_API_KEY env var), \
     then DuckDuckGo HTML, then DuckDuckGo Instant Answer as fallback. \
     Returns numbered result snippets with titles and URLs.";

const SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "max_results": {
      "type": "integer",
      "description": "Maximum number of results to return (default: 5)",
      "default": 5
    }
  },
  "required": ["query"],
  "additionalProperties": false
}"#;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_ddg_result() {
        let html = r#"junk class="result__a" href="https://example.com">Example Title</a> class="result__snippet">A useful snippet</a>"#;
        let results = parse_ddg_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "Example Title");
        assert_eq!(results[0].1, "https://example.com");
        assert_eq!(results[0].2, "A useful snippet");
    }

    #[test]
    fn parse_ddg_redirect_url() {
        let html = r#"x class="result__a" href="/l/?uddg=https%3A%2F%2Frust-lang.org&rut=abc">Rust</a> class="result__snippet">Systems language</a>"#;
        let results = parse_ddg_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, "https://rust-lang.org");
    }

    #[test]
    fn parse_multiple_results_respects_max() {
        let html = r#"
            before class="result__a" href="https://a.com">A</a> class="result__snippet">Snippet A</a>
            between class="result__a" href="https://b.com">B</a> class="result__snippet">Snippet B</a>
            after  class="result__a" href="https://c.com">C</a> class="result__snippet">Snippet C</a>
        "#;
        let results = parse_ddg_results(html, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "A");
        assert_eq!(results[1].0, "B");
    }

    #[test]
    fn parse_empty_html() {
        let results = parse_ddg_results("<html><body>No results</body></html>", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn strip_html_tags_basic() {
        assert_eq!(strip_html_tags("<b>Hello</b> &amp; world"), "Hello & world");
        assert_eq!(strip_html_tags("A &nbsp; B"), "A   B");
        assert_eq!(strip_html_tags("it&#39;s"), "it's");
    }

    #[test]
    fn urldecode_basic() {
        assert_eq!(urldecode("hello+world"), "hello world");
        assert_eq!(urldecode("https%3A%2F%2Fexample.com"), "https://example.com");
    }

    #[test]
    fn extract_between_basic() {
        assert_eq!(extract_between("foo<bar>baz", "<", ">"), Some("bar"));
        assert_eq!(extract_between("no match here", "<", ">"), None);
    }

    #[test]
    fn format_numbered_output() {
        let items = vec![
            ("Title 1".into(), "https://a.com".into(), "Desc 1".into()),
            ("Title 2".into(), "https://b.com".into(), "Desc 2".into()),
        ];
        let out = format_numbered("rust", "Brave", &items);
        assert!(out.contains("1. Title 1"));
        assert!(out.contains("URL: https://a.com"));
        assert!(out.contains("2. Title 2"));
    }
}
