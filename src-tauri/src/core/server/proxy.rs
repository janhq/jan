use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use jan_utils::{extract_host_from_origin, is_cors_header, is_valid_host, remove_prefix};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Listener, Runtime};
use tauri_plugin_llamacpp::LLamaBackendSession;
use tauri_plugin_llamacpp_upstream::LLamaBackendSession as LLamaUpstreamBackendSession;
use tokio::sync::Mutex;

use crate::core::state::{
    AutoIncreaseOutcome, AutoIncreaseState, ProviderConfig, ServerHandle,
};
use tokio::sync::Notify;
use uuid::Uuid;

/// Tauri event channel used to forward Local API Server request metadata to
/// the web-app analytics listener. The web-app captures it as a PostHog event
/// (`api_server_request`) with `source: 'local_api_server'`, which is the
/// counterpart to the `chat_request_sent` event emitted by the chat UI.
const ANALYTICS_CHANNEL: &str = "analytics://api_server_request";

/// Mutable state accumulated while handling a proxied request. A single
/// `ApiRequestEvent` is emitted from the `proxy_request` wrapper after the
/// inner handler finishes, so every field must be populated by the time the
/// inner handler returns (defaults are used otherwise).
#[derive(Default)]
struct EmitState {
    endpoint: Option<&'static str>,
    model_id: Option<String>,
    backend: &'static str,
    provider: Option<String>,
    stream: bool,
    is_anthropic_fallback: bool,
    error_kind: Option<&'static str>,
    skip_emit: bool,
    // ATO-112: error-breakdown fields. `upstream_status` is the model's /
    // provider's own HTTP status (distinct from the status we return to the
    // client). The three booleans flag specific failure shapes for triage.
    upstream_status: Option<u16>,
    oom_detected: bool,
    ctx_overflow_detected: bool,
    server_bind_failed: bool,
}

#[derive(serde::Serialize, Clone)]
struct ApiRequestEvent<'a> {
    source: &'static str,
    endpoint: &'static str,
    method: &'a str,
    model_id: Option<String>,
    backend: &'static str,
    provider: Option<String>,
    stream: bool,
    status: u16,
    latency_ms: u64,
    is_anthropic_fallback: bool,
    error_kind: Option<&'static str>,
    upstream_status: Option<u16>,
    oom_detected: bool,
    ctx_overflow_detected: bool,
    server_bind_failed: bool,
}

fn emit_api_request_event<R: Runtime>(app: &AppHandle<R>, event: ApiRequestEvent) {
    if let Err(e) = app.emit(ANALYTICS_CHANNEL, event) {
        log::debug!("Failed to emit api_server_request analytics event: {e}");
    }
}

/// Surface a Local API Server bind failure (e.g. the requested port is in use
/// and no free port could be obtained) as a dedicated analytics signal. This
/// never rides a real request because binding fails before the proxy serves
/// anything (ATO-112 / ATO-189).
fn emit_server_bind_failed<R: Runtime>(app: &AppHandle<R>) {
    emit_api_request_event(
        app,
        ApiRequestEvent {
            source: "local_api_server",
            endpoint: "other",
            method: "BIND",
            model_id: None,
            backend: "",
            provider: None,
            stream: false,
            status: 0,
            latency_ms: 0,
            is_anthropic_fallback: false,
            error_kind: Some("server_bind_failed"),
            upstream_status: None,
            oom_detected: false,
            ctx_overflow_detected: false,
            server_bind_failed: true,
        },
    );
}

const TTFT_TIMING_CHANNEL: &str = "ttft-timing";

#[derive(serde::Serialize, Clone)]
struct TtftTimingEvent {
    marker: &'static str,
    ms: u64,
}

fn emit_ttft_timing<R: Runtime>(app: &AppHandle<R>, marker: &'static str) {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if let Err(e) = app.emit(
        TTFT_TIMING_CHANNEL,
        TtftTimingEvent { marker, ms },
    ) {
        log::debug!("Failed to emit ttft-timing event: {e}");
    }
}

fn log_ttft_prefix_dump(json_body: &serde_json::Value) {
    if std::env::var("ATOMIC_TTFT_PREFIX_DUMP").ok().as_deref() != Some("1") {
        return;
    }
    // Zero-PII (ATO-113): never log message/tool *text* (prompts are PII).
    // Emit only sizes/counts so the diagnostic stays useful for prefix-cache
    // debugging without leaking conversation content into app.log / Sentry.
    if let Some(messages) = json_body.get("messages") {
        let bytes = serde_json::to_string(messages).map(|s| s.len()).unwrap_or(0);
        let count = messages.as_array().map(|a| a.len()).unwrap_or(0);
        log::info!("[ttft-prefix] messages: {count} item(s), {bytes}B");
    }
    if let Some(tools) = json_body.get("tools") {
        let bytes = serde_json::to_string(tools).map(|s| s.len()).unwrap_or(0);
        let count = tools.as_array().map(|a| a.len()).unwrap_or(0);
        log::info!("[ttft-prefix] tools: {count} item(s), {bytes}B");
    }
}

fn sse_chunk_has_visible_content(chunk: &[u8]) -> bool {
    let text = String::from_utf8_lossy(chunk);
    if !text.contains("\"content\"") {
        return false;
    }
    !(text.contains("\"content\":null")
        || text.contains("\"content\": null")
        || text.contains("\"content\":\"\"")
        || text.contains("\"content\": \"\""))
}

/// Normalises the already prefix-stripped destination path into a closed set
/// of endpoint labels safe for analytics (never the raw path).
fn endpoint_from_path(path: &str) -> &'static str {
    match path {
        "/chat/completions" => "chat/completions",
        "/responses" => "responses",
        "/messages" => "messages",
        "/completions" => "completions",
        "/embeddings" => "embeddings",
        "/messages/count_tokens" => "messages/count_tokens",
        "/models" => "models",
        "/metrics" => "metrics",
        _ => "other",
    }
}

/// Transform Anthropic /messages API body to OpenAI /chat/completions body
fn transform_anthropic_to_openai(body: &serde_json::Value) -> Option<serde_json::Value> {
    let model = body.get("model")?.as_str()?;
    let messages = body.get("messages")?;

    let openai_messages = convert_messages(messages, body.get("system"))?;

    let stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut result = serde_json::json!({
        "model": model,
        "messages": openai_messages,
        "stream": stream
    });

    // Transform Anthropic tools to OpenAI format
    if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
        let openai_tools: Vec<serde_json::Value> = tools
            .iter()
            .filter_map(|tool| {
                let name = tool.get("name")?.as_str()?;
                let description = tool
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("");
                let input_schema = tool
                    .get("input_schema")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));

                Some(serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": description,
                        "parameters": input_schema
                    }
                }))
            })
            .collect();

        if !openai_tools.is_empty() {
            result["tools"] = serde_json::Value::Array(openai_tools);
        }
    }

    // Pass through common parameters
    for key in &[
        // "max_tokens",
        "temperature",
        "top_p",
        "top_k",
        "frequency_penalty",
        "presence_penalty",
    ] {
        if let Some(val) = body.get(*key) {
            result[*key] = val.clone();
        }
    }
    if let Some(stop) = body.get("stop_sequences") {
        result["stop"] = stop.clone();
    }

    Some(result)
}

/// Convert Anthropic message format to OpenAI format
fn convert_messages(
    anth_messages: &serde_json::Value,
    system_prompt: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let messages_array = anth_messages.as_array()?;
    let mut openai_messages: Vec<serde_json::Value> = Vec::new();

    // Anthropic system prompt is a top-level field, convert to system message
    if let Some(system) = system_prompt {
        if let Some(text) = system.as_str() {
            openai_messages.push(serde_json::json!({
                "role": "system",
                "content": text
            }));
        } else if let Some(blocks) = system.as_array() {
            let text: String = blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                openai_messages.push(serde_json::json!({
                    "role": "system",
                    "content": text
                }));
            }
        }
    }

    for msg in messages_array {
        let role = msg.get("role")?.as_str()?;
        let content = msg.get("content")?;

        if content.is_string() {
            let openai_role = match role {
                "user" => "user",
                "assistant" => "assistant",
                "system" => "system",
                "developer" => "developer",
                _ => continue,
            };
            openai_messages.push(serde_json::json!({
                "role": openai_role,
                "content": content
            }));
            continue;
        }

        let content_array = match content.as_array() {
            Some(arr) => arr,
            None => return None,
        };

        match role {
            "assistant" => {
                // Split content into text/image parts and tool_calls
                let mut text_parts: Vec<serde_json::Value> = Vec::new();
                let mut tool_calls: Vec<serde_json::Value> = Vec::new();

                for block in content_array {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        "tool_use" => {
                            if let (Some(id), Some(name), Some(input)) = (
                                block.get("id").and_then(|v| v.as_str()),
                                block.get("name").and_then(|v| v.as_str()),
                                block.get("input"),
                            ) {
                                tool_calls.push(serde_json::json!({
                                    "id": id,
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": input.to_string()
                                    }
                                }));
                            }
                        }
                        _ => {
                            convert_media_block(block, &mut text_parts);
                        }
                    }
                }

                let mut msg_obj = serde_json::json!({ "role": "assistant" });

                if tool_calls.is_empty() {
                    // No tool calls: set content normally
                    msg_obj["content"] = text_parts_to_content(&text_parts);
                } else {
                    // Has tool calls: content can be null or text string
                    msg_obj["content"] = if text_parts.is_empty() {
                        serde_json::Value::Null
                    } else {
                        text_parts_to_content(&text_parts)
                    };
                    msg_obj["tool_calls"] = serde_json::Value::Array(tool_calls);
                }

                openai_messages.push(msg_obj);
            }
            "user" => {
                // Separate tool_result blocks from regular content
                let mut text_parts: Vec<serde_json::Value> = Vec::new();
                let mut tool_results: Vec<(String, String)> = Vec::new();

                for block in content_array {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "tool_result" => {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let result_content = extract_tool_result_content(block.get("content"));
                            tool_results.push((tool_use_id, result_content));
                        }
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        _ => {
                            convert_media_block(block, &mut text_parts);
                        }
                    }
                }

                // Tool results become role:"tool" messages (must come before user text)
                for (tool_call_id, result) in tool_results {
                    openai_messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result
                    }));
                }

                // Remaining user content
                if !text_parts.is_empty() {
                    openai_messages.push(serde_json::json!({
                        "role": "user",
                        "content": text_parts_to_content(&text_parts)
                    }));
                }
            }
            "system" | "developer" => {
                let text: String = content_array
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n");
                openai_messages.push(serde_json::json!({
                    "role": role,
                    "content": text
                }));
            }
            _ => continue,
        }
    }

    Some(serde_json::Value::Array(openai_messages))
}

/// Convert text parts to OpenAI content value (string for single text, array for mixed)
fn text_parts_to_content(parts: &[serde_json::Value]) -> serde_json::Value {
    if parts.is_empty() {
        serde_json::Value::String(String::new())
    } else if parts.len() == 1 && parts[0].get("type").and_then(|t| t.as_str()) == Some("text") {
        serde_json::Value::String(
            parts[0]
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
        )
    } else {
        serde_json::Value::Array(parts.to_vec())
    }
}

/// Convert image/media blocks to OpenAI format
fn convert_media_block(block: &serde_json::Value, parts: &mut Vec<serde_json::Value>) {
    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if block_type == "image" {
        if let Some(source) = block.get("source") {
            if let (Some(data), Some(media_type)) = (
                source.get("data").and_then(|v| v.as_str()),
                source
                    .get("media_type")
                    .or(block.get("media_type"))
                    .and_then(|v| v.as_str()),
            ) {
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{media_type};base64,{data}")
                    }
                }));
            }
        }
    } else if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
        parts.push(serde_json::json!({
            "type": "text",
            "text": text
        }));
    }
}

/// Extract text content from a tool_result content field
fn extract_tool_result_content(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(c) if c.is_string() => c.as_str().unwrap_or("").to_string(),
        Some(c) if c.is_array() => c
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|t| t.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(c) => c.to_string(),
        None => String::new(),
    }
}

/// Transform OpenAI non-streaming response to Anthropic /messages format
fn transform_openai_response_to_anthropic(response: &serde_json::Value) -> serde_json::Value {
    let choice = response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first());
    let message = choice.and_then(|c| c.get("message"));

    let mut content_blocks: Vec<serde_json::Value> = Vec::new();

    // Add text content
    if let Some(text) =
        message
            .and_then(|m| m.get("content"))
            .and_then(|c| if c.is_null() { None } else { c.as_str() })
    {
        if !text.is_empty() {
            content_blocks.push(serde_json::json!({
                "type": "text",
                "text": text
            }));
        }
    }

    // Add tool_use blocks from tool_calls
    if let Some(tool_calls) = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
    {
        for tc in tool_calls {
            let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let arguments = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("{}");
            let input: serde_json::Value =
                serde_json::from_str(arguments).unwrap_or(serde_json::json!({}));

            content_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input
            }));
        }
    }

    let finish_reason = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|fr| fr.as_str())
        .unwrap_or("end_turn");

    let stop_reason = match finish_reason {
        "stop" => "end_turn",
        "length" => "max_tokens",
        "tool_calls" => "tool_use",
        _ => finish_reason,
    };

    serde_json::json!({
        "id": response.get("id").unwrap_or(&serde_json::json!("")).clone(),
        "type": "message",
        "role": "assistant",
        "content": content_blocks,
        "model": response.get("model").unwrap_or(&serde_json::json!("")).clone(),
        "stop_reason": stop_reason,
        "stop_sequence": serde_json::Value::Null,
        "usage": response.get("usage").cloned().unwrap_or(serde_json::json!({
            "input_tokens": 0,
            "output_tokens": 0
        }))
    })
}

/// Configuration for the proxy server
#[derive(Clone)]
pub struct ProxyConfig {
    pub prefix: String,
    pub proxy_api_key: String,
    pub trusted_hosts: Vec<Vec<String>>,
    pub host: String,
    pub port: u16,
}

/// Determines the final destination path based on the original request path
pub fn get_destination_path(original_path: &str, prefix: &str) -> String {
    remove_prefix(original_path, prefix)
}

/// Compare a model id from an incoming request against a model id from an
/// active session. Dots and underscores are treated as equivalent so that
/// e.g. `Qwen3_5-9B-MLX-4bit` matches `Qwen3.5-9B-MLX-4bit` — some clients
/// (and filesystems) substitute one for the other.
pub fn model_ids_match(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).all(|(x, y)| {
        x == y || matches!((x, y), (b'.', b'_') | (b'_', b'.'))
    })
}

pub fn allowed_methods_for_path(path: &str) -> Option<&'static [&'static str]> {
    match path {
        "/" | "/openapi.json" | "/docs/swagger-ui.css" | "/docs/swagger-ui-bundle.js" => {
            Some(&["GET"])
        }
        "/models" | "/metrics" => Some(&["GET"]),
        "/messages"
        | "/chat/completions"
        | "/responses"
        | "/completions"
        | "/embeddings"
        | "/messages/count_tokens" => Some(&["POST"]),
        _ => None,
    }
}

use tauri_plugin_mlx::state::{MlxBackendSession, SessionInfo};

