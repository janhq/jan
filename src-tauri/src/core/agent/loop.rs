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
use tauri_plugin_agent_tools::tools::gate::{DenyReason, PermissionDecision};
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
    pub permissions: tauri_plugin_agent_tools::permissions::ToolPermissions,
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
    /// Cap on concurrently-running background subagents for this run
    /// (`[agent].max_parallel_subagents` in agent.toml, default 10). Snapshot
    /// taken at run start: a mid-run config edit affects the *next* run only.
    pub max_parallel_subagents: u32,
    /// Auto-allow every tool call that would otherwise prompt (built-in
    /// reads/writes/exec and MCP). The CLI default, since the OS jail in the
    /// tools plugin confines exec regardless; `--safe` turns it off. Desktop
    /// leaves it false. `HardDeny` still stands. Inherited by dispatched
    /// subagents via the cloned parent args.
    pub auto_approve: bool,
    /// Read-only plan mode. When `Plan`, mutation-capable tools (write/edit/bash,
    /// memory_write/skill_write, MCP, subagent dispatch) are neither advertised
    /// nor executable: the dispatcher hard-denies them with `plan_mode_read_only`,
    /// stronger than auto-approval's prompt suppression (it cannot override this).
    pub run_mode: crate::core::agent::plan::RunMode,
    /// Stable identity for this run's session, used to key the persistent
    /// `bash` `/tmp` scratch directory (`<temp>/jan-agent-<session_id>`) and
    /// wiped at the session boundary specific to each surface. `None` on
    /// code paths with no session (server proxy runs) keeps the default
    /// throwaway per-command tmpfs.
    pub session_id: Option<String>,
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
    /// Where `memory/` and `skills/` live. Co-located with the project here, so
    /// the on-disk layout is unchanged; the desktop points this at its permanent
    /// store instead.
    store_root: std::path::PathBuf,
    /// `[skills].enabled`, resolved once per run. The toolset owns no config
    /// format, so the whitelist is injected rather than re-read per tool call.
    enabled_skills: Vec<String>,
    /// Whether the sandboxed shell keeps its network namespace. Resolved once
    /// per run from `[tools].allow_network`, falling back to the surface
    /// default when unset.
    allow_network: bool,
    /// Whether the sandboxed shell may read `$HOME`. Resolved once per run
    /// from `[tools].allow_home_read`, falling back to `true` on the CLI.
    allow_home_read: bool,
    /// Session-scoped scratch directory bound over the sandbox's `/tmp` so
    /// `bash` scratch files persist across calls for the whole run. Created at
    /// run start and wiped at run end.
    scratch_root: std::path::PathBuf,
    permissions: tauri_plugin_agent_tools::permissions::ToolPermissions,
    events: mpsc::UnboundedSender<StreamEvent>,
    permission_requests: PermissionRegistry,
    ask_requests: Option<crate::core::agent::interaction::AskRegistry>,
    todo_registry: Option<crate::core::agent::todo::TodoRegistry>,
    grants: std::sync::Mutex<tauri_plugin_agent_tools::tools::gate::SessionGrants>,
    subagents: Option<SubagentContext>,
    auto_approve: bool,
    run_mode: crate::core::agent::plan::RunMode,
}

/// Default for the sandboxed shell's network namespace, used when
/// `[tools].allow_network` is unset.
///
/// The CLI agent runs against the user's own project, where what confines it is
/// the workspace the sandbox pins it to, not the network namespace. Before the
/// shell was sandboxed at all it ran fully unconfined, and a coding agent that
/// cannot `curl`, `git fetch`, or install a package is largely useless, so the
/// network stays on. `--safe` adds a prompt on top; it does not change this.
///
/// The desktop chat sandbox makes the opposite trade: it is ephemeral, cannot
/// prompt at all, and opts in per call from a user setting (`commands.rs`).
#[cfg(feature = "cli")]
const DEFAULT_ALLOW_NETWORK: bool = true;
#[cfg(not(feature = "cli"))]
const DEFAULT_ALLOW_NETWORK: bool = false;

/// `[tools].allow_network` wins over the surface default when set.
fn resolve_allow_network(configured: Option<bool>) -> bool {
    configured.unwrap_or(DEFAULT_ALLOW_NETWORK)
}

