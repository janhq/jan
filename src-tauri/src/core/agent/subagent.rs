//! Subagent definitions and their two-scope registry. A subagent is a named,
//! reusable system prompt + default tool allowlist that the main agent can
//! dispatch a nested, isolated run against (see `dispatch_subagent`). Definitions
//! live as `<scope>/.jan/agent/subagents/<name>.toml`, merged from the user scope
//! (`~/.jan/agent/subagents/`) and the project scope (`<project>/.jan/agent/
//! subagents/`); the project scope shadows the user scope by name.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use tauri_plugin_agent_tools::permissions::ToolPermissions;

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
    UnknownSubagent(String),
    PermissionDenied(String),
    Upstream(String),
    Cancelled,
}

impl std::fmt::Display for SubagentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SubagentError::UnknownSubagent(n) => {
                write!(
                    f,
                    "unknown subagent '{n}': no matching definition in the user or \
                     project scope. For a one-off subagent, retry with a `system_prompt` \
                     describing its role (required for any subagent_name that isn't already \
                     saved); to check saved names first, call list_subagents."
                )
            }
            SubagentError::PermissionDenied(m) => write!(f, "permission denied: {m}"),
            SubagentError::Upstream(m) => write!(f, "{m}"),
            SubagentError::Cancelled => write!(f, "subagent run cancelled"),
        }
    }
}

/// `~/.jan/agent/subagents/`. `None` when the home directory can't be resolved.
pub fn user_subagents_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".jan").join("agent").join("subagents"))
}

/// `<project_root>/.jan/agent/subagents/`.
pub fn project_subagents_dir(project_root: &Path) -> PathBuf {
    project_root
        .join(".jan")
        .join("agent")
        .join("subagents")
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
                "glob" => Some("glob"),
                "grep" => Some("grep"),
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
/// `allowed_tools` (an empty list means "no tools"), or `None` to inherit the
/// definition's full toolset with no per-run allowlist (the parent's deny-list
/// still applies at gate time).
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

/// A model- or orchestration-issued request to run a subagent. When
/// `subagent_name` resolves in the registry, that definition is used (and
/// `allowed_tools` further narrows it). Otherwise, if `system_prompt` is
/// provided, an ephemeral one-off subagent is run inline with that prompt (no
/// registry entry, no disk write) so create + dispatch collapse to one call.
#[derive(Debug, Clone)]
pub struct SubagentRequest {
    pub subagent_name: String,
    pub description: String,
    pub allowed_tools: Option<Vec<String>>,
    pub system_prompt: Option<String>,
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
    match registry.get(&req.subagent_name).cloned() {
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
            // Unregistered: run an ephemeral one-off if an inline system_prompt
            // was supplied; otherwise it's a genuine unknown-name error.
            let system_prompt = req
                .system_prompt
                .clone()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| SubagentError::UnknownSubagent(req.subagent_name.clone()))?;
            let definition = SubagentDefinition {
                name: req.subagent_name.clone(),
                description: req.description.clone(),
                system_prompt,
                allowed_tools: req.allowed_tools.clone(),
                model: None,
                scope: SubagentScope::Project,
            };
            // The inline allowed_tools IS the definition's toolset; only the
            // parent's deny-list narrows it further.
            let allowed_tools =
                intersect_allowed_tools(definition.allowed_tools.as_deref(), None, parent)?;
            Ok(ResolvedDispatch {
                definition,
                allowed_tools,
            })
        }
    }
}

