//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.

pub mod brand;
pub mod journal;
pub mod login;
pub mod mcp;
pub mod providers;
mod path_refs;
pub mod run_report;
mod secret_input;
pub mod telemetry;
pub mod tokamak;
mod tui;
pub mod updater;

use std::path::PathBuf;
use std::sync::Arc;

use crate::core::app::commands::{resolve_config_file_path, resolve_jan_data_folder};
use crate::core::threads::{
    constants::THREADS_FILE,
    helpers::{read_messages_from_file, update_thread_metadata, write_messages_to_file},
    utils::{
        ensure_data_dirs, get_data_dir, get_messages_path, get_thread_dir,
        get_thread_metadata_path,
    },
};

// ── Thread operations ──────────────────────────────────────────────────────

/// List thread metadata under `<base>/threads/`. `base` is the Jan data folder
/// (desktop store) or a project's `.jan/agent` dir (TUI store).
pub fn list_threads_in(base: &std::path::Path) -> Result<Vec<serde_json::Value>, String> {
    use std::fs;

    let data_dir = get_data_dir(base);
    let mut threads = Vec::new();
    if !data_dir.exists() {
        return Ok(threads);
    }
    for entry in fs::read_dir(&data_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            let metadata_path = path.join(THREADS_FILE);
            if metadata_path.exists() {
                let data = fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
                if let Ok(thread) = serde_json::from_str(&data) {
                    threads.push(thread);
                }
            }
        }
    }
    Ok(threads)
}

/// List all threads from the Jan data folder (desktop store).
pub async fn cli_list_threads() -> Result<Vec<serde_json::Value>, String> {
    let data_folder = resolve_jan_data_folder();
    ensure_data_dirs(&data_folder)?;
    list_threads_in(&data_folder)
}

/// Which saved thread a `--resume` / `--continue` / `/resume` request refers to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResumeTarget {
    /// Most recently updated thread for the project.
    Latest,
    /// A full thread id or a unique prefix of one.
    Id(String),
}

impl ResumeTarget {
    /// Build a target from the CLI flag pair: `--resume [ID]` and `--continue`/`-c`
    /// (an alias for a bare `--resume`). `None` means "do not resume".
    pub fn from_flags(resume: Option<Option<String>>, continue_session: bool) -> Option<Self> {
        match resume {
            Some(Some(id)) if !id.trim().is_empty() => Some(Self::Id(id.trim().to_string())),
            Some(_) => Some(Self::Latest),
            None if continue_session => Some(Self::Latest),
            None => None,
        }
    }
}

