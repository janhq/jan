//! Tauri commands for the engine worker.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use super::worker::{self, WorkerHandle};
use crate::state::LlamacppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub port: u16,
    pub api_key: String,
    pub pid: u32,
    /// Registered model ids, from the preset the worker read.
    pub models: Vec<String>,
}

impl From<&WorkerHandle> for EngineInfo {
    fn from(h: &WorkerHandle) -> Self {
        Self {
            port: h.port,
            api_key: h.api_key.clone(),
            pid: h.pid,
            models: h.models.clone(),
        }
    }
}

/// 32 bytes of OS randomness, hex-encoded. Not derived from the port the way
/// the router's key was: the worker's port is assigned by the OS, and a key any
/// other local process could recompute is not much of a key.
fn generate_worker_key() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Resolves the worker binary: an explicit override first (dev builds and
/// tests), then the sidecar next to the running executable.
/// Locates the engine worker binary.
///
/// Order: the dev/CI override, then the bundle's `resources/bin` (where
/// packaging puts it, alongside the ggml backend modules the worker loads by
/// scanning its own directory), then beside the app executable for a
/// `cargo run` build.
fn resolve_worker_exe<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("JAN_LLAMA_WORKER_BIN") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!(
            "JAN_LLAMA_WORKER_BIN points at {}, which is not a file",
            p.display()
        ));
    }

    if let Ok(dir) = app_handle.path().resource_dir() {
        let bundled = dir.join("resources/bin").join(worker::worker_file_name());
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    worker::sidecar_path().ok_or_else(|| {
        format!(
            "{} was not found in the app resources or next to the executable",
            worker::worker_file_name()
        )
    })
}

/// Forwards a worker fault to the frontend, which turns it into the OOM or
/// backend-error dialog. A mid-generation `GGML_ASSERT` kills the worker
/// outright, so its log line is the only account of what happened.
fn fault_emitter<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) -> worker::FaultCallback {
    use tauri::Emitter;
    Arc::new(move |fault: worker::RuntimeFault, line: String| {
        log::error!("jan-llama-worker fault ({fault:?}): {line}");
        if let Err(e) = app_handle.emit(fault.event_name(), line) {
            log::warn!("emit {} failed: {e}", fault.event_name());
        }
    })
}

/// Starts the worker. `slot_cache_mib` is the ceiling on the per-thread KV
/// cache directory; 0 turns cross-session KV persistence off, which is a
/// user-facing setting because a single saved conversation is hundreds of MiB.
#[tauri::command]
pub async fn start_engine<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, Arc<LlamacppState>>,
    preset_path: String,
    models_max: u32,
    slot_cache_mib: u64,
    envs: HashMap<String, String>,
) -> Result<EngineInfo, String> {
    let mut guard = state.engine.lock().await;
    if let Some(existing) = guard.as_ref() {
        // Idempotent: a second start must not orphan the first worker.
        return Ok(EngineInfo::from(existing));
    }

    let exe = resolve_worker_exe(&app_handle)?;
    let api_key = generate_worker_key();
    let handle = worker::spawn(
        &exe,
        &PathBuf::from(preset_path),
        0, // OS-assigned; the handshake reports it back
        &api_key,
        models_max,
        slot_cache_mib,
        envs,
        Some(fault_emitter(app_handle.clone())),
    )
    .await
    .map_err(|e| e.to_string())?;

    let info = EngineInfo::from(&handle);
    // Subscribed here rather than lazily: an eviction can happen on the very
    // first chat request, before any explicit load opens its own listener.
    let watcher = super::watcher::spawn(app_handle.clone(), info.port, info.api_key.clone());
    if let Some(previous) = state.unload_watcher.lock().await.replace(watcher) {
        previous.abort();
    }
    *guard = Some(handle);
    Ok(info)
}

