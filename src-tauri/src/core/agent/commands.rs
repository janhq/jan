//! Tauri command surface for the shared agent loop plus plugin command
//! discovery and invocation. The loop surface lives in-crate (not a separate
//! plugin) because the loop depends on app-owned state (`LlamacppState`, MLX
//! sessions, provider configs, MCP): `agent_run` bridges the loop's Tauri-free
//! `mpsc` event stream onto a `tauri::ipc::Channel`, cancellable by `run_id`
//! via `agent_cancel`. A command is a Markdown prompt template shipped by a
//! plugin at `<plugin>/commands/<name>.md` (the Claude Code convention,
//! discovered recursively), with optional YAML frontmatter (`description`,
//! `argument-hint`), user-invoked from the slash popup.

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
use crate::core::agent::plugins;
use crate::core::agent::skills as agent_skills;
use tauri_plugin_agent_tools::skills::{self, SkillMeta};
use tauri_plugin_agent_tools::workspace;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::AppState;
/// Registry of in-flight agent runs keyed by client-supplied `run_id`, holding a
/// one-shot cancel sender per run. Managed via `app.manage(AgentRuns::default())`.
#[derive(Default)]
use std::path::{Path, PathBuf};

pub(crate) struct CommandEntry {
    /// File stem (`feature-dev` for `commands/feature-dev.md`).
    pub name: String,
    /// The plugin directory this command ships in.
    pub plugin: String,
    /// Frontmatter `description`, or the first body line when absent.
    pub description: String,
    /// The markdown file to read for the prompt template.
    pub file: PathBuf,
}

/// A command file's parsed content: frontmatter description + body with the
/// frontmatter fence stripped (same tolerance as skills).
pub(crate) struct ParsedCommand {
    pub description: String,
    pub body: String,
}

/// Every command shipped by installed plugins, sorted by plugin then name.
/// Discovery is recursive (`commands/**/*.md`), skips `README.md` and
/// dotfiles, and ignores interrupted `.installing-*` staging directories.
pub(crate) fn discover(root: &Path) -> Vec<CommandEntry> {
    let dir = crate::core::agent::skills::plugins_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(plugin) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if plugin.starts_with(".installing-") {
            continue;
        }
        scan_command_dir(&path.join("commands"), plugin, &mut out);
    }
    out.sort_by(|a, b| (&a.plugin, &a.name).cmp(&(&b.plugin, &b.name)));
    out
}

fn scan_command_dir(dir: &Path, plugin: &str, out: &mut Vec<CommandEntry>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            scan_command_dir(&path, plugin, out);
            continue;
        }
        if !ft.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.eq_ignore_ascii_case("README") {
            continue;
        }
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        let description = parse_command(&raw).description;
        out.push(CommandEntry {
            name: stem.to_string(),
            plugin: plugin.to_string(),
            description,
            file: path,
        });
    }
}

/// Commands offered to the human, honoring the `[skills].enabled` whitelist
/// (plugin name, qualified `<plugin>:<name>`, or plain name enable a command;
/// an empty whitelist enables everything).
pub(crate) fn catalog(root: &Path, enabled: &[String]) -> Vec<CommandEntry> {
    let commands = discover(root);
    if enabled.is_empty() {
        return commands;
    }
    commands
        .into_iter()
        .filter(|e| {
            let qualified = format!("{}:{}", e.plugin, e.name);
            enabled
                .iter()
                .any(|n| n == &qualified || n == &e.name || n == &e.plugin)
        })
        .collect()
}

/// Locate a command by the name a human typed: explicit `<plugin>:<name>`
/// first, then a plain name that is unique across installed plugins.
pub(crate) fn resolve(root: &Path, name: &str) -> Result<CommandEntry, String> {
    if let Some((plugin, plain)) = name.split_once(':') {
        if let Some(entry) = discover(root)
            .into_iter()
            .find(|e| e.plugin == plugin && e.name == plain)
        {
            return Ok(entry);
        }
    }
    let mut matches = discover(root).into_iter().filter(|e| e.name == name);
    match (matches.next(), matches.next()) {
        (Some(only), None) => Ok(only),
        _ => Err(format!("ERROR: command '{name}' not found")),
    }
}