/// Recency sort key for a saved thread (`updated`, falling back to `created`).
pub fn thread_recency(t: &serde_json::Value) -> f64 {
    t.get("updated")
        .or_else(|| t.get("created"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0)
}

/// Sort threads most-recent-first (by `updated`/`created`).
pub fn sort_threads_recent(threads: &mut [serde_json::Value]) {
    threads.sort_by(|a, b| {
        thread_recency(b)
            .partial_cmp(&thread_recency(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

/// Message shown when there is nothing to resume; the caller then starts fresh.
pub const NO_SESSION_TO_RESUME: &str = "No session to resume";

/// Resolve a resume target against `<base>/threads/`, returning the thread
/// metadata. Threads whose `thread.json` is unparsable are skipped by
/// `list_threads_in`, so a corrupted neighbour never blocks a resume.
pub fn find_resume_thread(
    base: &std::path::Path,
    target: &ResumeTarget,
) -> Result<serde_json::Value, String> {
    let mut threads = list_threads_in(base)?;
    match target {
        ResumeTarget::Latest => {
            sort_threads_recent(&mut threads);
            threads
                .into_iter()
                .next()
                .ok_or_else(|| NO_SESSION_TO_RESUME.to_string())
        }
        ResumeTarget::Id(id) => {
            let mut matches: Vec<serde_json::Value> = threads
                .into_iter()
                .filter(|t| {
                    t.get("id")
                        .and_then(|v| v.as_str())
                        .is_some_and(|full| full == id || full.starts_with(id.as_str()))
                })
                .collect();
            match matches.len() {
                0 => Err(format!("no thread matches '{id}'")),
                1 => Ok(matches.remove(0)),
                n => Err(format!("'{id}' is ambiguous ({n} matches)")),
            }
        }
    }
}

/// Read a thread's messages, tolerating a truncated or malformed line (a crash
/// mid-append leaves one). Returns the parsed records and the skipped count, so
/// a resume degrades to "lost the tail" instead of failing outright.
pub fn cli_read_messages_lenient(
    base: &std::path::Path,
    thread_id: &str,
) -> Result<(Vec<serde_json::Value>, usize), String> {
    use std::io::BufRead;

    let path = get_messages_path(base, thread_id);
    if !path.exists() {
        return Ok((Vec::new(), 0));
    }
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    let mut skipped = 0;
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(&line) {
            Ok(v) => messages.push(v),
            Err(_) => skipped += 1,
        }
    }
    Ok((messages, skipped))
}

/// Read a thread's messages from `<base>/threads/<id>/messages.jsonl`.
pub fn cli_list_messages_in(
    base: &std::path::Path,
    thread_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    read_messages_from_file(base, thread_id)
}

/// List messages for a thread.
pub fn cli_list_messages(thread_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let data_folder = resolve_jan_data_folder();
    read_messages_from_file(&data_folder, thread_id)
}

/// Delete a thread directory.
pub fn cli_delete_thread(thread_id: &str) -> Result<(), String> {
    use std::fs;

    let data_folder = resolve_jan_data_folder();
    let thread_dir = get_thread_dir(&data_folder, thread_id);
    if thread_dir.exists() {
        fs::remove_dir_all(thread_dir).map_err(|e| e.to_string())?;
    }
    crate::core::agent::git::cleanup_snapshot_index(thread_id);
    Ok(())
}

/// Get thread metadata by ID.
pub fn cli_get_thread(thread_id: &str) -> Result<serde_json::Value, String> {
    let data_folder = resolve_jan_data_folder();
    let path = get_thread_metadata_path(&data_folder, thread_id);
    if !path.exists() {
        return Err(format!("Thread '{thread_id}' not found"));
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

/// Persist a TUI conversation as a desktop-compatible thread so it appears in
/// `/resume` and the desktop app. `history` is OpenAI-shaped (`{role, content}`);
/// it is written as `thread.message` records plus `thread.json` metadata. Pass
/// an existing `thread_id` to update that thread, or `None` to create one
/// (returns the id). Title/created are preserved when updating.
pub fn cli_save_thread(
    base: &std::path::Path,
    thread_id: Option<&str>,
    model: &str,
    history: &[serde_json::Value],
    metadata: Option<serde_json::Value>,
) -> Result<String, String> {
    if history.is_empty() {
        return Err("empty conversation".to_string());
    }
    ensure_data_dirs(base)?;
    let id = thread_id
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(get_thread_dir(base, &id)).map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let now_ms = now.as_millis() as i64;
    let now_secs = now.as_secs_f64();

    let messages: Vec<serde_json::Value> = history
        .iter()
        .filter_map(|m| {
            let role = m.get("role").and_then(|v| v.as_str())?;
            let content = openai_content_text(m.get("content"));
            let mut record = serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "object": "thread.message",
                "thread_id": id,
                "role": role,
                "type": "text",
                "status": "ready",
                "created_at": now_ms,
                "completed_at": now_ms,
                "content": [{ "type": "text", "text": { "value": content, "annotations": [] } }],
            });
            // Carry the wire fields the text form cannot express, so a resumed
            // conversation still shows the model the tools it ran. Extra keys on
            // a `thread.message`; the desktop reads `role` and `content`.
            for key in ["tool_calls", "tool_call_id"] {
                if let Some(v) = m.get(key) {
                    record[key] = v.clone();
                }
            }
            Some(record)
        })
        .collect();
    write_messages_to_file(&messages, &get_messages_path(base, &id))?;

    let existing: Option<serde_json::Value> =
        std::fs::read_to_string(get_thread_metadata_path(base, &id))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
    let created = existing
        .as_ref()
        .and_then(|e| e.get("created").and_then(serde_json::Value::as_f64))
        .unwrap_or(now_secs);
    let title = existing
        .as_ref()
        .and_then(|e| e.get("title").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_thread_title(history));

    // Preserve prior metadata when the caller passes none (e.g. a plain save with
    // no worktree state), so an update never drops isolation bookkeeping.
    let metadata = metadata
        .or_else(|| existing.as_ref().and_then(|e| e.get("metadata").cloned()))
        .unwrap_or_else(|| serde_json::json!({}));

    let thread = serde_json::json!({
        "id": id,
        "object": "thread",
        "title": title,
        "created": created,
        "updated": now_secs,
        "model": { "id": model, "provider": "" },
        "metadata": metadata,
    });
    update_thread_metadata(base, &id, &thread)?;
    Ok(id)
}

/// Persist a TUI `/model` choice to the project's `agent.toml` `[agent].model`,
/// so it is remembered on the next session (agent.toml wins over the desktop
/// default in the model-resolution order). `agent_dir` is `<project>/.jan/agent`.
pub fn cli_set_project_model(agent_dir: &std::path::Path, model: &str) -> Result<(), String> {
    set_model_in_agent_toml(&agent_dir.join("agent.toml"), model)
}

/// Stands in for a tool result that never reached disk, so the call it answers
/// stays valid. Says what happened rather than inventing an outcome.
const MISSING_TOOL_RESULT: &str =
    "(result not saved: the session ended before this call's output was recorded)";

/// Rebuild the wire conversation from persisted `thread.message` records: the
/// user/assistant text plus the tool calls and results that text cannot express,
/// so a resumed model sees the work it did instead of only its own answers.
///
/// Tool pairing is enforced, because an OpenAI-compatible upstream rejects a
/// conversation where it is broken: a result whose call is gone is dropped, and a
/// call whose result is missing (a crash between the two) gets the placeholder
/// above. Roles the agent owns (`system`) and messages carrying neither text nor
/// calls are left out.
pub(crate) fn rebuild_wire_history(messages: &[serde_json::Value]) -> Vec<serde_json::Value> {
    fn answer_open(out: &mut Vec<serde_json::Value>, open: &mut Vec<String>) {
        for id in open.drain(..) {
            out.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": id,
                "content": MISSING_TOOL_RESULT,
            }));
        }
    }

    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut open: Vec<String> = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or_default();
        let text = thread_message_text(m);
        if role == "tool" {
            let id = m
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if let Some(pos) = open.iter().position(|open_id| open_id == id) {
                open.remove(pos);
                out.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": text,
                }));
            }
            continue;
        }
        if !matches!(role, "user" | "assistant") {
            continue;
        }
        // A new turn: whatever the previous assistant left unanswered is closed
        // out first, so calls and results stay adjacent and paired.
        answer_open(&mut out, &mut open);
        let calls = m
            .get("tool_calls")
            .filter(|v| v.as_array().is_some_and(|a| !a.is_empty()));
        if text.is_empty() && calls.is_none() {
            continue;
        }
        let mut msg = serde_json::json!({ "role": role, "content": text });
        if let Some(calls) = calls {
            msg["tool_calls"] = calls.clone();
            open = calls
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|c| c.get("id").and_then(|v| v.as_str()))
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
        }
        out.push(msg);
    }
    answer_open(&mut out, &mut open);
    out
}

