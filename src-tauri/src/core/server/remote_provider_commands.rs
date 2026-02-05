use std::collections::HashMap;
use std::pin::Pin;
use std::task::{Context, Poll};

use futures_util::{Stream, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio_util::bytes::Bytes;
use uuid::Uuid;

use crate::core::state::{AppState, ProviderConfig};

/// Custom header for provider requests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

/// Request to register/update a remote provider config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterProviderRequest {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

/// Request for remote chat completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteChatCompletionRequest {
    pub provider: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: Option<bool>,
    pub extra: Option<HashMap<String, serde_json::Value>>,
}

/// Chat message structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub name: Option<String>,
}

/// Response for remote chat completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub provider: String,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub index: i32,
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
    pub delta: Option<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: i32,
    pub completion_tokens: i32,
    pub total_tokens: i32,
}

/// Convert ChatCompletion messages to Anthropic Messages API format
pub fn convert_messages_to_anthropic(
    messages: &[ChatMessage],
) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|msg| {
            let role = match msg.role.as_str() {
                "user" => "user",
                "assistant" => "assistant",
                "system" => "system",
                "tool" => "user", // Anthropic uses user for tool results
                _ => "user",
            };
            serde_json::json!({
                "role": role,
                "content": msg.content
            })
        })
        .collect()
}

/// Convert OpenAI chat completions chunk to Anthropic messages format
/// OpenAI: {"id":"...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{"role":"assistant","content":"..."},"finish_reason":null}]}
/// Anthropic: {"type":"content_block_delta","delta":{"text_type":"text_streaming","text":"..."}}
fn convert_chunk_to_anthropic(
    chunk: &serde_json::Value,
    request_id: &str,
    model: &str,
) -> Option<serde_json::Value> {
    let choices = chunk.get("choices")?;
    let first_choice = choices.get(0)?;
    let delta = first_choice.get("delta")?;
    let content = delta.get("content")?;
    let content_str = content.as_str()?;

    // Check for content
    if content_str.is_empty() {
        return None;
    }

    // Convert to Anthropic format
    Some(serde_json::json!({
        "id": request_id,
        "type": "content_block_delta",
        "delta": {
            "text_type": "text_streaming",
            "text": content_str
        },
        "model": model
    }))
}

/// Convert OpenAI completion chunk to Anthropic messages format (streaming)
pub fn convert_stream_chunk(
    chunk: &serde_json::Value,
    request_id: &str,
    model: &str,
) -> Option<String> {
    // Handle OpenAI-style chunk
    if let Some(converted) = convert_chunk_to_anthropic(chunk, request_id, model) {
        return Some(format!("data: {}\n\n", converted.to_string()));
    }

    // Check for [DONE]
    let choices = chunk.get("choices")?;
    if choices.as_array()?.is_empty() {
        return None;
    }
    let first_choice = choices.get(0)?;
    if first_choice.get("finish_reason").is_some() {
        // Stream done
        let done = serde_json::json!({
            "id": request_id,
            "type": "message_delta",
            "delta": {
                "stop_reason": "end_turn",
                "stop_sequence": null
            },
            "model": model
        });
        return Some(format!("data: {}\n\n", done.to_string()));
    }

    None
}

/// Register a remote provider configuration
#[tauri::command]
pub async fn register_provider_config(
    state: State<'_, AppState>,
    request: RegisterProviderRequest,
) -> Result<(), String> {
    let provider_configs = state.provider_configs.clone();
    let mut configs = provider_configs.lock().await;

    let config = ProviderConfig {
        provider: request.provider.clone(),
        api_key: request.api_key,
        base_url: request.base_url,
        custom_headers: request.custom_headers.into_iter().map(|h| crate::core::state::ProviderCustomHeader {
            header: h.header,
            value: h.value,
        }).collect(),
        models: request.models, // Models will be added when they are configured
    };

    let provider_name = request.provider.clone();
    configs.insert(provider_name.clone(), config);
    log::info!("Registered provider config: {provider_name}");
    Ok(())
}

/// Unregister a provider configuration
#[tauri::command]
pub async fn unregister_provider_config(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let provider_configs = state.provider_configs.clone();
    let mut configs = provider_configs.lock().await;

    if configs.remove(&provider).is_some() {
        log::info!("Unregistered provider config: {provider}");
        Ok(())
    } else {
        log::warn!("Provider config not found: {provider}");
        Ok(())
    }
}

