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
#[cfg(not(feature = "cli"))]
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::StreamEvent;
use crate::core::openai_schema::{
    http_status_indicates_api_key_retry, normalize_openai_tool_parameters_schema,
};
#[cfg(not(feature = "cli"))]
use crate::core::server::proxy::router_upstream;
#[cfg(not(feature = "cli"))]
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

        // Assistant tool-call turns carry `tool_calls` and may have `content: null`
        // (or omit it entirely) per the OpenAI protocol. `tool` result messages
        // carry a `tool_call_id`. These shapes flow back into the conversation
        // history (see MessagesUpdated), so a follow-up request re-submits them and
        // must preserve them verbatim -- otherwise the assistant/tool pairing is
        // broken and content-null turns are wrongly rejected.
        let has_tool_calls = msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());
        let tool_call_id = msg.get("tool_call_id").and_then(|v| v.as_str());

        // Content is a plain string or an OpenAI multimodal content-part array
        // (text + image_url); pass either through verbatim. It may be null (or
        // absent) only when the assistant message carries tool_calls.
        let content = match msg.get("content") {
            Some(v @ serde_json::Value::String(_)) | Some(v @ serde_json::Value::Array(_)) => {
                v.clone()
            }
            // Null/absent content is valid for an assistant turn whose payload is
            // entirely tool calls; normalize to null so upstream sees a well-formed
            // message.
            Some(serde_json::Value::Null) | None if has_tool_calls || tool_call_id.is_some() => {
                serde_json::Value::Null
            }
            _ => return Err("Each message must include 'content' as a string or array".into()),
        };

        let mut obj = serde_json::Map::new();
        obj.insert("role".to_string(), serde_json::json!(role));
        obj.insert("content".to_string(), content);
        if has_tool_calls {
            obj.insert("tool_calls".to_string(), msg["tool_calls"].clone());
        }
        if let Some(id) = tool_call_id {
            obj.insert("tool_call_id".to_string(), serde_json::json!(id));
        }
        out.push(serde_json::Value::Object(obj));
    }
    Ok(out)
}

