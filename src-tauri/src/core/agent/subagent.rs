//! Subagent definitions and their two-scope registry. A subagent is a named,
//! reusable system prompt + default tool allowlist that the main agent can
//! dispatch a nested, isolated run against (see `dispatch_subagent`). Definitions
//! live as `<scope>/.jan/agent/subagents/<name>.toml`, merged from the user scope
//! (`~/.jan/agent/subagents/`) and the project scope (`<project>/.jan/agent/
//! subagents/`); the project scope shadows the user scope by name.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use tauri_plugin_agent_tools::permissions::ToolPermissions;
use tauri_plugin_agent_tools::tools::sandbox::scratch_display_path;
use tauri_plugin_agent_tools::tools::spill::{
    compose_subagent_result, fill_subagent_result, reserve_blackboard_result,
    SUBAGENT_INLINE_MAX_BYTES,
};
use tauri_plugin_agent_tools::workspace;

/// Directory name holding `<name>.toml` definitions, under both a project's
/// `.jan/agent/` and the desktop's permanent store.
const SUBAGENTS: &str = "subagents";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubagentScope {
    User,
    Project,
    /// A subagent shipped by an installed plugin (`<plugin>/agents/*.md`, the
    /// Claude Code convention). Read-only: managed via plugin install/remove,
    /// never via `create_subagent`.
    Plugin,
}

/// A dispatchable subagent definition, resolved from a `<name>.toml` file plus
/// the scope of the directory it was loaded from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentDefinition {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub scope: SubagentScope,
}

/// On-disk shape of a subagent `.toml`; `scope` is derived from the directory,
/// not stored in the file.
#[derive(Debug, Clone, Deserialize, Serialize)]
struct SubagentFile {
    name: String,
    description: String,
    system_prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    allowed_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubagentError {
    PermissionDenied(String),
    Upstream(String),
    Cancelled,
}

impl std::fmt::Display for SubagentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SubagentError::PermissionDenied(m) => write!(f, "permission denied: {m}"),
            SubagentError::Upstream(m) => write!(f, "{m}"),
            SubagentError::Cancelled => write!(f, "subagent run cancelled"),
        }
    }
}

/// `~/.jan/agent/subagents/`. `None` when the home directory can't be resolved.
pub fn user_subagents_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".jan").join("agent").join(SUBAGENTS))
}

/// `<project_root>/.jan/agent/subagents/`.
pub fn project_subagents_dir(project_root: &Path) -> PathBuf {
    project_root.join(".jan").join("agent").join(SUBAGENTS)
}

/// The desktop's single subagent directory:
/// `<jan_data_folder>/agent-workspace/subagents/`.
///
/// Cowork has no project root in a default session and mounts an attached folder
/// read-only, so two of the three CLI scopes (project, and plugin -- which is
/// also project-relative) are unreachable or unwritable there. Desktop keeps one
/// directory instead, a sibling of `memory/` and `skills/` in the permanent
/// store. That placement also puts it outside every tool's project root, so the
/// agent cannot rewrite its own definitions with `write`.
pub fn desktop_subagents_dir(jan_data_folder: &Path) -> PathBuf {
    workspace::store_dir(&workspace::permanent_store(jan_data_folder), SUBAGENTS)
}

/// A subagent name is used to build a filename, so it must be a single path
/// component of `[A-Za-z0-9_-]`. Rejects empty, separators, and dots.
fn validate_name(name: &str) -> Result<(), SubagentError> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(SubagentError::PermissionDenied(format!(
            "invalid subagent name '{name}': use only letters, digits, '-' and '_'"
        )));
    }
    Ok(())
}

/// Merged view of subagent definitions across the user and project scopes.
/// Load order is user first, then project, so `get` (which resolves the winning
/// definition) returns the project entry when both scopes define a name; `list`
/// still reports both so shadowing is visible.
#[derive(Debug, Default)]
pub struct SubagentRegistry {
    defs: Vec<SubagentDefinition>,
}

impl SubagentRegistry {
    /// Load plugin agents first (lowest precedence), then the user scope,
    /// then the project scope. `get` resolves the winning definition by
    /// reverse iteration, so a user/project TOML definition shadows a plugin
    /// agent of the same name. Malformed files are skipped with a warning
    /// rather than failing the whole run.
    pub fn load(project_root: &Path) -> Self {
        let mut defs = Vec::new();
        load_plugin_agents(project_root, &mut defs);
        if let Some(dir) = user_subagents_dir() {
            load_dir(&dir, SubagentScope::User, &mut defs);
        }
        load_dir(
            &project_subagents_dir(project_root),
            SubagentScope::Project,
            &mut defs,
        );
        Self { defs }
    }

    /// Load exactly one directory as one scope, for the desktop's flat layout
    /// (see [`desktop_subagents_dir`]). No merge, so no shadowing: `get` and
    /// `list` both see the same set.
    pub fn load_one(dir: &Path, scope: SubagentScope) -> Self {
        let mut defs = Vec::new();
        load_dir(dir, scope, &mut defs);
        Self { defs }
    }

    /// The winning definition for `name`: the project-scoped entry shadows a
    /// user-scoped one of the same name.
    pub fn get(&self, name: &str) -> Option<&SubagentDefinition> {
        self.defs.iter().rev().find(|d| d.name == name)
    }

    /// Every loaded definition, in load order (user scope first). Shadowed
    /// user-scope entries remain visible alongside their project-scope shadows.
    pub fn list(&self) -> Vec<&SubagentDefinition> {
        self.defs.iter().collect()
    }

    /// Write `def` to the directory for `scope`, refusing to clobber an existing
    /// definition of the same name in that same scope unless `overwrite`. Returns
    /// `true` when a project-scope write shadows a user-scope definition (so the
    /// caller can surface a note). A same-name definition in the *other* scope is
    /// not a collision (it is shadowing, by design).
    pub fn create(
        &mut self,
        def: SubagentDefinition,
        scope: SubagentScope,
        overwrite: bool,
    ) -> Result<bool, SubagentError> {
        validate_name(&def.name)?;
        let dir = match scope {
            SubagentScope::User => user_subagents_dir().ok_or_else(|| {
                SubagentError::Upstream("cannot resolve home directory for user scope".to_string())
            })?,
            SubagentScope::Project => {
                return Err(SubagentError::Upstream(
                    "project scope requires create_in; use create_in".to_string(),
                ))
            }
            SubagentScope::Plugin => return Err(SubagentError::Upstream(
                "plugin scope is read-only: plugin agents are managed via plugin install/remove"
                    .to_string(),
            )),
        };
        self.create_in(&dir, def, scope, overwrite)
    }

    /// Scope-directory-explicit variant of [`create`]. The project scope depends
    /// on the run's project root, which the registry does not retain, so callers
    /// pass the directory directly.
    pub fn create_in(
        &mut self,
        dir: &Path,
        def: SubagentDefinition,
        scope: SubagentScope,
        overwrite: bool,
    ) -> Result<bool, SubagentError> {
        validate_name(&def.name)?;
        if scope == SubagentScope::Plugin {
            return Err(SubagentError::Upstream(
                "plugin scope is read-only: plugin agents are managed via plugin install/remove"
                    .to_string(),
            ));
        }
        let collides = self
            .defs
            .iter()
            .any(|d| d.name == def.name && d.scope == scope);
        if collides && !overwrite {
            return Err(SubagentError::PermissionDenied(format!(
                "a {scope:?}-scope subagent named '{}' already exists; pass overwrite to replace it",
                def.name
            )));
        }
        std::fs::create_dir_all(dir)
            .map_err(|e| SubagentError::Upstream(format!("failed to create {}: {e}", dir.display())))?;
        let file = SubagentFile {
            name: def.name.clone(),
            description: def.description.clone(),
            system_prompt: def.system_prompt.clone(),
            allowed_tools: def.allowed_tools.clone(),
            model: def.model.clone(),
        };
        let body = toml::to_string_pretty(&file)
            .map_err(|e| SubagentError::Upstream(format!("failed to serialize subagent: {e}")))?;
        let path = dir.join(format!("{}.toml", def.name));
        std::fs::write(&path, body)
            .map_err(|e| SubagentError::Upstream(format!("failed to write {}: {e}", path.display())))?;

        let shadows_user = scope == SubagentScope::Project
            && self
                .defs
                .iter()
                .any(|d| d.name == def.name && d.scope == SubagentScope::User);
        // Keep the in-memory view consistent: replace any same-scope entry.
        self.defs
            .retain(|d| !(d.name == def.name && d.scope == scope));
        self.defs.push(SubagentDefinition { scope, ..def });
        Ok(shadows_user)
    }
}

/// Load subagent definitions shipped by installed plugins as Markdown agent
/// files (`<plugin>/agents/**/*.md`, the Claude Code convention). Loaded
/// first so user/project TOML definitions shadow them by name. Frontmatter
/// `name` and `description` are used; `model` and `color` are Claude-runtime
/// metadata and ignored (the parent's model runs the child); `tools` maps
/// Claude tool names onto Jan tool names, dropping names with no equivalent.
fn load_plugin_agents(project_root: &Path, out: &mut Vec<SubagentDefinition>) {
    let dir = crate::core::agent::skills::plugins_dir(project_root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return;
    };
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
        scan_agent_dir(&path.join("agents"), out);
    }
}

/// Number of agent markdown files one plugin ships, for the plugin listing.
/// Same discovery rules as `load_plugin_agents`: recursive `agents/**/*.md`,
/// skipping READMEs and dotfiles.
pub(crate) fn count_plugin_agents(root: &Path, plugin: &str) -> usize {
    let mut count = 0;
    let base = crate::core::agent::skills::plugins_dir(root)
        .join(plugin)
        .join("agents");
    scan_agent_files(&base, &mut |_, _| count += 1);
    count
}

/// Recursively visit every agent markdown file under `dir`, applying the
/// loader's skip rules (READMEs, dotfiles, non-`.md` files) via the shared
/// walker. Malformed files still reach the visitor; parsing happens in the
/// caller, and unreadable files are skipped.
fn scan_agent_files(dir: &Path, visit: &mut dyn FnMut(&Path, &str)) {
    crate::core::agent::skills::walk_markdown_files(dir, &mut |path| {
        if let Ok(raw) = std::fs::read_to_string(path) {
            visit(path, &raw);
        }
    });
}

fn scan_agent_dir(dir: &Path, out: &mut Vec<SubagentDefinition>) {
    scan_agent_files(dir, &mut |path, raw| match parse_plugin_agent(raw) {
        Some((name, description, tools, system_prompt)) => {
            if validate_name(&name).is_err() {
                log::warn!("subagent: skipping plugin agent '{name}' (invalid name)");
                return;
            }
            out.push(SubagentDefinition {
                name,
                description,
                system_prompt,
                allowed_tools: tools,
                model: None,
                scope: SubagentScope::Plugin,
            });
        }
        None => log::warn!(
            "subagent: skipping plugin agent {} (missing frontmatter name)",
            path.display()
        ),
    });
}

/// Frontmatter fields recognized in a Claude Code agent file; everything else
/// is ignored.
#[derive(Debug, Default, Deserialize)]
struct PluginAgentFrontmatter {
    name: Option<String>,
    description: Option<String>,
    #[serde(default)]
    tools: Vec<String>,
}

/// Parse a Claude Code agent markdown file into `(name, description, tools,
/// system_prompt)`. `None` when the file has no `---` frontmatter or no
/// `name` — such files are not dispatchable.
fn parse_plugin_agent(raw: &str) -> Option<(String, String, Option<Vec<String>>, String)> {
    let (yaml, body) = crate::core::agent::skills::split_frontmatter(raw);
    let yaml = yaml?;
    let fm: PluginAgentFrontmatter = serde_yaml::from_str(&yaml).unwrap_or_default();
    let name = fm
        .name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())?;
    let description = fm.description.unwrap_or_default();
    Some((name, description, map_claude_tools(&fm.tools), body))
}

/// Claude Code tool names with a Jan equivalent, 1:1 where one exists. Unknown
/// names are dropped — the author's runtime differs. Returns `None` when
/// nothing maps, so the child inherits the parent's full tool policy (an empty
/// list would mean "no tools" to the dispatcher).
fn map_claude_tools(tools: &[String]) -> Option<Vec<String>> {
    let mapped: Vec<String> = tools
        .iter()
        .filter_map(|t| {
            let jan = match t.to_ascii_lowercase().as_str() {
                "read" => Some("read"),
                // Glob/Grep intentionally unmapped: Jan no longer advertises
                // list/search tools (bash covers them). Mapping them would
                // restrict a child to a tool it is never offered -- and a child
                // scoped to *only* those would be left with none. Dropped instead,
                // so such an agent inherits the full toolset (bash included).
                "bash" => Some("bash"),
                "edit" => Some("edit"),
                "write" => Some("write"),
                "websearch" => Some("web_search"),
                "webfetch" => Some("web_fetch"),
                "todowrite" => Some("todo"),
                "ask" => Some("ask"),
                _ => None,
            };
            jan.map(String::from)
        })
        .collect();
    (!mapped.is_empty()).then_some(mapped)
}

/// Agent definitions one plugin ships (`(name, description)`), for the
/// `/plugin list` detail view (cli only).
#[cfg(feature = "cli")]
pub(crate) fn plugin_agent_metas(root: &Path, plugin: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let base = crate::core::agent::skills::plugins_dir(root)
        .join(plugin)
        .join("agents");
    scan_agent_files(&base, &mut |_, raw| {
        if let Some((name, description, _, _)) = parse_plugin_agent(raw) {
            out.push((name, description));
        }
    });
    out
}

fn load_dir(dir: &Path, scope: SubagentScope, out: &mut Vec<SubagentDefinition>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("subagent: failed to read {}: {e}", path.display());
                continue;
            }
        };
        match toml::from_str::<SubagentFile>(&raw) {
            Ok(file) => out.push(SubagentDefinition {
                name: file.name,
                description: file.description,
                system_prompt: file.system_prompt,
                allowed_tools: file.allowed_tools,
                model: file.model,
                scope,
            }),
            Err(e) => log::warn!("subagent: failed to parse {}: {e}", path.display()),
        }
    }
}

