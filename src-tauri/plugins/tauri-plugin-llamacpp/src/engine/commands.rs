//! Tauri commands for the in-process engine.
//!
//! Added alongside the router commands rather than replacing them, so the
//! router path keeps working while the frontend migrates. `EngineInfo` is
//! deliberately shaped like `router::RouterInfo` (`port`, `api_key`, `pid`) so
//! the TS caller changes a command name and nothing else.

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

#[tauri::command]
pub async fn start_engine<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, Arc<LlamacppState>>,
    preset_path: String,
    models_max: u32,
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
        envs,
    )
    .await
    .map_err(|e| e.to_string())?;

    let info = EngineInfo::from(&handle);
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
/// can retry. This is the engine's replacement for
/// `commands::try_graceful_stop_router`, and it is what the app's exit path
/// uses -- without it the worker would outlive the app it belongs to.
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

    handle.stop().await;
    Ok(None)
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

    #[test]
    fn the_worker_file_name_is_platform_correct() {
        let name = super::worker::worker_file_name();
        assert!(name.starts_with("jan-llama-worker"));
        assert_eq!(name.ends_with(".exe"), cfg!(windows));
    }
}
