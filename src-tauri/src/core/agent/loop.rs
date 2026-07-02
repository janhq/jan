//! The shared server-side agent orchestration loop, consumed by the API server
//! and (later) `tauri-plugin-agent`. The loop reports progress over a Tauri-free
//! `StreamEvent` sink (per-token deltas via the SSE upstream call, per-step
//! events, and one terminal `Done`/`Error`) while still returning the final
//! completion JSON, so the API server's original contract is unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use reqwest::Client;
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::{StreamEvent, Usage};
use crate::core::agent::session::SessionBudget;
use crate::core::agent::tools::gate::PermissionDecision;
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

/// In-flight permission prompts keyed by `request_id`, shared between the loop
/// (which inserts a one-shot sender before awaiting) and the respond command
/// (which removes and resolves it).
pub(crate) type PermissionRegistry =
    Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<PermissionDecision>>>>;

static PERMISSION_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_permission_id() -> String {
    format!(
        "perm-{}",
        PERMISSION_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

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
    pub permissions: crate::core::agent::permissions::ToolPermissions,
    pub project_root: Option<std::path::PathBuf>,
    pub permission_requests: PermissionRegistry,
}

#[async_trait]
pub(crate) trait ModelInvoker: Send + Sync {
    async fn invoke(
        &self,
        request: &serde_json::Value,
        events: &mpsc::UnboundedSender<StreamEvent>,
    ) -> Result<serde_json::Value, String>;
}

#[async_trait]
pub(crate) trait ToolInvoker: Send + Sync {
    async fn invoke(
        &self,
        tool_calls: &[serde_json::Value],
    ) -> Result<Vec<(String, String)>, String>;
}

struct HttpModelInvoker {
    client: Client,
    upstream_url: String,
    api_keys: Vec<String>,
}

#[async_trait]
impl ModelInvoker for HttpModelInvoker {
    async fn invoke(
        &self,
        request: &serde_json::Value,
        events: &mpsc::UnboundedSender<StreamEvent>,
    ) -> Result<serde_json::Value, String> {
        stream_openai_chat_completions(
            &self.client,
            &self.upstream_url,
            &self.api_keys,
            request,
            events,
        )
        .await
    }
}

struct McpToolInvoker {
    tool_to_server: HashMap<String, String>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
}

#[async_trait]
impl ToolInvoker for McpToolInvoker {
    async fn invoke(
        &self,
        tool_calls: &[serde_json::Value],
    ) -> Result<Vec<(String, String)>, String> {
        execute_mcp_tool_calls(
            tool_calls,
            &self.tool_to_server,
            &self.mcp_servers,
            &self.mcp_settings,
        )
        .await
    }
}

/// Dispatches built-in tool calls to native handlers (gated by `resolve_decision`)
/// and everything else to the existing `McpToolInvoker`, preserving input order.
struct CompositeToolInvoker {
    mcp: McpToolInvoker,
    project_root: std::path::PathBuf,
    permissions: crate::core::agent::permissions::ToolPermissions,
    events: mpsc::UnboundedSender<StreamEvent>,
    permission_requests: PermissionRegistry,
    grants: std::sync::Mutex<crate::core::agent::tools::gate::SessionGrants>,
}

#[async_trait]
impl ToolInvoker for CompositeToolInvoker {
    async fn invoke(
        &self,
        tool_calls: &[serde_json::Value],
    ) -> Result<Vec<(String, String)>, String> {
        use crate::core::agent::tools::{
            gate::{resolve_decision, Decision, PromptKind},
            handlers::execute_builtin,
            is_builtin, lookup, Capability,
        };
        let mut out: Vec<(String, String)> = Vec::with_capacity(tool_calls.len());
        let mut mcp_calls: Vec<serde_json::Value> = Vec::new();
        for tc in tool_calls {
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !is_builtin(name) {
                mcp_calls.push(tc.clone());
                continue;
            }
            let id = tc
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let args: serde_json::Value = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::Value::Object(Default::default()));
            let tool = lookup(name).expect("is_builtin implies lookup");
            let snapshot = { *self.grants.lock().unwrap() };
            let decision = resolve_decision(
                tool,
                &args,
                &self.project_root,
                &self.permissions,
                &snapshot,
            );
            let text = match decision {
                Decision::Allow => execute_builtin(tool, &args, &self.project_root).await,
                Decision::HardDeny => {
                    format!("ERROR: tool '{name}' denied by project policy")
                }
                Decision::Prompt(kind) => {
                    let request_id = next_permission_id();
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    self.permission_requests
                        .lock()
                        .await
                        .insert(request_id.clone(), tx);
                    let capability = match tool.capability {
                        Capability::Read => "read",
                        Capability::Write => "write",
                        Capability::Exec => "exec",
                    };
                    let prompt_kind = match kind {
                        PromptKind::ReadEscape => "read_escape",
                        PromptKind::Write => "write",
                        PromptKind::Exec => "exec",
                    };
                    let path = tool
                        .path_args
                        .first()
                        .and_then(|k| args.get(*k))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let _ = self.events.send(StreamEvent::PermissionRequest {
                        request_id: request_id.clone(),
                        tool_name: name.to_string(),
                        capability: capability.to_string(),
                        path,
                        prompt_kind: prompt_kind.to_string(),
                        offers_always: true,
                    });
                    // Sender dropped (client gone / run cancelled) => Deny. No timeout:
                    // the run is cancellable via agent_cancel, which drops this future.
                    let decision = rx.await.unwrap_or(PermissionDecision::Deny);
                    // Best-effort cleanup if the respond command didn't consume it.
                    self.permission_requests.lock().await.remove(&request_id);
                    match decision {
                        PermissionDecision::AllowOnce => {
                            execute_builtin(tool, &args, &self.project_root).await
                        }
                        PermissionDecision::AllowAlways => {
                            self.grants.lock().unwrap().grant(kind);
                            // Persist for future runs (best-effort; the session
                            // grant above already covers the rest of this run).
                            let write_capable =
                                matches!(tool.capability, Capability::Write | Capability::Exec);
                            if let Err(e) = crate::core::agent::project::grant_tool_in_agent_toml(
                                &self.project_root,
                                name,
                                write_capable,
                            ) {
                                log::warn!("failed to persist always-allow for '{name}': {e}");
                            }
                            execute_builtin(tool, &args, &self.project_root).await
                        }
                        PermissionDecision::Deny => {
                            format!("ERROR: tool '{name}' denied by user")
                        }
                    }
                }
            };
            out.push((id, text));
        }
        if !mcp_calls.is_empty() {
            out.extend(self.mcp.invoke(&mcp_calls).await?);
        }
        let order: HashMap<&str, usize> = tool_calls
            .iter()
            .enumerate()
            .filter_map(|(i, tc)| tc.get("id").and_then(|v| v.as_str()).map(|id| (id, i)))
            .collect();
        out.sort_by_key(|(id, _)| *order.get(id.as_str()).unwrap_or(&usize::MAX));
        Ok(out)
    }
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
        permissions: crate::core::agent::permissions::ToolPermissions::allow_all(),
        project_root: None,
        permission_requests: Arc::new(Mutex::new(HashMap::new())),
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

/// Restrict the collected MCP tools to `allowed` (by tool name), pruning both
/// the OpenAI tool array and the tool->server routing map in lockstep.
fn apply_tool_allowlist(
    openai_tools: &mut Vec<serde_json::Value>,
    tool_to_server: &mut HashMap<String, String>,
    allowed: &[String],
) {
    let allow: std::collections::HashSet<&str> = allowed.iter().map(String::as_str).collect();
    openai_tools.retain(|t| {
        t.get("function")
            .and_then(|f| f.get("name"))
            .and_then(|n| n.as_str())
            .map(|n| allow.contains(n))
            .unwrap_or(false)
    });
    tool_to_server.retain(|name, _| allow.contains(name.as_str()));
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
        permissions,
        project_root,
        permission_requests,
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

    let (mut openai_tools, mut tool_to_server) =
        collect_mcp_openai_tools(mcp_servers, mcp_settings).await?;

    // Optional per-run allowlist: when `allowed_tools` is present, expose only
    // those MCP tools (an empty array means no tools). Absent = all tools.
    if let Some(allowed) = json_body.get("allowed_tools").and_then(|v| v.as_array()) {
        let names: Vec<String> = allowed
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
        apply_tool_allowlist(&mut openai_tools, &mut tool_to_server, &names);
    }

    // Permission gate: prune tools the agent is not permitted to call before the
    // model sees them. Proxy path uses `allow_all()` (unchanged behavior).
    openai_tools.retain(|t| {
        t.get("function")
            .and_then(|f| f.get("name"))
            .and_then(|n| n.as_str())
            .map(|n| permissions.permits(n))
            .unwrap_or(false)
    });
    tool_to_server.retain(|name, _| permissions.permits(name));

    if project_root.is_some() {
        // Built-ins are governed by the capability gate at execution time, so here
        // we only drop tools explicitly denied in agent.toml (and honor allowed_tools
        // if the request set one). Advertisement is independent of the read-only
        // default that applies to opaque MCP tools.
        let allowed_names: Option<std::collections::HashSet<String>> = json_body
            .get("allowed_tools")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });
        for schema in crate::core::agent::tools::schema::builtin_tool_schemas() {
            let name = schema["function"]["name"].as_str().unwrap_or_default();
            if permissions.is_denied(name) {
                continue;
            }
            if let Some(allow) = &allowed_names {
                if !allow.contains(name) {
                    continue;
                }
            }
            openai_tools.push(schema);
        }
    }

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
        .clamp(1, 400) as usize;

    let http_model = HttpModelInvoker {
        client: client.clone(),
        upstream_url,
        api_keys: session_api_keys,
    };
    let mcp_tools = McpToolInvoker {
        tool_to_server,
        mcp_servers: mcp_servers.clone(),
        mcp_settings: mcp_settings.clone(),
    };

    let max_session_tokens = json_body.get("max_session_tokens").and_then(|v| v.as_u64());
    let mut budget = SessionBudget::new(max_session_tokens);

    if let Some(root) = project_root {
        let tools = CompositeToolInvoker {
            mcp: mcp_tools,
            project_root: root.clone(),
            permissions: permissions.clone(),
            events: events.clone(),
            permission_requests: permission_requests.clone(),
            grants: std::sync::Mutex::new(crate::core::agent::tools::gate::SessionGrants::default()),
        };
        run_turn_cycle(
            events,
            json_body,
            &model_id,
            &openai_tools,
            conversation_messages,
            max_turns,
            &mut budget,
            &http_model,
            &tools,
        )
        .await
    } else {
        run_turn_cycle(
            events,
            json_body,
            &model_id,
            &openai_tools,
            conversation_messages,
            max_turns,
            &mut budget,
            &http_model,
            &mcp_tools,
        )
        .await
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_turn_cycle(
    events: &mpsc::UnboundedSender<StreamEvent>,
    json_body: &serde_json::Value,
    model_id: &str,
    openai_tools: &[serde_json::Value],
    mut conversation_messages: Vec<serde_json::Value>,
    max_turns: usize,
    budget: &mut SessionBudget,
    model: &dyn ModelInvoker,
    tools: &dyn ToolInvoker,
) -> Result<serde_json::Value, String> {
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
                serde_json::Value::Array(openai_tools.to_vec()),
            );
        }

        copy_optional_chat_params(json_body, &mut completion_map);
        let request_value = serde_json::Value::Object(completion_map);

        let completion = model.invoke(&request_value, events).await?;

        budget.record(&Usage::from_completion(&completion));

        let tool_calls = extract_tool_calls(&completion);
        last_response = Some(completion.clone());

        if tool_calls.is_empty() {
            return Ok(completion);
        }

        if budget.exhausted() {
            return Err(format!(
                "session token budget exhausted ({} tokens) before resolving tool calls",
                budget.spent()
            ));
        }

        for tc in &tool_calls {
            let _ = events.send(StreamEvent::ToolCall {
                id: tc
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
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

        let tool_results = tools.invoke(&tool_calls).await?;

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
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;

    struct MockModel {
        responses: StdMutex<VecDeque<serde_json::Value>>,
    }
    impl MockModel {
        fn new(responses: Vec<serde_json::Value>) -> Self {
            Self {
                responses: StdMutex::new(responses.into_iter().collect()),
            }
        }
    }
    #[async_trait]
    impl ModelInvoker for MockModel {
        async fn invoke(
            &self,
            _request: &serde_json::Value,
            _events: &mpsc::UnboundedSender<StreamEvent>,
        ) -> Result<serde_json::Value, String> {
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| "mock model exhausted".to_string())
        }
    }

    #[derive(Default)]
    struct MockTool {
        calls: StdMutex<Vec<Vec<serde_json::Value>>>,
    }
    #[async_trait]
    impl ToolInvoker for MockTool {
        async fn invoke(
            &self,
            tool_calls: &[serde_json::Value],
        ) -> Result<Vec<(String, String)>, String> {
            self.calls.lock().unwrap().push(tool_calls.to_vec());
            Ok(tool_calls
                .iter()
                .map(|tc| {
                    let id = tc
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (id, "MOCK_RESULT".to_string())
                })
                .collect())
        }
    }

    fn tool_call_completion() -> serde_json::Value {
        json!({
            "choices": [{
                "message": {
                    "content": serde_json::Value::Null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "search", "arguments": "{\"q\":\"rust\"}" }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        })
    }

    #[tokio::test]
    async fn turn_cycle_executes_tool_then_returns_final() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let model = MockModel::new(vec![
            tool_call_completion(),
            json!({ "choices": [{ "message": { "content": "final answer" }, "finish_reason": "stop" }] }),
        ]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let convo = vec![json!({ "role": "user", "content": "hi" })];

        let result = run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            convo,
            8,
            &mut budget,
            &model,
            &tool,
        )
        .await
        .unwrap();

        assert_eq!(result["choices"][0]["message"]["content"], "final answer");
        assert_eq!(tool.calls.lock().unwrap().len(), 1);
        assert_eq!(tool.calls.lock().unwrap()[0][0]["id"], "call_1");

        drop(tx);
        let mut saw_tool_call = false;
        let mut saw_tool_result = false;
        while let Some(ev) = rx.recv().await {
            match ev {
                StreamEvent::ToolCall { name, .. } => {
                    if name == "search" {
                        saw_tool_call = true;
                    }
                }
                StreamEvent::ToolResult { content, .. } => {
                    if content == "MOCK_RESULT" {
                        saw_tool_result = true;
                    }
                }
                _ => {}
            }
        }
        assert!(saw_tool_call && saw_tool_result);
    }

    #[tokio::test]
    async fn turn_cycle_stops_when_budget_exhausted() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut over_budget = tool_call_completion();
        over_budget["usage"] = json!({ "total_tokens": 100 });
        let model = MockModel::new(vec![over_budget]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(Some(50));
        let convo = vec![json!({ "role": "user", "content": "hi" })];

        let err = run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            convo,
            8,
            &mut budget,
            &model,
            &tool,
        )
        .await
        .unwrap_err();

        assert!(err.contains("budget"), "unexpected error: {err}");
        assert!(
            tool.calls.lock().unwrap().is_empty(),
            "tool must not run once budget is exhausted"
        );
    }

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

    #[test]
    fn tool_allowlist_keeps_only_named_tools() {
        let mut tools = vec![
            json!({ "type": "function", "function": { "name": "search" } }),
            json!({ "type": "function", "function": { "name": "write" } }),
        ];
        let mut map = HashMap::from([
            ("search".to_string(), "srv".to_string()),
            ("write".to_string(), "srv".to_string()),
        ]);

        apply_tool_allowlist(&mut tools, &mut map, &["search".to_string()]);

        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["function"]["name"], "search");
        assert_eq!(map.keys().collect::<Vec<_>>(), vec!["search"]);
    }

    use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};
    use crate::core::agent::tools::gate::{PermissionDecision, SessionGrants};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_ROOT_SEQ: AtomicUsize = AtomicUsize::new(0);

    fn unique_project_root() -> std::path::PathBuf {
        let n = TEST_ROOT_SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("jan_loop_perm_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    fn write_call() -> serde_json::Value {
        json!({
            "id": "c1",
            "type": "function",
            "function": {
                "name": "write",
                "arguments": "{\"path\":\"out.txt\",\"content\":\"hi\"}"
            }
        })
    }

    fn build_prompting_invoker(
        root: std::path::PathBuf,
        events: mpsc::UnboundedSender<StreamEvent>,
        registry: PermissionRegistry,
    ) -> CompositeToolInvoker {
        CompositeToolInvoker {
            mcp: McpToolInvoker {
                tool_to_server: HashMap::new(),
                mcp_servers: Arc::new(Mutex::new(HashMap::new())),
                mcp_settings: Arc::new(Mutex::new(McpSettings::default())),
            },
            project_root: root,
            // Read-only default => write PROMPTS.
            permissions: ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]),
            events,
            permission_requests: registry,
            grants: std::sync::Mutex::new(SessionGrants::default()),
        }
    }

    async fn respond_once(
        rx: &mut mpsc::UnboundedReceiver<StreamEvent>,
        registry: &PermissionRegistry,
        decision: PermissionDecision,
    ) {
        loop {
            match rx.recv().await {
                Some(StreamEvent::PermissionRequest { request_id, .. }) => {
                    let tx = registry.lock().await.remove(&request_id);
                    if let Some(tx) = tx {
                        let _ = tx.send(decision);
                    }
                    return;
                }
                Some(_) => continue,
                None => return,
            }
        }
    }

    #[tokio::test]
    async fn prompt_allow_once_executes_and_writes() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = Arc::new(build_prompting_invoker(root.clone(), tx, registry.clone()));

        let responder = {
            let registry = registry.clone();
            tokio::spawn(async move {
                respond_once(&mut rx, &registry, PermissionDecision::AllowOnce).await;
            })
        };

        let calls = vec![write_call()];
        let out = invoker.invoke(&calls).await.unwrap();
        responder.await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(!out[0].1.starts_with("ERROR"), "unexpected: {}", out[0].1);
        assert_eq!(std::fs::read_to_string(root.join("out.txt")).unwrap(), "hi");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn prompt_deny_reports_error_and_skips_write() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = Arc::new(build_prompting_invoker(root.clone(), tx, registry.clone()));

        let responder = {
            let registry = registry.clone();
            tokio::spawn(async move {
                respond_once(&mut rx, &registry, PermissionDecision::Deny).await;
            })
        };

        let calls = vec![write_call()];
        let out = invoker.invoke(&calls).await.unwrap();
        responder.await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(out[0].1.contains("denied by user"), "got: {}", out[0].1);
        assert!(!root.join("out.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn allow_always_grants_and_second_call_skips_prompt() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = Arc::new(build_prompting_invoker(root.clone(), tx, registry.clone()));

        // Responder answers ONLY the first request with AllowAlways, then counts
        // any further PermissionRequests (there must be none).
        let extra_requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let responder = {
            let registry = registry.clone();
            let extra = extra_requests.clone();
            tokio::spawn(async move {
                respond_once(&mut rx, &registry, PermissionDecision::AllowAlways).await;
                while let Some(ev) = rx.recv().await {
                    if matches!(ev, StreamEvent::PermissionRequest { .. }) {
                        extra.fetch_add(1, Ordering::SeqCst);
                    }
                }
            })
        };

        let out1 = invoker.invoke(&[write_call()]).await.unwrap();
        assert!(!out1[0].1.starts_with("ERROR"), "first: {}", out1[0].1);

        let second = json!({
            "id": "c2",
            "type": "function",
            "function": {
                "name": "write",
                "arguments": "{\"path\":\"out2.txt\",\"content\":\"yo\"}"
            }
        });
        let out2 = invoker.invoke(&[second]).await.unwrap();
        assert!(!out2[0].1.starts_with("ERROR"), "second: {}", out2[0].1);

        drop(invoker); // close events channel so responder loop ends
        responder.await.unwrap();

        assert_eq!(
            extra_requests.load(Ordering::SeqCst),
            0,
            "second write must not prompt again after AllowAlways"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("out2.txt")).unwrap(),
            "yo"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn tool_allowlist_empty_removes_all() {
        let mut tools = vec![json!({ "type": "function", "function": { "name": "search" } })];
        let mut map = HashMap::from([("search".to_string(), "srv".to_string())]);

        apply_tool_allowlist(&mut tools, &mut map, &[]);

        assert!(tools.is_empty());
        assert!(map.is_empty());
    }
}