/// Skill tools every subagent keeps. Skills are how a subagent executes its
/// procedure, and Claude-style agent `tools:` lists never name them, so a
/// narrowed toolset must not strip them (Claude Code grants skills to every
/// agent unconditionally). Read-side only: skill authoring stays a management
/// action of the top-level agent.
const SUBAGENT_SKILL_TOOLS: &[&str] = &["skill_list", "skill_read"];

fn with_skill_tools(tools: &[String], parent: &ToolPermissions) -> Vec<String> {
    let mut out = tools.to_vec();
    for skill in SUBAGENT_SKILL_TOOLS {
        if !out.iter().any(|t| t == skill) && !parent.is_denied(skill) {
            out.push((*skill).to_string());
        }
    }
    out
}

/// Effective tool allowlist for a subagent dispatch: the intersection of the
/// definition's `allowed_tools`, the call-site override, and the parent's
/// permissions, plus the always-on `skill_list`/`skill_read` pair. Deny (from
/// the parent) always wins. Returns the list to set as the child's
/// `allowed_tools`, or `None` to inherit the parent's full toolset with no
/// per-run allowlist (the parent's deny-list still applies at gate time).
///
/// An empty allowlist is normalized to `None` (inherit), never "no tools": a
/// model dispatching a one-off routinely emits `allowed_tools: []` for the
/// optional array parameter, which used to hand the child only the forced
/// skill/work tools and no `read`/`bash` -- the "subagent has no tools" failure.
/// Restricting a child is still possible, with a non-empty list. (The plugin
/// path already relies on this via `map_claude_tools` returning `None`.)
///
/// Fails closed: a tool named in `request` that the definition does not permit,
/// or that the parent denies, is rejected rather than silently dropped. A
/// definition-listed tool the parent denies is dropped (the definition author
/// need not know the parent's policy).
pub fn intersect_allowed_tools(
    definition: Option<&[String]>,
    request: Option<&[String]>,
    parent: &ToolPermissions,
) -> Result<Option<Vec<String>>, SubagentError> {
    let definition = definition.filter(|d| !d.is_empty());
    let request = request.filter(|r| !r.is_empty());
    if let Some(requested) = request {
        let mut effective = Vec::with_capacity(requested.len());
        for tool in requested {
            if let Some(def) = definition {
                if !def.iter().any(|t| t == tool) {
                    return Err(SubagentError::PermissionDenied(format!(
                        "tool '{tool}' is outside the subagent definition's allowed_tools"
                    )));
                }
            }
            if parent.is_denied(tool) {
                return Err(SubagentError::PermissionDenied(format!(
                    "tool '{tool}' is denied by the parent's policy"
                )));
            }
            effective.push(tool.clone());
        }
        return Ok(Some(with_skill_tools(&effective, parent)));
    }
    match definition {
        Some(def) => {
            let filtered: Vec<String> = def
                .iter()
                .filter(|t| !parent.is_denied(t))
                .cloned()
                .collect();
            Ok(Some(with_skill_tools(&filtered, parent)))
        }
        None => Ok(None),
    }
}

/// One subagent within a phased dispatch. When `name` matches a saved definition
/// that definition's role and tools are used (and `allowed_tools` further narrows
/// it); otherwise the subagent runs as a focused general-purpose agent defined by
/// its `description` (the task) alone. `name` is also the blackboard filename its
/// answer is written to (`blackboard/<name>.md`).
#[derive(Debug, Clone)]
pub struct SubagentRequest {
    pub name: String,
    pub description: String,
    pub allowed_tools: Option<Vec<String>>,
}

/// A group of subagents that run concurrently. The next phase starts only once
/// every subagent here has finished, and each next-phase subagent is handed this
/// phase's results (the `blackboard/<name>.md` files). `number` is the model's
/// own `phase` key for this group (what the "phase N" badge shows), which the
/// parser only uses to order and group -- gaps and any base are fine.
#[derive(Debug, Clone)]
pub struct Phase {
    pub number: u32,
    pub subagents: Vec<SubagentRequest>,
}

/// A parsed `dispatch_subagent` call: one or more ordered phases.
#[derive(Debug, Clone)]
pub struct DispatchPlan {
    pub phases: Vec<Phase>,
}

/// The resolved plan for a dispatch: the winning definition plus the effective
/// per-run tool allowlist after the three-way intersection.
#[derive(Debug)]
struct ResolvedDispatch {
    definition: SubagentDefinition,
    allowed_tools: Option<Vec<String>>,
}

/// Resolve a dispatch request against the registry and parent permissions,
/// without running anything. Errors on an unknown name or a permission conflict.
fn resolve_dispatch(
    registry: &SubagentRegistry,
    req: &SubagentRequest,
    parent: &ToolPermissions,
) -> Result<ResolvedDispatch, SubagentError> {
    match registry.get(&req.name).cloned() {
        Some(definition) => {
            // Registered definition: the call-site allowlist further narrows it.
            let allowed_tools = intersect_allowed_tools(
                definition.allowed_tools.as_deref(),
                req.allowed_tools.as_deref(),
                parent,
            )?;
            Ok(ResolvedDispatch {
                definition,
                allowed_tools,
            })
        }
        None => {
            // No saved definition: a focused general-purpose subagent defined by
            // its task. The call-site allowlist IS its toolset; only the parent's
            // deny-list narrows it further.
            let definition = SubagentDefinition {
                name: req.name.clone(),
                description: req.description.clone(),
                system_prompt: ephemeral_subagent_prompt(&req.name),
                allowed_tools: req.allowed_tools.clone(),
                model: None,
                scope: SubagentScope::Project,
            };
            let allowed_tools =
                intersect_allowed_tools(definition.allowed_tools.as_deref(), None, parent)?;
            Ok(ResolvedDispatch {
                definition,
                allowed_tools,
            })
        }
    }
}

/// The system prompt for a subagent dispatched without a saved definition: a
/// focused generalist whose closing report becomes the next phase's input.
fn ephemeral_subagent_prompt(name: &str) -> String {
    format!(
        "You are \"{name}\", a focused subagent handling one task as part of a larger plan. \
         Do exactly the task you are given, using your tools as needed, and do not wait for \
         clarification -- you cannot receive any. When you finish, end with a concise, \
         self-contained report of what you found or did: it is handed verbatim to the agents in \
         the next phase, so include the facts, paths, and decisions they will need."
    )
}

/// Child stream events are folded into the parent's own stream, except the
/// child's terminal `Done`/`Error`: the parent must not see the child terminate
/// its stream. Dispatch turns the child's result into a synthetic tool result
/// instead, bracketed by `SubagentStart`/`SubagentEnd`. A child's monitor set
/// and its parked state describe the child alone, so they stay with it too.
fn forward_to_parent(ev: &crate::core::agent::events::StreamEvent) -> bool {
    use crate::core::agent::events::StreamEvent;
    !matches!(
        ev,
        StreamEvent::Done { .. }
            | StreamEvent::Error { .. }
            | StreamEvent::MessagesUpdated { .. }
            | StreamEvent::Monitors { .. }
            | StreamEvent::Parked
    )
}

/// Final assistant text of a completion, or empty when the model returned none.
fn final_assistant_text(completion: &serde_json::Value) -> String {
    completion
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string()
}

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

static SUBAGENT_RUN_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_subagent_run_id(name: &str) -> String {
    format!("sub-{name}-{}", SUBAGENT_RUN_SEQ.fetch_add(1, Ordering::Relaxed))
}

/// One in-flight background subagent: the channel that will carry its final
/// result, the handle to abort it on parent cancellation/teardown, and the
/// identity + event sink needed to close out its `SubagentStart` bracket if it
/// is aborted before its own task can emit `SubagentEnd`.
struct BackgroundEntry {
    result: Option<tokio::sync::oneshot::Receiver<Result<String, SubagentError>>>,
    abort: tokio::task::AbortHandle,
    run_id: String,
    name: String,
    events: tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    /// Model-visible path this child's answer is written to, reserved at
    /// dispatch so the parent is told where to look before there is an answer.
    /// `None` with no scratch in force (the unconfined CLI, by design).
    display_path: Option<String>,
    /// Set by the child's own task the moment it finishes, so teardown can tell
    /// a run that ended on its own from one it is aborting. Without it every
    /// uncollected-but-finished child got a second `SubagentEnd` at teardown --
    /// which used to be rare and, now that collection is optional, would be the
    /// common case.
    finished: Arc<std::sync::atomic::AtomicBool>,
}

/// A finished child the parent has not been told about yet: the `<SYSTEM>` ping
/// text, plus the run it belongs to so an explicit `await_subagent` can drop it
/// rather than reporting the same completion twice.
struct Notice {
    run_id: String,
    text: String,
}

/// What an `await_subagent` collects: the child's final text plus the file its
/// full answer was already written to (the same path `dispatch_subagent`
/// reported), so collecting never writes a second copy.
pub(crate) struct Collected {
    pub(crate) text: String,
    pub(crate) display_path: Option<String>,
}

/// Registry of a single parent run's background subagents, keyed by `run_id`.
/// Dropped when the parent run ends (see `AbortOnDrop`), aborting any child that
/// was never collected so a finished/cancelled parent leaves no orphan runs.
pub(crate) struct BackgroundSubagents {
    inner: std::sync::Mutex<std::collections::HashMap<String, BackgroundEntry>>,
    /// Admission gate: `max_parallel_subagents` permits, one per child that is
    /// *running* (as opposed to merely dispatched). A dispatch beyond the cap
    /// parks on `acquire_owned` in FIFO order inside its spawned task, so the
    /// queue is exactly the tokio semaphore waitlist -- no separate queue
    /// structure that could drift from reality.
    semaphore: std::sync::Arc<tokio::sync::Semaphore>,
    /// Number of children currently parked on the semaphore waiting for a slot
    /// (a dispatch reported `SubagentQueued` and its task has not started yet).
    /// Used to report each queued child's 1-based position; decremented by the
    /// task itself the moment it acquires its permit.
    queued: std::sync::atomic::AtomicUsize,
    /// Completions the parent has not been pinged about yet. Drained into the
    /// conversation as a `<SYSTEM>` reminder at the top of the next turn.
    notices: std::sync::Mutex<Vec<Notice>>,
    /// Raised whenever a notice lands, so a parent that has run out of work can
    /// park until a child finishes instead of ending the run under it.
    wake: Arc<tokio::sync::Notify>,
    /// Children dispatched and not yet finished. Incremented at dispatch and
    /// decremented only *after* the notice is queued, so `has_pending_work`
    /// never reads false in the window between the two.
    running: std::sync::atomic::AtomicUsize,
    /// Multi-phase plans still driving. A plan holds this above zero for its
    /// whole life, so the parent stays parked across the gap where one phase has
    /// finished (`running == 0`) but the driver has not yet spawned the next.
    plans_pending: std::sync::atomic::AtomicUsize,
}

/// Default cap on concurrently *running* subagents per parent run when
/// `agent.toml` does not set `max_parallel_subagents`.
pub(crate) const DEFAULT_MAX_PARALLEL_SUBAGENTS: u32 = 10;

impl Default for BackgroundSubagents {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_PARALLEL_SUBAGENTS)
    }
}

