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
use tauri_plugin_agent_tools::permissions::ToolPermissions;
use crate::core::agent::project::{
    agent_toml_path, ensure_project, load_agent_config, permissions_from,
    set_skills_enabled_in_agent_toml,
};
use crate::core::agent::r#loop::{run_orchestration_streamed, OrchestrationArgs};
use crate::core::agent::skill_hub;
use tauri_plugin_agent_tools::skills::{self, SkillMeta};
use tauri_plugin_agent_tools::workspace;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::AppState;

/// One in-flight `agent_run`'s cancel sender plus its background-subagent
/// registry, so `agent_cancel_subagent` can reach a specific dispatched
/// subagent from outside the loop without cancelling the whole run.
pub struct RunEntry {
    pub cancel_tx: oneshot::Sender<()>,
    pub background_subagents: Arc<crate::core::agent::subagent::BackgroundSubagents>,
}

/// Registry of in-flight agent runs keyed by client-supplied `run_id`.
/// Managed via `app.manage(AgentRuns::default())`.
#[derive(Default)]
pub struct AgentRuns(pub Arc<Mutex<HashMap<String, RunEntry>>>);

/// Registry of in-flight permission prompts keyed by request_id, shared with the
/// agent loop so `agent_permission_respond` can resolve the awaiting tool call.
#[derive(Default)]
pub struct AgentPermissions(pub Arc<Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>>);

/// Registry of in-flight `ask` tool questions keyed by request_id, shared with
/// the agent loop so `agent_ask_respond` can resolve the awaiting tool call.
/// Global (not per-run) like `AgentPermissions`, since request ids are unique
/// across every run.
#[derive(Default)]
pub struct AgentAsks(pub crate::core::agent::interaction::AskRegistry);

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
        yolo: false,
        background_subagents: None,
        run_mode: crate::core::agent::plan::RunMode::Normal,
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
    asks_registry: State<'_, AgentAsks>,
    run_id: String,
    body: serde_json::Value,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let mut args = build_orchestration_args(&app_handle, &state);
    args.permission_requests = perms_registry.0.clone();
    args.ask_requests = Some(asks_registry.0.clone());
    let background_subagents =
        Arc::new(crate::core::agent::subagent::BackgroundSubagents::default());
    args.background_subagents = Some(background_subagents.clone());
    // The session's todo list is client-persisted (there is no long-lived
    // Rust-side session here, unlike the TUI's App): the client sends back
    // whatever it last saw, we seed a fresh registry from it, and `todo`-tool
    // mutations stream back out as `TodoUpdate` events for the client to persist.
    let todo_list: crate::core::agent::todo::TodoList = body
        .get("todos")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    args.todo_registry = Some(Arc::new(Mutex::new(todo_list)));

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

    // Mirrors the CLI's `--yolo` flag: an explicit per-request opt-in to
    // disable the permission gate and auto-allow every tool call. Omitted or
    // non-bool keeps the safe `false` default set above.
    if let Some(yolo) = body.get("yolo").and_then(|v| v.as_bool()) {
        args.yolo = yolo;
    }
    // Mirrors the CLI's `--plan`/`/plan`: read-only mode where mutation-capable
    // tools are hard-denied at the dispatcher. Omitted or non-bool keeps Normal.
    if body.get("plan").and_then(|v| v.as_bool()).unwrap_or(false) {
        args.run_mode = crate::core::agent::plan::RunMode::Plan;
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
    runs.0.lock().await.insert(
        run_id.clone(),
        RunEntry {
            cancel_tx,
            background_subagents,
        },
    );

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
    if let Some(entry) = runs.0.lock().await.remove(&run_id) {
        let _ = entry.cancel_tx.send(());
    }
    Ok(())
}

/// Cancel one background subagent within an in-flight `agent_run`, without
/// affecting the parent run or any other dispatched subagent. No-op if the
/// parent run or the subagent has already finished (or never existed) — the
/// subagent's own terminal SubagentEnd is never sent when aborted this way,
/// same as when the whole parent run tears down.
#[tauri::command]
pub async fn agent_cancel_subagent(
    runs: State<'_, AgentRuns>,
    run_id: String,
    subagent_run_id: String,
) -> Result<(), String> {
    if let Some(entry) = runs.0.lock().await.get(&run_id) {
        entry.background_subagents.abort_one(&subagent_run_id);
    }
    Ok(())
}

