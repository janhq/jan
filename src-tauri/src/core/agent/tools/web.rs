//! Native, provider-neutral web tools compiled into the agent core.
//!
//! This module implements `web_search` and `web_fetch` as first-class built-in
//! tools — NOT as an MCP server registered with the agent. The agent calls the
//! stable, provider-neutral tool names (`web_search` / `web_fetch`) and never a
//! provider-branded name such as `exa_search`. The search backend is selected
//! behind a small adapter so a provider can change without touching the agent
//! tool contract.
//!
//! Per jan-internal#196, **Exa is the default backend**, not a product-facing
//! identity. Exa exposes two zero-config surfaces and this adapter picks the
//! right one automatically so web search works out of the box:
//!
//! * **Keyless (default):** Exa's hosted endpoint at `https://mcp.exa.ai/mcp`
//!   answers `web_search`/`web_fetch` over JSON-RPC with **no API key**. We call
//!   it directly over HTTP from the Rust core (plain `reqwest`), so this is a
//!   native compiled-in capability, not the agent's MCP client/registration.
//! * **Keyed (opt-in):** when an Exa API key is present in the environment we
//!   use the structured REST API (`https://api.exa.ai`) instead, which returns
//!   normalized JSON and higher rate limits.
//!
//! Either way the adapter normalizes results into the shared [`SearchResult`] /
//! [`FetchedPage`] contracts and bounds output size so tool results can't blow
//! up the model's context window.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Upper bound on the readable text `web_fetch` returns, so a single fetch can't
/// flood the context window. Roughly ~10k tokens of text.
const FETCH_MAX_CHARS: usize = 40_000;
/// Default number of search results when the caller doesn't specify `count`.
const SEARCH_DEFAULT_COUNT: u32 = 5;
/// Hard cap on requested results regardless of `count`.
const SEARCH_MAX_COUNT: u32 = 20;
/// Network timeout for a single provider request.
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// Exa's keyless hosted endpoint. Answers `web_search_exa` / `web_fetch_exa`
/// over JSON-RPC (MCP wire protocol) with no credential — this is the free path
/// that makes web search work out of the box.
const EXA_HOSTED_URL: &str = "https://mcp.exa.ai/mcp";
/// Exa's structured REST search endpoint (used only when a key is configured).
const EXA_REST_SEARCH_URL: &str = "https://api.exa.ai/search";
/// Exa's structured REST contents endpoint (used only when a key is configured).
const EXA_REST_CONTENTS_URL: &str = "https://api.exa.ai/contents";

/// Environment variables consulted for an optional Exa credential, in priority
/// order. `JAN_EXA_API_KEY` is Jan's namespaced variable; `EXA_API_KEY` matches
/// Exa's own convention and the key already used by the legacy Exa MCP
/// registration, so an existing configuration keeps working. When neither is
/// set, the keyless hosted path is used automatically.
const EXA_API_KEY_ENVS: &[&str] = &["JAN_EXA_API_KEY", "EXA_API_KEY"];

/// A single normalized web-search result. This is the stable contract the agent
/// sees, regardless of which backend or transport produced it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}

/// Normalized readable page content returned by `web_fetch`, carrying its source
/// URL/title and bounded text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FetchedPage {
    pub url: String,
    pub title: String,
    pub content: String,
    /// True when `content` was truncated to satisfy the output bound.
    pub truncated: bool,
}

/// The provider adapter contract. Jan owns provider selection, credentials, and
/// response normalization; the agent only ever sees the neutral tools above.
pub trait SearchProvider {
    /// Human-facing provider name used in error/config messages.
    fn name(&self) -> &'static str;
    /// Run a web search and return normalized results.
    fn search(
        &self,
        query: &str,
        count: u32,
    ) -> impl std::future::Future<Output = Result<Vec<SearchResult>, String>> + Send;
    /// Fetch a URL and return normalized, bounded readable content.
    fn fetch(
        &self,
        url: &str,
    ) -> impl std::future::Future<Output = Result<FetchedPage, String>> + Send;
}

/// Which backend is configured. Extend this enum (and `select_provider`) to add
/// Brave or another provider without changing the agent-facing tool names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Exa,
}

