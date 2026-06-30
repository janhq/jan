//! The shared server-side agent orchestration loop, consumed by the API server
//! and (later) `tauri-plugin-agent`. The loop reports progress over a Tauri-free
//! `StreamEvent` sink (per-token deltas via the SSE upstream call, per-step
//! events, and one terminal `Done`/`Error`) while still returning the final
//! completion JSON, so the API server's original contract is unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use reqwest::Client;
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::{StreamEvent, Usage};
use crate::core::agent::upstream::{
    collect_mcp_openai_tools, copy_optional_chat_params, execute_mcp_tool_calls,
    extract_choice_message, extract_tool_calls, load_assistant_config, parse_openai_messages,
    resolve_upstream_for_model, set_system_prompt, stream_openai_chat_completions,
};
use crate::core::server::proxy::router_first_model;
use crate::core::server::MlxBackendSession;
use crate::core::{
    mcp::models::McpSettings,
    state::{ProviderConfig, SharedMcpServers},
};

/// All state the orchestration loop threads from multiple subsystems. Grouped
/// into a struct so the streaming and non-streaming entry points share one
/// argument surface instead of a ten-parameter signature.
pub(crate) struct OrchestrationArgs {
    pub client: Client,
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    pub llama_state: Arc<LlamacppState>,
    pub mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    pub mcp_servers: SharedMcpServers,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub jan_data_folder: String,
}

/// API-server entry point. Preserves the original single-final-JSON contract by
/// running the streamed loop with a discarded event sink.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_server_side_openai_orchestration(
    json_body: &serde_json::Value,
    client: &Client,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    llama_state: Arc<LlamacppState>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    jan_data_folder: &str,
) -> Result<serde_json::Value, String> {
    let (tx, _rx) = mpsc::unbounded_channel();
    let args = OrchestrationArgs {
        client: client.clone(),
        provider_configs,
        llama_state,
        mlx_sessions,
        mcp_servers,
        mcp_settings,
        jan_data_folder: jan_data_folder.to_string(),
    };
    run_orchestration_streamed(&tx, json_body, &args).await
}

/// Streaming entry point. Emits `Step`/`ToolCall`/`ToolResult` progress events
/// and exactly one terminal `Done`/`Error` derived from the final result, while
/// still returning the completion JSON (or error) to the caller.
pub(crate) async fn run_orchestration_streamed(
    events: &mpsc::UnboundedSender<StreamEvent>,
    json_body: &serde_json::Value,
    args: &OrchestrationArgs,
) -> Result<serde_json::Value, String> {
    let result = orchestrate_inner(events, json_body, args).await;
    match &result {
        Ok(completion) => {
            let _ = events.send(StreamEvent::Done {
                stop_reason: stop_reason_of(completion),
                usage: Usage::from_completion(completion),
            });
        }
        Err(message) => {
            let _ = events.send(StreamEvent::Error {
                code: "error".to_string(),
                message: message.clone(),
            });
        }
    }
    result
}

fn stop_reason_of(completion: &serde_json::Value) -> String {
    completion
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("finish_reason"))
        .and_then(|v| v.as_str())
        .unwrap_or("stop")
        .to_string()
}

async fn orchestrate_inner(
    events: &mpsc::UnboundedSender<StreamEvent>,
    json_body: &serde_json::Value,
    args: &OrchestrationArgs,
) -> Result<serde_json::Value, String> {
    let OrchestrationArgs {
        client,
        provider_configs,
        llama_state,
        mlx_sessions,
        mcp_servers,
        mcp_settings,
        jan_data_folder,
    } = args;

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
        if let Some(first) = router_first_model(llama_state, client).await {
            model_id = Some(first);
        }
    }
    if model_id.is_none() {
        let mlx_guard = mlx_sessions.lock().await;
        model_id = mlx_guard.values().next().map(|s| s.info.model_id.clone());
    }
    let model_id = model_id.ok_or("No running model sessions available")?;

    let (openai_tools, tool_to_server) =
        collect_mcp_openai_tools(mcp_servers, mcp_settings).await?;

    let (upstream_url, session_api_keys) = resolve_upstream_for_model(
        &model_id,
        provider_configs.clone(),
        llama_state.clone(),
        mlx_sessions.clone(),
    )
    .await?;

    let max_turns = json_body
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .unwrap_or(8)
        .clamp(1, 20) as usize;

    let mut last_response: Option<serde_json::Value> = None;

    for turn in 0..max_turns {
        let _ = events.send(StreamEvent::Step {
            index: (turn as u32) + 1,
            max: max_turns as u32,
        });

        let mut completion_map = serde_json::Map::new();
        completion_map.insert("model".to_string(), serde_json::json!(model_id));
        completion_map.insert(
            "messages".to_string(),
            serde_json::Value::Array(conversation_messages.clone()),
        );
        completion_map.insert("tool_choice".to_string(), serde_json::json!("auto"));

        if !openai_tools.is_empty() {
            completion_map.insert(
                "tools".to_string(),
                serde_json::Value::Array(openai_tools.clone()),
            );
        }

        copy_optional_chat_params(json_body, &mut completion_map);
        let request_value = serde_json::Value::Object(completion_map);

        let completion = stream_openai_chat_completions(
            client,
            &upstream_url,
            &session_api_keys,
            &request_value,
            events,
        )
        .await?;

        let tool_calls = extract_tool_calls(&completion);
        last_response = Some(completion.clone());

        if tool_calls.is_empty() {
            return Ok(completion);
        }

        for tc in &tool_calls {
            let _ = events.send(StreamEvent::ToolCall {
                id: tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                args: tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Null),
            });
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
            execute_mcp_tool_calls(&tool_calls, &tool_to_server, mcp_servers, mcp_settings).await?;

        for (tool_call_id, result_text) in tool_results {
            let _ = events.send(StreamEvent::ToolResult {
                id: tool_call_id.clone(),
                content: result_text.clone(),
                is_error: result_text.starts_with("ERROR"),
            });
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stop_reason_reads_first_choice() {
        let completion = json!({ "choices": [{ "finish_reason": "tool_calls" }] });
        assert_eq!(stop_reason_of(&completion), "tool_calls");
    }

    #[test]
    fn stop_reason_defaults_when_absent() {
        assert_eq!(stop_reason_of(&json!({ "choices": [] })), "stop");
        assert_eq!(stop_reason_of(&json!({})), "stop");
    }
}