/// Child stream events are folded into the parent's own stream, except the
/// child's terminal `Done`/`Error`: the parent must not see the child terminate
/// its stream. Dispatch turns the child's result into a synthetic tool result
/// instead, bracketed by `SubagentStart`/`SubagentEnd`.
fn forward_to_parent(ev: &crate::core::agent::events::StreamEvent) -> bool {
    use crate::core::agent::events::StreamEvent;
    !matches!(
        ev,
        StreamEvent::Done { .. }
            | StreamEvent::Error { .. }
            | StreamEvent::MessagesUpdated { .. }
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
}

/// Registry of a single parent run's background subagents, keyed by `run_id`.
/// Dropped when the parent run ends (see `AbortOnDrop`), aborting any child that
/// was never collected so a finished/cancelled parent leaves no orphan runs.
/// `pub` (not `pub(crate)`) only because it now surfaces transitively through
/// the `pub` `agent_cancel`/`agent_cancel_subagent` Tauri commands' state type
/// — still crate-internal in practice, this binary has no external consumers.
pub struct BackgroundSubagents {
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
        }
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
            let _ = entry.events.send(StreamEvent::SubagentEnd {
                run_id: entry.run_id,
                name: entry.name,
                usage: None,
            });
        }
    }

    /// Abort and forget a single child by run_id. No-op if it's already
    /// finished/collected or never existed. Emits the same closing
    /// `SubagentEnd` as `abort_all` so a consumer's tasks panel sees the
    /// bracket close instead of a forever-running entry.
    pub(crate) fn abort_one(&self, run_id: &str) {
        use crate::core::agent::events::StreamEvent;
        if let Some(entry) = self.inner.lock().unwrap().remove(run_id) {
            entry.abort.abort();
            let _ = entry.events.send(StreamEvent::SubagentEnd {
                run_id: entry.run_id,
                name: entry.name,
                usage: None,
            });
        }
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

/// Build the child request body shared by every subagent run.
fn child_body(
    resolved: &ResolvedDispatch,
    description: &str,
    parent_model: &str,
    budget_remaining: Option<u64>,
) -> serde_json::Value {
    let model = resolved
        .definition
        .model
        .clone()
        .unwrap_or_else(|| parent_model.to_string());
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
    if let Some(remaining) = budget_remaining {
        body.insert("max_session_tokens".to_string(), serde_json::json!(remaining));
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
    parent_model: String,
    budget_remaining: Option<u64>,
    events: tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
    run_id: String,
) -> Result<String, SubagentError> {
    use crate::core::agent::events::StreamEvent;
    use crate::core::agent::r#loop::run_orchestration_streamed;

    let name = resolved.definition.name.clone();
    let mut child_args = parent_args;
    child_args.system_prompt_override = Some(resolved.definition.system_prompt.clone());
    child_args.subagents_enabled = false;
    // Never share the parent's externally-tracked registry: this child gets
    // its own fresh local one (via OrchestrationArgs' None fallback), so
    // aborting it can't reach into the parent's or a sibling's entries.
    child_args.background_subagents = None;
    // A subagent's own interactive question (if any) belongs to its parent's
    // conversation, not a client waiting on this child's ask_requests -- and
    // no client is attached to a background/child run anyway.
    child_args.ask_requests = None;
    // Subagents cannot read or mutate the parent's todo list (isolated child
    // context, matching ask_requests above).
    child_args.todo_registry = None;

    let body = child_body(&resolved, &description, &parent_model, budget_remaining);

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
            if forward_to_parent(&ev) {
                let _ = parent_events.send(StreamEvent::Subagent {
                    run_id: fwd_run_id.clone(),
                    name: fwd_name.clone(),
                    event: Box::new(ev),
                });
            }
        }
    });

    let result = run_orchestration_streamed(&child_tx, &body, &child_args).await;
    drop(child_tx);
    let _ = forwarder.await;

    // The child's own terminal Done (and its usage) is swallowed by
    // forward_to_parent, so this is the only place its usage can reach a
    // consumer — fold it into the bracket event the parent does see.
    let usage = match &result {
        Ok(completion) => crate::core::agent::events::Usage::from_completion(completion),
        Err(_) => None,
    };
    let _ = events.send(StreamEvent::SubagentEnd { run_id, name, usage });

    match result {
        Ok(completion) => Ok(final_assistant_text(&completion)),
        Err(message) => Err(SubagentError::Upstream(message)),
    }
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
pub(crate) fn spawn_subagent(
    bg: &Arc<BackgroundSubagents>,
    parent_args: &crate::core::agent::r#loop::OrchestrationArgs,
    req: SubagentRequest,
    parent_model: &str,
    budget_remaining: Option<u64>,
    events: &tokio::sync::mpsc::UnboundedSender<crate::core::agent::events::StreamEvent>,
) -> Result<String, SubagentError> {
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
    let model = parent_model.to_string();
    let description = req.description.clone();
    let run_id_task = run_id.clone();
    let queued_counter = bg.clone();
    let handle = tokio::spawn(async move {
        let permit = match admitted {
            Ok(p) => p,
            Err(_) => {
                let p = semaphore
                    .acquire_owned()
                    .await
                    .expect("subagent semaphore is never closed");
                queued_counter.queued.fetch_sub(1, Ordering::SeqCst);
                p
            }
        };
        let _permit = permit;
        let result = run_subagent(
            parent_args,
            resolved,
            description,
            model,
            budget_remaining,
            task_events,
            run_id_task,
        )
        .await;
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
        },
    );
    Ok(run_id)
}

