use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use jan_utils::{extract_host_from_origin, is_cors_header, is_valid_host, remove_prefix};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_llamacpp::LLamaBackendSession;
use tokio::sync::Mutex;

use crate::core::{
    mcp::models::McpSettings,
    state::{ProviderConfig, ServerHandle, SharedMcpServers},
};

/// Some OpenAI tool schema generators (and some MCP servers) may emit schemas where
/// a property schema only contains `description` but omits `type`.
///
/// A strict JSON schema converter inside the upstream server rejects those schemas.
/// To be robust, we default `type` to `"string"` for description-only leaf schemas.
/// Keep this behavior aligned with `normalizeToolInputSchema` in the frontend.
pub(crate) fn normalize_openai_tool_parameters_schema(schema: &mut serde_json::Value) {
    match schema {
        serde_json::Value::Object(map) => {
            let has_description = map.contains_key("description");
            let has_type = map.contains_key("type");
            let is_object_type = map.get("type").and_then(|v| v.as_str()) == Some("object");
            let has_nested_schema_keywords = map.contains_key("properties")
                || map.contains_key("items")
                || map.contains_key("anyOf")
                || map.contains_key("oneOf")
                || map.contains_key("allOf")
                || map.contains_key("$ref");

            if is_object_type && !map.contains_key("properties") {
                map.insert(
                    "properties".to_string(),
                    serde_json::Value::Object(serde_json::Map::new()),
                );
            }

            // Only patch leaf nodes (description without `type` AND without nested schema keywords).
            if has_description && !has_type && !has_nested_schema_keywords {
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String("string".to_string()),
                );
            }

            // Recurse into nested schema (properties, items, anyOf, etc.) in one pass.
            for v in map.values_mut() {
                normalize_openai_tool_parameters_schema(v);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                normalize_openai_tool_parameters_schema(v);
            }
        }
        _ => {}
    }
}

fn normalize_openai_tools_in_chat_body(body: &mut serde_json::Value) {
    let tools = match body.get_mut("tools") {
        Some(t) => t,
        None => return,
    };

    let tools_arr = match tools.as_array_mut() {
        Some(a) => a,
        None => return,
    };

    for tool in tools_arr.iter_mut() {
        let function = match tool.get_mut("function") {
            Some(f) => f,
            None => continue,
        };
        let parameters = match function.get_mut("parameters") {
            Some(p) => p,
            None => continue,
        };

        normalize_openai_tool_parameters_schema(parameters);
    }
}

fn http_status_indicates_api_key_retry(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS
    )
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
    pub enable_server_tool_execution: bool,
}

/// Determines the final destination path based on the original request path
pub fn get_destination_path(original_path: &str, prefix: &str) -> String {
    remove_prefix(original_path, prefix)
}

use tauri_plugin_mlx::state::{MlxBackendSession, SessionInfo};

use rmcp::model::{CallToolRequestParam, CallToolResult};

fn assistant_json_path(jan_data_folder: &str, assistant_id: &str) -> PathBuf {
    PathBuf::from(jan_data_folder)
        .join("assistants")
        .join(assistant_id)
        .join("assistant.json")
}

fn load_assistant_config(
    jan_data_folder: &str,
    assistant_id: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let assistant_path = assistant_json_path(jan_data_folder, assistant_id);
    let raw = fs::read_to_string(&assistant_path)
        .map_err(|e| format!("Failed to read assistant.json: {assistant_path:?}: {e}"))?;

    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid assistant.json ({assistant_id}): {e}"))?;

    let instructions = parsed
        .get("instructions")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let model = parsed
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok((instructions, model))
}

fn parse_openai_messages(messages: &serde_json::Value) -> Result<Vec<serde_json::Value>, String> {
    let arr = messages
        .as_array()
        .ok_or("Request body must include 'messages' as an array")?;

    let mut out = Vec::with_capacity(arr.len());
    for msg in arr {
        let role = msg
            .get("role")
            .and_then(|v| v.as_str())
            .ok_or("Each message must include a string 'role'")?;
        let content = msg
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or("Each message must include 'content' as a string")?;

        // Keep upstream format minimal and predictable.
        out.push(serde_json::json!({
            "role": role,
            "content": content
        }));
    }
    Ok(out)
}

fn set_system_prompt(messages: &mut Vec<serde_json::Value>, system_prompt: &str) {
    messages.retain(|m| m.get("role").and_then(|r| r.as_str()) != Some("system"));
    messages.insert(
        0,
        serde_json::json!({
            "role": "system",
            "content": system_prompt
        }),
    );
}

fn extract_tool_calls(response: &serde_json::Value) -> Vec<serde_json::Value> {
    response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default()
}

fn extract_choice_message(response: &serde_json::Value) -> Option<&serde_json::Value> {
    response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
}

