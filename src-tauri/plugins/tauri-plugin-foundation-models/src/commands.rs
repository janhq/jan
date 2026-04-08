#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use serde::{Deserialize, Serialize};
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use std::sync::Arc;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use tauri::{Emitter, Manager, Runtime, State};
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
use tauri::{Manager, Runtime, State};

use crate::error::FoundationModelsError;
use crate::state::FoundationModelsState;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const MODEL_ID: &str = "apple/on-device";

// ─── OpenAI-compatible types (macOS only) ──────────────────────────────────

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Deserialize)]
struct ChatCompletionRequest {
    #[allow(dead_code)]
    model: Option<String>,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
    #[allow(dead_code)]
    top_p: Option<f64>,
    max_tokens: Option<u32>,
    #[allow(dead_code)]
    stream: Option<bool>,
    #[allow(dead_code)]
    stop: Option<Vec<String>>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Deserialize)]
struct ChatMessage {
    role: String,
    content: Option<String>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct ChatCompletionResponse {
    id: String,
    object: String,
    created: u64,
    model: String,
    choices: Vec<ChatCompletionChoice>,
    usage: UsageInfo,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct ChatCompletionChoice {
    index: u32,
    message: ChatResponseMessage,
    finish_reason: String,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct ChatResponseMessage {
    role: String,
    content: String,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct UsageInfo {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct ChatCompletionChunk {
    id: String,
    object: String,
    created: u64,
    model: String,
    choices: Vec<ChunkChoice>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct ChunkChoice {
    index: u32,
    delta: DeltaContent,
    finish_reason: Option<String>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Serialize)]
struct DeltaContent {
    role: Option<String>,
    content: Option<String>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
/// Build session instructions from the OpenAI message list.
///
/// System messages become the instruction text. Prior user/assistant turns
/// are serialised into the instructions block so the model has full
/// conversation context (matching the previous Swift server behaviour).
fn build_instructions(messages: &[ChatMessage]) -> String {
    let system_content = messages
        .iter()
        .find(|m| m.role == "system")
        .and_then(|m| m.content.as_deref())
        .unwrap_or("");

    let non_system: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();
    let history = if non_system.len() > 1 {
        &non_system[..non_system.len() - 1]
    } else {
        &[]
    };

    let mut instructions = if system_content.is_empty() {
        "You are a helpful assistant.".to_string()
    } else {
        system_content.to_string()
    };

    if !history.is_empty() {
        instructions.push_str("\n\n[Previous conversation]\n");
        for msg in history {
            let label = if msg.role == "assistant" {
                "Assistant"
            } else {
                "User"
            };
            instructions.push_str(&format!(
                "{}: {}\n",
                label,
                msg.content.as_deref().unwrap_or("")
            ));
        }
        instructions.push_str("[End of previous conversation]");
    }

    instructions
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn extract_last_user_message(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .filter(|m| m.role != "system")
        .last()
        .and_then(|m| m.content.clone())
        .unwrap_or_default()
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_foundation_models_availability<R: Runtime>(
    _app_handle: tauri::AppHandle<R>,
) -> Result<String, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let result = tokio::task::spawn_blocking(|| {
            let model = match fm_rs::SystemLanguageModel::new() {
                Ok(m) => m,
                Err(_) => return "unavailable".to_string(),
            };

            if model.is_available() {
                return "available".to_string();
            }

            match model.ensure_available() {
                Ok(()) => "available".to_string(),
                Err(e) => {
                    let msg = e.to_string().to_lowercase();
                    if msg.contains("not eligible") || msg.contains("eligible") {
                        "notEligible".to_string()
                    } else if msg.contains("not enabled") || msg.contains("intelligence") {
                        "appleIntelligenceNotEnabled".to_string()
                    } else if msg.contains("not ready") || msg.contains("ready") {
                        "modelNotReady".to_string()
                    } else {
                        "unavailable".to_string()
                    }
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(result)
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        Ok("unavailable".to_string())
    }
}

#[tauri::command]
pub async fn load_foundation_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    _model_id: String,
) -> Result<(), FoundationModelsError> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        tokio::task::spawn_blocking(|| {
            let model = fm_rs::SystemLanguageModel::new()
                .map_err(|e| FoundationModelsError::unavailable(e.to_string()))?;
            model
                .ensure_available()
                .map_err(|e| FoundationModelsError::unavailable(e.to_string()))?;
            Ok::<(), FoundationModelsError>(())
        })
        .await
        .map_err(|e| FoundationModelsError::internal_error(e.to_string()))??;

        let state: State<FoundationModelsState> = app_handle.state();
        *state.loaded.lock().await = true;
        log::info!("Foundation Models loaded successfully");
        Ok(())
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = app_handle;
        Err(FoundationModelsError::unavailable(
            "Foundation Models are only available on macOS 26+ with Apple Silicon".into(),
        ))
    }
}

#[tauri::command]
pub async fn unload_foundation_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let state: State<FoundationModelsState> = app_handle.state();
    *state.loaded.lock().await = false;
    state
        .cancel_tokens
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    log::info!("Foundation Models unloaded");
    Ok(())
}

#[tauri::command]
pub async fn is_foundation_models_loaded<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<bool, String> {
    let state: State<FoundationModelsState> = app_handle.state();
    let loaded = *state.loaded.lock().await;
    Ok(loaded)
}

#[tauri::command]
pub async fn foundation_models_chat_completion<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    body: String,
) -> Result<String, FoundationModelsError> {
    {
        let state: State<FoundationModelsState> = app_handle.state();
        if !*state.loaded.lock().await {
            return Err(FoundationModelsError::not_loaded());
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let result = tokio::task::spawn_blocking(move || {
            let request: ChatCompletionRequest = serde_json::from_str(&body)
                .map_err(|e| FoundationModelsError::invalid_request(e.to_string()))?;

            let model = fm_rs::SystemLanguageModel::new()
                .map_err(|e| FoundationModelsError::inference_error(e.to_string()))?;

            let instructions = build_instructions(&request.messages);
            let last_message = extract_last_user_message(&request.messages);

            let session = fm_rs::Session::with_instructions(&model, &instructions)
                .map_err(|e| FoundationModelsError::inference_error(e.to_string()))?;

            let mut opts = fm_rs::GenerationOptions::builder();
            if let Some(temp) = request.temperature {
                opts = opts.temperature(temp);
            }
            if let Some(max) = request.max_tokens {
                opts = opts.max_response_tokens(max);
            }
            let opts = opts.build();

            let response = session
                .respond(&last_message, &opts)
                .map_err(|e| FoundationModelsError::inference_error(e.to_string()))?;

            let completion = ChatCompletionResponse {
                id: format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                object: "chat.completion".to_string(),
                created: current_timestamp(),
                model: MODEL_ID.to_string(),
                choices: vec![ChatCompletionChoice {
                    index: 0,
                    message: ChatResponseMessage {
                        role: "assistant".to_string(),
                        content: response.content().to_string(),
                    },
                    finish_reason: "stop".to_string(),
                }],
                usage: UsageInfo {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                },
            };

            serde_json::to_string(&completion)
                .map_err(|e| FoundationModelsError::internal_error(e.to_string()))
        })
        .await
        .map_err(|e| FoundationModelsError::internal_error(e.to_string()))??;

        Ok(result)
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = &body;
        Err(FoundationModelsError::unavailable(
            "Foundation Models are only available on macOS 26+ with Apple Silicon".into(),
        ))
    }
}

#[tauri::command]
pub async fn foundation_models_chat_completion_stream<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    body: String,
    request_id: String,
) -> Result<(), FoundationModelsError> {
    {
        let state: State<FoundationModelsState> = app_handle.state();
        if !*state.loaded.lock().await {
            return Err(FoundationModelsError::not_loaded());
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let state: State<FoundationModelsState> = app_handle.state();
        let cancel_tokens = state.cancel_tokens.clone();
        let event_name = format!("foundation-models-stream-{}", request_id);
        let handle = app_handle.clone();

        tokio::task::spawn_blocking(move || -> Result<(), FoundationModelsError> {
            let request: ChatCompletionRequest = serde_json::from_str(&body)
                .map_err(|e| FoundationModelsError::invalid_request(e.to_string()))?;

            let model = fm_rs::SystemLanguageModel::new()
                .map_err(|e| FoundationModelsError::inference_error(e.to_string()))?;

            let instructions = build_instructions(&request.messages);
            let last_message = extract_last_user_message(&request.messages);

            let session = fm_rs::Session::with_instructions(&model, &instructions)
                .map_err(|e| FoundationModelsError::inference_error(e.to_string()))?;

            let mut opts = fm_rs::GenerationOptions::builder();
            if let Some(temp) = request.temperature {
                opts = opts.temperature(temp);
            }
            if let Some(max) = request.max_tokens {
                opts = opts.max_response_tokens(max);
            }
            let opts = opts.build();

            let chunk_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
            let created = current_timestamp();
            let model_id = MODEL_ID.to_string();

            // Emit role chunk
            let role_chunk = ChatCompletionChunk {
                id: chunk_id.clone(),
                object: "chat.completion.chunk".to_string(),
                created,
                model: model_id.clone(),
                choices: vec![ChunkChoice {
                    index: 0,
                    delta: DeltaContent {
                        role: Some("assistant".to_string()),
                        content: None,
                    },
                    finish_reason: None,
                }],
            };
            if let Ok(json) = serde_json::to_string(&role_chunk) {
                let _ = handle.emit(&event_name, serde_json::json!({ "data": json }));
            }

            let cancelled = Arc::new(AtomicBool::new(false));
            let cancelled_ref = cancelled.clone();
            let cancel_tokens_ref = cancel_tokens.clone();
            let request_id_ref = request_id.clone();
            let event_name_ref = event_name.clone();
            let handle_ref = handle.clone();
            let chunk_id_ref = chunk_id.clone();
            let model_id_ref = model_id.clone();

            let stream_result =
                session.stream_response(&last_message, &opts, move |chunk_text: &str| {
                    if cancelled_ref.load(Ordering::Relaxed) {
                        return;
                    }

                    if let Ok(tokens) = cancel_tokens_ref.lock() {
                        if tokens.contains(&request_id_ref) {
                            cancelled_ref.store(true, Ordering::Relaxed);
                            return;
                        }
                    }

                    let chunk = ChatCompletionChunk {
                        id: chunk_id_ref.clone(),
                        object: "chat.completion.chunk".to_string(),
                        created,
                        model: model_id_ref.clone(),
                        choices: vec![ChunkChoice {
                            index: 0,
                            delta: DeltaContent {
                                role: None,
                                content: Some(chunk_text.to_string()),
                            },
                            finish_reason: None,
                        }],
                    };
                    if let Ok(json) = serde_json::to_string(&chunk) {
                        let _ = handle_ref.emit(&event_name_ref, serde_json::json!({ "data": json }));
                    }
                });

            // Emit stop chunk
            let stop_chunk = ChatCompletionChunk {
                id: chunk_id,
                object: "chat.completion.chunk".to_string(),
                created,
                model: model_id,
                choices: vec![ChunkChoice {
                    index: 0,
                    delta: DeltaContent {
                        role: None,
                        content: None,
                    },
                    finish_reason: Some("stop".to_string()),
                }],
            };
            if let Ok(json) = serde_json::to_string(&stop_chunk) {
                let _ = handle.emit(&event_name, serde_json::json!({ "data": json }));
            }

            // Signal completion
            let _ = handle.emit(&event_name, serde_json::json!({ "done": true }));

            // Clean up cancel token
            if let Ok(mut tokens) = cancel_tokens.lock() {
                tokens.remove(&request_id);
            }

            stream_result
                .map(|_| ())
                .map_err(|e| FoundationModelsError::inference_error(e.to_string()))
        })
        .await
        .map_err(|e| FoundationModelsError::internal_error(e.to_string()))??;

        Ok(())
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = (body, request_id);
        Err(FoundationModelsError::unavailable(
            "Foundation Models are only available on macOS 26+ with Apple Silicon".into(),
        ))
    }
}

#[tauri::command]
pub async fn abort_foundation_models_stream<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request_id: String,
) -> Result<(), String> {
    let state: State<FoundationModelsState> = app_handle.state();
    if let Ok(mut tokens) = state.cancel_tokens.lock() {
        tokens.insert(request_id);
    }
    Ok(())
}
