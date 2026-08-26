//! Upstream/provider plumbing shared by the API-server proxy and the agent loop:
//! message normalization, model->upstream resolution, OpenAI chat-completion
//! calls, and MCP tool collection/execution. Lifted verbatim from
//! `core/server/proxy.rs` (no behavior change) so both the server path and
//! `core/agent/loop.rs` consume one implementation.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[cfg(not(feature = "cli"))]
use reqwest::Client;
use rmcp::model::{CallToolRequestParam, CallToolResult};
#[cfg(not(feature = "cli"))]
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::StreamEvent;
use crate::core::openai_schema::normalize_openai_tool_parameters_schema;
#[cfg(not(feature = "cli"))]
use crate::core::openai_schema::http_status_indicates_api_key_retry;
#[cfg(not(feature = "cli"))]
use crate::core::server::proxy::router_upstream;
#[cfg(not(feature = "cli"))]
use crate::core::server::MlxBackendSession;
use crate::core::{
    mcp::models::McpSettings,
    mcp::truncate::truncate_tool_result,
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
        // Preserve a resent assistant turn's reasoning alongside its content and
        // tool calls. Some providers require prior reasoning to be resubmitted
        // to keep a (local llama.cpp `preserve_thinking`) chat template honest:
        // dropping it would shrink earlier assistant turns and force reprocessing
        // of the KV-cache prefix. Only assistant messages carry it; user/tool/
        // system passes are untouched by construction.
        if role == "assistant" {
            if let Some(r) = msg.get("reasoning_content").and_then(|v| v.as_str()) {
                if !r.is_empty() {
                    obj.insert("reasoning_content".to_string(), serde_json::json!(r));
                }
            }
        }
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

/// Drops "poisoned" tool calls: an assistant `tool_calls` entry whose
/// `function.arguments` is not parsable JSON. A model (observed with
/// DeepSeek/vLLM) can end a stream mid-argument while still reporting
/// `finish_reason: "tool_calls"`, so the truncated call is persisted into the
/// thread. Every later turn resends it, and an OpenAI-compatible upstream
/// rejects the whole request with 422 -- the session is wedged, because the
/// poison is in the history the agent keeps replaying.
///
/// Removal, not reconstruction: a truncated argument cannot be recovered, and
/// inventing one would run a tool the model never actually asked for. The call
/// is dropped along with any `role: "tool"` reply carrying its `tool_call_id`,
/// so no orphaned result is left behind. Valid sibling calls in the same turn
/// survive; an assistant turn whose calls are ALL dropped keeps its text and
/// loses only the `tool_calls` key (and is removed entirely if that leaves it
/// empty, which would otherwise be a contentless assistant turn some providers
/// reject). Returns the number of calls dropped.
///
/// Runs before [`repair_dangling_tool_calls`], so a surviving call that lost
/// its result still gets the synthetic error reply from that pass.
pub(crate) fn drop_malformed_tool_calls(messages: &mut Vec<serde_json::Value>) -> usize {
    // A call is poison when arguments are present but unparsable. An absent or
    // empty `arguments` is the well-formed "no arguments" spelling several
    // providers use, and is left alone.
    fn is_malformed(call: &serde_json::Value) -> bool {
        let Some(args) = call
            .get("function")
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
        else {
            return false;
        };
        let args = args.trim();
        !args.is_empty() && serde_json::from_str::<serde_json::Value>(args).is_err()
    }

    let mut dropped_ids: Vec<String> = Vec::new();
    let mut dropped = 0;
    for msg in messages.iter_mut() {
        let Some(calls) = msg.get("tool_calls").and_then(|v| v.as_array()) else {
            continue;
        };
        if !calls.iter().any(is_malformed) {
            continue;
        }
        let mut kept: Vec<serde_json::Value> = Vec::with_capacity(calls.len());
        for call in calls {
            if is_malformed(call) {
                if let Some(id) = call.get("id").and_then(|v| v.as_str()) {
                    dropped_ids.push(id.to_string());
                }
                dropped += 1;
            } else {
                kept.push(call.clone());
            }
        }
        let Some(obj) = msg.as_object_mut() else {
            continue;
        };
        if kept.is_empty() {
            obj.remove("tool_calls");
        } else {
            obj.insert("tool_calls".to_string(), serde_json::Value::Array(kept));
        }
    }
    if dropped == 0 {
        return 0;
    }
    // Drop the results that answered a dropped call, then any assistant turn
    // left with neither text nor calls (content-null with no tool_calls is not
    // a valid turn to resend).
    messages.retain(|m| {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or_default();
        if role == "tool" {
            let id = m
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            return !dropped_ids.iter().any(|d| d == id);
        }
        if role != "assistant" || m.get("tool_calls").is_some() {
            return true;
        }
        // Keep a turn that still says something; a content-null/empty one is
        // now an empty shell left by the dropped call.
        match m.get("content") {
            Some(serde_json::Value::String(s)) => !s.trim().is_empty(),
            Some(serde_json::Value::Array(a)) => !a.is_empty(),
            _ => false,
        }
    });
    dropped
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
                // Desktop-inherited providers arrive keyless in this build; the
                // OS secret store is read here, for the one provider the run
                // resolved to, rather than for every provider at load time.
                #[cfg(feature = "cli")]
                let provider_cfg = {
                    let mut cfg = provider_cfg;
                    crate::core::cli::providers::hydrate_provider_keys(&mut cfg);
                    cfg
                };
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
        "reasoning_effort",
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
    let (timeout_duration, tool_output_cap) = {
        let settings = mcp_settings.lock().await;
        (
            settings.tool_call_timeout_duration(),
            settings.tool_output_cap(None),
        )
    };
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
            // Same cap as the desktop path: this string is appended to the agent's
            // message history, so an unbounded result would blow the context here too.
            Ok(res) => mcp_call_result_to_string(&truncate_tool_result(&res, tool_output_cap)),
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

        let resp = send_with_one_retry(req.body(body.to_string())).await?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| {
            format!(
                "Reading the upstream response failed ({upstream_url}): {}",
                describe_request_error(&e)
            )
        })?;

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
        || b.contains("exceeds the available context size")
        || b.contains("exceed_context_size_error")
        || b.contains("exceed context")
        || b.contains("context window")
        || (b.contains("context") && b.contains("too long"))
}