/// Text of a persisted `thread.message` (content parts carry `text.value`) or of
/// an OpenAI-shaped message (`content` is a plain string or `text` parts), so
/// the same reader works on both sides of a save/resume round trip.
pub(crate) fn thread_message_text(msg: &serde_json::Value) -> String {
    match msg.get("content") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| {
                p.get("text")
                    .and_then(|t| t.get("value"))
                    .and_then(|v| v.as_str())
                    .or_else(|| p.get("text").and_then(|t| t.as_str()))
                    .or_else(|| p.as_str())
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Text of an OpenAI-shaped message `content`: the string as-is, or the joined
/// `text` parts of a multimodal content array (image parts contribute nothing).
fn openai_content_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter(|p| p.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Fallback thread title: the first user message, whitespace-collapsed and
/// truncated. Used only when no summarized title exists yet.
fn default_thread_title(history: &[serde_json::Value]) -> String {
    let first_user = history
        .iter()
        .find(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
        .map(|m| openai_content_text(m.get("content")))
        .unwrap_or_default();
    let collapsed = first_user.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return "Agent chat".to_string();
    }
    if collapsed.chars().count() > 50 {
        format!("{}…", collapsed.chars().take(49).collect::<String>())
    } else {
        collapsed
    }
}

// ── App config ────────────────────────────────────────────────────────────

pub fn cli_get_data_folder() -> PathBuf {
    resolve_jan_data_folder()
}

pub fn cli_get_config() -> Result<serde_json::Value, String> {
    let path = resolve_config_file_path();
    if !path.exists() {
        return Err(format!("Config file not found at: {}", path.display()));
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

// ── Agent operations ───────────────────────────────────────────────────────

use crate::core::agent::events::StreamEvent;
use crate::core::agent::project::{
    ensure_project, load_agent_config, permissions_from, set_model_in_agent_toml,
};
use crate::core::agent::r#loop::{
    run_orchestration_streamed, OrchestrationArgs, PermissionRegistry,
};
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use crate::core::cli::providers::{load_provider_configs, ProviderOverrides};
use crate::core::cli::run_report::{OutputFormat, RunReport};
use crate::core::mcp::models::McpSettings;
use std::collections::HashMap;
use std::io::Write as _;
use tokio::sync::{mpsc, Mutex};

/// Token-spend ceiling for one agent run when `agent.toml [budget].max_tokens`
/// is unset. There is no turn cap: the agent takes as many turns as the task
/// needs and this budget (or cancellation) is what stops a runaway loop. `0`
/// disables the ceiling entirely. Counted marginally by `SessionBudget`, so
/// this bounds real new spend, not the context replayed on every turn.
const DEFAULT_MAX_SESSION_TOKENS: u64 = 128_000;

/// Resolve the `--project` flag (default `"."`) to an absolute path. The raw
/// value is what the model would otherwise see verbatim in the system prompt's
/// working-directory block, so a bare "." must become the real cwd rather than
/// being sent to the model as-is. Falls back to the raw (possibly relative)
/// path if canonicalization fails (e.g. the directory doesn't exist yet).
fn resolve_project_root(project: &str) -> PathBuf {
    PathBuf::from(project)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(project))
}

/// Resolved-config + provider snapshot for `jan cli agent status`.
pub fn cli_agent_status(
    project: &str,
    overrides: &ProviderOverrides,
) -> Result<serde_json::Value, String> {
    let project_root = resolve_project_root(project);
    ensure_project(&project_root)?;
    let cfg = load_agent_config(&project_root)?;
    let provider_configs = load_provider_configs(Some(&project_root), overrides)?;

    // Only providers this build can reach: local-engine entries inherited from
    // the desktop store have no upstream here (see `is_cli_reachable`).
    let mut providers: Vec<serde_json::Value> = provider_configs
        .values()
        .filter(|c| crate::core::cli::providers::is_cli_reachable(c))
        .map(|c| {
            serde_json::json!({
                "provider": c.provider,
                "base_url": c.base_url,
                "has_api_key": c.api_key.is_some() || !c.api_keys.is_empty(),
                "models": c.models.len(),
            })
        })
        .collect();
    providers.sort_by(|a, b| a["provider"].as_str().cmp(&b["provider"].as_str()));

    Ok(serde_json::json!({
        "project": project_root.to_string_lossy(),
        "data_folder": resolve_jan_data_folder().to_string_lossy(),
        "model": cfg.agent.model,
        "max_session_tokens": cfg.budget.max_tokens.unwrap_or(DEFAULT_MAX_SESSION_TOKENS),
        "tools": {
            "default": cfg.tools.default,
            "allow": cfg.tools.allow,
            "deny": cfg.tools.deny,
            "allow_write": cfg.tools.allow_write,
            "allow_network": cfg.tools.allow_network,
            "allow_home_read": cfg.tools.allow_home_read,
        },
        "providers": providers,
    }))
}

/// Set (create or merge) a provider entry in the global `~/.jan/config.toml`,
/// the standalone-agent credential store. Returns the config path so the caller
/// can report where the value landed. Headless: no Desktop app required.
pub fn cli_agent_config_set(
    provider: &str,
    api_key: Option<String>,
    base_url: Option<String>,
    models: Option<Vec<String>>,
    api_type: Option<String>,
) -> Result<PathBuf, String> {
    crate::core::agent::global_config::set_provider(
        provider,
        crate::core::agent::global_config::ProviderUpdate {
            api_key,
            base_url,
            models,
            api_type,
        },
    )
}

/// Remove a provider entry from `~/.jan/config.toml`. `Ok(false)` means it was
/// already absent.
pub fn cli_agent_config_unset(provider: &str) -> Result<bool, String> {
    crate::core::agent::global_config::remove_provider(provider)
}

/// The global config file path, scaffolding a commented template if it doesn't
/// exist yet so `jan config path` always points at a real file.
pub fn cli_agent_config_path() -> Result<PathBuf, String> {
    crate::core::agent::global_config::ensure_global_config()
}

/// Providers configured in `~/.jan/config.toml`, as JSON with API keys redacted.
/// Reflects only the global store (what the user set), not Desktop inherit.
pub fn cli_agent_config_list() -> Result<serde_json::Value, String> {
    let configs = crate::core::agent::global_config::load_global_config()?;
    let mut providers: Vec<serde_json::Value> = configs
        .values()
        .map(|c| {
            serde_json::json!({
                "provider": c.provider,
                "base_url": c.base_url,
                "has_api_key": c.api_key.is_some(),
                "api_type": c.api_type,
                "models": c.models,
            })
        })
        .collect();
    providers.sort_by(|a, b| a["provider"].as_str().cmp(&b["provider"].as_str()));
    Ok(serde_json::json!({
        "config_path": crate::core::agent::global_config::global_config_path()?.to_string_lossy(),
        "providers": providers,
    }))
}

/// Autonomous run: as many turns as the task needs, bounded only by the
/// session token budget.
#[allow(clippy::too_many_arguments)]
pub async fn cli_agent_run(
    project: &str,
    task: &str,
    model: Option<String>,
    overrides: ProviderOverrides,
    auto_approve: bool,
    resume: Option<ResumeTarget>,
    format: OutputFormat,
) -> Result<(), String> {
    run_agent_loop(
        project,
        task,
        model,
        false,
        overrides,
        auto_approve,
        resume,
        format,
    )
    .await
}

/// Single-turn run for debugging: the one place a turn cap is still applied,
/// and it is not user-configurable.
pub async fn cli_agent_step(
    project: &str,
    task: &str,
    model: Option<String>,
    overrides: ProviderOverrides,
    auto_approve: bool,
) -> Result<(), String> {
    run_agent_loop(
        project,
        task,
        model,
        true,
        overrides,
        auto_approve,
        None,
        OutputFormat::Text,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
fn build_cli_orchestration_args(
    project_root: PathBuf,
    permissions: tauri_plugin_agent_tools::permissions::ToolPermissions,
    provider_configs: HashMap<String, crate::core::state::ProviderConfig>,
    mcp_servers: crate::core::state::SharedMcpServers,
    mcp_settings: McpSettings,
    permission_requests: PermissionRegistry,
    auto_approve: bool,
    plan: bool,
    max_parallel_subagents: u32,
) -> OrchestrationArgs {
    OrchestrationArgs {
        client: reqwest::Client::new(),
        provider_configs: Arc::new(Mutex::new(provider_configs)),
        mcp_servers,
        mcp_settings: Arc::new(Mutex::new(mcp_settings)),
        jan_data_folder: resolve_jan_data_folder().to_string_lossy().into_owned(),
        permissions,
        project_root: Some(project_root),
        permission_requests,
        ask_requests: None,
        todo_registry: None,
        system_prompt_override: None,
        subagents_enabled: true,
        max_parallel_subagents,
        auto_approve,
        run_mode: if plan {
            crate::core::agent::plan::RunMode::Plan
        } else {
            crate::core::agent::plan::RunMode::Normal
        },
    }
}

/// Everything needed to drive one agent run: the engine handle, request body,
/// and the shared permission registry. Built once and consumed by either the
/// plain CLI printer or the TUI renderer.
pub(crate) struct PreparedRun {
    pub args: OrchestrationArgs,
    pub body: serde_json::Value,
    pub permission_requests: PermissionRegistry,
    /// Background connect of `active` MCP servers, awaited before the first turn.
    pub mcp_task: Option<tokio::task::JoinHandle<mcp::ConnectOutcome>>,
    /// Where to write the conversation once the run finishes.
    persist: PersistTarget,
}

/// Bookkeeping for writing a non-interactive run to the project's thread store,
/// so `--resume` can pick it up later. `thread_id` is `None` for a new session.
struct PersistTarget {
    agent_dir: PathBuf,
    thread_id: Option<String>,
    model: String,
    history: Vec<serde_json::Value>,
}

/// Per-run limits resolved from agent.toml. Grouped rather than passed as a
/// run of bare numbers, which would be trivial to transpose at a call site.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SessionLimits {
    /// Context window limit in tokens for the model. Defaults to 128K if agent.toml
    /// doesn't set it. Used to display `ctx N/K` in the header and trigger compaction.
    pub context_window: u64,
    /// Tokens reserved for the model's response. Defaults to 16K if unset.
    /// Compaction triggers at `context_window - reserve_tokens`.
    pub reserve_tokens: u64,
    /// Per-request output cap forwarded to the model as OpenAI `max_tokens`.
    /// `None` omits the field (model default).
    pub max_tokens: Option<u64>,
    /// `[budget].max_tokens`: marginal token-spend ceiling for one run, the
    /// only cap on run length. `0` is unbounded.
    pub max_session_tokens: u64,
}

/// Resolved engine handle for a chat session: the args are built once and the
/// request body is assembled per turn (the TUI reuses this across many turns;
/// the plain CLI builds a single body). `model`/`limits` seed each body.
pub(crate) struct AgentSession {
    pub args: OrchestrationArgs,
    pub permission_requests: PermissionRegistry,
    pub model: String,
    /// Fast model for the `smol` role (goal evaluation). Falls back to `model`.
    pub smol_model: String,
    pub limits: SessionLimits,
    /// Whether the TUI expands `<think>` reasoning blocks (default false).
    pub show_reasoning: bool,
    /// Shared MCP connection map (same Arc held by `args`), so the TUI can
    /// connect/disconnect servers live via `/mcp` and later turns pick them up.
    pub mcp_servers: crate::core::state::SharedMcpServers,
    /// Background connect of `active` MCP servers, awaited before the first turn.
    /// `None` when no server is active. Resolves to the connected server names.
    pub mcp_task: Option<tokio::task::JoinHandle<mcp::ConnectOutcome>>,
}

impl AgentSession {
    /// Build a streaming request body for the given conversation history.
    pub(crate) fn body(&self, messages: serde_json::Value) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "max_session_tokens": self.limits.max_session_tokens,
            "stream": true,
        });
        // Forward the per-request output cap only when configured; it flows to
        // the upstream via `copy_optional_chat_params`.
        if let Some(max) = self.limits.max_tokens {
            body["max_tokens"] = serde_json::json!(max);
        }
        body
    }
}

/// Resolve project config + credentials into a ready-to-run engine handle.
/// Shared by `run_agent_loop` (plain CLI) and `cli_agent_ui` (TUI).
fn prepare_agent_session(
    project: &str,
    model_override: Option<String>,
    overrides: ProviderOverrides,
    auto_approve: bool,
    plan: bool,
    require_model: bool,
) -> Result<AgentSession, String> {
    let project_root = resolve_project_root(project);
    ensure_project(&project_root)?;
    if let Err(e) = crate::core::agent::global_config::ensure_global_config() {
        log::warn!("Agent: could not scaffold ~/.jan/config.toml: {e}");
    }
    let cfg = load_agent_config(&project_root)?;
    let permissions = permissions_from(&cfg);

    // Resolution order: --model flag, then agent.toml [agent].model, then the
    // standalone global config (~/.jan/config.toml default_model / first provider
    // model), then the desktop app's currently-selected model (settings.json
    // inherit). Global config outranks desktop so a standalone agent is
    // self-sufficient without a desktop install.
    let explicit = model_override.is_some() || overrides.api_key.is_some();
    let model = model_override
        .or_else(|| cfg.agent.model.clone())
        .or_else(|| crate::core::agent::global_config::default_model().ok().flatten())
        .or_else(|| crate::core::cli::providers::desktop_selection().model);
    // A project or global default can name a model with nobody around to serve
    // it (e.g. this repo's own agent.toml pins one, but a fresh `~/.jan` has no
    // credentials for anything). Trust it only when the user was explicit
    // (--model/--api-key) or some provider can actually be reached; otherwise
    // treat it as unset so the TUI's sign-in notice fires instead of failing on
    // the first message.
    let model = if !require_model
        && !explicit
        && !crate::core::cli::providers::has_usable_provider(Some(&project_root))
    {
        String::new()
    } else {
        model.unwrap_or_default()
    };
    if model.is_empty() && require_model {
        return Err(
            "no model specified: run `jan login` to sign in to Tokamak, or pass --model, set [agent].model in agent.toml, set default_model in ~/.jan/config.toml, or select a model in the desktop app"
                .to_string(),
        );
    }
    // The `smol` role (used by /goal evaluation): an explicit smol_model in
    // ~/.jan/config.toml, else reuse the main model so evaluation always works.
    let smol_model = crate::core::agent::global_config::smol_model()
        .ok()
        .flatten()
        .unwrap_or_else(|| model.clone());

    let provider_configs = load_provider_configs(Some(&project_root), &overrides)?;

    // Reject a model whose only provider is a local engine descriptor before any
    // setup work: the CLI cannot start an engine itself, so this would otherwise
    // fail mid-run with a far vaguer message. Local models are still runnable
    // over HTTP -- via the desktop app's API server -- which is what the hint
    // points at; a provider entry with a base_url never reaches this branch.
    if let Some(local) =
        crate::core::cli::providers::unreachable_local_provider(&provider_configs, &model)
    {
        return Err(format!(
            "model '{model}' is only offered by '{local}', a local engine the Jan CLI cannot \
             start itself. To use it, run the model in the Jan desktop app with its API server \
             enabled and point a provider at it:\n  \
             jan config set --provider jan --base-url http://localhost:1337/v1 --model {model}\n\
             Or pick a model from `jan cli models list`."
        ));
    }

    // MCP servers marked `active` in mcp_config.json connect off-thread so setup/
    // render isn't blocked on a cold stdio spawn. The caller awaits `mcp_task`
    // before the first turn (tools are collected once per run), so a race with
    // the first message can't leave the model without its MCP tools. `None` when
    // no server is active.
    let mcp_servers: crate::core::state::SharedMcpServers =
        Arc::new(Mutex::new(HashMap::new()));
    let mcp_settings = mcp::read_settings();
    let mcp_task = if mcp::active_count() > 0 {
        let servers = mcp_servers.clone();
        Some(tokio::spawn(
            async move { mcp::connect_active(&servers).await },
        ))
    } else {
        None
    };

    let permission_requests: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
    let max_parallel_subagents = cfg
        .agent
        .max_parallel_subagents
        .unwrap_or(crate::core::agent::subagent::DEFAULT_MAX_PARALLEL_SUBAGENTS);
    let args = build_cli_orchestration_args(
        project_root,
        permissions,
        provider_configs,
        mcp_servers.clone(),
        mcp_settings,
        permission_requests.clone(),
        auto_approve,
        plan,
        max_parallel_subagents,
    );

    Ok(AgentSession {
        args,
        permission_requests,
        model,
        smol_model,
        limits: SessionLimits {
            context_window: cfg.agent.context_window.unwrap_or(128_000),
            reserve_tokens: cfg.agent.compaction_reserve_tokens.unwrap_or(16_384),
            max_tokens: cfg.agent.max_tokens,
            max_session_tokens: cfg.budget.max_tokens.unwrap_or(DEFAULT_MAX_SESSION_TOKENS),
        },
        show_reasoning: cfg.agent.show_reasoning.unwrap_or(false),
        mcp_servers,
        mcp_task,
    })
}

/// The prior conversation a non-interactive `--resume` run continues, in
/// OpenAI `{role, content}` shape (the wire format the engine expects).
struct ResumedSession {
    thread_id: String,
    history: Vec<serde_json::Value>,
}

/// Load a saved thread's conversation for continuation, tool calls and results
/// included (see `rebuild_wire_history`), matching `/resume` in the TUI. Errors
/// describe why nothing could be resumed; the caller starts fresh.
fn load_resume_history(
    agent_dir: &std::path::Path,
    target: &ResumeTarget,
) -> Result<ResumedSession, String> {
    let thread = find_resume_thread(agent_dir, target)?;
    let thread_id = thread
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "saved thread has no id".to_string())?
        .to_string();
    let (messages, skipped) = cli_read_messages_lenient(agent_dir, &thread_id)?;
    if skipped > 0 {
        eprintln!("(skipped {skipped} unreadable message(s) in the resumed session)");
    }
    let history = rebuild_wire_history(&messages);
    Ok(ResumedSession { thread_id, history })
}