fn is_local_url(url: &str) -> bool {
    url.contains("://localhost") || url.contains("://127.0.0.1") || url.contains("://0.0.0.0") || url.contains("://[::1]")
}

// ── Auto-increase-ctx: shared detection, events & coordinator ────────────────
//
// The UI already increases `ctx_len` when chat replies hit the model's context
// window (see `handleContextSizeIncrease` in
// `web-app/src/routes/threads/$threadId.tsx`). External clients using the
// Local API server used to bypass that logic entirely because this proxy is
// a pure forwarder. The event channel below lets the proxy delegate the
// reload to the corresponding TypeScript extension (owner of the model
// settings in Zustand) and then retry the buffered request transparently.

/// Event emitted from Rust to extensions when a context-limit error is
/// detected. Both `llamacpp-extension` and `mlx-extension` subscribe and
/// filter by `backend`.
const AUTO_INCREASE_EVENT: &str = "local_backend://auto_increase_ctx";
/// Reply channel. The `request_id` suffix scopes the notification to a
/// single pending proxy request so parallel retries don't cross-talk.
const AUTO_INCREASE_DONE_EVENT_PREFIX: &str = "local_backend://auto_increase_ctx_done";
/// Total time we're willing to wait for extension-side unload + load.
/// Matches the worst-case behaviour we've observed for GGUF reload with
/// a 32k → 48k bump; beyond that the user is better served by a clean error.
const AUTO_INCREASE_TIMEOUT_SECS: u64 = 60;

#[derive(serde::Serialize, Clone)]
struct AutoIncreaseRequest<'a> {
    request_id: String,
    backend: &'a str,
    model_id: String,
    /// Where the detection triggered: "error" for upstream error body,
    /// "finish_length" for `finish_reason=length` in the upstream response.
    trigger: &'a str,
}

#[derive(serde::Deserialize, Clone, Debug)]
struct AutoIncreaseDoneEvent {
    ok: bool,
    #[serde(default)]
    new_ctx_len: Option<i64>,
    #[serde(default)]
    reason: Option<String>,
}

/// Returns `true` if the given upstream response almost certainly failed
/// because the conversation exceeded the current context window.
///
/// Both llama-server and mlx-server are OpenAI-compatible; their error
/// bodies vary but all reference the word "context" plus a length/size/limit
/// keyword or use `exceed`/`overflow`. We also accept the UI-facing phrase
/// from `web-app/src/utils/error.ts` verbatim to stay in lockstep with the
/// existing in-process detection.
fn is_context_limit_error(status: StatusCode, body: &str) -> bool {
    if !matches!(status.as_u16(), 400 | 413 | 500 | 503) {
        return false;
    }
    let b = body.to_lowercase();
    if b.contains("the request exceeds the available context size") {
        return true;
    }
    // mlx-vlm wraps generation errors as `{"detail":"Generation failed: ..."}`
    // (see `mlx_vlm.server` HTTPException handler). The inner mlx-lm error may
    // mention `kv cache`, `max_kv_size`, or token capacity rather than the
    // word "context", so we also classify those phrasings as overflow.
    if b.contains("max_kv_size") || b.contains("max-kv-size") || b.contains("max kv size") {
        return true;
    }
    if b.contains("kv cache") && (b.contains("exceed") || b.contains("overflow") || b.contains("too")) {
        return true;
    }
    if !b.contains("context") {
        return false;
    }
    b.contains("size")
        || b.contains("length")
        || b.contains("limit")
        || b.contains("exceed")
        || b.contains("overflow")
        || b.contains("too long")
        || b.contains("too large")
}

/// ATO-112: local on-device engines vs remote cloud providers.
fn is_local_backend(backend: &str) -> bool {
    matches!(backend, "llamacpp" | "llamacpp-upstream" | "mlx")
}

/// ATO-112: error_kind for an upstream that responded with a non-2xx status.
fn upstream_error_kind(backend: &str) -> &'static str {
    if is_local_backend(backend) {
        "local_model_error"
    } else {
        "remote_provider_error"
    }
}

/// ATO-112: error_kind for an upstream we could not reach (transport error).
fn unreachable_error_kind(backend: &str) -> &'static str {
    if is_local_backend(backend) {
        "local_model_unreachable"
    } else {
        "remote_provider_error"
    }
}

/// ATO-112: best-effort OOM detection from an upstream error body, mirroring
/// the patterns in `web-app/src/utils/switchModel.ts` and the backend
/// `error.rs` classifiers. Used only to set the `oom_detected` analytics flag.
fn body_indicates_oom(body: &str) -> bool {
    let b = body.to_lowercase();
    b.contains("out of memory")
        || b.contains("outofmemory")
        || b.contains("cuda_error_out_of_memory")
        || b.contains("failed to allocate")
        || b.contains("insufficient memory")
        || b.contains("erroroutofdevicememory")
}

/// ATO-197: Detects a *fatal* llama.cpp compute/decode failure that poisons
/// the backend. On Apple Silicon (Metal) a GPU out-of-memory during prompt
/// processing returns HTTP 500 `{"error":{"message":"Compute error"}}` and
/// leaves the ggml Metal backend in a permanent error state ("backend is in
/// error state from a previous command buffer failure - recreate the backend
/// to recover"). The OOM detail (`kIOGPUCommandBufferCallbackErrorOutOfMemory`)
/// only appears in the server's stderr, never the HTTP body, so we key off the
/// body's decode/compute-failure phrasing. Context-overflow errors are handled
/// separately and checked first, so they never reach this matcher.
fn is_compute_backend_error(status: StatusCode, body: &str) -> bool {
    if status != StatusCode::INTERNAL_SERVER_ERROR {
        return false;
    }
    let b = body.to_lowercase();
    b.contains("compute error")
        || b.contains("failed to decode")
        || b.contains("failed to compute graph")
        || b.contains("backend is in error state")
        || b.contains("ggml_backend_sched_graph_compute")
}

/// ATO-197: human-readable, actionable error envelope for a fatal compute/OOM
/// failure from a local backend. Replaces the opaque "Compute error" the
/// engine returns with guidance, and carries the OpenAI `insufficient_memory`
/// code. `oom` is `true` when the upstream body itself pinned an OOM cause; on
/// macOS Metal the bare "Compute error" is overwhelmingly an out-of-memory
/// condition, so the non-`oom` wording still leads with that as the likely
/// cause but hedges.
fn compute_error_envelope(oom: bool) -> String {
    let message = if oom {
        "The model ran out of memory while processing this request. Try a smaller or lighter model, reduce the context size, or remove attached images. On Apple Silicon, memory is shared with the system, so closing other memory-heavy apps can free up headroom."
    } else {
        "The model failed during computation — most often because it ran out of memory. Try a smaller or lighter model, reduce the context size, or remove attached images. On Apple Silicon, memory is shared with the system, so closing other memory-heavy apps can free up headroom."
    };
    structured_error_json(message, "server_error", "insufficient_memory")
}

/// ATO-182: Build an OpenAI-compatible structured error envelope so every
/// client (the in-app UI plus external agents that hit `localhost:1337/v1`)
/// receives a parseable `{"error": {...}}` document with a typed `code`,
/// instead of a raw stderr dump / plaintext line. `type` follows the OpenAI
/// error taxonomy.
fn structured_error_json(message: &str, error_type: &str, code: &str) -> String {
    serde_json::json!({
        "error": {
            "message": message,
            "type": error_type,
            "code": code,
        }
    })
    .to_string()
}

/// ATO-182: True when `body` is already a structured `{"error": {...}}`
/// envelope (llama.cpp and remote providers emit this shape), so we never
/// double-wrap it.
fn is_structured_error_body(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").map(|e| e.is_object()))
        .unwrap_or(false)
}

/// ATO-182: Pick the typed OpenAI error `code` for a local-backend failure
/// from the already-computed OOM / context-overflow signals.
fn error_code_for(oom: bool, ctx_overflow: bool) -> &'static str {
    if ctx_overflow {
        "context_length_exceeded"
    } else if oom {
        "insufficient_memory"
    } else {
        "server_error"
    }
}

/// ATO-182: Normalize a *local-backend* error body for the OpenAI chat path.
/// If the backend already returned a structured `{"error": {...}}` envelope
/// (llama.cpp), forward it unchanged. Otherwise wrap the raw body (mlx-vlm's
/// `{"detail": ...}`, plaintext stderr, "Failed to read error body", …) into a
/// structured envelope carrying a typed `code`. The original text is preserved
/// inside `message`, so the UI/Rust context-overflow + OOM matchers — which key
/// off the message text — keep working.
fn structure_backend_error_body(body: &str, oom: bool, ctx_overflow: bool) -> String {
    if is_structured_error_body(body) {
        return body.to_string();
    }
    let code = error_code_for(oom, ctx_overflow);
    let error_type = if ctx_overflow {
        "invalid_request_error"
    } else {
        "server_error"
    };
    structured_error_json(body, error_type, code)
}

/// Parses the client's buffered request body and extracts `max_tokens` (or
/// the newer `max_completion_tokens` alias that some OpenAI SDKs already
/// emit). Returns `None` when the field is absent/invalid — meaning the
/// client imposed no explicit completion cap.
fn extract_client_max_tokens(request_body: Option<&[u8]>) -> Option<u64> {
    let bytes = request_body?;
    let json: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let obj = json.as_object()?;
    for key in ["max_tokens", "max_completion_tokens"] {
        if let Some(v) = obj.get(key).and_then(|v| v.as_u64()) {
            if v > 0 {
                return Some(v);
            }
        }
    }
    None
}