/// True when an error string carries the [`CONTEXT_OVERFLOW_MARKER`].
pub(crate) fn is_context_overflow_error(err: &str) -> bool {
    err.contains(CONTEXT_OVERFLOW_MARKER)
}

/// True when the upstream rejected the request *because* an assistant turn
/// carries `reasoning_content`. The field is a DeepSeek extension that some
/// providers require to be resent (llama.cpp `preserve_thinking`) while strict
/// OpenAI-compatible endpoints (Groq, vLLM's pydantic validation) reject the
/// whole request rather than ignoring the unknown key. Recognizing it lets the
/// caller drop the field and retry instead of failing the turn, so
/// `send_reasoning` does not have to be configured per provider by hand.
/// Requires both the field name and a rejection phrase: a body that merely
/// echoes the request must not be read as a rejection of it.
pub(crate) fn is_reasoning_field_error(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("reasoning_content")
        && [
            "unsupported",
            "unrecognized",
            "unknown",
            "not permitted",
            "not allowed",
            "unexpected",
            "additional",
            "extra input",
            "extra field",
            "invalid",
        ]
        .iter()
        .any(|phrase| e.contains(phrase))
}

#[cfg(not(feature = "cli"))]
/// Every message in an error's `source()` chain, outermost cause first.
/// `reqwest::Error` prints only its own layer -- `error sending request for url
/// (...)` -- so the reason the request never left (DNS failure, refused
/// connection, TLS mismatch, dropped socket) is one or more sources down and is
/// otherwise lost to the user. Consecutive duplicates are collapsed: hyper and
/// its io error often stringify identically.
fn error_source_chain(err: &dyn std::error::Error) -> Vec<String> {
    let mut chain = Vec::new();
    let mut cur = err.source();
    while let Some(e) = cur {
        let msg = e.to_string();
        if !msg.trim().is_empty() && chain.last() != Some(&msg) {
            chain.push(msg);
        }
        cur = e.source();
    }
    chain
}