fn prepare_agent_run(
    project: &str,
    task: &str,
    model_override: Option<String>,
    single_turn: bool,
    overrides: ProviderOverrides,
    auto_approve: bool,
    resume: Option<ResumeTarget>,
) -> Result<PreparedRun, String> {
    // Non-interactive runs (`agent run`/`step`) have no plan-review handoff, so
    // plan mode stays a TUI-only startup option.
    let session = prepare_agent_session(
        project,
        model_override,
        overrides,
        auto_approve,
        false,
        true,
    )?;
    let project_root = resolve_project_root(project);
    let (clean_task, injected) = path_refs::resolve_references(task, &project_root);
    let final_task = if injected.is_empty() {
        clean_task
    } else {
        format!("{clean_task}\n\n---\nReferenced file contents:\n\n{injected}")
    };

    // A failed resume is not fatal: report it and run the prompt in a new session.
    let resumed = resume.and_then(|target| {
        match load_resume_history(&agent_dir_for(&project_root), &target) {
            Ok(r) => {
                eprintln!("(resumed session {} with {} message(s))", short_id(&r.thread_id), r.history.len());
                Some(r)
            }
            Err(e) => {
                eprintln!("{e}; starting a new session");
                None
            }
        }
    });

    let mut history = resumed.as_ref().map(|r| r.history.clone()).unwrap_or_default();
    history.push(serde_json::json!({ "role": "user", "content": final_task }));
    let mut body = session.body(serde_json::json!(history.clone()));
    if single_turn {
        body["max_turns"] = serde_json::json!(1);
    }
    // Emit resolved references stderr so the user sees what was injected
    if !injected.is_empty() {
        eprintln!("(resolved @path references)");
    }
    Ok(PreparedRun {
        args: session.args,
        body,
        permission_requests: session.permission_requests,
        mcp_task: session.mcp_task,
        // Non-interactive runs persist into the same per-project store the TUI
        // uses, so a run can later be continued with --resume from either side.
        persist: PersistTarget {
            agent_dir: agent_dir_for(&project_root),
            thread_id: resumed.map(|r| r.thread_id),
            model: session.model,
            history,
        },
    })
}