fn mcp_call_result_to_string(result: &CallToolResult) -> String {
    let parts: Vec<String> = result
        .content
        .iter()
        .filter_map(|c| c.as_text())
        .map(|t| t.text.clone())
        .collect();

    if result.is_error == Some(true) {
        if parts.is_empty() {
            "ERROR".to_string()
        } else {
            format!("ERROR: {}", parts.join("\n"))
        }
    } else {
        parts.join("\n")
    }
}

async fn resolve_upstream_for_model(
    model_id: &str,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
) -> Result<(String, Vec<String>), String> {
    let destination_path = "/chat/completions";

    // Prefer remote provider if model is registered there.
    let pc = provider_configs.lock().await;
    let provider_name = pc
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

    if let Some(provider) = provider_name {
        let pc2 = provider_configs.lock().await;
        if let Some(provider_cfg) = pc2.get(provider.as_str()).cloned() {
            let api_url = provider_cfg
                .base_url
                .clone()
                .ok_or_else(|| format!("Missing base_url for provider '{provider}'"))?;
            let url = format!("{}{}", api_url, destination_path);
            return Ok((url, provider_cfg.bearer_key_chain()));
        }
    }

    // Fall back to local sessions.
    let sessions_guard = sessions.lock().await;
    if let Some(session) = sessions_guard
        .values()
        .find(|s| s.info.model_id == model_id)
    {
        let target_port = session.info.port;
        return Ok((
            format!("http://127.0.0.1:{target_port}/v1{destination_path}"),
            vec![session.info.api_key.clone()],
        ));
    }
    drop(sessions_guard);

    let mlx_guard = mlx_sessions.lock().await;
    if let Some(info) = mlx_guard.values().find(|s| s.info.model_id == model_id) {
        let target_port = info.info.port;
        return Ok((
            format!("http://127.0.0.1:{target_port}/v1{destination_path}"),
            vec![info.info.api_key.clone()],
        ));
    }

    Err(format!("No upstream session found for model '{model_id}'"))
}

fn copy_optional_chat_params(
    from: &serde_json::Value,
    into: &mut serde_json::Map<String, serde_json::Value>,
) {
    for key in [
        "temperature",
        "top_p",
        "top_k",
        "max_tokens",
        "stop_sequences",
        "stop",
        "frequency_penalty",
        "presence_penalty",
    ] {
        if let Some(v) = from.get(key) {
            into.insert(key.to_string(), v.clone());
        }
    }
}

async fn collect_mcp_openai_tools(
    mcp_servers: &SharedMcpServers,
    mcp_settings: &Arc<Mutex<McpSettings>>,
) -> Result<(Vec<serde_json::Value>, HashMap<String, String>), String> {
    let timeout_duration = mcp_settings.lock().await.tool_call_timeout_duration();
    let servers = mcp_servers.lock().await;

    let mut openai_tools = Vec::new();
    let mut tool_to_server: HashMap<String, String> = HashMap::new();

    for (server_name, service) in servers.iter() {
        let tools_future = service.list_all_tools();
        let tools = match tokio::time::timeout(timeout_duration, tools_future).await {
            Ok(Ok(tools)) => tools,
            Ok(Err(e)) => {
                log::warn!("MCP server {} failed to list tools: {}", server_name, e);
                continue;
            }
            Err(_) => {
                log::warn!(
                    "Listing MCP tools timed out after {} seconds on server {}",
                    timeout_duration.as_secs(),
                    server_name
                );
                continue;
            }
        };

        for tool in tools {
            tool_to_server.insert(tool.name.to_string(), server_name.clone());

            // Normalize schemas before sending them to strict OpenAI-compatible providers.
            // The `get_tools` Tauri command still returns raw schemas; the frontend
            // normalizes those separately before provider registration.
            let mut parameters = serde_json::Value::Object((*tool.input_schema).clone());
            normalize_openai_tool_parameters_schema(&mut parameters);
            let description = tool
                .description
                .as_ref()
                .map(|d| d.to_string())
                .unwrap_or_default();

            openai_tools.push(serde_json::json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": description,
                    "parameters": parameters
                }
            }));
        }
    }

    Ok((openai_tools, tool_to_server))
}

