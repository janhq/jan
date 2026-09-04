//! Native, provider-neutral web search backend.
//!
//! The `web_search` / `web_fetch` capability is defined by the [`SearchProvider`]
//! trait; concrete backends implement it and are selected at call time by
//! [`create_provider`]. Adding a backend is a new impl plus one match arm - the
//! plugin command contract and the whole frontend stay unchanged.
//!
//! The only backend shipped today is [`ExaProvider`] (the default). Exa is a
//! backend, never a product-facing identity:
//!
//! * Keyless (default): Exa's hosted endpoint at `https://mcp.exa.ai/mcp`
//!   answers over JSON-RPC with no API key.
//! * Keyed (opt-in): when an Exa API key is supplied the structured REST API
//!   (`https://api.exa.ai`) is used instead, for normalized JSON and higher
//!   rate limits.
//!
//! Every backend normalizes into [`SearchResult`] / [`FetchedPage`] and bounds
//! output size so tool results can't blow up the model's context.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const FETCH_MAX_CHARS: usize = 40_000;
pub const SEARCH_DEFAULT_COUNT: u32 = 5;
pub const SEARCH_MAX_COUNT: u32 = 20;
const REQUEST_TIMEOUT_SECS: u64 = 30;

const EXA_HOSTED_URL: &str = "https://mcp.exa.ai/mcp";
const EXA_REST_SEARCH_URL: &str = "https://api.exa.ai/search";
const EXA_REST_CONTENTS_URL: &str = "https://api.exa.ai/contents";

const TAVILY_SEARCH_URL: &str = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL: &str = "https://api.tavily.com/extract";

const YOU_COM_HOSTED_URL: &str = "https://api.you.com/mcp?profile=free";
// Identifies the calling application to You.com, per the convention its other
// integrations follow. Carries no user or query data beyond the request itself,
// and is sent only on requests to You.com.
const YOU_COM_USER_AGENT: &str = concat!(
    "jan-websearch/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/janhq/jan)"
);
const YOU_COM_CLIENT_INFO: &str = concat!(
    "sdk; client=jan-websearch/",
    env!("CARGO_PKG_VERSION"),
    "; ua=rust/unknown"
);
const YOU_COM_SEARCH_URL: &str = "https://ydc-index.io/v1/search";
const YOU_COM_CONTENTS_URL: &str = "https://ydc-index.io/v1/contents";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FetchedPage {
    pub url: String,
    pub title: String,
    pub content: String,
    pub truncated: bool,
}

/// A pluggable web search backend. Implementors turn a query into normalized
/// [`SearchResult`]s and a URL into a bounded [`FetchedPage`].
#[async_trait]
pub trait SearchProvider: Send + Sync {
    async fn search(&self, query: &str, count: u32) -> Result<Vec<SearchResult>, String>;
    async fn fetch(&self, url: &str) -> Result<FetchedPage, String>;
}

/// Build the backend for `provider` (case-insensitive; empty/absent selects the
/// default). `api_key` is used by keyed backends; `endpoint` by self-hosted ones
/// (e.g. a SearXNG instance URL).
pub fn create_provider(
    provider: Option<&str>,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<Box<dyn SearchProvider>, String> {
    match provider.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("exa") => Ok(Box::new(ExaProvider::new(api_key)?)),
        Some("tavily") => Ok(Box::new(TavilyProvider::new(api_key)?)),
        Some("searxng") => Ok(Box::new(SearxngProvider::new(endpoint)?)),
        Some("you") => Ok(Box::new(YouComProvider::new(api_key)?)),
        Some(other) => Err(format!("Unknown web search provider '{other}'")),
    }
}

fn require_key(provider: &str, api_key: Option<String>) -> Result<String, String> {
    normalize_key(api_key).ok_or_else(|| format!("{provider} requires an API key"))
}

fn build_http_client(provider: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("failed to build HTTP client for {provider}: {e}"))
}

/// Which Exa transport the adapter uses.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ExaMode {
    Hosted,
    Rest(String),
}

fn normalize_key(api_key: Option<String>) -> Option<String> {
    api_key.and_then(|v| {
        let v = v.trim().to_string();
        if v.is_empty() || v == "YOUR_EXA_API_KEY_HERE" {
            None
        } else {
            Some(v)
        }
    })
}

