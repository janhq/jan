//! Native, provider-neutral web tools compiled into the agent core.
//!
//! This module implements `web_search` and `web_fetch` as first-class built-in
//! tools — NOT as an MCP server. The agent calls the stable, provider-neutral
//! tool names (`web_search` / `web_fetch`) and never a provider-branded name
//! such as `exa_search`. The search backend is selected behind a small adapter
//! trait so a provider can change without touching the agent tool contract.
//!
//! Per jan-internal#196, **Exa is the default backend**, not a product-facing
//! identity. The adapter normalizes each provider's response into the shared
//! [`SearchResult`] / [`FetchedPage`] contracts and bounds output size so tool
//! results can't blow up the model's context window.

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

/// Environment variables consulted for the Exa credential, in priority order.
/// `JAN_EXA_API_KEY` is Jan's namespaced variable; `EXA_API_KEY` matches Exa's
/// own convention and the key already used by the legacy Exa MCP registration,
/// so an existing configuration keeps working after the native cutover.
const EXA_API_KEY_ENVS: &[&str] = &["JAN_EXA_API_KEY", "EXA_API_KEY"];

/// A single normalized web-search result. This is the stable contract the agent
/// sees, regardless of which backend produced it.
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

/// Read the first present, non-empty Exa API key from the environment.
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

/// Exa backend hitting the public REST API (`https://api.exa.ai`). Chosen as the
/// default because it offers a free credential path; it stays behind the adapter
/// so it is never exposed as the tool identity.
pub struct ExaProvider {
    api_key: String,
    client: reqwest::Client,
}

impl ExaProvider {
    /// Build the Exa adapter, resolving the credential from the environment.
    /// Returns a clear, provider-identified configuration error when no key is
    /// available, naming the variables to set.
    pub fn from_env() -> Result<Self, String> {
        let api_key = exa_api_key().ok_or_else(|| {
            format!(
                "ERROR: web search provider 'Exa' is not configured. Set an Exa API key via one of these environment variables: {}. Get a free key at https://dashboard.exa.ai/api-keys.",
                EXA_API_KEY_ENVS.join(" or ")
            )
        })?;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("ERROR: failed to build HTTP client for Exa: {e}"))?;
        Ok(Self { api_key, client })
    }
}

impl SearchProvider for ExaProvider {
    fn name(&self) -> &'static str {
        "Exa"
    }

    async fn search(&self, query: &str, count: u32) -> Result<Vec<SearchResult>, String> {
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
            .post("https://api.exa.ai/search")
            .header("x-api-key", &self.api_key)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("ERROR: Exa search request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("ERROR: Exa search: failed to read response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "ERROR: Exa search failed with HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|e| format!("ERROR: Exa search: invalid JSON response: {e}"))?;
        Ok(normalize_exa_search(&parsed))
    }

    async fn fetch(&self, url: &str) -> Result<FetchedPage, String> {
        let body = json!({
            "ids": [url],
            "text": true
        });
        let resp = self
            .client
            .post("https://api.exa.ai/contents")
            .header("x-api-key", &self.api_key)
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
        normalize_exa_fetch(&parsed, url)
    }
}

/// Normalize an Exa `/search` response body into the shared result contract.
/// Pulls the first highlight as the snippet, falling back to the text excerpt.
fn normalize_exa_search(body: &Value) -> Vec<SearchResult> {
    let results = body.get("results").and_then(|v| v.as_array());
    let Some(results) = results else {
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
                        .map(|t| t.chars().take(300).collect::<String>())
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

/// Normalize an Exa `/contents` response body into a bounded [`FetchedPage`].
fn normalize_exa_fetch(body: &Value, requested_url: &str) -> Result<FetchedPage, String> {
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
    fn normalize_exa_search_maps_contract() {
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
        let results = normalize_exa_search(&body);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Example");
        assert_eq!(results[0].url, "https://example.com");
        assert_eq!(results[0].snippet, "Short result excerpt");
        assert_eq!(
            results[0].published_at.as_deref(),
            Some("2024-01-02T00:00:00.000Z")
        );
        // Falls back to text excerpt when no highlight is present.
        assert!(results[1].snippet.starts_with("Body text fallback"));
        assert!(results[1].published_at.is_none());
    }

    #[test]
    fn normalize_exa_search_empty_is_empty() {
        assert!(normalize_exa_search(&json!({})).is_empty());
        assert!(normalize_exa_search(&json!({"results": []})).is_empty());
    }

    #[test]
    fn normalize_exa_fetch_bounds_and_titles() {
        let body = json!({
            "results": [
                { "url": "https://example.com", "title": "T", "text": "hello world" }
            ]
        });
        let page = normalize_exa_fetch(&body, "https://example.com").unwrap();
        assert_eq!(page.url, "https://example.com");
        assert_eq!(page.title, "T");
        assert_eq!(page.content, "hello world");
        assert!(!page.truncated);
    }

    #[test]
    fn normalize_exa_fetch_truncates_large_text() {
        let big = "a".repeat(FETCH_MAX_CHARS + 100);
        let body = json!({ "results": [ { "url": "u", "title": "t", "text": big } ] });
        let page = normalize_exa_fetch(&body, "u").unwrap();
        assert!(page.truncated);
        assert_eq!(page.content.chars().count(), FETCH_MAX_CHARS);
    }

    #[test]
    fn normalize_exa_fetch_no_results_errors() {
        let err = normalize_exa_fetch(&json!({"results": []}), "u").unwrap_err();
        assert!(err.starts_with("ERROR"));
    }

    #[tokio::test]
    async fn web_search_requires_query() {
        let out = web_search(&json!({})).await;
        assert!(out.starts_with("ERROR"));
        let out = web_search(&json!({"query": "   "})).await;
        assert!(out.starts_with("ERROR"));
    }

    #[tokio::test]
    async fn web_fetch_validates_url() {
        let out = web_fetch(&json!({})).await;
        assert!(out.starts_with("ERROR"));
        let out = web_fetch(&json!({"url": "ftp://x"})).await;
        assert!(out.starts_with("ERROR"));
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
        assert!(rendered.contains("T"));
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
}
