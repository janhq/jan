//! Tauri command surface for the shared agent loop. Lives in-crate (not a
//! separate plugin) because the loop depends on app-owned state
//! (`LlamacppState`, MLX sessions, provider configs, MCP). `agent_run` bridges
//! the loop's Tauri-free `mpsc` event stream onto a `tauri::ipc::Channel` and is
//! cancellable by `run_id` via `agent_cancel`.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::core::agent::events::StreamEvent;
use crate::core::agent::git;
use crate::core::agent::plugins;
use crate::core::agent::project::{
    agent_toml_path, ensure_project, load_agent_config, permissions_from,
    set_skills_enabled_in_agent_toml,
};
use crate::core::agent::r#loop::{run_orchestration_streamed, OrchestrationArgs};
use crate::core::agent::skill_hub;
use crate::core::agent::skills as agent_skills;
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::agent::env_provider;
use crate::core::state::AppState;
use tauri_plugin_agent_tools::permissions::ToolPermissions;
use tauri_plugin_agent_tools::skills::{self, SkillMeta};
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use tauri_plugin_agent_tools::workspace;

/// Registry of in-flight agent runs keyed by client-supplied `run_id`, holding a
/// one-shot cancel sender per run. Managed via `app.manage(AgentRuns::default())`.
#[derive(Default)]
pub struct AgentRuns(pub Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>);

/// Registry of in-flight permission prompts keyed by request_id, shared with the
/// agent loop so `agent_permission_respond` can resolve the awaiting tool call.
#[derive(Default)]
pub struct AgentPermissions(pub Arc<Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>>);

fn build_orchestration_args<R: Runtime>(
    app_handle: &AppHandle<R>,
    state: &AppState,
) -> OrchestrationArgs {
    let llama_state: State<Arc<LlamacppState>> = app_handle.state();
    let llama_state_arc = llama_state.inner().clone();

    // MLX is macOS-only; elsewhere the session map is permanently empty.
    #[cfg(target_os = "macos")]
    let mlx_sessions = {
        let mlx_state: State<tauri_plugin_mlx::state::MlxState> = app_handle.state();
        mlx_state.mlx_server_process.clone()
    };
    #[cfg(not(target_os = "macos"))]
    let mlx_sessions: Arc<Mutex<HashMap<i32, crate::core::server::MlxBackendSession>>> =
        Arc::new(Mutex::new(HashMap::new()));

    OrchestrationArgs {
        client: reqwest::Client::new(),
        provider_configs: state.provider_configs.clone(),
        llama_state: llama_state_arc,
        mlx_sessions,
        mcp_servers: state.mcp_servers.clone(),
        mcp_settings: state.mcp_settings.clone(),
        jan_data_folder: get_jan_data_folder_path(app_handle.clone())
            .to_string_lossy()
            .into_owned(),
        permissions: ToolPermissions::allow_all(),
        project_root: None,
        permission_requests: Arc::new(Mutex::new(HashMap::new())),
        ask_requests: None,
        todo_registry: None,
        system_prompt_override: None,
        subagents_enabled: true,
        max_parallel_subagents: crate::core::agent::subagent::DEFAULT_MAX_PARALLEL_SUBAGENTS,
        auto_approve: false,
        run_mode: crate::core::agent::plan::RunMode::Normal,
        session_id: None,
        sandbox: None,
    }
}