/// Exa backend. Defaults to the keyless hosted endpoint; upgrades to the
/// structured REST API when a key is supplied.
pub struct ExaProvider {
    mode: ExaMode,
    client: reqwest::Client,
}

impl ExaProvider {
    pub fn new(api_key: Option<String>) -> Result<Self, String> {
        let mode = match normalize_key(api_key) {
            Some(key) => ExaMode::Rest(key),
            None => ExaMode::Hosted,
        };
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("failed to build HTTP client for Exa: {e}"))?;
        Ok(Self { mode, client })
    }

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
            .map_err(|e| format!("Exa request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Exa: failed to read response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "Exa failed with HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        parse_hosted_result_text(&text, "Exa")
    }
}

#[async_trait]
impl SearchProvider for ExaProvider {
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
                    .map_err(|e| format!("Exa search request failed: {e}"))?;
                let status = resp.status();
                let text = resp
                    .text()
                    .await
                    .map_err(|e| format!("Exa search: failed to read response body: {e}"))?;
                if !status.is_success() {
                    return Err(format!(
                        "Exa search failed with HTTP {}: {}",
                        status.as_u16(),
                        text.chars().take(400).collect::<String>()
                    ));
                }
                let parsed: Value = serde_json::from_str(&text)
                    .map_err(|e| format!("Exa search: invalid JSON response: {e}"))?;
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
                    .map_err(|e| format!("Exa fetch request failed: {e}"))?;
                let status = resp.status();
                let text = resp
                    .text()
                    .await
                    .map_err(|e| format!("Exa fetch: failed to read response body: {e}"))?;
                if !status.is_success() {
                    return Err(format!(
                        "Exa fetch failed with HTTP {}: {}",
                        status.as_u16(),
                        text.chars().take(400).collect::<String>()
                    ));
                }
                let parsed: Value = serde_json::from_str(&text)
                    .map_err(|e| format!("Exa fetch: invalid JSON response: {e}"))?;
                normalize_exa_rest_fetch(&parsed, url)
            }
        }
    }
}

/// Pull the tool payload out of an MCP `tools/call` response. Streamable HTTP
/// answers with either a bare JSON-RPC object or an SSE stream, and a stream may
/// carry progress notifications ahead of the answer, so the frame holding
/// `result` or `error` is the one to read.
fn parse_hosted_result_text(body: &str, provider: &str) -> Result<String, String> {
    let envelope = match body
        .lines()
        .filter_map(|l| l.strip_prefix("data:").map(str::trim))
        .filter_map(|frame| serde_json::from_str::<Value>(frame).ok())
        .find(|v| v.get("result").is_some() || v.get("error").is_some())
    {
        Some(frame) => frame,
        None => serde_json::from_str::<Value>(body.trim())
            .map_err(|e| format!("{provider}: invalid response payload: {e}"))?,
    };
    if let Some(err) = envelope.get("error") {
        return Err(format!("{provider} returned an error: {err}"));
    }
    let result = envelope
        .get("result")
        .ok_or_else(|| format!("{provider} response missing 'result'"))?;
    let text = result
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("text"))
        .and_then(|v| v.as_str());
    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        return Err(format!(
            "{provider} tool call failed: {}",
            text.unwrap_or("unknown error")
        ));
    }
    text.map(str::to_string)
        .ok_or_else(|| format!("{provider} response had no text content"))
}

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

fn normalize_exa_rest_fetch(body: &Value, requested_url: &str) -> Result<FetchedPage, String> {
    let first = body
        .get("results")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| format!("Exa fetch returned no content for {requested_url}"))?;
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

/// Tavily backend (key-only). Uses the structured `/search` and `/extract`
/// REST endpoints, authenticated with a bearer token.
pub struct TavilyProvider {
    api_key: String,
    client: reqwest::Client,
}

impl TavilyProvider {
    pub fn new(api_key: Option<String>) -> Result<Self, String> {
        Ok(Self {
            api_key: require_key("Tavily", api_key)?,
            client: build_http_client("Tavily")?,
        })
    }