/// Repairs a "dangling" tool-call turn: an assistant message with
/// `tool_calls` whose ids don't all have a matching `role: "tool"` reply
/// immediately after. Anthropic (and some other providers) reject the whole
/// request outright when this happens, rather than just the offending turn.
///
/// This can happen if a previous run was interrupted before a tool result was
/// ever recorded -- e.g. the process crashed or was force-killed while an
/// `ask`/permission prompt was still pending -- and the incomplete turn was
/// then persisted and later resumed/replayed. Insert a synthetic error result
/// for each missing id so the conversation is always well-formed by the time
/// it leaves this process, regardless of how the gap was introduced. Returns
/// the number of ids repaired.
pub(crate) fn repair_dangling_tool_calls(messages: &mut Vec<serde_json::Value>) -> usize {
    let mut repaired = 0;
    let mut i = 0;
    while i < messages.len() {
        let ids: Vec<String> = messages[i]
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .map(|calls| {
                calls
                    .iter()
                    .filter_map(|tc| tc.get("id").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        if ids.is_empty() {
            i += 1;
            continue;
        }
        // A tool-call turn's replies are the run of `role: "tool"` messages
        // immediately following it; the run ends at the next message that
        // isn't a tool reply.
        let mut answered: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut j = i + 1;
        while j < messages.len()
            && messages[j].get("role").and_then(|v| v.as_str()) == Some("tool")
        {
            if let Some(id) = messages[j].get("tool_call_id").and_then(|v| v.as_str()) {
                answered.insert(id);
            }
            j += 1;
        }
        let missing: Vec<&String> = ids.iter().filter(|id| !answered.contains(id.as_str())).collect();
        for id in &missing {
            messages.insert(
                j,
                serde_json::json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": "ERROR: this tool call was interrupted before it produced a \
                        result (e.g. an unanswered question or a cancelled run); treat it as \
                        failed.",
                }),
            );
            j += 1;
        }
        repaired += missing.len();
        i = j;
    }
    repaired
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

/// Resolve `model_id` to an upstream URL + key chain. The desktop build also
/// resolves local engines (MLX session, llama-server router); the `cli` build is
/// remote-only, so a model with no provider entry is unresolvable.
pub(crate) async fn resolve_upstream_for_model(
    model_id: &str,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    #[cfg(not(feature = "cli"))] llama_state: Arc<LlamacppState>,
    #[cfg(not(feature = "cli"))] mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
) -> Result<(String, Vec<String>), String> {
    let destination_path = "/chat/completions";

    let pc = provider_configs.lock().await;
    let offers = |config: &ProviderConfig| config.models.iter().any(|m| m == model_id);

    // The same model id can be listed by several providers -- typically a local
    // engine descriptor (no base_url) plus a Jan desktop API server exposing the
    // same model over HTTP. `HashMap` iteration order is randomized, so pick the
    // usable one deterministically instead of whichever hashes first. Only the
    // CLI needs this: the desktop resolves base_url-less providers through its
    // in-process engine branches below.
    #[cfg(feature = "cli")]
    let first_match = pc
        .iter()
        .filter(|(_, config)| {
            config.base_url.as_deref().is_some_and(|u| !u.is_empty()) && offers(config)
        })
        .min_by_key(|(name, _)| name.to_string())
        .or_else(|| pc.iter().find(|(_, config)| offers(config)));
    #[cfg(not(feature = "cli"))]
    let first_match = pc.iter().find(|(_, config)| offers(config));

    let provider_name = first_match
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
            // A populated base_url means an HTTP upstream (cloud, or a local
            // engine whose live endpoint was registered at runtime). A local
            // engine loaded from persisted settings has none -- fall through to
            // the MLX session / llama-server router resolution below.
            if let Some(api_url) = provider_cfg.base_url.clone().filter(|u| !u.is_empty()) {
                let url = format!("{}{}", api_url, destination_path);
                return Ok((url, provider_cfg.bearer_key_chain()));
            }
        }
    }

    #[cfg(not(feature = "cli"))]
    {
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

    // Probe every server concurrently so one slow/hanging server can't serialize
    // the whole collection behind its timeout (previously each server waited out
    // the full timeout before the next was contacted).
    let listings = futures_util::future::join_all(servers.iter().map(|(server_name, service)| {
        async move {
            let result = match tokio::time::timeout(timeout_duration, service.list_all_tools()).await
            {
                Ok(Ok(tools)) => Some(tools),
                Ok(Err(e)) => {
                    log::warn!("MCP server {} failed to list tools: {}", server_name, e);
                    None
                }
                Err(_) => {
                    log::warn!(
                        "Listing MCP tools timed out after {} seconds on server {}",
                        timeout_duration.as_secs(),
                        server_name
                    );
                    None
                }
            };
            (server_name.clone(), result)
        }
    }))
    .await;

    for (server_name, tools) in listings {
        let Some(tools) = tools else { continue };
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
) -> Vec<(String, String)> {
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

        let Some(server_name) = tool_to_server.get(&tool_name) else {
            results.push((
                tool_call_id,
                format!("ERROR: No MCP server registered for tool '{tool_name}'"),
            ));
            continue;
        };

        let Some(service) = servers.get(server_name) else {
            results.push((
                tool_call_id,
                format!("ERROR: MCP server '{server_name}' not found in runtime state"),
            ));
            continue;
        };

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

    results
}

#[cfg(not(feature = "cli"))]
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
/// Stable marker prefixed onto an upstream error when the failure looks like a
/// context/prompt-length overflow, so the agent loop can react (compact + retry)
/// instead of surfacing the raw provider error. Works uniformly for local
/// (llama-server) and remote (OpenAI/Anthropic/Google) since all report overflow
/// via an HTTP error body rather than the streamed deltas.
pub(crate) const CONTEXT_OVERFLOW_MARKER: &str = "context-overflow";

/// True when a provider error body reads like a context/prompt-length overflow.
/// Matches the OpenAI `context_length_exceeded` code, Anthropic's "prompt is too
/// long", Google's token-limit phrasing, and llama-server's context messages.
pub(crate) fn is_context_overflow_body(body: &str) -> bool {
    let b = body.to_lowercase();
    b.contains("context_length_exceeded")
        || b.contains("maximum context length")
        || b.contains("prompt is too long")
        || b.contains("exceeds the maximum number of tokens")
        || b.contains("the request exceeds the available context")
        || b.contains("exceed context")
        || b.contains("context window")
        || (b.contains("context") && b.contains("too long"))
}

/// True when an error string carries the [`CONTEXT_OVERFLOW_MARKER`].
pub(crate) fn is_context_overflow_error(err: &str) -> bool {
    err.contains(CONTEXT_OVERFLOW_MARKER)
}

/// True when the upstream rejected the model's tool call as incomplete (the
/// facade's DSML guard: "upstream emitted an incomplete DSML tool call"). The
/// truncated call never executed, so the request has no side effects and the
/// loop can safely regenerate it once instead of killing the run.
pub(crate) fn is_incomplete_tool_call_error(err: &str) -> bool {
    err.contains("incomplete") && err.contains("tool call")
}

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
        if is_context_overflow_body(&text) {
            last_err = format!("[{CONTEXT_OVERFLOW_MARKER}] {last_err}");
        }
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
    /// A `ToolCallStarted` was already emitted for this call; guards the
    /// once-per-call in-progress signal against later argument deltas.
    started_emitted: bool,
    /// Bytes of `arguments` already forwarded as `ToolCallArgsDelta`. Zero
    /// until the first forward, which replays whatever arrived before the call
    /// could be announced.
    args_forwarded: usize,
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
    /// A `<think>` boundary was streamed for `reasoning_content` and not yet
    /// closed. Reasoning is display-only (dimmed in the TUI) and deliberately
    /// kept out of `content` so it is never resent to the model as history.
    reasoning_open: bool,
    /// An error object delivered inside the stream (`data: {"error": {...}}`).
    /// OpenAI-compatible upstreams can fail mid-stream after a `200 OK`; without
    /// capturing it the run would end as a silent "no answer" instead of
    /// surfacing the failure. Propagated as an `Err` by `consume_openai_sse`.
    error: Option<String>,
}

impl SseAccumulator {
    fn close_reasoning(&mut self, events: &mpsc::UnboundedSender<StreamEvent>) {
        if self.reasoning_open {
            self.reasoning_open = false;
            let _ = events.send(StreamEvent::Token {
                text: "</think>".to_string(),
            });
        }
    }

    /// Parse one raw SSE line (`data: {...}`); non-`data:`/blank lines are ignored.
    fn ingest_line(&mut self, line: &str, events: &mpsc::UnboundedSender<StreamEvent>) {
        if let Some(rest) = line.trim_end_matches('\r').strip_prefix("data:") {
            let data = rest.trim();
            if !data.is_empty() {
                self.ingest(data, events);
            }
        }
    }

    fn ingest(&mut self, data: &str, events: &mpsc::UnboundedSender<StreamEvent>) {
        if data == "[DONE]" {
            return;
        }
        let json: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(err) = json.get("error").filter(|e| !e.is_null()) {
            let message = err
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| err.to_string());
            let kind = err.get("type").and_then(|v| v.as_str());
            self.error = Some(match kind {
                Some(t) if !t.is_empty() => format!("{t}: {message}"),
                _ => message,
            });
            return;
        }

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
            self.close_reasoning(events);
        }

        let Some(delta) = choice.get("delta") else {
            return;
        };

        if let Some(text) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                if !self.reasoning_open {
                    self.reasoning_open = true;
                    let _ = events.send(StreamEvent::Token {
                        text: "<think>".to_string(),
                    });
                }
                let _ = events.send(StreamEvent::Token {
                    text: text.to_string(),
                });
            }
        }

        if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                self.close_reasoning(events);
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
                let func = tc.get("function");
                if let Some(name) = func
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .filter(|n| !n.is_empty())
                {
                    slot.name = name.to_string();
                }
                let arg_delta = func
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                if let Some(arg) = arg_delta {
                    slot.arguments.push_str(arg);
                }

                // Signal the in-progress tool call the instant both id and name
                // are known, so consumers can show activity while arguments are
                // still streaming (a long window for large write/edit calls).
                if !slot.started_emitted && !slot.id.is_empty() && !slot.name.is_empty() {
                    slot.started_emitted = true;
                    let _ = events.send(StreamEvent::ToolCallStarted {
                        id: slot.id.clone(),
                        name: slot.name.clone(),
                    });
                }

                // Forward the argument text itself, but only once the call has
                // been announced -- a delta with no preceding `ToolCallStarted`
                // has no call for the consumer to attach it to. Providers that
                // send arguments before the id/name are covered by the replay
                // below, which flushes what was buffered before the announce.
                if slot.started_emitted {
                    if let Some(arg) = arg_delta {
                        let delta = if slot.args_forwarded == 0 {
                            // First forward after the announce: ship everything
                            // accumulated so far, including any chunks that
                            // arrived before id/name were known.
                            slot.arguments.clone()
                        } else {
                            arg.to_string()
                        };
                        slot.args_forwarded = slot.arguments.len();
                        let _ = events.send(StreamEvent::ToolCallArgsDelta {
                            id: slot.id.clone(),
                            delta,
                        });
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

/// Drain every complete (newline-terminated) line from `buf` into `acc`,
/// leaving any trailing partial line buffered for the next chunk.
fn drain_complete_lines(
    buf: &mut String,
    acc: &mut SseAccumulator,
    events: &mpsc::UnboundedSender<StreamEvent>,
) {
    while let Some(nl) = buf.find('\n') {
        let line = buf[..nl].to_string();
        buf.drain(..=nl);
        acc.ingest_line(&line, events);
    }
}

/// Ingest a final, non-newline-terminated line left after the stream closes.
/// Providers may end with `data: {...}` and no trailing blank line / `[DONE]`;
/// without this the last chunk's finish_reason and tool-call args are dropped.
fn flush_trailing_line(
    buf: &str,
    acc: &mut SseAccumulator,
    events: &mpsc::UnboundedSender<StreamEvent>,
) {
    if !buf.trim().is_empty() {
        acc.ingest_line(buf, events);
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
        drain_complete_lines(&mut buf, &mut acc, events);
    }
    flush_trailing_line(&buf, &mut acc, events);

    if let Some(err) = acc.error.take() {
        let msg = format!("Upstream stream error: {err}");
        return Err(if is_context_overflow_body(&err) {
            format!("[{CONTEXT_OVERFLOW_MARKER}] {msg}")
        } else {
            msg
        });
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

    /// A model served both by a Jan desktop API server (reachable over HTTP) and
    /// by local engine descriptors (no base_url) must always resolve to the
    /// server. `HashMap` order is randomized, so the local entries outnumber the
    /// remote one here: without a deterministic preference this fails most runs.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn shared_model_id_resolves_to_the_reachable_provider() {
        let mut configs = HashMap::new();
        for local in ["llamacpp", "llamacpp-rs", "mlx", "engine-d", "engine-e"] {
            configs.insert(
                local.to_string(),
                ProviderConfig {
                    provider: local.into(),
                    base_url: None,
                    models: vec!["sentence-transformer-mini".into()],
                    ..Default::default()
                },
            );
        }
        configs.insert(
            "JanServer".to_string(),
            ProviderConfig {
                provider: "JanServer".into(),
                base_url: Some("http://127.0.0.1:1337/v1".into()),
                models: vec!["sentence-transformer-mini".into()],
                ..Default::default()
            },
        );

        let (url, _keys) = resolve_upstream_for_model(
            "sentence-transformer-mini",
            Arc::new(Mutex::new(configs)),
        )
        .await
        .expect("the API server provider is reachable");
        assert_eq!(url, "http://127.0.0.1:1337/v1/chat/completions");
    }

    #[test]
    fn parse_messages_passes_multimodal_content_array_through() {
        let messages = json!([{
            "role": "user",
            "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
            ],
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["content"], messages[0]["content"]);
    }

    #[test]
    fn parse_messages_rejects_missing_content() {
        let messages = json!([{ "role": "user" }]);
        assert!(parse_openai_messages(&messages).is_err());
    }

    #[test]
    fn parse_messages_allows_null_content_assistant_tool_call_turn() {
        // An assistant tool-call turn (content: null + tool_calls) round-trips
        // through history and must be re-parseable on a follow-up request.
        let messages = json!([{
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": { "name": "write", "arguments": "{}" }
            }]
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["role"], "assistant");
        assert!(out[0]["content"].is_null());
        assert_eq!(out[0]["tool_calls"][0]["id"], "call_1");
    }

    #[test]
    fn parse_messages_preserves_tool_result_message() {
        // A role:tool result must keep its tool_call_id so the assistant/tool
        // pairing stays valid when the conversation is re-submitted.
        let messages = json!([{
            "role": "tool",
            "tool_call_id": "call_1",
            "content": "wrote file"
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["role"], "tool");
        assert_eq!(out[0]["tool_call_id"], "call_1");
        assert_eq!(out[0]["content"], "wrote file");
    }

    #[test]
    fn parse_messages_still_rejects_null_content_without_tool_calls() {
        // A plain assistant/user turn with null content is still invalid.
        let messages = json!([{ "role": "assistant", "content": null }]);
        assert!(parse_openai_messages(&messages).is_err());
    }

    #[test]
    fn repair_leaves_well_formed_conversation_untouched() {
        let mut messages = vec![
            json!({ "role": "user", "content": "hi" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "read", "arguments": "{}" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_1", "content": "file contents" }),
            json!({ "role": "assistant", "content": "done" }),
        ];
        let before = messages.clone();
        assert_eq!(repair_dangling_tool_calls(&mut messages), 0);
        assert_eq!(messages, before);
    }

    #[test]
    fn repair_inserts_synthetic_result_for_a_fully_missing_tool_reply() {
        // An `ask`-style call interrupted before it ever produced a result --
        // e.g. the process was killed while the prompt was still pending.
        let mut messages = vec![
            json!({ "role": "user", "content": "make cat slide" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "toolu_ask",
                    "type": "function",
                    "function": { "name": "ask", "arguments": "{}" }
                }]
            }),
            json!({ "role": "user", "content": "next message, no reply ever recorded" }),
        ];
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "toolu_ask");
        assert!(messages[2]["content"].as_str().unwrap().starts_with("ERROR"));
        assert_eq!(messages[3]["content"], "next message, no reply ever recorded");
    }

    #[test]
    fn repair_fills_only_the_missing_id_in_a_multi_call_turn() {
        // Two tool calls in one turn; only one got a reply before the gap.
        let mut messages = vec![
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "call_a", "type": "function", "function": { "name": "read", "arguments": "{}" } },
                    { "id": "call_b", "type": "function", "function": { "name": "ask", "arguments": "{}" } },
                ]
            }),
            json!({ "role": "tool", "tool_call_id": "call_a", "content": "file contents" }),
        ];
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["tool_call_id"], "call_a");
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_b");
    }

    #[test]
    fn repair_handles_a_dangling_call_at_the_end_of_the_conversation() {
        // No trailing message at all after the unanswered tool call.
        let mut messages = vec![json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": { "name": "ask", "arguments": "{}" }
            }]
        })];
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["role"], "tool");
        assert_eq!(messages[1]["tool_call_id"], "call_1");
    }

    #[test]
    fn detects_provider_context_overflow_bodies() {
        assert!(is_context_overflow_body(
            "{\"error\":{\"code\":\"context_length_exceeded\"}}"
        ));
        assert!(is_context_overflow_body("This model's maximum context length is 8192 tokens"));
        assert!(is_context_overflow_body("prompt is too long: 210000 tokens > 200000"));
        assert!(is_context_overflow_body(
            "the request exceeds the available context size"
        ));
        assert!(!is_context_overflow_body("invalid api key"));
        assert!(!is_context_overflow_body("rate limit exceeded"));
    }

    #[test]
    fn overflow_marker_round_trips() {
        let err = format!("[{CONTEXT_OVERFLOW_MARKER}] Upstream returned HTTP 400: ...");
        assert!(is_context_overflow_error(&err));
        assert!(!is_context_overflow_error("Upstream returned HTTP 500: boom"));
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
    fn reasoning_content_streams_as_think_wrapped_tokens_but_stays_out_of_content() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "reasoning_content": "let me " } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "reasoning_content": "think" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "content": "answer" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] }).to_string(),
            &tx,
        );

        // Reasoning must not leak into the reconstructed message sent back to the
        // model as history; only the answer prose is persisted.
        let completion = acc.into_completion();
        assert_eq!(completion["choices"][0]["message"]["content"], "answer");

        drop(tx);
        let mut tokens = Vec::new();
        while let Ok(StreamEvent::Token { text }) = rx.try_recv() {
            tokens.push(text);
        }
        assert_eq!(tokens, vec!["<think>", "let me ", "think", "</think>", "answer"]);
    }

    #[test]
    fn reasoning_only_completion_closes_the_open_think_block() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "reasoning_content": "hmm" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] }).to_string(),
            &tx,
        );

        let completion = acc.into_completion();
        assert!(completion["choices"][0]["message"]["content"].is_null());

        drop(tx);
        let mut tokens = Vec::new();
        while let Ok(StreamEvent::Token { text }) = rx.try_recv() {
            tokens.push(text);
        }
        assert_eq!(tokens, vec!["<think>", "hmm", "</think>"]);
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
    fn emits_tool_call_started_once_when_id_and_name_first_known() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        // First delta carries id + name; arguments arrive later, split across
        // deltas -- the in-progress signal must fire on this first delta only.
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_1", "function": { "name": "write", "arguments": "{\"path\":" } }
            ] } }] })
            .to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": "\"a.txt\"}" } }
            ] } }] })
            .to_string(),
            &tx,
        );

        drop(tx);
        let started: Vec<(String, String)> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|ev| match ev {
                StreamEvent::ToolCallStarted { id, name } => Some((id, name)),
                _ => None,
            })
            .collect();
        assert_eq!(started, vec![("call_1".to_string(), "write".to_string())]);
    }

    #[test]
    fn emits_tool_call_started_per_parallel_call() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_a", "function": { "name": "read", "arguments": "" } },
                { "index": 1, "id": "call_b", "function": { "name": "grep", "arguments": "" } }
            ] } }] })
            .to_string(),
            &tx,
        );

        drop(tx);
        let mut names: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|ev| match ev {
                StreamEvent::ToolCallStarted { name, .. } => Some(name),
                _ => None,
            })
            .collect();
        names.sort();
        assert_eq!(names, vec!["grep".to_string(), "read".to_string()]);
    }

    #[test]
    fn captures_mid_stream_error_object_with_type_prefix() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "content": "partial" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "error": { "message": "upstream exploded", "type": "server_error" } })
                .to_string(),
            &tx,
        );
        assert_eq!(
            acc.error.as_deref(),
            Some("server_error: upstream exploded")
        );
    }

    #[test]
    fn mid_stream_error_falls_back_to_message_without_type() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "error": { "message": "boom" } }).to_string(),
            &tx,
        );
        assert_eq!(acc.error.as_deref(), Some("boom"));
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

    /// Feed arbitrary byte chunks through the real buffering path, then close.
    fn feed_and_close(
        chunks: &[&str],
        events: &mpsc::UnboundedSender<StreamEvent>,
    ) -> serde_json::Value {
        let mut buf = String::new();
        let mut acc = SseAccumulator::default();
        for c in chunks {
            buf.push_str(c);
            drain_complete_lines(&mut buf, &mut acc, events);
        }
        flush_trailing_line(&buf, &mut acc, events);
        acc.into_completion()
    }

    #[test]
    fn flushes_final_line_without_trailing_newline() {
        let (tx, _rx) = sink();
        // Provider closes right after the final data line: no `\n`, no `[DONE]`.
        let final_chunk = json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }] });
        let completion = feed_and_close(
            &[
                "data: ",
                &json!({ "choices": [{ "delta": { "content": "hi" } }] }).to_string(),
                "\n\ndata: ",
                &final_chunk.to_string(),
            ],
            &tx,
        );

        assert_eq!(completion["choices"][0]["message"]["content"], "hi");
        assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
    }

    #[test]
    fn newline_terminated_stream_still_parses() {
        let (tx, _rx) = sink();
        let completion = feed_and_close(
            &[
                &format!(
                    "data: {}\n\n",
                    json!({ "choices": [{ "delta": { "content": "ok" }, "finish_reason": "stop" }] })
                ),
                "data: [DONE]\n\n",
            ],
            &tx,
        );
        assert_eq!(completion["choices"][0]["message"]["content"], "ok");
        assert_eq!(completion["choices"][0]["finish_reason"], "stop");
    }
}
