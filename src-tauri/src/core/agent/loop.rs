//! The shared server-side agent orchestration loop, consumed by the API server
//! and (later) `tauri-plugin-agent`. The loop reports progress over a Tauri-free
//! `StreamEvent` sink (per-token deltas via the SSE upstream call, per-step
//! events, and one terminal `Done`/`Error`) while still returning the final
//! completion JSON, so the API server's original contract is unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use reqwest::Client;
#[cfg(not(feature = "cli"))]
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::{StreamEvent, Usage};
use crate::core::agent::session::SessionBudget;
use crate::core::agent::tools::gate::PermissionDecision;
use crate::core::agent::upstream::{
    collect_mcp_openai_tools, copy_optional_chat_params, execute_mcp_tool_calls,
    extract_choice_message, extract_tool_calls, load_assistant_config, parse_openai_messages,
    repair_dangling_tool_calls, resolve_upstream_for_model, set_system_prompt,
    stream_openai_chat_completions,
};
#[cfg(not(feature = "cli"))]
use crate::core::server::proxy::router_first_model;
#[cfg(not(feature = "cli"))]
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
    /// Local engine handles. Absent in the `cli` build, which is remote-only.
    #[cfg(not(feature = "cli"))]
    pub llama_state: Arc<LlamacppState>,
    #[cfg(not(feature = "cli"))]
    pub mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    pub mcp_servers: SharedMcpServers,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub jan_data_folder: String,
    pub permissions: crate::core::agent::permissions::ToolPermissions,
    pub project_root: Option<std::path::PathBuf>,
    pub permission_requests: PermissionRegistry,
    /// Present only when a client can render and answer structured questions.
    pub ask_requests: Option<crate::core::agent::interaction::AskRegistry>,
    /// Session's canonical todo list. Present for the top-level run only;
    /// subagent/child runs never receive it (they cannot read or mutate the
    /// parent's list).
    pub todo_registry: Option<crate::core::agent::todo::TodoRegistry>,
    /// When set, replaces the run's assistant identity while preserving the
    /// shared project-context and tool-use prompt assembled for normal runs.
    /// Child turns remain excluded from project memory recall/indexing.
    pub system_prompt_override: Option<String>,
    /// Whether this run may dispatch subagents. `false` for child runs, which
    /// caps recursion depth at one (a subagent cannot spawn grandchildren).
    pub subagents_enabled: bool,
    /// `--yolo`: disable the sandbox/permission gate and auto-allow every tool
    /// call (built-in reads/writes/exec and MCP) without prompting. Inherited by
    /// dispatched subagents via the cloned parent args.
    pub yolo: bool,
    /// Read-only plan mode. When `Plan`, mutation-capable tools (write/edit/bash,
    /// memory_write/skill_write, MCP, subagent dispatch) are neither advertised
    /// nor executable: the dispatcher hard-denies them with `plan_mode_read_only`,
    /// stronger than `--yolo`'s prompt suppression (yolo cannot override this).
    pub run_mode: crate::core::agent::plan::RunMode,
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
    ask_requests: Option<crate::core::agent::interaction::AskRegistry>,
    todo_registry: Option<crate::core::agent::todo::TodoRegistry>,
    grants: std::sync::Mutex<crate::core::agent::tools::gate::SessionGrants>,
    subagents: Option<SubagentContext>,
    yolo: bool,
    run_mode: crate::core::agent::plan::RunMode,
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

    async fn handle_ask_tool(&self, args: &serde_json::Value) -> String {
        use crate::core::agent::interaction::{register, AskError, AskRequest};

        let Some(registry) = &self.ask_requests else {
            return "ERROR [interactive_ui_required]: ask requires an attached interactive UI"
                .to_string();
        };
        let request = match AskRequest::parse(args) {
            Ok(request) => request,
            Err(error) => return format!("ERROR: {error}"),
        };
        let (request_id, receiver) = register(registry).await;
        if self
            .events
            .send(StreamEvent::AskRequest {
                request_id: request_id.clone(),
                request: request.clone(),
            })
            .is_err()
        {
            let _ = crate::core::agent::interaction::respond(
                registry,
                &request_id,
                Err(AskError::Cancelled),
            )
            .await;
            return "ERROR [ask_cancelled]: interactive UI disconnected".to_string();
        }
        match receiver.await {
            Ok(Ok(results)) => match request.validate_results(&results) {
                Ok(()) => serde_json::to_string(&results).unwrap_or_else(|error| {
                    format!("ERROR: could not encode ask response: {error}")
                }),
                Err(error) => format!("ERROR: invalid ask response: {error}"),
            },
            Ok(Err(AskError::Cancelled)) | Err(_) => {
                "ERROR [ask_cancelled]: user cancelled the question".to_string()
            }
        }
    }

    /// Applies one todo mutation and emits `StreamEvent::TodoUpdate` with the
    /// full resulting snapshot so session history can reconstruct state.
    async fn handle_todo_tool(&self, args: &serde_json::Value) -> String {
        use crate::core::agent::todo::{parse_target, render_result, TodoPhase};
        let Some(registry) = &self.todo_registry else {
            return "ERROR [todo_unavailable]: todo tool requires an attached session"
                .to_string();
        };
        let op = args.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let mut list = registry.lock().await;
        let result: Result<(), String> = match op {
            "init" => {
                let phases = if let Some(list_val) = args.get("list").and_then(|v| v.as_array()) {
                    list_val
                        .iter()
                        .map(|p| {
                            let name = p.get("phase").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let items = p
                                .get("items")
                                .and_then(|v| v.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|v| v.as_str())
                                        .map(|s| crate::core::agent::todo::TodoItem {
                                            content: s.to_string(),
                                            status: crate::core::agent::todo::TodoStatus::Pending,
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            TodoPhase { name, tasks: items }
                        })
                        .collect()
                } else if let Some(items) = args.get("items").and_then(|v| v.as_array()) {
                    vec![TodoPhase {
                        name: String::new(),
                        tasks: items
                            .iter()
                            .filter_map(|v| v.as_str())
                            .map(|s| crate::core::agent::todo::TodoItem {
                                content: s.to_string(),
                                status: crate::core::agent::todo::TodoStatus::Pending,
                            })
                            .collect(),
                    }]
                } else {
                    return "ERROR: init requires 'list' or 'items'".to_string();
                };
                list.init(phases)
            }
            "start" => match args.get("task").and_then(|v| v.as_str()) {
                Some(task) => list.start(task),
                None => return "ERROR: start requires 'task'".to_string(),
            },
            "done" => match parse_target(args) {
                Ok(target) => list.done(target),
                Err(e) => return format!("ERROR: {e}"),
            },
            "drop" => match parse_target(args) {
                Ok(target) => list.drop_target(target),
                Err(e) => return format!("ERROR: {e}"),
            },
            "rm" => match parse_target(args) {
                Ok(target) => list.rm(target),
                Err(e) => return format!("ERROR: {e}"),
            },
            "append" => {
                let phase = args.get("phase").and_then(|v| v.as_str()).unwrap_or("");
                let items: Vec<String> = args
                    .get("items")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(String::from).collect())
                    .unwrap_or_default();
                if phase.is_empty() || items.is_empty() {
                    return "ERROR: append requires 'phase' and non-empty 'items'".to_string();
                }
                list.append(phase, items)
            }
            "view" => Ok(()),
            other => return format!("ERROR: unknown todo op '{other}'"),
        };
        match result {
            Ok(()) => {
                let snapshot = list.clone();
                drop(list);
                let _ = self.events.send(StreamEvent::TodoUpdate { list: snapshot.clone() });
                render_result(&snapshot)
            }
            Err(error) => format!("ERROR: {error}"),
        }
    }
}

