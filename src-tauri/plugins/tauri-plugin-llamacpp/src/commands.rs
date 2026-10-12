use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, State};

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

/// The loopback endpoint every model-lifecycle command talks to.
///
/// One place resolves the worker, so `load_llama_model`, `unload_llama_model`,
/// `ensure_session_ready`, `find_session_by_model`, `get_loaded_models` and the
/// health probes all reach it the same way.
async fn engine_endpoint<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<(u16, String, u32), String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let guard = state.engine.lock().await;
    let h = guard
        .as_ref()
        .ok_or_else(|| "no llama.cpp engine is running".to_string())?;
    Ok((h.port, h.api_key.clone(), h.pid))
}

/// Loopback only, so never through a proxy; see `loopback_client_builder`.
async fn http_client() -> reqwest::Client {
    crate::engine::worker::loopback_client_builder()
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| crate::engine::worker::loopback_client())
}

/// True when a request to the worker never got a response: refused, reset, or
/// timed out before it answered. Only these say anything about the worker
/// itself -- an HTTP error status means it is alive and talking.
fn never_reached_worker(e: &reqwest::Error) -> bool {
    e.status().is_none() && (e.is_connect() || e.is_timeout() || e.is_request())
}

/// The error with its causes. reqwest's own text stops at "error sending
/// request for url (...)", and whether that was a refusal, a reset or a proxy
/// is only in the source chain.
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut source = e.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !out.contains(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        source = cause.source();
    }
    out
}

/// What became of the worker a failed request was aimed at.
#[derive(Debug)]
enum WorkerFate {
    /// Its process has exited, and this is how.
    Exited(crate::engine::worker::ExitReport),
    /// No longer the registered worker -- already reaped, or replaced -- so
    /// there is no exit status left to report.
    Gone,
    /// Still running, yet its port did not answer.
    Running,
}

/// Checks the process, which is the one thing that tells the two causes of an
/// unreachable worker apart: a crash, or something between Jan and 127.0.0.1.
///
/// A worker found dead is reaped here, as `get_engine_info` does, so the next
/// load starts a fresh one instead of failing against the same closed port.
async fn worker_fate(state: &LlamacppState, port: u16) -> WorkerFate {
    let mut guard = state.engine.lock().await;
    let Some(handle) = guard.as_mut().filter(|h| h.port == port) else {
        return WorkerFate::Gone;
    };
    match handle.exit_report() {
        Some(report) => {
            log::error!(
                "jan-llama-worker exited unexpectedly ({}); last output: {:?}",
                report.status,
                report.last_lines
            );
            *guard = None;
            WorkerFate::Exited(report)
        }
        None => WorkerFate::Running,
    }
}

/// The error for a worker that did not answer. `message` is the full English
/// account; `details` is the evidence the UI shows beside its localized text
/// for the code, so it leads with what a support thread would ask for.
fn unreachable_worker_error(port: u16, fate: WorkerFate, cause: &str) -> LlamacppError {
    match fate {
        WorkerFate::Exited(report) => {
            let mut details = report.status.clone();
            if !report.last_lines.is_empty() {
                details.push_str(". Last output: ");
                details.push_str(&report.last_lines.join(" / "));
            }
            LlamacppError::new(
                ErrorCode::EngineStopped,
                format!(
                    "The llama.cpp engine stopped unexpectedly ({}).",
                    report.status
                ),
                Some(details),
            )
        }
        WorkerFate::Gone => LlamacppError::new(
            ErrorCode::EngineStopped,
            "The llama.cpp engine stopped unexpectedly.".into(),
            Some(cause.to_string()),
        ),
        WorkerFate::Running => LlamacppError::new(
            ErrorCode::EngineUnreachable,
            format!(
                "The llama.cpp engine is running, but Jan cannot connect to it on \
                 127.0.0.1:{port}. A VPN, proxy or security software may be blocking \
                 local connections."
            ),
            Some(format!("127.0.0.1:{port}: {cause}")),
        ),
    }
}

