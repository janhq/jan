use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, State};

use crate::device::{get_devices_from_backend, DeviceInfo};
use crate::error::{ErrorCode, LlamacppError, ServerError, ServerResult};
use crate::state::{LlamacppState, SessionInfo};

type HmacSha256 = Hmac<Sha256>;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

#[derive(serde::Serialize)]
struct ModelRequestBody<'a> {
    model: &'a str,
}

async fn router_endpoint<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<(u16, String, u32), String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let guard = state.router.lock().await;
    let h = guard.as_ref().ok_or_else(|| "router not started".to_string())?;
    Ok((h.port, h.api_key.clone(), h.pid))
}

async fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Payload for the `llamacpp-model-load-progress` event, mirrored from the
/// router's `/models/sse` `status_change` events (`progress.value` is 0.0-1.0).
/// `stage` is the upstream stage identifier being loaded right now
/// (`text_model` | `mmproj_model` | `spec_model`); `stages` is the full set
/// for this load - always includes `text_model`, plus `mmproj_model` for a
/// vision-capable model and/or `spec_model` for speculative decoding. A
/// plain text-only load (the common case) has exactly one stage, so the
/// frontend uses `stages.len() > 1` to decide whether naming the stage is
/// worth surfacing at all.
#[derive(serde::Serialize, Clone)]
pub struct LoadProgressPayload {
    pub model: String,
    pub stage: Option<String>,
    pub stages: Vec<String>,
    pub value: f64,
}

/// Parses one SSE "event block" (text up to and including a `\n\n`
/// separator) and returns a progress payload if it's a `status_change` event
/// for `model_id` carrying a non-null `progress` field. Returns `None` for
/// any other event, a different model, or malformed input - callers should
/// simply skip the block.
fn parse_load_progress_event(block: &str, model_id: &str) -> Option<LoadProgressPayload> {
    for line in block.lines() {
        let data = line
            .strip_prefix("data: ")
            .or_else(|| line.strip_prefix("data:"))?;
        let json: serde_json::Value = serde_json::from_str(data).ok()?;
        if json.get("model").and_then(|v| v.as_str()) != Some(model_id) {
            continue;
        }
        if json.get("event").and_then(|v| v.as_str()) != Some("status_change") {
            continue;
        }
        let progress = json.get("data").and_then(|d| d.get("progress"))?;
        if progress.is_null() {
            continue;
        }
        let value = progress.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let stage = progress
            .get("current")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let stages = progress
            .get("stages")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        return Some(LoadProgressPayload {
            model: model_id.to_string(),
            stage,
            stages,
            value,
        });
    }
    None
}

/// A `status_change` transition for the model currently being loaded, parsed
/// from one `/models/sse` event block. Upstream marks a load failure as a
/// transition to `unloaded` with a nonzero `exit_code`
/// (`server_model_meta::is_failed`); SSE events are ordered, so an unloaded
/// transition seen *after* our model entered `loading` on the same stream is
/// definitively this load attempt's outcome — unlike a `/models` snapshot,
/// which can carry a stale failure from a previous attempt or an eviction.
#[derive(Debug, PartialEq)]
enum LoadStatusChange {
    Loading,
    Loaded,
    Unloaded { exit_code: Option<i64> },
}

fn parse_load_status_change(block: &str, model_id: &str) -> Option<LoadStatusChange> {
    for line in block.lines() {
        let data = line
            .strip_prefix("data: ")
            .or_else(|| line.strip_prefix("data:"))?;
        let json: serde_json::Value = serde_json::from_str(data).ok()?;
        if json.get("model").and_then(|v| v.as_str()) != Some(model_id) {
            continue;
        }
        if json.get("event").and_then(|v| v.as_str()) != Some("status_change") {
            continue;
        }
        let status = json
            .get("data")
            .and_then(|d| d.get("status"))
            .and_then(|v| v.as_str())?;
        return match status {
            "loading" => Some(LoadStatusChange::Loading),
            "loaded" => Some(LoadStatusChange::Loaded),
            "unloaded" => Some(LoadStatusChange::Unloaded {
                exit_code: json
                    .get("data")
                    .and_then(|d| d.get("exit_code"))
                    .and_then(|v| v.as_i64()),
            }),
            _ => None,
        };
    }
    None
}