/// Block until the background subagent `run_id` finishes and return its final
/// text (or error). Removes the run from the registry; a second await, or an
/// unknown id, errors. A run aborted by parent teardown resolves to `Cancelled`.
pub(crate) async fn await_subagent(
    bg: &Arc<BackgroundSubagents>,
    run_id: &str,
) -> Result<String, SubagentError> {
    let rx = {
        let mut guard = bg.inner.lock().unwrap();
        match guard.get_mut(run_id).and_then(|e| e.result.take()) {
            Some(rx) => rx,
            None => {
                return Err(SubagentError::Upstream(format!(
                    "unknown or already-collected subagent run '{run_id}'"
                )))
            }
        }
    };
    // Keep the entry (and its abort handle) in the registry while awaiting, so a
    // parent cancellation mid-await can still reach this child via `abort_all`.
    // Taking `result` above already makes a second await error out. Remove the
    // now-spent entry once the await resolves (a no-op if teardown drained it).
    let outcome = rx.await.unwrap_or(Err(SubagentError::Cancelled));
    bg.inner.lock().unwrap().remove(run_id);
    outcome
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
    let one_off = " For a one-off subagent, pass system_prompt inline (with a descriptive subagent_name); use create_subagent only to save a reusable definition.";
    let bg = format!(" Runs in the BACKGROUND and returns a run_id immediately; keep working, dispatch more, then call await_subagent(run_id) to collect each result. Up to {max_parallel} run concurrently (max_parallel_subagents in agent.toml); dispatches beyond that are queued FIFO and start as running ones finish.");
    let dispatch_desc = if available.is_empty() {
        format!("Start a subagent: a nested, isolated agent with its own system prompt and narrowed tools.{bg}{one_off} No saved subagents yet.")
    } else {
        format!(
            "Start a subagent: a nested, isolated agent with its own system prompt and narrowed tools.{bg}{one_off} Saved subagents: {}.",
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
                        "subagent_name": { "type": "string", "description": "Name of a saved subagent to run. For a one-off (no saved definition), pick a short descriptive name here AND pass system_prompt in the same call -- an unrecognized name with no system_prompt fails." },
                        "description": { "type": "string", "description": "The task for the subagent, as its sole user message. Include everything it needs; it does not see this conversation." },
                        "system_prompt": { "type": "string", "description": "Required alongside subagent_name whenever that name isn't already saved -- defines the one-off subagent's role. Omit only when subagent_name matches a saved subagent." },
                        "allowed_tools": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Tool allowlist. For a saved subagent this further narrows its own allowed_tools (never widens); for a one-off it is the subagent's toolset."
                        }
                    },
                    "required": ["subagent_name", "description"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "await_subagent",
                "description": "Block until a backgrounded subagent (started by dispatch_subagent) finishes, and return its final answer. Pass the run_id that dispatch_subagent returned. Each run_id can be awaited once.",
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
                            "description": "Optional default tool allowlist for the subagent."
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
                .collect()
        })
}

