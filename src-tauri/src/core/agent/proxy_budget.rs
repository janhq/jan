//! The compaction budget for a desktop API-server orchestration run.
//!
//! The desktop's only Rust caller of the agent loop is the API server's
//! `/orchestrations` path ([`crate::core::agent::r#loop::run_server_side_openai_orchestration`]);
//! chat runs in the renderer. Without a budget that run compacts only after the
//! provider rejects a request, which costs a failed round trip each time, and on
//! the in-process llama.cpp engine a full prompt-processing pass for nothing.
//!
//! The window is sized from what this machine can actually know, and left
//! unknown otherwise (an unknown window keeps the run on the reactive path
//! rather than guessing):
//!
//! - a route served by the local engine: the loaded model's `n_ctx`, from the
//!   engine worker's `/props`. Only for a model the run is actually routed to
//!   the engine (never a remote provider's id that a loaded model happens to
//!   share), only for a model already loaded, so probing the window does not
//!   start a load on its own, and each request bounded by [`PROBE_TIMEOUT`],
//!   so a stuck worker cannot stall the run before its first request. A model
//!   unloaded between the listing and `/props` can still be loaded by the
//!   latter; that run is about to load it anyway, and the window is short;
//! - any other route: the built-in model catalog
//!   ([`crate::core::agent::model_window`]). The desktop keeps no `/models`
//!   listing cache, so there is no provider-reported window to prefer, and the
//!   catalog's 128K fallback is a guess, which counts as unknown here.
//!
//! The ratio is the serving provider's `compaction_ratio` when it names one,
//! else [`DEFAULT_COMPACTION_RATIO`]. The desktop has no `[agent]` section, so
//! there is no configured window or reserve to honour.

use std::collections::HashMap;
use std::time::Duration;

use tauri_plugin_llamacpp::state::LlamacppState;

use crate::core::agent::compaction::{CompactionBudget, DEFAULT_COMPACTION_RATIO};
use crate::core::agent::model_window::{resolve_context_window, ContextWindowSource};
use crate::core::state::ProviderConfig;

/// How long each engine probe request may take. The worker answers both from
/// memory, so anything slower is a stuck worker, and the run it would hold up
/// has not sent its first request yet.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The budget for a run of `model`, routed to `upstream_url`, or `None` when
/// its window is unknown.
pub(crate) async fn resolve(
    model: &str,
    upstream_url: &str,
    provider_configs: &HashMap<String, ProviderConfig>,
    llama_state: &LlamacppState,
    client: &reqwest::Client,
) -> Option<CompactionBudget> {
    let engine = {
        let guard = llama_state.engine.lock().await;
        guard.as_ref().map(|h| (h.port, h.api_key.clone()))
    };
    resolve_with(model, upstream_url, provider_configs, engine, client).await
}

/// [`resolve`] with the engine worker's `(port, key)` already read, if one runs.
async fn resolve_with(
    model: &str,
    upstream_url: &str,
    provider_configs: &HashMap<String, ProviderConfig>,
    engine: Option<(u16, String)>,
    client: &reqwest::Client,
) -> Option<CompactionBudget> {
    let ratio = provider_ratio(model, provider_configs);
    if let Some(window) = catalog_window(model) {
        return Some(budget(window, ratio));
    }
    let (port, key) = engine?;
    let base = format!("http://127.0.0.1:{port}");
    if !routed_to_engine(model, upstream_url, provider_configs, &base) {
        return None;
    }
    engine_window(client, &base, &key, model)
        .await
        .map(|window| budget(window, ratio))
}

