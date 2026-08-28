//! Tauri command surface for the agent's project-scoped state: skills, the
//! skill hub, plugins, and the git branch shown in the workspace pill.
//!
//! The agent *loop* is no longer driven from here. The desktop runs it in the
//! renderer on the Vercel AI SDK (`web-app/src/lib/coworkRunner.ts`), calling
//! the tool plugin directly; `core::agent::r#loop` stays for the headless CLI
//! and the OpenAI-compatible API server, which still orchestrate in Rust.

use crate::core::agent::git;
use crate::core::agent::plugins;
use crate::core::agent::project::{
    agent_toml_path, ensure_project, load_agent_config, set_skills_enabled_in_agent_toml,
};
use crate::core::agent::skill_hub;
use crate::core::agent::skills as agent_skills;
use crate::core::agent::subagent;
use crate::core::app::commands::get_jan_data_folder_path;
use tauri_plugin_agent_tools::skills::{self, SkillMeta};
use tauri_plugin_agent_tools::workspace;

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
pub async fn agent_skill_enabled_set(project: String, enabled: Vec<String>) -> Result<(), String> {
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

/// A saved subagent definition, for the `task` tool's advertised name list and
/// the Cowork subagents panel.
#[derive(serde::Serialize)]
pub struct SubagentDefinitionDto {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    /// When set, the child's toolset is this list intersected with the parent's;
    /// it never widens. `None` inherits the parent's set.
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
}

/// Every subagent saved for the desktop, from the single
/// `<jan_data>/agent-workspace/subagents/` directory.
///
/// Deliberately not the CLI's plugin/user/project merge: Cowork has no project
/// root in a default session, and an attached folder is mounted read-only, so
/// scanning it would let a cloned repo inject a system prompt and a tool
/// allowlist into the agent. Malformed files are skipped, so a bad TOML costs one
/// definition rather than the whole list.
#[tauri::command]
pub async fn agent_subagent_list<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SubagentDefinitionDto>, String> {
    let dir = subagent::desktop_subagents_dir(&get_jan_data_folder_path(app_handle));
    Ok(
        subagent::SubagentRegistry::load_one(&dir, subagent::SubagentScope::User)
            .list()
            .into_iter()
            .map(|d| SubagentDefinitionDto {
                name: d.name.clone(),
                description: d.description.clone(),
                system_prompt: d.system_prompt.clone(),
                allowed_tools: d.allowed_tools.clone(),
                model: d.model.clone(),
            })
            .collect(),
    )
}