/// Turns a failed request to the worker into the error the user sees. A
/// request that never reached it is explained from the worker's own state;
/// anything else keeps `context` and reqwest's text as before.
async fn worker_request_error(
    state: &LlamacppState,
    port: u16,
    context: &str,
    e: reqwest::Error,
) -> LlamacppError {
    let generic = |e: &reqwest::Error| {
        LlamacppError::new(
            ErrorCode::InternalError,
            context.to_string(),
            Some(error_chain(e)),
        )
    };
    if !never_reached_worker(&e) {
        return generic(&e);
    }
    let fate = worker_fate(state, port).await;
    // A live worker that merely took too long -- a slow load, a busy machine
    // -- was reached; blaming a VPN or a proxy for that would send the user
    // looking in the wrong place. A connect timeout still counts as unreached.
    if matches!(fate, WorkerFate::Running) && e.is_timeout() && !e.is_connect() {
        return generic(&e);
    }
    unreachable_worker_error(port, fate, &error_chain(&e))
}

/// For the commands that return `String` errors: the structured error as JSON,
/// which `parseEngineError` on the web side recovers from a message string, so
/// it is shown from its code like any other engine error.
fn into_string_error(err: LlamacppError) -> String {
    serde_json::to_string(&err).unwrap_or(err.message)
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
    subscribed_tx: tokio::sync::oneshot::Sender<()>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        use futures_util::StreamExt;

        // Fires on every exit from the connect, success or not, so a caller
        // waiting to be subscribed is never left waiting on a feed that will
        // not arrive.
        let mut subscribed_tx = Some(subscribed_tx);
        let mut announce = move || {
            if let Some(tx) = subscribed_tx.take() {
                let _ = tx.send(());
            }
        };

        let client = http_client().await;
        let url = format!("http://127.0.0.1:{}/models/sse", port);
        let resp = match client.get(&url).bearer_auth(&api_key).send().await {
            Ok(r) => r,
            Err(e) => {
                log::debug!("model load progress: failed to connect to /models/sse: {}", e);
                announce();
                return;
            }
        };
        if !resp.status().is_success() {
            log::debug!(
                "model load progress unavailable on this backend (/models/sse returned {}); \
                 falling back to the plain loading indicator",
                resp.status()
            );
            announce();
            return;
        }
        // Headers are in, so the server has already subscribed us: no
        // transition can be missed from here on.
        announce();

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

/// The engine's own message out of the worker's `{"error":{...}}` envelope.
/// The HTTP status only says the load was refused; this is the part that names
/// the cause, and it is what the user needs to see.
fn engine_error_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let msg = v
        .pointer("/error/message")
        .and_then(serde_json::Value::as_str)?
        .trim();
    (!msg.is_empty()).then(|| msg.to_string())
}

/// A refused `/models/load` reported as the engine failure it is: the code the
/// UI localizes comes from llama.cpp's own text, and `details` carries that
/// text verbatim rather than a bare status line.
fn load_rejection_error(status: u16, body: &str) -> LlamacppError {
    let reason = engine_error_message(body).unwrap_or_else(|| body.trim().to_string());
    let mut err = LlamacppError::from_load_failure(&reason);
    err.details = Some(if reason.is_empty() {
        format!("HTTP {status} from /models/load")
    } else {
        reason
    });
    err
}

/// How long a load waits to be subscribed to `/models/sse` before giving up on
/// the feed. Generous enough for a loopback round trip, short enough that a
/// backend without the endpoint costs nothing noticeable.
const SUBSCRIBE_TIMEOUT: Duration = Duration::from_secs(2);