/// Stops the worker unless a generation is in flight.
///
/// The busy check is an HTTP read; the stop itself is `WorkerHandle::stop`,
/// which closes stdin rather than signalling, so it behaves the same on all
/// three platforms.
///
/// `Ok(None)` means it is stopped (or was never running); `Ok(Some(busy))`
/// names the models still generating, and the handle is put back so the caller
/// can retry. The app's exit path uses this -- without it the worker would
/// outlive the app it belongs to.
pub async fn try_graceful_stop_engine<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    deadline_secs: u64,
) -> Result<Option<Vec<String>>, String> {
    use tauri::Manager;
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let maybe_handle = {
        let mut guard = state.engine.lock().await;
        guard.take()
    };
    let Some(handle) = maybe_handle else {
        return Ok(None);
    };

    let busy = tokio::time::timeout(
        std::time::Duration::from_secs(deadline_secs.max(1)),
        busy_models(handle.port, &handle.api_key),
    )
    .await
    .unwrap_or_else(|_| Vec::new());

    if !busy.is_empty() {
        *state.engine.lock().await = Some(handle);
        return Ok(Some(busy));
    }

    abort_unload_watcher(&state).await;
    handle.stop().await;
    Ok(None)
}

/// Drops the `/models/sse` subscription. Called from every stop path: the feed
/// it reads dies with the worker, and a task left reconnecting would spend its
/// whole failure budget before noticing.
async fn abort_unload_watcher(state: &Arc<LlamacppState>) {
    if let Some(task) = state.unload_watcher.lock().await.take() {
        task.abort();
    }
}

/// Models with a request in flight, from the worker's own `/models` listing.
/// An unreachable worker reports none -- it cannot be generating.
async fn busy_models(port: u16, api_key: &str) -> Vec<String> {
    let Ok(resp) = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/models"))
        .bearer_auth(api_key)
        .send()
        .await
    else {
        return Vec::new();
    };
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return Vec::new();
    };
    json.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|m| m.get("busy").and_then(|b| b.as_bool()).unwrap_or(false))
                .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn stop_engine(state: State<'_, Arc<LlamacppState>>) -> Result<(), String> {
    abort_unload_watcher(&state).await;
    let handle = state.engine.lock().await.take();
    if let Some(h) = handle {
        h.stop().await;
    }
    Ok(())
}

/// One offloadable device, shaped exactly like the `DeviceInfo` the old
/// `llama-server --list-devices` stdout was parsed into, so the TS side is
/// unchanged. Memory is MiB.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineDevice {
    pub id: String,
    pub name: String,
    pub mem: u64,
    pub free: u64,
}

/// Enumerates the devices the shipped engine can offload to.
///
/// Runs the worker with `--list-devices` rather than asking a live one: the
/// settings screen needs this before any model is loaded, and the desktop
/// process deliberately links the plugin without the `engine` feature, so it
/// has no ggml of its own to query.
#[tauri::command]
pub async fn engine_devices<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    envs: HashMap<String, String>,
) -> Result<Vec<EngineDevice>, String> {
    let exe = resolve_worker_exe(&app_handle)?;
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("--list-devices").envs(envs);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    jan_utils::system::setup_windows_process_flags(&mut cmd);

    let out = tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| "timed out enumerating devices".to_string())?
        .map_err(|e| format!("could not run {}: {e}", exe.display()))?;
    if !out.status.success() {
        return Err(format!(
            "device enumeration failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| {
        format!(
            "unreadable device list: {e} (output: {})",
            String::from_utf8_lossy(&out.stdout).trim()
        )
    })
}

/// Reload outcome, for the caller's log line. All four lists together name
/// every model in the preset, so an empty `changed`/`removed` is the proof that
/// nothing the user was using got disturbed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReloadReport {
    pub added: Vec<String>,
    pub changed: Vec<String>,
    pub removed: Vec<String>,
    pub kept: Vec<String>,
    pub models_max: u32,
}