impl Provider {
    /// The default backend. Per the spec, Exa is the default; the tool contract
    /// stays provider-neutral regardless.
    pub const DEFAULT: Provider = Provider::Exa;
}

/// Read the first present, non-empty Exa API key from the environment, if any.
fn exa_api_key() -> Option<String> {
    for var in EXA_API_KEY_ENVS {
        if let Ok(v) = std::env::var(var) {
            let v = v.trim();
            if !v.is_empty() && v != "YOUR_EXA_API_KEY_HERE" {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Which Exa transport the adapter uses for a given process environment.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ExaMode {
    /// Keyless hosted JSON-RPC endpoint (the default free path).
    Hosted,
    /// Structured REST API, authenticated with the configured key.
    Rest(String),
}

/// Exa backend. Defaults to the keyless hosted endpoint so web search works with
/// no configuration; upgrades to the structured REST API when a key is present.
/// Kept behind the adapter so Exa is never exposed as the tool identity.
pub struct ExaProvider {
    mode: ExaMode,
    client: reqwest::Client,
}

impl ExaProvider {
    /// Build the Exa adapter, choosing the transport from the environment:
    /// a configured key selects the REST API, otherwise the keyless hosted
    /// endpoint. This never errors on missing credentials — web search is
    /// available out of the box.
    pub fn from_env() -> Result<Self, String> {
        let mode = match exa_api_key() {
            Some(key) => ExaMode::Rest(key),
            None => ExaMode::Hosted,
        };
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("ERROR: failed to build HTTP client for Exa: {e}"))?;
        Ok(Self { mode, client })
    }

    /// Call the keyless hosted endpoint's `tools/call` and return the text of the
    /// first content block. The endpoint speaks MCP-over-HTTP (JSON-RPC framed as
    /// an SSE `data:` line); we parse it directly rather than going through the
    /// agent's MCP client, keeping this a native, compiled-in capability.
    async fn hosted_call(&self, tool: &str, arguments: Value) -> Result<String, String> {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": tool, "arguments": arguments }
        });
        let resp = self
            .client
            .post(EXA_HOSTED_URL)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("ERROR: Exa request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("ERROR: Exa: failed to read response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "ERROR: Exa failed with HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        parse_hosted_result_text(&text)
    }
}

impl SearchProvider for ExaProvider {
    fn name(&self) -> &'static str {
        "Exa"
    }

    async fn search(&self, query: &str, count: u32) -> Result<Vec<SearchResult>, String> {
        match &self.mode {
            ExaMode::Hosted => {
                let text = self
                    .hosted_call(
                        "web_search_exa",
                        json!({ "query": query, "numResults": count }),
                    )
                    .await?;
                Ok(parse_hosted_search_text(&text))
            }
            ExaMode::Rest(key) => {
                let body = json!({
                    "query": query,
                    "type": "auto",
                    "numResults": count,
                    "contents": {
                        "text": { "maxCharacters": 800 },
                        "highlights": { "numSentences": 3, "highlightsPerUrl": 1 }
                    }
                });
                let resp = self
                    .client
                    .post(EXA_REST_SEARCH_URL)
                    .header("x-api-key", key)
                    .header("content-type", "application/json")
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| format!("ERROR: Exa search request failed: {e}"))?;
                let status = resp.status();
                let text = resp.text().await.map_err(|e| {
                    format!("ERROR: Exa search: failed to read response body: {e}")
                })?;
                if !status.is_success() {
                    return Err(format!(
                        "ERROR: Exa search failed with HTTP {}: {}",
                        status.as_u16(),
                        text.chars().take(400).collect::<String>()
                    ));
                }
                let parsed: Value = serde_json::from_str(&text)
                    .map_err(|e| format!("ERROR: Exa search: invalid JSON response: {e}"))?;
                Ok(normalize_exa_rest_search(&parsed))
            }
        }
    }

    async fn fetch(&self, url: &str) -> Result<FetchedPage, String> {
        match &self.mode {
            ExaMode::Hosted => {
                let text = self
                    .hosted_call(
                        "web_fetch_exa",
                        json!({ "urls": [url], "maxCharacters": FETCH_MAX_CHARS }),
                    )
                    .await?;
                Ok(parse_hosted_fetch_text(&text, url))
            }
            ExaMode::Rest(key) => {
                let body = json!({ "ids": [url], "text": true });
                let resp = self
                    .client
                    .post(EXA_REST_CONTENTS_URL)
                    .header("x-api-key", key)
                    .header("content-type", "application/json")
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| format!("ERROR: Exa fetch request failed: {e}"))?;
                let status = resp.status();
                let text = resp
                    .text()
                    .await
                    .map_err(|e| format!("ERROR: Exa fetch: failed to read response body: {e}"))?;
                if !status.is_success() {
                    return Err(format!(
                        "ERROR: Exa fetch failed with HTTP {}: {}",
                        status.as_u16(),
                        text.chars().take(400).collect::<String>()
                    ));
                }
                let parsed: Value = serde_json::from_str(&text)
                    .map_err(|e| format!("ERROR: Exa fetch: invalid JSON response: {e}"))?;
                normalize_exa_rest_fetch(&parsed, url)
            }
        }
    }
}