/// Scans a non-streaming OpenAI JSON response for a terminal
/// `finish_reason == "length"` that is caused by the *context window* being
/// exhausted — **not** by the client's own `max_tokens` cap.
///
/// Discrimination rules (in order):
///   1. Any choice must report `finish_reason == "length"`.
///   2. If the client did **not** set `max_tokens`/`max_completion_tokens`,
///      `length` can only come from the context window → trigger.
///   3. If the client did set a cap, we only trigger when
///      `usage.completion_tokens < max_tokens`. When completion_tokens
///      equals/exceeds the cap the stop was client-driven and we must
///      leave the model alone (otherwise we would auto-grow the ctx on
///      every short `max_tokens=16` healthcheck).
fn is_context_overflow_finish_length(
    response_body: &[u8],
    request_body: Option<&[u8]>,
) -> bool {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(response_body) else {
        return false;
    };

    let has_length = json
        .get("choices")
        .and_then(|c| c.as_array())
        .map(|choices| {
            choices.iter().any(|choice| {
                choice
                    .get("finish_reason")
                    .and_then(|v| v.as_str())
                    .map(|s| s == "length")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);

    if !has_length {
        return false;
    }

    let client_cap = extract_client_max_tokens(request_body);

    match client_cap {
        None => true, // No client-imposed cap → `length` must be context-limit.
        Some(cap) => {
            let completion_tokens = json
                .get("usage")
                .and_then(|u| u.get("completion_tokens"))
                .and_then(|v| v.as_u64());
            match completion_tokens {
                Some(done) => done + 1 < cap,
                // Unknown completion_tokens: treat as client-driven to avoid
                // ratcheting ctx on every opaque `length` stop. Clients who
                // really hit ctx get HTTP 500 anyway, which we still catch.
                None => false,
            }
        }
    }
}

/// Acquire or wait on the per-model reload slot. The first caller gets
/// `is_leader=true` and must perform the event round-trip; every other
/// caller waits on the returned `Arc<Notify>` and then reads the cached
/// outcome with `take_auto_increase_outcome`.
async fn acquire_auto_increase_slot(
    state: &AutoIncreaseState,
    model_id: &str,
) -> (Arc<Notify>, bool) {
    let mut pending = state.pending.lock().await;
    if let Some(n) = pending.get(model_id) {
        return (n.clone(), false);
    }
    let notify = Arc::new(Notify::new());
    pending.insert(model_id.to_string(), notify.clone());
    // Drop the last stale outcome so waiters don't accidentally read a
    // success from a previous cycle.
    drop(pending);
    let mut outcomes = state.last_outcome.lock().await;
    outcomes.remove(model_id);
    (notify, true)
}

/// Release the per-model reload slot and wake every waiter. Safe to call
/// multiple times — the `HashMap::remove` is a no-op on the second call.
async fn release_auto_increase_slot(
    state: &AutoIncreaseState,
    model_id: &str,
    notify: &Notify,
) {
    let mut pending = state.pending.lock().await;
    pending.remove(model_id);
    drop(pending);
    notify.notify_waiters();
}

async fn store_auto_increase_outcome(
    state: &AutoIncreaseState,
    model_id: &str,
    outcome: AutoIncreaseOutcome,
) {
    let mut outcomes = state.last_outcome.lock().await;
    outcomes.insert(model_id.to_string(), outcome);
}

async fn read_auto_increase_outcome(
    state: &AutoIncreaseState,
    model_id: &str,
) -> Option<AutoIncreaseOutcome> {
    let outcomes = state.last_outcome.lock().await;
    outcomes.get(model_id).cloned()
}

/// Trigger the TypeScript-side reload for `model_id` on the `llamacpp` or
/// `mlx` backend and block until the matching `auto_increase_ctx_done` event
/// arrives (or the timeout fires). Returns the outcome so the caller can
/// decide whether to retry the upstream request.
async fn trigger_auto_increase<R: Runtime>(
    app_handle: &AppHandle<R>,
    backend: &str,
    model_id: &str,
    trigger: &str,
) -> AutoIncreaseOutcome {
    let request_id = Uuid::new_v4().to_string();
    let done_channel = format!("{AUTO_INCREASE_DONE_EVENT_PREFIX}/{request_id}");

    let (tx, rx) = tokio::sync::oneshot::channel::<AutoIncreaseDoneEvent>();
    // Listener must be registered before we emit the trigger, otherwise a
    // very fast extension handler could fire `auto_increase_ctx_done` before
    // we're ready and we'd deadlock on the timeout branch.
    //
    // `listen_any` expects a synchronous `Fn`, so we store the oneshot sender
    // in a `std::sync::Mutex<Option<_>>`. `Option::take` gives us the
    // single-use semantics; the listener closure can fire more than once if a
    // stray done-event shows up later, but only the first call will actually
    // transmit.
    let tx_slot: Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<AutoIncreaseDoneEvent>>>> =
        Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx_slot.clone();
    let unlisten = app_handle.listen_any(done_channel.clone(), move |event| {
        let payload = event.payload();
        match serde_json::from_str::<AutoIncreaseDoneEvent>(payload) {
            Ok(ev) => {
                if let Ok(mut guard) = tx_clone.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(ev);
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "auto_increase_ctx_done payload parse failed: {e}; raw={payload}"
                );
            }
        }
    });

    let request = AutoIncreaseRequest {
        request_id: request_id.clone(),
        backend,
        model_id: model_id.to_string(),
        trigger,
    };
    if let Err(e) = app_handle.emit(AUTO_INCREASE_EVENT, request) {
        log::error!("Failed to emit {AUTO_INCREASE_EVENT}: {e}");
        app_handle.unlisten(unlisten);
        return AutoIncreaseOutcome {
            ok: false,
            new_ctx_len: None,
            reason: Some(format!("emit_failed: {e}")),
        };
    }
    log::info!(
        "auto_increase_ctx: emitted trigger backend={backend} model_id={model_id} request_id={request_id} source={trigger}"
    );

    let outcome = match tokio::time::timeout(
        std::time::Duration::from_secs(AUTO_INCREASE_TIMEOUT_SECS),
        rx,
    )
    .await
    {
        Ok(Ok(ev)) => AutoIncreaseOutcome {
            ok: ev.ok,
            new_ctx_len: ev.new_ctx_len,
            reason: ev.reason,
        },
        Ok(Err(_)) => AutoIncreaseOutcome {
            ok: false,
            new_ctx_len: None,
            reason: Some("channel_closed".to_string()),
        },
        Err(_) => AutoIncreaseOutcome {
            ok: false,
            new_ctx_len: None,
            reason: Some(format!("timeout_after_{AUTO_INCREASE_TIMEOUT_SECS}s")),
        },
    };

    app_handle.unlisten(unlisten);
    outcome
}

/// Returns `true` iff the given model is currently served by an
/// `is_embedding == true` session on either backend. Embedding sessions
/// have no context-exhaustion flow (batched fixed-size inputs) so the
/// proxy must not trigger a reload for them.
async fn is_embedding_session(
    backend: &str,
    model_id: &str,
    sessions: &Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: &Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: &Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
) -> bool {
    match backend {
        "llamacpp" => {
            let guard = sessions.lock().await;
            guard
                .values()
                .find(|s| model_ids_match(&s.info.model_id, model_id))
                .map(|s| s.info.is_embedding)
                .unwrap_or(false)
        }
        "llamacpp-upstream" => {
            let guard = sessions_upstream.lock().await;
            guard
                .values()
                .find(|s| model_ids_match(&s.info.model_id, model_id))
                .map(|s| s.info.is_embedding)
                .unwrap_or(false)
        }
        "mlx" => {
            let guard = mlx_sessions.lock().await;
            guard
                .values()
                .find(|s| model_ids_match(&s.info.model_id, model_id))
                .map(|s| s.info.is_embedding)
                .unwrap_or(false)
        }
        _ => false,
    }
}

/// Look up the freshly-loaded local backend session after a successful
/// auto-increase reload and return its `(port, api_key)`. Returns `None`
/// when the session can't be found (e.g. TS reload actually failed despite
/// `ok=true`).
async fn resolve_local_session(
    backend: &str,
    model_id: &str,
    sessions: &Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: &Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: &Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
) -> Option<(i32, String)> {
    match backend {
        "llamacpp" => {
            let guard = sessions.lock().await;
            guard
                .values()
                .find(|s| model_ids_match(&s.info.model_id, model_id))
                .map(|s| (s.info.port, s.info.api_key.clone()))
        }
        "llamacpp-upstream" => {
            let guard = sessions_upstream.lock().await;
            guard
                .values()
                .find(|s| model_ids_match(&s.info.model_id, model_id))
                .map(|s| (s.info.port, s.info.api_key.clone()))
        }
        "mlx" => {
            let guard = mlx_sessions.lock().await;
            guard
                .values()
                .find(|s| model_ids_match(&s.info.model_id, model_id))
                .map(|s| (s.info.port, s.info.api_key.clone()))
        }
        _ => None,
    }
}

/// Rebuild and re-send the proxied request after a successful
/// auto-increase-ctx reload. `new_port` points at the freshly-spawned
/// llama-server / mlx-server, `new_api_key` is the per-session bearer
/// token (empty for MLX sessions, since mlx-vlm has no auth layer and is
/// bound to loopback only — the `if !new_api_key.is_empty()` branch below
/// gracefully omits the `Authorization` header in that case).
/// All other parameters mirror the original request so the retry is
/// byte-identical on the wire.
async fn retry_local_upstream(
    local_client: &Client,
    method: &hyper::Method,
    destination_path: &str,
    new_port: i32,
    new_api_key: &str,
    headers: &hyper::HeaderMap,
    body: Option<Bytes>,
) -> Result<reqwest::Response, reqwest::Error> {
    let upstream_url = format!("http://127.0.0.1:{new_port}/v1{destination_path}");
    let mut req = local_client.request(method.clone(), &upstream_url);
    for (name, value) in headers.iter() {
        if name != hyper::header::HOST && name != hyper::header::AUTHORIZATION {
            req = req.header(name, value);
        }
    }
    if !new_api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {new_api_key}"));
    }
    let req_with_body = if let Some(bytes) = body {
        req.body(bytes)
    } else {
        req
    };
    req_with_body.send().await
}

/// Wrap an upstream `reqwest::Response` into a `hyper::Response<Body>` that
/// streams bytes as they arrive and attaches the proxy's CORS headers.
/// Extracted so the auto-increase-ctx retry path and the primary success
/// path share the same forwarding implementation.
fn build_streaming_response(
    response: reqwest::Response,
    host_header: &str,
    origin_header: &str,
    trusted_hosts: &[Vec<String>],
) -> Response<Body> {
    let status = response.status();
    let mut builder = Response::builder().status(status);
    for (name, value) in response.headers() {
        if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
            builder = builder.header(name, value);
        }
    }
    builder = add_cors_headers_with_host_and_origin(
        builder,
        host_header,
        origin_header,
        trusted_hosts,
    );

    let mut stream = response.bytes_stream();
    let (mut sender, body) = hyper::Body::channel();
    tokio::spawn(async move {
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    if sender.send_data(chunk).await.is_err() {
                        log::debug!("Client disconnected during retry streaming");
                        break;
                    }
                }
                Err(e) => {
                    log::error!("Retry stream error: {e}");
                    break;
                }
            }
        }
    });

    builder.body(body).unwrap()
}

/// Handle a POST to `/responses`. Backends that serve the Responses API
/// natively (MLX sidecar, remote OpenAI-compatible providers) get a byte-for-
/// byte passthrough; the llama.cpp backends, which only speak Chat Completions,
/// are bridged through [`responses_shim`] in both directions (request body and
/// the streamed / non-streamed reply). See the 2026-06-02 ADR in `AGENTS.md`.
#[allow(clippy::too_many_arguments)]
async fn handle_responses_request(
    state: &mut EmitState,
    body: Body,
    headers: &hyper::HeaderMap,
    host_header: &str,
    origin_header: &str,
    config: &ProxyConfig,
    local_client: &Client,
    client: &Client,
    sessions: &Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: &Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: &Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    provider_configs: &Arc<Mutex<HashMap<String, ProviderConfig>>>,
) -> Result<Response<Body>, hyper::Error> {
    use crate::core::server::responses_shim;

    state.endpoint = Some("responses");

    let make_err = |status: StatusCode, msg: &str| -> Response<Body> {
        let mut b = Response::builder().status(status);
        b = add_cors_headers_with_host_and_origin(b, host_header, origin_header, &config.trusted_hosts);
        b.body(Body::from(msg.to_string())).unwrap()
    };

    let body_bytes = match hyper::body::to_bytes(body).await {
        Ok(b) => b,
        Err(_) => {
            state.error_kind = Some("bad_request");
            return Ok(make_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read request body",
            ));
        }
    };

    let json: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(e) => {
            state.error_kind = Some("bad_request");
            return Ok(make_err(
                StatusCode::BAD_REQUEST,
                &format!("Invalid JSON body: {e}"),
            ));
        }
    };

    let stream = json
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    state.stream = stream;

    let model_id = match json.get("model").and_then(|v| v.as_str()) {
        Some(m) => m.to_string(),
        None => {
            state.error_kind = Some("bad_request");
            return Ok(make_err(
                StatusCode::BAD_REQUEST,
                "Request body must contain a 'model' field",
            ));
        }
    };
    state.model_id = Some(model_id.clone());

    enum Target {
        Passthrough { url: String, api_key: Option<String> },
        Translate { url: String, api_key: Option<String> },
    }

    // Remote provider takes precedence (same resolution as /chat/completions).
    let provider_name = {
        let pc = provider_configs.lock().await;
        pc.iter()
            .find(|(_, c)| c.models.iter().any(|m| m == &model_id))
            .map(|(_, c)| c.provider.clone())
            .or_else(|| {
                if let Some(sep) = model_id.find('/') {
                    let p = &model_id[..sep];
                    if pc.contains_key(p) {
                        return Some(p.to_string());
                    }
                }
                pc.get(&model_id).map(|c| c.provider.clone())
            })
    };

    let target = if let Some(p) = provider_name {
        state.backend = "remote";
        state.provider = Some(p.clone());
        let cfg = {
            let pc = provider_configs.lock().await;
            pc.get(&p).cloned()
        };
        match cfg {
            Some(c) => match c.base_url {
                Some(base) => Target::Passthrough {
                    url: format!("{}/responses", base.trim_end_matches('/')),
                    api_key: c.api_key,
                },
                None => {
                    state.error_kind = Some("proxy_internal");
                    return Ok(make_err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Provider has no base_url",
                    ));
                }
            },
            None => {
                state.error_kind = Some("proxy_internal");
                return Ok(make_err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Provider config not found",
                ));
            }
        }
    } else {
        let llama = {
            let g = sessions.lock().await;
            g.values()
                .find(|s| model_ids_match(&s.info.model_id, &model_id))
                .map(|s| (s.info.port, s.info.api_key.clone()))
        };
        let upstream = if llama.is_none() {
            let g = sessions_upstream.lock().await;
            g.values()
                .find(|s| model_ids_match(&s.info.model_id, &model_id))
                .map(|s| (s.info.port, s.info.api_key.clone()))
        } else {
            None
        };
        let mlx = {
            let g = mlx_sessions.lock().await;
            g.values()
                .find(|s| model_ids_match(&s.info.model_id, &model_id))
                .map(|s| (s.info.port, s.info.api_key.clone()))
        };

        if let Some((port, key)) = llama {
            state.backend = "llamacpp";
            Target::Translate {
                url: format!("http://127.0.0.1:{port}/v1/chat/completions"),
                api_key: Some(key),
            }
        } else if let Some((port, key)) = upstream {
            state.backend = "llamacpp-upstream";
            Target::Translate {
                url: format!("http://127.0.0.1:{port}/v1/chat/completions"),
                api_key: Some(key),
            }
        } else if let Some((port, key)) = mlx {
            state.backend = "mlx";
            Target::Passthrough {
                url: format!("http://127.0.0.1:{port}/v1/responses"),
                api_key: Some(key),
            }
        } else {
            state.error_kind = Some("not_found");
            return Ok(make_err(
                StatusCode::NOT_FOUND,
                &format!("No running session found for model '{model_id}'"),
            ));
        }
    };

    match target {
        Target::Passthrough { url, api_key } => {
            log::info!("Proxying /responses passthrough to {url} (backend={})", state.backend);
            let effective_client = if is_local_url(&url) { local_client } else { client };
            let mut req = effective_client
                .post(&url)
                .header("Content-Type", "application/json");
            for (name, value) in headers.iter() {
                if name != hyper::header::HOST
                    && name != hyper::header::AUTHORIZATION
                    && name != hyper::header::CONTENT_LENGTH
                    && name != hyper::header::CONTENT_TYPE
                {
                    req = req.header(name, value);
                }
            }
            if let Some(key) = api_key {
                req = req.header("Authorization", format!("Bearer {key}"));
            }
            match req.body(body_bytes).send().await {
                Ok(resp) => Ok(build_streaming_response(
                    resp,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                )),
                Err(e) => {
                    state.error_kind = Some(unreachable_error_kind(state.backend));
                    Ok(make_err(
                        StatusCode::BAD_GATEWAY,
                        &format!("Proxy request to model failed: {e}"),
                    ))
                }
            }
        }
        Target::Translate { url, api_key } => {
            log::info!(
                "Bridging /responses -> /chat/completions at {url} (backend={}, stream={stream})",
                state.backend
            );
            let chat_body = responses_shim::responses_request_to_chat(&json);
            let mut req = local_client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Accept-Encoding", "identity");
            if let Some(key) = api_key {
                req = req.header("Authorization", format!("Bearer {key}"));
            }
            let resp = match req.body(chat_body.to_string()).send().await {
                Ok(r) => r,
                Err(e) => {
                    state.error_kind = Some(unreachable_error_kind(state.backend));
                    return Ok(make_err(
                        StatusCode::BAD_GATEWAY,
                        &format!("Proxy request to model failed: {e}"),
                    ));
                }
            };

            let status = resp.status();
            if !status.is_success() {
                state.error_kind = Some(upstream_error_kind(state.backend));
                state.upstream_status = Some(status.as_u16());
                let err_body = resp
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error body: {e}"));
                state.oom_detected = body_indicates_oom(&err_body);
                state.ctx_overflow_detected = is_context_limit_error(status, &err_body);
                let code =
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
                return Ok(make_err(code, &err_body));
            }

            let response_id = responses_shim::new_response_id();

            if !stream {
                let bytes = resp.bytes().await.unwrap_or_default();
                let chat_json: serde_json::Value =
                    serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
                let responses_obj = responses_shim::chat_response_to_responses(
                    &chat_json,
                    &response_id,
                    &model_id,
                );
                let mut b = Response::builder()
                    .status(StatusCode::OK)
                    .header(hyper::header::CONTENT_TYPE, "application/json");
                b = add_cors_headers_with_host_and_origin(
                    b,
                    host_header,
                    origin_header,
                    &config.trusted_hosts,
                );
                return Ok(b.body(Body::from(responses_obj.to_string())).unwrap());
            }

            let mut b = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/event-stream")
                .header(hyper::header::CACHE_CONTROL, "no-cache");
            b = add_cors_headers_with_host_and_origin(
                b,
                host_header,
                origin_header,
                &config.trusted_hosts,
            );

            let (mut sender, resp_body) = Body::channel();
            let model_for_conv = model_id.clone();
            tokio::spawn(async move {
                let mut conv =
                    responses_shim::ResponsesStreamConverter::new(response_id, model_for_conv);
                if sender
                    .send_data(sse_event(&conv.created_event()))
                    .await
                    .is_err()
                {
                    return;
                }

                let mut upstream = resp.bytes_stream();
                let mut buf: Vec<u8> = Vec::new();
                let mut usage: Option<serde_json::Value> = None;

                'outer: while let Some(chunk) = upstream.next().await {
                    let bytes = match chunk {
                        Ok(b) => b,
                        Err(e) => {
                            log::error!("/responses upstream stream error: {e}");
                            break;
                        }
                    };
                    buf.extend_from_slice(&bytes);

                    while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                        let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                        let line = String::from_utf8_lossy(&line_bytes);
                        let line = line.trim();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line["data:".len()..].trim();
                        if data == "[DONE]" {
                            for ev in conv.finish(usage.as_ref()) {
                                let _ = sender.send_data(sse_event(&ev)).await;
                            }
                            return;
                        }
                        if let Ok(j) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(u) = j.get("usage") {
                                if !u.is_null() {
                                    usage = Some(u.clone());
                                }
                            }
                            for ev in conv.on_chunk(&j) {
                                if sender.send_data(sse_event(&ev)).await.is_err() {
                                    break 'outer;
                                }
                            }
                        }
                    }
                }

                // Upstream closed without an explicit [DONE]; flush closers.
                for ev in conv.finish(usage.as_ref()) {
                    let _ = sender.send_data(sse_event(&ev)).await;
                }
            });

            Ok(b.body(resp_body).unwrap())
        }
    }
}

