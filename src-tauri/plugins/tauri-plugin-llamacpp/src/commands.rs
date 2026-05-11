use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, Runtime, State};

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

async fn post_load(port: u16, api_key: &str, model_id: &str) -> ServerResult<()> {
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

    // /models/load returns success once loading is *initiated*; poll /models
    // until the entry transitions from "loading" to "loaded" (or fails).
    wait_until_loaded(port, api_key, model_id, Duration::from_secs(600)).await
}

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

        if let Some(entry) = entry {
            let status = entry.get("status");
            let value = status
                .and_then(|s| s.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match value {
                "loaded" => return Ok(()),
                "loading" => {}
                "unloaded" | "sleeping" => {
                    let failed = status
                        .and_then(|s| s.get("failed"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if failed {
                        let exit_code = status
                            .and_then(|s| s.get("exit_code"))
                            .and_then(|v| v.as_i64());
                        return Err(ServerError::Llamacpp(LlamacppError::new(
                            ErrorCode::InternalError,
                            format!("Model {} failed to load", model_id),
                            Some(format!("exit_code={:?}", exit_code)),
                        )));
                    }
                }
                other => {
                    log::warn!("Unknown model status value: {}", other);
                }
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
        .map_err(|e| ServerError::InvalidArgument(e))?;
    post_load(port, &api_key, &model_id).await?;
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
        .map_err(|e| ServerError::InvalidArgument(e))?;
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
    post_load(port, &api_key, &model_id)
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

    let handle = crate::router::start_router(
        std::path::PathBuf::from(backend_exe),
        std::path::PathBuf::from(preset_path),
        port,
        api_key,
        models_max,
        default_args,
        envs,
    )
    .await
    .map_err(|e| e.to_string())?;

    let info = RouterInfo {
        port: handle.port,
        api_key: handle.api_key.clone(),
        pid: handle.pid,
    };
    *guard = Some(handle);
    Ok(info)
}

#[tauri::command]
pub async fn stop_router<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<(), String> {
    let state: State<Arc<LlamacppState>> = app_handle.state();
    let mut guard = state.router.lock().await;
    if let Some(handle) = guard.take() {
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