/// Run the agent loop for one request, streaming `StreamEvent`s to `on_event`.
/// Resolves when the loop reaches a terminal state (or is cancelled); the
/// terminal `Done`/`Error` is also delivered over the channel.
#[tauri::command]
pub async fn agent_run<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    runs: State<'_, AgentRuns>,
    perms_registry: State<'_, AgentPermissions>,
    run_id: String,
    mut body: serde_json::Value,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let mut args = build_orchestration_args(&app_handle, &state);
    args.permission_requests = perms_registry.0.clone();

    // When a project is explicitly named, its agent.toml governs tool permissions.
    // The project is auto-managed: scaffold a `.jan/agent/` on first use, then
    // load it. A malformed config is still a hard error (never silently permissive).
    if let Some(project) = body.get("project").and_then(|v| v.as_str()) {
        let project_root = std::path::PathBuf::from(project);
        ensure_project(&project_root)?;
        let cfg = load_agent_config(&project_root)?;
        args.permissions = permissions_from(&cfg);
        args.project_root = Some(project_root);
    }

    // `JAN_AGENT_MODEL_ID` overrides the body model at the highest priority
    // (beats the UI selection, agent.toml, and --model); `JAN_AGENT_API_KEY` +
    // `JAN_AGENT_BASE_URL` then inject a synthetic upstream for that model.
    if let Some(env_model) = env_provider::env_model_id() {
        if let Some(obj) = body.as_object_mut() {
            obj.insert(
                "model".to_string(),
                serde_json::Value::String(env_model.clone()),
            );
        }
        log::info!(
            "Agent: JAN_AGENT_MODEL_ID overrides body model to '{}'",
            env_model
        );
    }
    let body_model = body
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    {
        let mut configs = args.provider_configs.lock().await;
        env_provider::inject_env_provider(&mut configs, body_model.as_deref());
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    let forward = tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if on_event.send(ev).is_err() {
                break;
            }
        }
    });

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    runs.0.lock().await.insert(run_id.clone(), cancel_tx);

    // Cancellation is a normal terminal state: emit one `cancelled` event and
    // resolve Ok so the invoke promise does not also surface as an error.
    let result = tokio::select! {
        r = run_orchestration_streamed(&tx, &body, &args) => r,
        _ = cancel_rx => {
            let _ = tx.send(StreamEvent::Error {
                code: "cancelled".to_string(),
                message: "Agent run cancelled".to_string(),
            });
            Ok(serde_json::Value::Null)
        }
    };

    drop(tx);
    let _ = forward.await;
    runs.0.lock().await.remove(&run_id);

    result.map(|_| ())
}

/// Cancel an in-flight `agent_run` by `run_id`. No-op if the run already
/// finished or never existed.
#[tauri::command]
pub async fn agent_cancel(runs: State<'_, AgentRuns>, run_id: String) -> Result<(), String> {
    if let Some(cancel_tx) = runs.0.lock().await.remove(&run_id) {
        let _ = cancel_tx.send(());
    }
    Ok(())
}

/// Resolve an in-flight permission prompt emitted by the agent loop.
#[tauri::command]
pub async fn agent_permission_respond(
    perms_registry: State<'_, AgentPermissions>,
    request_id: String,
    decision: PermissionDecision,
) -> Result<(), String> {
    if let Some(tx) = perms_registry.0.lock().await.remove(&request_id) {
        let _ = tx.send(decision);
    }
    Ok(())
}

/// Strip the internal `ERROR: ` prefix (an agent-tool-output convention) so the
/// message reads cleanly in a UI toast.
fn ui_error(e: String) -> String {
    e.strip_prefix("ERROR: ").map(str::to_string).unwrap_or(e)
}

/// List the skills under `<project>/.jan/agent/skills/` (folder `<name>/SKILL.md`
/// and legacy flat `<name>.md`). These are the same skills `load_skills` injects
/// into the agent's system prompt; managing them here is CRUD over that
/// directory. Read-only: returns empty when the project isn't scaffolded yet.
#[tauri::command]
pub async fn agent_skill_list(project: String) -> Result<Vec<SkillMeta>, String> {
    let root = std::path::PathBuf::from(&project);
    Ok(skills::list_meta(&workspace::project_store(&root)))
}

/// Read one skill's raw SKILL.md (frontmatter included) for the editor.
#[tauri::command]
pub async fn agent_skill_read(project: String, name: String) -> Result<String, String> {
    let root = std::path::PathBuf::from(&project);
    skills::read_raw(&workspace::project_store(&root), &name).map_err(ui_error)
}