/// High-level wrapper around `acquire_auto_increase_slot` +
/// `trigger_auto_increase`. Skips remote providers and embedding sessions
/// up front; coordinates concurrent waiters through the shared `Notify`.
#[allow(clippy::too_many_arguments)]
async fn maybe_auto_increase_and_retry<R: Runtime>(
    app_handle: &AppHandle<R>,
    auto_state: &AutoIncreaseState,
    backend: &str,
    model_id: &str,
    sessions: &Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: &Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: &Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    trigger: &str,
) -> Option<(i32, String)> {
    if backend != "llamacpp" && backend != "llamacpp-upstream" && backend != "mlx" {
        return None;
    }
    if is_embedding_session(backend, model_id, sessions, sessions_upstream, mlx_sessions).await {
        log::debug!(
            "auto_increase_ctx: skipping embedding session backend={backend} model_id={model_id}"
        );
        return None;
    }

    let (notify, is_leader) = acquire_auto_increase_slot(auto_state, model_id).await;

    if !is_leader {
        // Wait for the leader to finish. We only block on the notify; the
        // outcome (including `ok=false`) lives in `last_outcome`.
        let wait = tokio::time::timeout(
            std::time::Duration::from_secs(AUTO_INCREASE_TIMEOUT_SECS),
            notify.notified(),
        )
        .await;
        if wait.is_err() {
            log::warn!(
                "auto_increase_ctx: follower timed out waiting for leader (model_id={model_id})"
            );
            return None;
        }
        match read_auto_increase_outcome(auto_state, model_id).await {
            Some(o) if o.ok => {
                return resolve_local_session(
                    backend,
                    model_id,
                    sessions,
                    sessions_upstream,
                    mlx_sessions,
                )
                .await;
            }
            _ => return None,
        }
    }

    // Leader path.
    let outcome = trigger_auto_increase(app_handle, backend, model_id, trigger).await;
    store_auto_increase_outcome(
        auto_state,
        model_id,
        AutoIncreaseOutcome {
            ok: outcome.ok,
            new_ctx_len: outcome.new_ctx_len,
            reason: outcome.reason.clone(),
        },
    )
    .await;
    release_auto_increase_slot(auto_state, model_id, &notify).await;

    if !outcome.ok {
        log::info!(
            "auto_increase_ctx: leader outcome ok=false model_id={model_id} reason={:?}",
            outcome.reason
        );
        return None;
    }
    log::info!(
        "auto_increase_ctx: leader outcome ok=true model_id={model_id} new_ctx_len={:?}",
        outcome.new_ctx_len
    );

    resolve_local_session(
        backend,
        model_id,
        sessions,
        sessions_upstream,
        mlx_sessions,
    )
    .await
}

/// Wraps `inner_proxy_request` to emit a single analytics event per proxied
/// request via `ANALYTICS_CHANNEL`. The wrapper measures latency from the
/// moment the request is received until the inner handler returns a response
/// (for streaming responses this is TTFB — headers + status — which is
/// sufficient for the "chat vs local API server" product metric). The inner
/// handler never sees the `AppHandle`, which structurally guarantees that
/// analytics events are not emitted per SSE chunk.
#[allow(clippy::too_many_arguments)]
async fn proxy_request<R: Runtime>(
    req: Request<Body>,
    client: Client,
    local_client: Client,
    config: ProxyConfig,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    auto_increase_state: Arc<AutoIncreaseState>,
    app_handle: AppHandle<R>,
) -> Result<Response<Body>, hyper::Error> {
    let start = Instant::now();
    let method_str = req.method().as_str().to_string();
    let mut state = EmitState {
        backend: "unknown",
        ..EmitState::default()
    };

    let response = inner_proxy_request(
        &mut state,
        req,
        client,
        local_client,
        config,
        sessions,
        sessions_upstream,
        mlx_sessions,
        provider_configs,
        auto_increase_state,
        app_handle.clone(),
    )
    .await?;

    if !state.skip_emit {
        emit_api_request_event(
            &app_handle,
            ApiRequestEvent {
                source: "local_api_server",
                endpoint: state.endpoint.unwrap_or("other"),
                method: &method_str,
                model_id: state.model_id.clone(),
                backend: state.backend,
                provider: state.provider.clone(),
                stream: state.stream,
                status: response.status().as_u16(),
                latency_ms: start.elapsed().as_millis() as u64,
                is_anthropic_fallback: state.is_anthropic_fallback,
                error_kind: state.error_kind,
                upstream_status: state.upstream_status,
                oom_detected: state.oom_detected,
                ctx_overflow_detected: state.ctx_overflow_detected,
                server_bind_failed: state.server_bind_failed,
            },
        );
    }

    Ok(response)
}