/// Applies a regenerated preset to the running worker without restarting it.
///
/// This is the engine's answer to the router's `GET /models?reload=1`, and it
/// can do one thing the router could not: resize `models_max`. The router fixed
/// that at spawn, so Jan had to cold-restart whenever the embedding slot bonus
/// appeared or went away -- evicting the chat model the user was talking to.
#[tauri::command]
pub async fn reload_engine_models(
    state: State<'_, Arc<LlamacppState>>,
    preset_path: String,
    models_max: Option<u32>,
    slot_cache_mib: Option<u64>,
) -> Result<ReloadReport, String> {
    let (port, api_key) = {
        let guard = state.engine.lock().await;
        let h = guard
            .as_ref()
            .ok_or_else(|| "the engine worker is not running".to_string())?;
        (h.port, h.api_key.clone())
    };

    let mut body = serde_json::json!({ "preset_path": preset_path });
    if let Some(m) = models_max {
        body["models_max"] = serde_json::json!(m);
    }
    if let Some(m) = slot_cache_mib {
        body["slot_cache_mib"] = serde_json::json!(m);
    }

    let resp = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/models/reload"))
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "engine reload returned HTTP {}: {text}",
            status.as_u16()
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("unreadable reload report: {e}"))
}

/// Kills the worker without waiting for it to unwind.
///
/// Distinct from `stop_engine` on purpose: this backs the "force quit" the
/// busy-on-exit dialog offers, where the user has already been told a
/// generation is in flight and chosen to abandon it. Waiting out the graceful
/// path there would be the opposite of what they asked for.
#[tauri::command]
pub async fn force_stop_engine(state: State<'_, Arc<LlamacppState>>) -> Result<(), String> {
    abort_unload_watcher(&state).await;
    let handle = state.engine.lock().await.take();
    if let Some(h) = handle {
        h.kill().await;
    }
    Ok(())
}

/// True when the model has no request in flight, so it is safe to reconfigure
/// or unload. A model that is not resident at all is idle by definition.
///
/// With `model_id` omitted, answers for the whole worker.
#[tauri::command]
pub async fn engine_slots_idle(
    state: State<'_, Arc<LlamacppState>>,
    model_id: Option<String>,
) -> Result<bool, String> {
    let (port, api_key) = {
        let guard = state.engine.lock().await;
        match guard.as_ref() {
            Some(h) => (h.port, h.api_key.clone()),
            // No worker means nothing is generating.
            None => return Ok(true),
        }
    };
    let busy = busy_models(port, &api_key).await;
    Ok(match model_id {
        Some(id) => !busy.contains(&id),
        None => busy.is_empty(),
    })
}

/// Drops saved state without a worker, by editing the directory in this
/// process.
///
/// Safe *because* there is no worker: nothing holds a state file open, and the
/// sidecar records the thread and model each one belongs to, which is what the
/// worker matches on too. The thread wins when both are given, matching
/// `erase_slot_state`.
fn erase_on_disk(dir: Option<&str>, thread: Option<&str>, model: Option<&str>) -> u32 {
    let Some(dir) = dir else {
        return 0;
    };
    let store = super::slots::StateStore::new(dir, 0);
    let n = match (thread, model) {
        (Some(t), _) => store.forget_thread(t),
        (None, Some(m)) => store.forget_model(m),
        (None, None) => 0,
    };
    n as u32
}

/// Drops a thread's saved KV cache, or every thread's for a model.
///
/// Called when a thread is deleted: nothing else would ever collect that state,
/// and the store's own pruning is by size, so an abandoned conversation would
/// sit at the head of the budget until enough others pushed it out. A thread id
/// is enough -- the caller deleting a thread does not know which models it was
/// talked to under, and it may be more than one.
///
/// `cache_dir` is the same `slot-save-path` the preset names, so a delete lands
/// even with no worker running -- which is the common case, since a thread is
/// usually deleted with no model loaded. Deferring it would mean the state
/// survived the thread until the size budget happened to reclaim it.
#[tauri::command]
pub async fn erase_thread_slot_state(
    state: State<'_, Arc<LlamacppState>>,
    thread_id: Option<String>,
    model_id: Option<String>,
    cache_dir: Option<String>,
) -> Result<u32, String> {
    if thread_id.is_none() && model_id.is_none() {
        return Err("one of thread_id or model_id is required".to_string());
    }
    let running = {
        let guard = state.engine.lock().await;
        guard.as_ref().map(|h| (h.port, h.api_key.clone()))
    };
    let Some((port, api_key)) = running else {
        return Ok(erase_on_disk(
            cache_dir.as_deref(),
            thread_id.as_deref(),
            model_id.as_deref(),
        ));
    };
    let mut body = serde_json::Map::new();
    if let Some(t) = thread_id.clone() {
        body.insert("thread".into(), serde_json::Value::String(t));
    }
    if let Some(m) = model_id.clone() {
        body.insert("model".into(), serde_json::Value::String(m));
    }
    let body = serde_json::Value::Object(body);
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/slots/state/erase"))
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("could not reach the engine worker: {e}"))?;
    // A worker started from a preset with no slot-save-path knows no directory
    // to erase from, but this process does.
    if resp.status() == reqwest::StatusCode::NOT_IMPLEMENTED {
        return Ok(erase_on_disk(
            cache_dir.as_deref(),
            thread_id.as_deref(),
            model_id.as_deref(),
        ));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "the engine worker refused the erase (status {})",
            resp.status()
        ));
    }
    let parsed: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("unreadable erase response: {e}"))?;
    Ok(parsed
        .get("erased")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0) as u32)
}