impl BackgroundSubagents {
    /// Create a registry admitting at most `cap` concurrently-running children.
    /// Clamped to at least 1: a cap of 0 would make every dispatch queue
    /// forever with nothing ever releasing a permit.
    pub(crate) fn new(cap: u32) -> Self {
        Self {
            inner: std::sync::Mutex::new(std::collections::HashMap::new()),
            semaphore: std::sync::Arc::new(tokio::sync::Semaphore::new(cap.max(1) as usize)),
            queued: std::sync::atomic::AtomicUsize::new(0),
            notices: std::sync::Mutex::new(Vec::new()),
            wake: Arc::new(tokio::sync::Notify::new()),
            running: std::sync::atomic::AtomicUsize::new(0),
            plans_pending: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// Mark a multi-phase plan as driving, keeping the parent parked until the
    /// driver calls [`end_plan`]. Balanced 1:1 with `end_plan`.
    fn begin_plan(&self) {
        self.plans_pending
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }

    /// A plan's driver has spawned its last phase (or given up): stop holding the
    /// park open and wake anyone waiting so they re-evaluate.
    fn end_plan(&self) {
        self.plans_pending
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        self.wake.notify_waiters();
    }

    /// Take every queued completion ping, oldest first.
    pub(crate) fn take_notices(&self) -> Vec<String> {
        std::mem::take(&mut *self.notices.lock().unwrap())
            .into_iter()
            .map(|n| n.text)
            .collect()
    }

    /// Whether anything could still ping the parent: a child still running, or
    /// one that finished and whose ping has not been delivered.
    pub(crate) fn has_pending_work(&self) -> bool {
        !self.notices.lock().unwrap().is_empty()
            || self.running.load(std::sync::atomic::Ordering::SeqCst) > 0
            || self.plans_pending.load(std::sync::atomic::Ordering::SeqCst) > 0
    }

    /// Park until a ping is available, or until nothing is left to wait for.
    ///
    /// The waiter is registered *before* the state is re-read (`enable`), so a
    /// child finishing in between wakes this call rather than being missed --
    /// `notify_waiters` only reaches waiters already registered.
    pub(crate) async fn wait_for_notice(&self) {
        loop {
            let waiter = self.wake.notified();
            tokio::pin!(waiter);
            waiter.as_mut().enable();
            // Re-check after enabling the waiter so a completion landing in the
            // window is not missed (`notify_waiters` only reaches an
            // already-registered waiter). `running == 0` is the "nothing left"
            // exit.
            if !self.notices.lock().unwrap().is_empty()
                || (self.running.load(std::sync::atomic::Ordering::SeqCst) == 0
                    && self.plans_pending.load(std::sync::atomic::Ordering::SeqCst) == 0)
            {
                return;
            }
            waiter.await;
        }
    }

    /// Park until every `run_id` in `ids` has finished (or is gone from the
    /// registry -- collected or aborted). The phase-plan driver's barrier between
    /// one phase and the next. Mirrors [`wait_for_notice`]'s wake discipline:
    /// the waiter is registered (`enable`) before the flags are re-read, so a
    /// child finishing in the window is not missed.
    async fn await_phase(&self, ids: &[String]) {
        use std::sync::atomic::Ordering;
        loop {
            let waiter = self.wake.notified();
            tokio::pin!(waiter);
            waiter.as_mut().enable();
            let all_done = {
                let guard = self.inner.lock().unwrap();
                ids.iter().all(|id| {
                    guard
                        .get(id)
                        .is_none_or(|e| e.finished.load(Ordering::SeqCst))
                })
            };
            if all_done {
                return;
            }
            waiter.await;
        }
    }

    fn push_notice(&self, run_id: &str, text: String) {
        self.notices.lock().unwrap().push(Notice {
            run_id: run_id.to_string(),
            text,
        });
        self.wake.notify_waiters();
    }

    /// Drop a queued ping for a run the parent collected explicitly: it already
    /// has the answer, and telling it again would spend context on nothing.
    fn drop_notice(&self, run_id: &str) {
        self.notices.lock().unwrap().retain(|n| n.run_id != run_id);
    }
    /// Abort and forget every registered child. Called on parent teardown when
    /// the run is cancelled. Emits a closing `SubagentEnd` for each aborted
    /// child (its own task is cancelled inside its await and never reaches its
    /// emit), so consumers never see an unbracketed `SubagentStart`.
    pub(crate) fn abort_all(&self) {
        use crate::core::agent::events::StreamEvent;
        let mut guard = self.inner.lock().unwrap();
        for (_, entry) in guard.drain() {
            entry.abort.abort();
            // A child that ran to completion already emitted its own end event;
            // this is only closing the bracket for one cut off mid-run.
            if entry.finished.load(std::sync::atomic::Ordering::SeqCst) {
                continue;
            }
            let _ = entry.events.send(StreamEvent::SubagentEnd {
                run_id: entry.run_id,
                name: entry.name,
                error: None,
            });
        }
        self.notices.lock().unwrap().clear();
    }

    /// Wait for every still-registered child to finish on its own, rather than
    /// aborting it. Called on a clean parent exit so dispatched work that the
    /// model never explicitly awaited is not silently discarded mid-flight.
    /// Each child emits its own `SubagentEnd` as it completes.
    pub(crate) async fn join_all(&self) {
        let receivers: Vec<_> = {
            let mut guard = self.inner.lock().unwrap();
            guard.drain().filter_map(|(_, entry)| entry.result).collect()
        };
        for rx in receivers {
            let _ = rx.await;
        }
    }
}

/// RAII guard tying background children to the parent run's lifetime: dropping it
/// (on normal return or when the parent future is cancelled) aborts every child.
pub(crate) struct AbortOnDrop(pub Arc<BackgroundSubagents>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort_all();
    }
}

/// What a child inherits from the run that dispatched it: the model to fall back
/// on when the definition names none, the parent's remaining token budget, and
/// its `send_reasoning` answer.
#[derive(Clone)]
pub(crate) struct ParentRun {
    pub(crate) model: String,
    pub(crate) budget_remaining: Option<u64>,
    pub(crate) send_reasoning: bool,
}

/// Build the child request body shared by every subagent run.
fn child_body(
    resolved: &ResolvedDispatch,
    description: &str,
    parent: &ParentRun,
) -> serde_json::Value {
    let model = resolved
        .definition
        .model
        .clone()
        .unwrap_or_else(|| parent.model.clone());
    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert(
        "messages".to_string(),
        serde_json::json!([{ "role": "user", "content": description }]),
    );
    // Unbounded turns: guarded by the inherited budget and parent teardown.
    body.insert("max_turns".to_string(), serde_json::json!(0));
    body.insert("stream".to_string(), serde_json::json!(true));
    if let Some(tools) = &resolved.allowed_tools {
        body.insert("allowed_tools".to_string(), serde_json::json!(tools));
    }
    if let Some(remaining) = parent.budget_remaining {
        body.insert("max_session_tokens".to_string(), serde_json::json!(remaining));
    }
    // A child's own tool-call turns carry `reasoning_content`, so the parent's
    // opt-out has to travel with the dispatch or a strict provider still sees
    // the field on the second child turn.
    if !parent.send_reasoning {
        body.insert("send_reasoning".to_string(), serde_json::json!(false));
    }
    serde_json::Value::Object(body)
}

/// Run one resolved subagent to completion, wrapping its events for `run_id` and
/// returning its final assistant text. Isolated: fresh history (`description`),
/// the definition's system prompt, narrowed tools, dispatch disabled.
async fn run_subagent(
    parent_args: crate::core::agent::r#loop::OrchestrationArgs,
    resolved: ResolvedDispatch,
    description: String,
    parent: ParentRun,
    events: tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    run_id: String,
) -> Result<String, SubagentError> {
    use crate::core::agent::events::StreamEvent;
    use crate::core::agent::r#loop::run_orchestration_streamed;

    let name = resolved.definition.name.clone();
    let mut child_args = parent_args;
    child_args.system_prompt_override = Some(resolved.definition.system_prompt.clone());
    child_args.subagents_enabled = false;
    // A subagent's own interactive question (if any) belongs to its parent's
    // conversation, not a client waiting on this child's ask_requests -- and
    // no client is attached to a background/child run anyway.
    child_args.ask_requests = None;
    // Subagents cannot read or mutate the parent's todo list (isolated child
    // context, matching ask_requests above).
    child_args.todo_registry = None;
    // A child's monitors are its own and die with it; nothing would pick up a
    // match left in the session set once the child has returned.
    child_args.monitors = None;

    let body = child_body(&resolved, &description, &parent);

    let _ = events.send(StreamEvent::SubagentStart {
        run_id: run_id.clone(),
        name: name.clone(),
        task: Some(description.clone()),
    });

    let (child_tx, mut child_rx) = tokio::sync::mpsc::unbounded_channel::<StreamEvent>();
    let parent_events = events.clone();
    let fwd_run_id = run_id.clone();
    let fwd_name = name.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(ev) = child_rx.recv().await {
            match &ev {
                _ if forward_to_parent(&ev) => {
                    let _ = parent_events.send(StreamEvent::Subagent {
                        run_id: fwd_run_id.clone(),
                        name: fwd_name.clone(),
                        event: Box::new(ev),
                    });
                }
                _ => {}
            }
        }
    });

    let result = run_orchestration_streamed(&child_tx, &body, &child_args).await;
    drop(child_tx);
    let _ = forwarder.await;

    let outcome = match result {
        Ok(completion) => Ok(final_assistant_text(&completion)),
        Err(message) => Err(SubagentError::Upstream(message)),
    };
    let _ = events.send(StreamEvent::SubagentEnd {
        run_id,
        name,
        error: outcome.as_ref().err().map(|e| e.to_string()),
    });
    outcome
}

/// Resolve and start a subagent on a background task, returning its `run_id`
/// immediately (non-blocking). The caller collects the result later with
/// [`await_subagent`]. Registered in `bg` so the parent run can abort it on
/// teardown. Resolution (name lookup, permission intersection) happens
/// synchronously, so a bad request errors here rather than in the background.
///
/// Admission: up to `max_parallel_subagents` children run at once; a dispatch
/// beyond the cap is queued (FIFO) and its task parks on the shared semaphore
/// until a running child finishes. A queued dispatch still returns its `run_id`
/// right away, and `await_subagent` on a queued run blocks until it gets a slot
/// and runs to completion -- never errors, never starts out of turn.
///
/// `scratch` is where the child's answer is spilled. The file is reserved here,
/// before the child has produced a word, so the dispatch can report the path the
/// parent will read it from; the child's own task fills it in and queues the
/// `<SYSTEM>` ping that tells the parent it is there.
///
/// `notify_on_finish` decides whether this child's completion rings the parent's
/// doorbell: a plain fan-out child pings the moment it finishes, but a child
/// managed by a multi-phase plan stays silent so the parent is woken exactly
/// once -- when the plan's last phase finishes (see [`run_phase_plan`]). Silence
/// suppresses only the `<SYSTEM>` ping; the child still fills its blackboard
/// file, decrements the running count, and wakes the phase driver's barrier.
pub(crate) fn spawn_subagent(
    bg: &Arc<BackgroundSubagents>,
    parent_args: &crate::core::agent::r#loop::OrchestrationArgs,
    req: SubagentRequest,
    parent: &ParentRun,
    events: &tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    scratch: Option<&Path>,
    notify_on_finish: bool,
) -> Result<Dispatched, SubagentError> {
    use crate::core::agent::events::StreamEvent;
    use std::sync::atomic::Ordering;

    if !parent_args.subagents_enabled {
        return Err(SubagentError::PermissionDenied(
            "subagents cannot dispatch nested subagents".to_string(),
        ));
    }
    let project_root = parent_args
        .project_root
        .as_ref()
        .ok_or_else(|| SubagentError::Upstream("subagents require an active project".to_string()))?;
    let registry = SubagentRegistry::load(project_root);
    let resolved = resolve_dispatch(&registry, &req, &parent_args.permissions)?;

    let name = resolved.definition.name.clone();
    let run_id = next_subagent_run_id(&name);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let result_file = scratch.and_then(|s| {
        reserve_blackboard_result(s, &name).map(|path| (scratch_display_path(Some(s), &path), path))
    });
    let display_path = result_file.as_ref().map(|(display, _)| display.clone());

    // Try to grab a permit at dispatch time. On success the child is admitted
    // immediately; on exhaustion it joins the semaphore waitlist (FIFO) and is
    // reported as queued. The permit is held by the task for its whole run and
    // dropped when the task ends, so completion -- not collection -- releases
    // the slot to the next queued child.
    let semaphore = bg.semaphore.clone();
    let admitted = semaphore.clone().try_acquire_owned();
    let waiting = if admitted.is_err() {
        bg.queued.fetch_add(1, Ordering::SeqCst) as u32 + 1
    } else {
        0
    };
    if waiting > 0 {
        let _ = events.send(StreamEvent::SubagentQueued {
            run_id: run_id.clone(),
            name: name.clone(),
            task: Some(req.description.clone()),
            waiting,
        });
    }

    let parent_args = parent_args.clone();
    let task_events = events.clone();
    let entry_events = events.clone();
    let inherited = parent.clone();
    let description = req.description.clone();
    let run_id_task = run_id.clone();
    let name_task = name.clone();
    let registry = bg.clone();
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let finished_task = finished.clone();
    let notice_path = display_path.clone();
    registry.running.fetch_add(1, Ordering::SeqCst);
    let handle = tokio::spawn(async move {
        let permit = match admitted {
            Ok(p) => p,
            Err(_) => {
                let p = semaphore
                    .acquire_owned()
                    .await
                    .expect("subagent semaphore is never closed");
                registry.queued.fetch_sub(1, Ordering::SeqCst);
                p
            }
        };
        let _permit = permit;
        let result = run_subagent(
            parent_args,
            resolved,
            description,
            inherited,
            task_events,
            run_id_task.clone(),
        )
        .await;
        if let Some((_, path)) = &result_file {
            fill_subagent_result(path, &spilled_text(&result));
        }
        finished_task.store(true, Ordering::SeqCst);
        // Queue the ping before releasing the run count, so a parent asking
        // "is anything still owed to me?" can never see neither. A plan-managed
        // child stays silent: the phase driver rings the doorbell once at the end.
        if notify_on_finish {
            registry.push_notice(
                &run_id_task,
                completion_notice(&name_task, &run_id_task, notice_path.as_deref(), &result),
            );
        }
        registry.running.fetch_sub(1, Ordering::SeqCst);
        registry.wake.notify_waiters();
        let _ = tx.send(result);
    });

    bg.inner.lock().unwrap().insert(
        run_id.clone(),
        BackgroundEntry {
            result: Some(rx),
            abort: handle.abort_handle(),
            run_id: run_id.clone(),
            name,
            events: entry_events,
            display_path: display_path.clone(),
            finished,
        },
    );
    Ok(Dispatched { run_id })
}

/// What a phased dispatch reports back to the model.
pub(crate) struct DispatchedPlan {
    pub(crate) phase_count: usize,
    pub(crate) total_subagents: usize,
    /// The subagents started right now (phase 1).
    pub(crate) first_phase_names: Vec<String>,
    /// The blackboard directory in the model's spelling, or `None` when the run
    /// is unconfined (no scratch: answers ride the completion pings inline).
    pub(crate) blackboard_dir: Option<String>,
}

/// `<scratch>/blackboard`.
fn blackboard_dir_path(scratch: &Path) -> PathBuf {
    scratch.join(tauri_plugin_agent_tools::tools::spill::BLACKBOARD_DIR)
}

/// Max bytes of each previous-phase answer folded into a next-phase brief, so a
/// verbose predecessor cannot blow the successor's context. The full answer is
/// always on the blackboard for the subagent to read in whole if it needs it.
const PHASE_INPUT_MAX_BYTES: usize = 12 * 1024;