/// Handles the proxy request logic. Populates `state` with request metadata so
/// the outer `proxy_request` wrapper can emit a single analytics event per
/// proxied request (see `ANALYTICS_CHANNEL`). Preflight, static docs and other
/// non-product traffic set `state.skip_emit = true`.
#[allow(clippy::too_many_arguments)]
async fn inner_proxy_request<R: Runtime>(
    state: &mut EmitState,
    req: Request<Body>,
    client: Client,
    local_client: Client,
    config: ProxyConfig,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    auto_increase_state: Arc<AutoIncreaseState>,
    app_handle: AppHandle<R>,
) -> Result<Response<Body>, hyper::Error> {
    if req.method() == hyper::Method::OPTIONS {
        // CORS preflight is not a product signal; suppress analytics for the
        // entire preflight branch regardless of its outcome.
        state.skip_emit = true;
        log::debug!(
            "Handling CORS preflight request from {:?} {:?}",
            req.headers().get(hyper::header::HOST),
            req.headers()
                .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
        );

        let host = req
            .headers()
            .get(hyper::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let origin = req
            .headers()
            .get(hyper::header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let requested_method = req
            .headers()
            .get("Access-Control-Request-Method")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
        let method_allowed = requested_method.is_empty()
            || allowed_methods
                .iter()
                .any(|&method| method.eq_ignore_ascii_case(requested_method));

        if !method_allowed {
            log::warn!("CORS preflight: Method '{requested_method}' not allowed");
            return Ok(Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(Body::from("Method not allowed"))
                .unwrap());
        }

        let request_path = req.uri().path();
        let whitelisted_paths = ["/", "/openapi.json"];
        let is_whitelisted_path = whitelisted_paths.contains(&request_path);

        let is_trusted = if is_whitelisted_path {
            log::debug!(
                "CORS preflight: Bypassing host check for whitelisted path: {request_path}"
            );
            true
        } else if !host.is_empty() {
            log::debug!(
                "CORS preflight: Host is '{host}', trusted hosts: {:?}",
                &config.trusted_hosts
            );
            is_valid_host(host, &config.trusted_hosts)
        } else {
            log::warn!("CORS preflight: No Host header present");
            false
        };

        if !is_trusted {
            log::warn!("CORS preflight: Host '{host}' not trusted for path '{request_path}'");
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from(format!(
                    "Host '{host}' is not in Trusted Hosts. Add this server's address (e.g. \
                     its LAN IP or hostname) in Settings \u{2192} Local API Server \u{2192} \
                     Trusted Hosts, or use '*' to allow all."
                )))
                .unwrap());
        }

        let requested_headers = req
            .headers()
            .get("Access-Control-Request-Headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_headers = [
            "accept",
            "accept-language",
            "authorization",
            "cache-control",
            "connection",
            "content-type",
            "dnt",
            "host",
            "if-modified-since",
            "keep-alive",
            "origin",
            "user-agent",
            "x-api-key",
            "x-csrf-token",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "x-requested-with",
            "x-stainless-arch",
            "x-stainless-lang",
            "x-stainless-os",
            "x-stainless-package-version",
            "x-stainless-retry-count",
            "x-stainless-runtime",
            "x-stainless-runtime-version",
            "x-stainless-timeout",
        ];

        let headers_valid = if requested_headers.is_empty() {
            true
        } else {
            requested_headers
                .split(',')
                .map(|h| h.trim())
                .all(|header| {
                    allowed_headers
                        .iter()
                        .any(|&allowed| allowed.eq_ignore_ascii_case(header))
                })
        };

        if !headers_valid {
            log::warn!("CORS preflight: Some requested headers not allowed: {requested_headers}");
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Headers not allowed"))
                .unwrap());
        }

        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Methods", allowed_methods.join(", "))
            .header("Access-Control-Allow-Headers", allowed_headers.join(", "))
            .header("Access-Control-Max-Age", "86400")
            .header(
                "Vary",
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
            );

        if !origin.is_empty() {
            let origin_host = extract_host_from_origin(origin);
            if is_valid_host(&origin_host, &config.trusted_hosts) {
                response = response
                    .header("Access-Control-Allow-Origin", origin)
                    .header("Access-Control-Allow-Credentials", "true");
            } else {
                log::warn!("CORS preflight: Origin '{origin}' is not trusted, not reflecting origin");
            }
        }

        log::debug!("CORS preflight response: host_trusted={is_trusted}, origin='{origin}'");
        return Ok(response.body(Body::empty()).unwrap());
    }

    let (parts, body) = req.into_parts();

    let origin_header = parts
        .headers
        .get(hyper::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let host_header = parts
        .headers
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let original_path = parts.uri.path();
    let headers = parts.headers.clone();

    let path = get_destination_path(original_path, &config.prefix);
    let method = parts.method.clone();

    let whitelisted_paths = [
        "/",
        "/openapi.json",
        "/docs/swagger-ui.css",
        "/docs/swagger-ui-bundle.js",
        "/docs/swagger-ui-standalone-preset.js",
    ];
    let is_whitelisted_path = whitelisted_paths.contains(&path.as_str());

    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(&host_header, &config.trusted_hosts) {
                state.endpoint = Some(endpoint_from_path(path.as_str()));
                state.error_kind = Some("host");
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from(format!(
                        "Host '{host_header}' is not in Trusted Hosts. Add this server's \
                         address (e.g. its LAN IP or hostname) in Settings \u{2192} Local API \
                         Server \u{2192} Trusted Hosts, or use '*' to allow all."
                    )))
                    .unwrap());
            }
        } else {
            state.endpoint = Some(endpoint_from_path(path.as_str()));
            state.error_kind = Some("bad_request");
            let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Missing host header"))
                .unwrap());
        }
    } else {
        log::debug!("Bypassing host validation for whitelisted path: {path}");
    }

    if !is_whitelisted_path && !config.proxy_api_key.is_empty() {
        // Check Authorization header (Bearer token)
        let auth_valid = parts
            .headers
            .get(hyper::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == config.proxy_api_key)
            .unwrap_or(false);

        // Check X-Api-Key header
        let api_key_valid = parts
            .headers
            .get("X-Api-Key")
            .and_then(|v| v.to_str().ok())
            .map(|key| key == config.proxy_api_key)
            .unwrap_or(false);

        if !auth_valid && !api_key_valid {
            state.endpoint = Some(endpoint_from_path(path.as_str()));
            state.error_kind = Some("auth");
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Invalid or missing authorization token"))
                .unwrap());
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {path}");
    }

    if path.contains("/configs") {
        // Hidden/sensitive route: suppress from analytics.
        state.skip_emit = true;
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response.body(Body::from("Not Found")).unwrap());
    }

    // Codex CLI (and other Responses-only clients) hit `/responses`, which the
    // llama.cpp backends do not implement. Handle it in a self-contained
    // branch: passthrough for backends that serve it natively (MLX, remote
    // providers), translate to `/chat/completions` for llama.cpp. Returns
    // early so it never threads through the chat-completions retry machinery.
    if method == hyper::Method::POST && path == "/responses" {
        return handle_responses_request(
            state,
            body,
            &headers,
            &host_header,
            &origin_header,
            &config,
            &local_client,
            &client,
            &sessions,
            &sessions_upstream,
            &mlx_sessions,
            &provider_configs,
        )
        .await;
    }

    let original_path = parts.uri.path();
    let destination_path = get_destination_path(original_path, &config.prefix);

    // Initialize variables that will be set in the match
    let mut session_api_key: Option<String> = None;
    #[allow(unused_assignments)]
    let mut buffered_body: Option<Bytes> = None;
    let mut target_base_url: Option<String> = None;
    let mut is_anthropic_messages = false;

    match (method.clone(), destination_path.as_str()) {
        // Anthropic /messages endpoint - tries /messages first, falls back to /chat/completions on error
        (hyper::Method::POST, "/messages") => {
            is_anthropic_messages = true;
            state.endpoint = Some("messages");
            log::info!(
                "Handling POST request to /messages with chat/completions fallback on error",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    state.error_kind = Some("bad_request");
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Failed to read request body"))
                        .unwrap());
                }
            };
            buffered_body = Some(body_bytes.clone());

            // Parse body to get model_id for routing (don't transform yet)
            match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
                Ok(json_body) => {
                    state.stream = json_body
                        .get("stream")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                        state.model_id = Some(model_id.to_string());
                        let pc = provider_configs.lock().await;

                        // Try to find a provider for this model
                        let provider_name: Option<String> = pc
                            .iter()
                            .find(|(_, config)| config.models.iter().any(|m| m == model_id))
                            .map(|(_, config)| config.provider.clone())
                            .or_else(|| {
                                if let Some(sep_pos) = model_id.find('/') {
                                    let potential_provider: &str = &model_id[..sep_pos];
                                    if pc.contains_key(potential_provider) {
                                        return Some(potential_provider.to_string());
                                    }
                                }
                                pc.get(model_id).map(|c| c.provider.clone())
                            });

                        drop(pc);

                        if let Some(ref p) = provider_name {
                            log::info!("Using remote provider '{p}' for model '{model_id}'");
                            state.backend = "remote";
                            state.provider = Some(p.clone());
                            let pc2 = provider_configs.lock().await;
                            let provider_config = pc2.get(p.as_str()).cloned();
                            drop(pc2);

                            if let Some(provider_cfg) = provider_config {
                                target_base_url = provider_cfg.base_url.clone().map(|url| {
                                    format!("{}{}", url.trim_end_matches('/'), "/messages")
                                });
                                session_api_key = provider_cfg.api_key.clone();
                            }
                        } else {
                            // No remote provider, try local sessions
                            let sessions_guard = sessions.lock().await;
                            let llama_session = sessions_guard
                                .values()
                                .find(|s| model_ids_match(&s.info.model_id, model_id))
                                .map(|s| (s.info.port, s.info.api_key.clone()));
                            drop(sessions_guard);

                            let llama_upstream_session = if llama_session.is_none() {
                                let guard = sessions_upstream.lock().await;
                                guard
                                    .values()
                                    .find(|s| model_ids_match(&s.info.model_id, model_id))
                                    .map(|s| (s.info.port, s.info.api_key.clone()))
                            } else {
                                None
                            };

                            let mlx_session_info = {
                                let mlx_guard = mlx_sessions.lock().await;
                                mlx_guard
                                    .values()
                                    .find(|s| model_ids_match(&s.info.model_id, model_id))
                                    .map(|s| s.info.clone())
                            };

                            if let Some((target_port, api_key)) = llama_session {
                                state.backend = "llamacpp";
                                session_api_key = Some(api_key);
                                target_base_url =
                                    Some(format!("http://127.0.0.1:{}/v1/messages", target_port));
                            } else if let Some((target_port, api_key)) = llama_upstream_session {
                                state.backend = "llamacpp-upstream";
                                session_api_key = Some(api_key);
                                target_base_url =
                                    Some(format!("http://127.0.0.1:{}/v1/messages", target_port));
                            } else if let Some(info) = mlx_session_info {
                                state.backend = "mlx";
                                let target_port = info.port;
                                session_api_key = Some(info.api_key.clone());
                                target_base_url =
                                    Some(format!("http://127.0.0.1:{}/v1/messages", target_port));
                            } else {
                                state.error_kind = Some("not_found");
                                log::warn!("No running session found for model_id: {model_id}");
                                let mut error_response =
                                    Response::builder().status(StatusCode::NOT_FOUND);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(Body::from(format!(
                                        "No running session found for model '{model_id}'"
                                    )))
                                    .unwrap());
                            }
                        }
                    } else {
                        state.error_kind = Some("bad_request");
                        let error_msg = "Request body must contain a 'model' field";
                        log::warn!("POST body for /messages missing 'model' field");
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_REQUEST);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(error_msg)).unwrap());
                    }
                }
                Err(e) => {
                    state.error_kind = Some("bad_request");
                    log::warn!("Failed to parse POST body for /messages as JSON: {e}");
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    let error_msg = format!("Invalid JSON body: {}", e);
                    return Ok(error_response.body(Body::from(error_msg)).unwrap());
                }
            }
        }
        (hyper::Method::POST, "/chat/completions")
        | (hyper::Method::POST, "/completions")
        | (hyper::Method::POST, "/embeddings")
        | (hyper::Method::POST, "/messages/count_tokens") => {
            state.endpoint = Some(endpoint_from_path(destination_path.as_str()));
            log::info!(
                "Handling POST request to {destination_path} requiring model lookup in body",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    state.error_kind = Some("bad_request");
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Failed to read request body"))
                        .unwrap());
                }
            };
            buffered_body = Some(body_bytes.clone());

            match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
                Ok(json_body) => {
                    emit_ttft_timing(&app_handle, "zetaProxyIn");
                    log_ttft_prefix_dump(&json_body);
                    state.stream = json_body
                        .get("stream")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                        state.model_id = Some(model_id.to_string());
                        log::debug!("Extracted model_id: {model_id}");

                        // First, check if there's a registered remote provider for this model
                        let pc = provider_configs.lock().await;

                        // Try to find a provider that has this model configured
                        let provider_name = pc
                            .iter()
                            .find(|(_, config)| {
                                // Check if any model in this provider matches
                                config.models.iter().any(|m| m == model_id)
                            })
                            .map(|(_, config)| config.provider.clone())
                            .or_else(|| {
                                // Try to find by provider name in model_id (e.g., "anthropic/claude-3-opus")
                                if let Some(sep_pos) = model_id.find('/') {
                                    let potential_provider: &str = &model_id[..sep_pos];
                                    if pc.contains_key(potential_provider) {
                                        return Some(potential_provider.to_string());
                                    }
                                }
                                // Also check if the model_id itself matches a provider name
                                pc.get(model_id).map(|c| c.provider.clone())
                            });

                        drop(pc);

                        if let Some(ref provider) = provider_name {
                            // Found a remote provider, stream the response directly
                            log::info!("Found remote provider '{provider}' for model '{model_id}'");
                            state.backend = "remote";
                            state.provider = Some(provider.clone());

                            // Get the provider config
                            let pc2 = provider_configs.lock().await;
                            let provider_config = pc2.get(provider.as_str()).cloned();

                            // Log registered providers for debugging
                            log::debug!(
                                "Registered providers: {:?}",
                                pc2.keys().collect::<Vec<_>>()
                            );

                            drop(pc2);

                            if let Some(provider_cfg) = provider_config {
                                if let Some(api_url) = provider_cfg.base_url.clone() {
                                    target_base_url = Some(format!("{api_url}{destination_path}"));
                                } else {
                                    target_base_url = None;
                                }
                                if let Some(api_key_value) = provider_cfg.api_key.clone() {
                                    session_api_key = Some(api_key_value);
                                } else {
                                    session_api_key = None;
                                }
                            } else {
                                log::error!("Provider config not found for '{provider}'");
                            }
                        } else {
                            // No remote provider found, check for local session
                            let sessions_guard = sessions.lock().await;

                            // Use original model_id for local session lookup
                            let sessions_find_model = model_id;

                            // Check both llama.cpp variants and MLX sessions
                            let llama_session = sessions_guard
                                .values()
                                .find(|s| model_ids_match(&s.info.model_id, sessions_find_model))
                                .map(|s| (s.info.port, s.info.api_key.clone()));
                            let llama_count = sessions_guard.len();
                            drop(sessions_guard);

                            let (llama_upstream_session, llama_upstream_count) = {
                                let guard = sessions_upstream.lock().await;
                                let info = guard
                                    .values()
                                    .find(|s| {
                                        model_ids_match(&s.info.model_id, sessions_find_model)
                                    })
                                    .map(|s| (s.info.port, s.info.api_key.clone()));
                                (info, guard.len())
                            };

                            let (mlx_session_info, mlx_count) = {
                                let mut mlx_session_info: Option<SessionInfo> = None;
                                let mlx_count;
                                let mlx_guard = mlx_sessions.lock().await;
                                mlx_count = mlx_guard.len();
                                if let Some(session) = mlx_guard
                                    .values()
                                    .find(|s| model_ids_match(&s.info.model_id, sessions_find_model))
                                {
                                    // Clone just the SessionInfo since MlxBackendSession is not Clone
                                    mlx_session_info = Some(session.info.clone());
                                }
                                (mlx_session_info, mlx_count)
                            };

                            let total_sessions = llama_count + llama_upstream_count + mlx_count;

                            // mlx_session_info is Option<SessionInfo>, use as_ref to get Option<&SessionInfo>
                            let mlx_session = mlx_session_info.as_ref();

                            if total_sessions == 0 {
                                state.error_kind = Some("not_found");
                                log::warn!(
                                    "Request for model '{model_id}' but no models are running."
                                );
                                let mut error_response =
                                    Response::builder().status(StatusCode::SERVICE_UNAVAILABLE);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(Body::from("No models are available"))
                                    .unwrap());
                            }

                            if let Some((target_port, api_key)) = llama_session {
                                state.backend = "llamacpp";
                                session_api_key = Some(api_key);
                                log::debug!("Found llama.cpp session for model_id {model_id}");
                                target_base_url = Some(format!(
                                    "http://127.0.0.1:{target_port}/v1{destination_path}"
                                ));
                            } else if let Some((target_port, api_key)) = llama_upstream_session {
                                state.backend = "llamacpp-upstream";
                                session_api_key = Some(api_key);
                                log::debug!(
                                    "Found upstream llama.cpp session for model_id {model_id}"
                                );
                                target_base_url = Some(format!(
                                    "http://127.0.0.1:{target_port}/v1{destination_path}"
                                ));
                            } else if let Some(info) = mlx_session {
                                state.backend = "mlx";
                                let target_port = info.port;
                                session_api_key = Some(info.api_key.clone());
                                log::debug!("Found MLX session for model_id {model_id}");
                                target_base_url = Some(format!(
                                    "http://127.0.0.1:{target_port}/v1{destination_path}"
                                ));
                            } else {
                                state.error_kind = Some("not_found");
                                log::warn!("No running session found for model_id: {model_id}");
                                let mut error_response =
                                    Response::builder().status(StatusCode::NOT_FOUND);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(Body::from(format!(
                                        "No running session found for model '{model_id}'"
                                    )))
                                    .unwrap());
                            }
                        }
                    } else {
                        state.error_kind = Some("bad_request");
                        let error_msg = "Request body must contain a 'model' field";
                        log::warn!(
                            "POST body for {destination_path} is missing 'model' field or it's not a string"
                        );
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_REQUEST);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(error_msg)).unwrap());
                    }
                }
                Err(e) => {
                    state.error_kind = Some("bad_request");
                    log::warn!("Failed to parse POST body for {destination_path} as JSON: {e}");
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    let error_msg = format!("Invalid JSON body: {}", e);
                    return Ok(error_response.body(Body::from(error_msg)).unwrap());
                }
            }
        }
        (hyper::Method::GET, "/models") => {
            state.endpoint = Some("models");
            // ATO-112: model-list polling is high-volume and not a product
            // signal (clients refresh it constantly); suppress analytics.
            state.skip_emit = true;
            log::debug!("Handling GET /v1/models request");

            // Get local llama.cpp (turboquant) sessions
            let sessions_guard = sessions.lock().await;
            let mut local_models: Vec<_> = sessions_guard
                .values()
                .map(|session| {
                    serde_json::json!({
                        "id": session.info.model_id,
                        "object": "model",
                        "created": 1,
                        "owned_by": "llama.cpp"
                    })
                })
                .collect();
            drop(sessions_guard);

            // Get upstream llama.cpp sessions
            let sessions_upstream_guard = sessions_upstream.lock().await;
            let upstream_models: Vec<_> = sessions_upstream_guard
                .values()
                .map(|session| {
                    serde_json::json!({
                        "id": session.info.model_id,
                        "object": "model",
                        "created": 1,
                        "owned_by": "llama.cpp-upstream"
                    })
                })
                .collect();
            drop(sessions_upstream_guard);
            local_models.extend(upstream_models);

            // Get MLX sessions
            let mlx_models: Vec<_> = {
                let mlx_guard = mlx_sessions.lock().await;
                mlx_guard
                    .values()
                    .map(|session| {
                        serde_json::json!({
                            "id": session.info.model_id,
                            "object": "model",
                            "created": 1,
                            "owned_by": "mlx"
                        })
                    })
                    .collect()
            };

            // Get remote provider models
            let pc = provider_configs.lock().await;
            let remote_models: Vec<_> = pc
                .values()
                .flat_map(|provider_cfg| provider_cfg.models.clone())
                .map(|model_id| {
                    serde_json::json!({
                        "id": model_id,
                        "object": "model",
                        "created": 1,
                        "owned_by": "remote"
                    })
                })
                .collect();

            // Store counts before moving
            let local_count = local_models.len();
            let mlx_count = mlx_models.len();
            let remote_count = remote_models.len();

            // Combine all models
            let mut all_models = Vec::with_capacity(local_count + mlx_count + remote_count);
            all_models.extend(local_models);
            all_models.extend(mlx_models);
            all_models.extend(remote_models);

            let response_json = serde_json::json!({
                "object": "list",
                "data": all_models
            });

            let body_str =
                serde_json::to_string(&response_json).unwrap_or_else(|_| "{}".to_string());

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            log::debug!(
                "Returning {} models ({} llama.cpp, {} MLX, {} remote)",
                all_models.len(),
                local_count,
                mlx_count,
                remote_count
            );

            return Ok(response_builder.body(Body::from(body_str)).unwrap());
        }

        // Prometheus /metrics endpoint — proxies llama-server's built-in
        // metrics exporter. Requires `?model=<id>` (or `X-Model` header) so
        // a specific session can be targeted when multiple llama.cpp models
        // are loaded. Analytics is suppressed because pollers typically hit
        // this endpoint every ~500ms and the noise is not a product signal.
        (hyper::Method::GET, "/metrics") => {
            state.endpoint = Some("metrics");
            state.skip_emit = true;

            // Resolve target model_id: ?model=<id> takes precedence over X-Model.
            let model_query = parts.uri.query().and_then(|q| {
                q.split('&').find_map(|pair| {
                    let mut kv = pair.splitn(2, '=');
                    match (kv.next(), kv.next()) {
                        (Some("model"), Some(v)) => Some(v.to_string()),
                        _ => None,
                    }
                })
            });
            let model_header = parts
                .headers
                .get("X-Model")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let metrics_model_id = match model_query.or(model_header) {
                Some(id) if !id.is_empty() => id,
                _ => {
                    state.error_kind = Some("bad_request");
                    let mut error_response =
                        Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from(
                            "Missing 'model' query parameter (use ?model=<model_id>)",
                        ))
                        .unwrap());
                }
            };

            // llama.cpp (both turboquant and upstream variants) is the only
            // backend family exposing a Prometheus /metrics endpoint. MLX has
            // no slot-pool metrics so we deliberately do not fall back to
            // mlx_sessions here.
            let target_session = {
                let sessions_guard = sessions.lock().await;
                let found = sessions_guard
                    .values()
                    .find(|s| model_ids_match(&s.info.model_id, &metrics_model_id))
                    .map(|s| (s.info.port, s.info.api_key.clone(), "llamacpp"));
                drop(sessions_guard);
                if found.is_some() {
                    found
                } else {
                    let upstream_guard = sessions_upstream.lock().await;
                    upstream_guard
                        .values()
                        .find(|s| model_ids_match(&s.info.model_id, &metrics_model_id))
                        .map(|s| (s.info.port, s.info.api_key.clone(), "llamacpp-upstream"))
                }
            };

            let (port, upstream_api_key, backend_label) = match target_session {
                Some(v) => v,
                None => {
                    state.error_kind = Some("not_found");
                    log::warn!(
                        "Metrics requested for unknown or non-llamacpp model '{metrics_model_id}'"
                    );
                    let mut error_response =
                        Response::builder().status(StatusCode::NOT_FOUND);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from(format!(
                            "No running llama.cpp session for model '{metrics_model_id}'"
                        )))
                        .unwrap());
                }
            };

            // Note: llama-server exposes /metrics at the server root, NOT
            // under /v1, so we must not reuse the standard `/v1{path}`
            // upstream URL pattern here.
            let upstream = format!("http://127.0.0.1:{port}/metrics");
            state.backend = backend_label;

            // Atomic-Chat boots llama-server with a per-session `--api-key`,
            // so even the bundled `/metrics` endpoint expects a Bearer token.
            // Forward the session key so this proxy route does not fail 401.
            let mut upstream_req = local_client.get(&upstream);
            if !upstream_api_key.is_empty() {
                upstream_req = upstream_req
                    .header(hyper::header::AUTHORIZATION, format!("Bearer {upstream_api_key}"));
            }

            match upstream_req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let content_type = resp
                        .headers()
                        .get(hyper::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("text/plain; version=0.0.4")
                        .to_string();
                    let bytes = resp.bytes().await.unwrap_or_default();

                    let mut response_builder = Response::builder()
                        .status(status)
                        .header(hyper::header::CONTENT_TYPE, content_type);
                    response_builder = add_cors_headers_with_host_and_origin(
                        response_builder,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(response_builder.body(Body::from(bytes)).unwrap());
                }
                Err(e) => {
                    state.error_kind = Some(unreachable_error_kind(state.backend));
                    log::warn!(
                        "Failed to fetch metrics for model '{metrics_model_id}': {e}"
                    );
                    let mut error_response =
                        Response::builder().status(StatusCode::BAD_GATEWAY);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from(format!(
                            "Failed to fetch metrics from llama-server: {e}"
                        )))
                        .unwrap());
                }
            }
        }

        (hyper::Method::GET, "/openapi.json") => {
            // Static documentation — not a product signal.
            state.skip_emit = true;
            let static_body = include_str!("../../../static/openapi.json"); // relative to src-tauri/src/
                                                                            // Parse the static OpenAPI JSON and update the server URL with actual host and port
            match serde_json::from_str::<serde_json::Value>(static_body) {
                Ok(mut openapi_spec) => {
                    // Update the servers array with the actual host and port
                    if let Some(servers) = openapi_spec
                        .get_mut("servers")
                        .and_then(|s| s.as_array_mut())
                    {
                        for server in servers {
                            if let Some(server_obj) = server.as_object_mut() {
                                if let Some(url) = server_obj.get_mut("url") {
                                    let base_url = format!(
                                        "http://{}:{}{}",
                                        config.host, config.port, config.prefix
                                    );
                                    *url = serde_json::Value::String(base_url);
                                }
                            }
                        }
                    }
                    let body = serde_json::to_string(&openapi_spec)
                        .unwrap_or_else(|_| static_body.to_string());
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap());
                }
                Err(_) => {
                    // If parsing fails, return the static file as fallback
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(Body::from(static_body))
                        .unwrap());
                }
            }
        }

        // DOCS route
        (hyper::Method::GET, "/") => {
            // Swagger landing page — not a product signal.
            state.skip_emit = true;
            let html = r#"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Docs</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" type="text/css" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
  window.onload = () => {
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
    });
  };
  </script>