/// Parse a `dispatch_subagent` tool-call argument object.
pub fn parse_dispatch_args(args: &serde_json::Value) -> Result<SubagentRequest, SubagentError> {
    Ok(SubagentRequest {
        subagent_name: required_str(args, "subagent_name")?,
        description: required_str(args, "description")?,
        allowed_tools: optional_tool_list(args),
        system_prompt: args
            .get("system_prompt")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty()),
    })
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
            subagent_name: name.to_string(),
            description: "do the thing".to_string(),
            allowed_tools: allowed,
            system_prompt: None,
        }
    }

    #[test]
    fn resolve_unknown_name_without_inline_prompt_errors() {
        let reg = registry_with("reviewer", None);
        let p = ToolPermissions::allow_all();
        let err = resolve_dispatch(&reg, &req("nope", None), &p).unwrap_err();
        assert!(matches!(err, SubagentError::UnknownSubagent(n) if n == "nope"));
    }

    #[test]
    fn resolve_unknown_name_with_inline_prompt_runs_ephemeral() {
        let reg = SubagentRegistry::default();
        let p = ToolPermissions::allow_all();
        let request = SubagentRequest {
            subagent_name: "one-off".to_string(),
            description: "task".to_string(),
            allowed_tools: Some(vec!["read".to_string()]),
            system_prompt: Some("You are a one-off.".to_string()),
        };
        let resolved = resolve_dispatch(&reg, &request, &p).unwrap();
        assert_eq!(resolved.definition.system_prompt, "You are a one-off.");
        assert_eq!(resolved.definition.name, "one-off");
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
    fn parse_dispatch_reads_inline_system_prompt() {
        let r = parse_dispatch_args(&serde_json::json!({
            "subagent_name": "one-off",
            "description": "task",
            "system_prompt": "You are a one-off."
        }))
        .unwrap();
        assert_eq!(r.system_prompt.as_deref(), Some("You are a one-off."));
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
            BackgroundEntry {
                result: Some(rx),
                abort: handle.abort_handle(),
                run_id: "r1".to_string(),
                name: "reviewer".to_string(),
                events: ev_tx,
            },
        );
        tx.send(Ok("done".to_string())).unwrap();
        assert_eq!(await_subagent(&bg, "r1").await.unwrap(), "done");
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
            BackgroundEntry {
                result: Some(rx),
                abort: handle.abort_handle(),
                run_id: "r1".to_string(),
                name: "reviewer".to_string(),
                events: ev_tx,
            },
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
            BackgroundEntry {
                result: Some(rx),
                abort: handle.abort_handle(),
                run_id: "r1".to_string(),
                name: "reviewer".to_string(),
                events: ev_tx,
            },
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
    async fn abort_one_cancels_only_the_named_child() {
        let bg = Arc::new(BackgroundSubagents::default());
        let (_tx1, rx1) = tokio::sync::oneshot::channel::<Result<String, SubagentError>>();
        let (_tx2, rx2) = tokio::sync::oneshot::channel::<Result<String, SubagentError>>();
        let handle1 = tokio::spawn(async { std::future::pending::<()>().await });
        let handle2 = tokio::spawn(async { std::future::pending::<()>().await });
        let (ev1_tx, mut ev1_rx) = tokio::sync::mpsc::unbounded_channel();
        let (ev2_tx, _ev2_rx) = tokio::sync::mpsc::unbounded_channel();
        bg.inner.lock().unwrap().insert(
            "r1".to_string(),
            BackgroundEntry {
                result: Some(rx1),
                abort: handle1.abort_handle(),
                run_id: "r1".to_string(),
                name: "reviewer".to_string(),
                events: ev1_tx,
            },
        );
        bg.inner.lock().unwrap().insert(
            "r2".to_string(),
            BackgroundEntry {
                result: Some(rx2),
                abort: handle2.abort_handle(),
                run_id: "r2".to_string(),
                name: "reviewer".to_string(),
                events: ev2_tx,
            },
        );

        bg.abort_one("r1");

        assert!(!bg.inner.lock().unwrap().contains_key("r1"), "r1 removed");
        assert!(bg.inner.lock().unwrap().contains_key("r2"), "r2 untouched");
        assert!(handle1.await.unwrap_err().is_cancelled(), "r1 was aborted");
        match ev1_rx.try_recv() {
            Ok(crate::core::agent::events::StreamEvent::SubagentEnd { run_id, .. }) => {
                assert_eq!(run_id, "r1");
            }
            other => panic!("expected SubagentEnd on abort_one, got {other:?}"),
        }
        handle2.abort();
    }

    #[tokio::test]
    async fn abort_one_unknown_run_id_is_a_no_op() {
        let bg = Arc::new(BackgroundSubagents::default());
        bg.abort_one("nope"); // must not panic
        assert!(bg.inner.lock().unwrap().is_empty());
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
            BackgroundEntry {
                result: Some(rx),
                abort: handle.abort_handle(),
                run_id: "r1".to_string(),
                name: "reviewer".to_string(),
                events: ev_tx,
            },
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
            BackgroundEntry {
                result: Some(rx),
                abort: handle.abort_handle(),
                run_id: "r1".to_string(),
                name: "reviewer".to_string(),
                events: ev_tx,
            },
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
            client: reqwest::Client::new(),
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
            run_mode: crate::core::agent::plan::RunMode::Normal,
            session_id: None,
            sandbox: None,
        }
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

        let r1 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();
        let r2 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();
        let r3 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();
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
        let r1 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();
        let r2 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();

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
        let _r1 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();
        let r2 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();
        let r3 = spawn_subagent(&bg, &args, req("reviewer", None), "m", None, &events_tx).unwrap();

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
        assert!(dispatch.contains("await_subagent"), "dispatch should mention await");
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
    fn parse_dispatch_requires_name_and_description() {
        let ok = parse_dispatch_args(&serde_json::json!({
            "subagent_name": "reviewer",
            "description": "review this",
            "allowed_tools": ["read"]
        }))
        .unwrap();
        assert_eq!(ok.subagent_name, "reviewer");
        assert_eq!(ok.allowed_tools, Some(vec!["read".to_string()]));
        assert!(parse_dispatch_args(&serde_json::json!({ "description": "x" })).is_err());
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
        // equivalent and must be dropped, not fatal.
        std::fs::write(
            plugin_agents_dir(&root).join("scout.md"),
            "---\nname: scout\ndescription: Scans\ntools: [Read, Glob, Grep, NotebookRead]\n---\nScan.",
        )
        .unwrap();

        let reg = SubagentRegistry::load(&root);
        let def = reg.get("scout").expect("loaded");
        assert_eq!(
            def.allowed_tools.as_deref(),
            Some(&["read".to_string(), "glob".to_string(), "grep".to_string()][..])
        );
        // No tools field: no allowlist at all.
        assert_eq!(reg.get("reader").unwrap().allowed_tools, None);
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