/// Whether the run's model is served by the local llama.cpp engine at `base`,
/// decided the way the upstream was ([`crate::core::agent::upstream`]): a
/// provider with an HTTP `base_url` serves it remotely, and only otherwise can
/// the upstream be the engine worker (the desktop registers no provider entry
/// for `llamacpp`, so its models resolve to no provider at all). A remote id
/// that happens to match a loaded engine model must not borrow its window.
fn routed_to_engine(
    model: &str,
    upstream_url: &str,
    provider_configs: &HashMap<String, ProviderConfig>,
    base: &str,
) -> bool {
    let remote = crate::core::agent::upstream::pick_provider_for_model(model, provider_configs)
        .and_then(|name| provider_configs.get(&name)?.base_url.clone())
        .is_some_and(|url| !url.is_empty());
    !remote && upstream_url.starts_with(&format!("{base}/"))
}

fn budget(context_window: u64, ratio: f64) -> CompactionBudget {
    CompactionBudget {
        context_window,
        ratio,
        reserve_tokens: None,
        // Resolved for this model, so a child on another model re-sizes.
        window_pinned: false,
    }
}

/// The share of the window this route may fill: its provider's own ratio, the
/// one desktop setting that bears on compaction, else the default.
fn provider_ratio(model: &str, provider_configs: &HashMap<String, ProviderConfig>) -> f64 {
    crate::core::agent::upstream::pick_provider_for_model(model, provider_configs)
        .and_then(|name| provider_configs.get(&name)?.compaction_ratio)
        .unwrap_or(DEFAULT_COMPACTION_RATIO)
}

/// The catalog window for `model`, or `None` for a model it cannot place.
pub(crate) fn catalog_window(model: &str) -> Option<u64> {
    let resolved = resolve_context_window(model, None, None);
    (resolved.source != ContextWindowSource::Fallback).then_some(resolved.tokens)
}

/// The context a loaded engine model runs with, asked of the worker at `base`
/// (`http://127.0.0.1:<port>`). `None` when the model is not loaded there, or
/// the worker does not answer with a usable `n_ctx`.
///
/// The worker routes `/props` by the `model` field of the request body (a
/// `?model=` query is not read), so the model goes in the body; without one it
/// would answer for whichever model happens to be resident.
pub(crate) async fn engine_window(
    client: &reqwest::Client,
    base: &str,
    key: &str,
    model: &str,
) -> Option<u64> {
    let auth = format!("Bearer {key}");
    let listing: serde_json::Value = client
        .get(format!("{base}/v1/models"))
        .header("Authorization", &auth)
        .timeout(PROBE_TIMEOUT)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    if !is_loaded(&listing, model) {
        return None;
    }
    let props: serde_json::Value = client
        .get(format!("{base}/props"))
        .header("Authorization", &auth)
        .timeout(PROBE_TIMEOUT)
        .json(&serde_json::json!({ "model": model }))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    n_ctx(&props)
}

/// Whether the engine's `/v1/models` listing reports `model` as loaded.
fn is_loaded(listing: &serde_json::Value, model: &str) -> bool {
    listing["data"].as_array().is_some_and(|models| {
        models
            .iter()
            .any(|m| m["id"] == model && m["status"]["value"] == "loaded")
    })
}