/// The largest char boundary at or below `max`, so a byte truncation never splits
/// a UTF-8 sequence.
fn char_boundary(s: &str, max: usize) -> usize {
    if max >= s.len() {
        return s.len();
    }
    let mut i = max;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Read the previous phase's answers (`blackboard/<name>.md`) for injection into
/// the next phase. Missing files are skipped -- a subagent that produced nothing
/// contributes nothing. `names` are already validated to the blackboard-stem
/// charset, so each maps to its file directly.
fn read_blackboard(scratch: Option<&Path>, names: &[String]) -> Vec<(String, String)> {
    let Some(s) = scratch else {
        return Vec::new();
    };
    names
        .iter()
        .filter_map(|n| {
            tauri_plugin_agent_tools::tools::spill::read_blackboard_result(s, n)
                .map(|c| (n.clone(), c))
        })
        .collect()
}

/// Prefix a next-phase brief with the previous phase's results.
fn inject_inputs(task: &str, inputs: &[(String, String)]) -> String {
    if inputs.is_empty() {
        return task.to_string();
    }
    let mut s = String::from(
        "## Results from the previous phase\n\nThe agents before you produced the following; \
         their full outputs are also on the blackboard at blackboard/<name>.md.\n\n",
    );
    for (name, content) in inputs {
        s.push_str(&format!("### {name}\n"));
        let trimmed = content.trim();
        let cut = char_boundary(trimmed, PHASE_INPUT_MAX_BYTES);
        s.push_str(&trimmed[..cut]);
        if cut < trimmed.len() {
            s.push_str(&format!(
                "\n\n[...truncated; read blackboard/{name}.md for the full output]"
            ));
        }
        s.push_str("\n\n");
    }
    s.push_str("---\n\n");
    s.push_str(task);
    s
}

/// Start a phased dispatch: spawn phase 1 now and, when there is more than one
/// phase, spawn a background driver that advances through the remaining phases as
/// each completes, handing every phase its predecessor's blackboard results.
/// Returns as soon as phase 1 is dispatched. The whole plan is validated up front
/// so a bad subagent fails the dispatch atomically, before any child starts.
pub(crate) fn spawn_dispatch_plan(
    bg: &Arc<BackgroundSubagents>,
    parent_args: &crate::core::agent::r#loop::OrchestrationArgs,
    plan: DispatchPlan,
    parent: &ParentRun,
    events: &tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    scratch: Option<&Path>,
) -> Result<DispatchedPlan, SubagentError> {
    if !parent_args.subagents_enabled {
        return Err(SubagentError::PermissionDenied(
            "subagents cannot dispatch nested subagents".to_string(),
        ));
    }
    if plan.phases.is_empty() {
        return Err(SubagentError::Upstream(
            "a dispatch needs at least one phase".to_string(),
        ));
    }
    let project_root = parent_args.project_root.as_ref().ok_or_else(|| {
        SubagentError::Upstream("subagents require an active project".to_string())
    })?;
    let registry = SubagentRegistry::load(project_root);
    for phase in &plan.phases {
        for req in &phase.subagents {
            resolve_dispatch(&registry, req, &parent_args.permissions)?;
        }
    }

    let phase_count = plan.phases.len();
    let total_subagents = plan.phases.iter().map(|p| p.subagents.len()).sum();
    let blackboard_dir = scratch.map(|s| scratch_display_path(Some(s), &blackboard_dir_path(s)));

    let multi = phase_count > 1;
    if multi {
        // Announce the later phases up front so the UI can show their subagents
        // waiting on the phase before them; each is promoted by its own
        // SubagentStart/SubagentQueued (matched by name).
        let pending: Vec<crate::core::agent::events::PendingSubagent> = plan.phases[1..]
            .iter()
            .flat_map(|ph| {
                let phase = ph.number;
                ph.subagents
                    .iter()
                    .map(move |s| crate::core::agent::events::PendingSubagent {
                        name: s.name.clone(),
                        phase,
                    })
            })
            .collect();
        let _ = events.send(crate::core::agent::events::StreamEvent::SubagentPlan { pending });
        // Hold the park open for the whole plan before the first child can finish.
        bg.begin_plan();
    }

    let mut phases = plan.phases.into_iter();
    let first = phases.next().expect("non-empty checked above");
    let mut first_names = Vec::with_capacity(first.subagents.len());
    let mut first_ids = Vec::with_capacity(first.subagents.len());
    // A single-phase fan-out pings per child (the last phase is the only phase);
    // a multi-phase plan keeps every child silent and rings once when it ends.
    for req in first.subagents {
        first_names.push(req.name.clone());
        match spawn_subagent(bg, parent_args, req, parent, events, scratch, !multi) {
            Ok(d) => first_ids.push(d.run_id),
            Err(e) => {
                if multi {
                    bg.end_plan();
                }
                return Err(e);
            }
        }
    }

    if multi {
        let remaining: Vec<Phase> = phases.collect();
        let driver_bg = bg.clone();
        let driver_args = parent_args.clone();
        let driver_parent = parent.clone();
        let driver_events = events.clone();
        let driver_scratch = scratch.map(|s| s.to_path_buf());
        let driver_names = first_names.clone();
        let driver_dir = blackboard_dir.clone();
        tokio::spawn(async move {
            run_phase_plan(
                driver_bg,
                driver_args,
                driver_parent,
                driver_events,
                driver_scratch,
                first_ids,
                driver_names,
                remaining,
                PlanSummary {
                    phase_count,
                    total_subagents,
                    blackboard_dir: driver_dir,
                },
            )
            .await;
        });
    }

    Ok(DispatchedPlan {
        phase_count,
        total_subagents,
        first_phase_names: first_names,
        blackboard_dir,
    })
}

/// Plan-wide facts the phase driver needs to compose the single completion ping.
struct PlanSummary {
    phase_count: usize,
    total_subagents: usize,
    /// The blackboard directory in the model's spelling, or `None` when the run
    /// is unconfined (no scratch: the final phase's answers ride the ping inline).
    blackboard_dir: Option<String>,
}

/// The background driver for a multi-phase plan: wait out each phase, gather its
/// blackboard results, and spawn the next phase with those results injected. When
/// the last phase finishes it rings the parent's doorbell once -- every child ran
/// silent (`notify_on_finish = false`), so on the success path this single ping is
/// the only wake the parent gets for the whole plan. A later-phase spawn *failure*
/// is the exception: it pushes its own "could not start" notice, since an error
/// should wake the parent rather than be swallowed until the terminal ping.
#[allow(clippy::too_many_arguments)]
async fn run_phase_plan(
    bg: Arc<BackgroundSubagents>,
    parent_args: crate::core::agent::r#loop::OrchestrationArgs,
    parent: ParentRun,
    events: tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    scratch: Option<PathBuf>,
    mut prev_ids: Vec<String>,
    mut prev_names: Vec<String>,
    phases: Vec<Phase>,
    summary: PlanSummary,
) {
    for phase in phases {
        bg.await_phase(&prev_ids).await;
        let inputs = read_blackboard(scratch.as_deref(), &prev_names);
        let mut ids = Vec::with_capacity(phase.subagents.len());
        let mut names = Vec::with_capacity(phase.subagents.len());
        for mut req in phase.subagents {
            req.description = inject_inputs(&req.description, &inputs);
            // Push the name only on a successful spawn, so `ids` and `names` stay
            // aligned: a child that never started has no blackboard file for the
            // next phase to read and no answer for the terminal notice to report.
            let name = req.name.clone();
            match spawn_subagent(&bg, &parent_args, req, &parent, &events, scratch.as_deref(), false)
            {
                Ok(d) => {
                    ids.push(d.run_id);
                    names.push(name);
                }
                Err(e) => bg.push_notice(
                    "plan",
                    format!("A subagent in the next phase could not start: {e}"),
                ),
            }
        }
        prev_ids = ids;
        prev_names = names;
    }
    // Ring the doorbell once, only after the last phase's last child is done.
    bg.await_phase(&prev_ids).await;
    let notice = plan_completion_notice(&bg, &prev_ids, &prev_names, &summary).await;
    bg.push_notice("plan", notice);
    // Release the plan hold now that the terminal ping is queued.
    bg.end_plan();
}

/// The single `<SYSTEM>` ping delivered when a multi-phase plan finishes.
/// Confined: point the parent at the blackboard, where every phase's answers
/// live. Unconfined: there is no blackboard, so collect and inline the final
/// phase's answers (bounded), since they have nowhere else to be read from.
async fn plan_completion_notice(
    bg: &Arc<BackgroundSubagents>,
    final_ids: &[String],
    final_names: &[String],
    summary: &PlanSummary,
) -> String {
    let PlanSummary {
        phase_count,
        total_subagents,
        blackboard_dir,
    } = summary;
    match blackboard_dir {
        Some(dir) => format!(
            "Subagent plan finished: {total_subagents} subagent(s) across {phase_count} phases. \
             The final phase produced: {}. Every answer is on the blackboard at {dir} \
             (blackboard/<name>.md) -- read the files you need.",
            final_names.join(", ")
        ),
        None => {
            let mut parts = Vec::with_capacity(final_ids.len());
            for (id, name) in final_ids.iter().zip(final_names) {
                // Bounded per answer: the notice concatenates the whole final
                // phase, so an uncapped inline (what `compose_subagent_result`
                // returns with no path) could blow the parent's context. Matches
                // the TS port's `slice(0, SUBAGENT_INLINE_MAX)`.
                let body = match await_subagent(bg, id).await {
                    Ok(c) => {
                        let cut = char_boundary(&c.text, SUBAGENT_INLINE_MAX_BYTES);
                        c.text[..cut].to_string()
                    }
                    Err(e) => format!("failed: {e}"),
                };
                parts.push(format!("### {name}\n\n{body}"));
            }
            format!(
                "Subagent plan finished: {total_subagents} subagent(s) across {phase_count} \
                 phases. Final phase answers:\n\n{}",
                parts.join("\n\n")
            )
        }
    }
}

/// What goes in the spill file. A failed child writes its failure there rather
/// than leaving the reserved file empty: the parent was told to read that path,
/// and an empty file reads as "the child had nothing to say".
fn spilled_text(result: &Result<String, SubagentError>) -> String {
    match result {
        Ok(text) => text.clone(),
        Err(e) => format!("ERROR: {e}"),
    }
}

/// The `<SYSTEM>` ping delivered to the parent when a child finishes.
fn completion_notice(
    name: &str,
    run_id: &str,
    display_path: Option<&str>,
    result: &Result<String, SubagentError>,
) -> String {
    match (result, display_path) {
        (Err(e), _) => format!("Subagent '{name}' ({run_id}) failed: {e}"),
        (Ok(_), Some(path)) => format!(
            "Subagent '{name}' ({run_id}) finished. Its full answer is in {path} -- read that file \
             when you need it."
        ),
        // No spill file (an unconfined run has no scratch): the answer has
        // nowhere to be read from later, so it rides the note inline, bounded.
        (Ok(text), None) => format!(
            "Subagent '{name}' ({run_id}) finished. Its answer:\n\n{}",
            compose_subagent_result(text, None)
        ),
    }
}

/// What a single `spawn_subagent` reports back: the id to await on. The answer's
/// file is the child's blackboard entry, reported by the plan as a whole.
pub(crate) struct Dispatched {
    pub(crate) run_id: String,
}

/// Block until the background subagent `run_id` finishes and return its final
/// text (or error). Removes the run from the registry; a second await, or an
/// unknown id, errors. A run aborted by parent teardown resolves to `Cancelled`.
pub(crate) async fn await_subagent(
    bg: &Arc<BackgroundSubagents>,
    run_id: &str,
) -> Result<Collected, SubagentError> {
    let taken = {
        let mut guard = bg.inner.lock().unwrap();
        guard.get_mut(run_id).and_then(|e| {
            let rx = e.result.take()?;
            Some((rx, e.display_path.clone()))
        })
    };
    let Some((rx, display_path)) = taken else {
        return Err(SubagentError::Upstream(format!(
            "unknown or already-collected subagent run '{run_id}'"
        )));
    };
    // Keep the entry (and its abort handle) in the registry while awaiting, so a
    // parent cancellation mid-await can still reach this child via `abort_all`.
    // Taking `result` above already makes a second await error out. Remove the
    // now-spent entry once the await resolves (a no-op if teardown drained it).
    let outcome = rx.await.unwrap_or(Err(SubagentError::Cancelled));
    bg.inner.lock().unwrap().remove(run_id);
    // Collected explicitly, so the queued ping for this run is redundant.
    bg.drop_notice(run_id);
    outcome.map(|text| Collected { text, display_path })
}

/// The model-callable subagent tools, handled by the loop's tool invoker ahead
/// of the built-in fs/exec gate and the MCP fallback.
pub fn is_subagent_tool(name: &str) -> bool {
    matches!(
        name,
        "dispatch_subagent" | "await_subagent" | "create_subagent" | "list_subagents"
    )
}

/// One-line "name [scope]: description" per definition; shadowed user-scope
/// entries are listed alongside their project-scope shadows.
pub fn format_subagent_list(registry: &SubagentRegistry) -> String {
    let defs = registry.list();
    if defs.is_empty() {
        return "No subagents are configured in the user or project scope.".to_string();
    }
    let mut lines = Vec::with_capacity(defs.len());
    for d in defs {
        let scope = match d.scope {
            SubagentScope::User => "user",
            SubagentScope::Project => "project",
            SubagentScope::Plugin => "plugin",
        };
        lines.push(format!("{} [{}]: {}", d.name, scope, d.description));
    }
    lines.join("\n")
}

/// OpenAI tool schemas for the subagent tools. The dispatch tool's description
/// lists the currently-resolvable subagent names so the model can pick one
/// without a separate discovery call.
pub fn subagent_tool_schemas(
    registry: &SubagentRegistry,
    max_parallel: u32,
) -> Vec<serde_json::Value> {
    use serde_json::json;
    let available: Vec<&str> = {
        let mut names: Vec<&str> = registry.list().iter().map(|d| d.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        names
    };
    let bg = format!(" Subagents run in the BACKGROUND, concurrently (up to {max_parallel} at once, from max_parallel_subagents in agent.toml; more are queued FIFO). You keep working and get a note the moment each finishes. Each subagent's final answer is written to blackboard/<name>.md in a shared scratch directory the whole plan can read from and write to.");
    let phases_desc = " List all the subagents in one call. To PIPELINE them, give a subagent a `phase`: subagents sharing a phase run together, lower phases run first, and each later phase is handed the previous phase's results automatically. Omit `phase` for a plain fan-out (one stage, everyone at once); use it to stage work (e.g. phase 0 researches in parallel, phase 1 synthesizes).";
    let dispatch_desc = if available.is_empty() {
        format!("Dispatch one or more subagents -- nested, isolated agents -- to do work for you.{phases_desc}{bg} No saved subagents yet; each runs as a focused general-purpose agent defined by its task.")
    } else {
        format!(
            "Dispatch one or more subagents -- nested, isolated agents -- to do work for you.{phases_desc}{bg} A subagent whose name matches a saved one uses that role and tools; otherwise it runs as a focused general-purpose agent. Saved subagents: {}.",
            available.join(", ")
        )
    };
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "dispatch_subagent",
                "description": dispatch_desc,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "subagents": {
                            "type": "array",
                            "description": "The subagents to run. With no phases they all run concurrently; otherwise they run grouped and ordered by their `phase`.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string", "description": "Short identity for this subagent, unique across the whole call: letters, digits, '-' and '_' only. It is also the blackboard file its answer is written to (blackboard/<name>.md). If it matches a saved subagent, that role and tools are used; otherwise it runs as a focused general-purpose agent." },
                                    "task": { "type": "string", "description": "The subagent's sole instruction. Include everything it needs; it does not see this conversation. A subagent in a later phase also receives the previous phase's results automatically, so tell it what to DO with them." },
                                    "phase": { "type": "integer", "minimum": 0, "description": "Optional stage (default 0). Subagents with the same phase run concurrently; a phase starts only after every lower phase has finished. Omit it entirely for a plain fan-out." },
                                    "allowed_tools": {
                                        "type": "array",
                                        "items": { "type": "string" },
                                        "description": "Optional tool allowlist. OMIT to give the subagent the parent's full toolset (the usual choice -- one that runs tests needs bash, one that edits needs write). Provide a list ONLY to restrict it; for a saved subagent it further narrows that subagent's own tools (never widens). An empty list is treated as omitted."
                                    }
                                },
                                "required": ["name", "task"]
                            }
                        }
                    },
                    "required": ["subagents"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "await_subagent",
                "description": "Block until a backgrounded subagent (started by dispatch_subagent) finishes, and return its final answer. Only worth calling when you have nothing else to do: you are notified as each child finishes, and its answer is on disk either way. Pass the run_id that dispatch_subagent returned. Each run_id can be awaited once.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "run_id": { "type": "string", "description": "The run_id returned by dispatch_subagent." }
                    },
                    "required": ["run_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_subagent",
                "description": "Author a new reusable subagent definition. Writes to the project scope by default (shareable with collaborators); use scope 'user' for a personal one reusable across projects (this requires user approval).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Subagent name: letters, digits, '-' and '_' only." },
                        "description": { "type": "string", "description": "One line describing what the subagent is for." },
                        "system_prompt": { "type": "string", "description": "The subagent's full system prompt." },
                        "allowed_tools": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Optional default tool allowlist. OMIT to let the subagent inherit the full toolset when dispatched (the usual choice); list tools ONLY to restrict it, and then include everything its job needs (e.g. bash to run commands, write/edit to change files). An empty list is treated as omitted."
                        },
                        "scope": { "type": "string", "enum": ["user", "project"], "description": "Where to store it (default 'project')." },
                        "overwrite": { "type": "boolean", "description": "Replace an existing same-name definition in that scope (default false)." }
                    },
                    "required": ["name", "description", "system_prompt"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_subagents",
                "description": "List the subagents available to dispatch, with their scope (user or project) and description. No arguments.",
                "parameters": { "type": "object", "properties": {}, "required": [] }
            }
        }),
    ]
}