/// First 8 chars of a thread id, the form the TUI shows in `/threads`.
fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

#[allow(clippy::too_many_arguments)]
async fn run_agent_loop(
    project: &str,
    task: &str,
    model_override: Option<String>,
    single_turn: bool,
    overrides: ProviderOverrides,
    auto_approve: bool,
    resume: Option<ResumeTarget>,
    format: OutputFormat,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let prepared = prepare_agent_run(
        project,
        task,
        model_override,
        single_turn,
        overrides,
        auto_approve,
        resume,
    );
    // A setup failure never reaches the event stream, so a JSON consumer would
    // otherwise get an empty stdout and have to parse the human error off stderr.
    let PreparedRun {
        args,
        body,
        permission_requests,
        mcp_task,
        persist,
    } = match prepared {
        Ok(prepared) => prepared,
        Err(e) => {
            if format.is_json() {
                print_report(RunReport::setup_failure(&e).finish(
                    None,
                    "",
                    started.elapsed().as_millis(),
                    None,
                ));
            }
            return Err(e);
        }
    };

    // Block until active MCP servers connect, so tools (collected once per run)
    // are present on the first turn.
    if let Some(task) = mcp_task {
        match task.await {
            Ok(outcome) => {
                if !outcome.connected.is_empty() {
                    log::info!("MCP: connected {}", outcome.connected.join(", "));
                }
                // Headless has no transcript to note into, so these stay logs.
                for failure in &outcome.failed {
                    log::warn!("MCP: {failure}");
                }
            }
            Err(e) => log::warn!("MCP connect task failed: {e}"),
        }
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    // The report is folded in both formats from the same stream the printer
    // reads, so the JSON envelope can never disagree with the text output.
    let printer = tokio::spawn(async move {
        let mut report = RunReport::default();
        while let Some(ev) = rx.recv().await {
            report.observe(&ev);
            if format.is_json() {
                resolve_permission_silently(ev, &permission_requests).await;
            } else {
                print_event(ev, &permission_requests).await;
            }
        }
        report
    });

    let result = run_orchestration_streamed(&tx, &body, &args).await;
    drop(tx);
    let report = printer.await.unwrap_or_default();

    // Write the turn back so the session stays continuable with --resume.
    let PersistTarget {
        agent_dir,
        thread_id,
        model,
        mut history,
    } = persist;
    let mut session_id = thread_id.clone();
    let mut final_text = None;
    if let Ok(completion) = result.as_ref() {
        final_text = completion_text(completion);
        if let Some(text) = final_text.as_ref() {
            history.push(serde_json::json!({ "role": "assistant", "content": text.clone() }));
        }
        match cli_save_thread(&agent_dir, thread_id.as_deref(), &model, &history, None) {
            Ok(id) => {
                if !format.is_json() {
                    eprintln!(
                        "\x1b[2m[session {} - resume with `jan --resume={}`]\x1b[0m",
                        short_id(&id),
                        short_id(&id)
                    );
                }
                session_id = Some(id);
            }
            Err(e) => eprintln!("(could not save session: {e})"),
        }
    }
    if format.is_json() {
        print_report(report.finish(
            session_id.as_deref().map(short_id).as_deref(),
            &model,
            started.elapsed().as_millis(),
            final_text.as_deref(),
        ));
    }
    result.map(|_| ())
}

/// Write the result envelope to stdout, the only thing `--output-format json`
/// puts there. Pretty-printed: these are read by people at least as often as by
/// programs, and `jq` does not care either way.
fn print_report(report: run_report::RunResult) {
    println!(
        "{}",
        serde_json::to_string_pretty(&report).unwrap_or_default()
    );
}

/// Answer a permission request without printing progress, for the JSON format.
/// Leaving it unanswered would wedge the run: the loop waits on the reply.
/// Every other event is silent -- stdout belongs to the envelope.
async fn resolve_permission_silently(ev: StreamEvent, registry: &PermissionRegistry) {
    if let StreamEvent::PermissionRequest {
        request_id,
        tool_name,
        capability,
        path,
        command,
        ..
    } = ev
    {
        let detail = command
            .map(|c| format!(" ({c})"))
            .or_else(|| path.map(|p| format!(" on {p}")))
            .unwrap_or_default();
        let decision = prompt_permission(tool_name, capability, detail).await;
        if let Some(sender) = registry.lock().await.remove(&request_id) {
            let _ = sender.send(decision);
        }
    }
}

/// Assistant text of a chat-completion response, if any.
fn completion_text(completion: &serde_json::Value) -> Option<String> {
    let text = completion
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")
        .and_then(|v| v.as_str())?;
    (!text.is_empty()).then(|| text.to_string())
}

/// Launch the interactive chat console (bare `jan`). An optional `task`
/// seeds the first turn; otherwise the user types the first message. Shares the
/// engine with `run_agent_loop` via `AgentSession` — only presentation differs.
#[allow(clippy::too_many_arguments)]
pub async fn cli_agent_ui(
    project: &str,
    task: Option<String>,
    model: Option<String>,
    images: Vec<String>,
    overrides: ProviderOverrides,
    auto_approve: bool,
    plan: bool,
    resume: Option<ResumeTarget>,
) -> Result<(), String> {
    let project_root = resolve_project_root(project);
    // A non-interactive invocation with nothing configured has no terminal to
    // show the sign-in notice in, so it fails fast with instructions instead.
    // Bypassed by an explicit --api-key/env key.
    if overrides.api_key.is_none() {
        login::reject_headless_without_provider(Some(&project_root))?;
    }
    // Fresh install with a terminal attached: launch with no model rather than
    // forcing sign-in here. The TUI shows a one-line notice and `/login` (or
    // `jan login`) picks a model up once the user is ready.
    let session = prepare_agent_session(project, model, overrides, auto_approve, plan, false)?;
    // TUI threads persist under the project's .jan/agent dir, separate from the
    // desktop store, so continuing here never mutates desktop threads.
    let agent_dir = agent_dir_for(&project_root);
    tui::run(session, agent_dir, project_root, task, images, resume).await
}

/// Where the TUI persists a project's threads (`<project>/.jan/agent`).
pub fn agent_dir_for(project_root: &std::path::Path) -> PathBuf {
    project_root.join(".jan").join("agent")
}

/// Render one `StreamEvent` for the terminal. Content tokens go to stdout so a
/// run can be piped; progress/diagnostics go to stderr. `PermissionRequest` is
/// resolved via the terminal (deny when non-interactive).
async fn print_event(ev: StreamEvent, registry: &PermissionRegistry) {
    match ev {
        StreamEvent::Token { text } => {
            print!("{text}");
            let _ = std::io::stdout().flush();
        }
        StreamEvent::Step { index, max } => match max {
            0 => eprintln!("\n\x1b[2m[turn {index}]\x1b[0m"),
            m => eprintln!("\n\x1b[2m[turn {index}/{m}]\x1b[0m"),
        },
        // In-progress signal is for the live TUI; the piped log stays quiet
        // until the full call (with args) arrives just below.
        // Headless prints one line per completed call; the in-progress signal
        // and its argument deltas have nothing to render into.
        StreamEvent::ToolCallStarted { .. } | StreamEvent::ToolCallArgsDelta { .. } => {}
        // Headless reports totals once, from the terminal `Done`.
        StreamEvent::TurnUsage { .. } => {}
        StreamEvent::ToolCall { name, args, .. } => eprintln!(
            "\x1b[2m[tool] {}\x1b[0m",
            crate::core::agent::events::describe_tool_call(&name, &args)
        ),
        StreamEvent::ToolResult {
            content, is_error, ..
        } => {
            let tag = if is_error {
                "tool-error"
            } else {
                "tool-result"
            };
            eprintln!("\x1b[2m[{tag}] {content}\x1b[0m");
        }
        StreamEvent::SubagentStart { name, .. } => {
            eprintln!("\x1b[2m[subagent:{name}] started (background)\x1b[0m")
        }
        StreamEvent::SubagentQueued { name, waiting, .. } => {
            eprintln!("\x1b[2m[subagent:{name}] queued ({waiting} waiting)\x1b[0m")
        }
        StreamEvent::SubagentEnd { name, .. } => {
            eprintln!("\x1b[2m[subagent:{name}] finished\x1b[0m")
        }
        StreamEvent::Subagent { name, event, .. } => {
            if let StreamEvent::ToolCall { name: tool, args, .. } = *event {
                eprintln!(
                    "\x1b[2m[subagent:{name}] {}\x1b[0m",
                    crate::core::agent::events::describe_tool_call(&tool, &args)
                );
            }
        }
        StreamEvent::Done { stop_reason, usage } => {
            let tokens = usage.and_then(|u| u.total_tokens).unwrap_or(0);
            eprintln!("\n\x1b[2m[done] stop_reason={stop_reason} tokens={tokens}\x1b[0m");
        }
        StreamEvent::Error { code, message } => {
            eprintln!("\n\x1b[31m[error] {code}: {message}\x1b[0m")
        }
        StreamEvent::AskRequest { .. } => {
            eprintln!("\n\x1b[31m[error] interactive ask requires `jan agent ui`\x1b[0m")
        }
        // The non-interactive CLI doesn't persist session state; a todo update
        // is silently dropped here (mirrors MessagesUpdated below).
        StreamEvent::TodoUpdate { .. } => {}
        // The non-interactive CLI doesn't persist session state, so
        // MessagesUpdated is a no-op here.
        StreamEvent::MessagesUpdated { .. } => {}
        StreamEvent::PermissionRequest {
            request_id,
            tool_name,
            capability,
            path,
            command,
            diff,
            ..
        } => {
            let detail = command
                .map(|c| format!(" ({c})"))
                .or_else(|| path.map(|p| format!(" on {p}")))
                .unwrap_or_default();
            if let Some(diff) = diff {
                eprintln!("\x1b[2m{diff}\x1b[0m");
            }
            let decision = prompt_permission(tool_name, capability, detail).await;
            if let Some(sender) = registry.lock().await.remove(&request_id) {
                let _ = sender.send(decision);
            }
        }
    }
}

/// Ask the terminal to approve a gated tool call. Non-interactive stdin (pipe,
/// CI) auto-denies, matching the headless "safe default" contract; blocking
/// stdin is confined to a blocking thread so the loop task keeps running.
async fn prompt_permission(
    tool_name: String,
    capability: String,
    detail: String,
) -> PermissionDecision {
    use std::io::IsTerminal;
    if !std::io::stdin().is_terminal() {
        eprintln!("\x1b[33m[permission] auto-denied {capability} via '{tool_name}' (non-interactive)\x1b[0m");
        return PermissionDecision::Deny;
    }
    tokio::task::spawn_blocking(move || {
        eprint!("\x1b[33m[permission] allow {capability} via '{tool_name}'{detail}? [y/N] \x1b[0m");
        let _ = std::io::stderr().flush();
        let mut line = String::new();
        if std::io::stdin().read_line(&mut line).is_err() {
            return PermissionDecision::Deny;
        }
        match line.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => PermissionDecision::AllowOnce,
            _ => PermissionDecision::Deny,
        }
    })
    .await
    .unwrap_or(PermissionDecision::Deny)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── resume ─────────────────────────────────────────────────────────────

    #[test]
    fn resume_target_from_flags() {
        assert_eq!(ResumeTarget::from_flags(None, false), None);
        assert_eq!(ResumeTarget::from_flags(None, true), Some(ResumeTarget::Latest));
        assert_eq!(
            ResumeTarget::from_flags(Some(None), false),
            Some(ResumeTarget::Latest)
        );
        // A blank --resume value behaves like a bare --resume.
        assert_eq!(
            ResumeTarget::from_flags(Some(Some("  ".into())), false),
            Some(ResumeTarget::Latest)
        );
        assert_eq!(
            ResumeTarget::from_flags(Some(Some(" 3f7a ".into())), false),
            Some(ResumeTarget::Id("3f7a".into()))
        );
    }

    /// Write a thread with the given id/recency and a single user message.
    fn seed_thread(base: &std::path::Path, id: &str, updated: f64) {
        std::fs::create_dir_all(get_thread_dir(base, id)).unwrap();
        std::fs::write(
            get_thread_metadata_path(base, id),
            serde_json::json!({ "id": id, "title": id, "updated": updated }).to_string(),
        )
        .unwrap();
        std::fs::write(
            get_messages_path(base, id),
            serde_json::json!({
                "role": "user",
                "content": [{ "type": "text", "text": { "value": id, "annotations": [] } }],
            })
            .to_string()
                + "\n",
        )
        .unwrap();
    }

    #[test]
    fn find_resume_thread_latest_and_by_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        assert_eq!(
            find_resume_thread(base, &ResumeTarget::Latest).unwrap_err(),
            NO_SESSION_TO_RESUME
        );

        seed_thread(base, "aaaa1111", 100.0);
        seed_thread(base, "bbbb2222", 300.0);
        seed_thread(base, "bbbb3333", 200.0);

        let latest = find_resume_thread(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(latest["id"], "bbbb2222");

        let by_prefix = find_resume_thread(base, &ResumeTarget::Id("aaaa".into())).unwrap();
        assert_eq!(by_prefix["id"], "aaaa1111");

        assert!(find_resume_thread(base, &ResumeTarget::Id("zz".into()))
            .unwrap_err()
            .contains("no thread matches"));
        assert!(find_resume_thread(base, &ResumeTarget::Id("bbbb".into()))
            .unwrap_err()
            .contains("ambiguous"));
    }

    #[test]
    fn find_resume_thread_skips_corrupted_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        seed_thread(base, "good1111", 100.0);
        let bad = "bad02222";
        std::fs::create_dir_all(get_thread_dir(base, bad)).unwrap();
        std::fs::write(get_thread_metadata_path(base, bad), "{not json").unwrap();

        let latest = find_resume_thread(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(latest["id"], "good1111");
    }

    #[test]
    fn read_messages_lenient_skips_truncated_tail() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        seed_thread(base, "aaaa1111", 100.0);
        let mut raw = std::fs::read_to_string(get_messages_path(base, "aaaa1111")).unwrap();
        raw.push_str("{\"role\":\"assist");
        std::fs::write(get_messages_path(base, "aaaa1111"), raw).unwrap();

        let (messages, skipped) = cli_read_messages_lenient(base, "aaaa1111").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(skipped, 1);
        // The strict reader used elsewhere still rejects the same file.
        assert!(cli_list_messages_in(base, "aaaa1111").is_err());
    }

    #[test]
    fn read_messages_lenient_on_missing_thread_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, skipped) = cli_read_messages_lenient(dir.path(), "nope").unwrap();
        assert!(messages.is_empty());
        assert_eq!(skipped, 0);
    }

    #[test]
    fn resume_cycle_preserves_thread_id_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let history = vec![
            serde_json::json!({ "role": "user", "content": "first" }),
            serde_json::json!({ "role": "assistant", "content": "reply" }),
        ];
        let id = cli_save_thread(base, None, "m", &history, None).unwrap();

        let resumed = load_resume_history(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(resumed.thread_id, id);
        assert_eq!(resumed.history, history);

        // Continue the session and save back: same thread, appended turns.
        let mut extended = resumed.history;
        extended.push(serde_json::json!({ "role": "user", "content": "second" }));
        let same = cli_save_thread(base, Some(&id), "m", &extended, None).unwrap();
        assert_eq!(same, id);
        assert_eq!(list_threads_in(base).unwrap().len(), 1);
        assert_eq!(
            load_resume_history(base, &ResumeTarget::Id(id[..8].to_string()))
                .unwrap()
                .history,
            extended
        );
    }

    fn call(id: &str, name: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "type": "function",
            "function": { "name": name, "arguments": "{\"path\":\"a.txt\"}" },
        })
    }

    #[test]
    fn tool_calls_and_results_survive_a_save_resume_cycle() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let history = vec![
            serde_json::json!({ "role": "user", "content": "do it" }),
            serde_json::json!({ "role": "assistant", "content": "", "tool_calls": [call("c1", "write")] }),
            serde_json::json!({ "role": "tool", "tool_call_id": "c1", "content": "wrote 1 line" }),
            serde_json::json!({ "role": "assistant", "content": "Done." }),
        ];
        let id = cli_save_thread(base, None, "m", &history, None).unwrap();

        let resumed = load_resume_history(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(resumed.thread_id, id);
        assert_eq!(
            resumed.history, history,
            "the model must see the tools it ran, not just its own text"
        );
    }

    #[test]
    fn a_call_whose_result_was_never_saved_gets_one() {
        // A crash between the call and its result leaves the pair broken, and an
        // OpenAI-compatible upstream rejects an unanswered `tool_call_id`.
        let messages = vec![
            serde_json::json!({ "role": "assistant", "content": "", "tool_calls": [call("c1", "write"), call("c2", "read")] }),
            serde_json::json!({ "role": "tool", "tool_call_id": "c1", "content": "ok" }),
            serde_json::json!({ "role": "user", "content": "next" }),
        ];
        let out = rebuild_wire_history(&messages);
        assert_eq!(out.len(), 4);
        assert_eq!(out[2]["role"], "tool");
        assert_eq!(out[2]["tool_call_id"], "c2");
        assert!(
            out[2]["content"].as_str().unwrap().contains("not saved"),
            "the gap is stated, not invented: {}",
            out[2]["content"]
        );
        assert_eq!(out[3]["role"], "user");
    }

    #[test]
    fn an_orphan_tool_message_is_dropped() {
        let messages = vec![
            serde_json::json!({ "role": "tool", "tool_call_id": "gone", "content": "stale" }),
            serde_json::json!({ "role": "user", "content": "hi" }),
        ];
        let out = rebuild_wire_history(&messages);
        assert_eq!(out.len(), 1, "a result with no call would be rejected");
        assert_eq!(out[0]["role"], "user");
    }

    #[test]
    fn rebuild_drops_messages_that_carry_nothing() {
        let messages = vec![
            serde_json::json!({ "role": "assistant", "content": "" }),
            serde_json::json!({ "role": "user", "content": "hi" }),
            serde_json::json!({ "role": "system", "content": "ignored" }),
        ];
        let out = rebuild_wire_history(&messages);
        assert_eq!(out, vec![serde_json::json!({ "role": "user", "content": "hi" })]);
    }

    #[test]
    fn completion_text_extracts_assistant_content() {
        let completion =
            serde_json::json!({ "choices": [{ "message": { "content": "hello" } }] });
        assert_eq!(completion_text(&completion).as_deref(), Some("hello"));
        assert_eq!(completion_text(&serde_json::json!({})), None);
        assert_eq!(
            completion_text(&serde_json::json!({ "choices": [{ "message": { "content": "" } }] })),
            None
        );
    }

    // ── default_thread_title ───────────────────────────────────────────────

    #[test]
    fn default_thread_title_uses_first_user_message() {
        let history = serde_json::json!([
            { "role": "user", "content": "Explain   the  buffer\nlogic" },
            { "role": "assistant", "content": "sure" },
        ]);
        assert_eq!(
            default_thread_title(history.as_array().unwrap()),
            "Explain the buffer logic"
        );
    }

    #[test]
    fn openai_content_text_reads_multimodal_array() {
        let content = serde_json::json!([
            { "type": "text", "text": "describe" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
        ]);
        assert_eq!(openai_content_text(Some(&content)), "describe");
        assert_eq!(openai_content_text(Some(&serde_json::json!("plain"))), "plain");
    }

    #[test]
    fn default_thread_title_uses_multimodal_user_text() {
        let history = serde_json::json!([{
            "role": "user",
            "content": [
                { "type": "text", "text": "look at this" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
            ],
        }]);
        assert_eq!(
            default_thread_title(history.as_array().unwrap()),
            "look at this"
        );
    }

    #[test]
    fn default_thread_title_truncates_and_falls_back() {
        let long = "x".repeat(80);
        let history = serde_json::json!([{ "role": "user", "content": long }]);
        let title = default_thread_title(history.as_array().unwrap());
        assert_eq!(title.chars().count(), 50);
        assert!(title.ends_with('…'));

        let no_user = serde_json::json!([{ "role": "assistant", "content": "hi" }]);
        assert_eq!(default_thread_title(no_user.as_array().unwrap()), "Agent chat");
    }

    // ── cli_save_thread metadata (snapshot bookkeeping) ────────────────────

    #[test]
    fn save_thread_persists_and_preserves_snapshot_metadata() {
        let base = std::env::temp_dir().join(format!(
            "jan_savethread_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let history = serde_json::json!([
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": "hello" },
        ]);
        let meta = serde_json::json!({
            "base_snapshot": "abc",
            "checkpoints": [{ "user_index": 0, "preview": "hi", "sha": "def" }],
        });

        let id = cli_save_thread(
            &base,
            None,
            "m",
            history.as_array().unwrap(),
            Some(meta.clone()),
        )
        .expect("save");

        let raw = std::fs::read_to_string(get_thread_metadata_path(&base, &id)).expect("read");
        let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["metadata"]["base_snapshot"], "abc");
        assert_eq!(stored["metadata"]["checkpoints"][0]["sha"], "def");

        // A follow-up save with no metadata must preserve the prior snapshot block.
        cli_save_thread(&base, Some(&id), "m", history.as_array().unwrap(), None).expect("resave");
        let raw = std::fs::read_to_string(get_thread_metadata_path(&base, &id)).expect("read2");
        let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["metadata"]["base_snapshot"], "abc");

        let _ = std::fs::remove_dir_all(&base);
    }

    // ── cli_get_data_folder returns a path ────────────────────────────────

    #[test]
    fn cli_get_data_folder_returns_non_empty_path() {
        let p = cli_get_data_folder();
        assert!(!p.as_os_str().is_empty());
    }

    // ── prepare_agent_session model resolution ────────────────────────────

    /// A project's `agent.toml` naming a model must not paper over "nothing can
    /// actually serve it": with no provider configured (this repo's own
    /// agent.toml pins `tokamak-1-preview`, but a fresh `~/.jan` has no
    /// credentials for it), the TUI path must still come back with an empty
    /// model so its sign-in notice fires instead of a first-message failure.
    #[test]
    fn tui_session_ignores_a_project_model_with_no_usable_provider() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(
                dir.path().join("agent.toml"),
                "[agent]\nmodel = \"tokamak-1-preview\"\n",
            )
            .unwrap();

            let session = prepare_agent_session(
                dir.path().to_str().unwrap(),
                None,
                ProviderOverrides::default(),
                false,
                false,
                false,
            )
            .expect("TUI session prep must not fail with nothing configured");
            assert_eq!(session.model, "");
        });
    }

    /// The same project config, once a provider is actually usable, must be
    /// trusted again.
    #[test]
    fn tui_session_honors_a_project_model_once_a_provider_is_usable() {
        crate::core::agent::global_config::with_temp_home(|_| {
            crate::core::agent::global_config::set_provider(
                "tokamak",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("tk".into()),
                    base_url: Some(crate::core::cli::tokamak::BASE_URL.into()),
                    models: Some(vec!["tokamak-1-preview".into()]),
                    api_type: None,
                },
            )
            .unwrap();
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(
                dir.path().join("agent.toml"),
                "[agent]\nmodel = \"tokamak-1-preview\"\n",
            )
            .unwrap();

            let session = prepare_agent_session(
                dir.path().to_str().unwrap(),
                None,
                ProviderOverrides::default(),
                false,
                false,
                false,
            )
            .expect("session prep");
            assert_eq!(session.model, "tokamak-1-preview");
        });
    }
}