/// Subscribes to the router's `/models/sse` feed and re-emits `progress`
/// updates for `model_id` as Tauri events, until the connection drops or the
/// task is aborted by the caller once loading finishes. Additionally reports
/// a definitive load failure over `fail_tx` (the observed exit code) when the
/// model transitions `loading` -> `unloaded` with a nonzero exit code; the
/// caller races this against the `/models` polling fallback.
///
/// `/models/sse` was introduced upstream in build b9747 (server: real-time
/// model load progress tracking, #24828); this plugin doesn't track backend
/// build numbers, so rather than gating ahead of time we just check the
/// response here. Older backends 404 (or otherwise fail) and we return
/// immediately without emitting anything - the UI already has a workaround,
/// falling back to its plain "Loading model..." spinner (`loadingModel`,
/// entirely unaffected by this listener) in `PromptProgress.tsx`.
fn spawn_load_progress_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    port: u16,
    api_key: String,
    model_id: String,
    fail_tx: tokio::sync::oneshot::Sender<Option<i64>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        use futures_util::StreamExt;

        let client = http_client().await;
        let url = format!("http://127.0.0.1:{}/models/sse", port);
        let resp = match client.get(&url).bearer_auth(&api_key).send().await {
            Ok(r) => r,
            Err(e) => {
                log::debug!("model load progress: failed to connect to /models/sse: {}", e);
                return;
            }
        };
        if !resp.status().is_success() {
            log::debug!(
                "model load progress unavailable on this backend (/models/sse returned {}); \
                 falling back to the plain loading indicator",
                resp.status()
            );
            return;
        }

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut fail_tx = Some(fail_tx);
        let mut saw_loading = false;
        while let Some(chunk) = stream.next().await {
            let Ok(bytes) = chunk else { break };
            buf.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(pos) = buf.find("\n\n") {
                let event_block: String = buf.drain(..pos + 2).collect();
                if let Some(payload) = parse_load_progress_event(&event_block, &model_id) {
                    let _ = app_handle.emit("llamacpp-model-load-progress", payload);
                }
                match parse_load_status_change(&event_block, &model_id) {
                    Some(LoadStatusChange::Loading) => saw_loading = true,
                    Some(LoadStatusChange::Unloaded { exit_code })
                        if saw_loading && exit_code.unwrap_or(0) != 0 =>
                    {
                        if let Some(tx) = fail_tx.take() {
                            let _ = tx.send(exit_code);
                        }
                    }
                    _ => {}
                }
            }
        }
    })
}

/// Payload for the `llamacpp-model-unloaded` event: any model transition to
/// `status: "unloaded"` seen on `/models/sse`, regardless of cause (explicit
/// unload, LRU eviction under `models_max`, or a crash - `exit_code` is 0 for
/// the first two, nonzero for a crash). Forwarded unconditionally; the
/// frontend already knows about unloads it requested itself, so reconciling
/// already-correct state is a harmless no-op.
#[derive(serde::Serialize, Clone)]
pub struct UnloadEventPayload {
    pub model: String,
    pub exit_code: Option<i64>,
}

/// Parses one SSE event block, returning an unload payload only for a
/// `status_change` event whose `data.status` is `"unloaded"`. `None` for any
/// other event/status or malformed input.
fn parse_unload_event(block: &str) -> Option<UnloadEventPayload> {
    for line in block.lines() {
        let data = line
            .strip_prefix("data: ")
            .or_else(|| line.strip_prefix("data:"))?;
        let json: serde_json::Value = serde_json::from_str(data).ok()?;
        if json.get("event").and_then(|v| v.as_str()) != Some("status_change") {
            continue;
        }
        let model = json.get("model").and_then(|v| v.as_str())?;
        let status = json
            .get("data")
            .and_then(|d| d.get("status"))
            .and_then(|v| v.as_str())?;
        if status != "unloaded" {
            continue;
        }
        let exit_code = json
            .get("data")
            .and_then(|d| d.get("exit_code"))
            .and_then(|v| v.as_i64());
        return Some(UnloadEventPayload {
            model: model.to_string(),
            exit_code,
        });
    }
    None
}