/// Build the user message that runs a command: the invocation wrapper plus the
/// body with `$ARGUMENTS`/`$N` placeholders substituted. Returns
/// `(message, description)`, mirroring `skills::build_invocation_message`.
pub(crate) fn build_message(
    root: &Path,
    name: &str,
    args: &str,
) -> Result<(String, String), String> {
    let entry = resolve(root, name)?;
    let raw = std::fs::read_to_string(&entry.file).map_err(|e| format!("ERROR: {e}"))?;
    let parsed = parse_command(&raw);
    let body = substitute(&parsed.body, args.trim());
    let msg = format!(
        "[IMPORTANT: You have invoked the \"{name}\" command - follow its instructions. The full command content is loaded below.]\n\n{body}"
    );
    Ok((msg, parsed.description))
}

/// Substitute `$ARGUMENTS` (the full argument string) and `$1`..`$9`
/// (whitespace-split positional words) in a command body. Missing positions
/// become empty. `$10` and `$ARGUMENTATION`-style tokens are left literal so a
/// body can still talk about dollars.
pub(crate) fn substitute(body: &str, args: &str) -> String {
    let positional: Vec<&str> = args.split_whitespace().collect();
    let mut out = String::with_capacity(body.len() + args.len());
    let mut rest = body;
    loop {
        let Some(rel) = rest.find('$') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..rel]);
        let tail = &rest[rel + 1..];
        if let Some(after) = tail.strip_prefix("ARGUMENTS") {
            if after.chars().next().map_or(true, |c| !c.is_alphanumeric()) {
                out.push_str(args);
                rest = after;
                continue;
            }
        }
        let mut chars = tail.chars();
        if let Some(d) = chars.next().and_then(|c| c.to_digit(10)) {
            let after_digit = chars.as_str();
            let next_ok = after_digit.chars().next().map_or(true, |c| !c.is_ascii_digit());
            if (1..=9).contains(&d) && next_ok {
                if let Some(word) = positional.get(d as usize - 1) {
                    out.push_str(word);
                }
                rest = after_digit;
                continue;
            }
        }
        out.push('$');
        rest = tail;
    }
    out
}

