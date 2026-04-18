use futures_util::StreamExt;
use std::time::Duration;
use tauri::{Emitter, Runtime};

use super::models::{OllamaModelDetail, OllamaRunningModel, PullProgress};

const OLLAMA_API_BASE: &str = "http://127.0.0.1:11434";
const PULL_PROGRESS_EVENT: &str = "ollama-pull-progress";
const CREATE_PROGRESS_EVENT: &str = "ollama-create-progress";

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {e}")
}

/// Builds a reqwest client with `no_proxy()` to prevent Windows proxy
/// configurations (e.g. stale Clash at 127.0.0.1:7890) from hanging
/// local Ollama requests.
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(err_to_string)
}

/// Builds a streaming reqwest client without a global request timeout.
/// Used for long-running operations like `/api/pull` and `/api/create`.
fn build_streaming_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(err_to_string)
}

/// Parse a buffer of bytes into newline-delimited JSON lines, emitting
/// `PullProgress` events for each valid line.
fn emit_progress_lines<R: Runtime>(
    app: &tauri::AppHandle<R>,
    buffer: &mut Vec<u8>,
    event_name: &str,
) {
    while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
        let line = buffer.drain(..=pos).collect::<Vec<u8>>();
        let line_str = String::from_utf8_lossy(&line).trim().to_string();
        if line_str.is_empty() {
            continue;
        }

        match serde_json::from_str::<serde_json::Value>(&line_str) {
            Ok(json) => {
                let progress = PullProgress {
                    status: json
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    digest: json
                        .get("digest")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    total: json.get("total").and_then(|v| v.as_u64()),
                    completed: json.get("completed").and_then(|v| v.as_u64()),
                };

                app.emit(event_name, &progress).ok();
            }
            Err(e) => {
                log::warn!("Failed to parse Ollama progress line: {}. Error: {}", line_str, e);
            }
        }
    }
}

/// Drain any remaining bytes in the buffer as a final JSON line.
fn emit_remaining_progress<R: Runtime>(
    app: &tauri::AppHandle<R>,
    buffer: &mut Vec<u8>,
    event_name: &str,
) {
    if buffer.is_empty() {
        return;
    }
    let line_str = String::from_utf8_lossy(buffer).trim().to_string();
    buffer.clear();
    if line_str.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line_str) {
        let progress = PullProgress {
            status: json
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            digest: json
                .get("digest")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            total: json.get("total").and_then(|v| v.as_u64()),
            completed: json.get("completed").and_then(|v| v.as_u64()),
        };
        app.emit(event_name, &progress).ok();
    }
}

/// Get detailed information about an installed model.
/// Calls `/api/show` for details and `/api/tags` for size/digest/modified_at.
#[tauri::command]
pub async fn ollama_show_model(model: String) -> Result<OllamaModelDetail, String> {
    let client = build_client()?;

    let show_res = client
        .post(format!("{}/api/show", OLLAMA_API_BASE))
        .json(&serde_json::json!({ "model": &model }))
        .send()
        .await
        .map_err(err_to_string)?;

    if !show_res.status().is_success() {
        return Err(format!("Ollama show failed: HTTP {}", show_res.status()));
    }

    let show_json: serde_json::Value = show_res.json().await.map_err(err_to_string)?;

    // Augment with tag-level metadata from /api/tags
    let tags_res = client
        .get(format!("{}/api/tags", OLLAMA_API_BASE))
        .send()
        .await;

    let mut size = 0u64;
    let mut digest = String::new();
    let mut modified_at = String::new();

    if let Ok(res) = tags_res {
        if res.status().is_success() {
            if let Ok(tags_json) = res.json::<serde_json::Value>().await {
                if let Some(models) = tags_json.get("models").and_then(|v| v.as_array()) {
                    for m in models {
                        if m.get("name").and_then(|v| v.as_str()) == Some(&model) {
                            size = m.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                            digest = m
                                .get("digest")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            modified_at = m
                                .get("modified_at")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            break;
                        }
                    }
                }
            }
        }
    }

    Ok(OllamaModelDetail {
        name: model,
        size,
        digest,
        modified_at,
        details: show_json.get("details").cloned().unwrap_or(serde_json::Value::Null),
        modelfile: show_json
            .get("modelfile")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        parameters: show_json
            .get("parameters")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        template: show_json
            .get("template")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

/// Pull a model from a registry.
/// Streams JSONL progress lines and emits `ollama-pull-progress` Tauri events.
#[tauri::command]
pub async fn ollama_pull_model<R: Runtime>(
    app: tauri::AppHandle<R>,
    model: String,
) -> Result<(), String> {
    log::info!("Pulling Ollama model: {}", model);

    let client = build_streaming_client()?;

    let res = client
        .post(format!("{}/api/pull", OLLAMA_API_BASE))
        .json(&serde_json::json!({ "model": &model }))
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        return Err(format!("Ollama pull failed: HTTP {}", res.status()));
    }

    let mut stream = res.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(err_to_string)?;
        buffer.extend_from_slice(&chunk);
        emit_progress_lines(&app, &mut buffer, PULL_PROGRESS_EVENT);
    }

    emit_remaining_progress(&app, &mut buffer, PULL_PROGRESS_EVENT);

    log::info!("Ollama pull stream finished for model: {}", model);
    Ok(())
}

/// Delete an installed model.
#[tauri::command]
pub async fn ollama_delete_model(model: String) -> Result<(), String> {
    log::info!("Deleting Ollama model: {}", model);

    let client = build_client()?;

    let res = client
        .delete(format!("{}/api/delete", OLLAMA_API_BASE))
        .json(&serde_json::json!({ "model": &model }))
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Ollama delete failed: HTTP {} - {}", status, body));
    }

    log::info!("Ollama model deleted: {}", model);
    Ok(())
}