async fn post_load<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    port: u16,
    api_key: &str,
    model_id: &str,
) -> ServerResult<()> {
    // Subscribed before the POST, not after: the engine answers `/models/load`
    // only once the load has finished, so a listener started afterwards would
    // join a stream on which every transition for this attempt has already
    // been sent.
    let (fail_tx, fail_rx) = tokio::sync::oneshot::channel();
    let (subscribed_tx, subscribed_rx) = tokio::sync::oneshot::channel();
    let progress_task = spawn_load_progress_listener(
        app_handle.clone(),
        port,
        api_key.to_string(),
        model_id.to_string(),
        fail_tx,
        subscribed_tx,
    );
    // Bounded: a backend without the feed still answers, but a hang here must
    // not become a hang in the load.
    if tokio::time::timeout(SUBSCRIBE_TIMEOUT, subscribed_rx).await.is_err() {
        log::debug!("/models/sse did not answer within {SUBSCRIBE_TIMEOUT:?}; loading anyway");
    }

    let state: State<Arc<LlamacppState>> = app_handle.state();
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models/load", port);
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&ModelRequestBody { model: model_id })
        .send()
        .await;
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            progress_task.abort();
            let err = worker_request_error(
                &state,
                port,
                "Failed to call the engine's /models/load",
                e,
            )
            .await;
            return Err(ServerError::Llamacpp(err));
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        if !body.to_lowercase().contains("already") {
            progress_task.abort();
            return Err(ServerError::Llamacpp(load_rejection_error(
                status.as_u16(),
                &body,
            )));
        }
    }

    // Definitive failure signal from the SSE stream; pends forever if the
    // listener ends without one (older backend, dropped connection) so the
    // polling arm below always remains the fallback.
    let sse_failure = async {
        match fail_rx.await {
            Ok(exit_code) => exit_code,
            Err(_) => std::future::pending().await,
        }
    };

    // The engine answers only once the load has finished, so this normally
    // resolves on the first poll. It stays as the fallback for the case where
    // the answer said "already loading" and someone else owns the attempt.
    let result = tokio::select! {
        r = wait_until_loaded(&state, port, api_key, model_id, Duration::from_secs(600)) => r,
        exit_code = sse_failure => Err(ServerError::Llamacpp(LlamacppError::new(
            ErrorCode::ModelLoadFailed,
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
    state: &LlamacppState,
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
        // A worker that dies mid-load (a GPU init crash, antivirus) surfaces
        // here, as the next poll failing to connect.
        let resp = match client.get(&url).bearer_auth(api_key).send().await {
            Ok(r) => r,
            Err(e) => {
                let err =
                    worker_request_error(state, port, "Failed to poll router /models", e).await;
                return Err(ServerError::Llamacpp(err));
            }
        };

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
                    ErrorCode::ModelLoadFailed,
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

async fn engine_loaded_model_ids(
    state: &LlamacppState,
    port: u16,
    api_key: &str,
) -> Result<Vec<String>, String> {
    // Router-aware listing: `/models` (not `/v1/models`, which is OAI-compat
    // and returns a single element). Each entry has a `status` object whose
    // `value` is one of "loaded" / "loading" / "unloaded" / "sleeping".
    //
    // This is the first request of every model start (the frontend asks what
    // is loaded before loading), so a dead or unreachable worker is reported
    // from here more often than from anywhere else.
    let client = http_client().await;
    let url = format!("http://127.0.0.1:{}/models", port);
    let resp = match client.get(&url).bearer_auth(api_key).send().await {
        Ok(r) => r,
        Err(e) => {
            let err = worker_request_error(state, port, "Failed to query /models", e).await;
            return Err(into_string_error(err));
        }
    };
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
    let (port, api_key, pid) = engine_endpoint(&app_handle)
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
    let (port, api_key, _pid) = engine_endpoint(&app_handle)
        .await
        .map_err(ServerError::InvalidArgument)?;
    match post_unload(port, &api_key, &model_id).await {
        Ok(()) => Ok(UnloadResult { success: true, error: None }),
        Err(e) => Ok(UnloadResult { success: false, error: Some(e) }),
    }
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
    let (port, api_key, pid) = engine_endpoint(&app_handle).await?;
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
    let (port, api_key, pid) = match engine_endpoint(&app_handle).await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let ids = engine_loaded_model_ids(&state, port, &api_key).await?;
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
    let (port, api_key, _pid) = match engine_endpoint(&app_handle).await {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };
    let state: State<Arc<LlamacppState>> = app_handle.state();
    engine_loaded_model_ids(&state, port, &api_key).await
}

#[cfg(test)]
mod unreachable_worker_tests {
    use super::*;
    use crate::engine::worker::{self, ExitReport};
    use std::path::Path;

    fn json(err: &LlamacppError) -> serde_json::Value {
        serde_json::to_value(err).unwrap()
    }

    #[test]
    fn a_worker_that_exited_is_reported_as_stopped_with_its_exit_and_last_words() {
        let fate = WorkerFate::Exited(ExitReport {
            status: "exit code 0xC0000005".into(),
            last_lines: vec![
                "ggml_cuda_init: found 1 CUDA devices".into(),
                "CUDA error: unspecified launch failure".into(),
            ],
        });
        let err = unreachable_worker_error(51825, fate, "error sending request");
        let v = json(&err);
        assert_eq!(v["code"], "ENGINE_STOPPED");
        assert_eq!(
            err.message,
            "The llama.cpp engine stopped unexpectedly (exit code 0xC0000005)."
        );
        let details = err.details.unwrap();
        assert!(details.starts_with("exit code 0xC0000005"), "{details}");
        assert!(details.contains("unspecified launch failure"), "{details}");
    }

    #[test]
    fn a_silent_exit_reports_just_the_status() {
        let fate = WorkerFate::Exited(ExitReport {
            status: "killed by SIGKILL".into(),
            last_lines: vec![],
        });
        let err = unreachable_worker_error(1, fate, "refused");
        assert_eq!(err.details.as_deref(), Some("killed by SIGKILL"));
    }

    #[test]
    fn a_worker_already_reaped_is_still_reported_as_stopped() {
        let err = unreachable_worker_error(1, WorkerFate::Gone, "connection refused");
        assert_eq!(json(&err)["code"], "ENGINE_STOPPED");
        assert_eq!(err.details.as_deref(), Some("connection refused"));
    }

    // The case a VPN or proxy produces: nothing wrong with the engine, so the
    // message has to point away from it, at what sits in between.
    #[test]
    fn a_live_worker_that_cannot_be_reached_points_at_what_is_in_between() {
        let err = unreachable_worker_error(51825, WorkerFate::Running, "connection refused");
        assert_eq!(json(&err)["code"], "ENGINE_UNREACHABLE");
        assert!(err.message.contains("127.0.0.1:51825"), "{}", err.message);
        for hint in ["VPN", "proxy", "security software"] {
            assert!(err.message.contains(hint), "{}", err.message);
        }
        assert_eq!(
            err.details.as_deref(),
            Some("127.0.0.1:51825: connection refused")
        );
    }

    // `engineError.ts` recovers this from a message string, so it has to be
    // the same JSON a structured Tauri error would have been.
    #[test]
    fn a_string_error_carries_the_structured_error_as_json() {
        let err = unreachable_worker_error(1, WorkerFate::Gone, "x");
        let v: serde_json::Value = serde_json::from_str(&into_string_error(err)).unwrap();
        assert_eq!(v["code"], "ENGINE_STOPPED");
        assert!(v["message"].is_string());
    }

    /// A loopback port nothing listens on.
    fn closed_port() -> u16 {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    }

    #[tokio::test]
    async fn a_refused_connection_counts_as_never_reaching_the_worker() {
        let port = closed_port();
        let e = worker::loopback_client()
            .get(format!("http://127.0.0.1:{port}/models"))
            .send()
            .await
            .expect_err("nothing listens there");
        assert!(never_reached_worker(&e), "{e:?}");
        let chain = error_chain(&e);
        assert!(chain.len() > e.to_string().len(), "the cause is appended: {chain}");
    }

    #[cfg(unix)]
    async fn spawn_fake(dir: &Path, body: &str) -> worker::WorkerHandle {
        let exe = worker::tests::fake_worker(dir, body);
        worker::tests::spawn_script(&exe)
            .await
            .expect("the fake worker prints a handshake")
    }

    // End to end through the command path: a worker that handshakes, then
    // crashes, is reported from its exit status and stderr rather than as
    // "error sending request for url", and is reaped so the next load can
    // start a fresh one.
    #[cfg(unix)]
    #[tokio::test]
    async fn listing_models_on_a_crashed_worker_says_the_engine_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let port = closed_port();
        let handle = spawn_fake(
            dir.path(),
            &format!(
                "echo '{{\"port\":{port},\"pid\":'$$'}}'\n\
                 echo 'CUDA error: unspecified launch failure' >&2\n\
                 exit 3"
            ),
        )
        .await;
        let state = LlamacppState::new();
        *state.engine.lock().await = Some(handle);

        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while state.engine.lock().await.as_mut().unwrap().exited().is_none() {
            assert!(std::time::Instant::now() < deadline, "fake worker did not exit");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        // Let the stderr drain catch the last line, as it has long since in
        // the field by the time the user sends a message.
        tokio::time::sleep(Duration::from_millis(200)).await;

        let err = engine_loaded_model_ids(&state, port, "k").await.unwrap_err();
        let v: serde_json::Value = serde_json::from_str(&err).expect(&err);
        assert_eq!(v["code"], "ENGINE_STOPPED", "{v}");
        assert!(v["message"].as_str().unwrap().contains("exit code 3"), "{v}");
        assert!(
            v["details"].as_str().unwrap().contains("unspecified launch failure"),
            "{v}"
        );
        assert!(state.engine.lock().await.is_none(), "a dead worker is reaped");

        let again = engine_loaded_model_ids(&state, port, "k").await.unwrap_err();
        assert!(again.contains("ENGINE_STOPPED"), "{again}");
    }

    // A worker that accepts the connection but has not answered yet -- a long
    // model load -- is reachable, so the message must not blame a proxy.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_slow_answer_from_a_live_worker_is_not_blamed_on_the_connection() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Accepts and then says nothing, like a worker busy loading.
        let server = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let dir = tempfile::tempdir().unwrap();
        let handle = spawn_fake(
            dir.path(),
            &format!("echo '{{\"port\":{port},\"pid\":'$$'}}'\nexec sleep 30"),
        )
        .await;
        let state = LlamacppState::new();
        *state.engine.lock().await = Some(handle);

        let e = worker::loopback_client_builder()
            .timeout(Duration::from_millis(300))
            .build()
            .unwrap()
            .get(format!("http://127.0.0.1:{port}/models"))
            .send()
            .await
            .expect_err("the server never answers");
        assert!(e.is_timeout(), "{e:?}");
        let err = worker_request_error(&state, port, "Failed to query /models", e).await;
        assert_eq!(json(&err)["code"], "INTERNAL_ERROR", "{err:?}");
        assert_eq!(err.message, "Failed to query /models");

        server.abort();
        state.engine.lock().await.take().unwrap().kill().await;
    }

    // A worker that is alive but whose port refuses: what a firewall, a VPN or
    // a proxy capturing loopback looks like from here.
    #[cfg(unix)]
    #[tokio::test]
    async fn listing_models_on_a_live_but_unreachable_worker_blames_the_connection() {
        let dir = tempfile::tempdir().unwrap();
        let port = closed_port();
        let handle = spawn_fake(
            dir.path(),
            &format!("echo '{{\"port\":{port},\"pid\":'$$'}}'\nexec sleep 30"),
        )
        .await;
        let state = LlamacppState::new();
        *state.engine.lock().await = Some(handle);

        let err = engine_loaded_model_ids(&state, port, "k").await.unwrap_err();
        let v: serde_json::Value = serde_json::from_str(&err).expect(&err);
        assert_eq!(v["code"], "ENGINE_UNREACHABLE", "{v}");
        assert!(
            v["message"].as_str().unwrap().contains(&format!("127.0.0.1:{port}")),
            "{v}"
        );

        let handle = state.engine.lock().await.take();
        assert!(handle.is_some(), "a live worker is left in place");
        handle.unwrap().kill().await;
    }
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
mod load_rejection_tests {
    use super::{engine_error_message, load_rejection_error};
    use crate::error::ErrorCode;

    fn envelope(message: &str) -> String {
        serde_json::json!({ "error": { "code": 400, "message": message } }).to_string()
    }

    #[test]
    fn reads_the_engine_message_out_of_the_envelope() {
        assert_eq!(
            engine_error_message(&envelope("failed to load model")).as_deref(),
            Some("failed to load model")
        );
        assert!(engine_error_message("not json").is_none());
        assert!(engine_error_message(&envelope("   ")).is_none());
    }

    // The whole point: a VRAM exhaustion has to reach the UI as OUT_OF_MEMORY,
    // not as INTERNAL_ERROR plus an HTTP status the user cannot act on.
    #[test]
    fn a_cuda_oom_is_classified_and_keeps_the_engine_text() {
        let body = envelope(
            "could not start the llama.cpp engine: failed to load model; \
             ggml_backend_cuda_buffer_type_alloc_buffer: allocating 2375.91 MiB on device 0: \
             cudaMalloc failed: out of memory",
        );
        let err = load_rejection_error(400, &body);

        assert!(matches!(err.code, ErrorCode::OutOfMemory), "{:?}", err.code);
        let details = err.details.expect("details");
        assert!(details.contains("cudaMalloc failed: out of memory"), "{details}");
        assert!(!details.contains("400"), "{details}");
    }

    #[test]
    fn an_unrecognized_reason_is_a_failed_load_not_an_internal_error() {
        let err = load_rejection_error(400, &envelope("no such preset: ghost"));

        assert!(matches!(err.code, ErrorCode::ModelLoadFailed), "{:?}", err.code);
        assert_eq!(err.details.as_deref(), Some("no such preset: ghost"));
    }

    #[test]
    fn a_bodyless_rejection_still_names_the_status() {
        let err = load_rejection_error(503, "");

        assert!(matches!(err.code, ErrorCode::ModelLoadFailed), "{:?}", err.code);
        assert_eq!(
            err.details.as_deref(),
            Some("HTTP 503 from /models/load")
        );
    }
}

/// The two sides of `/models/sse` in one place: what the worker serializes
/// (`engine::events`) against what the desktop parses. They are separate
/// modules with no shared type, so nothing but a test keeps them in step --
/// and a drift here is silent, costing every load its full 600s timeout
/// instead of an error.
#[cfg(test)]
mod sse_contract_tests {
    use super::{parse_load_progress_event, parse_load_status_change, LoadStatusChange};
    use crate::engine::events::{ModelEvent, Transition};

    fn frame(model: &str, status: Transition) -> String {
        ModelEvent {
            model: model.to_string(),
            status,
        }
        .to_sse_frame()
    }

    #[test]
    fn the_parser_reads_every_transition_the_engine_emits() {
        assert_eq!(
            parse_load_status_change(&frame("m", Transition::Loading), "m"),
            Some(LoadStatusChange::Loading)
        );
        assert_eq!(
            parse_load_status_change(&frame("m", Transition::Loaded), "m"),
            Some(LoadStatusChange::Loaded)
        );
        assert_eq!(
            parse_load_status_change(&frame("m", Transition::Unloaded { exit_code: 1 }), "m"),
            Some(LoadStatusChange::Unloaded { exit_code: Some(1) })
        );
        assert_eq!(
            parse_load_status_change(&frame("m", Transition::Unloaded { exit_code: 0 }), "m"),
            Some(LoadStatusChange::Unloaded { exit_code: Some(0) })
        );
    }

    // Only a nonzero code fails the load; an eviction or a deliberate unload
    // must not be mistaken for this attempt's failure.
    #[test]
    fn only_a_nonzero_exit_code_reads_as_a_failure() {
        let failed = parse_load_status_change(&frame("m", Transition::Unloaded { exit_code: 1 }), "m");
        let evicted = parse_load_status_change(&frame("m", Transition::Unloaded { exit_code: 0 }), "m");

        assert!(matches!(
            failed,
            Some(LoadStatusChange::Unloaded { exit_code: Some(c) }) if c != 0
        ));
        assert!(matches!(
            evicted,
            Some(LoadStatusChange::Unloaded { exit_code: Some(0) })
        ));
    }

    #[test]
    fn another_models_transition_is_ignored() {
        assert_eq!(
            parse_load_status_change(&frame("other", Transition::Loading), "m"),
            None
        );
    }

    // A lifecycle transition carries no fraction, so the parser must find
    // nothing rather than emitting a 0% event that would stall the bar.
    #[test]
    fn no_lifecycle_transition_carries_a_progress_payload() {
        for status in [
            Transition::Loading,
            Transition::Loaded,
            Transition::Unloaded { exit_code: 0 },
        ] {
            assert!(parse_load_progress_event(&frame("m", status), "m").is_none());
        }
    }

    // The two halves of the progress chain are written apart -- the engine
    // publishes the transition, the desktop parses the frame -- so this pins
    // that they still agree on the shape.
    #[test]
    fn a_progress_transition_round_trips_to_a_payload() {
        let status = Transition::LoadProgress(serde_json::json!({
            "stages": ["text_model", "spec_model"],
            "current": "spec_model",
            "value": 0.75,
        }));
        let payload = parse_load_progress_event(&frame("m", status), "m")
            .expect("a progress payload");

        assert_eq!(payload.model, "m");
        assert_eq!(payload.value, 0.75);
        assert_eq!(payload.stage.as_deref(), Some("spec_model"));
        assert_eq!(payload.stages, vec!["text_model", "spec_model"]);
    }

    // Another model loading concurrently must not move this model's bar.
    #[test]
    fn a_progress_transition_for_another_model_is_ignored() {
        let status = Transition::LoadProgress(serde_json::json!({ "value": 0.5 }));
        assert!(parse_load_progress_event(&frame("other", status), "m").is_none());
    }
}