</body>
</html>
    "#;

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/html");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            return Ok(response_builder.body(Body::from(html)).unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui.css") => {
            state.skip_emit = true;
            let css = include_str!("../../../static/swagger-ui/swagger-ui.css");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/css")
                .body(Body::from(css))
                .unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui-bundle.js") => {
            state.skip_emit = true;
            let js = include_str!("../../../static/swagger-ui/swagger-ui-bundle.js");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/javascript")
                .body(Body::from(js))
                .unwrap());
        }

        _ => {
            if let Some(allowed_methods) = allowed_methods_for_path(destination_path.as_str()) {
                state.endpoint = Some(endpoint_from_path(destination_path.as_str()));
                state.error_kind = Some("method_not_allowed");
                let allow_header = allowed_methods.join(", ");
                log::warn!(
                    "Method not allowed for known route: {method} {destination_path}; allowed: {allow_header}"
                );
                let mut error_response = Response::builder()
                    .status(StatusCode::METHOD_NOT_ALLOWED)
                    .header(hyper::header::ALLOW, allow_header);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from("Method Not Allowed"))
                    .unwrap());
            }

            state.endpoint = Some("other");
            state.error_kind = Some("not_found");
            // ATO-112: catch-all 404s are dominated by background scanners /
            // misconfigured clients and carry no product signal; suppress.
            state.skip_emit = true;
            log::warn!("Unhandled method/path for dynamic routing: {method} {destination_path}");
            let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response.body(Body::from("Not Found")).unwrap());
        }
    }

    let upstream_url = match target_base_url.clone() {
        Some(p) => p,
        None => {
            state.error_kind = Some("proxy_internal");
            log::error!(
                "Internal API server routing error: target is None after successful lookup"
            );
            let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Internal routing error"))
                .unwrap());
        }
    };
    log::info!(
        "Proxying request to model server at base URL {upstream_url}, path: {destination_path}"
    );

    let effective_client = if is_local_url(&upstream_url) { &local_client } else { &client };
    let mut outbound_req = effective_client.request(method.clone(), upstream_url);

    for (name, value) in headers.iter() {
        if name != hyper::header::HOST && name != hyper::header::AUTHORIZATION {
            outbound_req = outbound_req.header(name, value);
        }
    }

    let session_api_key_for_req = session_api_key.clone();
    let buffered_body_for_req = buffered_body.clone();

    if let Some(key) = session_api_key_for_req {
        outbound_req = outbound_req.header("Authorization", format!("Bearer {key}"));
    } else {
        log::debug!("No session API key available for this request");
    }

    let outbound_req_with_body = if let Some(bytes) = buffered_body_for_req {
        outbound_req.body(bytes)
    } else {
        state.error_kind = Some("proxy_internal");
        log::error!("Internal logic error: Request reached proxy stage without a buffered body.");
        let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response
            .body(Body::from("Internal server error: unhandled request path"))
            .unwrap());
    };

    // For Anthropic /messages, we need to track if we should transform the response
    let destination_path = path.clone();

    match outbound_req_with_body.send().await {
        Ok(response) => {
            emit_ttft_timing(&app_handle, "zetaUpstreamHeaders");
            let status = response.status();

            let is_error = !status.is_success();

            // For Anthropic /messages requests with errors, try /chat/completions
            if is_error && is_anthropic_messages {
                state.is_anthropic_fallback = true;
                log::warn!("Request failed for /messages with status {status}, trying /chat/completions...");

                // Read the error body to return to client if fallback fails
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                // Clone what we need for the fallback request
                let fallback_url = target_base_url.clone().map(|url| {
                    url.trim_end_matches("/messages")
                        .trim_end_matches('/')
                        .to_string()
                });
                let fallback_api_key = session_api_key.clone();
                let fallback_body = buffered_body.clone();

                // Transform body to OpenAI format for fallback
                if let Some((url, openai_body)) = fallback_url.zip(fallback_body).and_then(|(url, body)| {
                    let json_body = serde_json::from_slice::<serde_json::Value>(&body).ok()?;
                    match transform_anthropic_to_openai(&json_body) {
                        Some(transformed) => Some((url, transformed)),
                        None => {
                            // Zero-PII (ATO-113): the request body carries the
                            // prompt; log only its top-level shape, never content.
                            let keys: Vec<&str> = json_body
                                .as_object()
                                .map(|o| o.keys().map(String::as_str).collect())
                                .unwrap_or_default();
                            log::error!(
                                "transform_anthropic_to_openai returned None (body keys: {keys:?})"
                            );
                            None
                        }
                    }
                }) {
                    let chat_url = format!("{}/chat/completions", url);
                    log::info!("Fallback to chat completions: {chat_url}");

                    let fallback_client = if is_local_url(&chat_url) {
                        Client::builder().no_proxy().build().expect("Failed to create fallback client")
                    } else {
                        Client::builder().build().expect("Failed to create fallback client")
                    };

                    let mut fallback_req = fallback_client.post(&chat_url);

                    // Ensure Content-Type is set and prevent compression
                    fallback_req = fallback_req.header("Content-Type", "application/json");
                    fallback_req = fallback_req.header("Accept-Encoding", "identity");

                    for (name, value) in headers.iter() {
                        if name != hyper::header::HOST
                            && name != hyper::header::AUTHORIZATION
                            && name != "content-type"
                            && name != hyper::header::CONTENT_LENGTH
                            && name != hyper::header::ACCEPT_ENCODING
                        {
                            fallback_req = fallback_req.header(name, value);
                        }
                    }
                    if let Some(key) = fallback_api_key {
                        fallback_req = fallback_req.header("Authorization", format!("Bearer {key}"));
                    }

                    let fallback_body_str = openai_body.to_string();

                    let fallback_response = fallback_req.body(fallback_body_str).send().await;

                    if let Ok(res) = fallback_response {
                        let fallback_status = res.status();

                        if !fallback_status.is_success() {
                            state.error_kind = Some(upstream_error_kind(state.backend));
                            state.upstream_status = Some(fallback_status.as_u16());
                            // Return fallback error to client
                            let fallback_error = res.text().await.unwrap_or_else(|e| format!("Failed to read error: {}", e));
                            state.oom_detected = body_indicates_oom(&fallback_error);
                            state.ctx_overflow_detected =
                                is_context_limit_error(fallback_status, &fallback_error);

                            // Return the error to client
                            let mut error_response = Response::builder().status(fallback_status);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                &host_header,
                                &origin_header,
                                &config.trusted_hosts,
                            );
                            return Ok(error_response
                                .body(Body::from(fallback_error))
                                .unwrap());
                        }

                        let mut builder = Response::builder().status(fallback_status);
                        for (name, value) in res.headers() {
                            if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                                builder = builder.header(name, value);
                            }
                        }
                        builder = add_cors_headers_with_host_and_origin(
                            builder,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );

                        let is_streaming = openai_body
                            .get("stream")
                            .and_then(|s| s.as_bool())
                            .unwrap_or(false);

                        let (sender, body) = hyper::Body::channel();
                        let dest_path = destination_path.clone();

                        tokio::spawn(async move {
                            if is_streaming {
                                let stream = res.bytes_stream();
                                transform_and_forward_stream(stream, sender, &dest_path).await;
                            } else {
                                let response_body = res.bytes().await;
                                forward_non_streaming(
                                    response_body,
                                    sender,
                                    &dest_path,
                                )
                                .await;
                            }
                        });

                        return Ok(builder.body(body).unwrap());
                    } else if let Err(ref err) = fallback_response {
                        log::error!("Chat completions fallback failed: {}", err);
                    }
                }

                // If fallback failed or wasn't attempted, return error to client
                state.error_kind = Some(upstream_error_kind(state.backend));
                state.upstream_status = Some(status.as_u16());
                state.oom_detected = body_indicates_oom(&error_body);
                state.ctx_overflow_detected = is_context_limit_error(status, &error_body);
                let mut error_response = Response::builder().status(status);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from(error_body)).unwrap());
            } else if is_error {
                // Non-/messages error - return error response with body.
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                // Auto-increase-ctx retry path. Only local backends go through
                // this; remote providers and embedding sessions are filtered
                // inside `maybe_auto_increase_and_retry`. We keep the original
                // body/headers so the retry is byte-identical apart from the
                // rewritten upstream URL + Authorization header.
                let can_retry_local = (state.backend == "llamacpp"
                    || state.backend == "llamacpp-upstream"
                    || state.backend == "mlx")
                    && state.model_id.is_some()
                    && buffered_body.is_some();

                if can_retry_local && is_context_limit_error(status, &error_body) {
                    let model_id = state.model_id.clone().unwrap();
                    let backend = state.backend;
                    log::info!(
                        "Context-limit error detected (status={status} backend={backend} model_id={model_id}); triggering auto-increase"
                    );
                    if let Some((new_port, new_api_key)) = maybe_auto_increase_and_retry(
                        &app_handle,
                        &auto_increase_state,
                        backend,
                        &model_id,
                        &sessions,
                        &sessions_upstream,
                        &mlx_sessions,
                        "error",
                    )
                    .await
                    {
                        match retry_local_upstream(
                            &local_client,
                            &method,
                            &destination_path,
                            new_port,
                            &new_api_key,
                            &headers,
                            buffered_body.clone(),
                        )
                        .await
                        {
                            Ok(retry_response) => {
                                let retry_status = retry_response.status();
                                if retry_status.is_success() {
                                    log::info!(
                                        "auto_increase_ctx retry succeeded for model_id={model_id} (status={retry_status})"
                                    );
                                    return Ok(build_streaming_response(
                                        retry_response,
                                        &host_header,
                                        &origin_header,
                                        &config.trusted_hosts,
                                    ));
                                } else {
                                    log::warn!(
                                        "auto_increase_ctx retry returned non-success status={retry_status}, falling back to original error"
                                    );
                                }
                            }
                            Err(e) => {
                                log::warn!(
                                    "auto_increase_ctx retry send failed: {e}; falling back to original error"
                                );
                            }
                        }
                    }
                }

                // ATO-197: A fatal Metal/compute failure (e.g. a GPU OOM during
                // prompt processing) poisons the ggml backend — every subsequent
                // request to the same llama-server returns "Compute error" until
                // the backend is recreated. Retrying the identical request (the
                // AI SDK's default 3× retry on HTTP 500) just hammers the dead
                // backend and surfaces the opaque "Failed after 3 attempts. Last
                // error: Compute error." So we:
                //   1. recreate the backend (reload the model with the SAME ctx)
                //      so the *next* request works again, and
                //   2. return a clear, NON-retryable (HTTP 400) OOM error for
                //      THIS request so the client stops looping and the user sees
                //      an actionable message.
                // We deliberately do NOT auto-retry the same request here: a
                // deterministic prompt-processing OOM would just re-poison the
                // fresh backend.
                if can_retry_local && is_compute_backend_error(status, &error_body) {
                    let model_id = state.model_id.clone().unwrap();
                    let backend = state.backend;
                    log::warn!(
                        "Fatal compute error detected (status={status} backend={backend} model_id={model_id}); recreating backend, not retrying"
                    );
                    // Only the upstream extension understands the
                    // `compute_error_recovery` trigger (reload same-ctx). Other
                    // local backends would misinterpret it as a context grow, so
                    // we skip the reload for them and only return the clear error.
                    if backend == "llamacpp-upstream" {
                        let _ = maybe_auto_increase_and_retry(
                            &app_handle,
                            &auto_increase_state,
                            backend,
                            &model_id,
                            &sessions,
                            &sessions_upstream,
                            &mlx_sessions,
                            "compute_error_recovery",
                        )
                        .await;
                    }

                    let oom = body_indicates_oom(&error_body);
                    state.error_kind = Some(upstream_error_kind(state.backend));
                    state.upstream_status = Some(status.as_u16());
                    state.oom_detected = true;
                    let mut error_response =
                        Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from(compute_error_envelope(oom)))
                        .unwrap());
                }

                state.error_kind = Some(upstream_error_kind(state.backend));
                state.upstream_status = Some(status.as_u16());
                state.oom_detected = body_indicates_oom(&error_body);
                state.ctx_overflow_detected = is_context_limit_error(status, &error_body);
                // ATO-182: For local engines (llama.cpp / mlx), forward a
                // structured OpenAI error envelope with a typed `code` instead
                // of a raw stderr dump / `{"detail": ...}`. Remote providers
                // already return their own structured error shape, so we leave
                // those untouched.
                let client_body = if is_local_backend(state.backend) {
                    structure_backend_error_body(
                        &error_body,
                        state.oom_detected,
                        state.ctx_overflow_detected,
                    )
                } else {
                    error_body
                };
                let mut error_response = Response::builder().status(status);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from(client_body)).unwrap());
            }

            // Success case.
            //
            // For non-streaming local-backend responses we get one final JSON
            // doc we can inspect before forwarding. If `finish_reason=length`
            // surfaces, it means the upstream generation was truncated by the
            // current context window — mirror the UI-side auto-increase:
            // trigger a reload and retry once. Streaming responses remain
            // pass-through (can't retry after chunks have been emitted).
            let can_inspect_finish = !state.stream
                && (state.backend == "llamacpp"
                    || state.backend == "llamacpp-upstream"
                    || state.backend == "mlx")
                && state.model_id.is_some()
                && buffered_body.is_some();

            if can_inspect_finish {
                let body_bytes = response
                    .bytes()
                    .await
                    .unwrap_or_default();

                let context_overflow = is_context_overflow_finish_length(
                    &body_bytes,
                    buffered_body.as_deref(),
                );

                if context_overflow {
                    let model_id = state.model_id.clone().unwrap();
                    let backend = state.backend;
                    log::info!(
                        "finish_reason=length detected on 200 OK with no client max_tokens cap (backend={backend} model_id={model_id}); triggering auto-increase"
                    );
                    if let Some((new_port, new_api_key)) = maybe_auto_increase_and_retry(
                        &app_handle,
                        &auto_increase_state,
                        backend,
                        &model_id,
                        &sessions,
                        &sessions_upstream,
                        &mlx_sessions,
                        "finish_length",
                    )
                    .await
                    {
                        match retry_local_upstream(
                            &local_client,
                            &method,
                            &destination_path,
                            new_port,
                            &new_api_key,
                            &headers,
                            buffered_body.clone(),
                        )
                        .await
                        {
                            Ok(retry_response) if retry_response.status().is_success() => {
                                log::info!(
                                    "auto_increase_ctx retry succeeded for finish_reason=length (model_id={model_id})"
                                );
                                return Ok(build_streaming_response(
                                    retry_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                ));
                            }
                            Ok(retry_response) => {
                                log::warn!(
                                    "finish_reason=length retry returned status={}; falling back to original body",
                                    retry_response.status()
                                );
                            }
                            Err(e) => {
                                log::warn!(
                                    "finish_reason=length retry send failed: {e}; falling back to original body"
                                );
                            }
                        }
                    }
                }

                // Fall-through: serve the originally-buffered body. We've
                // already consumed `response`, so we can't copy its headers
                // verbatim — reconstruct the minimum set the client needs
                // for a non-streaming OpenAI JSON response.
                let mut builder = Response::builder()
                    .status(status)
                    .header(hyper::header::CONTENT_TYPE, "application/json");
                builder = add_cors_headers_with_host_and_origin(
                    builder,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(builder.body(Body::from(body_bytes)).unwrap());
            }

            let mut builder = Response::builder().status(status);

            for (name, value) in response.headers() {
                if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                    builder = builder.header(name, value);
                }
            }

            builder = add_cors_headers_with_host_and_origin(
                builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            let mut stream = response.bytes_stream();
            let (mut sender, body) = hyper::Body::channel();
            let ttft_app = app_handle.clone();
            let mut eta_emitted = false;

            tokio::spawn(async move {
                // Regular passthrough - when /messages succeeds directly,
                // the response is already in the correct format
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(chunk) => {
                            if !eta_emitted && sse_chunk_has_visible_content(&chunk) {
                                eta_emitted = true;
                                emit_ttft_timing(&ttft_app, "etaFirstToken");
                            }
                            if sender.send_data(chunk).await.is_err() {
                                log::debug!("Client disconnected during streaming");
                                break;
                            }
                        }
                        Err(e) => {
                            log::error!("Stream error: {e}");
                            break;
                        }
                    }
                }
                log::debug!("Streaming complete to client");
            });

            Ok(builder.body(body).unwrap())
        }
        Err(e) => {
            state.error_kind = Some(unreachable_error_kind(state.backend));
            let error_msg = format!("Proxy request to model failed: {e}");
            // WS1.4: warn! (not error!) — a refused/failed proxy connection is a
            // downstream symptom of the model server not being up, not a root-cause
            // crash, so it must not flood the SentryLogger bridge. The PostHog
            // error_kind above still records it for analytics.
            log::warn!("{error_msg}");
            // ATO-182: A transport error reaching a *local* model server means
            // the backend inference process is down / crashed / not yet
            // listening — distinct from a real upstream 500. Map it to 503
            // (temporarily unavailable, retriable) with a structured OpenAI
            // error envelope + Retry-After, instead of an opaque 502 plaintext
            // line. Remote-provider transport failures keep 502 (a genuine
            // gateway-to-upstream error).
            let (status, code) = if is_local_backend(state.backend) {
                (StatusCode::SERVICE_UNAVAILABLE, "backend_unavailable")
            } else {
                (StatusCode::BAD_GATEWAY, "upstream_unreachable")
            };
            let body = structured_error_json(
                &format!("The model backend is not reachable: {e}"),
                "server_error",
                code,
            );
            let mut error_response = Response::builder()
                .status(status)
                .header(hyper::header::CONTENT_TYPE, "application/json");
            if status == StatusCode::SERVICE_UNAVAILABLE {
                error_response = error_response.header(hyper::header::RETRY_AFTER, "1");
            }
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            Ok(error_response.body(Body::from(body)).unwrap())
        }
    }
}

fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    _host: &str,
    origin: &str,
    trusted_hosts: &[Vec<String>],
) -> hyper::http::response::Builder {
    let mut builder = builder;

    let origin_trusted = if !origin.is_empty() {
        let origin_host = extract_host_from_origin(origin);
        is_valid_host(&origin_host, trusted_hosts)
    } else {
        false
    };

    builder = builder
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    if origin_trusted {
        builder = builder
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Credentials", "true");
    } else {
        log::warn!("CORS: Origin '{}' is not trusted, not reflecting origin", origin);
    }

    builder
}

pub async fn is_server_running(server_handle: Arc<Mutex<Option<ServerHandle>>>) -> bool {
    let handle_guard = server_handle.lock().await;
    handle_guard.is_some()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_server<R: Runtime>(
    app_handle: AppHandle<R>,
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    auto_increase_state: Arc<AutoIncreaseState>,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    start_server_internal(
        app_handle,
        server_handle,
        sessions,
        sessions_upstream,
        mlx_sessions,
        host,
        port,
        prefix,
        proxy_api_key,
        trusted_hosts,
        proxy_timeout,
        provider_configs,
        auto_increase_state,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn start_server_internal<R: Runtime>(
    app_handle: AppHandle<R>,
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    sessions_upstream: Arc<Mutex<HashMap<i32, LLamaUpstreamBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    auto_increase_state: Arc<AutoIncreaseState>,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;
    if handle_guard.is_some() {
        return Err("Server is already running".into());
    }

    let requested_addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    // ATO-112 / ATO-189: surface local-server bind failures (e.g. the requested
    // port is already in use) as analytics. Cloned up front because `app_handle`
    // is later moved into `make_svc`.
    let app_handle_for_bind = app_handle.clone();

    // ATO-189: bind a std `TcpListener` ourselves so we can (a) transparently
    // fall back to an OS-assigned free port when the requested port is already
    // in use (another app instance or a third-party process holding 1337 →
    // EADDRINUSE / Windows WSAEADDRINUSE 10048), and (b) learn the actual bound
    // port *before* building the proxy config / spawning the server. The actual
    // port is returned to the caller, which persists it and surfaces the real
    // URL to the user.
    let listener = match std::net::TcpListener::bind(requested_addr) {
        Ok(listener) => listener,
        Err(e) if port != 0 && e.kind() == std::io::ErrorKind::AddrInUse => {
            log::warn!(
                "Local API Server port {port} on {host} is already in use; \
                 falling back to an OS-assigned free port"
            );
            let fallback_addr: SocketAddr = format!("{host}:0")
                .parse()
                .map_err(|e| format!("Invalid address: {e}"))?;
            match std::net::TcpListener::bind(fallback_addr) {
                Ok(listener) => listener,
                Err(e) => {
                    log::error!("Failed to bind a fallback port on {host}: {e}");
                    emit_server_bind_failed(&app_handle_for_bind);
                    return Err(Box::new(e));
                }
            }
        }
        Err(e) => {
            log::error!("Failed to bind to {requested_addr}: {e}");
            emit_server_bind_failed(&app_handle_for_bind);
            return Err(Box::new(e));
        }
    };

    let bound_addr = listener.local_addr()?;
    let actual_port = bound_addr.port();

    let config = ProxyConfig {
        prefix,
        proxy_api_key,
        trusted_hosts,
        host: host.clone(),
        port: actual_port,
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let local_client = Client::builder()
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .no_proxy()
        .build()?;

    let make_svc = make_service_fn(move |_conn| {
        let client = client.clone();
        let local_client = local_client.clone();
        let config = config.clone();
        let sessions = sessions.clone();
        let sessions_upstream = sessions_upstream.clone();
        let mlx_sessions = mlx_sessions.clone();
        let provider_configs = provider_configs.clone();
        let auto_increase_state = auto_increase_state.clone();
        let app_handle = app_handle.clone();

        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                proxy_request(
                    req,
                    client.clone(),
                    local_client.clone(),
                    config.clone(),
                    sessions.clone(),
                    sessions_upstream.clone(),
                    mlx_sessions.clone(),
                    provider_configs.clone(),
                    auto_increase_state.clone(),
                    app_handle.clone(),
                )
            }))
        }
    });

    let server = match Server::from_tcp(listener) {
        Ok(builder) => builder.serve(make_svc),
        Err(e) => {
            log::error!("Failed to start server on {bound_addr}: {e}");
            emit_server_bind_failed(&app_handle_for_bind);
            return Err(Box::new(e));
        }
    };
    log::info!("Atomic Chat API server started on http://{bound_addr}");

    let server_task = tokio::spawn(async move {
        if let Err(e) = server.await {
            log::error!("Server error: {e}");
            return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
        }
        Ok(())
    });

    *handle_guard = Some(server_task);
    log::info!("Atomic Chat API server started successfully on port {actual_port}");
    Ok(actual_port)
}

pub async fn stop_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.abort();
        *handle_guard = None;
        log::info!("Atomic Chat API server stopped");
    } else {
        log::debug!("Server was not running");
    }

    Ok(())
}

/// Helper to format an Anthropic SSE event with proper event type and delimiters
fn sse_event(data: &serde_json::Value) -> Bytes {
    let event_type = data
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("message");
    Bytes::from(format!("event: {event_type}\ndata: {data}\n\n"))
}

/// Transform and forward streaming OpenAI response as Anthropic /messages chunks.
/// Handles both text content and tool_calls streaming.
async fn transform_and_forward_stream<S>(
    mut stream: S,
    mut sender: hyper::body::Sender,
    _destination_path: &str,
) where
    S: futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    let mut is_first = true;
    let mut accumulated_content = String::new();

    // Track active Anthropic content blocks
    let mut text_block_index: Option<usize> = None;
    let mut tool_blocks: HashMap<usize, usize> = HashMap::new(); // OAI tool index -> Anthropic block index
    let mut next_block_index: usize = 0;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = String::from_utf8_lossy(&chunk);

                for line in chunk_str.lines() {
                    if !line.starts_with("data:") {
                        continue;
                    }
                    let data = line.trim_start_matches("data:").trim();

                    if data == "[DONE]" {
                        // Close any remaining open blocks
                        if let Some(idx) = text_block_index.take() {
                            let stop =
                                serde_json::json!({"type": "content_block_stop", "index": idx});
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }
                        let mut tool_indices: Vec<usize> = tool_blocks.values().copied().collect();
                        tool_indices.sort();
                        for idx in tool_indices {
                            let stop =
                                serde_json::json!({"type": "content_block_stop", "index": idx});
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        let stop_reason = if tool_blocks.is_empty() {
                            "end_turn"
                        } else {
                            "tool_use"
                        };
                        let output_tokens = accumulated_content.split_whitespace().count() as u64;

                        let delta_event = serde_json::json!({
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stop_reason,
                                "stop_sequence": serde_json::Value::Null
                            },
                            "usage": { "output_tokens": output_tokens }
                        });
                        if sender.send_data(sse_event(&delta_event)).await.is_err() {
                            return;
                        }

                        let final_stop = serde_json::json!({"type": "message_stop"});
                        if sender.send_data(sse_event(&final_stop)).await.is_err() {
                            return;
                        }
                        log::debug!("Sent Anthropic final events");
                        return;
                    }

                    let json_chunk = match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let choice = json_chunk
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|c| c.first());
                    let delta = match choice.and_then(|c| c.get("delta")) {
                        Some(d) => d,
                        None => continue,
                    };
                    let finish_reason = choice.and_then(|c| c.get("finish_reason"));
                    let has_finish = finish_reason.is_some() && !finish_reason.unwrap().is_null();

                    // First chunk: send message_start
                    if is_first {
                        let role = delta
                            .get("role")
                            .and_then(|r| r.as_str())
                            .unwrap_or("assistant");
                        let message_id = json_chunk
                            .get("id")
                            .unwrap_or(&serde_json::json!(""))
                            .clone();
                        let model = json_chunk
                            .get("model")
                            .unwrap_or(&serde_json::json!(""))
                            .clone();

                        let start_event = serde_json::json!({
                            "type": "message_start",
                            "message": {
                                "id": message_id,
                                "type": "message",
                                "role": role,
                                "content": [],
                                "model": model,
                                "stop_reason": serde_json::Value::Null,
                                "stop_sequence": serde_json::Value::Null,
                                "usage": { "input_tokens": 0, "output_tokens": 0 }
                            }
                        });
                        if sender.send_data(sse_event(&start_event)).await.is_err() {
                            return;
                        }
                        is_first = false;
                    }

                    // Handle text content
                    if let Some(text) =
                        delta
                            .get("content")
                            .and_then(|c| if c.is_null() { None } else { c.as_str() })
                    {
                        if !text.is_empty() {
                            // Open text block if needed
                            if text_block_index.is_none() {
                                let idx = next_block_index;
                                next_block_index += 1;
                                text_block_index = Some(idx);

                                let block_start = serde_json::json!({
                                    "type": "content_block_start",
                                    "index": idx,
                                    "content_block": { "type": "text", "text": "" }
                                });
                                if sender.send_data(sse_event(&block_start)).await.is_err() {
                                    return;
                                }
                            }

                            accumulated_content.push_str(text);
                            let delta_event = serde_json::json!({
                                "type": "content_block_delta",
                                "index": text_block_index.unwrap(),
                                "delta": { "type": "text_delta", "text": text }
                            });
                            if sender.send_data(sse_event(&delta_event)).await.is_err() {
                                return;
                            }
                        }
                    }

                    // Handle tool calls
                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                        // Close text block before tool blocks
                        if let Some(idx) = text_block_index.take() {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        for tc in tool_calls {
                            let tc_index =
                                tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

                            // New tool call (has id + function.name)
                            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                let name = tc
                                    .get("function")
                                    .and_then(|f| f.get("name"))
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("");

                                let idx = next_block_index;
                                next_block_index += 1;
                                tool_blocks.insert(tc_index, idx);

                                let block_start = serde_json::json!({
                                    "type": "content_block_start",
                                    "index": idx,
                                    "content_block": {
                                        "type": "tool_use",
                                        "id": id,
                                        "name": name,
                                        "input": {}
                                    }
                                });
                                if sender.send_data(sse_event(&block_start)).await.is_err() {
                                    return;
                                }
                            }

                            // Argument delta
                            if let Some(args) = tc
                                .get("function")
                                .and_then(|f| f.get("arguments"))
                                .and_then(|a| a.as_str())
                            {
                                if !args.is_empty() {
                                    if let Some(&idx) = tool_blocks.get(&tc_index) {
                                        let delta_event = serde_json::json!({
                                            "type": "content_block_delta",
                                            "index": idx,
                                            "delta": {
                                                "type": "input_json_delta",
                                                "partial_json": args
                                            }
                                        });
                                        if sender.send_data(sse_event(&delta_event)).await.is_err()
                                        {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Handle finish
                    if has_finish {
                        // Close text block
                        if let Some(idx) = text_block_index.take() {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }
                        // Close all tool blocks
                        let mut tool_indices: Vec<usize> = tool_blocks.values().copied().collect();
                        tool_indices.sort();
                        for idx in tool_indices {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        let reason = finish_reason
                            .and_then(|fr| fr.as_str())
                            .unwrap_or("end_turn");
                        let stop_reason = match reason {
                            "stop" => "end_turn",
                            "length" => "max_tokens",
                            "tool_calls" => "tool_use",
                            _ => reason,
                        };
                        let output_tokens = accumulated_content.split_whitespace().count() as u64;

                        let delta_event = serde_json::json!({
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stop_reason,
                                "stop_sequence": serde_json::Value::Null
                            },
                            "usage": { "output_tokens": output_tokens }
                        });
                        if sender.send_data(sse_event(&delta_event)).await.is_err() {
                            return;
                        }

                        let final_stop = serde_json::json!({"type": "message_stop"});
                        if sender.send_data(sse_event(&final_stop)).await.is_err() {
                            return;
                        }
                        return;
                    }
                }
            }
            Err(e) => {
                log::error!("Stream error: {e}");
                break;
            }
        }
    }
    log::debug!("Streaming complete (Anthropic format)");
}