#[cfg(not(feature = "cli"))]
/// True when a failed send can be retried safely: the connection died before any
/// response arrived, so nothing has been streamed to the caller and no side
/// effect on the upstream is implied. Covers a refused/failed connect and the
/// stale-keep-alive family -- hyper reports a pooled connection the peer had
/// already closed as `connection closed before message completed`, or as an
/// `ECONNRESET`/`EPIPE` io error if the RST lands while the request is going
/// out. A timeout is deliberately excluded: retrying one doubles the wait.
fn is_retryable_send_error(err: &reqwest::Error) -> bool {
    if err.is_timeout() || err.is_body() || err.is_decode() || err.is_builder() {
        return false;
    }
    err.is_connect() || chain_indicates_dropped_connection(&error_source_chain(err))
}

#[cfg(not(feature = "cli"))]
/// Whether an error's cause chain names a connection the peer dropped. Matched
/// on text because the io error is several opaque layers down (hyper's
/// `SendRequest` -> `connection error` -> `std::io::Error`) and its `ErrorKind`
/// is not exposed through `reqwest`.
fn chain_indicates_dropped_connection(chain: &[String]) -> bool {
    const MARKERS: &[&str] = &[
        "connection closed before message completed",
        "connection reset by peer",
        "broken pipe",
        "connection aborted",
        "unexpected eof",
    ];
    chain
        .iter()
        .any(|msg| {
            let msg = msg.to_lowercase();
            MARKERS.iter().any(|m| msg.contains(m))
        })
}

#[cfg(not(feature = "cli"))]
/// How long to wait before the one retry of a dropped connection. Long enough
/// for a load balancer that just recycled a backend to finish, short enough that
/// the user does not read it as a hang.
const SEND_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(250);

#[cfg(not(feature = "cli"))]
/// Send a request, retrying it once when the connection dropped before any
/// response arrived. This is the failure a long turn invites: while tools run
/// locally no bytes flow, an idle keep-alive connection is reclaimed by the peer
/// or its load balancer, and the next turn's request is written into a socket
/// that is already gone. Retrying is safe precisely because nothing was received
/// -- see [`is_retryable_send_error`].
async fn send_with_one_retry(req: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    // `try_clone` returns `None` only for a streaming body; every caller here
    // sends a `String`, so the retry path is always available in practice.
    let retry = req.try_clone();
    let first = match req.send().await {
        Ok(resp) => return Ok(resp),
        Err(e) => e,
    };
    let Some(retry) = retry.filter(|_| is_retryable_send_error(&first)) else {
        return Err(format!(
            "Upstream request failed: {}",
            describe_request_error(&first)
        ));
    };
    log::warn!(
        "upstream: {} -- retrying once",
        describe_request_error(&first)
    );
    tokio::time::sleep(SEND_RETRY_DELAY).await;
    retry.send().await.map_err(|e| {
        format!(
            "Upstream request failed after one retry: {} (first attempt: {})",
            describe_request_error(&e),
            describe_request_error(&first)
        )
    })
}

/// The HTTP client every agent turn goes through. Agent traffic now runs on
/// `genai`, which is built against reqwest 0.13, so this is the aliased crate
/// rather than the 0.12 `Client` the rest of the app (and the API server below)
/// uses. Pool tuning lives with the builder in [`super::genai_bridge`].
pub(crate) fn agent_http_client() -> reqwest13::Client {
    super::genai_bridge::shared_http_client()
}

#[cfg(not(feature = "cli"))]
/// Names the proxy environment variables in force, without their values (they
/// routinely carry credentials). A proxy set in the environment is a common
/// reason a request fails for Jan and for nothing else, and it is invisible in
/// the error itself.
fn proxy_env_hint() -> Option<String> {
    const VARS: &[&str] = &[
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ];
    let set: Vec<&str> = VARS
        .iter()
        .copied()
        .filter(|name| {
            std::env::var_os(name).is_some_and(|v| !v.to_string_lossy().trim().is_empty())
        })
        .collect();
    (!set.is_empty()).then(|| format!("proxy env set: {}", set.join(", ")))
}

