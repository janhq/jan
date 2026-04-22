use futures_util::StreamExt;
use std::time::Duration;
use tauri::{Emitter, Runtime};

use super::models::{
    OllamaModelDetail, OllamaRunModelKeepAliveRequest, OllamaRunModelRequest,
    OllamaRunModelThinkRequest, OllamaRunningModel, PullProgress,
};

const OLLAMA_API_BASE: &str = "http://127.0.0.1:11434";
const PULL_PROGRESS_EVENT: &str = "ollama-pull-progress";
const CREATE_PROGRESS_EVENT: &str = "ollama-create-progress";

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowsStopTarget {
    image_name: &'static str,
    kill_tree: bool,
}

#[cfg(target_os = "windows")]
fn windows_stop_targets() -> [WindowsStopTarget; 2] {
    [
        WindowsStopTarget {
            image_name: "ollama app.exe",
            kill_tree: true,
        },
        WindowsStopTarget {
            image_name: "ollama.exe",
            kill_tree: false,
        },
    ]
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {e}")
}

#[cfg(target_os = "windows")]
fn is_taskkill_not_running(message: &str) -> bool {
    let message = message.to_lowercase();
    message.contains("not found")
        || message.contains("鎵句笉鍒?")
        || message.contains("no running instances")
        || message.contains("娌℃湁杩愯")
}

fn build_ollama_run_payload(
    request: OllamaRunModelRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let OllamaRunModelRequest {
        model,
        keep_alive,
        suffix,
        system,
        template,
        context,
        raw,
        format,
        think,
        truncate,
        shift,
        logprobs,
        top_logprobs,
        _debug_render_only,
        options,
    } = request;

    let mut payload = serde_json::Map::new();
    payload.insert(
        "model".to_string(),
        serde_json::Value::String(model.clone()),
    );
    payload.insert(
        "prompt".to_string(),
        serde_json::Value::String(String::new()),
    );
    payload.insert("stream".to_string(), serde_json::Value::Bool(false));

    match keep_alive {
        None => {
            payload.insert("keep_alive".to_string(), serde_json::json!(-1));
        }
        Some(keep_alive) => match keep_alive {
            OllamaRunModelKeepAliveRequest::Number(value) => {
                payload.insert("keep_alive".to_string(), serde_json::json!(value));
            }
            OllamaRunModelKeepAliveRequest::Text(value) => {
                if !value.is_empty() {
                    payload.insert("keep_alive".to_string(), serde_json::Value::String(value));
                }
            }
        },
    }
    if let Some(suffix) = suffix {
        if !suffix.is_empty() {
            payload.insert("suffix".to_string(), serde_json::Value::String(suffix));
        }
    }
    if let Some(system) = system {
        if !system.is_empty() {
            payload.insert("system".to_string(), serde_json::Value::String(system));
        }
    }
    if let Some(template) = template {
        if !template.is_empty() {
            payload.insert("template".to_string(), serde_json::Value::String(template));
        }
    }
    let context_present = context.is_some();
    let context_len = context.as_ref().map_or(0, Vec::len);
    if let Some(context) = context {
        if !context.is_empty() {
            payload.insert("context".to_string(), serde_json::json!(context));
        }
    }
    if let Some(raw) = raw {
        payload.insert("raw".to_string(), serde_json::Value::Bool(raw));
    }
    if let Some(format) = format {
        if !format.is_null() {
            let should_insert = match &format {
                serde_json::Value::String(v) => !v.is_empty(),
                _ => true,
            };
            if should_insert {
                payload.insert("format".to_string(), format);
            }
        }
    }
    if let Some(think) = think {
        match think {
            OllamaRunModelThinkRequest::Boolean(value) => {
                payload.insert("think".to_string(), serde_json::Value::Bool(value));
            }
            OllamaRunModelThinkRequest::Level(value) => {
                if !value.is_empty() {
                    payload.insert("think".to_string(), serde_json::Value::String(value));
                }
            }
        }
    }
    if let Some(truncate) = truncate {
        payload.insert("truncate".to_string(), serde_json::Value::Bool(truncate));
    }
    if let Some(shift) = shift {
        payload.insert("shift".to_string(), serde_json::Value::Bool(shift));
    }
    if let Some(logprobs) = logprobs {
        payload.insert("logprobs".to_string(), serde_json::Value::Bool(logprobs));
    }
    if let Some(top_logprobs) = top_logprobs {
        payload.insert("top_logprobs".to_string(), serde_json::json!(top_logprobs));
    }
    if let Some(debug_render_only) = _debug_render_only {
        payload.insert(
            "_debug_render_only".to_string(),
            serde_json::Value::Bool(debug_render_only),
        );
    }
    if let Some(options) = options {
        match serde_json::to_value(options) {
            Ok(serde_json::Value::Object(options_map)) => {
                if !options_map.is_empty() {
                    payload.insert(
                        "options".to_string(),
                        serde_json::Value::Object(options_map),
                    );
                }
            }
            Ok(other) => {
                log::warn!(
                    "Failed to serialize Ollama run options as object (model={}, context_present={}, context_len={}): {}",
                    model, context_present, context_len, other
                );
            }
            Err(err) => {
                log::warn!(
                    "Failed to serialize Ollama run options (model={}, context_present={}, context_len={}): {}",
                    model, context_present, context_len, err
                );
            }
        }
    }

    payload
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

async fn wait_for_ollama_shutdown() -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(err_to_string)?;

    for _ in 0..10 {
        match client
            .get(format!("{}/api/version", OLLAMA_API_BASE))
            .send()
            .await
        {
            Ok(_) => tokio::time::sleep(Duration::from_millis(300)).await,
            Err(_) => return Ok(()),
        }
    }

    Err("Timed out waiting for Ollama to stop".to_string())
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
                log::warn!(
                    "Failed to parse Ollama progress line: {}. Error: {}",
                    line_str,
                    e
                );
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
        details: show_json
            .get("details")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
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

/// Pre-load a model into VRAM by sending an empty generate request
/// with keep_alive=-1 (indefinite).
#[tauri::command]
pub async fn ollama_run_model(request: OllamaRunModelRequest) -> Result<(), String> {
    log::info!(
        "Running Ollama generate request for model: {}",
        request.model
    );

    let client = build_streaming_client()?;
    let payload = build_ollama_run_payload(request);

    let res = client
        .post(format!("{}/api/generate", OLLAMA_API_BASE))
        .json(&payload)
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        let status = res.status();
        let body_bytes = res.bytes().await.unwrap_or_default();
        return Err(if body_bytes.is_empty() {
            format!("Ollama run failed: HTTP {}", status)
        } else {
            String::from_utf8_lossy(&body_bytes).to_string()
        });
    }

    // Consume the stream so the connection closes cleanly
    let _ = res.text().await;

    log::info!("Ollama run request completed");
    Ok(())
}

