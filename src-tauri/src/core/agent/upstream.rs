//! Upstream/provider plumbing shared by the API-server proxy and the agent loop:
//! message normalization, model->upstream resolution, OpenAI chat-completion
//! calls, and MCP tool collection/execution. Lifted verbatim from
//! `core/server/proxy.rs` (no behavior change) so both the server path and
//! `core/agent/loop.rs` consume one implementation.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use futures_util::StreamExt;
use reqwest::Client;
use rmcp::model::{CallToolRequestParam, CallToolResult};
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::StreamEvent;
use crate::core::server::proxy::{
    http_status_indicates_api_key_retry, normalize_openai_tool_parameters_schema, router_upstream,
};
use crate::core::server::MlxBackendSession;
use crate::core::{
    mcp::models::McpSettings,
    state::{ProviderConfig, SharedMcpServers},
};

fn assistant_json_path(jan_data_folder: &str, assistant_id: &str) -> PathBuf {
    PathBuf::from(jan_data_folder)
        .join("assistants")
        .join(assistant_id)
        .join("assistant.json")
}

pub(crate) fn load_assistant_config(
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

pub(crate) fn parse_openai_messages(
    messages: &serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
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

pub(crate) fn set_system_prompt(messages: &mut Vec<serde_json::Value>, system_prompt: &str) {
    messages.retain(|m| m.get("role").and_then(|r| r.as_str()) != Some("system"));
    messages.insert(
        0,
        serde_json::json!({
            "role": "system",
            "content": system_prompt
        }),
    );
}

pub(crate) fn extract_tool_calls(response: &serde_json::Value) -> Vec<serde_json::Value> {
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

pub(crate) fn extract_choice_message(response: &serde_json::Value) -> Option<&serde_json::Value> {
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

pub(crate) async fn resolve_upstream_for_model(
    model_id: &str,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    llama_state: Arc<LlamacppState>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
) -> Result<(String, Vec<String>), String> {
    let destination_path = "/chat/completions";

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

    let mlx_guard = mlx_sessions.lock().await;
    if let Some(info) = mlx_guard.values().find(|s| s.info.model_id == model_id) {
        let target_port = info.info.port;
        return Ok((
            format!("http://127.0.0.1:{target_port}/v1{destination_path}"),
            vec![info.info.api_key.clone()],
        ));
    }
    drop(mlx_guard);

    if let Some((url, key)) = router_upstream(&llama_state, destination_path).await {
        return Ok((url, vec![key]));
    }

    Err(format!("No upstream session found for model '{model_id}'"))
}

pub(crate) fn copy_optional_chat_params(
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

pub(crate) async fn collect_mcp_openai_tools(
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

pub(crate) async fn execute_mcp_tool_calls(
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

pub(crate) async fn call_openai_chat_completions(
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

/// Streaming counterpart of [`call_openai_chat_completions`]. Forces `stream:true`
/// (with usage), emits `StreamEvent::Token` per content delta, and reconstructs
/// an OpenAI non-streaming completion JSON so the rest of the loop (tool-call
/// extraction, history append) is identical to the non-streaming path.
pub(crate) async fn stream_openai_chat_completions(
    client: &Client,
    upstream_url: &str,
    api_keys: &[String],
    body: &serde_json::Value,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    let mut req_body = body.clone();
    if let Some(obj) = req_body.as_object_mut() {
        obj.insert("stream".to_string(), serde_json::json!(true));
        obj.insert(
            "stream_options".to_string(),
            serde_json::json!({ "include_usage": true }),
        );
    }

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
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity");

        if let Some(key) = key_ref {
            req = req.header("Authorization", format!("Bearer {key}"));
        }

        let resp = req
            .body(req_body.to_string())
            .send()
            .await
            .map_err(|e| format!("Upstream request failed: {e}"))?;

        let status = resp.status();
        if status.is_success() {
            return consume_openai_sse(resp, events).await;
        }

        let text = resp.text().await.unwrap_or_default();
        last_err = format!("Upstream returned HTTP {status}: {text}");
        if http_status_indicates_api_key_retry(status) && i + 1 < attempts.len() {
            log::warn!("OpenAI stream: HTTP {status} with API key index {i}, trying next key");
            continue;
        }

        return Err(last_err);
    }

    Err(last_err)
}

#[derive(Default)]
struct ToolCallAccum {
    id: String,
    name: String,
    arguments: String,
}

/// Accumulates OpenAI SSE deltas into a single reconstructed completion. Kept
/// separate from the byte-stream reader so it is unit-testable without a live
/// HTTP response.
#[derive(Default)]
struct SseAccumulator {
    content: String,
    tool_calls: Vec<ToolCallAccum>,
    finish_reason: Option<String>,
    usage: Option<serde_json::Value>,
}

impl SseAccumulator {
    fn ingest(&mut self, data: &str, events: &mpsc::UnboundedSender<StreamEvent>) {
        if data == "[DONE]" {
            return;
        }
        let json: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(u) = json.get("usage") {
            if !u.is_null() {
                self.usage = Some(u.clone());
            }
        }

        let Some(choice) = json
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
        else {
            return;
        };

        if let Some(fr) = choice.get("finish_reason").and_then(|v| v.as_str()) {
            self.finish_reason = Some(fr.to_string());
        }

        let Some(delta) = choice.get("delta") else {
            return;
        };

        if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                self.content.push_str(text);
                let _ = events.send(StreamEvent::Token {
                    text: text.to_string(),
                });
            }
        }

        if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tcs {
                let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                while self.tool_calls.len() <= idx {
                    self.tool_calls.push(ToolCallAccum::default());
                }
                let slot = &mut self.tool_calls[idx];
                if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        slot.id = id.to_string();
                    }
                }
                if let Some(func) = tc.get("function") {
                    if let Some(name) = func.get("name").and_then(|v| v.as_str()) {
                        if !name.is_empty() {
                            slot.name = name.to_string();
                        }
                    }
                    if let Some(arg) = func.get("arguments").and_then(|v| v.as_str()) {
                        slot.arguments.push_str(arg);
                    }
                }
            }
        }
    }

    fn into_completion(self) -> serde_json::Value {
        let tool_calls: Vec<serde_json::Value> = self
            .tool_calls
            .into_iter()
            .filter(|t| !t.id.is_empty() || !t.name.is_empty() || !t.arguments.is_empty())
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "type": "function",
                    "function": { "name": t.name, "arguments": t.arguments }
                })
            })
            .collect();

        let mut message = serde_json::Map::new();
        message.insert("role".to_string(), serde_json::json!("assistant"));
        message.insert(
            "content".to_string(),
            if self.content.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::json!(self.content)
            },
        );
        if !tool_calls.is_empty() {
            message.insert(
                "tool_calls".to_string(),
                serde_json::Value::Array(tool_calls),
            );
        }

        let mut choice = serde_json::Map::new();
        choice.insert("index".to_string(), serde_json::json!(0));
        choice.insert("message".to_string(), serde_json::Value::Object(message));
        choice.insert(
            "finish_reason".to_string(),
            self.finish_reason
                .map(|s| serde_json::json!(s))
                .unwrap_or(serde_json::Value::Null),
        );

        let mut completion = serde_json::Map::new();
        completion.insert(
            "choices".to_string(),
            serde_json::Value::Array(vec![serde_json::Value::Object(choice)]),
        );
        if let Some(u) = self.usage {
            completion.insert("usage".to_string(), u);
        }

        serde_json::Value::Object(completion)
    }
}