/// Extract `result.content[0].text` from a hosted-endpoint response. The body is
/// either raw JSON or an SSE frame (`event: message\ndata: {json}`); handle both.
fn parse_hosted_result_text(body: &str) -> Result<String, String> {
    let json_str = body
        .lines()
        .find_map(|l| l.strip_prefix("data:").map(str::trim))
        .unwrap_or_else(|| body.trim());
    let parsed: Value = serde_json::from_str(json_str)
        .map_err(|e| format!("ERROR: Exa: invalid response payload: {e}"))?;
    if let Some(err) = parsed.get("error") {
        return Err(format!("ERROR: Exa returned an error: {err}"));
    }
    let result = parsed
        .get("result")
        .ok_or("ERROR: Exa response missing 'result'")?;
    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        return Err(format!(
            "ERROR: Exa tool call failed: {}",
            result
                .get("content")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                .and_then(|c| c.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error")
        ));
    }
    let text = result
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("text"))
        .and_then(|v| v.as_str())
        .ok_or("ERROR: Exa response had no text content")?;
    Ok(text.to_string())
}

/// Parse the hosted `web_search_exa` text output into normalized results. The
/// endpoint returns human-readable blocks separated by `---`, each with
/// `Title:` / `URL:` / `Published:` lines followed by a `Highlights:` section.
fn parse_hosted_search_text(text: &str) -> Vec<SearchResult> {
    let mut out = Vec::new();
    for block in text.split("\n---\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut title = String::new();
        let mut url = String::new();
        let mut published: Option<String> = None;
        let mut in_highlights = false;
        let mut snippet_lines: Vec<String> = Vec::new();
        for line in block.lines() {
            let trimmed = line.trim();
            if let Some(v) = trimmed.strip_prefix("Title:") {
                title = v.trim().to_string();
            } else if let Some(v) = trimmed.strip_prefix("URL:") {
                url = v.trim().to_string();
            } else if let Some(v) = trimmed.strip_prefix("Published:") {
                let v = v.trim();
                if !v.is_empty() && v != "N/A" {
                    published = Some(v.to_string());
                }
            } else if trimmed.starts_with("Author:") {
                // Ignored in the normalized contract.
            } else if trimmed.starts_with("Highlights:") {
                in_highlights = true;
            } else if in_highlights && trimmed != "..." && !trimmed.is_empty() {
                snippet_lines.push(trimmed.to_string());
            }
        }
        if url.is_empty() && title.is_empty() {
            continue;
        }
        let snippet = clip_chars(&snippet_lines.join(" "), 500);
        out.push(SearchResult {
            title,
            url,
            snippet,
            published_at: published,
        });
    }
    out
}

/// Parse the hosted `web_fetch_exa` text output into a bounded [`FetchedPage`].
/// The output leads with a `# Title` line and a `URL: ...` line, then the body.
fn parse_hosted_fetch_text(text: &str, requested_url: &str) -> FetchedPage {
    let mut title = String::new();
    let mut url = requested_url.to_string();
    let mut body_start = 0usize;
    for (i, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if i == 0 && trimmed.starts_with("# ") {
            title = trimmed[2..].trim().to_string();
        } else if let Some(v) = trimmed.strip_prefix("URL:") {
            url = v.trim().to_string();
            body_start = i + 1;
            break;
        } else if i > 2 {
            break;
        }
    }
    let body: String = text
        .lines()
        .skip(body_start)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    let source = if body.is_empty() { text.trim() } else { &body };
    let (content, truncated) = bound_text(source);
    FetchedPage {
        url,
        title,
        content,
        truncated,
    }
}