/// Manually compact a conversation's history for the given model, mirroring
/// the TUI's `/compact` command (see `compact_history` in loop.rs). Takes the
/// same `messages` shape the Code UI already persists as session history.
#[tauri::command]
pub async fn agent_compact<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    model_id: String,
    messages: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let args = build_orchestration_args(&app_handle, &state);
    crate::core::agent::r#loop::compact_history(
        &args,
        &model_id,
        &messages,
        crate::core::agent::compaction::MANUAL_KEEP_RECENT,
    )
    .await
}

/// Run one stateless `/goal` completion check for `condition` against
/// `messages`, using `smol_model_id` (the session's fast "smol" role model).
/// Mirrors `agent_compact`: same `OrchestrationArgs` resolution, no
/// streaming, no tools. Used by the Code UI's `/goal` slash command after
/// each turn to decide whether to keep nudging the agent or hand control
/// back (mirrors the TUI's in-loop evaluator, see `goal.rs`).
#[tauri::command]
pub async fn agent_goal_evaluate<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    smol_model_id: String,
    condition: String,
    messages: Vec<serde_json::Value>,
) -> Result<crate::core::agent::goal::GoalVerdict, String> {
    let args = build_orchestration_args(&app_handle, &state);
    crate::core::agent::r#loop::evaluate_goal(&args, &smol_model_id, &condition, &messages).await
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

/// Resolve an in-flight `ask` tool question. `answers` is `None` when the user
/// dismisses the dialog without answering, which the loop treats as cancelled
/// (a no-op if the request is no longer pending — already answered/timed out).
#[tauri::command]
pub async fn agent_ask_respond(
    asks_registry: State<'_, AgentAsks>,
    request_id: String,
    answers: Option<Vec<crate::core::agent::interaction::QuestionResult>>,
) -> Result<(), String> {
    let outcome = match answers {
        Some(results) => Ok(results),
        None => Err(crate::core::agent::interaction::AskError::Cancelled),
    };
    let _ = crate::core::agent::interaction::respond(&asks_registry.0, &request_id, outcome).await;
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

/// Return the git branch name for the project at `project`, or `None` when the
/// folder is not inside a git repo (or git is not installed). Used by the Code
/// UI to display the current branch alongside the working directory.
#[tauri::command]
pub fn agent_git_branch(project: String) -> Option<String> {
    git::current_branch(std::path::Path::new(&project))
}

/// Rasterize an artifact preview to a PNG data URL at exactly `width`x`height`
/// CSS pixels.
///
/// The annotation overlay calls this to get the pixels *under* its drawing
/// layer: the preview lives in a `sandbox="allow-scripts"` iframe with an opaque
/// origin, so nothing in the webview can rasterize it. Same headless Chrome path
/// as the model-facing `screenshot` tool, at the overlay's own stage size so the
/// render lines up with the strokes drawn on top of it.
///
/// `html` is the exact `srcdoc` the iframe was given, not the file on disk —
/// the shell it is wrapped in (CSP, `body{margin:0}`) changes the layout, so
/// rendering the raw file would land ~8px off from what the user drew on. It
/// goes to a temp file outside the project, so this touches no project state
/// and needs no path sandboxing.
#[tauri::command]
pub async fn agent_render_preview(
    html: String,
    width: u64,
    height: u64,
    scale: f64,
) -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let page = std::env::temp_dir().join(format!(
        "jan-preview-{}-{nanos}.html",
        std::process::id()
    ));
    tokio::fs::write(&page, html.as_bytes())
        .await
        .map_err(|e| format!("could not stage the preview for rendering: {e}"))?;
    let rendered =
        tauri_plugin_agent_tools::tools::handlers::render_html_png(&page, width, height, scale).await;
    let _ = tokio::fs::remove_file(&page).await;

    use base64::Engine as _;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&rendered?)
    ))
}