/// Message for a tool blocked by the project's own deny list, naming the
/// exact config file so the block is actionable, not mysterious.
fn denied_by_policy_msg(name: &str, project_root: &std::path::Path) -> String {
    format!(
        "ERROR: tool '{name}' denied by project policy (see [tools] deny in {})",
        crate::core::agent::project::agent_toml_path(project_root).display()
    )
}

/// Rejection message for a mutation-capable tool call attempted in
/// `RunMode::Plan`. Authoritative: the tool never actually runs.
fn plan_mode_read_only_msg(name: &str) -> String {
    format!("ERROR: tool '{name}' unavailable in plan_mode_read_only (plan mode is read-only)")
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
            if name == "ask" {
                let id = tc
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let args: serde_json::Value = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .and_then(|value| serde_json::from_str(value).ok())
                    .unwrap_or(serde_json::Value::Object(Default::default()));
                let content = self.handle_ask_tool(&args).await;
                out.push(ToolOutcome::plain(id, content));
                continue;
            }
            if name == "todo" {
                let id = tc
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let args: serde_json::Value = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .and_then(|value| serde_json::from_str(value).ok())
                    .unwrap_or(serde_json::Value::Object(Default::default()));
                let content = self.handle_todo_tool(&args).await;
                out.push(ToolOutcome::plain(id, content));
                continue;
            }
            // Subagent tools are handled ahead of the fs/exec gate and the MCP
            // fallback: they orchestrate nested runs, not filesystem access.
            if crate::core::agent::subagent::is_subagent_tool(name) {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                // Plan mode blocks subagent dispatch (a subagent could mutate).
                // They are not advertised in Plan; this is defense in depth
                // against a stale tool schema. `--yolo` cannot override.
                if self.run_mode == crate::core::agent::plan::RunMode::Plan {
                    out.push(ToolOutcome::plain(id, plan_mode_read_only_msg(name)));
                    continue;
                }
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
                // Plan mode blocks all MCP tools: their capability is arbitrary
                // and unknowable, so they are never advertised in Plan and are
                // hard-denied here as defense in depth. `--yolo` cannot override.
                if self.run_mode == crate::core::agent::plan::RunMode::Plan {
                    out.push(ToolOutcome::plain(id, plan_mode_read_only_msg(name)));
                    continue;
                }
                // Deny-listed MCP tools are never advertised, but guard anyway.
                if self.permissions.is_denied(name) {
                    out.push(ToolOutcome::plain(
                        id,
                        denied_by_policy_msg(name, &self.project_root),
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
            // Plan mode: mutation-capable builtins (Write/Exec) are hard-denied
            // BEFORE the normal gate, without a permission prompt, and `--yolo`
            // cannot override this (unlike the normal prompt suppression below).
            // Read/Net/workspace-read tools fall through to the usual gate.
            if self.run_mode == crate::core::agent::plan::RunMode::Plan
                && matches!(tool.capability, Capability::Write | Capability::Exec)
            {
                out.push(ToolOutcome::plain(id, plan_mode_read_only_msg(name)));
                continue;
            }
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
                Decision::HardDeny => (denied_by_policy_msg(name, &self.project_root), None),
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
/// running the streamed loop with a discarded event sink. Desktop-only: the
/// `cli` build has no proxy server.
#[cfg(not(feature = "cli"))]
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
        ask_requests: None,
        todo_registry: None,
        system_prompt_override: None,
        subagents_enabled: false,
        yolo: false,
        run_mode: crate::core::agent::plan::RunMode::Normal,
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

/// Assembles the run's system prompt: `override_prompt` (a subagent's
/// definition prompt) replaces the assistant identity when set, but the
/// project-context and tool-use guidance from `build_system_prompt` is still
/// built around it when a project is selected — a subagent gets the same
/// grounding (guidelines, web access, tool docs) as a normal run, not a bare
/// verbatim prompt with no instruction on how to actually use its tools.
fn build_run_system_prompt(
    assistant_instructions: Option<&str>,
    override_prompt: Option<&str>,
    project_root: Option<&std::path::Path>,
    subagents_enabled: bool,
) -> Option<String> {
    let base = override_prompt.or(assistant_instructions);
    match project_root {
        Some(root) => {
            crate::core::agent::context::build_system_prompt(base, root, subagents_enabled)
        }
        None => base.map(str::to_string),
    }
}

/// System-prompt addendum on a session's first substantive message: without
/// it, the model only ever reaches for `todo` once told explicitly that it
/// has the tool, instead of proactively planning a multi-step request the
/// way a plan laid out up front would help with. Paired with a forced
/// `tool_choice` on that same first turn (see `should_suggest_eager_todo_plan`
/// and its caller), so this is a real requirement, not a suggestion the model
/// can silently skip -- the imperative wording matches that guarantee.
const EAGER_TODO_PROMPT_ADDENDUM: &str = "Before substantial work on this request, create a \
phased todo. You MUST call `todo` first in this turn with a single `init` op covering \
investigation through implementation and verification, not just the next step. Keep each task \
to a concise, specific 5-10 word label; `init` only accepts phase names and task-label strings, \
passed as the `list` argument (e.g. `list: [{phase: \"Setup\", items: [\"...\"]}]`) -- never as \
top-level `phase`/`task` strings, which are for later ops (start/done/drop), not init. After \
`todo` succeeds, continue the request in the same turn.";

/// Upkeep half of the todo guidance, applied on every turn that has a non-empty
/// list rather than only a session's first message. The init addendum above
/// fires once and never again (see `should_suggest_eager_todo_plan`), so a
/// resumed or multi-turn session would otherwise carry a list the model was
/// never told to maintain -- which is exactly how a run ends reading 0/N with
/// every task finished but still marked pending.
const TODO_UPKEEP_PROMPT_ADDENDUM: &str = "You have an active todo list. Keep it honest as you \
work: the moment you finish a task call `todo` with `done` for it (or `drop` if you are skipping \
it), before moving on to the next one. Do not leave finished work sitting as pending, and do not \
batch the close-out to the end of the turn.";

/// Which todo addendum this turn needs, if any: the init guidance on a
/// session's first substantive message, otherwise the upkeep guidance whenever
/// a list already exists. `None` when there is nothing to say (no list, and not
/// a first-message candidate). Subagent/plan-mode gating is the caller's.
async fn todo_prompt_addendum(
    eager_todo_plan: bool,
    todo_registry: &Option<crate::core::agent::todo::TodoRegistry>,
) -> Option<&'static str> {
    if eager_todo_plan {
        return Some(EAGER_TODO_PROMPT_ADDENDUM);
    }
    let has_todos = match todo_registry {
        Some(registry) => !registry.lock().await.is_empty(),
        None => false,
    };
    has_todos.then_some(TODO_UPKEEP_PROMPT_ADDENDUM)
}

/// True on a session's first substantive user message: exactly one user-role
/// message in the conversation so far (this one), no todos staged yet, and
/// the prompt looks like actual multi-step work rather than a greeting,
/// acknowledgement, or a bare question/exclamation a phased plan would be
/// overkill for.
async fn should_suggest_eager_todo_plan(
    conversation_messages: &[serde_json::Value],
    todo_registry: &Option<crate::core::agent::todo::TodoRegistry>,
) -> bool {
    let user_turns = conversation_messages
        .iter()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        .count();
    if user_turns != 1 {
        return false;
    }
    let Some(prompt_text) = latest_user_text(conversation_messages) else {
        return false;
    };
    let trimmed = prompt_text.trim_end();
    if ['?', '！', '？', '!'].iter().any(|c| trimmed.ends_with(*c)) {
        return false;
    }
    // A greeting, thanks, or one-line aside ("hi", "ok thanks") is not work a
    // phased plan helps with. Require enough words to look like an actual
    // request; the shortest real task prompts ("fix the login bug") clear this,
    // while chit-chat does not. A word-count floor, not a keyword blocklist, so
    // it never has to enumerate every possible pleasantry.
    const MIN_SUBSTANTIVE_WORDS: usize = 4;
    if trimmed.split_whitespace().count() < MIN_SUBSTANTIVE_WORDS {
        return false;
    }
    match todo_registry {
        Some(registry) => registry.lock().await.is_empty(),
        None => true,
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
        #[cfg(not(feature = "cli"))]
        llama_state,
        #[cfg(not(feature = "cli"))]
        mlx_sessions,
        mcp_servers,
        mcp_settings,
        jan_data_folder,
        permissions,
        project_root,
        permission_requests,
        ask_requests,
        todo_registry,
        system_prompt_override,
        subagents_enabled,
        yolo,
        run_mode,
    } = args;

    // Per-turn override: the TUI toggles plan mode live via the request body
    // (like `model`/`max_tokens`), falling back to the session default. Any
    // caller can only *tighten* to Plan or match the default; the capability
    // gate below enforces read-only regardless of who set it.
    let run_mode = json_body
        .get("run_mode")
        .and_then(|v| serde_json::from_value::<crate::core::agent::plan::RunMode>(v.clone()).ok())
        .unwrap_or(*run_mode);

    let messages_value = json_body
        .get("messages")
        .ok_or("Missing required field 'messages'")?;
    let mut conversation_messages = parse_openai_messages(messages_value)?;
    // Self-heal a conversation an earlier interrupted run may have left with a
    // tool_calls turn missing one of its results (e.g. the process was killed
    // while an `ask`/permission prompt was still pending). Providers like
    // Anthropic reject the entire request on a dangling tool_use, so repair
    // it here -- the one place every incoming message array passes through --
    // before it ever reaches a provider.
    let repaired = repair_dangling_tool_calls(&mut conversation_messages);
    if repaired > 0 {
        log::warn!("agent: repaired {repaired} dangling tool call(s) with no prior result");
    }

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

    let mut system_prompt = build_run_system_prompt(
        assistant_instructions.as_deref(),
        system_prompt_override.as_deref(),
        project_root.as_deref(),
        *subagents_enabled,
    );
    // Normal parent runs recall project memory for the current query before it
    // is indexed. Child runs keep their isolated history and skip memory.
    if system_prompt_override.is_none() {
        if let Some(root) = project_root {
            if let Some(query) = latest_user_text(&conversation_messages) {
                if let Some(mem) = crate::core::agent::memory::retrieve_block(root, &query) {
                    system_prompt = Some(match system_prompt {
                        Some(s) => format!("{s}\n\n{mem}"),
                        None => mem,
                    });
                }
            }
        }
    }
    // Always tell the model today's date, including isolated child runs.
    let date_line = format!("Today's date is {}.", chrono::Local::now().format("%Y-%m-%d"));
    let system_prompt = match system_prompt {
        Some(sys) => format!("{date_line}\n\n{sys}"),
        None => date_line,
    };
    let system_prompt = Some(system_prompt);
    // Child (subagent) runs are excluded via `system_prompt_override`, the
    // same gate the memory-recall block above uses to distinguish a
    // top-level run from a subagent's isolated context.
    let eager_todo_plan = run_mode != crate::core::agent::plan::RunMode::Plan
        && system_prompt_override.is_none()
        && should_suggest_eager_todo_plan(&conversation_messages, todo_registry).await;
    let system_prompt = if run_mode == crate::core::agent::plan::RunMode::Plan {
        let addendum = crate::core::agent::plan::plan_mode_prompt_addendum();
        Some(match system_prompt {
            Some(sys) => format!("{sys}\n\n{addendum}"),
            None => addendum.to_string(),
        })
    } else if let Some(addendum) = todo_prompt_addendum(eager_todo_plan, todo_registry).await {
        // Child (subagent) runs are excluded via `system_prompt_override`, the
        // same gate the memory-recall block above uses to distinguish a
        // top-level run from a subagent's isolated context.
        Some(match system_prompt {
            Some(sys) => format!("{sys}\n\n{addendum}"),
            None => addendum.to_string(),
        })
    } else {
        system_prompt
    };
    if let Some(sys) = system_prompt {
        set_system_prompt(&mut conversation_messages, &sys);
    }
    // Paired with the addendum above: force the model's very first tool call
    // to actually be `todo` rather than leaving compliance up to a prompt it
    // could silently ignore.
    let force_first_tool = eager_todo_plan.then_some("todo");

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
    #[cfg(not(feature = "cli"))]
    {
        if model_id.is_none() {
            if let Some(first) = router_first_model(llama_state, client).await {
                model_id = Some(first);
            }
        }
        if model_id.is_none() {
            let mlx_guard = mlx_sessions.lock().await;
            model_id = mlx_guard.values().next().map(|s| s.info.model_id.clone());
        }
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
    // path uses `allow_all()`, so behavior there is unchanged. Plan mode never
    // advertises MCP tools at all: their capability is arbitrary and unknowable.
    if run_mode == crate::core::agent::plan::RunMode::Plan {
        openai_tools.clear();
        tool_to_server.clear();
    } else {
        retain_advertisable_mcp_tools(&mut openai_tools, &mut tool_to_server, permissions);
    }

    // Per-run allowlist shared by builtin/subagent/ask advertisement below.
    let allowed_names: Option<std::collections::HashSet<String>> = json_body
        .get("allowed_tools")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });
    if project_root.is_some() {
        // Built-ins are governed by the capability gate at execution time, so here
        // we only drop tools explicitly denied in agent.toml (and honor allowed_tools
        // if the request set one). Advertisement is independent of the read-only
        // default that applies to opaque MCP tools.
        for schema in crate::core::agent::tools::schema::builtin_tool_schemas() {
            let name = schema["function"]["name"].as_str().unwrap_or_default();
            if permissions.is_denied(name) {
                continue;
            }
            // Plan mode advertises only read/net builtins; write/exec are hidden
            // entirely rather than relying on a prompt or execution-time denial.
            if run_mode == crate::core::agent::plan::RunMode::Plan
                && crate::core::agent::tools::lookup(name).is_some_and(|t| {
                    matches!(
                        t.capability,
                        crate::core::agent::tools::Capability::Write
                            | crate::core::agent::tools::Capability::Exec
                    )
                })
            {
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
        // (never for a child run, capping recursion depth at one) and the run
        // isn't in read-only Plan mode (a dispatched subagent could mutate).
        if args.subagents_enabled && run_mode != crate::core::agent::plan::RunMode::Plan {
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
    // The `ask` tool needs no project (it's an interactive question, not
    // filesystem access), so it's advertised independent of the project_root
    // gate above.
    if ask_requests.is_some()
        && allowed_names
            .as_ref()
            .is_none_or(|allowed| allowed.contains("ask"))
    {
        openai_tools.push(crate::core::agent::interaction::ask_tool_schema());
    }
    // Todo bookkeeping is session metadata, not filesystem access, so like
    // `ask` it's advertised independent of the project_root gate above.
    if todo_registry.is_some()
        && allowed_names
            .as_ref()
            .is_none_or(|allowed| allowed.contains("todo"))
    {
        openai_tools.push(crate::core::agent::todo::todo_tool_schema());
    }

    let (upstream_url, session_api_keys) = resolve_upstream_for_model(
        &model_id,
        provider_configs.clone(),
        #[cfg(not(feature = "cli"))]
        llama_state.clone(),
        #[cfg(not(feature = "cli"))]
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
            ask_requests: ask_requests.clone(),
            todo_registry: todo_registry.clone(),
            grants: std::sync::Mutex::new(crate::core::agent::tools::gate::SessionGrants::default()),
            subagents,
            yolo: *yolo,
            run_mode,
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
            run_mode,
            todo_registry.as_ref(),
            force_first_tool,
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
            run_mode,
            todo_registry.as_ref(),
            force_first_tool,
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
    forced_tool_choice: Option<&str>,
) -> serde_json::Value {
    let mut completion_map = serde_json::Map::new();
    completion_map.insert("model".to_string(), serde_json::json!(model_id));
    completion_map.insert(
        "messages".to_string(),
        serde_json::Value::Array(conversation_messages.to_vec()),
    );
    let tool_choice = match forced_tool_choice {
        Some(name) => serde_json::json!({ "type": "function", "function": { "name": name } }),
        None => serde_json::json!("auto"),
    };
    completion_map.insert("tool_choice".to_string(), tool_choice);
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
        #[cfg(not(feature = "cli"))]
        args.llama_state.clone(),
        #[cfg(not(feature = "cli"))]
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
#[cfg(feature = "cli")]
pub(crate) async fn evaluate_goal(
    args: &OrchestrationArgs,
    smol_model_id: &str,
    condition: &str,
    messages: &[serde_json::Value],
) -> Result<crate::core::agent::goal::GoalVerdict, String> {
    let (upstream_url, api_keys) = resolve_upstream_for_model(
        smol_model_id,
        args.provider_configs.clone(),
        #[cfg(not(feature = "cli"))]
        args.llama_state.clone(),
        #[cfg(not(feature = "cli"))]
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

/// Summary of still-open (pending/in-progress) todos, or `None` when there is
/// no list or nothing is open. Drives the close-out nudge before the loop hands
/// control back.
async fn open_todo_summary(
    todo_registry: Option<&crate::core::agent::todo::TodoRegistry>,
) -> Option<String> {
    todo_registry?.lock().await.open_summary()
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
    run_mode: crate::core::agent::plan::RunMode,
    todo_registry: Option<&crate::core::agent::todo::TodoRegistry>,
    // Forces the model's very first tool call (`turn == 0` only) to be this
    // named tool -- used to make the eager-todo nudge actually reliable
    // instead of an easily-ignored suggestion. `None` for every later turn.
    force_first_tool: Option<&str>,
) -> Result<serde_json::Value, String> {
    // `max_turns == 0` means unbounded: the session token budget and user
    // cancellation are the real guards, so an interactive run isn't cut off
    // mid-task by a fixed turn cap.
    let unlimited = max_turns == 0;
    let mut turn: usize = 0;
    // Mid-run todo upkeep: after a long uninterrupted run of mutating tool
    // calls with no todo touch, nudge the model once to keep the list honest
    // rather than only ever reminding it at a full stop -- a task that never
    // pauses to yield plain text could otherwise go a very long time with a
    // stale todo list. Local to one cycle (this function runs once per
    // top-level prompt), so no session-level reset bookkeeping is needed.
    const MID_RUN_NUDGE_MUTATION_THRESHOLD: u32 = 12;
    const MID_RUN_NUDGE_MAX_PER_CYCLE: u32 = 2;
    let mut mutations_since_todo_touch: u32 = 0;
    let mut mid_run_nudge_count: u32 = 0;
    // One-shot: asked the model to close out its todos before handing back.
    let mut closeout_nudged = false;

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
                let request_value = build_completion_request(
                    model_id,
                    &conversation_messages,
                    openai_tools,
                    json_body,
                    (turn == 0).then_some(force_first_tool).flatten(),
                );
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
                        keep_recent = (keep_recent / 2).max(2);
                        attempts += 1;
                    }
                    Err(e) => return Err(e),
                }
            }
        };

        let turn_usage = Usage::from_completion(&completion);
        // Publish before the tool calls run: the numbers describe the request
        // that just landed, and a long tool phase shouldn't sit on them.
        if let Some(usage) = turn_usage.clone() {
            let _ = events.send(StreamEvent::TurnUsage { usage });
        }
        budget.record(&turn_usage);

        let tool_calls = extract_tool_calls(&completion);

        if tool_calls.is_empty() {
            // The model is about to hand control back. If it finished the work
            // but never closed its todos out, the list is left reading 0/N
            // forever -- so ask once, then accept whatever comes next. Bounded
            // to a single retry per cycle: the point is to catch the common
            // "forgot to mark done" case, not to argue with the model.
            // Skip when the model appears to be asking the user something --
            // nudging there would talk over its own question.
            let final_text = extract_choice_message(&completion)
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
            let awaiting_user = final_text.trim_end().ends_with('?');
            if !closeout_nudged
                && run_mode == crate::core::agent::plan::RunMode::Normal
                && !awaiting_user
            {
                if let Some(summary) = open_todo_summary(todo_registry).await {
                    closeout_nudged = true;
                    conversation_messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": final_text,
                    }));
                    conversation_messages.push(serde_json::json!({
                        "role": "user",
                        "content": format!(
                            "Before you stop: these todos are still open:\n{summary}\n\nFor each \
                             one you actually completed, call `todo` with `done` now (or `drop` if \
                             you skipped it). If work genuinely remains, continue it instead."
                        ),
                    }));
                    turn += 1;
                    continue;
                }
            }
            let _ = events.send(StreamEvent::MessagesUpdated {
                messages: conversation_messages.clone(),
            });
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
        let tool_names: HashMap<&str, &str> = tool_calls
            .iter()
            .filter_map(|tc| {
                let id = tc.get("id").and_then(|v| v.as_str())?;
                let name = tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())?;
                Some((id, name))
            })
            .collect();

        // Reset wins over any mutations counted in the same batch: touching
        // `todo` at all means the list was just reconciled, regardless of
        // what else ran alongside it.
        let mut todo_touched_this_batch = false;
        for outcome in tool_results {
            let ToolOutcome { id, content, diff } = outcome;
            // A `bash` call that exits non-zero isn't prefixed "ERROR" (that
            // convention is reserved for hard tool failures the model must
            // treat as errors), but its failed exit marker still flags the
            // call as failed for display.
            let is_error = content.starts_with("ERROR")
                || (tool_names.get(id.as_str()) == Some(&"bash")
                    && crate::core::agent::tools::handlers::bash_result_failed(&content));
            let name = tool_names.get(id.as_str()).copied().unwrap_or("");
            if name == "todo" {
                todo_touched_this_batch = true;
            } else if !is_error && matches!(name, "bash" | "write" | "edit") {
                mutations_since_todo_touch += 1;
            }
            let _ = events.send(StreamEvent::ToolResult {
                id: id.clone(),
                content: content.clone(),
                is_error,
                diff,
            });
            conversation_messages.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": id,
                "content": content
            }));
        }
        if todo_touched_this_batch {
            mutations_since_todo_touch = 0;
        } else if mutations_since_todo_touch >= MID_RUN_NUDGE_MUTATION_THRESHOLD
            && mid_run_nudge_count < MID_RUN_NUDGE_MAX_PER_CYCLE
            && run_mode == crate::core::agent::plan::RunMode::Normal
        {
            let open_count = match todo_registry {
                Some(registry) => {
                    let list = registry.lock().await;
                    list.phases
                        .iter()
                        .flat_map(|p| p.tasks.iter())
                        .filter(|t| {
                            matches!(
                                t.status,
                                crate::core::agent::todo::TodoStatus::Pending
                                    | crate::core::agent::todo::TodoStatus::InProgress
                            )
                        })
                        .count()
                }
                None => 0,
            };
            if open_count > 0 {
                mutations_since_todo_touch = 0;
                mid_run_nudge_count += 1;
                let plural = if open_count == 1 { "" } else { "s" };
                conversation_messages.push(serde_json::json!({
                    "role": "user",
                    "content": format!(
                        "Reminder: {open_count} todo item{plural} still open. If you finished a \
                         task since the last todo update, mark it done now so progress stays \
                         visible; otherwise just keep working."
                    )
                }));
            }
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
        // Every request this mock was invoked with, in order -- lets a test
        // inspect exactly what conversation was sent on a later turn (e.g. to
        // confirm a hidden mid-run nudge message landed in it).
        requests: StdMutex<Vec<serde_json::Value>>,
    }
    impl MockModel {
        fn new(responses: Vec<serde_json::Value>) -> Self {
            Self {
                responses: StdMutex::new(responses.into_iter().collect()),
                requests: StdMutex::new(Vec::new()),
            }
        }
    }
    #[async_trait]
    impl ModelInvoker for MockModel {
        async fn invoke(
            &self,
            request: &serde_json::Value,
            _events: &mpsc::UnboundedSender<StreamEvent>,
        ) -> Result<serde_json::Value, String> {
            self.requests.lock().unwrap().push(request.clone());
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

    fn user_message(text: &str) -> serde_json::Value {
        json!({ "role": "user", "content": text })
    }

    fn empty_todo_registry() -> crate::core::agent::todo::TodoRegistry {
        std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::core::agent::todo::TodoList::default(),
        ))
    }

    fn staged_todo_registry() -> crate::core::agent::todo::TodoRegistry {
        use crate::core::agent::todo::{TodoItem, TodoList, TodoPhase, TodoStatus};
        std::sync::Arc::new(tokio::sync::Mutex::new(TodoList {
            phases: vec![TodoPhase {
                name: "P".into(),
                tasks: vec![TodoItem { content: "t1".into(), status: TodoStatus::Pending }],
            }],
        }))
    }

    #[tokio::test]
    async fn eager_todo_plan_suggested_on_first_substantive_message() {
        let convo = vec![user_message("build a flappy bird clone")];
        assert!(should_suggest_eager_todo_plan(&convo, &Some(empty_todo_registry())).await);
        assert!(should_suggest_eager_todo_plan(&convo, &None).await);
    }

    #[tokio::test]
    async fn eager_todo_plan_not_suggested_for_a_bare_question() {
        let convo = vec![user_message("what's the capital of France?")];
        assert!(!should_suggest_eager_todo_plan(&convo, &None).await);
        let convo = vec![user_message("nice work!")];
        assert!(!should_suggest_eager_todo_plan(&convo, &None).await);
    }

    #[tokio::test]
    async fn eager_todo_plan_not_suggested_for_a_short_greeting() {
        // Punctuation-free chit-chat must not force a todo plan: the word-count
        // floor catches greetings and acks that the `?`/`!` check misses.
        for msg in ["hi", "hello", "hey there", "ok thanks"] {
            let convo = vec![user_message(msg)];
            assert!(
                !should_suggest_eager_todo_plan(&convo, &None).await,
                "short greeting should not trigger eager todo: {msg:?}"
            );
        }
    }

    #[tokio::test]
    async fn eager_todo_plan_not_suggested_once_todos_exist() {
        let convo = vec![user_message("keep going")];
        assert!(!should_suggest_eager_todo_plan(&convo, &Some(staged_todo_registry())).await);
    }

    #[tokio::test]
    async fn eager_todo_plan_not_suggested_past_the_first_user_turn() {
        let convo = vec![
            user_message("build a flappy bird clone"),
            json!({ "role": "assistant", "content": "on it" }),
            user_message("also add a high score screen"),
        ];
        assert!(!should_suggest_eager_todo_plan(&convo, &None).await);
    }

    #[test]
    fn subagent_prompt_reuses_main_prompt_builder() {
        let root = unique_project_root();
        let prompt = build_run_system_prompt(
            Some("main assistant"),
            Some("You are a robotics researcher."),
            Some(&root),
            false,
        )
        .expect("prompt");

        assert!(prompt.starts_with("You are a robotics researcher."));
        assert!(!prompt.contains("main assistant"));
        assert!(prompt.contains("# Guidelines"));
        assert!(prompt.contains("# Web Access"));
        assert!(prompt.contains("web_search"));
        assert!(prompt.contains("web_fetch"));
        let _ = std::fs::remove_dir_all(&root);
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
            crate::core::agent::plan::RunMode::Normal,
            None,
            None,
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
    async fn force_first_tool_only_applies_to_the_first_turn() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let model = MockModel::new(vec![
            tool_call_completion(),
            json!({ "choices": [{ "message": { "content": "final answer" }, "finish_reason": "stop" }] }),
        ]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let convo = vec![json!({ "role": "user", "content": "hi" })];

        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            convo,
            8,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Normal,
            None,
            Some("todo"),
        )
        .await
        .unwrap();

        let requests = model.requests.lock().unwrap();
        assert_eq!(requests.len(), 2, "one request per turn");
        assert_eq!(
            requests[0]["tool_choice"],
            json!({ "type": "function", "function": { "name": "todo" } }),
            "the first turn's request must force the named tool"
        );
        assert_eq!(
            requests[1]["tool_choice"], "auto",
            "later turns must not keep forcing the same tool"
        );
    }

    fn mutating_tool_call_completion(id: &str, name: &str) -> serde_json::Value {
        json!({
            "choices": [{
                "message": {
                    "content": serde_json::Value::Null,
                    "tool_calls": [{
                        "id": id,
                        "type": "function",
                        "function": { "name": name, "arguments": "{}" }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        })
    }

    fn todo_registry_with_open_task() -> crate::core::agent::todo::TodoRegistry {
        use crate::core::agent::todo::{TodoItem, TodoList, TodoPhase, TodoStatus};
        std::sync::Arc::new(tokio::sync::Mutex::new(TodoList {
            phases: vec![TodoPhase {
                name: "P".into(),
                tasks: vec![TodoItem { content: "t1".into(), status: TodoStatus::InProgress }],
            }],
        }))
    }

    fn request_has_nudge(request: &serde_json::Value) -> bool {
        nudge_message_count(request) > 0
    }

    /// How many mid-run nudges are present in this request's history. Counting
    /// messages (not requests) is what the per-cycle cap actually bounds: an
    /// injected nudge stays in `conversation_messages`, so every later request
    /// carries it and counting requests would grow with the turn count.
    fn nudge_message_count(request: &serde_json::Value) -> usize {
        request["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|m| {
                m.get("content")
                    .and_then(|c| c.as_str())
                    .is_some_and(|s| s.contains("todo item"))
            })
            .count()
    }

    #[tokio::test]
    async fn mid_run_nudge_fires_after_a_long_uninterrupted_mutation_run() {
        let (tx, _rx) = mpsc::unbounded_channel();
        // 13 consecutive mutating calls with no todo touch -- one past the
        // 12-call threshold -- then a clean stop.
        let mut responses: Vec<serde_json::Value> = (0..13)
            .map(|i| mutating_tool_call_completion(&format!("call_{i}"), "bash"))
            .collect();
        responses.push(json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }));
        // The task is still open at that first stop, so the close-out nudge
        // spends one more turn before the loop hands back; answer it too.
        responses.push(json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }));
        let model = MockModel::new(responses);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let registry = todo_registry_with_open_task();
        let convo = vec![json!({ "role": "user", "content": "go" })];

        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            convo,
            0,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Normal,
            Some(&registry),
            None,
        )
        .await
        .unwrap();

        let requests = model.requests.lock().unwrap();
        let nudges = nudge_message_count(requests.last().expect("at least one request"));
        assert!(nudges >= 1, "expected a mid-run nudge after 12+ mutating calls");
        // MID_RUN_NUDGE_MAX_PER_CYCLE is local to run_turn_cycle; mirror it here.
        assert!(nudges <= 2, "must not exceed the per-cycle nudge cap, saw {nudges}");
    }

    /// A resumed/multi-turn session still needs the upkeep instruction: the
    /// eager-init addendum fires only on a session's first substantive message,
    /// so without this a continued session carries a todo list the model was
    /// never told to maintain -- the reported "0/8, nothing ever marked done".
    #[tokio::test]
    async fn continued_session_with_todos_still_gets_upkeep_guidance() {
        let registry = Some(todo_registry_with_open_task());
        // Not a first-message candidate (eager_todo_plan == false), list exists.
        let addendum = todo_prompt_addendum(false, &registry).await;
        assert_eq!(addendum, Some(TODO_UPKEEP_PROMPT_ADDENDUM));

        // A first substantive message gets the init guidance instead.
        assert_eq!(
            todo_prompt_addendum(true, &registry).await,
            Some(EAGER_TODO_PROMPT_ADDENDUM)
        );
    }

    /// No list and no first-message trigger means there is nothing to say --
    /// the prompt must not grow an unconditional todo paragraph.
    #[tokio::test]
    async fn no_todo_addendum_when_there_is_no_list() {
        assert_eq!(todo_prompt_addendum(false, &None).await, None);
        assert_eq!(
            todo_prompt_addendum(false, &Some(empty_todo_registry())).await,
            None
        );
    }

    /// The reported bug: the agent finishes the work, stops, and the todo list
    /// is left reading 0/N forever because it never marked anything done. The
    /// loop must ask once before handing control back.
    #[tokio::test]
    async fn closeout_nudge_asks_once_when_stopping_with_open_todos() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let model = MockModel::new(vec![
            json!({ "choices": [{ "message": { "content": "all done" }, "finish_reason": "stop" }] }),
            json!({ "choices": [{ "message": { "content": "closed them out" }, "finish_reason": "stop" }] }),
        ]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let registry = todo_registry_with_open_task();

        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            vec![json!({ "role": "user", "content": "go" })],
            0,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Normal,
            Some(&registry),
            None,
        )
        .await
        .unwrap();

        let requests = model.requests.lock().unwrap();
        assert_eq!(requests.len(), 2, "one extra turn for the close-out ask");
        let closeouts = requests
            .last()
            .expect("second request")["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .filter(|m| {
                m["content"]
                    .as_str()
                    .is_some_and(|s| s.contains("still open"))
            })
            .count();
        assert_eq!(closeouts, 1, "asked exactly once, never piles on");
    }

    /// Nothing open means nothing to ask about: the run must end on the first
    /// stop, with no extra turn spent.
    #[tokio::test]
    async fn closeout_nudge_is_silent_when_no_todos_are_open() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let model = MockModel::new(vec![
            json!({ "choices": [{ "message": { "content": "all done" }, "finish_reason": "stop" }] }),
        ]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let registry = empty_todo_registry();

        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            vec![json!({ "role": "user", "content": "go" })],
            0,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Normal,
            Some(&registry),
            None,
        )
        .await
        .unwrap();

        assert_eq!(model.requests.lock().unwrap().len(), 1, "no extra turn");
    }

    #[tokio::test]
    async fn mid_run_nudge_does_not_fire_in_plan_mode_or_without_open_todos() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut responses: Vec<serde_json::Value> = (0..13)
            .map(|i| mutating_tool_call_completion(&format!("call_{i}"), "bash"))
            .collect();
        responses.push(json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }));
        let model = MockModel::new(responses);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let registry = todo_registry_with_open_task();
        let convo = vec![json!({ "role": "user", "content": "go" })];

        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            convo,
            0,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Plan,
            Some(&registry),
            None,
        )
        .await
        .unwrap();
        assert!(
            model.requests.lock().unwrap().iter().all(|r| !request_has_nudge(r)),
            "plan mode must never get a mid-run nudge"
        );
    }

    #[tokio::test]
    async fn mid_run_nudge_touching_todo_resets_the_mutation_counter() {
        let (tx, _rx) = mpsc::unbounded_channel();
        // 6 mutating calls, a todo touch, then 6 more -- neither run alone
        // reaches the 12-call threshold, so no nudge should fire.
        let mut responses: Vec<serde_json::Value> = (0..6)
            .map(|i| mutating_tool_call_completion(&format!("a{i}"), "bash"))
            .collect();
        responses.push(mutating_tool_call_completion("mid", "todo"));
        responses.extend((0..6).map(|i| mutating_tool_call_completion(&format!("b{i}"), "edit")));
        responses.push(json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }));
        // The task is still open at that first stop, so the close-out nudge
        // spends one more turn before the loop hands back; answer it too.
        responses.push(json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }));
        let model = MockModel::new(responses);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let registry = todo_registry_with_open_task();
        let convo = vec![json!({ "role": "user", "content": "go" })];

        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            convo,
            0,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Normal,
            Some(&registry),
            None,
        )
        .await
        .unwrap();
        assert!(
            model.requests.lock().unwrap().iter().all(|r| !request_has_nudge(r)),
            "a todo touch partway through must reset the mutation counter"
        );
    }

    struct FixedTool {
        content: String,
    }
    #[async_trait]
    impl ToolInvoker for FixedTool {
        async fn invoke(
            &self,
            tool_calls: &[serde_json::Value],
        ) -> Result<Vec<ToolOutcome>, String> {
            Ok(tool_calls
                .iter()
                .map(|tc| {
                    let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    ToolOutcome::plain(id, self.content.clone())
                })
                .collect())
        }
    }

    fn bash_call_completion() -> serde_json::Value {
        json!({
            "choices": [{
                "message": {
                    "content": serde_json::Value::Null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "bash", "arguments": "{\"command\":\"false\"}" }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        })
    }

    async fn bash_result_is_error_flag(content: &str) -> bool {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let model = MockModel::new(vec![
            bash_call_completion(),
            json!({ "choices": [{ "message": { "content": "done" }, "finish_reason": "stop" }] }),
        ]);
        let tool = FixedTool { content: content.to_string() };
        let mut budget = SessionBudget::new(None);
        run_turn_cycle(
            &tx,
            &json!({}),
            "m",
            &[],
            vec![json!({ "role": "user", "content": "hi" })],
            8,
            &mut budget,
            &model,
            &tool,
            crate::core::agent::plan::RunMode::Normal,
            None,
            None,
        )
        .await
        .unwrap();
        drop(tx);
        while let Some(ev) = rx.recv().await {
            if let StreamEvent::ToolResult { is_error, .. } = ev {
                return is_error;
            }
        }
        panic!("no ToolResult emitted");
    }

    #[tokio::test]
    async fn bash_nonzero_exit_flags_tool_result_as_error() {
        assert!(bash_result_is_error_flag("boom\n[exit 1]").await);
        assert!(bash_result_is_error_flag("[terminated by signal]").await);
    }

    #[tokio::test]
    async fn bash_zero_exit_does_not_flag_tool_result_as_error() {
        assert!(!bash_result_is_error_flag("ok\n[exit 0]").await);
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
            crate::core::agent::plan::RunMode::Normal,
            None,
            None,
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

        let result = run_turn_cycle(&tx, &json!({}), "m", &[], convo, 8, &mut budget, &model, &tool, crate::core::agent::plan::RunMode::Normal, None, None)
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

        let result = run_turn_cycle(&tx, &json!({}), "m", &[], convo, 8, &mut budget, &model, &tool, crate::core::agent::plan::RunMode::Normal, None, None)
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
        let result = run_turn_cycle(&tx, &json!({}), "m", &[], convo, 0, &mut budget, &model, &tool, crate::core::agent::plan::RunMode::Normal, None, None)
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
            ask_requests: None,
            todo_registry: None,
            grants: std::sync::Mutex::new(SessionGrants::default()),
            subagents: None,
            yolo: false,
            run_mode: crate::core::agent::plan::RunMode::Normal,
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

    fn ask_call() -> serde_json::Value {
        json!({
            "id": "ask-call",
            "type": "function",
            "function": {
                "name": "ask",
                "arguments": serde_json::to_string(&json!({
                    "questions": [{
                        "id": "scope",
                        "question": "Which scope?",
                        "options": [{"label": "Small"}, {"label": "Large"}]
                    }]
                }))
                .unwrap()
            }
        })
    }

    /// A single tool call by name with empty JSON arguments.
    fn tool_call(id: &str, name: &str) -> serde_json::Value {
        json!({
            "id": id,
            "type": "function",
            "function": { "name": name, "arguments": "{}" }
        })
    }

    #[tokio::test]
    async fn plan_mode_denies_write_even_with_yolo() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.run_mode = crate::core::agent::plan::RunMode::Plan;
        // --yolo must NOT override the plan-mode read-only gate.
        invoker.yolo = true;

        let out = invoker.invoke(&[write_call()]).await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(
            out[0].content.contains("plan_mode_read_only"),
            "write must be hard-denied in plan mode: {}",
            out[0].content
        );
        assert!(!root.join("out.txt").exists(), "file must not be written");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn plan_mode_denies_mcp_tool_from_stale_schema() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.run_mode = crate::core::agent::plan::RunMode::Plan;
        invoker.yolo = true;

        // An unknown (non-builtin) name stands in for an MCP tool a stale schema
        // could still surface; it must be denied before any dispatch.
        let out = invoker.invoke(&[tool_call("m1", "some_mcp_tool")]).await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(out[0].content.contains("plan_mode_read_only"), "{}", out[0].content);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn plan_mode_denies_subagent_dispatch() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.run_mode = crate::core::agent::plan::RunMode::Plan;

        let out = invoker
            .invoke(&[tool_call("s1", "dispatch_subagent")])
            .await
            .unwrap();

        assert_eq!(out.len(), 1);
        assert!(out[0].content.contains("plan_mode_read_only"), "{}", out[0].content);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn plan_mode_allows_read_only_builtins() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.run_mode = crate::core::agent::plan::RunMode::Plan;

        // `ls` is Read-capable: the plan gate must let it through to the normal
        // (auto-allowed) path, so it never yields the plan-mode denial.
        let call = json!({
            "id": "r1",
            "type": "function",
            "function": { "name": "ls", "arguments": "{\"path\":\".\"}" }
        });
        let out = invoker.invoke(&[call]).await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(
            !out[0].content.contains("plan_mode_read_only"),
            "read-only builtins must not be blocked by plan mode: {}",
            out[0].content
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn orchestrate_reads_run_mode_override_from_body() {
        // The per-turn body override (mirrors model/max_tokens) parses to Plan;
        // absent/normal falls back to the session default.
        use crate::core::agent::plan::RunMode;
        let from_body = |v: serde_json::Value| {
            v.get("run_mode")
                .and_then(|x| serde_json::from_value::<RunMode>(x.clone()).ok())
        };
        assert_eq!(from_body(json!({"run_mode": "plan"})), Some(RunMode::Plan));
        assert_eq!(from_body(json!({"run_mode": "normal"})), Some(RunMode::Normal));
        assert_eq!(from_body(json!({})), None);
    }

    #[tokio::test]
    async fn ask_requires_an_attached_interactive_ui() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = build_prompting_invoker(root.clone(), tx, permissions);

        let out = invoker.invoke(&[ask_call()]).await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(out[0].content.contains("interactive_ui_required"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn ask_waits_for_and_returns_a_structured_response() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let asks = crate::core::agent::interaction::new_registry();
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.ask_requests = Some(asks.clone());

        let task = tokio::spawn(async move { invoker.invoke(&[ask_call()]).await.unwrap() });
        let request_id = match rx.recv().await.unwrap() {
            StreamEvent::AskRequest {
                request_id,
                request,
            } => {
                assert_eq!(request.questions[0].id, "scope");
                request_id
            }
            event => panic!("expected ask_request, got {event:?}"),
        };
        crate::core::agent::interaction::respond(
            &asks,
            &request_id,
            Ok(vec![crate::core::agent::interaction::QuestionResult {
                id: "scope".into(),
                selected: vec!["Small".into()],
                custom_input: None,
            }]),
        )
        .await
        .unwrap();

        let out = task.await.unwrap();
        let result: serde_json::Value = serde_json::from_str(&out[0].content).unwrap();
        assert_eq!(result[0]["id"], "scope");
        assert_eq!(result[0]["selected"][0], "Small");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn todo_call(id: &str, args: serde_json::Value) -> serde_json::Value {
        json!({
            "id": id,
            "type": "function",
            "function": {
                "name": "todo",
                "arguments": serde_json::to_string(&args).unwrap()
            }
        })
    }

    #[tokio::test]
    async fn todo_unavailable_without_an_attached_session() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let invoker = build_prompting_invoker(root.clone(), tx, permissions);

        let out = invoker
            .invoke(&[todo_call("t1", json!({"op": "view"}))])
            .await
            .unwrap();

        assert_eq!(out.len(), 1);
        assert!(out[0].content.contains("todo_unavailable"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn todo_init_promotes_first_task_and_emits_snapshot() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        let todos = crate::core::agent::todo::new_registry();
        invoker.todo_registry = Some(todos.clone());

        let out = invoker
            .invoke(&[todo_call(
                "t1",
                json!({"op": "init", "list": [{"phase": "Setup", "items": ["a", "b"]}]}),
            )])
            .await
            .unwrap();

        assert_eq!(out.len(), 1);
        assert!(!out[0].content.starts_with("ERROR"), "got: {}", out[0].content);
        let result: crate::core::agent::todo::TodoList =
            serde_json::from_str(&out[0].content).unwrap();
        assert_eq!(result.active().unwrap().1.content, "a");

        match rx.recv().await.unwrap() {
            StreamEvent::TodoUpdate { list } => assert_eq!(list, result),
            event => panic!("expected todo_update, got {event:?}"),
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn todo_done_advances_active_task() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        let todos = crate::core::agent::todo::new_registry();
        invoker.todo_registry = Some(todos.clone());

        invoker
            .invoke(&[todo_call(
                "t1",
                json!({"op": "init", "items": ["a", "b"]}),
            )])
            .await
            .unwrap();
        let _ = rx.recv().await; // drain init's TodoUpdate

        let out = invoker
            .invoke(&[todo_call("t2", json!({"op": "done", "task": "a"}))])
            .await
            .unwrap();
        assert!(!out[0].content.starts_with("ERROR"), "got: {}", out[0].content);
        let result: crate::core::agent::todo::TodoList =
            serde_json::from_str(&out[0].content).unwrap();
        assert_eq!(result.active().unwrap().1.content, "b");
        assert_eq!(result.done_total(), (1, 2));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn todo_rm_unknown_task_reports_error() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        let todos = crate::core::agent::todo::new_registry();
        invoker.todo_registry = Some(todos.clone());

        invoker
            .invoke(&[todo_call("t1", json!({"op": "init", "items": ["a"]}))])
            .await
            .unwrap();
        let _ = rx.recv().await;

        let out = invoker
            .invoke(&[todo_call("t2", json!({"op": "rm", "task": "missing"}))])
            .await
            .unwrap();
        assert!(out[0].content.starts_with("ERROR"), "got: {}", out[0].content);
        let _ = std::fs::remove_dir_all(&root);
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