/// Normalize an Exa REST `/search` response body into the shared result
/// contract. Pulls the first highlight as the snippet, falling back to the text
/// excerpt.
fn normalize_exa_rest_search(body: &Value) -> Vec<SearchResult> {
    let Some(results) = body.get("results").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    results
        .iter()
        .map(|r| {
            let title = r
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let url = r
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let snippet = r
                .get("highlights")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    r.get("text")
                        .and_then(|v| v.as_str())
                        .map(|t| clip_chars(t, 300))
                })
                .unwrap_or_default();
            let published_at = r
                .get("publishedDate")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            SearchResult {
                title,
                url,
                snippet,
                published_at,
            }
        })
        .collect()
}

/// Normalize an Exa REST `/contents` response body into a bounded [`FetchedPage`].
fn normalize_exa_rest_fetch(body: &Value, requested_url: &str) -> Result<FetchedPage, String> {
    let first = body
        .get("results")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| format!("ERROR: Exa fetch returned no content for {requested_url}"))?;
    let url = first
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or(requested_url)
        .to_string();
    let title = first
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let raw = first.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let (content, truncated) = bound_text(raw);
    Ok(FetchedPage {
        url,
        title,
        content,
        truncated,
    })
}

/// Truncate `s` to `max` chars at a char boundary (no truncation note).
fn clip_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

/// Truncate readable text to the fetch bound at a char boundary, reporting
/// whether truncation occurred.
fn bound_text(s: &str) -> (String, bool) {
    if s.chars().count() <= FETCH_MAX_CHARS {
        (s.to_string(), false)
    } else {
        (s.chars().take(FETCH_MAX_CHARS).collect(), true)
    }
}

/// Select the configured provider. Today this is always Exa (the default
/// backend); the seam exists so Brave/others slot in without agent-facing
/// changes.
fn select_provider() -> Provider {
    Provider::DEFAULT
}

/// Clamp a requested result count into the supported range.
fn clamp_count(requested: Option<u64>) -> u32 {
    match requested {
        Some(0) | None => SEARCH_DEFAULT_COUNT,
        Some(n) => (n as u32).min(SEARCH_MAX_COUNT),
    }
}

/// Execute the `web_search` built-in. Returns the tool-result text; errors are
/// returned as a `String` starting with "ERROR" to match the other handlers.
pub async fn web_search(args: &Value) -> String {
    let Some(query) = args.get("query").and_then(|v| v.as_str()).map(str::trim) else {
        return "ERROR: web_search requires a 'query' string argument.".to_string();
    };
    if query.is_empty() {
        return "ERROR: web_search 'query' must not be empty.".to_string();
    }
    let count = clamp_count(args.get("count").and_then(|v| v.as_u64()));
    match select_provider() {
        Provider::Exa => {
            let provider = match ExaProvider::from_env() {
                Ok(p) => p,
                Err(e) => return e,
            };
            match provider.search(query, count).await {
                Ok(results) if results.is_empty() => {
                    format!("No web search results found for query: {query}")
                }
                Ok(results) => render_search_results(&results),
                Err(e) => e,
            }
        }
    }
}

/// Execute the `web_fetch` built-in. Returns bounded readable content with its
/// source URL/title; errors start with "ERROR".
pub async fn web_fetch(args: &Value) -> String {
    let Some(url) = args.get("url").and_then(|v| v.as_str()).map(str::trim) else {
        return "ERROR: web_fetch requires a 'url' string argument.".to_string();
    };
    if url.is_empty() {
        return "ERROR: web_fetch 'url' must not be empty.".to_string();
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return format!("ERROR: web_fetch 'url' must be an http(s) URL, got: {url}");
    }
    match select_provider() {
        Provider::Exa => {
            let provider = match ExaProvider::from_env() {
                Ok(p) => p,
                Err(e) => return e,
            };
            match provider.fetch(url).await {
                Ok(page) => render_fetched_page(&page),
                Err(e) => e,
            }
        }
    }
}