    async fn post(&self, url: &str, body: Value) -> Result<Value, String> {
        let resp = self
            .client
            .post(url)
            .bearer_auth(&self.api_key)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Tavily request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Tavily: failed to read response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "Tavily failed with HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        serde_json::from_str(&text).map_err(|e| format!("Tavily: invalid JSON response: {e}"))
    }
}

#[async_trait]
impl SearchProvider for TavilyProvider {
    async fn search(&self, query: &str, count: u32) -> Result<Vec<SearchResult>, String> {
        let parsed = self
            .post(
                TAVILY_SEARCH_URL,
                json!({ "query": query, "max_results": count }),
            )
            .await?;
        Ok(normalize_tavily_search(&parsed))
    }

    async fn fetch(&self, url: &str) -> Result<FetchedPage, String> {
        let parsed = self
            .post(TAVILY_EXTRACT_URL, json!({ "urls": [url] }))
            .await?;
        normalize_tavily_extract(&parsed, url)
    }
}

fn normalize_tavily_search(body: &Value) -> Vec<SearchResult> {
    let Some(results) = body.get("results").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    results
        .iter()
        .map(|r| {
            let title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let url = r.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let snippet = r
                .get("content")
                .and_then(|v| v.as_str())
                .map(|t| clip_chars(t, 500))
                .unwrap_or_default();
            let published_at = r
                .get("published_date")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            SearchResult {
                title: title.to_string(),
                url: url.to_string(),
                snippet,
                published_at,
            }
        })
        .collect()
}

fn normalize_tavily_extract(body: &Value, requested_url: &str) -> Result<FetchedPage, String> {
    let first = body
        .get("results")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| format!("Tavily returned no content for {requested_url}"))?;
    let url = first
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or(requested_url)
        .to_string();
    let raw = first
        .get("raw_content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let (content, truncated) = bound_text(raw);
    Ok(FetchedPage {
        url,
        title: String::new(),
        content,
        truncated,
    })
}

/// Attach the shared You.com request headers. Callers set the body with
/// `.json()`, which already sets `Content-Type: application/json` — setting it
/// again here would duplicate the header (reqwest's `.header()` appends), and
/// api.you.com rejects a multi-valued `Content-Type` with HTTP 415.
fn with_youcom_headers(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    request
        .header("user-agent", YOU_COM_USER_AGENT)
        .header("x-client-info", YOU_COM_CLIENT_INFO)
}

/// Which You.com transport the adapter uses.
#[derive(Debug, Clone, PartialEq, Eq)]
enum YouComMode {
    Hosted,
    Rest(String),
}

/// You.com backend. Defaults to the keyless hosted endpoint; upgrades to the
/// structured REST API when a key is supplied.
///
/// * Keyless (default): the hosted MCP endpoint answers `you-search` with no
///   credentials. `web_fetch` has no keyless counterpart, so it falls back to a
///   direct GET, the same way [`SearxngProvider`] handles a backend with no
///   extraction endpoint.
/// * Keyed (opt-in): the structured REST API at `https://ydc-index.io`, which
///   adds `/v1/contents` for real content extraction and lifts the free tier's
///   request cap.
///
/// Both transports return the same search payload, so one normalizer serves
/// both.
pub struct YouComProvider {
    mode: YouComMode,
    client: reqwest::Client,
}

impl YouComProvider {
    pub fn new(api_key: Option<String>) -> Result<Self, String> {
        let mode = match normalize_key(api_key) {
            Some(key) => YouComMode::Rest(key),
            None => YouComMode::Hosted,
        };
        Ok(Self {
            mode,
            client: build_http_client("You.com")?,
        })
    }

