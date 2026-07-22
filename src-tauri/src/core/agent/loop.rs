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
#[derive(Clone)]
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
    /// When set, used verbatim as the system prompt, bypassing project-context
    /// assembly and memory recall/indexing. Set for subagent child runs so a
    /// dispatched subagent gets exactly its definition prompt with no parent
    /// context bleed. `None` for normal runs.
    pub system_prompt_override: Option<String>,
    /// Whether this run may dispatch subagents. `false` for child runs, which
    /// caps recursion depth at one (a subagent cannot spawn grandchildren).
    pub subagents_enabled: bool,
    /// `--yolo`: disable the sandbox/permission gate and auto-allow every tool
    /// call (built-in reads/writes/exec and MCP) without prompting. Inherited by
    /// dispatched subagents via the cloned parent args.
    pub yolo: bool,
}

#[async_trait]
pub(crate) trait ModelInvoker: Send + Sync {
    async fn invoke(
        &self,
        request: &serde_json::Value,
        events: &mpsc::UnboundedSender<StreamEvent>,
    ) -> Result<serde_json::Value, String>;
}

/// One tool call's outcome: `content` is the model-facing result string,
/// `diff` is display-only focused-change text (`write`/`edit` only).
pub(crate) struct ToolOutcome {
    pub id: String,
    pub content: String,
    pub diff: Option<String>,
}

impl ToolOutcome {
    fn plain(id: String, content: String) -> Self {
        Self {
            id,
            content,
            diff: None,
        }
    }
}

#[async_trait]
pub(crate) trait ToolInvoker: Send + Sync {
    async fn invoke(&self, tool_calls: &[serde_json::Value])
        -> Result<Vec<ToolOutcome>, String>;
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
    ) -> Result<Vec<ToolOutcome>, String> {
        let results = execute_mcp_tool_calls(
            tool_calls,
            &self.tool_to_server,
            &self.mcp_servers,
            &self.mcp_settings,
        )
        .await;
        Ok(results
            .into_iter()
            .map(|(id, content)| ToolOutcome::plain(id, content))
            .collect::<Vec<_>>())
    }
}

/// Context the invoker needs to dispatch subagents. `None` when subagents are
/// disabled for this run (a child run, or the proxy path), in which case a
/// subagent tool call returns an error instead of spawning a nested run.
struct SubagentContext {
    parent_args: OrchestrationArgs,
    model_id: String,
    max_session_tokens: Option<u64>,
    /// Background children of this run, aborted when the run ends.
    bg: std::sync::Arc<crate::core::agent::subagent::BackgroundSubagents>,
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
    subagents: Option<SubagentContext>,
    yolo: bool,
}

impl CompositeToolInvoker {
    /// Prompt the user to approve an MCP tool call, mirroring the built-in gate.
    /// A dropped responder (client gone / run cancelled) resolves to Deny.
    async fn prompt_mcp_permission(&self, tool_name: &str) -> PermissionDecision {
        let request_id = next_permission_id();
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.permission_requests
            .lock()
            .await
            .insert(request_id.clone(), tx);
        let _ = self.events.send(StreamEvent::PermissionRequest {
            request_id: request_id.clone(),
            tool_name: tool_name.to_string(),
            capability: "run".to_string(),
            path: None,
            command: None,
            diff: None,
            prompt_kind: "mcp".to_string(),
            offers_always: true,
        });
        let decision = rx.await.unwrap_or(PermissionDecision::Deny);
        self.permission_requests.lock().await.remove(&request_id);
        decision
    }

    /// Prompt the user to approve a `user`-scope subagent write (it persists
    /// outside the current project). Project-scope writes are not prompted.
    async fn prompt_subagent_create(&self, name: &str) -> PermissionDecision {
        let request_id = next_permission_id();
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.permission_requests
            .lock()
            .await
            .insert(request_id.clone(), tx);
        let _ = self.events.send(StreamEvent::PermissionRequest {
            request_id: request_id.clone(),
            tool_name: "create_subagent".to_string(),
            capability: "write".to_string(),
            path: Some(name.to_string()),
            command: None,
            diff: None,
            prompt_kind: "subagent_create".to_string(),
            offers_always: false,
        });
        let decision = rx.await.unwrap_or(PermissionDecision::Deny);
        self.permission_requests.lock().await.remove(&request_id);
        decision
    }