/// Split leading `---\n...\n---` YAML frontmatter from a command body,
/// extracting the `description` (falling back to the first body line). Reuses
/// the skill parser's tolerance for missing/unterminated fences.
fn parse_command(raw: &str) -> ParsedCommand {
    let parsed = crate::core::agent::skills::parse(raw);
    let description = parsed.description.unwrap_or_else(|| {
        crate::core::agent::skills::first_line(&parsed.body)
    });
    ParsedCommand {
        description,
        body: parsed.body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::skills::plugins_dir;

    fn temp_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "jan_commands_{tag}_{}",
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn discover_finds_nested_commands_and_skips_readme_and_dotfiles() {
        let root = temp_root("disc");
        let cmd_dir = plugins_dir(&root).join("release").join("commands");
        std::fs::create_dir_all(cmd_dir.join("git")).unwrap();
        std::fs::write(cmd_dir.join("release.md"), "---\ndescription: Cut a release\n---\nDo it.")
            .unwrap();
        std::fs::write(cmd_dir.join("git").join("commit.md"), "commit body").unwrap();
        std::fs::write(cmd_dir.join("README.md"), "docs, not a command").unwrap();
        std::fs::write(cmd_dir.join(".hidden.md"), "skip me").unwrap();

        let names: Vec<String> = discover(&root)
            .into_iter()
            .map(|e| e.name.clone())
            .collect();
        assert_eq!(names, vec!["commit", "release"]);
        assert!(discover(&root).iter().all(|e| e.plugin == "release"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_supports_explicit_and_unique_plain_names() {
        let root = temp_root("resolve");
        let mk = |plugin: &str, name: &str| {
            let dir = plugins_dir(&root).join(plugin).join("commands");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{name}.md")), "body").unwrap();
        };
        mk("release", "prepare");
        mk("triage", "prepare");

        // Explicit form always works.
        assert!(resolve(&root, "release:prepare").is_ok());
        // Ambiguous plain name fails.
        assert!(resolve(&root, "prepare").is_err());
        // Unknown fails.
        assert!(resolve(&root, "nope").is_err());
        // Unique plain name resolves.
        mk("release", "ship");
        assert_eq!(resolve(&root, "ship").unwrap().name, "ship");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn substitute_replaces_arguments_and_positionals() {
        assert_eq!(
            substitute("request: $ARGUMENTS", "add auth"),
            "request: add auth"
        );
        assert_eq!(
            substitute("$1 then $2 then $1", "alpha beta"),
            "alpha then beta then alpha"
        );
        // Missing positional becomes empty.
        assert_eq!(substitute("[$1][$2]", "only"), "[only][]");
        // $10 is not $1 + "0"; $ARGUMENTATION is not $ARGUMENTS.
        assert_eq!(substitute("$10 $ARGUMENTATION", ""), "$10 $ARGUMENTATION");
        // No placeholders: body unchanged.
        assert_eq!(substitute("plain body", "ignored"), "plain body");
    }

    #[test]
    fn build_message_injects_body_and_substitutes_args() {
        let root = temp_root("msg");
        let cmd_dir = plugins_dir(&root).join("release").join("commands");
        std::fs::create_dir_all(&cmd_dir).unwrap();
        std::fs::write(
            cmd_dir.join("feature.md"),
            "---\ndescription: Build a feature\n---\nBuild: $ARGUMENTS",
        )
        .unwrap();

        let (msg, description) = build_message(&root, "feature", "add caching").unwrap();
        assert_eq!(description, "Build a feature");
        assert!(msg.contains("invoked the \"feature\" command"));
        assert!(msg.contains("Build: add caching"));
        // Unknown command errors.
        assert!(build_message(&root, "nope", "").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_filters_by_enabled_whitelist() {
        let root = temp_root("catalog");
        let mk = |plugin: &str, name: &str| {
            let dir = plugins_dir(&root).join(plugin).join("commands");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{name}.md")), "body").unwrap();
        };
        mk("release", "prepare");
        mk("triage", "prepare");

        // Empty whitelist: everything.
        assert_eq!(catalog(&root, &[]).len(), 2);
        // Plugin name enables all of its commands.
        assert_eq!(
            catalog(&root, &["release".to_string()])
                .iter()
                .map(|e| e.plugin.as_str())
                .collect::<Vec<_>>(),
            vec!["release"]
        );
        // Qualified name enables one command.
        let names: Vec<String> = catalog(&root, &["triage:prepare".to_string()])
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["prepare"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}


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
    body: serde_json::Value,
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
        // Give this run its own scratch. Without this the session-less desktop
        // path would fall back to a shared `<project>/agent-scratch` that
        // accumulates across runs and across sessions; a per-run id also means
        // the scratch can be wiped when the run ends (success, error, or
        // cancel) instead of persisting in the user's project.
        args.session_id = Some(uuid::Uuid::new_v4().to_string());
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

    // Wipe this run's dedicated scratch on every terminal path (success, error,
    // or cancel) so scratch and bash spill files never accumulate. A hard kill
    // is the one path that skips this; the startup sweep collects what it
    // leaves behind (`workspace::sweep_stale_scratch_dirs`).
    if let Some(session) = args.session_id.as_deref() {
        let _ = workspace::remove_scratch_dir(session).await;
    }

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