/// Subscribes to the router's `/models/sse` feed for the router's entire
/// lifetime, re-emitting every model-unload transition (explicit unload, LRU
/// eviction, crash) as `llamacpp-model-unloaded`. Unlike
/// `spawn_load_progress_listener` (per-model, aborted once loading finishes)
/// this runs continuously and reconnects with backoff on a dropped
/// connection, since the router process can outlive many individual loads.
///
/// `/models/sse` itself was introduced upstream in build b9688 (#23976); on
/// an older backend the initial connection succeeds at the TCP/HTTP layer
/// but the route 404s, so we give up permanently after the first failed
/// connection instead of retrying forever against a route that will never
/// exist. A transient connection error (router mid-restart) is retried with
/// exponential backoff instead, since that's recoverable.
fn spawn_unload_watcher<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    port: u16,
    api_key: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        use futures_util::StreamExt;

        let client = http_client().await;
        let url = format!("http://127.0.0.1:{}/models/sse", port);
        let mut backoff = Duration::from_millis(500);
        const MAX_BACKOFF: Duration = Duration::from_secs(30);

        loop {
            let resp = match client.get(&url).bearer_auth(&api_key).send().await {
                Ok(r) => r,
                Err(e) => {
                    log::debug!(
                        "model unload watcher: failed to connect to /models/sse: {}; retrying in {:?}",
                        e,
                        backoff
                    );
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                    continue;
                }
            };
            if !resp.status().is_success() {
                log::debug!(
                    "model unload watcher: /models/sse returned {} (backend predates b9688?); giving up",
                    resp.status()
                );
                return;
            }
            backoff = Duration::from_millis(500);

            let mut stream = resp.bytes_stream();
            let mut buf = String::new();
            while let Some(chunk) = stream.next().await {
                let Ok(bytes) = chunk else { break };
                buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(pos) = buf.find("\n\n") {
                    let event_block: String = buf.drain(..pos + 2).collect();
                    if let Some(payload) = parse_unload_event(&event_block) {
                        let _ = app_handle.emit("llamacpp-model-unloaded", payload);
                    }
                }
            }
            // Stream ended (router restarted or connection dropped); briefly
            // pause then reconnect.
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
}

async fn post_load<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    port: u16,
    api_key: &str,
    model_id: &str,
) -> ServerResult<()> {
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models/load", port);
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&ModelRequestBody { model: model_id })
        .send()
        .await
        .map_err(|e| {
            ServerError::Llamacpp(LlamacppError::new(
                ErrorCode::InternalError,
                "Failed to call router /models/load".into(),
                Some(e.to_string()),
            ))
        })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        if !body.to_lowercase().contains("already") {
            return Err(ServerError::Llamacpp(LlamacppError::new(
                ErrorCode::InternalError,
                format!("Router rejected model load (status {})", status),
                Some(body),
            )));
        }
    }

    let (fail_tx, fail_rx) = tokio::sync::oneshot::channel();
    let progress_task = spawn_load_progress_listener(
        app_handle.clone(),
        port,
        api_key.to_string(),
        model_id.to_string(),
        fail_tx,
    );

    // Definitive failure signal from the SSE stream; pends forever if the
    // listener ends without one (older backend, dropped connection) so the
    // polling arm below always remains the fallback.
    let sse_failure = async {
        match fail_rx.await {
            Ok(exit_code) => exit_code,
            Err(_) => std::future::pending().await,
        }
    };

    // /models/load returns success once loading is *initiated*; poll /models
    // until the entry transitions from "loading" to "loaded" (or fails).
    let result = tokio::select! {
        r = wait_until_loaded(port, api_key, model_id, Duration::from_secs(600)) => r,
        exit_code = sse_failure => Err(ServerError::Llamacpp(LlamacppError::new(
            ErrorCode::InternalError,
            format!("Model {} failed to load", model_id),
            Some(format!("exit_code={:?}", exit_code)),
        ))),
    };
    progress_task.abort();
    result
}

#[derive(Debug, PartialEq)]
enum LoadPoll {
    Loaded,
    Pending,
    Failed { exit_code: Option<i64> },
}