    /// Send a prepared request and return the body, mapping transport and HTTP
    /// failures into one message shape for both transports.
    async fn send(&self, request: reqwest::RequestBuilder) -> Result<String, String> {
        let resp = with_youcom_headers(request)
            .send()
            .await
            .map_err(|e| format!("You.com request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("You.com: failed to read response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "You.com failed with HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        Ok(text)
    }

    /// Keyed transport: plain JSON POST authenticated with `X-API-Key`.
    async fn post_rest(&self, url: &str, key: &str, body: Value) -> Result<Value, String> {
        let text = self
            .send(self.client.post(url).header("X-API-Key", key).json(&body))
            .await?;
        serde_json::from_str(&text).map_err(|e| format!("You.com: invalid JSON response: {e}"))
    }

    /// Keyless transport: one MCP `tools/call` for `you-search`, the only tool
    /// the free profile exposes. The tool payload is the same JSON the REST
    /// endpoint returns, so the caller can hand it to the same normalizer.
    async fn hosted_search(&self, arguments: Value) -> Result<Value, String> {
        let text = self
            .send(
                self.client
                    .post(YOU_COM_HOSTED_URL)
                    .header("accept", "application/json, text/event-stream")
                    .json(&json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": { "name": "you-search", "arguments": arguments }
                    })),
            )
            .await?;
        let payload = parse_hosted_result_text(&text, "You.com")?;
        serde_json::from_str(&payload)
            .map_err(|e| format!("You.com: invalid JSON in tool result: {e}"))
    }
}

#[async_trait]
impl SearchProvider for YouComProvider {
    async fn search(&self, query: &str, count: u32) -> Result<Vec<SearchResult>, String> {
        let args = json!({ "query": query, "count": count });
        let parsed = match &self.mode {
            YouComMode::Hosted => self.hosted_search(args).await?,
            YouComMode::Rest(key) => self.post_rest(YOU_COM_SEARCH_URL, key, args).await?,
        };
        Ok(normalize_youcom_search(&parsed))
    }

    async fn fetch(&self, url: &str) -> Result<FetchedPage, String> {
        match &self.mode {
            // No keyless content endpoint, so read the page directly.
            YouComMode::Hosted => fetch_url_direct(&self.client, url, "You.com").await,
            YouComMode::Rest(key) => {
                let parsed = self
                    .post_rest(
                        YOU_COM_CONTENTS_URL,
                        key,
                        json!({ "urls": [url], "formats": ["markdown"] }),
                    )
                    .await?;
                normalize_youcom_contents(&parsed, url)
            }
        }
    }
}

/// `/v1/search` groups results into sections. `web` is the section jan's
/// `web_search` contract maps to, so a response carrying no `web` section
/// (news-only, or empty) yields no results rather than falling back to `news`.
fn normalize_youcom_search(body: &Value) -> Vec<SearchResult> {
    let Some(web) = body
        .get("results")
        .and_then(|r| r.get("web"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    web.iter()
        .map(|r| {
            let title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let url = r.get("url").and_then(|v| v.as_str()).unwrap_or("");
            // `description` is the whole-result summary; `snippets` are keyword
            // fragments, used only when a result carries no description.
            let snippet = r
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    r.get("snippets")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|v| v.as_str())
                })
                .map(|s| clip_chars(s, 500))
                .unwrap_or_default();
            let published_at = r
                .get("page_age")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            SearchResult {
                title: title.to_string(),
                url: url.to_string(),
                snippet,
                published_at,
            }
        })
        .collect()
}

/// `/v1/contents` answers with a bare array, one entry per requested URL.
/// The request asks for `markdown`, so that is the only content field read.
fn normalize_youcom_contents(body: &Value, requested_url: &str) -> Result<FetchedPage, String> {
    let first = body
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| format!("You.com returned no content for {requested_url}"))?;
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
    let raw = first.get("markdown").and_then(|v| v.as_str()).unwrap_or("");
    let (content, truncated) = bound_text(raw);
    Ok(FetchedPage {
        url,
        title,
        content,
        truncated,
    })
}

/// SearXNG backend (self-hosted, key-less). Queries a user-supplied instance's
/// JSON search API. SearXNG has no content-extraction endpoint, so `fetch` does
/// a plain HTTP GET of the URL and returns the bounded raw response body.
pub struct SearxngProvider {
    base_url: String,
    client: reqwest::Client,
}

impl SearxngProvider {
    pub fn new(endpoint: Option<String>) -> Result<Self, String> {
        let base = endpoint
            .map(|e| e.trim().trim_end_matches('/').to_string())
            .filter(|e| !e.is_empty())
            .ok_or("SearXNG requires an instance URL")?;
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err(format!(
                "SearXNG instance URL must be an http(s) URL, got: {base}"
            ));
        }
        Ok(Self {
            base_url: base,
            client: build_http_client("SearXNG")?,
        })
    }
}