/// Get provider configuration by name
#[tauri::command]
pub async fn get_provider_config(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Option<ProviderConfig>, String> {
    let provider_configs = state.provider_configs.clone();
    let configs = provider_configs.lock().await;

    Ok(configs.get(&provider).cloned())
}

/// List all registered provider configurations (without sensitive keys)
#[tauri::command]
pub async fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfig>, String> {
    let provider_configs = state.provider_configs.clone();
    let configs = provider_configs.lock().await;

    Ok(configs.values().cloned().collect())
}

/// Remote chat completion (non-streaming)
#[tauri::command]
pub async fn remote_chat_completion(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RemoteChatCompletionRequest,
) -> Result<RemoteChatCompletionResponse, String> {
    let provider_configs = state.provider_configs.clone();
    let configs = provider_configs.lock().await;

    let config = configs
        .get(&request.provider)
        .ok_or_else(|| format!("Provider '{}' not registered", request.provider))?;

    let base_url = config
        .base_url
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no base_url", request.provider))?;

    let api_key = config
        .api_key
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no api_key", request.provider))?;

    // Build request body for OpenAI-compatible API
    let request_body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": false
    });

    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut req_builder = client.post(&url).json(&request_body).bearer_auth(&api_key);

    // Add custom headers
    for header in &config.custom_headers {
        req_builder = req_builder.header(&header.header, &header.value);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Failed to call provider API: {e}"))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Provider API error: {error_text}"));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    // Convert to our response format
    let id = response_json["id"].as_str().unwrap_or_default().to_string();
    let model = response_json["model"].as_str().unwrap_or(&request.model).to_string();
    let created = response_json["created"].as_i64().unwrap_or(chrono::Utc::now().timestamp());

    let choices: Vec<Choice> = response_json["choices"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|choice| {
            let msg = &choice["message"];
            Choice {
                index: choice["index"].as_i64().unwrap_or(0) as i32,
                message: ChatMessage {
                    role: msg["role"].as_str().unwrap_or("assistant").to_string(),
                    content: msg["content"].as_str().unwrap_or("").to_string(),
                    name: msg["name"].as_str().map(|s| s.to_string()),
                },
                finish_reason: choice["finish_reason"].as_str().map(|s| s.to_string()),
                delta: None,
            }
        })
        .collect();

    let usage = if let Some(usage) = response_json["usage"].as_object() {
        Some(Usage {
            prompt_tokens: usage.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            completion_tokens: usage.get("completion_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            total_tokens: usage.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        })
    } else {
        None
    };

    Ok(RemoteChatCompletionResponse {
        id,
        object: "chat.completion".to_string(),
        created,
        model,
        provider: request.provider.clone(),
        choices,
        usage,
    })
}

/// Event payload for remote stream chunks
#[derive(Clone, Debug, Serialize)]
pub struct RemoteStreamChunk {
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
}

/// Remote chat completion streaming
/// Returns a request ID that the frontend uses to listen for events
#[tauri::command]
pub async fn remote_chat_completion_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RemoteChatCompletionRequest,
) -> Result<String, String> {
    let request_id = Uuid::new_v4().to_string();

    // Spawn the streaming task
    let app_handle = app.clone();
    let provider_configs = state.provider_configs.clone();
    let request_id_clone = request_id.clone();
    let error_request_id = request_id.clone();

    tauri::async_runtime::spawn(async move {
        let result = stream_remote_chat(&app_handle, &provider_configs, &request, &request_id_clone).await;

        if let Err(e) = result {
            log::error!("Remote stream error for {request_id_clone}: {e}");
            // Emit error event
            let _ = app_handle.emit("remote-stream-error", serde_json::json!({
                "requestId": error_request_id,
                "error": e,
            }));
        }
    });

    Ok(request_id)
}

async fn stream_remote_chat(
    app: &AppHandle,
    provider_configs: &Mutex<HashMap<String, ProviderConfig>>,
    request: &RemoteChatCompletionRequest,
    request_id: &str,
) -> Result<(), String> {
    let configs = provider_configs.lock().await;
    let config = configs
        .get(&request.provider)
        .ok_or_else(|| format!("Provider '{}' not registered", request.provider))?;

    let base_url = config
        .base_url
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no base_url", request.provider))?;

    let api_key = config
        .api_key
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no api_key", request.provider))?;

    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let request_body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true
    });

    let mut req_builder = client.post(&url).json(&request_body).bearer_auth(&api_key);

    for header in &config.custom_headers {
        req_builder = req_builder.header(&header.header, &header.value);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Failed to call provider API: {e}"))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Provider API error: {error_text}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream read error: {e}"))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete lines (SSE format: data: {...}\n\n)
        loop {
            if let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                // Handle SSE format
                if line.starts_with("data:") {
                    let data = line.trim_start_matches("data:").trim();
                    if data == "[DONE]" {
                        // Emit final event
                        let _ = app.emit("remote-stream-chunk", RemoteStreamChunk {
                            request_id: request_id.to_string(),
                            chunk: data.to_string(),
                            done: true,
                        });
                        return Ok(());
                    }

                    // Parse and emit the chunk
                    let _ = app.emit("remote-stream-chunk", RemoteStreamChunk {
                        request_id: request_id.to_string(),
                        chunk: data.to_string(),
                        done: false,
                    });
                }
            } else {
                break;
            }
        }
    }

    // Emit final event if we got here without [DONE]
    let _ = app.emit("remote-stream-chunk", RemoteStreamChunk {
        request_id: request_id.to_string(),
        chunk: "".to_string(),
        done: true,
    });

    Ok(())
}