/// The router keeps the last failure (`failed`/`exit_code`) on a `/models`
/// entry across load attempts, and an LRU eviction force-kill can also leave
/// a failed state behind. A failed flag observed before this attempt ever
/// reached "loading" is therefore stale and must not be attributed to the
/// model being loaded now; trust it only once the attempt was seen loading,
/// or after `grace_elapsed` with no loading transition at all.
fn evaluate_load_poll(
    entry: Option<&serde_json::Value>,
    saw_loading: &mut bool,
    grace_elapsed: bool,
) -> LoadPoll {
    let Some(entry) = entry else {
        return LoadPoll::Pending;
    };
    let status = entry.get("status");
    let value = status
        .and_then(|s| s.get("value"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match value {
        "loaded" => LoadPoll::Loaded,
        "loading" => {
            *saw_loading = true;
            LoadPoll::Pending
        }
        "unloaded" | "sleeping" => {
            let failed = status
                .and_then(|s| s.get("failed"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if failed && (*saw_loading || grace_elapsed) {
                let exit_code = status
                    .and_then(|s| s.get("exit_code"))
                    .and_then(|v| v.as_i64());
                LoadPoll::Failed { exit_code }
            } else {
                LoadPoll::Pending
            }
        }
        other => {
            log::warn!("Unknown model status value: {}", other);
            LoadPoll::Pending
        }
    }
}

/// How long a pre-existing `failed` flag is treated as stale while waiting
/// for the fresh attempt to enter "loading". Longer than the router's 10s
/// force-kill timeout so an in-flight eviction can finish first.
const STALE_FAILURE_GRACE: Duration = Duration::from_secs(20);

async fn wait_until_loaded(
    port: u16,
    api_key: &str,
    model_id: &str,
    timeout: Duration,
) -> ServerResult<()> {
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models", port);
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(250);
    let mut saw_loading = false;

    loop {
        let resp = client
            .get(&url)
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| {
                ServerError::Llamacpp(LlamacppError::new(
                    ErrorCode::InternalError,
                    "Failed to poll router /models".into(),
                    Some(e.to_string()),
                ))
            })?;

        let json: serde_json::Value = resp.json().await.map_err(|e| {
            ServerError::Llamacpp(LlamacppError::new(
                ErrorCode::InternalError,
                "Invalid JSON from /models".into(),
                Some(e.to_string()),
            ))
        })?;

        let entry = json
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(model_id))
            });

        match evaluate_load_poll(
            entry,
            &mut saw_loading,
            start.elapsed() >= STALE_FAILURE_GRACE,
        ) {
            LoadPoll::Loaded => return Ok(()),
            LoadPoll::Pending => {}
            LoadPoll::Failed { exit_code } => {
                return Err(ServerError::Llamacpp(LlamacppError::new(
                    ErrorCode::InternalError,
                    format!("Model {} failed to load", model_id),
                    Some(format!("exit_code={:?}", exit_code)),
                )));
            }
        }

        if start.elapsed() >= timeout {
            return Err(ServerError::Llamacpp(LlamacppError::new(
                ErrorCode::ModelLoadTimedOut,
                format!("Timed out waiting for model {} to load", model_id),
                Some(format!("waited {:?}", timeout)),
            )));
        }
        tokio::time::sleep(poll_interval).await;
    }
}

async fn post_unload(port: u16, api_key: &str, model_id: &str) -> Result<(), String> {
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models/unload", port);
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&ModelRequestBody { model: model_id })
        .send()
        .await
        .map_err(|e| format!("Failed to call /models/unload: {}", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Router rejected unload (status {}): {}", status, body));
    }

    // /models/unload returns once shutdown is *initiated*; poll until the
    // entry actually leaves the "loaded"/"loading" states. Preset's
    // stop-timeout defaults to 10s, so 30s of slack is plenty.
    wait_until_unloaded(port, api_key, model_id, Duration::from_secs(30))
        .await
        .map_err(|e| format!("{}", e))
}

async fn wait_until_unloaded(
    port: u16,
    api_key: &str,
    model_id: &str,
    timeout: Duration,
) -> ServerResult<()> {
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models", port);
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(250);

    loop {
        let resp = client
            .get(&url)
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| {
                ServerError::Llamacpp(LlamacppError::new(
                    ErrorCode::InternalError,
                    "Failed to poll router /models".into(),
                    Some(e.to_string()),
                ))
            })?;
        let json: serde_json::Value = resp.json().await.map_err(|e| {
            ServerError::Llamacpp(LlamacppError::new(
                ErrorCode::InternalError,
                "Invalid JSON from /models".into(),
                Some(e.to_string()),
            ))
        })?;

        let entry = json
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(model_id))
            });

        // No entry at all → treat as unloaded.
        let still_loaded = entry
            .and_then(|e| e.get("status"))
            .and_then(|s| s.get("value"))
            .and_then(|v| v.as_str())
            .map(|v| matches!(v, "loaded" | "loading"))
            .unwrap_or(false);
        if !still_loaded {
            return Ok(());
        }

        if start.elapsed() >= timeout {
            return Err(ServerError::Llamacpp(LlamacppError::new(
                ErrorCode::InternalError,
                format!("Timed out waiting for model {} to unload", model_id),
                Some(format!("waited {:?}", timeout)),
            )));
        }
        tokio::time::sleep(poll_interval).await;
    }
}