/// Default for whether the sandboxed shell can read `$HOME`, used when
/// `[tools].allow_home_read` is unset.
///
/// The CLI needs it for `git`/`ssh` credential helpers, so its shell binds
/// `$HOME` read-only. The desktop keeps the full isolation and masks the home
/// (the Jan data folder lives inside `$HOME`, so exposing it read-only would
/// leak `settings.json` API keys, thread workspaces, and the memory store).
#[cfg(feature = "cli")]
const DEFAULT_ALLOW_HOME_READ: bool = true;
#[cfg(not(feature = "cli"))]
const DEFAULT_ALLOW_HOME_READ: bool = false;

/// `[tools].allow_home_read` wins over the surface default when set.
fn resolve_allow_home_read(configured: Option<bool>) -> bool {
    configured.unwrap_or(DEFAULT_ALLOW_HOME_READ)
}

/// agent.toml resolved for one run: the skill whitelist, plus the network
/// decision with this surface's default already applied.
struct ResolvedSettings {
    enabled_skills: Vec<String>,
    allow_network: bool,
    allow_home_read: bool,
}

/// Kept out of the invoker's struct literal so it is reachable from a test.
/// Inline, it was silently passing `None` instead of the parsed value, which
/// made `[tools].allow_network` a no-op that nothing detected.
fn resolve_run_settings(project_root: &std::path::Path) -> ResolvedSettings {
    let settings = crate::core::agent::project::run_settings(project_root);
    ResolvedSettings {
        enabled_skills: settings.enabled_skills,
        allow_network: resolve_allow_network(settings.allow_network),
        allow_home_read: resolve_allow_home_read(settings.allow_home_read),
    }
}

impl CompositeToolInvoker {
    fn tool_context(&self) -> tauri_plugin_agent_tools::tools::ToolContext<'_> {
        tauri_plugin_agent_tools::tools::ToolContext::new(
            &self.project_root,
            &self.store_root,
            &self.enabled_skills,
        )
        .with_network(self.allow_network)
        .with_home_readonly(self.allow_home_read)
        .with_scratch_root(&self.scratch_root)
    }

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
                Ok(()) => request.render_results(&results),
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

/// Message for a call that reached the hidden agent state directory. Says the
/// path does not exist *for the agent* and that retrying is pointless: pointing
/// at a deny list would send the model reading a file that is hidden too.
fn hidden_path_msg(name: &str) -> String {
    format!(
        "ERROR: tool '{name}' refused: '{}' is the agent's own state directory and is not part of \
         the project. It is hidden from every tool -- do not try to reach it another way. Skills \
         and memory are available through the skill_*/memory_* tools.",
        tauri_plugin_agent_tools::tools::sandbox::JAN_DIR
    )
}