/// Forward non-streaming OpenAI response as Anthropic /messages response
async fn forward_non_streaming(
    response_body: Result<Bytes, reqwest::Error>,
    mut sender: hyper::body::Sender,
    destination_path: &str,
) {
    let bytes = match response_body {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("Failed to get response body: {e}");
            return;
        }
    };

    if let Ok(json_response) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if destination_path == "/messages" {
            // Transform to Anthropic format
            let anthropic_response = transform_openai_response_to_anthropic(&json_response);
            if sender
                .send_data(Bytes::from(anthropic_response.to_string()))
                .await
                .is_err()
            {
                log::debug!("Client disconnected");
            }
        } else {
            // Pass through as-is
            if sender.send_data(bytes).await.is_err() {
                log::debug!("Client disconnected");
            }
        }
    } else {
        // Pass through raw response
        if sender.send_data(bytes).await.is_err() {
            log::debug!("Client disconnected");
        }
    }
}

#[cfg(test)]
mod auto_increase_ctx_tests {
    use super::*;

    // --- is_context_limit_error -------------------------------------------------

    #[test]
    fn detects_llama_cpp_ctx_overflow_500() {
        // Realistic body from llama-server when the prompt overshoots n_ctx.
        let body = r#"{"error":{"code":500,"message":"the request exceeds the available context size. Try increasing context size or enable context shift","type":"server_error"}}"#;
        assert!(is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, body));
    }

    #[test]
    fn detects_llama_cpp_ctx_overflow_400() {
        let body = r#"{"error":{"message":"prompt is too long for the current context length","type":"invalid_request_error"}}"#;
        assert!(is_context_limit_error(StatusCode::BAD_REQUEST, body));
    }

    #[test]
    fn detects_mlx_ctx_overflow_500() {
        // Legacy dflash mlx-server surface: still in the wild on user
        // machines until they upgrade to the new mlx-vlm binary.
        let body = r#"{"detail":"Context size exceeded: requested 9000 tokens but the model only supports 8192."}"#;
        assert!(is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, body));
    }

    #[test]
    fn detects_mlxvlm_kv_overflow_500() {
        // mlx-vlm wraps generation errors as `Generation failed: ...`.
        // The inner phrasing typically references the KV cache rather than
        // the word "context"; classify those too so auto-increase-ctx still
        // fires on the new backend.
        let body = r#"{"detail":"Generation failed: kv cache exceeded max_kv_size=8192"}"#;
        assert!(is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, body));
    }

    #[test]
    fn detects_mlxvlm_max_kv_size_500() {
        let body = r#"{"detail":"Generation failed: requested tokens exceed max-kv-size limit"}"#;
        assert!(is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, body));
    }

    #[test]
    fn detects_ui_canonical_phrase() {
        // web-app/src/utils/error.ts OUT_OF_CONTEXT_SIZE
        let body = "the request exceeds the available context size.";
        assert!(is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, body));
    }

    #[test]
    fn detects_503_context_overflow() {
        let body = r#"{"error":"context window overflow"}"#;
        assert!(is_context_limit_error(StatusCode::SERVICE_UNAVAILABLE, body));
    }

    #[test]
    fn ignores_unrelated_5xx() {
        // "context" alone is not enough — must also mention size/length/etc.
        let body = r#"{"error":"server shutting down: context canceled"}"#;
        assert!(!is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, body));
    }

    #[test]
    fn ignores_413_without_context_keyword() {
        let body = r#"{"error":"payload too large"}"#;
        assert!(!is_context_limit_error(StatusCode::PAYLOAD_TOO_LARGE, body));
    }

    #[test]
    fn ignores_200_even_with_matching_body() {
        // Successful responses must never be classified as ctx errors; the
        // finish_reason=length path handles those.
        let body = "context size exceeded";
        assert!(!is_context_limit_error(StatusCode::OK, body));
    }

    #[test]
    fn ignores_401_403_404() {
        let body = "context size exceeded";
        for code in [
            StatusCode::UNAUTHORIZED,
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND,
        ] {
            assert!(!is_context_limit_error(code, body), "should ignore {code}");
        }
    }

    // --- ATO-182 structured backend error mapping ------------------------------

    #[test]
    fn structured_error_json_shape() {
        let body = structured_error_json("boom", "server_error", "backend_unavailable");
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["error"]["message"], "boom");
        assert_eq!(v["error"]["type"], "server_error");
        assert_eq!(v["error"]["code"], "backend_unavailable");
    }

    #[test]
    fn detects_already_structured_error_body() {
        let body = r#"{"error":{"code":500,"message":"x","type":"server_error"}}"#;
        assert!(is_structured_error_body(body));
        // plaintext / mlx `{"detail":...}` / empty are not structured envelopes
        assert!(!is_structured_error_body("Failed to read error body: connection reset"));
        assert!(!is_structured_error_body(r#"{"detail":"Generation failed: ..."}"#));
        assert!(!is_structured_error_body(""));
    }

    #[test]
    fn error_code_for_prioritizes_ctx_overflow_then_oom() {
        assert_eq!(error_code_for(true, true), "context_length_exceeded");
        assert_eq!(error_code_for(false, true), "context_length_exceeded");
        assert_eq!(error_code_for(true, false), "insufficient_memory");
        assert_eq!(error_code_for(false, false), "server_error");
    }

    #[test]
    fn structure_backend_error_body_passes_through_structured() {
        let body = r#"{"error":{"code":500,"message":"keep me","type":"server_error"}}"#;
        // Already structured → forwarded byte-for-byte.
        assert_eq!(structure_backend_error_body(body, false, false), body);
    }

    #[test]
    fn structure_backend_error_body_wraps_mlx_detail_with_ctx_code() {
        // mlx-vlm `{"detail": ...}` is not an `{"error": {...}}` envelope, so we
        // wrap it. The original text must be preserved so the UI ctx matcher
        // still fires.
        let raw = r#"{"detail":"Generation failed: kv cache exceeded max_kv_size=8192"}"#;
        let wrapped = structure_backend_error_body(raw, false, true);
        let v: serde_json::Value = serde_json::from_str(&wrapped).unwrap();
        assert_eq!(v["error"]["code"], "context_length_exceeded");
        assert_eq!(v["error"]["type"], "invalid_request_error");
        let msg = v["error"]["message"].as_str().unwrap();
        assert!(msg.contains("max_kv_size"));
        assert!(is_context_limit_error(StatusCode::INTERNAL_SERVER_ERROR, &wrapped));
    }

    #[test]
    fn structure_backend_error_body_wraps_plaintext_as_server_error() {
        let raw = "Failed to read error body: connection reset by peer";
        let wrapped = structure_backend_error_body(raw, false, false);
        let v: serde_json::Value = serde_json::from_str(&wrapped).unwrap();
        assert_eq!(v["error"]["code"], "server_error");
        assert_eq!(v["error"]["type"], "server_error");
        assert_eq!(v["error"]["message"], raw);
    }

    #[test]
    fn structure_backend_error_body_wraps_oom_with_oom_code() {
        let raw = "ggml_cuda: CUDA_ERROR_OUT_OF_MEMORY: failed to allocate";
        let wrapped = structure_backend_error_body(raw, true, false);
        let v: serde_json::Value = serde_json::from_str(&wrapped).unwrap();
        assert_eq!(v["error"]["code"], "insufficient_memory");
    }

    // --- is_compute_backend_error (ATO-197) ------------------------------------

    #[test]
    fn detects_metal_compute_error_body() {
        // The exact body llama-server returns on a Metal OOM during prefill.
        let body = r#"{"error":{"code":500,"message":"Compute error","type":"server_error"}}"#;
        assert!(is_compute_backend_error(StatusCode::INTERNAL_SERVER_ERROR, body));
        // Other decode/compute phrasings.
        assert!(is_compute_backend_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "llama_decode: failed to decode, ret = -3"
        ));
        assert!(is_compute_backend_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "process_ubatch: failed to compute graph, compute status: -1"
        ));
        assert!(is_compute_backend_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend is in error state from a previous command buffer failure"
        ));
    }

    #[test]
    fn ignores_non_compute_errors() {
        // Only 500s are fatal-compute candidates.
        assert!(!is_compute_backend_error(StatusCode::BAD_REQUEST, "Compute error"));
        assert!(!is_compute_backend_error(StatusCode::OK, "Compute error"));
        // Unrelated 500 bodies must not match.
        assert!(!is_compute_backend_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server error"
        ));
        assert!(!is_compute_backend_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":{"message":"the request exceeds the available context size."}}"#
        ));
    }

    #[test]
    fn compute_error_envelope_is_structured_oom() {
        for oom in [true, false] {
            let env = compute_error_envelope(oom);
            let v: serde_json::Value = serde_json::from_str(&env).unwrap();
            assert_eq!(v["error"]["code"], "insufficient_memory");
            let msg = v["error"]["message"].as_str().unwrap().to_lowercase();
            // The message must read as out-of-memory so the UI matcher fires and
            // the user gets actionable guidance instead of "Compute error".
            assert!(msg.contains("out of memory"));
            assert!(msg.contains("smaller"));
        }
    }

    // --- is_context_overflow_finish_length -------------------------------------

    #[test]
    fn triggers_when_no_client_max_tokens_and_length() {
        let resp = br#"{
            "choices":[{"index":0,"finish_reason":"length"}],
            "usage":{"prompt_tokens":7000,"completion_tokens":1000,"total_tokens":8000}
        }"#;
        let req = br#"{"model":"m","messages":[]}"#;
        assert!(is_context_overflow_finish_length(resp, Some(req)));
    }

    #[test]
    fn triggers_when_request_body_missing() {
        // No buffered request body at all → treat as "no client cap".
        let resp = br#"{"choices":[{"finish_reason":"length"}]}"#;
        assert!(is_context_overflow_finish_length(resp, None));
    }

    #[test]
    fn skips_when_completion_hits_client_max_tokens() {
        let resp = br#"{
            "choices":[{"finish_reason":"length"}],
            "usage":{"prompt_tokens":10,"completion_tokens":16,"total_tokens":26}
        }"#;
        let req = br#"{"max_tokens":16,"messages":[]}"#;
        assert!(!is_context_overflow_finish_length(resp, Some(req)));
    }

    #[test]
    fn skips_when_completion_hits_max_completion_tokens_alias() {
        // Newer OpenAI SDKs use `max_completion_tokens` for reasoning models.
        let resp = br#"{
            "choices":[{"finish_reason":"length"}],
            "usage":{"prompt_tokens":10,"completion_tokens":32,"total_tokens":42}
        }"#;
        let req = br#"{"max_completion_tokens":32,"messages":[]}"#;
        assert!(!is_context_overflow_finish_length(resp, Some(req)));
    }

    #[test]
    fn triggers_when_cap_set_but_completion_below_cap() {
        // finish_reason=length with completion_tokens well under max_tokens
        // ⇒ generation stopped because ctx filled up, not the client cap.
        let resp = br#"{
            "choices":[{"finish_reason":"length"}],
            "usage":{"prompt_tokens":7900,"completion_tokens":200,"total_tokens":8100}
        }"#;
        let req = br#"{"max_tokens":4096,"messages":[]}"#;
        assert!(is_context_overflow_finish_length(resp, Some(req)));
    }

    #[test]
    fn ignores_finish_reason_stop() {
        let resp = br#"{"choices":[{"finish_reason":"stop"}]}"#;
        assert!(!is_context_overflow_finish_length(resp, None));
    }

    #[test]
    fn ignores_malformed_json() {
        assert!(!is_context_overflow_finish_length(b"not json", None));
    }

    #[test]
    fn ignores_empty_choices() {
        let resp = br#"{"choices":[]}"#;
        assert!(!is_context_overflow_finish_length(resp, None));
    }

    #[test]
    fn ignores_missing_finish_reason() {
        let resp = br#"{"choices":[{"index":0}]}"#;
        assert!(!is_context_overflow_finish_length(resp, None));
    }

    #[test]
    fn skips_when_cap_set_and_completion_tokens_missing() {
        // Without usage data we can't distinguish client-cap from ctx-limit,
        // so we err on the side of NOT touching ctx.
        let resp = br#"{"choices":[{"finish_reason":"length"}]}"#;
        let req = br#"{"max_tokens":16,"messages":[]}"#;
        assert!(!is_context_overflow_finish_length(resp, Some(req)));
    }

    // --- acquire/release slot --------------------------------------------------

    #[tokio::test]
    async fn acquire_slot_is_leader_once_per_model() {
        let state = AutoIncreaseState::default();
        let (_n1, leader1) = acquire_auto_increase_slot(&state, "llama-7b").await;
        let (_n2, leader2) = acquire_auto_increase_slot(&state, "llama-7b").await;
        assert!(leader1, "first caller must be leader");
        assert!(!leader2, "second caller must wait");

        // Different model should get its own leader slot.
        let (_n3, leader3) = acquire_auto_increase_slot(&state, "mlx-other").await;
        assert!(leader3);
    }

    #[tokio::test]
    async fn release_slot_wakes_waiters_and_allows_new_leader() {
        let state = AutoIncreaseState::default();
        let (notify, _) = acquire_auto_increase_slot(&state, "qwen").await;
        release_auto_increase_slot(&state, "qwen", &notify).await;
        // After release the next caller becomes leader again.
        let (_n2, leader2) = acquire_auto_increase_slot(&state, "qwen").await;
        assert!(leader2);
    }

    #[tokio::test]
    async fn store_and_read_outcome_roundtrip() {
        let state = AutoIncreaseState::default();
        store_auto_increase_outcome(
            &state,
            "m1",
            AutoIncreaseOutcome {
                ok: true,
                new_ctx_len: Some(16384),
                reason: None,
            },
        )
        .await;
        let got = read_auto_increase_outcome(&state, "m1").await.unwrap();
        assert!(got.ok);
        assert_eq!(got.new_ctx_len, Some(16384));
    }
}