async fn unload_busy_router_models(port: u16, api_key: &str) -> Result<(), String> {
    let client = http_client().await;
    let list_url = format!("http://127.0.0.1:{}/models", port);
    let resp = client
        .get(&list_url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let data = json
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    let unload_url = format!("http://127.0.0.1:{}/models/unload", port);
    for m in &data {
        let Some(id) = m.get("id").and_then(|v| v.as_str()) else { continue };
        let status = m
            .get("status")
            .and_then(|s| s.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("unloaded");
        if status.eq_ignore_ascii_case("unloaded") {
            continue;
        }
        let body = serde_json::json!({ "model": id });
        match client
            .post(&unload_url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                log::info!("OOM unload: {} ({})", id, status);
            }
            Ok(r) => log::warn!("OOM unload {} returned {}", id, r.status()),
            Err(e) => log::warn!("OOM unload {} failed: {}", id, e),
        }
    }
    Ok(())
}

async fn router_loaded_model_ids(port: u16, api_key: &str) -> Result<Vec<String>, String> {
    // Router-aware listing: `/models` (not `/v1/models`, which is OAI-compat
    // and returns a single element). Each entry has a `status` object whose
    // `value` is one of "loaded" / "loading" / "unloaded" / "sleeping".
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models", port);
    let resp = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("Failed to query /models: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("/models returned {}", resp.status()));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON from /models: {}", e))?;
    let data = json
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    let mut ids = Vec::new();
    for m in &data {
        let Some(id) = m.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let loaded = m
            .get("status")
            .and_then(|s| s.get("value"))
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("loaded"))
            .unwrap_or(false);
        if loaded {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

#[tauri::command]
pub async fn load_llama_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
    is_embedding: bool,
) -> ServerResult<SessionInfo> {
    let (port, api_key, pid) = router_endpoint(&app_handle)
        .await
        .map_err(ServerError::InvalidArgument)?;
    post_load(&app_handle, port, &api_key, &model_id).await?;
    Ok(SessionInfo {
        pid: pid as i32,
        port: port as i32,
        model_id,
        is_embedding,
        api_key,
    })
}

#[tauri::command]
pub async fn unload_llama_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> ServerResult<UnloadResult> {
    let (port, api_key, _pid) = router_endpoint(&app_handle)
        .await
        .map_err(ServerError::InvalidArgument)?;
    match post_unload(port, &api_key, &model_id).await {
        Ok(()) => Ok(UnloadResult { success: true, error: None }),
        Err(e) => Ok(UnloadResult { success: false, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn get_devices(
    backend_path: &str,
    envs: HashMap<String, String>,
) -> ServerResult<Vec<DeviceInfo>> {
    get_devices_from_backend(backend_path, envs).await
}

#[tauri::command]
pub fn generate_api_key(model_id: String, api_secret: String) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(api_secret.as_bytes())
        .map_err(|e| format!("Invalid key length: {}", e))?;
    mac.update(model_id.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    let hash = general_purpose::STANDARD.encode(code_bytes);
    Ok(hash)
}

#[tauri::command]
pub async fn ensure_session_ready<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
    is_embedding: bool,
) -> Result<SessionInfo, String> {
    let (port, api_key, pid) = router_endpoint(&app_handle).await?;
    post_load(&app_handle, port, &api_key, &model_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SessionInfo {
        pid: pid as i32,
        port: port as i32,
        model_id,
        is_embedding,
        api_key,
    })
}

#[tauri::command]
pub async fn find_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    let (port, api_key, pid) = match router_endpoint(&app_handle).await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let ids = router_loaded_model_ids(port, &api_key).await?;
    if ids.iter().any(|id| id == &model_id) {
        Ok(Some(SessionInfo {
            pid: pid as i32,
            port: port as i32,
            model_id,
            is_embedding: false,
            api_key,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    let (port, api_key, _pid) = match router_endpoint(&app_handle).await {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };
    router_loaded_model_ids(port, &api_key).await
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RouterInfo {
    pub port: u16,
    pub api_key: String,
    pub pid: u32,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_router<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    backend_exe: String,
    preset_path: String,
    port: u16,
    api_key: String,
    models_max: u32,
    default_args: Vec<String>,
    envs: HashMap<String, String>,
) -> Result<RouterInfo, String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let mut guard = state.router.lock().await;
    if guard.is_some() {
        return Err("Router is already running.".to_string());
    }

    let on_error: Option<crate::router::ErrorCallback> = {
        let app = app_handle.clone();
        let err_port = port;
        let err_api_key = api_key.clone();
        Some(Arc::new(move |kind: &'static str, line: String| {
            let event = match kind {
                "oom" => "llamacpp-router-oom",
                _ => "llamacpp-router-backend-error",
            };
            let _ = app.emit(event, line);
            let port = err_port;
            let api_key = err_api_key.clone();
            tokio::spawn(async move {
                if let Err(e) = unload_busy_router_models(port, &api_key).await {
                    log::warn!("router error unload sweep failed: {}", e);
                }
            });
        }))
    };

    let handle = crate::router::start_router(
        std::path::PathBuf::from(backend_exe),
        std::path::PathBuf::from(preset_path),
        port,
        api_key,
        models_max,
        default_args,
        envs,
        on_error,
    )
    .await
    .map_err(|e| e.to_string())?;

    let info = RouterInfo {
        port: handle.port,
        api_key: handle.api_key.clone(),
        pid: handle.pid,
    };
    state
        .router_pid
        .store(handle.pid, std::sync::atomic::Ordering::SeqCst);
    *guard = Some(handle);

    let watcher = spawn_unload_watcher(app_handle.clone(), info.port, info.api_key.clone());
    *state.unload_watcher.lock().await = Some(watcher);

    Ok(info)
}

async fn stop_unload_watcher(state: &LlamacppState) {
    if let Some(handle) = state.unload_watcher.lock().await.take() {
        handle.abort();
    }
}

#[tauri::command]
pub async fn stop_router<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<(), String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    stop_unload_watcher(&state).await;
    let mut guard = state.router.lock().await;
    if let Some(handle) = guard.take() {
        state
            .router_pid
            .store(0, std::sync::atomic::Ordering::SeqCst);
        crate::router::stop_router(handle)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_router_info<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Option<RouterInfo>, String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let guard = state.router.lock().await;
    Ok(guard.as_ref().map(|h| RouterInfo {
        port: h.port,
        api_key: h.api_key.clone(),
        pid: h.pid,
    }))
}

/// Live-reload the router's preset (`GET /models?reload=1`) without restarting
/// the process. The router diffs the regenerated `router.preset.ini` against the
/// running set: models with unchanged presets stay loaded, only changed/removed
/// ones are unloaded, and newly-added ones are registered. Requires a backend
/// with the reload diff path (upstream b9023+); the TS caller gates on build.
#[tauri::command]
pub async fn reload_router_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let (port, api_key, _pid) = router_endpoint(&app_handle).await?;
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models", port);
    let resp = client
        .get(&url)
        .query(&[("reload", "1")])
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "router reload returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    Ok(())
}

/// Best-effort idle check; returns `Ok(true)` on any error so callers
/// never block on a transient `/slots` failure.
#[tauri::command]
pub async fn router_slots_idle<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: Option<String>,
) -> Result<bool, String> {
    let (port, api_key, _pid) = match router_endpoint(&app_handle).await {
        Ok(r) => r,
        Err(_) => return Ok(true),
    };
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/slots", port);
    let mut req = client.get(&url).bearer_auth(&api_key);
    if let Some(m) = model_id.as_deref() {
        req = req.query(&[("model", m)]);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => return Ok(true),
    };
    if !resp.status().is_success() {
        return Ok(true);
    }
    let slots: Vec<serde_json::Value> = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(true),
    };
    Ok(slots.iter().all(|s| {
        s.get("is_processing")
            .and_then(|v| v.as_bool())
            .map(|b| !b)
            .unwrap_or(true)
    }))
}

/// `Ok(Some(busy))` on deadline; handle is restored to state.
#[tauri::command]
pub async fn try_graceful_stop_router<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    deadline_secs: u64,
) -> Result<Option<Vec<String>>, String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let maybe_handle = {
        let mut guard = state.router.lock().await;
        guard.take()
    };
    let Some(handle) = maybe_handle else {
        return Ok(None);
    };
    match crate::router::try_graceful_stop_router(handle, Duration::from_secs(deadline_secs)).await {
        Ok(()) => {
            state
                .router_pid
                .store(0, std::sync::atomic::Ordering::SeqCst);
            stop_unload_watcher(&state).await;
            Ok(None)
        }
        Err((h, busy)) => {
            let mut guard = state.router.lock().await;
            *guard = Some(h);
            Ok(Some(busy))
        }
    }
}

#[tauri::command]
pub async fn force_kill_router_tree<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let pid = state
        .router_pid
        .swap(0, std::sync::atomic::Ordering::SeqCst);
    let maybe_handle = {
        let mut guard = state.router.lock().await;
        guard.take()
    };
    stop_unload_watcher(&state).await;
    match (maybe_handle, pid) {
        (Some(handle), _) => crate::router::force_kill_router_tree(handle).await,
        (None, p) if p != 0 => crate::router::force_kill_router_tree_by_pid(p),
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod load_poll_tests {
    use super::{evaluate_load_poll, LoadPoll};

    fn entry(status: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "id": "m", "status": status })
    }

    #[test]
    fn loaded_wins() {
        let e = entry(serde_json::json!({ "value": "loaded" }));
        let mut saw = false;
        assert_eq!(evaluate_load_poll(Some(&e), &mut saw, false), LoadPoll::Loaded);
    }

    #[test]
    fn loading_marks_attempt_observed() {
        let e = entry(serde_json::json!({ "value": "loading" }));
        let mut saw = false;
        assert_eq!(evaluate_load_poll(Some(&e), &mut saw, false), LoadPoll::Pending);
        assert!(saw);
    }

    #[test]
    fn stale_failure_before_loading_is_ignored() {
        // failed/exit_code left over from a previous attempt or an LRU
        // eviction force-kill must not be attributed to this load.
        let e = entry(serde_json::json!({
            "value": "unloaded", "failed": true, "exit_code": 1
        }));
        let mut saw = false;
        assert_eq!(evaluate_load_poll(Some(&e), &mut saw, false), LoadPoll::Pending);
    }

    #[test]
    fn failure_after_loading_is_reported() {
        let e = entry(serde_json::json!({
            "value": "unloaded", "failed": true, "exit_code": 137
        }));
        let mut saw = true;
        assert_eq!(
            evaluate_load_poll(Some(&e), &mut saw, false),
            LoadPoll::Failed { exit_code: Some(137) }
        );
    }

    #[test]
    fn persistent_failure_past_grace_is_reported_even_without_loading() {
        let e = entry(serde_json::json!({
            "value": "unloaded", "failed": true, "exit_code": 1
        }));
        let mut saw = false;
        assert_eq!(
            evaluate_load_poll(Some(&e), &mut saw, true),
            LoadPoll::Failed { exit_code: Some(1) }
        );
    }

    #[test]
    fn unloaded_without_failure_keeps_polling() {
        let e = entry(serde_json::json!({ "value": "unloaded" }));
        let mut saw = true;
        assert_eq!(evaluate_load_poll(Some(&e), &mut saw, true), LoadPoll::Pending);
    }

    #[test]
    fn missing_entry_keeps_polling() {
        let mut saw = false;
        assert_eq!(evaluate_load_poll(None, &mut saw, true), LoadPoll::Pending);
    }
}