async fn execute_mcp_tool_calls(
    tool_calls: &[serde_json::Value],
    tool_to_server: &HashMap<String, String>,
    mcp_servers: &SharedMcpServers,
    mcp_settings: &Arc<Mutex<McpSettings>>,
) -> Result<Vec<(String, String)>, String> {
    let timeout_duration = mcp_settings.lock().await.tool_call_timeout_duration();
    let servers = mcp_servers.lock().await;

    let mut results = Vec::with_capacity(tool_calls.len());

    for tc in tool_calls {
        let tool_call_id = tc
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = tc
            .get("function")
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let args_str = tc
            .get("function")
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
            .unwrap_or("{}");

        let args_value: serde_json::Value =
            serde_json::from_str(args_str).unwrap_or_else(|_| serde_json::json!({}));

        let args_map: serde_json::Map<String, serde_json::Value> =
            if let Some(obj) = args_value.as_object() {
                obj.clone()
            } else {
                serde_json::Map::new()
            };

        let server_name = tool_to_server
            .get(&tool_name)
            .ok_or_else(|| format!("No MCP server registered for tool '{tool_name}'"))?;

        let service = servers
            .get(server_name)
            .ok_or_else(|| format!("MCP server '{server_name}' not found in runtime state"))?;

        let tool_call = service.call_tool(CallToolRequestParam {
            name: tool_name.clone().into(),
            arguments: Some(args_map),
        });

        let result = match tokio::time::timeout(timeout_duration, tool_call).await {
            Ok(call_result) => call_result.map_err(|e| e.to_string()),
            Err(_) => Err(format!(
                "Tool call '{tool_name}' timed out after {} seconds",
                timeout_duration.as_secs()
            )),
        };

        let tool_result_string = match result {
            Ok(res) => mcp_call_result_to_string(&res),
            Err(e) => format!("ERROR: {e}"),
        };

        results.push((tool_call_id, tool_result_string));
    }

    Ok(results)
}

async fn call_openai_chat_completions(
    client: &Client,
    upstream_url: &str,
    api_keys: &[String],
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let attempts: Vec<Option<&str>> = if api_keys.is_empty() {
        vec![None]
    } else {
        api_keys.iter().map(|s| Some(s.as_str())).collect()
    };

    let mut last_err = String::new();
    for (i, key_ref) in attempts.iter().enumerate() {
        let mut req = client
            .post(upstream_url)
            .header("Content-Type", "application/json")
            .header("Accept-Encoding", "identity");

        if let Some(key) = key_ref {
            req = req.header("Authorization", format!("Bearer {key}"));
        }

        let resp = req
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Upstream request failed: {e}"))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if status.is_success() {
            return serde_json::from_str::<serde_json::Value>(&text)
                .map_err(|e| format!("Failed to parse upstream JSON: {e}. Body: {text}"));
        }

        last_err = format!("Upstream returned HTTP {status}: {text}");
        if http_status_indicates_api_key_retry(status) && i + 1 < attempts.len() {
            log::warn!("OpenAI completion: HTTP {status} with API key index {i}, trying next key");
            continue;
        }

        return Err(last_err);
    }

    Err(last_err)
}

async fn run_server_side_openai_orchestration(
    json_body: &serde_json::Value,
    client: &Client,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    jan_data_folder: &str,
) -> Result<serde_json::Value, String> {
    let messages_value = json_body
        .get("messages")
        .ok_or("Missing required field 'messages'")?;
    let mut conversation_messages = parse_openai_messages(messages_value)?;

    let assistant_id = json_body
        .get("assistant_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty());

    let (assistant_instructions, assistant_model_hint) = if let Some(assistant_id) = assistant_id {
        load_assistant_config(jan_data_folder, assistant_id)?
    } else {
        (None, None)
    };

    if let Some(sys) = assistant_instructions {
        set_system_prompt(&mut conversation_messages, &sys);
    }

    let model_override = json_body.get("model").and_then(|v| v.as_str());
    let mut model_id: Option<String> = model_override.map(|v| v.to_string());
    if model_id.is_none() {
        if let Some(h) = assistant_model_hint {
            let trimmed = h.trim();
            if !trimmed.is_empty() && trimmed != "*" {
                model_id = Some(trimmed.to_string());
            }
        }
    }
    if model_id.is_none() {
        let sessions_guard = sessions.lock().await;
        model_id = sessions_guard
            .values()
            .next()
            .map(|s| s.info.model_id.clone());
        drop(sessions_guard);
    }
    if model_id.is_none() {
        let mlx_guard = mlx_sessions.lock().await;
        model_id = mlx_guard.values().next().map(|s| s.info.model_id.clone());
    }
    let model_id = model_id.ok_or("No running model sessions available")?;

    let (openai_tools, tool_to_server) =
        collect_mcp_openai_tools(&mcp_servers, &mcp_settings).await?;

    let (upstream_url, session_api_keys) = resolve_upstream_for_model(
        &model_id,
        provider_configs.clone(),
        sessions.clone(),
        mlx_sessions.clone(),
    )
    .await?;

    let max_turns = json_body
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .unwrap_or(8)
        .clamp(1, 20) as usize;

    let mut last_response: Option<serde_json::Value> = None;

    for _turn in 0..max_turns {
        let mut completion_map = serde_json::Map::new();
        completion_map.insert("model".to_string(), serde_json::json!(model_id));
        completion_map.insert(
            "messages".to_string(),
            serde_json::Value::Array(conversation_messages.clone()),
        );
        completion_map.insert("stream".to_string(), serde_json::json!(false));
        completion_map.insert("tool_choice".to_string(), serde_json::json!("auto"));

        if !openai_tools.is_empty() {
            completion_map.insert(
                "tools".to_string(),
                serde_json::Value::Array(openai_tools.clone()),
            );
        }

        copy_optional_chat_params(json_body, &mut completion_map);
        let request_value = serde_json::Value::Object(completion_map);

        let completion =
            call_openai_chat_completions(client, &upstream_url, &session_api_keys, &request_value)
                .await?;

        let tool_calls = extract_tool_calls(&completion);
        last_response = Some(completion.clone());

        if tool_calls.is_empty() {
            return Ok(completion);
        }

        if let Some(choice_message) = extract_choice_message(&completion) {
            let assistant_content = choice_message
                .get("content")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            conversation_messages.push(serde_json::json!({
                "role": "assistant",
                "content": assistant_content,
                "tool_calls": tool_calls.clone()
            }));
        } else {
            conversation_messages.push(serde_json::json!({
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": tool_calls.clone()
            }));
        }

        let tool_results =
            execute_mcp_tool_calls(&tool_calls, &tool_to_server, &mcp_servers, &mcp_settings)
                .await?;

        for (tool_call_id, result_text) in tool_results {
            conversation_messages.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": result_text
            }));
        }
    }

    Err(format!(
        "max_turns reached while resolving tool calls; last_response={}",
        serde_json::to_string(&last_response.unwrap_or_else(|| serde_json::json!({})))
            .unwrap_or_else(|_| "{}".to_string())
    ))
}