#[async_trait]
impl SearchProvider for SearxngProvider {
    async fn search(&self, query: &str, count: u32) -> Result<Vec<SearchResult>, String> {
        let resp = self
            .client
            .get(format!("{}/search", self.base_url))
            .query(&[("q", query), ("format", "json")])
            .send()
            .await
            .map_err(|e| format!("SearXNG request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("SearXNG: failed to read response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "SearXNG failed with HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        let parsed: Value = serde_json::from_str(&text).map_err(|e| {
            format!("SearXNG: invalid JSON response (is the JSON API enabled?): {e}")
        })?;
        Ok(normalize_searxng_search(&parsed, count))
    }

    async fn fetch(&self, url: &str) -> Result<FetchedPage, String> {
        fetch_url_direct(&self.client, url, "SearXNG").await
    }
}

fn normalize_searxng_search(body: &Value, count: u32) -> Vec<SearchResult> {
    let Some(results) = body.get("results").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    results
        .iter()
        .take(count as usize)
        .map(|r| {
            let title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let url = r.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let snippet = r
                .get("content")
                .and_then(|v| v.as_str())
                .map(|t| clip_chars(t, 500))
                .unwrap_or_default();
            let published_at = r
                .get("publishedDate")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            SearchResult {
                title: title.to_string(),
                url: url.to_string(),
                snippet,
                published_at,
            }
        })
        .collect()
}

/// Fetch a URL directly and return its bounded body, titled from its `<title>`.
/// Used by backends that have no content-extraction endpoint on the active
/// transport, so `web_fetch` still answers instead of erroring.
async fn fetch_url_direct(
    client: &reqwest::Client,
    url: &str,
    provider: &str,
) -> Result<FetchedPage, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{provider} fetch request failed: {e}"))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("{provider} fetch: failed to read response body: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "{provider} fetch failed with HTTP {}",
            status.as_u16()
        ));
    }
    let title = extract_html_title(&body).unwrap_or_default();
    let (content, truncated) = bound_text(&body);
    Ok(FetchedPage {
        url: url.to_string(),
        title,
        content,
        truncated,
    })
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let close = lower[open_end..].find("</title>")? + open_end;
    let title = html[open_end..close].trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

fn clip_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn bound_text(s: &str) -> (String, bool) {
    if s.chars().count() <= FETCH_MAX_CHARS {
        (s.to_string(), false)
    } else {
        (s.chars().take(FETCH_MAX_CHARS).collect(), true)
    }
}