/// Render normalized results as compact, model-friendly text with citations.
fn render_search_results(results: &[SearchResult]) -> String {
    let mut out = String::new();
    for (i, r) in results.iter().enumerate() {
        out.push_str(&format!("{}. {}\n", i + 1, r.title));
        out.push_str(&format!("   URL: {}\n", r.url));
        if let Some(date) = &r.published_at {
            out.push_str(&format!("   Published: {date}\n"));
        }
        if !r.snippet.is_empty() {
            out.push_str(&format!("   {}\n", r.snippet.replace('\n', " ")));
        }
        out.push('\n');
    }
    out.trim_end().to_string()
}

/// Render a fetched page as text headed by its source URL/title.
fn render_fetched_page(page: &FetchedPage) -> String {
    let mut out = String::new();
    if !page.title.is_empty() {
        out.push_str(&format!("Title: {}\n", page.title));
    }
    out.push_str(&format!("URL: {}\n\n", page.url));
    out.push_str(&page.content);
    if page.truncated {
        out.push_str(&format!(
            "\n\n[content truncated to {FETCH_MAX_CHARS} characters]"
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_count_defaults_and_caps() {
        assert_eq!(clamp_count(None), SEARCH_DEFAULT_COUNT);
        assert_eq!(clamp_count(Some(0)), SEARCH_DEFAULT_COUNT);
        assert_eq!(clamp_count(Some(3)), 3);
        assert_eq!(clamp_count(Some(1000)), SEARCH_MAX_COUNT);
    }

    #[test]
    fn from_env_defaults_to_keyless_hosted() {
        // No key configured in the test environment -> keyless hosted path.
        // (Guard against a stray real key in CI by only asserting the variant
        // shape when both vars are unset.)
        if std::env::var("JAN_EXA_API_KEY").is_err() && std::env::var("EXA_API_KEY").is_err() {
            let p = ExaProvider::from_env().unwrap();
            assert_eq!(p.mode, ExaMode::Hosted);
        }
    }

    #[test]
    fn parse_hosted_result_text_reads_sse_frame() {
        let sse = "event: message\ndata: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}\n\n";
        assert_eq!(parse_hosted_result_text(sse).unwrap(), "hello");
    }

    #[test]
    fn parse_hosted_result_text_reads_raw_json() {
        let raw = "{\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}";
        assert_eq!(parse_hosted_result_text(raw).unwrap(), "hi");
    }

    #[test]
    fn parse_hosted_result_text_surfaces_errors() {
        let err = "{\"error\":{\"code\":-32000,\"message\":\"boom\"}}";
        assert!(parse_hosted_result_text(err).unwrap_err().starts_with("ERROR"));
        let tool_err = "{\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":\"bad\"}]}}";
        assert!(parse_hosted_result_text(tool_err)
            .unwrap_err()
            .contains("bad"));
    }

    #[test]
    fn parse_hosted_search_text_maps_contract() {
        let text = "Title: Paris | Britannica\nURL: https://www.britannica.com/place/Paris\nPublished: 1998-07-20T00:00:00.000Z\nAuthor: N/A\nHighlights:\nParis is the capital of France.\n...\nSecond highlight.\n---\nTitle: Paris\nURL: https://en.wikipedia.org/wiki/Paris\nPublished: N/A\nAuthor: N/A\nHighlights:\nParis is the capital and largest city of France.";
        let results = parse_hosted_search_text(text);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Paris | Britannica");
        assert_eq!(results[0].url, "https://www.britannica.com/place/Paris");
        assert_eq!(
            results[0].published_at.as_deref(),
            Some("1998-07-20T00:00:00.000Z")
        );
        assert!(results[0].snippet.contains("capital of France"));
        assert!(!results[0].snippet.contains("..."));
        // "N/A" publish date normalizes to None.
        assert!(results[1].published_at.is_none());
        assert_eq!(results[1].url, "https://en.wikipedia.org/wiki/Paris");
    }

    #[test]
    fn parse_hosted_search_text_empty_is_empty() {
        assert!(parse_hosted_search_text("").is_empty());
        assert!(parse_hosted_search_text("   \n  ").is_empty());
    }

    #[test]
    fn parse_hosted_fetch_text_extracts_title_url_body() {
        let text = "# Paris\nURL: https://en.wikipedia.org/wiki/Paris\n\nParis is the capital and largest city of France.";
        let page = parse_hosted_fetch_text(text, "https://en.wikipedia.org/wiki/Paris");
        assert_eq!(page.title, "Paris");
        assert_eq!(page.url, "https://en.wikipedia.org/wiki/Paris");
        assert!(page.content.starts_with("Paris is the capital"));
        assert!(!page.truncated);
    }

    #[test]
    fn parse_hosted_fetch_text_truncates_large_body() {
        let big = "a".repeat(FETCH_MAX_CHARS + 100);
        let text = format!("# T\nURL: https://x\n\n{big}");
        let page = parse_hosted_fetch_text(&text, "https://x");
        assert!(page.truncated);
        assert_eq!(page.content.chars().count(), FETCH_MAX_CHARS);
    }

    #[test]
    fn normalize_exa_rest_search_maps_contract() {
        let body = json!({
            "results": [
                {
                    "title": "Example",
                    "url": "https://example.com",
                    "highlights": ["Short result excerpt"],
                    "publishedDate": "2024-01-02T00:00:00.000Z"
                },
                {
                    "title": "No highlight",
                    "url": "https://example.org",
                    "text": "Body text fallback used as snippet."
                }
            ]
        });
        let results = normalize_exa_rest_search(&body);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].snippet, "Short result excerpt");
        assert_eq!(
            results[0].published_at.as_deref(),
            Some("2024-01-02T00:00:00.000Z")
        );
        assert!(results[1].snippet.starts_with("Body text fallback"));
        assert!(results[1].published_at.is_none());
    }

    #[test]
    fn normalize_exa_rest_search_empty_is_empty() {
        assert!(normalize_exa_rest_search(&json!({})).is_empty());
        assert!(normalize_exa_rest_search(&json!({"results": []})).is_empty());
    }

    #[test]
    fn normalize_exa_rest_fetch_bounds_and_titles() {
        let body = json!({
            "results": [ { "url": "https://example.com", "title": "T", "text": "hello world" } ]
        });
        let page = normalize_exa_rest_fetch(&body, "https://example.com").unwrap();
        assert_eq!(page.title, "T");
        assert_eq!(page.content, "hello world");
        assert!(!page.truncated);
    }

    #[test]
    fn normalize_exa_rest_fetch_no_results_errors() {
        let err = normalize_exa_rest_fetch(&json!({"results": []}), "u").unwrap_err();
        assert!(err.starts_with("ERROR"));
    }

    #[tokio::test]
    async fn web_search_requires_query() {
        assert!(web_search(&json!({})).await.starts_with("ERROR"));
        assert!(web_search(&json!({"query": "   "})).await.starts_with("ERROR"));
    }

    #[tokio::test]
    async fn web_fetch_validates_url() {
        assert!(web_fetch(&json!({})).await.starts_with("ERROR"));
        assert!(web_fetch(&json!({"url": "ftp://x"})).await.starts_with("ERROR"));
    }

    #[test]
    fn render_search_results_cites_urls() {
        let results = vec![SearchResult {
            title: "T".into(),
            url: "https://example.com".into(),
            snippet: "snip".into(),
            published_at: None,
        }];
        let rendered = render_search_results(&results);
        assert!(rendered.contains("https://example.com"));
        assert!(rendered.contains("snip"));
    }

    #[test]
    fn render_fetched_page_includes_source() {
        let page = FetchedPage {
            url: "https://example.com".into(),
            title: "Title".into(),
            content: "body".into(),
            truncated: true,
        };
        let rendered = render_fetched_page(&page);
        assert!(rendered.contains("URL: https://example.com"));
        assert!(rendered.contains("Title: Title"));
        assert!(rendered.contains("truncated"));
    }

    /// Live smoke test against the keyless hosted endpoint. Ignored by default
    /// (needs network); run with `cargo test -- --ignored web_search_live`.
    #[tokio::test]
    #[ignore]
    async fn web_search_live_keyless() {
        let out = web_search(&json!({ "query": "capital of France", "count": 2 })).await;
        assert!(!out.starts_with("ERROR"), "unexpected error: {out}");
        assert!(out.to_lowercase().contains("paris"), "got: {out}");
    }
}