#[cfg(test)]
mod load_status_change_tests {
    use super::{parse_load_status_change, LoadStatusChange};

    fn sse_block(model: &str, event: &str, data: serde_json::Value) -> String {
        let payload = serde_json::json!({ "model": model, "event": event, "data": data });
        format!("data: {}\n\n", payload)
    }

    #[test]
    fn parses_loading_loaded_and_failed_unloaded() {
        let b = sse_block("m", "status_change", serde_json::json!({ "status": "loading" }));
        assert_eq!(parse_load_status_change(&b, "m"), Some(LoadStatusChange::Loading));

        let b = sse_block("m", "status_change", serde_json::json!({ "status": "loaded" }));
        assert_eq!(parse_load_status_change(&b, "m"), Some(LoadStatusChange::Loaded));

        let b = sse_block(
            "m",
            "status_change",
            serde_json::json!({ "status": "unloaded", "exit_code": 1 }),
        );
        assert_eq!(
            parse_load_status_change(&b, "m"),
            Some(LoadStatusChange::Unloaded { exit_code: Some(1) })
        );
    }

    #[test]
    fn ignores_other_models_and_events() {
        let b = sse_block(
            "other-model",
            "status_change",
            serde_json::json!({ "status": "unloaded", "exit_code": 1 }),
        );
        assert_eq!(parse_load_status_change(&b, "m"), None);

        let b = sse_block("m", "model_status", serde_json::json!({ "status": "unloaded" }));
        assert_eq!(parse_load_status_change(&b, "m"), None);
    }