pub fn clamp_count(requested: Option<u64>) -> u32 {
    match requested {
        Some(0) | None => SEARCH_DEFAULT_COUNT,
        Some(n) => (n as u32).min(SEARCH_MAX_COUNT),
    }
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
    fn empty_key_selects_hosted() {
        let p = ExaProvider::new(None).unwrap();
        assert_eq!(p.mode, ExaMode::Hosted);
        let p = ExaProvider::new(Some("  ".into())).unwrap();
        assert_eq!(p.mode, ExaMode::Hosted);
        let p = ExaProvider::new(Some("YOUR_EXA_API_KEY_HERE".into())).unwrap();
        assert_eq!(p.mode, ExaMode::Hosted);
    }

    #[test]
    fn real_key_selects_rest() {
        let p = ExaProvider::new(Some("abc123".into())).unwrap();
        assert_eq!(p.mode, ExaMode::Rest("abc123".into()));
    }

    #[test]
    fn create_provider_defaults_to_exa() {
        assert!(create_provider(None, None, None).is_ok());
        assert!(create_provider(Some(""), None, None).is_ok());
        assert!(create_provider(Some("Exa"), None, None).is_ok());
    }

    #[test]
    fn create_provider_rejects_unknown() {
        match create_provider(Some("brave"), None, None) {
            Ok(_) => panic!("expected unknown provider to error"),
            Err(e) => assert!(e.contains("brave")),
        }
    }

    #[test]
    fn create_provider_tavily_requires_key() {
        match create_provider(Some("tavily"), None, None) {
            Ok(_) => panic!("expected Tavily to require a key"),
            Err(e) => assert!(e.contains("Tavily")),
        }
        assert!(create_provider(Some("tavily"), Some("tvly-abc".into()), None).is_ok());
    }

    #[test]
    fn create_provider_searxng_requires_valid_url() {
        match create_provider(Some("searxng"), None, None) {
            Ok(_) => panic!("expected SearXNG to require an instance URL"),
            Err(e) => assert!(e.contains("SearXNG")),
        }
        match create_provider(Some("searxng"), None, Some("example.com".into())) {
            Ok(_) => panic!("expected SearXNG to reject a scheme-less URL"),
            Err(e) => assert!(e.contains("http")),
        }
        assert!(
            create_provider(Some("searxng"), None, Some("https://searx.example/".into())).is_ok()
        );
    }

    #[test]
    fn normalize_searxng_search_maps_and_caps() {
        let body = json!({
            "results": [
                { "title": "One", "url": "https://a.example", "content": "first", "publishedDate": "2024-01-01" },
                { "title": "Two", "url": "https://b.example", "content": "second" },
                { "title": "Three", "url": "https://c.example", "content": "third" }
            ]
        });
        let results = normalize_searxng_search(&body, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://a.example");
        assert_eq!(results[0].published_at.as_deref(), Some("2024-01-01"));
        assert!(results[1].published_at.is_none());
    }

    #[test]
    fn extract_html_title_reads_title_tag() {
        assert_eq!(
            extract_html_title("<html><head><TITLE>Hello</TITLE></head>").as_deref(),
            Some("Hello")
        );
        assert!(extract_html_title("<html>no title</html>").is_none());
    }

    #[test]
    fn normalize_tavily_search_maps_contract() {
        let body = json!({
            "results": [
                {
                    "title": "Example",
                    "url": "https://example.com",
                    "content": "A short excerpt.",
                    "published_date": "2024-05-01"
                },
                { "title": "No date", "url": "https://example.org", "content": "Body." }
            ]
        });
        let results = normalize_tavily_search(&body);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://example.com");
        assert_eq!(results[0].snippet, "A short excerpt.");
        assert_eq!(results[0].published_at.as_deref(), Some("2024-05-01"));
        assert!(results[1].published_at.is_none());
    }

    #[test]
    fn normalize_tavily_search_empty_is_empty() {
        assert!(normalize_tavily_search(&json!({})).is_empty());
        assert!(normalize_tavily_search(&json!({"results": []})).is_empty());
    }

    #[test]
    fn normalize_tavily_extract_reads_raw_content() {
        let body = json!({
            "results": [
                { "url": "https://example.com", "raw_content": "hello world" }
            ]
        });
        let page = normalize_tavily_extract(&body, "https://example.com").unwrap();
        assert!(page.title.is_empty());
        assert_eq!(page.content, "hello world");
        assert!(!page.truncated);
    }

    #[test]
    fn normalize_tavily_extract_no_results_errors() {
        assert!(normalize_tavily_extract(&json!({"results": []}), "u").is_err());
    }

    #[test]
    fn parse_hosted_result_text_reads_sse_frame() {
        let sse = "event: message\ndata: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}\n\n";
        assert_eq!(parse_hosted_result_text(sse, "Exa").unwrap(), "hello");
    }

    #[test]
    fn parse_hosted_result_text_reads_raw_json() {
        let raw = "{\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}";
        assert_eq!(parse_hosted_result_text(raw, "Exa").unwrap(), "hi");
    }

    #[test]
    fn parse_hosted_result_text_surfaces_errors() {
        let err = "{\"error\":{\"code\":-32000,\"message\":\"boom\"}}";
        assert!(parse_hosted_result_text(err, "Exa").is_err());
        let tool_err = "{\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":\"bad\"}]}}";
        assert!(parse_hosted_result_text(tool_err, "Exa")
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
        assert!(normalize_exa_rest_fetch(&json!({"results": []}), "u").is_err());
    }

    #[test]
    fn youcom_attribution_follows_the_client_info_grammar() {
        // `<source>; client=<name>/<version>; ua=<runtime>/<version>`
        let segments: Vec<&str> = YOU_COM_CLIENT_INFO.split("; ").collect();
        assert_eq!(segments.len(), 3, "unexpected segment count");
        assert_eq!(segments[0], "sdk");
        let client = segments[1]
            .strip_prefix("client=")
            .expect("second segment names the client");
        let (name, version) = client.split_once('/').expect("client carries a version");
        assert_eq!(name, "jan-websearch");
        assert!(!version.is_empty(), "client version must not be empty");
        assert!(segments[2].starts_with("ua="));
        // Values are interpolated verbatim; a stray delimiter would corrupt
        // the segment split on the receiving side.
        assert!(segments.iter().all(|s| !s.contains(';')));
        assert!(YOU_COM_USER_AGENT.starts_with("jan-websearch/"));
        assert!(YOU_COM_USER_AGENT.contains("github.com/janhq/jan"));
    }

    #[test]
    fn youcom_requests_send_a_single_content_type() {
        // Regression test: reqwest's `.json()` sets `Content-Type` and
        // `.header()` appends, so an extra explicit header produced a
        // duplicated `content-type: application/json` — which api.you.com
        // rejects with HTTP 415 ("Content-Type must be application/json").
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call" });
        let req = with_youcom_headers(
            YouComProvider::new(None)
                .unwrap()
                .client
                .post(YOU_COM_HOSTED_URL)
                .header("accept", "application/json, text/event-stream")
                .json(&body),
        )
        .build()
        .unwrap();
        assert_eq!(req.headers().get_all("content-type").iter().count(), 1);
        assert_eq!(
            req.headers().get("content-type").unwrap(),
            "application/json"
        );
        assert!(req.headers().contains_key("user-agent"));
        assert!(req.headers().contains_key("x-client-info"));
    }

    #[test]
    fn youcom_key_selects_transport() {
        assert_eq!(YouComProvider::new(None).unwrap().mode, YouComMode::Hosted);
        assert_eq!(
            YouComProvider::new(Some("   ".into())).unwrap().mode,
            YouComMode::Hosted
        );
        assert_eq!(
            YouComProvider::new(Some("ydc-key".into())).unwrap().mode,
            YouComMode::Rest("ydc-key".into())
        );
    }

    #[test]
    fn create_provider_youcom_works_with_and_without_key() {
        assert!(create_provider(Some("you"), None, None).is_ok());
        assert!(create_provider(Some("you"), Some("ydc-key".into()), None).is_ok());
    }

    #[test]
    fn parse_hosted_result_text_youcom_skips_notification_frames() {
        // The hosted endpoint emits a progress notification ahead of the
        // answer, so the result is not the first `data:` frame.
        let payload = json!({
            "results": {
                "web": [
                    { "url": "https://example.com", "title": "T", "description": "D" }
                ]
            }
        });
        let sse = format!(
            "event: message\ndata: {}\n\nevent: message\ndata: {}\n\n",
            json!({
                "jsonrpc": "2.0",
                "method": "notifications/message",
                "params": { "level": "info", "data": "searching" }
            }),
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "content": [{ "type": "text", "text": payload.to_string() }] }
            })
        );
        let text = parse_hosted_result_text(&sse, "You.com").expect("result frame must be found");
        // The hosted payload is the same shape the REST endpoint returns, so
        // the REST normalizer reads it unchanged.
        let parsed: Value = serde_json::from_str(&text).expect("tool payload is JSON");
        let results = normalize_youcom_search(&parsed);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].url, "https://example.com");
        assert_eq!(results[0].snippet, "D");
    }

    #[test]
    fn parse_hosted_result_text_youcom_reads_bare_json_body() {
        let raw = json!({"result": {"content": [{"type": "text", "text": "hi"}]}}).to_string();
        assert_eq!(parse_hosted_result_text(&raw, "You.com").unwrap(), "hi");
    }

    #[test]
    fn parse_hosted_result_text_youcom_surfaces_errors() {
        let err = json!({"error": {"code": -32000, "message": "boom"}}).to_string();
        assert!(parse_hosted_result_text(&err, "You.com")
            .unwrap_err()
            .contains("boom"));

        let tool_err = json!({
            "result": {
                "isError": true,
                "content": [{"type": "text", "text": "quota exceeded"}]
            }
        })
        .to_string();
        assert!(parse_hosted_result_text(&tool_err, "You.com")
            .unwrap_err()
            .contains("quota exceeded"));

        // A stream that never carries an answer must error rather than
        // silently returning the notification.
        let only_notification = format!(
            "event: message\ndata: {}\n\n",
            json!({"jsonrpc": "2.0", "method": "notifications/message", "params": {}})
        );
        assert!(parse_hosted_result_text(&only_notification, "You.com").is_err());
    }

    #[test]
    fn normalize_youcom_search_maps_contract() {
        // Field set mirrors a live `ydc-index.io/v1/search` web result,
        // including the thumbnail and favicon keys the normalizer ignores.
        let body = json!({
            "results": {
                "web": [
                    {
                        "url": "https://example.com",
                        "title": "Example",
                        "description": "A short summary.",
                        "snippets": ["first excerpt", "second excerpt"],
                        "thumbnail_url": "https://cdn.example.com/img.jpg",
                        "original_thumbnail_url": "https://cdn.example.com/img.jpg",
                        "favicon_url": "https://example.com/favicon.ico",
                        "page_age": "2024-05-01T00:00:00.000Z"
                    },
                    { "url": "https://example.org", "title": "No date", "description": "Body." }
                ]
            }
        });
        let results = normalize_youcom_search(&body);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://example.com");
        // Description wins over snippets when both are present.
        assert_eq!(results[0].snippet, "A short summary.");
        assert_eq!(
            results[0].published_at.as_deref(),
            Some("2024-05-01T00:00:00.000Z")
        );
        assert!(results[1].published_at.is_none());
    }

    #[test]
    fn normalize_youcom_search_falls_back_to_snippet_when_no_description() {
        let body = json!({
            "results": {
                "web": [
                    {
                        "url": "https://example.com",
                        "title": "Missing",
                        "snippets": ["passage one", "passage two"]
                    },
                    {
                        "url": "https://example.org",
                        "title": "Empty",
                        "description": "",
                        "snippets": ["passage three"]
                    }
                ]
            }
        });
        let results = normalize_youcom_search(&body);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].snippet, "passage one");
        // An empty description falls through to snippets rather than
        // yielding an empty snippet.
        assert_eq!(results[1].snippet, "passage three");
    }

    #[test]
    fn normalize_youcom_search_clips_long_snippet() {
        let body = json!({
            "results": {
                "web": [
                    { "url": "https://example.com", "description": "x".repeat(900) }
                ]
            }
        });
        let results = normalize_youcom_search(&body);
        assert_eq!(results[0].snippet.chars().count(), 500);
    }

    #[test]
    fn normalize_youcom_search_empty_or_news_only_is_empty() {
        // A news-only response must not be reported as web results.
        let news_only = json!({
            "results": { "news": [{ "url": "https://x", "title": "X" }] }
        });
        assert!(normalize_youcom_search(&news_only).is_empty());
        assert!(normalize_youcom_search(&json!({})).is_empty());
        assert!(normalize_youcom_search(&json!({"results": {}})).is_empty());
        assert!(normalize_youcom_search(&json!({"results": {"web": []}})).is_empty());
    }

    #[test]
    fn normalize_youcom_contents_reads_markdown() {
        let body = json!([
            { "url": "https://example.com", "title": "T", "markdown": "hello world" }
        ]);
        let page = normalize_youcom_contents(&body, "https://example.com").unwrap();
        assert_eq!(page.title, "T");
        assert_eq!(page.url, "https://example.com");
        assert_eq!(page.content, "hello world");
        assert!(!page.truncated);
    }

    #[test]
    fn normalize_youcom_contents_truncates_and_marks_truncated() {
        let big = "a".repeat(FETCH_MAX_CHARS + 100);
        let body = json!([
            { "url": "https://example.com", "title": "T", "markdown": big }
        ]);
        let page = normalize_youcom_contents(&body, "https://example.com").unwrap();
        assert!(page.truncated);
        assert_eq!(page.content.chars().count(), FETCH_MAX_CHARS);
    }

    #[test]
    fn normalize_youcom_contents_no_results_errors() {
        assert!(normalize_youcom_contents(&json!([]), "u").is_err());
        // A non-array body must error rather than panic.
        assert!(normalize_youcom_contents(&json!({"results": []}), "u").is_err());
    }
}
