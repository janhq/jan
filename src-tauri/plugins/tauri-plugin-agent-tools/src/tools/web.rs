//! Native, provider-neutral web tools compiled into the agent core.
//!
//! This module implements `web_search` and `web_fetch` as first-class built-in
//! tools - NOT as an MCP server registered with the agent. The agent calls the
//! stable, provider-neutral tool names (`web_search` / `web_fetch`) and never a
//! provider-branded name such as `exa_search`.
//!
//! The search backend, credential handling, and response normalization live in
//! `tauri_plugin_websearch::provider` and are shared with the desktop
//! `web_search`/`web_fetch` Tauri commands so there is a single implementation.
//! This module owns only the agent tool contract: argument parsing/validation,
//! selecting the keyless-vs-keyed Exa path from the process environment, and
//! rendering normalized results as compact, model-friendly text.

use serde_json::Value;
use tauri_plugin_websearch::provider::{clamp_count, create_provider, FetchedPage, SearchResult};

/// Upper bound on the readable text `web_fetch` returns. Mirrors the plugin's
/// internal bound; used here only to phrase the truncation notice.
const FETCH_MAX_CHARS: usize = 40_000;

/// Environment variables consulted for an optional Exa credential, in priority
/// order. `JAN_EXA_API_KEY` is Jan's namespaced variable; `EXA_API_KEY` matches
/// Exa's own convention and the key already used by the legacy Exa MCP
/// registration, so an existing configuration keeps working. When neither is
/// set, the keyless hosted path is used automatically.
const EXA_API_KEY_ENVS: &[&str] = &["JAN_EXA_API_KEY", "EXA_API_KEY"];

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
    let provider = match create_provider(None, exa_api_key(), None) {
        Ok(p) => p,
        Err(e) => return e,
    };
    match provider.search(query, count).await {
        Ok(results) if results.is_empty() => {
            format!("No web search results found for query: {query}")
        }
        Ok(results) => render_search_results(&results),
        Err(e) => format!("ERROR: {e}"),
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
    let provider = match create_provider(None, exa_api_key(), None) {
        Ok(p) => p,
        Err(e) => return e,
    };
    match provider.fetch(url).await {
        Ok(page) => render_fetched_page(&page),
        Err(e) => format!("ERROR: {e}"),
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
    use serde_json::json;

    #[tokio::test]
    async fn web_search_requires_query() {
        assert!(web_search(&json!({})).await.starts_with("ERROR"));
        assert!(web_search(&json!({"query": "   "}))
            .await
            .starts_with("ERROR"));
    }

    #[tokio::test]
    async fn web_fetch_validates_url() {
        assert!(web_fetch(&json!({})).await.starts_with("ERROR"));
        assert!(web_fetch(&json!({"url": "ftp://x"}))
            .await
            .starts_with("ERROR"));
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