    #[test]
    fn tolerates_malformed_blocks() {
        assert_eq!(parse_load_status_change("data: not-json\n\n", "m"), None);
        assert_eq!(parse_load_status_change(": keepalive\n\n", "m"), None);
    }
}

#[cfg(test)]
mod load_progress_tests {
    use super::parse_load_progress_event;

    fn sse_block(model: &str, event: &str, data: serde_json::Value) -> String {
        let payload = serde_json::json!({ "model": model, "event": event, "data": data });
        format!("data: {}\n\n", payload)
    }

    #[test]
    fn parses_a_matching_progress_event() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({
                "status": "loading",
                "progress": { "stages": ["text_model"], "current": "text_model", "value": 0.42 }
            }),
        );
        let payload = parse_load_progress_event(&block, "model-1").expect("should parse");
        assert_eq!(payload.model, "model-1");
        assert_eq!(payload.stage.as_deref(), Some("text_model"));
        assert_eq!(payload.stages, vec!["text_model".to_string()]);
        assert!((payload.value - 0.42).abs() < f64::EPSILON);
    }

    #[test]
    fn parses_a_multi_stage_vision_model_load() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({
                "status": "loading",
                "progress": {
                    "stages": ["text_model", "mmproj_model"],
                    "current": "mmproj_model",
                    "value": 0.8
                }
            }),
        );
        let payload = parse_load_progress_event(&block, "model-1").expect("should parse");
        assert_eq!(payload.stage.as_deref(), Some("mmproj_model"));
        assert_eq!(
            payload.stages,
            vec!["text_model".to_string(), "mmproj_model".to_string()]
        );
    }

    #[test]
    fn defaults_missing_stages_array_to_empty() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "progress": { "current": "text_model", "value": 0.5 } }),
        );
        let payload = parse_load_progress_event(&block, "model-1").expect("should parse");
        assert!(payload.stages.is_empty());
    }

    #[test]
    fn ignores_events_for_a_different_model() {
        let block = sse_block(
            "other-model",
            "status_change",
            serde_json::json!({ "progress": { "current": "text_model", "value": 0.5 } }),
        );
        assert!(parse_load_progress_event(&block, "model-1").is_none());
    }

    #[test]
    fn ignores_non_status_change_events() {
        let block = sse_block(
            "model-1",
            "download_progress",
            serde_json::json!({ "done": 10, "total": 100 }),
        );
        assert!(parse_load_progress_event(&block, "model-1").is_none());
    }

    #[test]
    fn ignores_status_change_without_progress() {
        let block = sse_block("model-1", "status_change", serde_json::json!({ "status": "loaded" }));
        assert!(parse_load_progress_event(&block, "model-1").is_none());
    }

    #[test]
    fn ignores_null_progress() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "status": "loaded", "progress": null }),
        );
        assert!(parse_load_progress_event(&block, "model-1").is_none());
    }

    #[test]
    fn ignores_malformed_json() {
        let block = "data: not json at all\n\n".to_string();
        assert!(parse_load_progress_event(&block, "model-1").is_none());
    }

    #[test]
    fn ignores_blocks_with_no_data_line() {
        let block = "event: ping\n\n".to_string();
        assert!(parse_load_progress_event(&block, "model-1").is_none());
    }

    #[test]
    fn defaults_missing_value_to_zero() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "progress": { "current": "text_model" } }),
        );
        let payload = parse_load_progress_event(&block, "model-1").expect("should parse");
        assert_eq!(payload.value, 0.0);
        assert_eq!(payload.stage.as_deref(), Some("text_model"));
    }

    #[test]
    fn defaults_missing_stage_to_none() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "progress": { "value": 0.9 } }),
        );
        let payload = parse_load_progress_event(&block, "model-1").expect("should parse");
        assert!(payload.stage.is_none());
    }
}