    /// Execute one subagent tool call, returning the model-facing result string
    /// (an `ERROR:`-prefixed message on failure, matching the tool-result
    /// convention). The registry is loaded fresh from disk each call so a
    /// just-created subagent is immediately dispatchable within the same run.
    async fn handle_subagent_tool(&self, name: &str, args: &serde_json::Value) -> String {
        use crate::core::agent::subagent::{
            await_subagent, format_subagent_list, parse_await_args, parse_create_args,
            parse_dispatch_args, spawn_subagent, subagent_dir_for, SubagentRegistry, SubagentScope,
        };
        let Some(ctx) = &self.subagents else {
            return "ERROR: subagents are not available in this run".to_string();
        };
        match name {
            "list_subagents" => {
                let registry = SubagentRegistry::load(&self.project_root);
                format_subagent_list(&registry)
            }
            "dispatch_subagent" => {
                let req = match parse_dispatch_args(args) {
                    Ok(r) => r,
                    Err(e) => return format!("ERROR: {e}"),
                };
                match spawn_subagent(
                    &ctx.bg,
                    &ctx.parent_args,
                    req,
                    &ctx.model_id,
                    ctx.max_session_tokens,
                    &self.events,
                ) {
                    Ok(run_id) => format!(
                        "Subagent started in the background. run_id={run_id}. Continue working, then call await_subagent with this run_id to collect its result."
                    ),
                    Err(e) => format!("ERROR: {e}"),
                }
            }
            "await_subagent" => {
                let run_id = match parse_await_args(args) {
                    Ok(r) => r,
                    Err(e) => return format!("ERROR: {e}"),
                };
                match await_subagent(&ctx.bg, &run_id).await {
                    Ok(text) if text.trim().is_empty() => {
                        "The subagent finished but produced no text output.".to_string()
                    }
                    Ok(text) => text,
                    Err(e) => format!("ERROR: {e}"),
                }
            }
            "create_subagent" => {
                let (def, scope, overwrite) = match parse_create_args(args) {
                    Ok(v) => v,
                    Err(e) => return format!("ERROR: {e}"),
                };
                if scope == SubagentScope::User {
                    match self.prompt_subagent_create(&def.name).await {
                        PermissionDecision::AllowOnce | PermissionDecision::AllowAlways => {}
                        PermissionDecision::Deny => {
                            return "ERROR: user-scope subagent creation denied by user".to_string()
                        }
                    }
                }
                let dir = match subagent_dir_for(&self.project_root, scope) {
                    Ok(d) => d,
                    Err(e) => return format!("ERROR: {e}"),
                };
                let scope_label = match scope {
                    SubagentScope::User => "user",
                    SubagentScope::Project => "project",
                };
                let mut registry = SubagentRegistry::load(&self.project_root);
                match registry.create_in(&dir, def.clone(), scope, overwrite) {
                    Ok(shadows) => {
                        let mut msg = format!("Created {scope_label}-scope subagent '{}'.", def.name);
                        if shadows {
                            msg.push_str(
                                " Note: it shadows a user-scope subagent of the same name.",
                            );
                        }
                        msg
                    }
                    Err(e) => format!("ERROR: {e}"),
                }
            }
            _ => "ERROR: unknown subagent tool".to_string(),
        }
    }
}