/// Unload a model from memory by sending an empty generate request
/// with keep_alive=0 (immediate unload).
#[tauri::command]
pub async fn ollama_unload_model(model: String) -> Result<(), String> {
    log::info!("Unloading Ollama model from memory: {}", model);

    let client = build_client()?;

    let res = client
        .post(format!("{}/api/generate", OLLAMA_API_BASE))
        .json(&serde_json::json!({
            "model": &model,
            "prompt": "",
            "keep_alive": 0,
        }))
        .send()
        .await
        .map_err(err_to_string)?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Ollama unload failed: HTTP {} - {}", status, body));
    }

    let _ = res.text().await;

    log::info!("Ollama model unloaded: {}", model);
    Ok(())
}

/// Stop the Ollama service.
/// On Windows, stops the tray app tree first and then any remaining `ollama.exe`.
/// On other platforms, falls back to `pkill -f ollama`.
#[tauri::command]
pub async fn stop_ollama() -> Result<(), String> {
    log::info!("Stopping Ollama service");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut stopped_any = false;

        for target in windows_stop_targets() {
            let mut command = tokio::process::Command::new("taskkill");
            command.args(["/IM", target.image_name, "/F"]);
            if target.kill_tree {
                command.arg("/T");
            }

            let output = command
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await
                .map_err(|e| {
                    format!("Failed to execute taskkill for {}: {e}", target.image_name)
                })?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if output.status.success() {
                stopped_any = true;
                log::info!("Stopped Ollama target via taskkill: {}", target.image_name);
                continue;
            }

            if is_taskkill_not_running(&stdout) || is_taskkill_not_running(&stderr) {
                log::info!("Ollama target was not running: {}", target.image_name);
                continue;
            }

            log::error!(
                "taskkill failed for {}. stdout: {} stderr: {}",
                target.image_name,
                stdout,
                stderr
            );
            return Err(format!(
                "taskkill failed for {}: {}{}",
                target.image_name, stdout, stderr
            ));
        }

        if stopped_any {
            log::info!("Ollama stopped successfully via taskkill");
        } else {
            log::info!("Ollama was not running");
        }
        wait_for_ollama_shutdown().await?;
        return Ok(());
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
            log::warn!(
                "pkill ollama returned error (process may not be running): {}",
                stderr
            );
        } else {
            log::info!("Ollama stopped successfully via pkill");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::build_ollama_run_payload;
    #[cfg(target_os = "windows")]
    use super::is_taskkill_not_running;
    #[cfg(target_os = "windows")]
    use super::windows_stop_targets;
    use crate::core::ollama_control_plane::models::{
        OllamaRunModelKeepAliveRequest, OllamaRunModelOptionsRequest, OllamaRunModelRequest,
        OllamaRunModelThinkRequest,
    };

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_stop_targets_cover_app_and_serve_processes() {
        let targets = windows_stop_targets();

        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].image_name, "ollama app.exe");
        assert!(targets[0].kill_tree);
        assert_eq!(targets[1].image_name, "ollama.exe");
        assert!(!targets[1].kill_tree);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn taskkill_not_running_detection_matches_common_messages() {
        assert!(is_taskkill_not_running(
            "ERROR: The process \"ollama.exe\" not found."
        ));
        assert!(is_taskkill_not_running("INFO: no running instances"));
    }

    #[test]
    fn ollama_run_payload_keeps_top_level_and_options_separate() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: Some(OllamaRunModelKeepAliveRequest::Number(-1)),
            suffix: Some("suffix".to_string()),
            system: Some("system".to_string()),
            template: Some("template".to_string()),
            context: Some(vec![1, 2, 3]),
            raw: Some(true),
            format: Some(serde_json::json!("json")),
            think: Some(OllamaRunModelThinkRequest::Boolean(true)),
            truncate: Some(true),
            shift: Some(false),
            logprobs: Some(true),
            top_logprobs: Some(5),
            _debug_render_only: Some(true),
            options: Some(OllamaRunModelOptionsRequest {
                num_ctx: Some(8192),
                num_batch: Some(512),
                num_gpu: Some(1),
                main_gpu: Some(0),
                use_mmap: Some(true),
                num_thread: Some(8),
                num_keep: Some(16),
                seed: Some(42),
                num_predict: Some(256),
                top_k: Some(40),
                top_p: Some(0.9),
                min_p: Some(0.05),
                typical_p: Some(0.9),
                repeat_last_n: Some(64),
                temperature: Some(0.7),
                repeat_penalty: Some(1.1),
                presence_penalty: Some(0.3),
                frequency_penalty: Some(0.2),
                stop: Some(vec!["</s>".to_string()]),
            }),
        };

        let payload = build_ollama_run_payload(request);

        assert_eq!(payload.get("model"), Some(&serde_json::json!("qwen3:8b")));
        assert_eq!(payload.get("keep_alive"), Some(&serde_json::json!(-1)));
        assert_eq!(payload.get("suffix"), Some(&serde_json::json!("suffix")));
        assert_eq!(payload.get("system"), Some(&serde_json::json!("system")));
        assert_eq!(
            payload.get("template"),
            Some(&serde_json::json!("template"))
        );
        assert_eq!(payload.get("context"), Some(&serde_json::json!([1, 2, 3])));
        assert_eq!(payload.get("format"), Some(&serde_json::json!("json")));
        assert_eq!(payload.get("raw"), Some(&serde_json::json!(true)));
        assert_eq!(payload.get("logprobs"), Some(&serde_json::json!(true)));
        assert_eq!(payload.get("top_logprobs"), Some(&serde_json::json!(5)));
        assert_eq!(
            payload.get("_debug_render_only"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(payload.get("truncate"), Some(&serde_json::json!(true)));
        assert_eq!(payload.get("shift"), Some(&serde_json::json!(false)));
        assert_eq!(payload.get("prompt"), Some(&serde_json::json!("")));
        assert_eq!(payload.get("stream"), Some(&serde_json::json!(false)));

        assert_eq!(payload.get("num_ctx"), None);
        assert_eq!(payload.get("temperature"), None);

        let options = payload.get("options").unwrap();
        assert_eq!(options.get("suffix"), None);
        assert_eq!(options.get("system"), None);
        assert_eq!(options.get("template"), None);
        assert_eq!(options.get("context"), None);
        assert_eq!(options.get("format"), None);
        assert_eq!(options.get("logprobs"), None);
        assert_eq!(options.get("top_logprobs"), None);
        assert_eq!(options.get("truncate"), None);
        assert_eq!(options.get("shift"), None);
        assert_eq!(options.get("num_ctx"), Some(&serde_json::json!(8192)));
        assert_eq!(options.get("temperature"), Some(&serde_json::json!(0.7)));
        assert_eq!(options.get("stop"), Some(&serde_json::json!(["</s>"])));
    }

    #[test]
    fn ollama_run_payload_omits_empty_and_unset_fields() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: None,
            suffix: Some(String::new()),
            system: Some("".to_string()),
            template: None,
            context: Some(vec![]),
            raw: None,
            format: None,
            think: None,
            truncate: None,
            shift: None,
            logprobs: None,
            top_logprobs: None,
            _debug_render_only: None,
            options: Some(OllamaRunModelOptionsRequest {
                num_ctx: None,
                num_batch: None,
                num_gpu: None,
                main_gpu: None,
                use_mmap: None,
                num_thread: None,
                num_keep: None,
                seed: None,
                num_predict: None,
                top_k: None,
                top_p: None,
                min_p: None,
                typical_p: None,
                repeat_last_n: None,
                temperature: None,
                repeat_penalty: None,
                presence_penalty: None,
                frequency_penalty: None,
                stop: Some(vec![]),
            }),
        };

        let payload = build_ollama_run_payload(request);

        assert_eq!(payload.get("model"), Some(&serde_json::json!("qwen3:8b")));
        assert_eq!(payload.get("keep_alive"), Some(&serde_json::json!(-1)));
        assert_eq!(payload.get("prompt"), Some(&serde_json::json!("")));
        assert_eq!(payload.get("stream"), Some(&serde_json::json!(false)));

        assert_eq!(payload.get("suffix"), None);
        assert_eq!(payload.get("system"), None);
        assert_eq!(payload.get("context"), None);
        assert_eq!(payload.get("options"), None);
    }

    #[test]
    fn ollama_run_payload_supports_string_think() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: None,
            suffix: None,
            system: None,
            template: None,
            context: None,
            raw: None,
            format: None,
            think: Some(OllamaRunModelThinkRequest::Level("high".to_string())),
            truncate: None,
            shift: None,
            logprobs: None,
            top_logprobs: None,
            _debug_render_only: None,
            options: None,
        };

        let payload = build_ollama_run_payload(request);
        assert_eq!(payload.get("think"), Some(&serde_json::json!("high")));
    }

    #[test]
    fn ollama_run_payload_supports_non_empty_keep_alive_string() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: Some(OllamaRunModelKeepAliveRequest::Text("5m".to_string())),
            suffix: None,
            system: None,
            template: None,
            context: None,
            raw: None,
            format: None,
            think: None,
            truncate: None,
            shift: None,
            logprobs: None,
            top_logprobs: None,
            _debug_render_only: None,
            options: None,
        };

        let payload = build_ollama_run_payload(request);
        assert_eq!(payload.get("keep_alive"), Some(&serde_json::json!("5m")));
    }

    #[test]
    fn ollama_run_payload_defaults_keep_alive_to_minus_one_when_absent() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: None,
            suffix: None,
            system: None,
            template: None,
            context: None,
            raw: None,
            format: None,
            think: None,
            truncate: None,
            shift: None,
            logprobs: None,
            top_logprobs: None,
            _debug_render_only: None,
            options: None,
        };

        let payload = build_ollama_run_payload(request);
        assert_eq!(payload.get("keep_alive"), Some(&serde_json::json!(-1)));
    }

    #[test]
    fn ollama_run_payload_explicit_numeric_keep_alive_wins() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: Some(OllamaRunModelKeepAliveRequest::Number(30)),
            suffix: None,
            system: None,
            template: None,
            context: None,
            raw: None,
            format: None,
            think: None,
            truncate: None,
            shift: None,
            logprobs: None,
            top_logprobs: None,
            _debug_render_only: None,
            options: None,
        };

        let payload = build_ollama_run_payload(request);
        assert_eq!(payload.get("keep_alive"), Some(&serde_json::json!(30)));
    }

    #[test]
    fn ollama_run_payload_omits_empty_keep_alive_think_and_format_strings() {
        let request = OllamaRunModelRequest {
            model: "qwen3:8b".to_string(),
            keep_alive: Some(OllamaRunModelKeepAliveRequest::Text(String::new())),
            suffix: None,
            system: None,
            template: None,
            context: None,
            raw: None,
            format: Some(serde_json::json!("")),
            think: Some(OllamaRunModelThinkRequest::Level(String::new())),
            truncate: None,
            shift: None,
            logprobs: None,
            top_logprobs: None,
            _debug_render_only: None,
            options: None,
        };

        let payload = build_ollama_run_payload(request);
        assert_eq!(payload.get("keep_alive"), None);
        assert_eq!(payload.get("think"), None);
        assert_eq!(payload.get("format"), None);
    }

    #[test]
    fn ollama_run_request_deserializes_null_truncate_and_shift_to_none() {
        let request: OllamaRunModelRequest = serde_json::from_value(serde_json::json!({
            "model": "qwen3:8b",
            "truncate": null,
            "shift": null
        }))
        .expect("request should deserialize");

        assert_eq!(request.truncate, None);
        assert_eq!(request.shift, None);
    }
}