#[cfg(test)]
mod unload_watcher_tests {
    use super::parse_unload_event;

    fn sse_block(model: &str, event: &str, data: serde_json::Value) -> String {
        let payload = serde_json::json!({ "model": model, "event": event, "data": data });
        format!("data: {}\n\n", payload)
    }

    #[test]
    fn parses_an_unload_event_with_exit_code() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "status": "unloaded", "exit_code": 137 }),
        );
        let payload = parse_unload_event(&block).expect("should parse");
        assert_eq!(payload.model, "model-1");
        assert_eq!(payload.exit_code, Some(137));
    }

    #[test]
    fn parses_a_clean_unload_with_zero_exit_code() {
        // LRU eviction / explicit unload: clean stop, exit_code 0.
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "status": "unloaded", "exit_code": 0 }),
        );
        let payload = parse_unload_event(&block).expect("should parse");
        assert_eq!(payload.exit_code, Some(0));
    }

    #[test]
    fn ignores_non_unloaded_status() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "status": "loading" }),
        );
        assert!(parse_unload_event(&block).is_none());
    }

    #[test]
    fn ignores_non_status_change_events() {
        let block = sse_block(
            "model-1",
            "model_remove",
            serde_json::json!({}),
        );
        assert!(parse_unload_event(&block).is_none());
    }

    #[test]
    fn defaults_missing_exit_code_to_none() {
        let block = sse_block(
            "model-1",
            "status_change",
            serde_json::json!({ "status": "unloaded" }),
        );
        let payload = parse_unload_event(&block).expect("should parse");
        assert_eq!(payload.exit_code, None);
    }

    #[test]
    fn ignores_malformed_json() {
        let block = "data: not json\n\n".to_string();
        assert!(parse_unload_event(&block).is_none());
    }

    #[test]
    fn ignores_missing_status_field() {
        let block = sse_block("model-1", "status_change", serde_json::json!({}));
        assert!(parse_unload_event(&block).is_none());
    }

    #[test]
    fn ignores_blocks_with_no_data_line() {
        let block = "event: ping\n\n".to_string();
        assert!(parse_unload_event(&block).is_none());
    }
}