fn hard_deny_msg(name: &str, reason: DenyReason, project_root: &std::path::Path) -> String {
    match reason {
        DenyReason::Policy => denied_by_policy_msg(name, project_root),
        DenyReason::Hidden => hidden_path_msg(name),
    }
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
        use tauri_plugin_agent_tools::tools::{
            gate::{resolve_decision, Decision, PromptKind},
            handlers::{execute_builtin_with_diff, preview_diff},
            is_builtin, lookup, Capability, ToolContext,
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
                // against a stale tool schema. Auto-approval cannot override.
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
                // hard-denied here as defense in depth. Auto-approval cannot override.
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
                if self.auto_approve || self.grants.lock().unwrap().covers_mcp(name) {
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
            // BEFORE the normal gate, without a permission prompt, and auto-approval
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
                Some(self.scratch_root.as_path()),
                &self.permissions,
                &snapshot,
            );
            // Auto-approval suppresses every prompt (sandbox escape, write, exec) but
            // still honors HardDeny, so the hidden `.jan` invariant and explicit
            // agent.toml denies hold.
            let decision = match decision {
                Decision::Prompt(_) if self.auto_approve => Decision::Allow,
                other => other,
            };
            // Read and Net tools are non-mutating and safe to run concurrently
            // once allowed: reads hit the filesystem, web tools do outbound HTTP.
            if matches!(decision, Decision::Allow)
                && matches!(tool.capability, Capability::Read | Capability::Net)
            {
                // The future outlives this borrow of `self`, so it owns its roots
                // and builds the context inside.
                let root = self.project_root.clone();
                let store = self.store_root.clone();
                let enabled = self.enabled_skills.clone();
                let allow_network = self.allow_network;
                let allow_home_read = self.allow_home_read;
                let scratch = self.scratch_root.clone();
                read_futures.push(async move {
                    let ctx = ToolContext::new(&root, &store, &enabled)
                        .with_network(allow_network)
                        .with_home_readonly(allow_home_read)
                        .with_scratch_root(&scratch);
                    let (text, diff) = execute_builtin_with_diff(tool, &args, &ctx).await;
                    ToolOutcome {
                        id,
                        content: text,
                        diff,
                    }
                });
                continue;
            }
            let (text, diff) = match decision {
                Decision::Allow => execute_builtin_with_diff(tool, &args, &self.tool_context()).await,
                Decision::HardDeny(reason) => {
                    (hard_deny_msg(name, reason, &self.project_root), None)
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
                        PromptKind::WriteEscape => "write_escape",
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
                    let diff = preview_diff(tool, &args, &self.tool_context()).await;
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
                            execute_builtin_with_diff(tool, &args, &self.tool_context()).await
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
                            execute_builtin_with_diff(tool, &args, &self.tool_context()).await
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
///
/// An HTTP client has no way to cancel mid-run, so this is the one path that
/// keeps a turn cap: a body that doesn't ask for one gets
/// [`PROXY_DEFAULT_MAX_TURNS`] rather than the unbounded default.
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
        permissions: tauri_plugin_agent_tools::permissions::ToolPermissions::allow_all(),
        project_root: None,
        permission_requests: Arc::new(Mutex::new(HashMap::new())),
        ask_requests: None,
        todo_registry: None,
        system_prompt_override: None,
        subagents_enabled: false,
        max_parallel_subagents: crate::core::agent::subagent::DEFAULT_MAX_PARALLEL_SUBAGENTS,
        auto_approve: false,
        run_mode: crate::core::agent::plan::RunMode::Normal,
        session_id: None,
    };
    let body = match json_body.get("max_turns") {
        Some(_) => std::borrow::Cow::Borrowed(json_body),
        None => {
            let mut b = json_body.clone();
            if let Some(map) = b.as_object_mut() {
                map.insert(
                    "max_turns".to_string(),
                    serde_json::json!(PROXY_DEFAULT_MAX_TURNS),
                );
            }
            std::borrow::Cow::Owned(b)
        }
    };
    run_orchestration_streamed(&tx, &body, &args).await
}

/// Turn cap applied to an API-server run whose body doesn't set one. Small on
/// purpose: nothing on that path can interrupt a loop that never converges.
#[cfg(not(feature = "cli"))]
const PROXY_DEFAULT_MAX_TURNS: u64 = 8;

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
    permissions: &tauri_plugin_agent_tools::permissions::ToolPermissions,
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

/// Which todo addendum this turn needs, if any: the init guidance on a `/goal`
/// turn with no plan staged, otherwise the upkeep guidance whenever a list
/// already exists. `None` when there is nothing to say (no list, and not a
/// goal run). Subagent/plan-mode gating is the caller's.
async fn todo_prompt_addendum(
    eager_todo_plan: bool,
    todo_registry: &Option<crate::core::agent::todo::TodoRegistry>,
) -> Option<&'static str> {
    if eager_todo_plan {
        return Some(crate::core::agent::context::EAGER_TODO_PROMPT_ADDENDUM);
    }
    let has_todos = match todo_registry {
        Some(registry) => !registry.lock().await.is_empty(),
        None => false,
    };
    has_todos.then_some(crate::core::agent::context::TODO_UPKEEP_PROMPT_ADDENDUM)
}

/// True when this turn should be forced to stage a plan: a `/goal` run whose
/// list is still empty. Forcing is deliberately limited to goal mode -- an
/// unattended loop needs a plan to work against, while an ordinary turn is the
/// model's call, and a phased list for small work is noise the user reads past.
/// Requires a registry: without one the `todo` tool is never advertised, so
/// forcing `tool_choice` on it would name a tool the request does not carry.
async fn should_force_goal_todo_plan(
    goal_mode: bool,
    todo_registry: &Option<crate::core::agent::todo::TodoRegistry>,
) -> bool {
    if !goal_mode {
        return false;
    }
    match todo_registry {
        Some(registry) => registry.lock().await.is_empty(),
        None => false,
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
        max_parallel_subagents,
        auto_approve,
        run_mode,
        session_id,
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

    let system_prompt = build_run_system_prompt(
        assistant_instructions.as_deref(),
        system_prompt_override.as_deref(),
        project_root.as_deref(),
        *subagents_enabled,
    );
    // Child (subagent) runs are excluded via `system_prompt_override`, the
    // same gate the memory-recall block above uses to distinguish a
    // top-level run from a subagent's isolated context.
    // `/goal` is a per-request flag like `run_mode`: the TUI sets it while a
    // goal is active, and nothing else does, so every other surface (a plain
    // turn, `jan cli agent run`, a subagent) leaves the model free to reach for
    // `todo` on its own.
    let goal_mode = json_body
        .get("goal_mode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let eager_todo_plan = run_mode != crate::core::agent::plan::RunMode::Plan
        && system_prompt_override.is_none()
        && should_force_goal_todo_plan(goal_mode, todo_registry).await;
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
        for schema in tauri_plugin_agent_tools::tools::schema::builtin_tool_schemas() {
            let name = schema["function"]["name"].as_str().unwrap_or_default();
            if permissions.is_denied(name) {
                continue;
            }
            // Plan mode advertises only read/net builtins; write/exec are hidden
            // entirely rather than relying on a prompt or execution-time denial.
            if run_mode == crate::core::agent::plan::RunMode::Plan
                && tauri_plugin_agent_tools::tools::lookup(name).is_some_and(|t| {
                    matches!(
                        t.capability,
                        tauri_plugin_agent_tools::tools::Capability::Write
                            | tauri_plugin_agent_tools::tools::Capability::Exec
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
                for schema in
                    crate::core::agent::subagent::subagent_tool_schemas(&registry, *max_parallel_subagents)
                {
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

    let max_turns = body_turn_cap(json_body);

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

    let max_session_tokens = body_session_budget(json_body);
    let mut budget = SessionBudget::new(max_session_tokens);

    if let Some(root) = project_root {
        // Background subagents are scoped to this run: `_bg_guard` aborts any
        // still-running child when `orchestrate_inner` returns or is cancelled.
        // The cap (`max_parallel_subagents`) is snapshotted here, at run start.
        let bg = std::sync::Arc::new(crate::core::agent::subagent::BackgroundSubagents::new(
            *max_parallel_subagents,
        ));
        let _bg_guard = crate::core::agent::subagent::AbortOnDrop(bg.clone());
        let subagents = args.subagents_enabled.then(|| SubagentContext {
            parent_args: args.clone(),
            model_id: model_id.clone(),
            max_session_tokens,
            bg: bg.clone(),
        });
        let settings = resolve_run_settings(root);
        // Scratch is keyed to the session so `/tmp` persists across turns in the
        // interactive TUI (and across calls in one-shot runs), then wiped at the
        // session boundary. `None` (server proxy) keeps the default tmpfs.
        let scratch_root = match session_id {
            Some(session) => tauri_plugin_agent_tools::workspace::ensure_scratch_dir(session)
                .await
                .map_err(|e| format!("ERROR: {e}"))?,
            None => root.join("agent-scratch"),
        };
        let tools = CompositeToolInvoker {
            mcp: mcp_tools,
            store_root: tauri_plugin_agent_tools::workspace::project_store(root),
            enabled_skills: settings.enabled_skills,
            allow_network: settings.allow_network,
            allow_home_read: settings.allow_home_read,
            scratch_root: scratch_root.clone(),
            project_root: root.clone(),
            permissions: permissions.clone(),
            events: events.clone(),
            permission_requests: permission_requests.clone(),
            ask_requests: ask_requests.clone(),
            todo_registry: todo_registry.clone(),
            grants: std::sync::Mutex::new(tauri_plugin_agent_tools::tools::gate::SessionGrants::default()),
            subagents,
            auto_approve: *auto_approve,
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
    let tool_choice = forced_tool_choice
        .filter(|name| {
            openai_tools
                .iter()
                .any(|tool| tool["function"]["name"].as_str() == Some(*name))
        })
        .map_or_else(
            || serde_json::json!("auto"),
            |name| serde_json::json!({ "type": "function", "function": { "name": name } }),
        );
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

/// Turn cap for a request body. No cap by default: the agent runs as long as
/// the task needs, guarded by the session token budget and cancellation.
/// `max_turns` survives only for callers that have neither guard (`jan cli
/// agent step`, the API-server proxy); `0` and absent both mean unbounded.
fn body_turn_cap(json_body: &serde_json::Value) -> usize {
    json_body
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize
}

/// Token-spend ceiling for a request body, the real bound on run length.
/// `0` is the explicit "no ceiling" encoding, matching `max_turns`.
fn body_session_budget(json_body: &serde_json::Value) -> Option<u64> {
    json_body
        .get("max_session_tokens")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
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
    // `max_turns == 0` is the normal case: the session token budget and user
    // cancellation are the real guards, so a run isn't cut off mid-task by a
    // fixed turn cap.
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
                        // Publish now, not at the end of the run: a retry that
                        // never recovers returns Err, and an unpublished
                        // compaction leaves the client holding the oversized
                        // history that every later turn would re-overflow on.
                        let _ = events.send(StreamEvent::MessagesUpdated {
                            messages: conversation_messages.clone(),
                        });
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

        // The session budget is exhausted. This is a soft stop, not an error:
        // a subagent that inherits the parent's remaining budget must hand back
        // its partial progress (as an assistant message) so the parent can act
        // on it, instead of the run hard-failing and losing the work. Tool
        // calls are not executed; nothing further is spent against the ceiling.
        if budget.exhausted() {
            let partial = extract_choice_message(&completion)
                .and_then(|m| m.get("content").and_then(|c| c.as_str()))
                .unwrap_or("")
                .to_string();
            let stop_note = format!(
                "[session token budget exhausted ({} tokens)] Partial progress so far:\n\
                 {}",
                budget.spent(),
                if partial.is_empty() {
                    "(none yet reported)".to_string()
                } else {
                    partial
                }
            );
            conversation_messages.push(serde_json::json!({
                "role": "assistant",
                "content": stop_note,
            }));
            let _ = events.send(StreamEvent::MessagesUpdated {
                messages: conversation_messages.clone(),
            });
            return Ok(serde_json::json!({
                "choices": [{ "message": { "content": stop_note }, "finish_reason": "stop" }]
            }));
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
                    && tauri_plugin_agent_tools::tools::handlers::bash_result_failed(&content));
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
        "reached the {max_turns}-turn limit while the model was still calling tools"
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
    async fn goal_todo_plan_forced_while_a_goal_has_no_plan() {
        assert!(should_force_goal_todo_plan(true, &Some(empty_todo_registry())).await);
    }

    #[tokio::test]
    async fn goal_todo_plan_not_forced_once_the_plan_is_staged() {
        assert!(!should_force_goal_todo_plan(true, &Some(staged_todo_registry())).await);
    }

    #[tokio::test]
    async fn goal_todo_plan_never_forced_outside_goal_mode() {
        assert!(!should_force_goal_todo_plan(false, &Some(empty_todo_registry())).await);
    }

    #[tokio::test]
    async fn goal_todo_plan_not_forced_without_a_registry() {
        // No registry means the `todo` tool is never advertised, so forcing it
        // would name a tool the request does not carry.
        assert!(!should_force_goal_todo_plan(true, &None).await);
    }

    #[tokio::test]
    async fn todo_addendum_is_upkeep_only_outside_goal_mode() {
        let staged = Some(staged_todo_registry());
        assert_eq!(
            todo_prompt_addendum(false, &staged).await,
            Some(crate::core::agent::context::TODO_UPKEEP_PROMPT_ADDENDUM)
        );
        assert_eq!(
            todo_prompt_addendum(false, &Some(empty_todo_registry())).await,
            None
        );
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
                StreamEvent::ToolResult { content, .. } if content == "MOCK_RESULT" => {
                    saw_tool_result = true;
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
            &[crate::core::agent::todo::todo_tool_schema()],
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

    #[test]
    fn forced_tool_choice_requires_an_advertised_tool() {
        let messages = vec![json!({ "role": "user", "content": "build a flappy bird clone" })];
        let ask_only = vec![crate::core::agent::interaction::ask_tool_schema()];

        let ask_request =
            build_completion_request("m", &messages, &ask_only, &json!({}), Some("todo"));
        assert_eq!(
            ask_request["tool_choice"], "auto",
            "a named tool_choice must not select a tool omitted from tools"
        );

        let todo = crate::core::agent::todo::todo_tool_schema();
        let todo_request =
            build_completion_request("m", &messages, &[todo], &json!({}), Some("todo"));
        assert_eq!(
            todo_request["tool_choice"],
            json!({ "type": "function", "function": { "name": "todo" } })
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
        assert_eq!(addendum, Some(crate::core::agent::context::TODO_UPKEEP_PROMPT_ADDENDUM));

        // A first substantive message gets the init guidance instead.
        assert_eq!(
            todo_prompt_addendum(true, &registry).await,
            Some(crate::core::agent::context::EAGER_TODO_PROMPT_ADDENDUM)
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
    async fn turn_cycle_soft_stops_when_budget_exhausted() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut over_budget = tool_call_completion();
        over_budget["usage"] = json!({ "total_tokens": 100 });
        let model = MockModel::new(vec![over_budget]);
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(Some(50));
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
        .expect("budget exhaustion is a soft stop, not an error");

        let final_text = extract_choice_message(&result)
            .and_then(|m| m.get("content").and_then(|c| c.as_str()))
            .unwrap_or_default();
        let spent = budget.spent();
        assert!(
            final_text.contains("budget")
                && final_text.contains(&spent.to_string()),
            "soft stop should describe the exhausted budget ({spent} tokens): {final_text}",
        );
        assert!(
            tool.calls.lock().unwrap().is_empty(),
            "tool must not run once budget is exhausted"
        );
        // A MessagesUpdated is published so live surfaces (and the replay
        // session) see the partial conversation before the soft stop.
        assert!(
            std::iter::from_fn(|| rx.try_recv().ok()).any(
                |ev| matches!(ev, StreamEvent::MessagesUpdated { .. })
            ),
            "expected a MessagesUpdated event on soft stop"
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

    /// A run that never recovers from overflow still has to hand its compacted
    /// conversation to the client: without it the session keeps the oversized
    /// history and every later turn re-overflows by construction.
    #[tokio::test]
    async fn turn_cycle_publishes_compacted_history_before_giving_up() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let overflow = || {
            Err(format!(
                "[{}] Upstream returned HTTP 400: context_length_exceeded",
                crate::core::agent::upstream::CONTEXT_OVERFLOW_MARKER
            ))
        };
        let summary = || Ok(json!({ "choices": [{ "message": { "content": "SUMMARY" } }] }));
        let model = ResultQueueModel {
            results: StdMutex::new(
                vec![
                    overflow(),
                    summary(),
                    overflow(),
                    summary(),
                    overflow(),
                    summary(),
                    overflow(),
                    summary(),
                    overflow(),
                ]
                .into_iter()
                .collect(),
            ),
        };
        let tool = MockTool::default();
        let mut budget = SessionBudget::new(None);
        let mut convo = vec![json!({ "role": "system", "content": "sys" })];
        for i in 0..60 {
            let r = if i % 2 == 0 { "user" } else { "assistant" };
            convo.push(json!({ "role": r, "content": format!("m{i}") }));
        }
        let original_len = convo.len();

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
        .await;

        assert!(result.is_err(), "a persistent overflow must still fail");
        drop(tx);
        let mut published: Option<usize> = None;
        while let Ok(ev) = rx.try_recv() {
            if let StreamEvent::MessagesUpdated { messages } = ev {
                published = Some(messages.len());
            }
        }
        let len = published.expect("compaction must publish MessagesUpdated");
        assert!(
            len < original_len,
            "published history must be shorter than the overflowing one ({len} vs {original_len})"
        );
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
    fn absent_turn_cap_is_unbounded() {
        assert_eq!(body_turn_cap(&json!({})), 0);
        assert_eq!(body_turn_cap(&json!({ "max_turns": 0 })), 0);
        assert_eq!(body_turn_cap(&json!({ "max_turns": 3 })), 3);
    }

    #[test]
    fn session_budget_treats_zero_and_absent_as_no_ceiling() {
        assert_eq!(body_session_budget(&json!({})), None);
        assert_eq!(body_session_budget(&json!({ "max_session_tokens": 0 })), None);
        assert_eq!(
            body_session_budget(&json!({ "max_session_tokens": 128_000 })),
            Some(128_000)
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

    use tauri_plugin_agent_tools::permissions::{PermissionDefault, ToolPermissions};
    use tauri_plugin_agent_tools::tools::gate::{PermissionDecision, SessionGrants};
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
            store_root: tauri_plugin_agent_tools::workspace::project_store(&root),
            enabled_skills: Vec::new(),
            allow_network: DEFAULT_ALLOW_NETWORK,
            allow_home_read: DEFAULT_ALLOW_HOME_READ,
            scratch_root: tauri_plugin_agent_tools::workspace::scratch_dir("test-session"),
            project_root: root,
            // Read-only default => write PROMPTS.
            permissions: ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]),
            events,
            permission_requests: registry,
            ask_requests: None,
            todo_registry: None,
            grants: std::sync::Mutex::new(SessionGrants::default()),
            subagents: None,
            auto_approve: false,
            run_mode: crate::core::agent::plan::RunMode::Normal,
        }
    }

    /// The whole point of the setting: what agent.toml says has to survive the
    /// trip into the invoker. This is the assertion that was missing when the
    /// resolution passed `None` and silently ignored the file.
    #[test]
    fn agent_toml_network_setting_reaches_the_invoker() {
        let root = std::env::temp_dir().join(format!(
            "jan_loop_net_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let agent_dir = root.join(".jan").join("agent");
        std::fs::create_dir_all(&agent_dir).expect("create agent dir");

        let write = |body: &str| {
            std::fs::write(agent_dir.join("agent.toml"), body).expect("write agent.toml")
        };

        write("[tools]\nallow_network = false\n[skills]\nenabled = [\"deploy\"]\n");
        let denied = resolve_run_settings(&root);
        assert!(!denied.allow_network, "explicit false must be honoured");
        assert_eq!(denied.enabled_skills, vec!["deploy".to_string()]);

        write("[tools]\nallow_network = true\n");
        assert!(
            resolve_run_settings(&root).allow_network,
            "explicit true must be honoured"
        );

        write("[tools]\ndefault = \"read-only\"\n");
        assert_eq!(
            resolve_run_settings(&root).allow_network,
            DEFAULT_ALLOW_NETWORK,
            "unset must fall back to the surface default"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// An explicit `[tools].allow_network` overrides the surface default in both
    /// directions, so a project can lock the shell down or open it up whichever
    /// way its surface leans.
    #[test]
    fn configured_allow_network_overrides_the_default() {
        assert!(resolve_allow_network(Some(true)));
        assert!(!resolve_allow_network(Some(false)));
        assert_eq!(resolve_allow_network(None), DEFAULT_ALLOW_NETWORK);
    }

    /// `[tools].allow_home_read` likewise overrides the CLI default (on by
    /// default) in both directions, so a project can lock `$HOME` back down.
    #[test]
    fn configured_allow_home_read_overrides_the_default() {
        assert!(resolve_allow_home_read(Some(true)));
        assert!(!resolve_allow_home_read(Some(false)));
        assert_eq!(resolve_allow_home_read(None), DEFAULT_ALLOW_HOME_READ);
    }

    /// The CLI agent's shell keeps its network namespace. Before the sandbox
    /// existed this shell ran fully unconfined, so flipping this to `false`
    /// silently breaks `curl`, `git fetch` and package installs while every
    /// test that does not actually open a socket keeps passing.
    #[test]
    #[cfg(feature = "cli")]
    fn cli_tool_context_allows_network() {
        let root = std::path::PathBuf::from("/tmp/jan-net-check");
        let (tx, _rx) = mpsc::unbounded_channel();
        let invoker = build_prompting_invoker(
            root,
            tx,
            Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        );
        assert!(
            invoker.tool_context().allow_network,
            "CLI shell must keep its network namespace"
        );
    }

    /// The CLI shell reads `$HOME` (so git/ssh credential helpers work) unless
    /// the project explicitly opts out.
    #[test]
    #[cfg(feature = "cli")]
    fn cli_tool_context_reads_home() {
        let root = std::path::PathBuf::from("/tmp/jan-home-check");
        let (tx, _rx) = mpsc::unbounded_channel();
        let invoker = build_prompting_invoker(
            root,
            tx,
            Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        );
        assert!(
            invoker.tool_context().home_readonly,
            "CLI shell must read $HOME"
        );
    }

    /// The desktop keeps the full isolation: the sandbox masks `$HOME` rather
    /// than binding it read-only, so the Jan data folder (which lives inside
    /// `$HOME`) stays unreadable.
    #[test]
    #[cfg(not(feature = "cli"))]
    fn desktop_tool_context_withholds_home() {
        let root = std::path::PathBuf::from("/tmp/jan-home-check");
        let (tx, _rx) = mpsc::unbounded_channel();
        let invoker = build_prompting_invoker(
            root,
            tx,
            Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        );
        assert!(!invoker.tool_context().home_readonly);
    }

    /// The desktop chat sandbox is ephemeral and unprompted, so it opts in per
    /// call from a user setting instead of defaulting on here.
    #[test]
    #[cfg(not(feature = "cli"))]
    fn desktop_tool_context_withholds_network() {
        let root = std::path::PathBuf::from("/tmp/jan-net-check");
        let (tx, _rx) = mpsc::unbounded_channel();
        let invoker = build_prompting_invoker(
            root,
            tx,
            Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        );
        assert!(!invoker.tool_context().allow_network);
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
    async fn plan_mode_denies_write_even_with_auto_approve() {
        let root = unique_project_root();
        let (tx, _rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.run_mode = crate::core::agent::plan::RunMode::Plan;
        // Auto-approval must NOT override the plan-mode read-only gate.
        invoker.auto_approve = true;

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
        invoker.auto_approve = true;

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
    async fn ask_waits_for_and_returns_model_readable_response() {
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
        assert_eq!(out[0].content, "User response for \"scope\": Small");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn ask_returns_custom_response_as_clear_model_text() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let asks = crate::core::agent::interaction::new_registry();
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.ask_requests = Some(asks.clone());

        let task = tokio::spawn(async move { invoker.invoke(&[ask_call()]).await.unwrap() });
        let request_id = match rx.recv().await.unwrap() {
            StreamEvent::AskRequest { request_id, .. } => request_id,
            event => panic!("expected ask_request, got {event:?}"),
        };
        crate::core::agent::interaction::respond(
            &asks,
            &request_id,
            Ok(vec![crate::core::agent::interaction::QuestionResult {
                id: "scope".into(),
                selected: Vec::new(),
                custom_input: Some("CUSTOM-SENTINEL-4829".into()),
            }]),
        )
        .await
        .unwrap();

        let out = task.await.unwrap();
        assert_eq!(
            out[0].content,
            "User response for \"scope\": CUSTOM-SENTINEL-4829"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn ask_returns_custom_response_at_invoker_boundary() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let permissions: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let asks = crate::core::agent::interaction::new_registry();
        let mut invoker = build_prompting_invoker(root.clone(), tx, permissions);
        invoker.ask_requests = Some(asks.clone());

        let task = tokio::spawn(async move { invoker.invoke(&[ask_call()]).await.unwrap() });
        let request_id = match rx.recv().await.unwrap() {
            StreamEvent::AskRequest { request_id, .. } => request_id,
            event => panic!("expected ask_request, got {event:?}"),
        };
        crate::core::agent::interaction::respond(
            &asks,
            &request_id,
            Ok(vec![crate::core::agent::interaction::QuestionResult {
                id: "scope".into(),
                selected: Vec::new(),
                custom_input: Some("custom answer".into()),
            }]),
        )
        .await
        .unwrap();

        let out = task.await.unwrap();
        assert_eq!(out[0].content, "User response for \"scope\": custom answer");
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
    async fn auto_approve_writes_without_prompting() {
        let root = unique_project_root();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let mut invoker = build_prompting_invoker(root.clone(), tx, registry);
        invoker.auto_approve = true;

        let out = invoker.invoke(&[write_call()]).await.unwrap();

        assert_eq!(out.len(), 1);
        assert!(!out[0].content.starts_with("ERROR"), "unexpected: {}", out[0].content);
        assert_eq!(std::fs::read_to_string(root.join("out.txt")).unwrap(), "hi");
        // No permission prompt should have been emitted.
        assert!(
            !matches!(rx.try_recv(), Ok(StreamEvent::PermissionRequest { .. })),
            "auto_approve must not prompt for a write"
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
        use tauri_plugin_agent_tools::permissions::{PermissionDefault, ToolPermissions};
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
        use tauri_plugin_agent_tools::permissions::{PermissionDefault, ToolPermissions};
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
        use tauri_plugin_agent_tools::permissions::{PermissionDefault, ToolPermissions};
        let mut tools = vec![json!({ "type": "function", "function": { "name": "web_search_exa" } })];
        let mut map = HashMap::from([("web_search_exa".to_string(), "exa".to_string())]);
        let perms = ToolPermissions::new(PermissionDefault::Deny, &[], &[], &[]);

        retain_advertisable_mcp_tools(&mut tools, &mut map, &perms);

        assert!(tools.is_empty(), "default=deny must lock down MCP advertisement");
        assert!(map.is_empty());
    }
}