/// The per-slot context from a llama.cpp `/props` answer: what one request can
/// fill, which is the window a run's prompt has to fit.
fn n_ctx(props: &serde_json::Value) -> Option<u64> {
    props["default_generation_settings"]["n_ctx"]
        .as_u64()
        .filter(|n| *n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_catalog_model_gets_its_window_and_an_unknown_one_none() {
        assert_eq!(catalog_window("claude-haiku-4-5"), Some(200_000));
        assert_eq!(catalog_window("anthropic/claude-sonnet-4-6"), Some(1_000_000));
        // The 128K fallback is a guess, not a window.
        assert_eq!(catalog_window("qwen3-8b-q4"), None);
    }

    #[test]
    fn the_provider_ratio_wins_over_the_default() {
        let mut pc = HashMap::new();
        pc.insert(
            "anthropic".to_string(),
            ProviderConfig {
                provider: "anthropic".into(),
                base_url: Some("https://api.anthropic.com/v1".into()),
                models: vec!["claude-haiku-4-5".into()],
                compaction_ratio: Some(0.6),
                ..Default::default()
            },
        );
        assert_eq!(provider_ratio("claude-haiku-4-5", &pc), 0.6);
        assert_eq!(provider_ratio("gpt-4o", &pc), DEFAULT_COMPACTION_RATIO);
    }

    #[test]
    fn n_ctx_reads_the_slot_context_and_rejects_nonsense() {
        assert_eq!(n_ctx(&json!({"default_generation_settings": {"n_ctx": 8192}})), Some(8192));
        assert_eq!(n_ctx(&json!({"default_generation_settings": {"n_ctx": 0}})), None);
        assert_eq!(n_ctx(&json!({})), None);
    }

    #[test]
    fn only_a_loaded_model_counts() {
        let listing = json!({"data": [
            {"id": "a", "status": {"value": "loaded"}},
            {"id": "b", "status": {"value": "unloaded"}},
        ]});
        assert!(is_loaded(&listing, "a"));
        assert!(!is_loaded(&listing, "b"));
        assert!(!is_loaded(&listing, "c"));
        assert!(!is_loaded(&json!({}), "a"));
    }

    /// A stub engine worker: answers `/v1/models` with `listing` and `/props`
    /// with an `n_ctx` that names the model the request body asked for, so the
    /// test proves the model was routed in the body. Returns its base URL and
    /// the request lines it saw.
    fn stub_engine(
        listing: serde_json::Value,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for connection in listener.incoming() {
                let Ok(mut stream) = connection else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                let _ = reader.read_line(&mut request_line);
                let mut size = 0usize;
                let mut authorized = false;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    let lower = line.to_ascii_lowercase();
                    if let Some(n) = lower.strip_prefix("content-length:") {
                        size = n.trim().parse().unwrap_or(0);
                    }
                    if lower.trim() == "authorization: bearer k" {
                        authorized = true;
                    }
                }
                let mut body = vec![0; size];
                let _ = reader.read_exact(&mut body);
                log.lock().unwrap().push(request_line.trim().to_string());
                let answer = if !authorized {
                    None
                } else if request_line.starts_with("GET /v1/models ") {
                    Some(listing.to_string())
                } else if request_line.starts_with("GET /props ") {
                    let asked: serde_json::Value =
                        serde_json::from_slice(&body).unwrap_or_default();
                    let n = if asked["model"] == "a" { 8192 } else { 1 };
                    Some(json!({"default_generation_settings": {"n_ctx": n}}).to_string())
                } else {
                    None
                };
                let (status, answer) = match answer {
                    Some(a) => ("200 OK", a),
                    None => ("404 Not Found", "{}".to_string()),
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
                    answer.len()
                );
            }
        });
        (format!("http://{addr}"), seen)
    }

    #[tokio::test]
    async fn a_loaded_engine_model_reports_its_n_ctx() {
        let (base, _) = stub_engine(json!({"data": [
            {"id": "b", "status": {"value": "loaded"}},
            {"id": "a", "status": {"value": "loaded"}},
        ]}));
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        assert_eq!(engine_window(&client, &base, "k", "a").await, Some(8192));
    }

    /// Probing a window must not start a load: an unloaded model is never sent
    /// to `/props`, which would load it.
    #[tokio::test]
    async fn an_unloaded_engine_model_is_not_probed() {
        let (base, seen) = stub_engine(json!({"data": [
            {"id": "a", "status": {"value": "unloaded"}},
        ]}));
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        assert_eq!(engine_window(&client, &base, "k", "a").await, None);
        let seen = seen.lock().unwrap().clone();
        assert!(seen.iter().all(|l| !l.contains("/props")), "{seen:?}");
    }

    /// A stub that accepts connections and reads the request but never answers.
    fn silent_engine() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for connection in listener.incoming() {
                let Ok(stream) = connection else { break };
                held.push(stream);
            }
        });
        format!("http://{addr}")
    }

    /// A worker that accepts and then hangs must not stall the run: the probe
    /// gives up after its timeout and the window stays unknown.
    #[tokio::test]
    async fn a_stuck_engine_probe_times_out() {
        let base = silent_engine();
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        let started = std::time::Instant::now();
        let window = tokio::time::timeout(PROBE_TIMEOUT * 3, engine_window(&client, &base, "k", "a"))
            .await
            .expect("the probe bounds itself");
        assert_eq!(window, None);
        assert!(started.elapsed() < PROBE_TIMEOUT * 2, "{:?}", started.elapsed());
    }

    fn provider(name: &str, base_url: Option<&str>, models: &[&str]) -> (String, ProviderConfig) {
        (
            name.to_string(),
            ProviderConfig {
                provider: name.into(),
                base_url: base_url.map(str::to_string),
                models: models.iter().map(|m| m.to_string()).collect(),
                ..Default::default()
            },
        )
    }

    /// A model the run sends to a remote provider is never looked up in the
    /// local engine, even when a loaded engine model shares its id: that
    /// model's window says nothing about the remote one's.
    #[tokio::test]
    async fn a_remote_provider_model_is_never_probed() {
        let (base, seen) = stub_engine(json!({"data": [
            {"id": "a", "status": {"value": "loaded"}},
        ]}));
        let port: u16 = base.rsplit(':').next().unwrap().parse().unwrap();
        let pc: HashMap<_, _> =
            [provider("remote", Some("https://api.example.com/v1"), &["a"])].into();
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        let budget = resolve_with(
            "a",
            "https://api.example.com/v1/chat/completions",
            &pc,
            Some((port, "k".to_string())),
            &client,
        )
        .await;
        assert!(budget.is_none());
        assert!(seen.lock().unwrap().is_empty(), "{:?}", seen.lock().unwrap());
    }

    /// Only a model routed to the engine is probed: one with no HTTP provider
    /// whose upstream is the engine worker. A local MLX session (another
    /// loopback upstream) is not the engine either.
    #[tokio::test]
    async fn only_an_engine_routed_model_is_probed() {
        let (base, seen) = stub_engine(json!({"data": [
            {"id": "a", "status": {"value": "loaded"}},
        ]}));
        let port: u16 = base.rsplit(':').next().unwrap().parse().unwrap();
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        let engine = Some((port, "k".to_string()));
        let upstream = format!("{base}/v1/chat/completions");

        let mlx = resolve_with(
            "a",
            "http://127.0.0.1:1/v1/chat/completions",
            &HashMap::new(),
            engine.clone(),
            &client,
        )
        .await;
        assert!(mlx.is_none());
        assert!(seen.lock().unwrap().is_empty(), "an MLX route is not probed");

        let local: HashMap<_, _> = [provider("llamacpp", None, &["a"])].into();
        for pc in [HashMap::new(), local] {
            let budget = resolve_with("a", &upstream, &pc, engine.clone(), &client)
                .await
                .expect("an engine-routed model is probed");
            assert_eq!(budget.context_window, 8192);
        }
    }

    /// No engine running and a model the catalog cannot place: unknown.
    #[tokio::test]
    async fn an_unknown_window_stays_unknown() {
        let state = LlamacppState::default();
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        assert!(resolve("qwen3-8b-q4", "", &HashMap::new(), &state, &client).await.is_none());
    }

    #[tokio::test]
    async fn a_catalog_model_gets_a_budget_at_the_default_ratio() {
        let state = LlamacppState::default();
        let client = tauri_plugin_llamacpp::engine::worker::loopback_client();
        let b = resolve("claude-haiku-4-5", "", &HashMap::new(), &state, &client)
            .await
            .expect("a catalog model has a window");
        assert_eq!(b.context_window, 200_000);
        assert_eq!(b.ratio, DEFAULT_COMPACTION_RATIO);
        assert_eq!(b.reserve_tokens, None);
        assert!(!b.window_pinned);
    }
}