/// Handles the proxy request logic
async fn proxy_request(
    req: Request<Body>,
    client: Client,
    config: ProxyConfig,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    jan_data_folder: String,
) -> Result<Response<Body>, hyper::Error> {
    if req.method() == hyper::Method::OPTIONS {
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
        let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
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
                .body(Body::from("Host not allowed"))
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
                log::warn!(
                    "CORS preflight: Origin '{origin}' is not trusted, not reflecting origin"
                );
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
        "/favicon.ico",
        "/docs/swagger-ui.css",
        "/docs/swagger-ui-bundle.js",
        "/docs/swagger-ui-standalone-preset.js",
    ];
    let is_whitelisted_path = whitelisted_paths.contains(&path.as_str());

    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(&host_header, &config.trusted_hosts) {
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from("Invalid host header"))
                    .unwrap());
            }
        } else {
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
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response.body(Body::from("Not Found")).unwrap());
    }

    let original_path = parts.uri.path();
    let destination_path = get_destination_path(original_path, &config.prefix);

    // Initialize variables that will be set in the match
    let mut session_api_keys: Vec<String> = Vec::new();
    #[allow(unused_assignments)]
    let mut buffered_body: Option<Bytes> = None;
    let mut target_base_url: Option<String> = None;
    let mut is_anthropic_messages = false;

    match (method.clone(), destination_path.as_str()) {
        // Anthropic /messages endpoint - tries /messages first, falls back to /chat/completions on error
        (hyper::Method::POST, "/messages") => {
            is_anthropic_messages = true;
            log::info!(
                "Handling POST request to /messages with chat/completions fallback on error",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
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
                    if config.enable_server_tool_execution
                        && !json_body
                            .get("stream")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    {
                        let openai_body = match transform_anthropic_to_openai(&json_body) {
                            Some(v) => v,
                            None => {
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
                                        "Invalid /messages payload for orchestration mode",
                                    ))
                                    .unwrap());
                            }
                        };

                        match run_server_side_openai_orchestration(
                            &openai_body,
                            &client,
                            provider_configs.clone(),
                            sessions.clone(),
                            mlx_sessions.clone(),
                            mcp_servers.clone(),
                            mcp_settings.clone(),
                            &jan_data_folder,
                        )
                        .await
                        {
                            Ok(openai_response) => {
                                let anthropic_response =
                                    transform_openai_response_to_anthropic(&openai_response);
                                let body_str = serde_json::to_string(&anthropic_response)
                                    .unwrap_or_else(|_| "{}".to_string());
                                let mut response_builder = Response::builder()
                                    .status(StatusCode::OK)
                                    .header(hyper::header::CONTENT_TYPE, "application/json");
                                response_builder = add_cors_headers_with_host_and_origin(
                                    response_builder,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(response_builder.body(Body::from(body_str)).unwrap());
                            }
                            Err(e) => {
                                let mut error_response =
                                    Response::builder().status(StatusCode::BAD_GATEWAY);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response.body(Body::from(e)).unwrap());
                            }
                        }
                    }

                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
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
                            let pc2 = provider_configs.lock().await;
                            let provider_config = pc2.get(p.as_str()).cloned();
                            drop(pc2);

                            if let Some(provider_cfg) = provider_config {
                                target_base_url = provider_cfg.base_url.clone().map(|url| {
                                    format!("{}{}", url.trim_end_matches('/'), "/messages")
                                });
                                session_api_keys = provider_cfg.bearer_key_chain();
                            }
                        } else {
                            // No remote provider, try local sessions
                            let sessions_guard = sessions.lock().await;
                            let llama_session = sessions_guard
                                .values()
                                .find(|s| s.info.model_id == model_id);

                            let mlx_session_info = {
                                let mlx_guard = mlx_sessions.lock().await;
                                mlx_guard
                                    .values()
                                    .find(|s| s.info.model_id == model_id)
                                    .map(|s| s.info.clone())
                            };

                            if let Some(session) = llama_session {
                                let target_port = session.info.port;
                                session_api_keys = vec![session.info.api_key.clone()];
                                target_base_url =
                                    Some(format!("http://127.0.0.1:{}/v1/messages", target_port));
                            } else if let Some(info) = mlx_session_info {
                                let target_port = info.port;
                                session_api_keys = vec![info.api_key.clone()];
                                target_base_url =
                                    Some(format!("http://127.0.0.1:{}/v1/messages", target_port));
                            } else {
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
        (hyper::Method::POST, "/orchestrations") => {
            // Headless orchestration endpoint:
            // - Load assistant system prompt + assistant model hint
            // - Ask the model for tool_calls
            // - Execute MCP tools server-side
            // - Feed tool results back and continue until completion
            log::info!(
                "Handling POST request to {destination_path} for assistant tool orchestration"
            );

            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
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

            let json_body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
                Ok(v) => v,
                Err(e) => {
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from(format!("Invalid JSON body: {e}")))
                        .unwrap());
                }
            };

            let assistant_id = json_body
                .get("assistant_id")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(|v| v.to_string());

            let stream = json_body
                .get("stream")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if stream {
                let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from(
                        "stream=true is not supported for /orchestrations",
                    ))
                    .unwrap());
            }

            let messages_value = match json_body.get("messages") {
                Some(v) => v,
                None => {
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Missing required field 'messages'"))
                        .unwrap());
                }
            };

            let mut conversation_messages = match parse_openai_messages(messages_value) {
                Ok(msgs) => msgs,
                Err(e) => {
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(Body::from(e)).unwrap());
                }
            };

            // Load assistant config for system prompt + model hint when assistant_id is provided.
            let (assistant_instructions, assistant_model_hint) =
                if let Some(assistant_id) = assistant_id.as_deref() {
                    match load_assistant_config(&jan_data_folder, assistant_id) {
                        Ok(v) => v,
                        Err(e) => {
                            let mut error_response =
                                Response::builder().status(StatusCode::BAD_REQUEST);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                &host_header,
                                &origin_header,
                                &config.trusted_hosts,
                            );
                            return Ok(error_response.body(Body::from(e)).unwrap());
                        }
                    }
                } else {
                    (None, None)
                };

            if let Some(sys) = assistant_instructions {
                set_system_prompt(&mut conversation_messages, &sys);
            }

            // Resolve model to use for orchestration.
            let model_override = json_body.get("model").and_then(|v| v.as_str());
            let mut model_id: Option<String> = None;

            if let Some(ov) = model_override {
                model_id = Some(ov.to_string());
            } else if let Some(h) = assistant_model_hint {
                let trimmed = h.trim();
                if !trimmed.is_empty() && trimmed != "*" {
                    model_id = Some(trimmed.to_string());
                } else {
                    // Fall back to the first available local session model.
                    let sessions_guard = sessions.lock().await;
                    if let Some(session) = sessions_guard.values().next() {
                        model_id = Some(session.info.model_id.clone());
                    }
                    drop(sessions_guard);

                    if model_id.is_none() {
                        let mlx_guard = mlx_sessions.lock().await;
                        model_id = mlx_guard.values().next().map(|s| s.info.model_id.clone());
                    }
                }
            } else {
                // Fall back to the first available local session model.
                let sessions_guard = sessions.lock().await;
                if let Some(session) = sessions_guard.values().next() {
                    model_id = Some(session.info.model_id.clone());
                }
                drop(sessions_guard);

                if model_id.is_none() {
                    let mlx_guard = mlx_sessions.lock().await;
                    model_id = mlx_guard.values().next().map(|s| s.info.model_id.clone());
                }
            }

            let model_id = match model_id {
                Some(v) => v,
                None => {
                    let mut error_response =
                        Response::builder().status(StatusCode::SERVICE_UNAVAILABLE);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("No running model sessions available"))
                        .unwrap());
                }
            };

            // Tool execution support (MCP only for now).
            let (openai_tools, tool_to_server) =
                match collect_mcp_openai_tools(&mcp_servers, &mcp_settings).await {
                    Ok(v) => v,
                    Err(e) => {
                        let mut error_response =
                            Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(e)).unwrap());
                    }
                };

            let (upstream_url, session_api_keys) = match resolve_upstream_for_model(
                &model_id,
                provider_configs.clone(),
                sessions.clone(),
                mlx_sessions.clone(),
            )
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(Body::from(e)).unwrap());
                }
            };

            let max_turns = json_body
                .get("max_turns")
                .and_then(|v| v.as_u64())
                .unwrap_or(8)
                .clamp(1, 20) as usize;

            let mut last_response: Option<serde_json::Value> = None;

            for _turn in 0..max_turns {
                // Build upstream request body for each turn so messages are updated.
                let mut completion_map = serde_json::Map::new();
                completion_map.insert("model".to_string(), serde_json::json!(model_id));
                completion_map.insert(
                    "messages".to_string(),
                    serde_json::Value::Array(conversation_messages.clone()),
                );
                completion_map.insert("stream".to_string(), serde_json::json!(false));
                completion_map.insert("tool_choice".to_string(), serde_json::json!("auto"));

                if !openai_tools.is_empty() {
                    completion_map.insert(
                        "tools".to_string(),
                        serde_json::Value::Array(openai_tools.clone()),
                    );
                }

                copy_optional_chat_params(&json_body, &mut completion_map);

                let request_value = serde_json::Value::Object(completion_map);

                let completion = match call_openai_chat_completions(
                    &client,
                    &upstream_url,
                    &session_api_keys,
                    &request_value,
                )
                .await
                {
                    Ok(v) => v,
                    Err(e) => {
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_GATEWAY);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(e)).unwrap());
                    }
                };

                let tool_calls = extract_tool_calls(&completion);
                last_response = Some(completion.clone());

                if tool_calls.is_empty() {
                    let body_str =
                        serde_json::to_string(&completion).unwrap_or_else(|_| "{}".to_string());
                    let mut response_builder = Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json");
                    response_builder = add_cors_headers_with_host_and_origin(
                        response_builder,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(response_builder.body(Body::from(body_str)).unwrap());
                }

                // Append assistant tool call message, then execute tool calls.
                if let Some(choice_message) = extract_choice_message(&completion) {
                    let assistant_content = choice_message
                        .get("content")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    conversation_messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": assistant_content,
                        "tool_calls": tool_calls.clone()
                    }));
                } else {
                    conversation_messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": serde_json::Value::Null,
                        "tool_calls": tool_calls.clone()
                    }));
                }

                let tool_results = match execute_mcp_tool_calls(
                    &tool_calls,
                    &tool_to_server,
                    &mcp_servers,
                    &mcp_settings,
                )
                .await
                {
                    Ok(v) => v,
                    Err(e) => {
                        let mut error_response =
                            Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(e)).unwrap());
                    }
                };

                for (tool_call_id, result_text) in tool_results {
                    conversation_messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result_text
                    }));
                }
            }

            // Safety catch: model kept requesting tools beyond max_turns.
            let body_json = last_response.unwrap_or_else(|| serde_json::json!({}));
            let body_str = serde_json::to_string(&body_json).unwrap_or_else(|_| "{}".to_string());
            let mut error_response = Response::builder().status(StatusCode::UNPROCESSABLE_ENTITY);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            let payload = format!(
                "{{\"error\":\"max_turns reached while resolving tool calls\",\"last_response\":{body_str}}}"
            );
            let response = error_response.body(Body::from(payload)).unwrap();
            return Ok(response);
        }
        (hyper::Method::POST, "/chat/completions")
        | (hyper::Method::POST, "/completions")
        | (hyper::Method::POST, "/embeddings")
        | (hyper::Method::POST, "/messages/count_tokens") => {
            log::info!(
                "Handling POST request to {destination_path} requiring model lookup in body",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
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
                Ok(mut json_body) => {
                    // Work around strict JSON-schema converters that reject property schemas
                    // of the form `{ "description": "..." }` (missing `type`).
                    // This happens for OpenAI-style tool schemas used with /chat/completions.
                    if destination_path == "/chat/completions" {
                        normalize_openai_tools_in_chat_body(&mut json_body);
                        if let Ok(normalized_bytes) = serde_json::to_vec(&json_body) {
                            buffered_body = Some(normalized_bytes.into());
                        }
                    }

                    if config.enable_server_tool_execution
                        && destination_path == "/chat/completions"
                        && !json_body
                            .get("stream")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    {
                        match run_server_side_openai_orchestration(
                            &json_body,
                            &client,
                            provider_configs.clone(),
                            sessions.clone(),
                            mlx_sessions.clone(),
                            mcp_servers.clone(),
                            mcp_settings.clone(),
                            &jan_data_folder,
                        )
                        .await
                        {
                            Ok(openai_response) => {
                                let body_str = serde_json::to_string(&openai_response)
                                    .unwrap_or_else(|_| "{}".to_string());
                                let mut response_builder = Response::builder()
                                    .status(StatusCode::OK)
                                    .header(hyper::header::CONTENT_TYPE, "application/json");
                                response_builder = add_cors_headers_with_host_and_origin(
                                    response_builder,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(response_builder.body(Body::from(body_str)).unwrap());
                            }
                            Err(e) => {
                                let mut error_response =
                                    Response::builder().status(StatusCode::BAD_GATEWAY);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response.body(Body::from(e)).unwrap());
                            }
                        }
                    }

                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
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
                                session_api_keys = provider_cfg.bearer_key_chain();
                            } else {
                                log::error!("Provider config not found for '{provider}'");
                            }
                        } else {
                            // No remote provider found, check for local session
                            let sessions_guard = sessions.lock().await;

                            // Use original model_id for local session lookup
                            let sessions_find_model = model_id;

                            // Check both llama.cpp and MLX sessions
                            let llama_session = sessions_guard
                                .values()
                                .find(|s| s.info.model_id == sessions_find_model);

                            let (mlx_session_info, mlx_count) = {
                                let mut mlx_session_info: Option<SessionInfo> = None;
                                let mlx_count;
                                let mlx_guard = mlx_sessions.lock().await;
                                mlx_count = mlx_guard.len();
                                if let Some(session) = mlx_guard
                                    .values()
                                    .find(|s| s.info.model_id == sessions_find_model)
                                {
                                    // Clone just the SessionInfo since MlxBackendSession is not Clone
                                    mlx_session_info = Some(session.info.clone());
                                }
                                (mlx_session_info, mlx_count)
                            };

                            let total_sessions = sessions_guard.len() + mlx_count;

                            // mlx_session_info is Option<SessionInfo>, use as_ref to get Option<&SessionInfo>
                            let mlx_session = mlx_session_info.as_ref();

                            if total_sessions == 0 {
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

                            if let Some(session) = llama_session {
                                let target_port = session.info.port;
                                session_api_keys = vec![session.info.api_key.clone()];
                                log::debug!("Found llama.cpp session for model_id {model_id}");
                                target_base_url = Some(format!(
                                    "http://127.0.0.1:{target_port}/v1{destination_path}"
                                ));
                            } else if let Some(info) = mlx_session {
                                let target_port = info.port;
                                session_api_keys = vec![info.api_key.clone()];
                                log::debug!("Found MLX session for model_id {model_id}");
                                target_base_url = Some(format!(
                                    "http://127.0.0.1:{target_port}/v1{destination_path}"
                                ));
                            } else {
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
            log::debug!("Handling GET /v1/models request");

            // Get local llama.cpp sessions
            let sessions_guard = sessions.lock().await;
            let local_models: Vec<_> = sessions_guard
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

        (hyper::Method::GET, "/openapi.json") => {
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
            let html = r#"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Docs</title>
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
            let css = include_str!("../../../static/swagger-ui/swagger-ui.css");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/css")
                .body(Body::from(css))
                .unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui-bundle.js") => {
            let js = include_str!("../../../static/swagger-ui/swagger-ui-bundle.js");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/javascript")
                .body(Body::from(js))
                .unwrap());
        }

        (hyper::Method::GET, "/favicon.ico") => {
            let icon = include_bytes!("../../../static/swagger-ui/favicon.ico");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "image/x-icon")
                .body(Body::from(icon.as_ref()))
                .unwrap());
        }

        _ => {
            let is_explicitly_whitelisted_get = method == hyper::Method::GET
                && whitelisted_paths.contains(&destination_path.as_str());
            if is_explicitly_whitelisted_get {
                log::debug!("Handled whitelisted GET path: {destination_path}");
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from("Not Found")).unwrap());
            } else {
                log::warn!(
                    "Unhandled method/path for dynamic routing: {method} {destination_path}"
                );
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
    }

    let upstream_url = match target_base_url.clone() {
        Some(p) => p,
        None => {
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

    let body_bytes_for_proxy = match buffered_body.clone() {
        Some(b) => b,
        None => {
            log::error!(
                "Internal logic error: Request reached proxy stage without a buffered body."
            );
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
        }
    };

    let key_attempts: Vec<Option<String>> = if session_api_keys.is_empty() {
        vec![None]
    } else {
        session_api_keys.iter().cloned().map(Some).collect()
    };

    // For Anthropic /messages, we need to track if we should transform the response
    let destination_path = path.clone();

    for (key_idx, key_opt) in key_attempts.iter().enumerate() {
        let mut outbound_req = client.request(method.clone(), upstream_url.clone());

        for (name, value) in headers.iter() {
            if name != hyper::header::HOST && name != hyper::header::AUTHORIZATION {
                outbound_req = outbound_req.header(name, value);
            }
        }

        if let Some(key) = key_opt {
            outbound_req = outbound_req.header("Authorization", format!("Bearer {key}"));
        } else {
            log::debug!("No session API key for this attempt");
        }

        let outbound_req_with_body = outbound_req.body(body_bytes_for_proxy.clone());

        match outbound_req_with_body.send().await {
            Ok(response) => {
                let status = response.status();

                let is_error = !status.is_success();

                if is_error
                    && http_status_indicates_api_key_retry(status)
                    && key_idx + 1 < key_attempts.len()
                {
                    let _ = response.text().await;
                    log::warn!("Upstream {status} for API key index {key_idx}, trying next key");
                    continue;
                }

                // For Anthropic /messages requests with errors, try /chat/completions
                if is_error && is_anthropic_messages {
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
                    let fallback_api_key = key_opt.clone();
                    let fallback_body = Some(body_bytes_for_proxy.clone());

                    // Transform body to OpenAI format for fallback
                    if let Some((url, openai_body)) = fallback_url.zip(fallback_body).and_then(|(url, body)| {
                    let json_body = serde_json::from_slice::<serde_json::Value>(&body).ok()?;
                    match transform_anthropic_to_openai(&json_body) {
                        Some(transformed) => Some((url, transformed)),
                        None => {
                            log::error!("transform_anthropic_to_openai returned None for body: {json_body}");
                            None
                        }
                    }
                }) {
                    let chat_url = format!("{}/chat/completions", url);
                    log::info!("Fallback to chat completions: {chat_url}");

                    // Create a fresh client for the fallback to avoid connection pool issues
                    let fallback_client = Client::builder()
                        .build()
                        .expect("Failed to create fallback client");

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
                            // Return fallback error to client
                            let fallback_error = res.text().await.unwrap_or_else(|e| format!("Failed to read error: {}", e));

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
                    let mut error_response = Response::builder().status(status);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(Body::from(error_body)).unwrap());
                } else if is_error {
                    // Non-/messages error - return error response with body
                    let error_body = response
                        .text()
                        .await
                        .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                    let mut error_response = Response::builder().status(status);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(Body::from(error_body)).unwrap());
                }

                // Success case - stream the response
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

                tokio::spawn(async move {
                    // Regular passthrough - when /messages succeeds directly,
                    // the response is already in the correct format
                    while let Some(chunk_result) = stream.next().await {
                        match chunk_result {
                            Ok(chunk) => {
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

                return Ok(builder.body(body).unwrap());
            }
            Err(e) => {
                let error_msg = format!("Proxy request to model failed: {e}");
                log::error!("{error_msg}");
                let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from(error_msg)).unwrap());
            }
        }
    }

    log::error!("Internal error: proxy key loop exited without a response");
    let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
    error_response = add_cors_headers_with_host_and_origin(
        error_response,
        &host_header,
        &origin_header,
        &config.trusted_hosts,
    );
    Ok(error_response
        .body(Body::from("Internal proxy error"))
        .unwrap())
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
        log::warn!(
            "CORS: Origin '{}' is not trusted, not reflecting origin",
            origin
        );
    }

    builder
}

pub async fn is_server_running(server_handle: Arc<Mutex<Option<ServerHandle>>>) -> bool {
    let handle_guard = server_handle.lock().await;
    handle_guard.is_some()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    jan_data_folder: String,
    enable_server_tool_execution: bool,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    start_server_internal(
        server_handle,
        sessions,
        mlx_sessions,
        host,
        port,
        prefix,
        proxy_api_key,
        trusted_hosts,
        proxy_timeout,
        provider_configs,
        mcp_servers,
        mcp_settings,
        jan_data_folder,
        enable_server_tool_execution,
    )
    .await
}

async fn start_server_internal(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    jan_data_folder: String,
    enable_server_tool_execution: bool,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;
    if handle_guard.is_some() {
        return Err("Server is already running".into());
    }

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    let config = ProxyConfig {
        prefix,
        proxy_api_key,
        trusted_hosts,
        host: host.clone(),
        port,
        enable_server_tool_execution,
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let make_svc = make_service_fn(move |_conn| {
        let client = client.clone();
        let config = config.clone();
        let sessions = sessions.clone();
        let mlx_sessions = mlx_sessions.clone();
        let provider_configs = provider_configs.clone();
        let mcp_servers = mcp_servers.clone();
        let mcp_settings = mcp_settings.clone();
        let jan_data_folder = jan_data_folder.clone();

        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                proxy_request(
                    req,
                    client.clone(),
                    config.clone(),
                    sessions.clone(),
                    mlx_sessions.clone(),
                    provider_configs.clone(),
                    mcp_servers.clone(),
                    mcp_settings.clone(),
                    jan_data_folder.clone(),
                )
            }))
        }
    });

    let server = match Server::try_bind(&addr) {
        Ok(builder) => builder.serve(make_svc),
        Err(e) => {
            log::error!("Failed to bind to {addr}: {e}");
            return Err(Box::new(e));
        }
    };
    log::info!("Jan API server started on http://{addr}");

    let server_task = tokio::spawn(async move {
        if let Err(e) = server.await {
            log::error!("Server error: {e}");
            return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
        }
        Ok(())
    });

    *handle_guard = Some(server_task);
    let actual_port = addr.port();
    log::info!("Jan API server started successfully on port {actual_port}");
    Ok(actual_port)
}

pub async fn stop_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.abort();
        *handle_guard = None;
        log::info!("Jan API server stopped");
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