#[cfg(not(feature = "cli"))]
/// A failed HTTP request described well enough to act on: what stage failed, the
/// `reqwest` message, its whole cause chain, and -- for a connect or timeout
/// failure, where the environment is usually the culprit -- which proxy
/// variables are set.
pub(crate) fn describe_request_error(err: &reqwest::Error) -> String {
    let stage = if err.is_timeout() {
        "timed out"
    } else if err.is_connect() {
        "could not connect"
    } else if err.is_redirect() {
        "too many redirects"
    } else if err.is_body() || err.is_decode() {
        "response body failed"
    } else if err.is_builder() {
        "request could not be built"
    } else {
        "send failed"
    };
    let mut msg = format!("{stage}: {err}");
    let chain = error_source_chain(err);
    if !chain.is_empty() {
        msg.push_str(&format!(" (caused by: {})", chain.join(" <- ")));
    }
    if let Some(status) = err.status() {
        msg.push_str(&format!(" [HTTP {status}]"));
    }
    if err.is_connect() || err.is_timeout() {
        if let Some(hint) = proxy_env_hint() {
            msg.push_str(&format!(" [{hint}]"));
        }
    }
    msg
}

/// Stream a chat completion for the agent loop.
///
/// A thin delegate to [`super::genai_bridge`], which owns the wire format, SSE
/// handling, provider field-name variance, and the retry policy. Every provider
/// the agent talks to comes through here -- cloud, a Jan desktop API server, a
/// local llama.cpp router, an MLX session -- so there is exactly one upstream
/// implementation to reason about.
///
/// `api_type` selects the `genai` adapter. It is `None` for every caller today:
/// the agent has always spoken OpenAI `/chat/completions` regardless of a
/// provider's configured `api_type`, and honoring it here would silently change
/// the wire format for an existing config. The API server's own converters
/// (`core::server::converters`) remain the only consumer of that field.
pub(crate) async fn stream_openai_chat_completions(
    client: &reqwest13::Client,
    upstream_url: &str,
    api_keys: &[String],
    api_type: Option<&str>,
    body: &serde_json::Value,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    super::genai_bridge::stream_chat_completions(
        client,
        upstream_url,
        api_keys,
        api_type,
        body,
        events,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[cfg(not(feature = "cli"))]
    /// `reqwest` prints only its own layer, so the cause chain is where the
    /// actual failure lives -- the whole point of `describe_request_error`.
    #[test]
    fn error_source_chain_lists_every_cause_and_collapses_repeats() {
        #[derive(Debug)]
        struct Err2(&'static str, Option<Box<Err2>>);
        impl std::fmt::Display for Err2 {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.0)
            }
        }
        impl std::error::Error for Err2 {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                self.1.as_ref().map(|e| e.as_ref() as &(dyn std::error::Error + 'static))
            }
        }

        // The outermost message is printed by the caller, so the chain starts at
        // its first source; the repeated innermost layer collapses.
        let inner = Err2("connection refused", None);
        let middle = Err2("connection refused", Some(Box::new(inner)));
        let connect = Err2("tcp connect error", Some(Box::new(middle)));
        let outer = Err2("error sending request", Some(Box::new(connect)));
        assert_eq!(
            error_source_chain(&outer),
            vec![
                "tcp connect error".to_string(),
                "connection refused".to_string()
            ],
            "sources only, consecutive duplicates collapsed"
        );
        assert!(
            error_source_chain(&Err2("alone", None)).is_empty(),
            "no sources -> nothing to add"
        );
    }

    #[cfg(not(feature = "cli"))]
    /// The reported error must name the stage and carry the OS-level reason, not
    /// just the URL. Port 1 on loopback refuses without touching the network.
    #[tokio::test]
    async fn describe_request_error_names_the_stage_and_the_os_cause() {
        let err = Client::new()
            .post("http://127.0.0.1:1/v1/chat/completions")
            .body("{}")
            .send()
            .await
            .expect_err("loopback port 1 refuses");
        let msg = describe_request_error(&err);
        assert!(msg.starts_with("could not connect: "), "stage named: {msg}");
        assert!(msg.contains("caused by: "), "cause chain present: {msg}");
        assert!(
            msg.to_lowercase().contains("refused") || msg.to_lowercase().contains("connect"),
            "the OS reason survives: {msg}"
        );
    }

    #[cfg(not(feature = "cli"))]
    #[test]
    fn dropped_connection_is_recognised_from_the_cause_chain() {
        assert!(chain_indicates_dropped_connection(&[
            "client error (SendRequest)".to_string(),
            "connection error".to_string(),
            "Connection reset by peer (os error 104)".to_string(),
        ]));
        assert!(chain_indicates_dropped_connection(&[
            "connection closed before message completed".to_string()
        ]));
        assert!(
            !chain_indicates_dropped_connection(&[
                "dns error".to_string(),
                "failed to lookup address information".to_string()
            ]),
            "a name that does not resolve is not a dropped connection"
        );
        assert!(!chain_indicates_dropped_connection(&[]));
    }

    #[cfg(not(feature = "cli"))]
    /// A refused connect never reached the peer, so retrying it is safe; a
    /// timeout is excluded on purpose (retrying one doubles the wait).
    #[tokio::test]
    async fn a_refused_connect_is_retryable_but_a_timeout_is_not() {
        let refused = Client::new()
            .post("http://127.0.0.1:1/v1/chat/completions")
            .body("{}")
            .send()
            .await
            .expect_err("loopback port 1 refuses");
        assert!(is_retryable_send_error(&refused), "{refused}");

        // 10.255.255.1 is a reserved address that black-holes rather than
        // refusing, so the connect attempt hits the timeout instead.
        let timed_out = Client::builder()
            .connect_timeout(std::time::Duration::from_millis(50))
            .build()
            .expect("client")
            .post("http://10.255.255.1:81/v1/chat/completions")
            .body("{}")
            .send()
            .await
            .expect_err("black-holed address times out");
        if timed_out.is_timeout() {
            assert!(!is_retryable_send_error(&timed_out), "{timed_out}");
        }
    }

    #[cfg(not(feature = "cli"))]
    /// A proxy in the environment breaks Jan and nothing else, and never shows up
    /// in the error. Names only: the values carry credentials.
    #[test]
    fn proxy_env_hint_names_set_variables_without_their_values() {
        static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var_os("HTTPS_PROXY");
        std::env::remove_var("HTTPS_PROXY");
        let before = proxy_env_hint();

        std::env::set_var("HTTPS_PROXY", "http://user:secret@proxy.internal:8080");
        let hint = proxy_env_hint().expect("a set proxy is reported");
        assert!(hint.contains("HTTPS_PROXY"), "names the variable: {hint}");
        assert!(!hint.contains("secret"), "never prints the value: {hint}");

        std::env::set_var("HTTPS_PROXY", "   ");
        assert_eq!(proxy_env_hint(), before, "a blank value is not a proxy");

        match prev {
            Some(v) => std::env::set_var("HTTPS_PROXY", v),
            None => std::env::remove_var("HTTPS_PROXY"),
        }
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
    fn sanitize_leaves_valid_tool_calls_untouched() {
        // Well-formed arguments, plus the empty-object and absent-arguments
        // spellings providers use for a no-argument call.
        let mut messages = vec![
            json!({ "role": "user", "content": "hi" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "c1", "type": "function", "function": { "name": "read", "arguments": "{\"path\":\"a.rs\"}" } },
                    { "id": "c2", "type": "function", "function": { "name": "ls", "arguments": "{}" } },
                    { "id": "c3", "type": "function", "function": { "name": "now" } },
                ]
            }),
            json!({ "role": "tool", "tool_call_id": "c1", "content": "ok" }),
        ];
        let before = messages.clone();
        assert_eq!(drop_malformed_tool_calls(&mut messages), 0);
        assert_eq!(messages, before);
    }

    #[test]
    fn sanitize_drops_a_truncated_call_and_its_result() {
        // The wedging case: a stream cut mid-argument, persisted, then resent
        // on every later turn and 422'd by the upstream.
        let mut messages = vec![
            json!({ "role": "user", "content": "write the file" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_bad",
                    "type": "function",
                    "function": { "name": "write", "arguments": "{\"path\":\"a.rs\",\"content\":\"fn ma" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_bad", "content": "stale" }),
            json!({ "role": "user", "content": "still there?" }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        // The empty assistant shell and the orphaned result are both gone.
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["content"], "write the file");
        assert_eq!(messages[1]["content"], "still there?");
    }

    #[test]
    fn sanitize_keeps_valid_siblings_of_a_poisoned_call() {
        let mut messages = vec![
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "ok", "type": "function", "function": { "name": "read", "arguments": "{\"path\":\"a\"}" } },
                    { "id": "bad", "type": "function", "function": { "name": "write", "arguments": "{\"path\":\"b" } },
                ]
            }),
            json!({ "role": "tool", "tool_call_id": "ok", "content": "contents" }),
            json!({ "role": "tool", "tool_call_id": "bad", "content": "stale" }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        let calls = messages[0]["tool_calls"].as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "ok");
        // Only the poisoned call's result was dropped.
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["tool_call_id"], "ok");
    }

    #[test]
    fn sanitize_preserves_assistant_text_when_all_calls_are_dropped() {
        let mut messages = vec![json!({
            "role": "assistant",
            "content": "I'll write that file now.",
            "tool_calls": [{
                "id": "bad",
                "type": "function",
                "function": { "name": "write", "arguments": "{\"content\":\"trunc" }
            }]
        })];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["content"], "I'll write that file now.");
        assert!(messages[0].get("tool_calls").is_none());
    }

    #[test]
    fn sanitize_then_dangling_repair_leaves_a_sendable_conversation() {
        // The two passes compose the way the orchestrator runs them: the
        // poisoned call goes away, and the surviving call that lost its result
        // gets the synthetic error reply rather than being left dangling.
        let mut messages = vec![
            json!({ "role": "user", "content": "go" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "keep", "type": "function", "function": { "name": "read", "arguments": "{}" } },
                    { "id": "poison", "type": "function", "function": { "name": "write", "arguments": "{\"a\":" } },
                ]
            }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "keep");
        // Every remaining call id has exactly one matching result.
        let ids: Vec<&str> = messages[1]["tool_calls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["keep"]);
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
        assert!(is_context_overflow_body(
            "{\"error\":{\"code\":400,\"message\":\"request (4267 tokens) exceeds the available \
             context size (4096 tokens), try increasing it\",\"type\":\"exceed_context_size_error\",\
             \"n_prompt_tokens\":4267,\"n_ctx\":4096}}"
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

    /// The shapes strict endpoints actually return, plus the two ways a false
    /// positive would arise: an error that names the field without rejecting it,
    /// and a rejection of some other field.
    #[test]
    fn detects_a_rejected_reasoning_content_field() {
        for body in [
            "Upstream returned HTTP 400: {\"error\":{\"message\":\"'messages.1' : for 'role':'assistant' the following must be satisfied[('messages.1.reasoning_content' : property 'reasoning_content' is unsupported)]\"}}",
            "Upstream returned HTTP 400: Unrecognized request argument supplied: reasoning_content",
            "Upstream returned HTTP 400: body.messages.1.reasoning_content: Extra inputs are not permitted",
            "Upstream returned HTTP 400: Invalid value for 'reasoning_content'",
        ] {
            assert!(is_reasoning_field_error(body), "missed: {body}");
        }
        assert!(!is_reasoning_field_error(
            "Upstream returned HTTP 500: reasoning_content was truncated"
        ));
        assert!(!is_reasoning_field_error(
            "Upstream returned HTTP 400: property 'audio' is unsupported"
        ));
    }

    /// A resent assistant turn keeps its `reasoning_content` through the message
    /// normalizer. Local llama.cpp templates with `preserve_thinking` re-emit
    /// prior reasoning from this field; dropping it would shrink earlier turns
    /// and force the KV-cache prefix to be reprocessed.
    #[test]
    fn parse_messages_preserves_assistant_reasoning_content() {
        let messages = json!([{
            "role": "assistant",
            "content": "the answer",
            "reasoning_content": "the thinking"
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["content"], "the answer");
        assert_eq!(out[0]["reasoning_content"], "the thinking");
    }

    /// Only assistant turns carry reasoning back. A stray field on another role
    /// is not part of the protocol, so it is dropped rather than forwarded.
    #[test]
    fn parse_messages_drops_reasoning_on_non_assistant_roles() {
        let messages = json!([
            { "role": "user", "content": "q", "reasoning_content": "nope" },
            { "role": "assistant", "content": "a" },
        ]);
        let out = parse_openai_messages(&messages).unwrap();
        assert!(out[0].get("reasoning_content").is_none());
        assert!(
            out[1].get("reasoning_content").is_none(),
            "an assistant turn with no reasoning stays unchanged"
        );
    }
}