#[async_trait]
impl ToolInvoker for CompositeToolInvoker {
    async fn invoke(
        &self,
        tool_calls: &[serde_json::Value],
    ) -> Result<Vec<ToolOutcome>, String> {
        use crate::core::agent::tools::{
            gate::{resolve_decision, Decision, PromptKind},
            handlers::{execute_builtin_with_diff, preview_diff},
            is_builtin, lookup, Capability,
        };
        let mut out: Vec<ToolOutcome> = Vec::with_capacity(tool_calls.len());
        let mut mcp_calls: Vec<serde_json::Value> = Vec::new();
        // Auto-allowed read-only built-ins (no prompt, no filesystem mutation)
        // are deferred and executed concurrently after the gating pass. Anything
        // that prompts, writes, execs, or dispatches stays sequential so
        // permission prompts don't interleave and writes can't race.
        let mut read_futures = Vec::new();
        for tc in tool_calls {
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Subagent tools are handled ahead of the fs/exec gate and the MCP
            // fallback: they orchestrate nested runs, not filesystem access.
            if crate::core::agent::subagent::is_subagent_tool(name) {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let args: serde_json::Value = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Object(Default::default()));
                let content = self.handle_subagent_tool(name, &args).await;
                out.push(ToolOutcome::plain(id, content));
                continue;
            }
            if !is_builtin(name) {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                // Deny-listed MCP tools are never advertised, but guard anyway.
                if self.permissions.is_denied(name) {
                    out.push(ToolOutcome::plain(
                        id,
                        format!("ERROR: tool '{name}' denied by project policy"),
                    ));
                    continue;
                }
                if self.yolo || self.grants.lock().unwrap().covers_mcp(name) {
                    mcp_calls.push(tc.clone());
                    continue;
                }
                match self.prompt_mcp_permission(name).await {
                    PermissionDecision::AllowOnce => mcp_calls.push(tc.clone()),
                    PermissionDecision::AllowAlways => {
                        self.grants.lock().unwrap().grant_mcp(name);
                        mcp_calls.push(tc.clone());
                    }
                    PermissionDecision::Deny => out.push(ToolOutcome::plain(
                        id,
                        format!("ERROR: tool '{name}' denied by user"),
                    )),
                }
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
            let snapshot = { self.grants.lock().unwrap().clone() };
            let decision = resolve_decision(
                tool,
                &args,
                &self.project_root,
                &self.permissions,
                &snapshot,
            );
            // --yolo suppresses every prompt (sandbox escape, write, exec) but
            // still honors HardDeny, so the `.jan/agent` restricted-path invariant
            // and explicit agent.toml denies hold.
            let decision = match decision {
                Decision::Prompt(_) if self.yolo => Decision::Allow,
                other => other,
            };
            // Read and Net tools are non-mutating and safe to run concurrently
            // once allowed: reads hit the filesystem, web tools do outbound HTTP.
            if matches!(decision, Decision::Allow)
                && matches!(tool.capability, Capability::Read | Capability::Net)
            {
                let root = self.project_root.clone();
                read_futures.push(async move {
                    let (text, diff) = execute_builtin_with_diff(tool, &args, &root).await;
                    ToolOutcome {
                        id,
                        content: text,
                        diff,
                    }
                });
                continue;
            }
            let (text, diff) = match decision {
                Decision::Allow => execute_builtin_with_diff(tool, &args, &self.project_root).await,
                Decision::HardDeny => {
                    (format!("ERROR: tool '{name}' denied by project policy"), None)
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
                        // Net tools resolve to Allow in the gate and never reach
                        // this prompt arm; label defensively for completeness.
                        Capability::Net => "net",
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
                    let command = matches!(tool.capability, Capability::Exec)
                        .then(|| args.get("command").and_then(|v| v.as_str()))
                        .flatten()
                        .map(String::from);
                    let diff = preview_diff(tool, &args, &self.project_root).await;
                    let _ = self.events.send(StreamEvent::PermissionRequest {
                        request_id: request_id.clone(),
                        tool_name: name.to_string(),
                        capability: capability.to_string(),
                        path,
                        command,
                        diff,
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
                            execute_builtin_with_diff(tool, &args, &self.project_root).await
                        }
                        PermissionDecision::AllowAlways => {
                            // Thread-scoped only; never persisted to agent.toml.
                            // Exec grants are scoped to the base command so that
                            // "allow always" for `git status` covers `git ...`
                            // but not arbitrary shell commands.
                            if matches!(tool.capability, Capability::Exec) {
                                let command =
                                    args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                                self.grants.lock().unwrap().grant_command(command);
                            } else {
                                self.grants.lock().unwrap().grant(kind);
                            }
                            execute_builtin_with_diff(tool, &args, &self.project_root).await
                        }
                        PermissionDecision::Deny => {
                            (format!("ERROR: tool '{name}' denied by user"), None)
                        }
                    }
                }
            };
            out.push(ToolOutcome {
                id,
                content: text,
                diff,
            });
        }
        if !read_futures.is_empty() {
            out.extend(futures::future::join_all(read_futures).await);
        }
        if !mcp_calls.is_empty() {
            out.extend(self.mcp.invoke(&mcp_calls).await?);
        }
        let order: HashMap<&str, usize> = tool_calls
            .iter()
            .enumerate()
            .filter_map(|(i, tc)| tc.get("id").and_then(|v| v.as_str()).map(|id| (id, i)))
            .collect();
        out.sort_by_key(|o| *order.get(o.id.as_str()).unwrap_or(&usize::MAX));
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
        system_prompt_override: None,
        subagents_enabled: false,
        yolo: false,
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

/// Keep only MCP tools advertised under the agent.toml policy (see
/// `ToolPermissions::advertises_mcp`), pruning the OpenAI tool array and the
/// tool->server map in lockstep. The read-only default does NOT suppress MCP
/// advertisement; only an explicit deny (or `default = "deny"`) does.
fn retain_advertisable_mcp_tools(
    openai_tools: &mut Vec<serde_json::Value>,
    tool_to_server: &mut HashMap<String, String>,
    permissions: &crate::core::agent::permissions::ToolPermissions,
) {
    openai_tools.retain(|t| {
        t.get("function")
            .and_then(|f| f.get("name"))
            .and_then(|n| n.as_str())
            .map(|n| permissions.advertises_mcp(n))
            .unwrap_or(false)
    });
    tool_to_server.retain(|name, _| permissions.advertises_mcp(name));
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

/// Text of the most recent `user` message. Handles both string content and the
/// multimodal array form (text parts concatenated). None if there is no user turn.
fn latest_user_text(messages: &[serde_json::Value]) -> Option<String> {
    let content = messages
        .iter()
        .rev()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))?
        .get("content")?;
    match content {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(parts) => {
            let text: String = parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" ");
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
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
        system_prompt_override,
        subagents_enabled,
        yolo,
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

    let system_prompt = if let Some(override_prompt) = system_prompt_override.clone() {
        Some(override_prompt)
    } else if let Some(root) = project_root {
        let mut sp = crate::core::agent::context::build_system_prompt(
            assistant_instructions.as_deref(),
            root,
            *subagents_enabled,
        );
        // Recall project memory for the current query before it is indexed, so
        // the active turn cannot surface itself.
        if let Some(query) = latest_user_text(&conversation_messages) {
            if let Some(mem) = crate::core::agent::memory::retrieve_block(root, &query) {
                sp = Some(match sp {
                    Some(s) => format!("{s}\n\n{mem}"),
                    None => mem,
                });
            }
        }
        sp
    } else {
        assistant_instructions
    };
    if let Some(sys) = system_prompt {
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

    // Advertise MCP tools per agent.toml policy: read-only (the CLI default) does
    // NOT suppress them; only an explicit deny or `default = "deny"` does. Proxy
    // path uses `allow_all()`, so behavior there is unchanged.
    retain_advertisable_mcp_tools(&mut openai_tools, &mut tool_to_server, permissions);

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
        // Subagent tools are advertised only when this run may dispatch them
        // (never for a child run, capping recursion depth at one). The dispatch
        // tool's description lists the resolvable subagent names.
        if args.subagents_enabled {
            if let Some(root) = project_root {
                let registry = crate::core::agent::subagent::SubagentRegistry::load(root);
                for schema in crate::core::agent::subagent::subagent_tool_schemas(&registry) {
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
        }
    }

    let (upstream_url, session_api_keys) = resolve_upstream_for_model(
        &model_id,
        provider_configs.clone(),
        llama_state.clone(),
        mlx_sessions.clone(),
    )
    .await?;

    // Explicit values pass through unclamped; `0` means unbounded (guarded by
    // the session token budget and cancellation). Absent falls back to 8 for
    // the proxy path, which has no interactive cancel.
    let max_turns = json_body
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .unwrap_or(8) as usize;

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
        // Subagent (override) runs are ephemeral: their turns are never indexed
        // into project memory, so a child cannot pollute the parent's recall.
        let index_memory = system_prompt_override.is_none();
        if index_memory {
            if let Some(query) = latest_user_text(&conversation_messages) {
                crate::core::agent::memory::index_message(root, "user", &query);
            }
        }
        // Background subagents are scoped to this run: `_bg_guard` aborts any
        // still-running child when `orchestrate_inner` returns or is cancelled.
        let bg = std::sync::Arc::new(crate::core::agent::subagent::BackgroundSubagents::default());
        let _bg_guard = crate::core::agent::subagent::AbortOnDrop(bg.clone());
        let subagents = args.subagents_enabled.then(|| SubagentContext {
            parent_args: args.clone(),
            model_id: model_id.clone(),
            max_session_tokens,
            bg: bg.clone(),
        });
        let tools = CompositeToolInvoker {
            mcp: mcp_tools,
            project_root: root.clone(),
            permissions: permissions.clone(),
            events: events.clone(),
            permission_requests: permission_requests.clone(),
            grants: std::sync::Mutex::new(crate::core::agent::tools::gate::SessionGrants::default()),
            subagents,
            yolo: *yolo,
        };
        let result = run_turn_cycle(
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
        .await;
        // On a clean exit, wait for any subagents the model dispatched but never
        // explicitly awaited, so their in-flight work isn't aborted and lost by
        // `_bg_guard`. On an error, teardown still aborts them.
        if result.is_ok() {
            bg.join_all().await;
        }
        if index_memory {
            if let Ok(completion) = &result {
                if let Some(answer) = extract_choice_message(completion)
                    .and_then(|m| m.get("content").and_then(|c| c.as_str()).map(str::to_string))
                {
                    crate::core::agent::memory::index_message(root, "assistant", &answer);
                }
            }
        }
        result
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

/// Upper bound on compaction retries per model call, so a persistently
/// overflowing request fails loudly instead of looping forever.
const MAX_COMPACTION_ATTEMPTS: usize = 4;

/// Build one OpenAI chat-completion request from the current conversation.
fn build_completion_request(
    model_id: &str,
    conversation_messages: &[serde_json::Value],
    openai_tools: &[serde_json::Value],
    json_body: &serde_json::Value,
) -> serde_json::Value {
    let mut completion_map = serde_json::Map::new();
    completion_map.insert("model".to_string(), serde_json::json!(model_id));
    completion_map.insert(
        "messages".to_string(),
        serde_json::Value::Array(conversation_messages.to_vec()),
    );
    completion_map.insert("tool_choice".to_string(), serde_json::json!("auto"));
    if !openai_tools.is_empty() {
        completion_map.insert(
            "tools".to_string(),
            serde_json::Value::Array(openai_tools.to_vec()),
        );
    }
    copy_optional_chat_params(json_body, &mut completion_map);
    serde_json::Value::Object(completion_map)
}

/// Manually compact `messages` for the given model, resolving the upstream from
/// `args` and reusing the same summarization path as the reactive loop. Used by
/// the TUI `/compact` command, which holds `OrchestrationArgs` + a model id but
/// no `ModelInvoker`.
#[cfg(feature = "cli")]
pub(crate) async fn compact_history(
    args: &OrchestrationArgs,
    model_id: &str,
    messages: &[serde_json::Value],
    keep_recent: usize,
) -> Result<Vec<serde_json::Value>, String> {
    let (upstream_url, api_keys) = resolve_upstream_for_model(
        model_id,
        args.provider_configs.clone(),
        args.llama_state.clone(),
        args.mlx_sessions.clone(),
    )
    .await?;
    let model = HttpModelInvoker {
        client: args.client.clone(),
        upstream_url,
        api_keys,
    };
    Ok(crate::core::agent::compaction::compact_conversation(
        messages,
        model_id,
        &model,
        keep_recent,
    )
    .await)
}

/// Run one stateless `/goal` evaluation against `smol_model_id` (the session's
/// fast "smol" role). Mirrors [`compact_history`]: resolve the upstream for the
/// evaluator model, then make a single tool-free model call that judges whether
/// `condition` is satisfied by `messages`. No tools, no streaming to the user.
pub(crate) async fn evaluate_goal(
    args: &OrchestrationArgs,
    smol_model_id: &str,
    condition: &str,
    messages: &[serde_json::Value],
) -> Result<crate::core::agent::goal::GoalVerdict, String> {
    let (upstream_url, api_keys) = resolve_upstream_for_model(
        smol_model_id,
        args.provider_configs.clone(),
        args.llama_state.clone(),
        args.mlx_sessions.clone(),
    )
    .await?;
    let model = HttpModelInvoker {
        client: args.client.clone(),
        upstream_url,
        api_keys,
    };
    crate::core::agent::goal::evaluate(smol_model_id, condition, messages, &model).await
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
    // `max_turns == 0` means unbounded: the session token budget and user
    // cancellation are the real guards, so an interactive run isn't cut off
    // mid-task by a fixed turn cap.
    let unlimited = max_turns == 0;
    let mut turn: usize = 0;
    // Set on any turn where compaction ran, so the final return can emit
    // `MessagesUpdated` even when compaction happened on a prior (tool-call)
    // turn and the final turn itself didn't need retry.
    let mut did_compact = false;
    while unlimited || turn < max_turns {
        let _ = events.send(StreamEvent::Step {
            index: (turn as u32) + 1,
            max: max_turns as u32,
        });

        // On a context-overflow error, compact the conversation and retry.
        // Compaction runs progressively (a smaller kept tail each attempt) and
        // the loop gives up if a pass fails to shrink the message list.
        let completion = {
            let mut keep_recent = crate::core::agent::compaction::DEFAULT_KEEP_RECENT;
            let mut attempts = 0usize;
            loop {
                let request_value =
                    build_completion_request(model_id, &conversation_messages, openai_tools, json_body);
                match model.invoke(&request_value, events).await {
                    Ok(c) => break c,
                    Err(e)
                        if crate::core::agent::upstream::is_context_overflow_error(&e)
                            && attempts < MAX_COMPACTION_ATTEMPTS =>
                    {
                        let compacted = crate::core::agent::compaction::compact_conversation(
                            &conversation_messages,
                            model_id,
                            model,
                            keep_recent,
                        )
                        .await;
                        if compacted.len() >= conversation_messages.len() {
                            return Err(e);
                        }
                        log::info!(
                            "agent: context overflow, compacted {} -> {} messages (attempt {})",
                            conversation_messages.len(),
                            compacted.len(),
                            attempts + 1
                        );
                        conversation_messages = compacted;
                        did_compact = true;
                        keep_recent = (keep_recent / 2).max(2);
                        attempts += 1;
                    }
                    Err(e) => return Err(e),
                }
            }
        };

        budget.record(&Usage::from_completion(&completion));

        let tool_calls = extract_tool_calls(&completion);

        if tool_calls.is_empty() {
            if did_compact {
                let _ = events.send(StreamEvent::MessagesUpdated {
                    messages: conversation_messages.clone(),
                });
            }
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

        // Record the assistant's tool-call turn using the standard OpenAI
        // protocol: attach the `tool_calls` array here, and (below) feed each
        // result back as a `role: "tool"` message carrying its `tool_call_id`.
        //
        // A prior workaround delivered tool results as `role: "user"` because
        // some served models (observed with `tokamak-1-preview`) didn't attend
        // to `role: "tool"` messages with large content. That is now fixed
        // server-side: the tokamak-1-preview facade rewrites role:tool -> user
        // for the specific model that needs it (scoped, content preserved), so
        // the agent can speak standard OpenAI tool protocol on the wire again.
        // See janhq/jan-internal#238.
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

        // A `length` finish means the model was cut off mid-emission, so the
        // streamed tool-call arguments may be silently truncated. Executing them
        // would run with partial/empty args; instead fail every call so the model
        // sees the error and retries with a shorter response next turn.
        if stop_reason_of(&completion) == "length" {
            for tc in &tool_calls {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let content =
                    "ERROR: response truncated (finish_reason=length); tool-call arguments are \
                     incomplete and were not executed. Retry with a shorter response."
                        .to_string();
                let _ = events.send(StreamEvent::ToolResult {
                    id: id.clone(),
                    content: content.clone(),
                    is_error: true,
                    diff: None,
                });
                conversation_messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": content
                }));
            }
            turn += 1;
            continue;
        }

        let tool_results = tools.invoke(&tool_calls).await?;

        // Standard OpenAI tool protocol: each result is a `role: "tool"` message
        // carrying its `tool_call_id` (see note above the assistant push -- the
        // tokamak-1-preview facade handles models that can't attend to it).
        for outcome in tool_results {
            let ToolOutcome { id, content, diff } = outcome;
            let _ = events.send(StreamEvent::ToolResult {
                id: id.clone(),
                content: content.clone(),
                is_error: content.starts_with("ERROR"),
                diff,
            });
            conversation_messages.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": id,
                "content": content
            }));
        }
        turn += 1;
    }

    Err(format!(
        "reached the {max_turns}-turn limit while the model was still calling tools; raise --max-turns (or set 0 for unbounded) to let it finish"
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
        ) -> Result<Vec<ToolOutcome>, String> {
            self.calls.lock().unwrap().push(tool_calls.to_vec());
            Ok(tool_calls
                .iter()
                .map(|tc| {
                    let id = tc
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    ToolOutcome::plain(id, "MOCK_RESULT".to_string())
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

    struct ResultQueueModel {
        results: StdMutex<VecDeque<Result<serde_json::Value, String>>>,
    }
    #[async_trait]
    impl ModelInvoker for ResultQueueModel {
        async fn invoke(
            &self,
            _request: &serde_json::Value,
            _events: &mpsc::UnboundedSender<StreamEvent>,
        ) -> Result<serde_json::Value, String> {
            self.results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Err("mock exhausted".to_string()))
        }
    }

    #[tokio::test]
    async fn turn_cycle_compacts_and_retries_on_context_overflow() {
        let (tx, _rx) = mpsc::unbounded_channel();
        // 1) main request overflows, 2) summarizer succeeds, 3) retry succeeds.
        let overflow = Err(format!(
            "[{}] Upstream returned HTTP 400: context_length_exceeded",
            crate::core::agent::upstream::CONTEXT_OVERFLOW_MARKER
        ));
        let model = ResultQueueModel {
            results: StdMutex::new(
                vec![
                    overflow,
                    Ok(json!({ "choices": [{ "message": { "content": "SUMMARY" } }] })),
                    Ok(json!({ "choices": [{ "message": { "content": "final" }, "finish_reason": "stop" }] })),
                ]
                .into_iter()
                .collect(),
            ),
        };
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let mut convo = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..20 {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            convo.push(json!({ "role": r, "content": format!("m{i}") }));
        }

        let result = run_turn_cycle(&tx, &json!({}), "m", &[], convo, 8, &mut budget, &model, &tool)
            .await
            .unwrap();

        assert_eq!(result["choices"][0]["message"]["content"], "final");
        assert!(tool.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn turn_cycle_skips_execution_on_truncated_tool_calls() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut truncated = tool_call_completion();
        truncated["choices"][0]["finish_reason"] = json!("length");
        let model = MockModel::new(vec![
            truncated,
            json!({ "choices": [{ "message": { "content": "recovered" }, "finish_reason": "stop" }] }),
        ]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let convo = vec![json!({ "role": "user", "content": "hi" })];

        let result = run_turn_cycle(&tx, &json!({}), "m", &[], convo, 8, &mut budget, &model, &tool)
            .await
            .unwrap();

        assert_eq!(result["choices"][0]["message"]["content"], "recovered");
        assert!(
            tool.calls.lock().unwrap().is_empty(),
            "truncated tool calls must not execute"
        );
    }

    #[tokio::test]
    async fn turn_cycle_unbounded_runs_until_final_answer() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let model = MockModel::new(vec![
            tool_call_completion(),
            json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }),
        ]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let convo = vec![json!({ "role": "user", "content": "hi" })];

        // max_turns = 0 means unbounded: it must not error out and must keep
        // going past the tool-call turn to return the final answer.
        let result = run_turn_cycle(&tx, &json!({}), "m", &[], convo, 0, &mut budget, &model, &tool)
            .await
            .unwrap();

        assert_eq!(result["choices"][0]["message"]["content"], "done");
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
            subagents: None,
            yolo: false,
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
    async fn parallel_reads_all_execute_and_preserve_order() {
        let root = unique_project_root();
        std::fs::write(root.join("a.txt"), "AAA").unwrap();
        std::fs::write(root.join("b.txt"), "BBB").unwrap();
        std::fs::write(root.join("c.txt"), "CCC").unwrap();
        let (tx, _rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        // Read-only default => reads auto-allow (no prompt) and run concurrently.
        let invoker = build_prompting_invoker(root.clone(), tx, registry);

        let read = |id: &str, path: &str| {
            json!({
                "id": id,
                "type": "function",
                "function": { "name": "read", "arguments": format!("{{\"path\":\"{path}\"}}") }
            })
        };
        let calls = vec![read("r1", "a.txt"), read("r2", "b.txt"), read("r3", "c.txt")];
        let out = invoker.invoke(&calls).await.unwrap();

        assert_eq!(out.len(), 3);
        // Output order must match input order regardless of completion order.
        assert_eq!(out[0].id, "r1");
        assert_eq!(out[1].id, "r2");
        assert_eq!(out[2].id, "r3");
        assert!(out[0].content.contains("AAA"), "got: {}", out[0].content);
        assert!(out[1].content.contains("BBB"), "got: {}", out[1].content);
        assert!(out[2].content.contains("CCC"), "got: {}", out[2].content);
        let _ = std::fs::remove_dir_all(&root);
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
        assert!(!out[0].content.starts_with("ERROR"), "unexpected: {}", out[0].content);
        assert_eq!(std::fs::read_to_string(root.join("out.txt")).unwrap(), "hi");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn yolo_writes_without_prompting() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, registry);
        invoker.yolo = true;

        let out = invoker.invoke(&[write_call()]).await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(!out[0].content.starts_with("ERROR"), "unexpected: {}", out[0].content);
        assert_eq!(std::fs::read_to_string(root.join("out.txt")).unwrap(), "hi");
        // No permission prompt should have been emitted.
        assert!(
            !matches!(rx.try_recv(), Ok(StreamEvent::PermissionRequest { .. })),
            "yolo must not prompt for a write"
        );
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
        assert!(out[0].content.contains("denied by user"), "got: {}", out[0].content);
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
        assert!(!out1[0].content.starts_with("ERROR"), "first: {}", out1[0].content);

        let second = json!({
            "id": "c2",
            "type": "function",
            "function": {
                "name": "write",
                "arguments": "{\"path\":\"out2.txt\",\"content\":\"yo\"}"
            }
        });
        let out2 = invoker.invoke(&[second]).await.unwrap();
        assert!(!out2[0].content.starts_with("ERROR"), "second: {}", out2[0].content);

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

    fn mcp_call(id: &str, name: &str) -> serde_json::Value {
        json!({ "id": id, "type": "function", "function": { "name": name, "arguments": "{}" } })
    }

    #[tokio::test]
    async fn mcp_prompt_deny_reports_error_and_skips_execution() {
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

        let out = invoker.invoke(&[mcp_call("m1", "web_search_exa")]).await.unwrap();
        responder.await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(out[0].content.contains("denied by user"), "got: {}", out[0].content);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn mcp_allow_always_records_thread_grant() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = build_prompting_invoker(root.clone(), tx, registry.clone());

        let responder = {
            let registry = registry.clone();
            tokio::spawn(async move {
                respond_once(&mut rx, &registry, PermissionDecision::AllowAlways).await;
            })
        };

        // Execution errors (no live server) are irrelevant; assert the grant landed.
        let _ = invoker.invoke(&[mcp_call("m1", "web_search_exa")]).await;
        responder.await.unwrap();

        assert!(invoker.grants.lock().unwrap().covers_mcp("web_search_exa"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn granted_mcp_tool_does_not_prompt() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = build_prompting_invoker(root.clone(), tx, registry);
        invoker.grants.lock().unwrap().grant_mcp("web_search_exa");

        // Execution errors (no live server) are irrelevant; assert no prompt fired.
        let _ = invoker.invoke(&[mcp_call("m1", "web_search_exa")]).await;
        drop(invoker);

        let mut prompted = false;
        while let Some(ev) = rx.recv().await {
            if matches!(ev, StreamEvent::PermissionRequest { .. }) {
                prompted = true;
            }
        }
        assert!(!prompted, "a pre-granted MCP tool must not prompt");
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

    #[test]
    fn read_only_project_still_advertises_mcp_tools() {
        use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};
        let mut tools = vec![json!({ "type": "function", "function": { "name": "web_search_exa" } })];
        let mut map = HashMap::from([("web_search_exa".to_string(), "exa".to_string())]);
        // The scaffolded CLI project default: read-only, no allow-list.
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);

        retain_advertisable_mcp_tools(&mut tools, &mut map, &perms);

        assert_eq!(tools.len(), 1, "read-only must not suppress MCP advertisement");
        assert!(map.contains_key("web_search_exa"));
    }

    #[test]
    fn denied_mcp_tool_is_not_advertised() {
        use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};
        let mut tools = vec![
            json!({ "type": "function", "function": { "name": "web_search_exa" } }),
            json!({ "type": "function", "function": { "name": "dangerous_write" } }),
        ];
        let mut map = HashMap::from([
            ("web_search_exa".to_string(), "exa".to_string()),
            ("dangerous_write".to_string(), "exa".to_string()),
        ]);
        let perms = ToolPermissions::new(
            PermissionDefault::ReadOnly,
            &[],
            &["dangerous_write".to_string()],
            &[],
        );

        retain_advertisable_mcp_tools(&mut tools, &mut map, &perms);

        assert_eq!(tools.len(), 1);
        assert!(map.contains_key("web_search_exa"));
        assert!(!map.contains_key("dangerous_write"), "deny-list must still prune");
    }

    #[test]
    fn deny_default_advertises_no_mcp_tools() {
        use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};
        let mut tools = vec![json!({ "type": "function", "function": { "name": "web_search_exa" } })];
        let mut map = HashMap::from([("web_search_exa".to_string(), "exa".to_string())]);
        let perms = ToolPermissions::new(PermissionDefault::Deny, &[], &[], &[]);

        retain_advertisable_mcp_tools(&mut tools, &mut map, &perms);

        assert!(tools.is_empty(), "default=deny must lock down MCP advertisement");
        assert!(map.is_empty());
    }
}