/// Abort a remote streaming request
#[tauri::command]
pub async fn abort_remote_stream(
    _state: State<'_, AppState>,
    _request_id: String,
) -> Result<(), String> {
    // This is a placeholder - in a more complete implementation,
    // we'd track active streams and abort them
    Ok(())
}

/// Stream remote chat completion for a specific provider config
/// Returns a boxed stream of chunk bytes suitable for Hyper response bodies
/// endpoint: the API endpoint path (e.g., "/chat/completions", "/messages")
pub async fn stream_remote_chat_for_proxy(
    provider_config: &ProviderConfig,
    request: &RemoteChatCompletionRequest,
    endpoint: &str,
) -> Result<Pin<Box<dyn futures_util::Stream<Item = Result<hyper::body::Bytes, std::io::Error>> + Send>>, String> {
    let base_url = provider_config
        .base_url
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no base_url", request.provider))?;

    let api_key = provider_config
        .api_key
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no api_key", request.provider))?;

    let client = reqwest::Client::new();
    let url = format!("{}{}", base_url.trim_end_matches('/'), endpoint);

    // Prepare request body based on endpoint type
    let request_body = if endpoint == "/messages" || endpoint.starts_with("/messages/") {
        // Anthropic Messages API format
        serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "stream": true
        })
    } else {
        // Standard OpenAI format
        serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "stream": true
        })
    };

    let mut req_builder = client.post(&url).json(&request_body).bearer_auth(&api_key);

    for header in &provider_config.custom_headers {
        req_builder = req_builder.header(&header.header, &header.value);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Failed to call provider API: {e}"))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Provider API error: {error_text}"));
    }

    // Convert reqwest stream to a stream that yields Result<Bytes, io::Error>
    let stream = response
        .bytes_stream()
        .map(|result| result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))
        .boxed();

    Ok(stream)
}

/// Stream remote chat completion and convert output format
/// This is used when a client requests /messages but remote provider uses /chat/completions
pub async fn stream_remote_chat_with_format_conversion(
    provider_config: &ProviderConfig,
    request: &RemoteChatCompletionRequest,
    target_endpoint: &str,
    output_format: &str,
) -> Result<Pin<Box<dyn futures_util::Stream<Item = Result<hyper::body::Bytes, std::io::Error>> + Send>>, String> {
    let base_url = provider_config
        .base_url
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no base_url", request.provider))?;

    let api_key = provider_config
        .api_key
        .clone()
        .ok_or_else(|| format!("Provider '{}' has no api_key", request.provider))?;

    let client = reqwest::Client::new();
    let url = format!("{}{}", base_url.trim_end_matches('/'), target_endpoint);

    let request_body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true
    });

    let mut req_builder = client.post(&url).json(&request_body).bearer_auth(&api_key);

    for header in &provider_config.custom_headers {
        req_builder = req_builder.header(&header.header, &header.value);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Failed to call provider API: {e}"))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Provider API error: {error_text}"));
    }

    let request_id = Uuid::new_v4().to_string();
    let model = request.model.clone();
    let output_format = output_format.to_string();

    // Convert stream with format conversion
    let converted_stream = response
        .bytes_stream()
        .map(move |result| {
            result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        })
        .map(move |result| {
            // Convert bytes to string, parse JSON, convert format
            match result {
                Ok(bytes) => {
                    let chunk_str = String::from_utf8_lossy(&bytes);
                    // Parse each line (SSE format)
                    let mut output = String::new();
                    for line in chunk_str.lines() {
                        if line.starts_with("data:") {
                            let data = line.trim_start_matches("data:").trim();
                            if data == "[DONE]" {
                                if output_format == "anthropic" {
                                    let done = serde_json::json!({
                                        "id": request_id,
                                        "type": "message_delta",
                                        "delta": { "stop_reason": "end_turn" },
                                        "model": model
                                    });
                                    output.push_str(&format!("data: {}\n\n", done.to_string()));
                                }
                            } else {
                                match serde_json::from_str::<serde_json::Value>(data) {
                                    Ok(json) => {
                                        if output_format == "anthropic" {
                                            if let Some(converted) = convert_stream_chunk(&json, &request_id, &model) {
                                                output.push_str(&converted);
                                            }
                                        } else {
                                            output.push_str(line);
                                            output.push_str("\n");
                                        }
                                    }
                                    Err(_) => {
                                        output.push_str(line);
                                        output.push_str("\n");
                                    }
                                }
                            }
                        }
                    }
                    Ok(hyper::body::Bytes::from(output))
                }
                Err(e) => Err(e),
            }
        })
        .boxed();

    Ok(converted_stream)
}