/// Create or overwrite a skill. New skills are written as `<name>/SKILL.md`;
/// existing ones keep their on-disk form. `name` is sanitized (no path escape).
#[tauri::command]
pub async fn agent_skill_write(
    project: String,
    name: String,
    content: String,
) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    ensure_project(&root)?;
    skills::write(&workspace::project_store(&root), &name, &content).map_err(ui_error)
}

/// Delete a skill by name. Idempotent: a missing skill is treated as success.
#[tauri::command]
pub async fn agent_skill_delete(project: String, name: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    skills::delete(&workspace::project_store(&root), &name).map_err(ui_error)
}

/// List the skills available on Anthropic's public skill hub (name + purpose).
#[tauri::command]
pub async fn agent_skill_hub_list() -> Result<Vec<skill_hub::HubSkill>, String> {
    skill_hub::list().await.map_err(ui_error)
}

/// Download a hub skill (SKILL.md + bundled files) into the project as
/// `<name>/SKILL.md`. Scaffolds the project on first use.
#[tauri::command]
pub async fn agent_skill_hub_import(project: String, name: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    ensure_project(&root)?;
    skill_hub::import(&root, &name).await.map_err(ui_error)
}

/// Read the project's enabled-skill whitelist (`[skills].enabled`). An empty
/// list means all skills are enabled.
#[tauri::command]
pub async fn agent_skill_enabled_get(project: String) -> Result<Vec<String>, String> {
    let root = std::path::PathBuf::from(&project);
    Ok(load_agent_config(&root)
        .map(|c| c.skills.enabled)
        .unwrap_or_default())
}

/// Set the project's enabled-skill whitelist. Empty = all skills enabled.
/// Persisted to `[skills].enabled` in agent.toml (format-preserving).
#[tauri::command]
pub async fn agent_skill_enabled_set(
    project: String,
    enabled: Vec<String>,
) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    ensure_project(&root)?;
    set_skills_enabled_in_agent_toml(&agent_toml_path(&root), &enabled).map_err(ui_error)
}

/// Build the user message for invoking an enabled skill (`/skill:<name>` /
/// `<skill>` semantics shared with the console): the full skill body wrapped
/// in an invocation header, skill directory announcement for bundled files,
/// and the user's `args` threaded in. Err when the skill is unknown or
/// disabled. UIs submit the returned message through their own session flow.
#[tauri::command]
pub async fn agent_skill_invoke(
    project: String,
    name: String,
    args: String,
) -> Result<String, String> {
    let root = std::path::PathBuf::from(&project);
    agent_skills::build_invocation_message(&root, &name, &args)
        .map(|(message, _)| message)
        .map_err(ui_error)
}

/// List installed plugins under `<project>/.jan/agent/plugins/` with metadata
/// and skill counts.
#[tauri::command]
pub async fn agent_plugin_list(project: String) -> Result<Vec<plugins::InstalledPlugin>, String> {
    let root = std::path::PathBuf::from(&project);
    Ok(plugins::installed(&root))
}

/// Install a plugin from a git URL or configured marketplace name.
#[tauri::command]
pub async fn agent_plugin_install(
    project: String,
    spec: String,
) -> Result<plugins::InstalledPlugin, String> {
    let root = std::path::PathBuf::from(&project);
    plugins::install(&root, &spec).await.map_err(ui_error)
}

/// Remove an installed plugin by directory name.
#[tauri::command]
pub async fn agent_plugin_remove(project: String, name: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&project);
    plugins::remove(&root, &name).map_err(ui_error)
}

/// Search the configured plugin marketplace.
#[tauri::command]
pub async fn agent_plugin_search(
    project: String,
    query: String,
) -> Result<Vec<plugins::MarketEntry>, String> {
    let root = std::path::PathBuf::from(&project);
    plugins::search(&root, &query).await.map_err(ui_error)
}

/// Return the git branch name for the project at `project`, or `None` when the
/// folder is not inside a git repo (or git is not installed). Used by the Code
/// UI to display the current branch alongside the working directory.
#[tauri::command]
pub fn agent_git_branch(project: String) -> Option<String> {
    git::current_branch(std::path::Path::new(&project))
}