async fn consume_openai_sse(
    resp: reqwest::Response,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut acc = SseAccumulator::default();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Upstream stream error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim_end_matches('\r').to_string();
            buf.drain(..=nl);

            if let Some(rest) = line.strip_prefix("data:") {
                let data = rest.trim();
                if !data.is_empty() {
                    acc.ingest(data, events);
                }
            }
        }
    }

    Ok(acc.into_completion())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sink() -> (
        mpsc::UnboundedSender<StreamEvent>,
        mpsc::UnboundedReceiver<StreamEvent>,
    ) {
        mpsc::unbounded_channel()
    }

    #[test]
    fn accumulates_content_and_emits_token_per_delta() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "content": "Hel" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "content": "lo" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] }).to_string(),
            &tx,
        );

        let completion = acc.into_completion();
        assert_eq!(completion["choices"][0]["message"]["content"], "Hello");
        assert_eq!(completion["choices"][0]["finish_reason"], "stop");
        assert!(completion["choices"][0]["message"]
            .get("tool_calls")
            .is_none());

        drop(tx);
        let mut tokens = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            if let StreamEvent::Token { text } = ev {
                tokens.push(text);
            }
        }
        assert_eq!(tokens, vec!["Hel", "lo"]);
    }

    #[test]
    fn reassembles_tool_call_arguments_split_across_deltas() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_1", "function": { "name": "search", "arguments": "{\"q\":" } }
            ] } }] })
            .to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": "\"rust\"}" } }
            ] } }] })
            .to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }],
                     "usage": { "total_tokens": 12 } })
            .to_string(),
            &tx,
        );

        let completion = acc.into_completion();
        let tc = &completion["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(tc["id"], "call_1");
        assert_eq!(tc["function"]["name"], "search");
        assert_eq!(tc["function"]["arguments"], "{\"q\":\"rust\"}");
        assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(completion["usage"]["total_tokens"], 12);
    }

    #[test]
    fn ignores_done_sentinel_and_malformed_lines() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest("[DONE]", &tx);
        acc.ingest("not json", &tx);
        let completion = acc.into_completion();
        assert!(completion["choices"][0]["message"]["content"].is_null());
    }
}