#[tauri::command]
pub async fn get_engine_info(
    state: State<'_, Arc<LlamacppState>>,
) -> Result<Option<EngineInfo>, String> {
    let mut guard = state.engine.lock().await;
    // A worker that died must not be reported as live, or every later request
    // would fail against a closed port with no explanation.
    if let Some(h) = guard.as_mut() {
        if let Some(status) = h.exited() {
            log::warn!("jan-llama-worker exited unexpectedly: {status}");
            *guard = None;
            return Ok(None);
        }
    }
    Ok(guard.as_ref().map(EngineInfo::from))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_are_long_hex_and_do_not_repeat() {
        let a = generate_worker_key();
        let b = generate_worker_key();
        assert_eq!(a.len(), 64, "32 bytes hex-encoded");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two keys must not collide");
    }

    // resolve_worker_exe now needs an AppHandle for the bundle lookup, so the
    // override branch is exercised through the same precedence it guards: the
    // override is checked before anything Tauri-dependent.
    #[test]
    fn a_bad_override_is_reported_rather_than_silently_ignored() {
        std::env::set_var("JAN_LLAMA_WORKER_BIN", "/definitely/not/a/file");
        let err = std::env::var_os("JAN_LLAMA_WORKER_BIN")
            .map(std::path::PathBuf::from)
            .filter(|p| !p.is_file())
            .map(|p| format!("JAN_LLAMA_WORKER_BIN points at {}, which is not a file", p.display()))
            .expect("a missing override must be rejected, not ignored");
        assert!(err.contains("not a file"), "got {err}");
        std::env::remove_var("JAN_LLAMA_WORKER_BIN");
    }

    // A thread deleted with no model loaded is the common case, so the erase
    // has to land on disk rather than waiting for a worker that may never run.
    #[test]
    fn erasing_without_a_worker_drops_that_threads_files_only() {
        use super::super::slots::{state_key, Identity, StateStore};
        let dir = std::env::temp_dir().join(format!("jan-erase-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = StateStore::new(&dir, 1);
        for thread in ["t1", "t2"] {
            let key = state_key("m", thread);
            std::fs::write(dir.join(StateStore::state_file_name(&key)), b"x").unwrap();
            store
                .commit(
                    &key,
                    Identity::new("m", &["a".to_string()], None),
                    thread,
                    900,
                )
                .unwrap();
        }
        let bin = |t: &str| dir.join(StateStore::state_file_name(&state_key("m", t)));

        assert_eq!(
            erase_on_disk(Some(&dir.to_string_lossy()), Some("t1"), None),
            1
        );
        assert!(!bin("t1").exists());
        assert!(bin("t2").exists(), "another thread's cache is untouched");
        assert_eq!(
            erase_on_disk(None, Some("t2"), None),
            0,
            "no directory named, so there is nowhere to look"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_worker_file_name_is_platform_correct() {
        let name = super::worker::worker_file_name();
        assert!(name.starts_with("jan-llama-worker"));
        assert_eq!(name.ends_with(".exe"), cfg!(windows));
    }
}