/// Copy a model to a new name.
#[tauri::command]
pub async fn ollama_copy_model(source: String, destination: String) -> Result<(), String> {
    log::info!("Copying Ollama model {} -> {}", source, destination);

    let client = build_client()?;

    let res = client
        .post(format!("{}/api/copy", OLLAMA_API_BASE))
        .json(&serde_json::json!({
            "source": &source,
            "destination": &destination,
        }))
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Ollama copy failed: HTTP {} - {}", status, body));
    }

    log::info!("Ollama model copied: {} -> {}", source, destination);
    Ok(())
}

/// Create a model from a Modelfile.
/// Streams JSONL progress lines and emits `ollama-create-progress` Tauri events.
#[tauri::command]
pub async fn ollama_create_model<R: Runtime>(
    app: tauri::AppHandle<R>,
    name: String,
    modelfile: String,
) -> Result<(), String> {
    log::info!("Creating Ollama model: {}", name);

    let client = build_streaming_client()?;

    let res = client
        .post(format!("{}/api/create", OLLAMA_API_BASE))
        .json(&serde_json::json!({
            "name": &name,
            "modelfile": &modelfile,
        }))
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Ollama create failed: HTTP {} - {}", status, body));
    }

    let mut stream = res.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(err_to_string)?;
        buffer.extend_from_slice(&chunk);
        emit_progress_lines(&app, &mut buffer, CREATE_PROGRESS_EVENT);
    }

    emit_remaining_progress(&app, &mut buffer, CREATE_PROGRESS_EVENT);

    log::info!("Ollama create stream finished for model: {}", name);
    Ok(())
}

/// List models currently loaded in memory.
#[tauri::command]
pub async fn ollama_ps() -> Result<Vec<OllamaRunningModel>, String> {
    let client = build_client()?;

    let res = client
        .post(format!("{}/api/ps", OLLAMA_API_BASE))
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        return Err(format!("Ollama ps failed: HTTP {}", res.status()));
    }

    let json: serde_json::Value = res.json().await.map_err(err_to_string)?;

    let models = json
        .get("models")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    Some(OllamaRunningModel {
                        name: m.get("name")?.as_str()?.to_string(),
                        model: m.get("model")?.as_str()?.to_string(),
                        size: m.get("size")?.as_u64()?,
                        size_vram: m.get("size_vram")?.as_u64()?,
                        digest: m.get("digest")?.as_str()?.to_string(),
                        details: m.get("details").cloned().unwrap_or(serde_json::Value::Null),
                        expires_at: m.get("expires_at")?.as_str()?.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(models)
}

/// Stop the Ollama service.
/// On Windows, uses `taskkill /IM ollama.exe /F`.
/// On other platforms, falls back to `pkill -f ollama`.
#[tauri::command]
pub async fn stop_ollama() -> Result<(), String> {
    log::info!("Stopping Ollama service");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = tokio::process::Command::new("taskkill")
            .args(["/IM", "ollama.exe", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await
            .map_err(|e| format!("Failed to execute taskkill: {e}"))?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            // Ollama may not be running — treat "not found" as success
            let stderr_lower = stderr.to_lowercase();
            if stderr_lower.contains("not found")
                || stderr_lower.contains("找不到")
                || stderr_lower.contains("no running instances")
                || stderr_lower.contains("没有运行")
            {
                log::info!("Ollama process was not running");
                return Ok(());
            }
            return Err(format!("taskkill failed: {}", stderr));
        }

        log::info!("Ollama stopped successfully via taskkill");
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = tokio::process::Command::new("pkill")
            .args(["-f", "ollama"])
            .output()
            .await
            .map_err(|e| format!("Failed to execute pkill: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("pkill ollama returned error (process may not be running): {}", stderr);
        } else {
            log::info!("Ollama stopped successfully via pkill");
        }
    }

    Ok(())
}