fn required_str(args: &serde_json::Value, key: &str) -> Result<String, SubagentError> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| SubagentError::Upstream(format!("missing required argument '{key}'")))
}

fn optional_tool_list(args: &serde_json::Value) -> Option<Vec<String>> {
    args.get("allowed_tools")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        // `allowed_tools: []` means "inherit", not "no tools" -- see
        // `intersect_allowed_tools`. Drop an empty list so it reads as omitted.
        .filter(|list| !list.is_empty())
}

/// Longest subagent name accepted in a plan. Kept under the blackboard stem's
/// own 80-char cap so a validated name maps to `blackboard/<name>.md` verbatim
/// (no truncation), which is what lets the next phase read it back by name.
const MAX_SUBAGENT_NAME_LEN: usize = 64;

/// Parse a `dispatch_subagent` tool-call argument object into an ordered plan.
///
/// The wire shape is a flat `subagents` array; each subagent's optional `phase`
/// (a non-negative integer, default 0) groups it into a stage. Subagents that
/// share a `phase` run together; lower phases run first. This one shape covers
/// both a plain fan-out (omit `phase` everywhere -> a single stage) and a
/// pipeline (raise `phase` for later work). Names are validated (charset +
/// length) and required unique across the whole plan, since each is a blackboard
/// filename and a panel identity.
pub fn parse_dispatch_plan(args: &serde_json::Value) -> Result<DispatchPlan, SubagentError> {
    let subs_val = args
        .get("subagents")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            SubagentError::Upstream(
                "missing required argument 'subagents' (an array of subagents, each with a name \
                 and task, plus an optional integer 'phase')"
                    .to_string(),
            )
        })?;
    if subs_val.is_empty() {
        return Err(SubagentError::Upstream(
            "'subagents' must contain at least one subagent".to_string(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    // BTreeMap so phases come out in ascending `phase` order regardless of the
    // order the model listed them, and sparse numbers (0, 5) just collapse to
    // adjacent stages.
    let mut by_phase: std::collections::BTreeMap<u32, Vec<SubagentRequest>> =
        std::collections::BTreeMap::new();
    for sub in subs_val {
        let name = required_str(sub, "name")?;
        validate_name(&name)?;
        if name.len() > MAX_SUBAGENT_NAME_LEN {
            return Err(SubagentError::PermissionDenied(format!(
                "subagent name '{name}' is too long (max {MAX_SUBAGENT_NAME_LEN} characters)"
            )));
        }
        if !seen.insert(name.clone()) {
            return Err(SubagentError::Upstream(format!(
                "duplicate subagent name '{name}': names must be unique across the whole plan \
                 (each is a blackboard filename)"
            )));
        }
        let description = required_str(sub, "task")?;
        let phase = match sub.get("phase") {
            None | Some(serde_json::Value::Null) => 0,
            Some(v) => v
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(|| {
                    SubagentError::Upstream(format!(
                        "subagent '{name}' has an invalid 'phase': use a non-negative integer \
                         (0 = the first stage)"
                    ))
                })?,
        };
        by_phase.entry(phase).or_default().push(SubagentRequest {
            name,
            description,
            allowed_tools: optional_tool_list(sub),
        });
    }
    let phases = by_phase
        .into_iter()
        .map(|(number, subagents)| Phase { number, subagents })
        .collect();
    Ok(DispatchPlan { phases })
}

/// Parse an `await_subagent` tool-call argument object, returning the run_id.
pub fn parse_await_args(args: &serde_json::Value) -> Result<String, SubagentError> {
    required_str(args, "run_id")
}

/// Parse a `create_subagent` tool-call argument object into a definition plus
/// its target scope and the overwrite flag.
pub fn parse_create_args(
    args: &serde_json::Value,
) -> Result<(SubagentDefinition, SubagentScope, bool), SubagentError> {
    let name = required_str(args, "name")?;
    let description = required_str(args, "description")?;
    let system_prompt = required_str(args, "system_prompt")?;
    let scope = match args.get("scope").and_then(|v| v.as_str()) {
        Some("user") => SubagentScope::User,
        Some("project") | None => SubagentScope::Project,
        Some(other) => {
            return Err(SubagentError::Upstream(format!(
                "invalid scope '{other}': use 'user' or 'project'"
            )))
        }
    };
    let overwrite = args
        .get("overwrite")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok((
        SubagentDefinition {
            name,
            description,
            system_prompt,
            allowed_tools: optional_tool_list(args),
            model: args
                .get("model")
                .and_then(|v| v.as_str())
                .map(String::from),
            scope,
        },
        scope,
        overwrite,
    ))
}

/// The directory a scope writes to for this project. User scope needs a
/// resolvable home directory.
pub fn subagent_dir_for(
    project_root: &Path,
    scope: SubagentScope,
) -> Result<PathBuf, SubagentError> {
    match scope {
        SubagentScope::Project => Ok(project_subagents_dir(project_root)),
        SubagentScope::User => user_subagents_dir().ok_or_else(|| {
            SubagentError::Upstream("cannot resolve home directory for user scope".to_string())
        }),
        SubagentScope::Plugin => Err(SubagentError::Upstream(
            "plugin scope is read-only: plugin agents are managed via plugin install/remove"
                .to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri_plugin_agent_tools::permissions::{PermissionDefault, ToolPermissions};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_root(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "jan_subagent_test_{tag}_{}_{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn write_def(dir: &Path, name: &str, extra: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let body = format!(
            "name = \"{name}\"\ndescription = \"desc for {name}\"\nsystem_prompt = \"You are {name}.\"\n{extra}"
        );
        std::fs::write(dir.join(format!("{name}.toml")), body).unwrap();
    }

    /// The ping is the only signal a non-awaiting parent gets, so it must carry
    /// the answer: a file path when there is scratch, the bounded text inline
    /// when there is not (await_subagent is no longer advertised).
    #[test]
    fn the_completion_ping_delivers_the_answer() {
        let ok = Ok("the findings".to_string());
        let note = completion_notice("researcher", "sub-researcher-1", Some("/tmp/x.md"), &ok);
        assert!(note.contains("/tmp/x.md"), "{note}");
        assert!(!note.contains("await_subagent"), "no await reference: {note}");

        // Unconfined: no file, so the answer rides the note inline.
        let note = completion_notice("researcher", "sub-researcher-1", None, &ok);
        assert!(note.contains("the findings"), "answer is inline: {note}");
        assert!(!note.contains("await_subagent"), "no await reference: {note}");

        let failed = Err(SubagentError::Upstream("upstream refused".to_string()));
        let note = completion_notice("researcher", "sub-researcher-1", Some("/tmp/x.md"), &failed);
        assert!(note.contains("failed: "), "{note}");
        // A failure is written to the reserved file too: the parent was told to
        // read that path, and an empty file reads as an empty answer.
        assert!(spilled_text(&failed).starts_with("ERROR: "));
    }

    #[test]
    fn empty_directories_yield_empty_registry() {
        let root = unique_root("empty");
        let reg = SubagentRegistry::load(&root);
        assert!(reg.list().is_empty());
        assert!(reg.get("nope").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_definition_fields() {
        let root = unique_root("parse");
        let dir = project_subagents_dir(&root);
        write_def(
            &dir,
            "rust-reviewer",
            "allowed_tools = [\"read\", \"grep\"]\nmodel = \"m-1\"\n",
        );
        let reg = SubagentRegistry::load(&root);
        let def = reg.get("rust-reviewer").expect("loaded");
        assert_eq!(def.description, "desc for rust-reviewer");
        assert_eq!(def.system_prompt, "You are rust-reviewer.");
        assert_eq!(def.allowed_tools.as_deref(), Some(&["read".to_string(), "grep".to_string()][..]));
        assert_eq!(def.model.as_deref(), Some("m-1"));
        assert_eq!(def.scope, SubagentScope::Project);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn desktop_dir_is_a_sibling_of_the_store_kinds() {
        let data = unique_root("desktopdir");
        let dir = desktop_subagents_dir(&data);
        assert_eq!(dir, data.join("agent-workspace").join("subagents"));
        // A sibling of memory/ and skills/, never inside a thread or session
        // sandbox -- that is what keeps `write` away from these definitions.
        assert_eq!(
            dir.parent(),
            Some(workspace::permanent_store(&data).as_path())
        );
        assert_ne!(dir, workspace::threads_dir(&data));
        assert_ne!(dir, workspace::sessions_dir(&data));
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn load_one_reads_only_the_directory_it_is_given() {
        let root = unique_root("loadone");
        let flat = root.join("flat");
        write_def(&flat, "desktop-agent", "");
        // A project-scoped definition under the same root must stay invisible:
        // Cowork mounts an attached folder read-only and must not pick up
        // definitions that ship inside it.
        write_def(&project_subagents_dir(&root), "project-agent", "");

        let reg = SubagentRegistry::load_one(&flat, SubagentScope::User);
        assert_eq!(reg.list().len(), 1);
        let def = reg.get("desktop-agent").expect("loaded");
        assert_eq!(def.scope, SubagentScope::User);
        assert!(reg.get("project-agent").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_one_on_a_missing_directory_is_empty_not_an_error() {
        let root = unique_root("loadone_missing");
        let reg = SubagentRegistry::load_one(&root.join("nope"), SubagentScope::User);
        assert!(reg.list().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn malformed_file_is_skipped_not_fatal() {
        let root = unique_root("malformed");
        let dir = project_subagents_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bad.toml"), "this is = not valid = toml").unwrap();
        write_def(&dir, "good", "");
        let reg = SubagentRegistry::load(&root);
        assert!(reg.get("good").is_some());
        assert_eq!(reg.list().len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_writes_project_scope_and_reloads() {
        let root = unique_root("create");
        let mut reg = SubagentRegistry::load(&root);
        let dir = project_subagents_dir(&root);
        let def = SubagentDefinition {
            name: "helper".to_string(),
            description: "d".to_string(),
            system_prompt: "sp".to_string(),
            allowed_tools: Some(vec!["read".to_string()]),
            model: None,
            scope: SubagentScope::Project,
        };
        let shadows = reg
            .create_in(&dir, def, SubagentScope::Project, false)
            .expect("create");
        assert!(!shadows);
        assert!(dir.join("helper.toml").exists());
        // A fresh load sees it too.
        let reg2 = SubagentRegistry::load(&root);
        let loaded = reg2.get("helper").expect("reloaded");
        assert_eq!(loaded.allowed_tools.as_deref(), Some(&["read".to_string()][..]));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_refuses_same_scope_collision_without_overwrite() {
        let root = unique_root("collision");
        let dir = project_subagents_dir(&root);
        write_def(&dir, "dup", "");
        let mut reg = SubagentRegistry::load(&root);
        let def = SubagentDefinition {
            name: "dup".to_string(),
            description: "d".to_string(),
            system_prompt: "sp".to_string(),
            allowed_tools: None,
            model: None,
            scope: SubagentScope::Project,
        };
        let err = reg
            .create_in(&dir, def.clone(), SubagentScope::Project, false)
            .expect_err("must refuse");
        assert!(matches!(err, SubagentError::PermissionDenied(_)));
        // overwrite succeeds.
        reg.create_in(&dir, def, SubagentScope::Project, true)
            .expect("overwrite ok");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_scope_shadows_user_but_both_visible() {
        let root = unique_root("shadow");
        // Fake the user dir under the project root to avoid touching the real HOME.
        let user_dir = root.join("user_scope");
        let proj_dir = project_subagents_dir(&root);
        write_def(&user_dir, "reviewer", "model = \"user-model\"\n");
        write_def(&proj_dir, "reviewer", "model = \"proj-model\"\n");

        let mut defs = Vec::new();
        load_dir(&user_dir, SubagentScope::User, &mut defs);
        load_dir(&proj_dir, SubagentScope::Project, &mut defs);
        let reg = SubagentRegistry { defs };

        // get() resolves the project entry (shadowing).
        assert_eq!(reg.get("reviewer").unwrap().model.as_deref(), Some("proj-model"));
        assert_eq!(reg.get("reviewer").unwrap().scope, SubagentScope::Project);
        // list() still shows both, with correct scope tags.
        let all = reg.list();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|d| d.scope == SubagentScope::User));
        assert!(all.iter().any(|d| d.scope == SubagentScope::Project));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_reports_shadowing_of_user_scope() {
        let root = unique_root("shadow_create");
        let user_dir = root.join("user_scope");
        let proj_dir = project_subagents_dir(&root);
        write_def(&user_dir, "reviewer", "");
        let mut defs = Vec::new();
        load_dir(&user_dir, SubagentScope::User, &mut defs);
        let mut reg = SubagentRegistry { defs };
        let def = SubagentDefinition {
            name: "reviewer".to_string(),
            description: "d".to_string(),
            system_prompt: "sp".to_string(),
            allowed_tools: None,
            model: None,
            scope: SubagentScope::Project,
        };
        let shadows = reg
            .create_in(&proj_dir, def, SubagentScope::Project, false)
            .expect("create");
        assert!(shadows, "project create over a user def must report shadowing");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_rejects_invalid_name() {
        let root = unique_root("badname");
        let dir = project_subagents_dir(&root);
        let mut reg = SubagentRegistry::default();
        let def = SubagentDefinition {
            name: "../escape".to_string(),
            description: "d".to_string(),
            system_prompt: "sp".to_string(),
            allowed_tools: None,
            model: None,
            scope: SubagentScope::Project,
        };
        assert!(reg.create_in(&dir, def, SubagentScope::Project, false).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    // ── intersect_allowed_tools ─────────────────────────────────────────────

    fn perms_denying(deny: &[&str]) -> ToolPermissions {
        let deny: Vec<String> = deny.iter().map(|s| s.to_string()).collect();
        ToolPermissions::new(PermissionDefault::ReadOnly, &[], &deny, &[])
    }

    #[test]
    fn intersect_none_none_inherits() {
        let p = ToolPermissions::allow_all();
        assert_eq!(intersect_allowed_tools(None, None, &p).unwrap(), None);
    }

    #[test]
    fn intersect_empty_lists_inherit_rather_than_stripping_tools() {
        // A model emitting `allowed_tools: []` must not yield a toolless child
        // (no read/bash) -- an empty allowlist inherits the full toolset.
        let p = ToolPermissions::allow_all();
        let empty: &[String] = &[];
        assert_eq!(intersect_allowed_tools(None, Some(empty), &p).unwrap(), None);
        assert_eq!(intersect_allowed_tools(Some(empty), None, &p).unwrap(), None);
        assert_eq!(
            intersect_allowed_tools(Some(empty), Some(empty), &p).unwrap(),
            None
        );
    }

    #[test]
    fn optional_tool_list_treats_empty_array_as_omitted() {
        assert_eq!(
            optional_tool_list(&serde_json::json!({ "allowed_tools": [] })),
            None
        );
        assert_eq!(optional_tool_list(&serde_json::json!({})), None);
        assert_eq!(
            optional_tool_list(&serde_json::json!({ "allowed_tools": ["read"] })),
            Some(vec!["read".to_string()])
        );
    }

    #[test]
    fn intersect_definition_only_drops_parent_denied() {
        let def = vec!["read".to_string(), "write".to_string()];
        let p = perms_denying(&["write"]);
        let out = intersect_allowed_tools(Some(&def), None, &p).unwrap();
        assert_eq!(
            out,
            Some(vec![
                "read".to_string(),
                "skill_list".to_string(),
                "skill_read".to_string(),
            ]),
            "skill tools survive the narrowing"
        );
    }

    #[test]
    fn intersect_request_narrows_within_definition() {
        let def = vec!["read".to_string(), "grep".to_string(), "write".to_string()];
        let req = vec!["read".to_string()];
        let p = ToolPermissions::allow_all();
        let out = intersect_allowed_tools(Some(&def), Some(&req), &p).unwrap();
        assert_eq!(
            out,
            Some(vec![
                "read".to_string(),
                "skill_list".to_string(),
                "skill_read".to_string(),
            ])
        );
    }

    #[test]
    fn intersect_skill_tools_dedupe_when_already_listed() {
        let def = vec!["read".to_string(), "skill_read".to_string()];
        let p = ToolPermissions::allow_all();
        let out = intersect_allowed_tools(Some(&def), None, &p).unwrap();
        assert_eq!(
            out,
            Some(vec![
                "read".to_string(),
                "skill_read".to_string(),
                "skill_list".to_string(),
            ]),
            "no duplicate skill_read"
        );
    }

    #[test]
    fn intersect_skill_tools_respect_parent_deny() {
        let def = vec!["read".to_string()];
        let p = perms_denying(&["skill_read"]);
        let out = intersect_allowed_tools(Some(&def), None, &p).unwrap();
        assert_eq!(
            out,
            Some(vec!["read".to_string(), "skill_list".to_string()])
        );
    }

    #[test]
    fn intersect_request_outside_definition_is_rejected() {
        let def = vec!["read".to_string()];
        let req = vec!["bash".to_string()];
        let p = ToolPermissions::allow_all();
        let err = intersect_allowed_tools(Some(&def), Some(&req), &p).unwrap_err();
        assert!(matches!(err, SubagentError::PermissionDenied(_)));
    }

    #[test]
    fn intersect_request_denied_by_parent_is_rejected() {
        let req = vec!["bash".to_string()];
        let p = perms_denying(&["bash"]);
        let err = intersect_allowed_tools(None, Some(&req), &p).unwrap_err();
        assert!(matches!(err, SubagentError::PermissionDenied(_)));
    }

    // ── resolve_dispatch ────────────────────────────────────────────────────

    fn registry_with(name: &str, allowed: Option<Vec<String>>) -> SubagentRegistry {
        SubagentRegistry {
            defs: vec![SubagentDefinition {
                name: name.to_string(),
                description: "d".to_string(),
                system_prompt: "sp".to_string(),
                allowed_tools: allowed,
                model: None,
                scope: SubagentScope::Project,
            }],
        }
    }

    fn req(name: &str, allowed: Option<Vec<String>>) -> SubagentRequest {
        SubagentRequest {
            name: name.to_string(),
            description: "do the thing".to_string(),
            allowed_tools: allowed,
        }
    }

    /// The dispatching run's inheritance, with the defaults every test that only
    /// cares about scheduling wants.
    fn parent_run() -> ParentRun {
        ParentRun {
            model: "m".to_string(),
            budget_remaining: None,
            send_reasoning: true,
        }
    }

    /// `[agent].send_reasoning = false` has to reach the child body: a child
    /// resends the `reasoning_content` of its own tool-call turns, so an opt-out
    /// that stopped at the parent would still break a strict provider on the
    /// child's second turn.
    #[test]
    fn child_body_forwards_the_parents_send_reasoning_opt_out() {
        let reg = registry_with("reviewer", None);
        let p = ToolPermissions::allow_all();
        let resolved = resolve_dispatch(&reg, &req("reviewer", None), &p).expect("resolves");
        let on = child_body(&resolved, "task", &parent_run());
        assert!(
            on.get("send_reasoning").is_none(),
            "the default is inherited implicitly: {on}"
        );
        let off = child_body(
            &resolved,
            "task",
            &ParentRun {
                send_reasoning: false,
                ..parent_run()
            },
        );
        assert_eq!(off["send_reasoning"], serde_json::json!(false));
    }

    /// An unknown name is no longer an error: it runs as a focused generalist
    /// whose default prompt names it, with the request's tools as its toolset.
    #[test]
    fn resolve_unknown_name_runs_ephemeral_generalist() {
        let reg = SubagentRegistry::default();
        let p = ToolPermissions::allow_all();
        let request = SubagentRequest {
            name: "one-off".to_string(),
            description: "task".to_string(),
            allowed_tools: Some(vec!["read".to_string()]),
        };
        let resolved = resolve_dispatch(&reg, &request, &p).unwrap();
        assert_eq!(resolved.definition.name, "one-off");
        assert!(resolved.definition.system_prompt.contains("one-off"));
        assert_eq!(
            resolved.allowed_tools,
            Some(vec![
                "read".to_string(),
                "skill_list".to_string(),
                "skill_read".to_string(),
            ])
        );
    }

    #[test]
    fn parse_dispatch_plan_groups_flat_subagents_by_phase() {
        // Listed out of order and with a gap (0, 2); the parser groups and
        // orders them, and the phase number carried is the model's own key.
        let plan = parse_dispatch_plan(&serde_json::json!({
            "subagents": [
                { "name": "synthesize", "task": "write it up", "phase": 2 },
                { "name": "research-api", "task": "study the api" },
                { "name": "research-perf", "task": "study perf", "phase": 0, "allowed_tools": ["read", "grep"] }
            ]
        }))
        .unwrap();
        assert_eq!(plan.phases.len(), 2);
        assert_eq!(plan.phases[0].number, 0);
        assert_eq!(plan.phases[0].subagents.len(), 2);
        assert_eq!(plan.phases[0].subagents[0].name, "research-api");
        assert_eq!(
            plan.phases[0].subagents[1].allowed_tools,
            Some(vec!["read".to_string(), "grep".to_string()])
        );
        assert_eq!(plan.phases[1].number, 2);
        assert_eq!(plan.phases[1].subagents[0].name, "synthesize");
    }

    #[test]
    fn parse_dispatch_plan_fans_out_with_no_phase() {
        let plan = parse_dispatch_plan(&serde_json::json!({
            "subagents": [
                { "name": "a", "task": "x" },
                { "name": "b", "task": "y" }
            ]
        }))
        .unwrap();
        assert_eq!(plan.phases.len(), 1, "no phase key -> a single stage");
        assert_eq!(plan.phases[0].subagents.len(), 2);
    }

    #[test]
    fn parse_dispatch_plan_rejects_duplicate_names() {
        let err = parse_dispatch_plan(&serde_json::json!({
            "subagents": [
                { "name": "a", "task": "x" },
                { "name": "a", "task": "y", "phase": 1 }
            ]
        }))
        .unwrap_err();
        assert!(matches!(err, SubagentError::Upstream(m) if m.contains("duplicate")));
    }

    #[test]
    fn parse_dispatch_plan_rejects_empty_missing_and_bad_phase() {
        assert!(parse_dispatch_plan(&serde_json::json!({})).is_err());
        assert!(parse_dispatch_plan(&serde_json::json!({ "subagents": [] })).is_err());
        // missing task
        assert!(parse_dispatch_plan(
            &serde_json::json!({ "subagents": [ { "name": "a" } ] })
        )
        .is_err());
        // negative / non-integer phase
        assert!(parse_dispatch_plan(
            &serde_json::json!({ "subagents": [ { "name": "a", "task": "x", "phase": -1 } ] })
        )
        .is_err());
        assert!(parse_dispatch_plan(
            &serde_json::json!({ "subagents": [ { "name": "a", "task": "x", "phase": "later" } ] })
        )
        .is_err());
    }

    #[test]
    fn resolve_narrows_tools_within_definition() {
        let reg = registry_with(
            "reviewer",
            Some(vec!["read".to_string(), "grep".to_string()]),
        );
        let p = ToolPermissions::allow_all();
        let resolved =
            resolve_dispatch(&reg, &req("reviewer", Some(vec!["read".to_string()])), &p).unwrap();
        assert_eq!(
            resolved.allowed_tools,
            Some(vec![
                "read".to_string(),
                "skill_list".to_string(),
                "skill_read".to_string(),
            ])
        );
        assert_eq!(resolved.definition.system_prompt, "sp");
    }

    #[test]
    fn resolve_rejects_tool_outside_definition() {
        let reg = registry_with("reviewer", Some(vec!["read".to_string()]));
        let p = ToolPermissions::allow_all();
        let err =
            resolve_dispatch(&reg, &req("reviewer", Some(vec!["bash".to_string()])), &p).unwrap_err();
        assert!(matches!(err, SubagentError::PermissionDenied(_)));
    }

    // ── event forwarding + final text ───────────────────────────────────────

    #[test]
    fn forward_drops_child_terminal_events() {
        use crate::core::agent::events::StreamEvent;
        assert!(forward_to_parent(&StreamEvent::Token { text: "x".into() }));
        assert!(forward_to_parent(&StreamEvent::Step { index: 1, max: 0 }));
        assert!(forward_to_parent(&StreamEvent::ToolCall {
            id: "c".into(),
            name: "read".into(),
            args: serde_json::Value::Null,
        }));
        assert!(!forward_to_parent(&StreamEvent::Done {
            stop_reason: "stop".into(),
            usage: None,
        }));
        assert!(!forward_to_parent(&StreamEvent::Error {
            code: "e".into(),
            message: "m".into(),
        }));
    }

    /// Cancellation contract: `dispatch_subagent` is awaited inline inside the
    /// parent's run future, which the command layer drops via `tokio::select!` on
    /// cancel. This test encodes that guarantee: an in-flight child future nested
    /// under such a select is dropped (cancelled) when the parent is cancelled,
    /// with no separate child-run registration required.
    #[tokio::test]
    async fn cancelling_parent_drops_in_flight_child() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let child_dropped = Arc::new(AtomicBool::new(false));

        struct DropFlag(Arc<AtomicBool>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let flag = child_dropped.clone();
        // The "parent run" awaits a never-completing "child" (dispatch) that owns
        // a drop guard, exactly as dispatch_subagent is awaited inline in the loop.
        let parent = async move {
            let _child_guard = DropFlag(flag);
            std::future::pending::<()>().await;
        };
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        cancel_tx.send(()).unwrap();

        tokio::select! {
            // Biased so the parent is polled first and actually starts (building
            // the child guard), modelling an in-flight child at cancel time.
            biased;
            _ = parent => unreachable!("parent should be cancelled first"),
            _ = cancel_rx => {}
        }

        assert!(
            child_dropped.load(Ordering::SeqCst),
            "cancelling the parent must drop the in-flight child"
        );
    }

    #[test]
    fn final_text_extracts_or_defaults_empty() {
        let with = serde_json::json!({
            "choices": [{ "message": { "content": "the answer" } }]
        });
        assert_eq!(final_assistant_text(&with), "the answer");
        assert_eq!(final_assistant_text(&serde_json::json!({})), "");
    }

    // ── tool schemas + arg parsing ──────────────────────────────────────────

    #[test]
    fn subagent_tool_names_are_recognized() {
        assert!(is_subagent_tool("dispatch_subagent"));
        assert!(is_subagent_tool("await_subagent"));
        assert!(is_subagent_tool("create_subagent"));
        assert!(is_subagent_tool("list_subagents"));
        assert!(!is_subagent_tool("read"));
        assert!(!is_subagent_tool("web_search"));
    }

    // ── background registry (spawn/await/abort) ─────────────────────────────

    /// A registry entry for the run these tests all call "r1", standing in for
    /// one `spawn_subagent` would have built.
    fn test_entry(
        rx: tokio::sync::oneshot::Receiver<Result<String, SubagentError>>,
        abort: tokio::task::AbortHandle,
        events: tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    ) -> BackgroundEntry {
        BackgroundEntry {
            result: Some(rx),
            abort,
            run_id: "r1".to_string(),
            name: "reviewer".to_string(),
            events,
            display_path: None,
            finished: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    #[tokio::test]
    async fn await_unknown_run_errors() {
        let bg = Arc::new(BackgroundSubagents::default());
        assert!(await_subagent(&bg, "nope").await.is_err());
    }

    #[tokio::test]
    async fn await_delivers_result_and_second_await_errors() {
        let bg = Arc::new(BackgroundSubagents::default());
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tokio::spawn(async { std::future::pending::<()>().await });
        let (ev_tx, _ev_rx) = tokio::sync::mpsc::unbounded_channel();
        bg.inner.lock().unwrap().insert(
            "r1".to_string(),
            test_entry(rx, handle.abort_handle(), ev_tx),
        );
        tx.send(Ok("done".to_string())).unwrap();
        assert_eq!(await_subagent(&bg, "r1").await.unwrap().text, "done");
        assert!(await_subagent(&bg, "r1").await.is_err(), "run is consumed");
        handle.abort();
    }

    #[tokio::test]
    async fn abort_on_drop_cancels_and_clears_children() {
        let bg = Arc::new(BackgroundSubagents::default());
        let (_tx, rx) = tokio::sync::oneshot::channel::<Result<String, SubagentError>>();
        let handle = tokio::spawn(async { std::future::pending::<()>().await });
        let (ev_tx, mut ev_rx) = tokio::sync::mpsc::unbounded_channel();
        bg.inner.lock().unwrap().insert(
            "r1".to_string(),
            test_entry(rx, handle.abort_handle(), ev_tx),
        );
        let guard = AbortOnDrop(bg.clone());
        drop(guard);
        assert!(bg.inner.lock().unwrap().is_empty(), "abort_all drains the map");
        assert!(handle.await.unwrap_err().is_cancelled(), "child was aborted");
        match ev_rx.try_recv() {
            Ok(crate::core::agent::events::StreamEvent::SubagentEnd { run_id, name, .. }) => {
                assert_eq!(run_id, "r1");
                assert_eq!(name, "reviewer");
            }
            other => panic!("expected SubagentEnd on abort, got {other:?}"),
        }
    }

    /// Regression test for #254: `await_subagent` used to remove the registry
    /// entry (and its AbortHandle) before awaiting the result, so a subagent
    /// became unreachable to `abort_all` the instant it started being awaited —
    /// making it uncancellable if the parent was cancelled mid-await.
    #[tokio::test]
    async fn cancelling_mid_await_keeps_the_entry_abortable() {
        let bg = Arc::new(BackgroundSubagents::default());
        let (_tx, rx) = tokio::sync::oneshot::channel::<Result<String, SubagentError>>();
        let handle = tokio::spawn(async { std::future::pending::<()>().await });
        let (ev_tx, _ev_rx) = tokio::sync::mpsc::unbounded_channel();
        bg.inner.lock().unwrap().insert(
            "r1".to_string(),
            test_entry(rx, handle.abort_handle(), ev_tx),
        );

        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        cancel_tx.send(()).unwrap();

        tokio::select! {
            biased;
            _ = await_subagent(&bg, "r1") => unreachable!("_tx is never sent; await_subagent never resolves on its own"),
            _ = cancel_rx => {}
        }

        assert!(
            bg.inner.lock().unwrap().contains_key("r1"),
            "cancelling mid-await must not remove the entry — abort_all still needs it"
        );
        handle.abort();
    }

    #[tokio::test]
    async fn join_all_waits_for_outstanding_children_instead_of_aborting() {
        let bg = Arc::new(BackgroundSubagents::default());
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, SubagentError>>();
        // A child that finishes shortly, mimicking still-in-flight work the model
        // never awaited. join_all must wait for it, not abort it.
        let handle = tokio::spawn(async move {
            let _ = tx.send(Ok("late-result".to_string()));
        });
        let (ev_tx, _ev_rx) = tokio::sync::mpsc::unbounded_channel();
        bg.inner.lock().unwrap().insert(
            "r1".to_string(),
            test_entry(rx, handle.abort_handle(), ev_tx),
        );
        bg.join_all().await;
        assert!(bg.inner.lock().unwrap().is_empty(), "join_all drains the map");
        assert!(!handle.is_finished() || handle.await.is_ok(), "child ran to completion");
    }

    #[tokio::test]
    async fn awaited_child_stays_cancellable_via_teardown() {
        // Regression for #254: await_subagent must not sever the abort handle from
        // the registry, or a parent cancelled mid-await can no longer stop the
        // child and its live event-sender clone hangs the run.
        let bg = Arc::new(BackgroundSubagents::default());
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, SubagentError>>();
        // The sender lives inside the task (as in `spawn_subagent`), so aborting the
        // task drops it and the awaited receiver resolves to Cancelled.
        let handle = tokio::spawn(async move {
            let _tx = tx;
            std::future::pending::<()>().await;
        });
        let (ev_tx, _ev_rx) = tokio::sync::mpsc::unbounded_channel();
        bg.inner.lock().unwrap().insert(
            "r1".to_string(),
            test_entry(rx, handle.abort_handle(), ev_tx),
        );

        let bg_await = bg.clone();
        let awaiting = tokio::spawn(async move { await_subagent(&bg_await, "r1").await });
        // Let the await take the receiver and park on it.
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;

        // The entry (with its abort handle) must still be reachable for teardown.
        assert!(
            bg.inner.lock().unwrap().contains_key("r1"),
            "entry must remain registered while being awaited"
        );

        AbortOnDrop(bg.clone()); // constructs + drops -> abort_all
        assert!(handle.await.unwrap_err().is_cancelled(), "child was aborted");
        assert!(
            matches!(awaiting.await.unwrap(), Err(SubagentError::Cancelled)),
            "await resolves to Cancelled once the child is aborted"
        );
        assert!(bg.inner.lock().unwrap().is_empty(), "teardown drained the map");
    }

    // ── max-parallel admission (semaphore queue) ───────────────────────────

    /// Minimal run args for queue tests: empty providers (so dispatched
    /// children fail fast instead of hanging), a real project root holding the
    /// subagent def, subagents enabled, cap 1.
    #[cfg(feature = "cli")]
    fn max_par_args(root: &std::path::Path) -> crate::core::agent::r#loop::OrchestrationArgs {
        use crate::core::agent::r#loop::OrchestrationArgs;
        use crate::core::mcp::models::McpSettings;
        use crate::core::state::ProviderConfig;
        use std::collections::HashMap;
        use std::sync::Arc;
        use tauri_plugin_agent_tools::permissions::ToolPermissions;
        OrchestrationArgs {
            client: crate::core::agent::upstream::agent_http_client(),
            provider_configs: Arc::new(tokio::sync::Mutex::new(
                HashMap::<String, ProviderConfig>::new(),
            )),
            mcp_servers: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            mcp_settings: Arc::new(tokio::sync::Mutex::new(McpSettings::default())),
            jan_data_folder: std::env::temp_dir().to_string_lossy().into_owned(),
            permissions: ToolPermissions::allow_all(),
            project_root: Some(root.to_path_buf()),
            permission_requests: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            ask_requests: None,
            todo_registry: None,
            system_prompt_override: None,
            subagents_enabled: true,
            max_parallel_subagents: 1,
            auto_approve: false,
            monitors: None,
            run_mode: crate::core::agent::plan::RunMode::Normal,
            session_id: None,
            sandbox: None,
            compaction: None,
        }
    }

    /// One queue-test dispatch, with no scratch: these assert admission order,
    /// not spilling, and a child that fails fast has nothing to write anyway.
    #[cfg(feature = "cli")]
    fn dispatch_reviewer(
        bg: &Arc<BackgroundSubagents>,
        args: &crate::core::agent::r#loop::OrchestrationArgs,
        events: &tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    ) -> String {
        spawn_subagent(bg, args, req("reviewer", None), &parent_run(), events, None, true)
            .unwrap()
            .run_id
    }

    #[test]
    fn subagent_cap_is_clamped_to_at_least_one() {
        let bg = BackgroundSubagents::new(0);
        assert_eq!(bg.semaphore.available_permits(), 1);
        assert_eq!(BackgroundSubagents::new(3).semaphore.available_permits(), 3);
        assert_eq!(
            BackgroundSubagents::default().semaphore.available_permits(),
            DEFAULT_MAX_PARALLEL_SUBAGENTS as usize
        );
    }

    #[test]
    fn queued_dispatches_wait_for_a_permit_in_fifo_order() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let bg = Arc::new(BackgroundSubagents::new(1));
            // Occupy the single permit as if one child were running.
            let running = bg.semaphore.clone().try_acquire_owned().unwrap();

            let order = Arc::new(std::sync::Mutex::new(Vec::new()));
            let mut handles = Vec::new();
            for i in 0..3 {
                let sem = bg.semaphore.clone();
                let order = order.clone();
                handles.push(tokio::spawn(async move {
                    let _permit = sem.acquire_owned().await.unwrap();
                    order.lock().unwrap().push(i);
                }));
                // Let the new task register its acquire before spawning the
                // next, mirroring the real loop where each spawn_subagent
                // dispatch runs synchronously (dispatch order == waiter order).
                tokio::task::yield_now().await;
            }
            // All three parked: none can start while the permit is held.
            tokio::task::yield_now().await;
            assert!(order.lock().unwrap().is_empty(), "cap holds while a child runs");
            drop(running);
            for h in handles {
                h.await.unwrap();
            }
            assert_eq!(
                *order.lock().unwrap(),
                vec![0, 1, 2],
                "FIFO: dispatch order is start order"
            );
        });
    }

    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn dispatches_beyond_cap_emit_subagent_queued_and_promote_fifo() {
        use crate::core::agent::events::StreamEvent;

        let root = unique_root("maxpar");
        let sub_dir = project_subagents_dir(&root);
        write_def(&sub_dir, "reviewer", "");
        let args = max_par_args(&root);

        let bg = Arc::new(BackgroundSubagents::new(1));
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut starts = Vec::new();

        let r1 = dispatch_reviewer(&bg, &args, &events_tx);
        let r2 = dispatch_reviewer(&bg, &args, &events_tx);
        let r3 = dispatch_reviewer(&bg, &args, &events_tx);
        assert_ne!(r1, r2);
        assert_ne!(r2, r3);

        // The two beyond-cap dispatches must be reported queued, with their
        // 1-based queue positions in dispatch order.
        let mut queued = Vec::new();
        while let Ok(ev) = events_rx.try_recv() {
            if let StreamEvent::SubagentQueued { run_id, waiting, .. } = ev {
                queued.push((run_id, waiting));
            }
        }
        assert_eq!(queued.len(), 2, "two dispatches exceeded the cap of 1");
        assert_eq!(queued[0], (r2.clone(), 1), "second dispatch queues first");
        assert_eq!(queued[1], (r3.clone(), 2), "third dispatch queues behind it");

        // The first dispatch is admitted immediately: it starts without a
        // queued event (children fail fast without a provider, which is fine --
        // we only assert the queueing/ordering contract here).
        let out1 = await_subagent(&bg, &r1).await;
        let out2 = await_subagent(&bg, &r2).await;
        let out3 = await_subagent(&bg, &r3).await;
        assert!(out1.is_err(), "child run fails without a provider (expected)");
        assert!(out2.is_err() && out3.is_err(), "queued children also complete");

        // Promotion must be FIFO: r2 started before r3.
        while let Ok(ev) = events_rx.try_recv() {
            if let StreamEvent::SubagentStart { run_id, .. } = ev {
                starts.push(run_id);
            }
        }
        let pos = |id: &str| starts.iter().position(|s| s == id);
        assert!(
            pos(&r2).unwrap() < pos(&r3).unwrap(),
            "FIFO promotion: {starts:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn inject_inputs_prefixes_and_truncates() {
        assert_eq!(inject_inputs("do it", &[]), "do it");
        let inputs = vec![("alpha".to_string(), "found X".to_string())];
        let out = inject_inputs("synthesize", &inputs);
        assert!(out.contains("Results from the previous phase"));
        assert!(out.contains("### alpha"));
        assert!(out.contains("found X"));
        assert!(out.trim_end().ends_with("synthesize"));

        let big = "x".repeat(PHASE_INPUT_MAX_BYTES + 500);
        let out = inject_inputs("t", &[("beta".to_string(), big)]);
        assert!(out.contains("truncated; read blackboard/beta.md"));
    }

    /// The heart of the phased dispatch: a later phase must not start until the
    /// earlier one has fully finished, and it must receive the earlier phase's
    /// blackboard results in its brief. Children fail fast (no provider), which is
    /// fine -- the scheduling contract and the injection are what this pins.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn a_later_phase_starts_after_the_earlier_one_with_its_results() {
        use crate::core::agent::events::StreamEvent;

        let root = unique_root("phaseplan");
        let scratch = root.join("scratch");
        std::fs::create_dir_all(&scratch).unwrap();
        let args = max_par_args(&root);
        let bg = Arc::new(BackgroundSubagents::new(4));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let plan = DispatchPlan {
            phases: vec![
                Phase {
                    number: 0,
                    subagents: vec![req("alpha", None), req("beta", None)],
                },
                Phase {
                    number: 1,
                    subagents: vec![req("collector", None)],
                },
            ],
        };
        let d = spawn_dispatch_plan(&bg, &args, plan, &parent_run(), &tx, Some(&scratch)).unwrap();
        assert_eq!(d.phase_count, 2);
        assert_eq!(d.total_subagents, 3);
        assert!(bg.has_pending_work(), "a multi-phase plan holds the run open");

        // Drain like the real loop, bounded so a scheduling bug fails not hangs.
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            while bg.has_pending_work() {
                bg.wait_for_notice().await;
                let _ = bg.take_notices();
            }
        })
        .await
        .expect("the whole plan drains and releases the run");

        let mut order = Vec::new();
        let mut collector_task = None;
        while let Ok(ev) = rx.try_recv() {
            match ev {
                StreamEvent::SubagentStart { name, task, .. } => {
                    if name == "collector" {
                        collector_task = task;
                    }
                    order.push(format!("start:{name}"));
                }
                StreamEvent::SubagentEnd { name, .. } => order.push(format!("end:{name}")),
                _ => {}
            }
        }
        let pos = |s: &str| order.iter().position(|e| e == s);
        let collector = pos("start:collector").expect("collector started");
        assert!(
            pos("end:alpha").unwrap() < collector && pos("end:beta").unwrap() < collector,
            "phase 2 waits for all of phase 1: {order:?}"
        );

        let task = collector_task.expect("collector carried a brief");
        assert!(
            task.contains("Results from the previous phase")
                && task.contains("alpha")
                && task.contains("beta"),
            "the collector's brief carries phase 1's blackboard: {task}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The doorbell contract: a multi-phase plan wakes the parent exactly once,
    /// after the last phase's last child finishes -- not per intermediate child.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn a_multi_phase_plan_rings_the_doorbell_once_at_the_end() {
        let root = unique_root("phasering");
        let scratch = root.join("scratch");
        std::fs::create_dir_all(&scratch).unwrap();
        let args = max_par_args(&root);
        let bg = Arc::new(BackgroundSubagents::new(4));
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();

        let plan = DispatchPlan {
            phases: vec![
                Phase {
                    number: 0,
                    subagents: vec![req("alpha", None), req("beta", None)],
                },
                Phase {
                    number: 1,
                    subagents: vec![req("gamma", None), req("collector", None)],
                },
            ],
        };
        spawn_dispatch_plan(&bg, &args, plan, &parent_run(), &tx, Some(&scratch)).unwrap();

        let mut all = Vec::new();
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            while bg.has_pending_work() {
                bg.wait_for_notice().await;
                all.extend(bg.take_notices());
            }
        })
        .await
        .expect("the whole plan drains and releases the run");

        assert_eq!(
            all.len(),
            1,
            "one ping for the whole plan, not one per child: {all:?}"
        );
        assert!(
            all[0].contains("plan finished") && all[0].contains("blackboard"),
            "the terminal ping points at the blackboard: {}",
            all[0]
        );
        // The notice names exactly the final phase (from `prev_names`, kept
        // aligned with `prev_ids`): both of its children, and neither earlier one.
        assert!(
            all[0].contains("gamma") && all[0].contains("collector"),
            "the notice lists the whole final phase: {}",
            all[0]
        );
        assert!(
            !all[0].contains("alpha") && !all[0].contains("beta"),
            "the notice does not leak earlier-phase names: {}",
            all[0]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn await_on_queued_run_blocks_until_a_slot_frees() {
        use crate::core::agent::events::StreamEvent;

        let root = unique_root("maxpar_await");
        write_def(&project_subagents_dir(&root), "reviewer", "");
        let args = max_par_args(&root);

        let bg = Arc::new(BackgroundSubagents::new(1));
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        // Occupy the only slot BEFORE dispatching, so every dispatch queues and
        // the await below is deterministic: nothing can start while held.
        let _running = bg.semaphore.clone().try_acquire_owned().unwrap();
        let r1 = dispatch_reviewer(&bg, &args, &events_tx);
        let r2 = dispatch_reviewer(&bg, &args, &events_tx);

        // r2 is queued (not started), and awaiting it must NOT start it: the
        // slot is still held, so the await parks. Assert via the events: no
        // SubagentStart for either child yet.
        let bg2 = bg.clone();
        let r2b = r2.clone();
        let awaited = tokio::spawn(async move { await_subagent(&bg2, &r2b).await });
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
        assert!(!awaited.is_finished(), "await on a queued run must block");
        while let Ok(ev) = events_rx.try_recv() {
            assert!(
                !matches!(ev, StreamEvent::SubagentStart { run_id, .. } if run_id == r2),
                "awaiting a queued run must not start it early"
            );
        }

        drop(_running); // free the slot: r1 promotes first (FIFO), then r2
        assert!(
            awaited.await.unwrap().is_err(),
            "awaited queued run resolves once it gets a slot"
        );
        let _ = await_subagent(&bg, &r1).await;
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn abort_all_cancels_queued_dispatches_too() {
        use crate::core::agent::events::StreamEvent;

        let root = unique_root("maxpar_abort");
        write_def(&project_subagents_dir(&root), "reviewer", "");
        let args = max_par_args(&root);

        let bg = Arc::new(BackgroundSubagents::new(1));
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        // Hold the slot before dispatching so r1, r2, r3 all queue (parked on
        // the semaphore) -- the interesting teardown case.
        let _running = bg.semaphore.clone().try_acquire_owned().unwrap();
        let _r1 = dispatch_reviewer(&bg, &args, &events_tx);
        let r2 = dispatch_reviewer(&bg, &args, &events_tx);
        let r3 = dispatch_reviewer(&bg, &args, &events_tx);

        AbortOnDrop(bg.clone()); // teardown with queued children parked

        let mut ends = Vec::new();
        while let Ok(ev) = events_rx.try_recv() {
            if let StreamEvent::SubagentEnd { run_id, .. } = ev {
                ends.push(run_id);
            }
        }
        assert!(ends.contains(&r2) && ends.contains(&r3), "queued children get SubagentEnd: {ends:?}");
        assert!(
            bg.inner.lock().unwrap().is_empty(),
            "abort_all drains queued dispatches too"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn schemas_list_available_names_in_dispatch_description() {
        let reg = registry_with("reviewer", None);
        let schemas = subagent_tool_schemas(&reg, DEFAULT_MAX_PARALLEL_SUBAGENTS);        assert_eq!(schemas.len(), 4);
        let names: Vec<&str> = schemas
            .iter()
            .map(|s| s["function"]["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            vec![
                "dispatch_subagent",
                "await_subagent",
                "create_subagent",
                "list_subagents"
            ]
        );
        let dispatch = &schemas[0]["function"]["description"].as_str().unwrap();
        assert!(dispatch.contains("reviewer"), "got: {dispatch}");
        // await_subagent is no longer advertised; the description explains the
        // background model (a note carries each child's answer) instead.
        assert!(!dispatch.contains("await_subagent"), "no await reference: {dispatch}");
        assert!(dispatch.contains("BACKGROUND"), "explains the background model: {dispatch}");
    }

    #[test]
    fn parse_await_requires_run_id() {
        assert_eq!(
            parse_await_args(&serde_json::json!({ "run_id": "sub-x-1" })).unwrap(),
            "sub-x-1"
        );
        assert!(parse_await_args(&serde_json::json!({})).is_err());
    }

    #[test]
    fn format_list_reports_scope_and_empty() {
        let empty = SubagentRegistry::default();
        assert!(format_subagent_list(&empty).contains("No subagents"));
        let reg = registry_with("reviewer", None);
        let listed = format_subagent_list(&reg);
        assert!(listed.contains("reviewer [project]: d"));
    }

    #[test]
    fn parse_create_defaults_scope_to_project() {
        let (def, scope, overwrite) = parse_create_args(&serde_json::json!({
            "name": "helper",
            "description": "d",
            "system_prompt": "sp"
        }))
        .unwrap();
        assert_eq!(scope, SubagentScope::Project);
        assert!(!overwrite);
        assert_eq!(def.name, "helper");
        assert!(def.allowed_tools.is_none());
    }

    #[test]
    fn parse_create_reads_user_scope_and_overwrite() {
        let (_, scope, overwrite) = parse_create_args(&serde_json::json!({
            "name": "helper",
            "description": "d",
            "system_prompt": "sp",
            "scope": "user",
            "overwrite": true
        }))
        .unwrap();
        assert_eq!(scope, SubagentScope::User);
        assert!(overwrite);
    }

    #[test]
    fn parse_create_rejects_bad_scope_and_missing_fields() {
        assert!(parse_create_args(&serde_json::json!({
            "name": "x", "description": "d", "system_prompt": "sp", "scope": "global"
        }))
        .is_err());
        assert!(parse_create_args(&serde_json::json!({ "name": "x" })).is_err());
        // The plugin scope is read-only and never a create target.
        assert!(parse_create_args(&serde_json::json!({
            "name": "x", "description": "d", "system_prompt": "sp", "scope": "plugin"
        }))
        .is_err());
    }

    fn plugin_agents_dir(root: &Path) -> PathBuf {
        crate::core::agent::skills::plugins_dir(root)
            .join("feature-dev")
            .join("agents")
    }

    #[test]
    fn plugin_agents_load_from_markdown_with_plugin_scope() {
        let root = unique_root("plugin-agents");
        std::fs::create_dir_all(plugin_agents_dir(&root)).unwrap();
        std::fs::write(
            plugin_agents_dir(&root).join("code-explorer.md"),
            "---\nname: code-explorer\ndescription: Explores code\nmodel: sonnet\ncolor: yellow\n---\n\nYou are an explorer.",
        )
        .unwrap();

        let reg = SubagentRegistry::load(&root);
        let def = reg.get("code-explorer").expect("loaded");
        assert_eq!(def.description, "Explores code");
        assert_eq!(def.system_prompt, "You are an explorer.");
        // Claude runtime metadata is ignored: the parent model runs the child.
        assert_eq!(def.model, None);
        assert_eq!(def.scope, SubagentScope::Plugin);
        let list = format_subagent_list(&reg);
        assert!(list.contains("code-explorer [plugin]"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_agent_tools_map_known_names_and_drop_unknowns() {
        let root = unique_root("plugin-tools");
        std::fs::create_dir_all(plugin_agents_dir(&root)).unwrap();
        std::fs::write(
            plugin_agents_dir(&root).join("reader.md"),
            "---\nname: reader\ndescription: Reads\n---\nYou are a reader.",
        )
        .unwrap();
        // tools is a Claude Code frontmatter list; NotebookRead has no Jan
        // equivalent, and Glob/Grep are intentionally unmapped (Jan no longer
        // advertises list/search tools) -- all three must drop, leaving `read`.
        std::fs::write(
            plugin_agents_dir(&root).join("scout.md"),
            "---\nname: scout\ndescription: Scans\ntools: [Read, Glob, Grep, NotebookRead]\n---\nScan.",
        )
        .unwrap();

        let reg = SubagentRegistry::load(&root);
        let def = reg.get("scout").expect("loaded");
        assert_eq!(def.allowed_tools.as_deref(), Some(&["read".to_string()][..]));
        // No tools field: no allowlist at all.
        assert_eq!(reg.get("reader").unwrap().allowed_tools, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_agent_scoped_to_only_search_tools_inherits_full_toolset() {
        // Glob/Grep are unmapped, so an agent listing only those maps to nothing
        // -> None (inherit), never Some([]) -- otherwise it would be left with no
        // way to search (bash is what covers it now).
        let root = unique_root("plugin-search-only");
        std::fs::create_dir_all(plugin_agents_dir(&root)).unwrap();
        std::fs::write(
            plugin_agents_dir(&root).join("finder.md"),
            "---\nname: finder\ndescription: Finds\ntools: [Glob, Grep]\n---\nFind.",
        )
        .unwrap();
        let reg = SubagentRegistry::load(&root);
        assert_eq!(reg.get("finder").unwrap().allowed_tools, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_agent_with_only_unknown_tools_gets_no_allowlist() {
        let root = unique_root("plugin-unknown-tools");
        std::fs::create_dir_all(plugin_agents_dir(&root)).unwrap();
        std::fs::write(
            plugin_agents_dir(&root).join("probe.md"),
            "---\nname: probe\ndescription: Probes\ntools: [NotebookRead, BashOutput]\n---\nProbe.",
        )
        .unwrap();

        let reg = SubagentRegistry::load(&root);
        // All names unknown -> None (inherit parent policy), never Some([])
        // which the dispatcher treats as "no tools".
        assert_eq!(reg.get("probe").unwrap().allowed_tools, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_toml_shadows_plugin_agent_by_name() {
        let root = unique_root("plugin-shadow");
        std::fs::create_dir_all(plugin_agents_dir(&root)).unwrap();
        std::fs::write(
            plugin_agents_dir(&root).join("code-explorer.md"),
            "---\nname: code-explorer\ndescription: Plugin version\n---\nPlugin body.",
        )
        .unwrap();
        write_def(
            &project_subagents_dir(&root),
            "code-explorer",
            "allowed_tools = [\"read\"]\n",
        );

        let reg = SubagentRegistry::load(&root);
        let def = reg.get("code-explorer").expect("resolved");
        assert_eq!(def.scope, SubagentScope::Project);
        assert_eq!(def.system_prompt, "You are code-explorer.");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_rejects_plugin_scope() {
        let root = unique_root("plugin-create");
        let mut reg = SubagentRegistry::load(&root);
        let def = SubagentDefinition {
            name: "x".to_string(),
            description: "d".to_string(),
            system_prompt: "sp".to_string(),
            allowed_tools: None,
            model: None,
            scope: SubagentScope::Plugin,
        };
        let dir = project_subagents_dir(&root);
        assert!(reg
            .create_in(&dir, def.clone(), SubagentScope::Plugin, false)
            .is_err());
        assert!(reg.create(def, SubagentScope::Plugin, false).is_err());
        assert!(subagent_dir_for(&root, SubagentScope::Plugin).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
