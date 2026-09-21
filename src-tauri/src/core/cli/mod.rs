//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.

mod agent_status;
pub mod auth;
pub mod brand;
pub mod browser;
pub mod device_auth;
pub mod journal;
pub mod login;
pub mod mcp;
mod model_capabilities;
pub mod model_catalog;
mod path_refs;
pub mod run_report;
pub mod providers;
mod secret_input;
pub mod stream_input;
pub mod telemetry;
pub mod terminal_setup;
pub mod tokamak;
mod tui;
pub mod updater;
pub mod worktree;

use std::path::PathBuf;
use std::sync::Arc;

use crate::core::app::commands::resolve_jan_data_folder;
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

/// A resume request: which thread, and whether to branch it instead of
/// continuing it. `fork` writes the resolved thread's prefix into a fresh id and
/// opens that, so the source stays on disk exactly as it was.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResumeRequest {
    pub target: ResumeTarget,
    pub fork: bool,
}

impl ResumeRequest {
    /// Continue the resolved thread in place.
    pub fn resume(target: ResumeTarget) -> Self {
        Self {
            target,
            fork: false,
        }
    }

    /// Branch the resolved thread into a new one.
    pub fn fork(target: ResumeTarget) -> Self {
        Self { target, fork: true }
    }

    /// Build a request from the CLI flags. `--fork-session` alone means "branch
    /// the most recent session", so it implies a target of its own.
    pub fn from_flags(
        resume: Option<Option<String>>,
        continue_session: bool,
        fork: bool,
    ) -> Option<Self> {
        let target = ResumeTarget::from_flags(resume, continue_session)
            .or_else(|| fork.then_some(ResumeTarget::Latest))?;
        Some(Self { target, fork })
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

/// Resolve a resume request to the thread the session should open: the matched
/// thread, or a fresh fork of it that leaves the match untouched.
pub fn resolve_resume(
    base: &std::path::Path,
    request: &ResumeRequest,
) -> Result<serde_json::Value, String> {
    let thread = find_resume_thread(base, &request.target)?;
    if !request.fork {
        return Ok(thread);
    }
    let source = thread
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "saved thread has no id".to_string())?;
    let id = fork_thread(base, source, None)?;
    cli_get_thread_in(base, &id)
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

/// Get thread metadata by ID from a given store (`<base>/threads/<id>`).
pub fn cli_get_thread_in(
    base: &std::path::Path,
    thread_id: &str,
) -> Result<serde_json::Value, String> {
    let path = get_thread_metadata_path(base, thread_id);
    if !path.exists() {
        return Err(format!("Thread '{thread_id}' not found"));
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

/// Get thread metadata by ID from the desktop store.
pub fn cli_get_thread(thread_id: &str) -> Result<serde_json::Value, String> {
    cli_get_thread_in(&resolve_jan_data_folder(), thread_id)
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
pub(crate) const MISSING_TOOL_RESULT: &str =
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

// ── Thread forking ─────────────────────────────────────────────────────────

/// Key in a thread's `metadata` naming the thread it was branched from. A
/// free-form metadata entry rather than a field on the thread record, so the
/// desktop reader and the mobile store need no migration and an existing store
/// (where every thread is a root) renders as today's flat list.
pub const FORKED_FROM_KEY: &str = "forked_from";

/// True for a `user` message the user actually authored. Hidden reminders ride
/// in on the `user` role but are not turns: a rewind target, a fork point, a
/// recall entry or a checkpoint key built from one would be a row the user never
/// typed, and would shift every later index out of step with the display
/// journal, which holds no reminder at all.
pub(crate) fn is_user_turn(m: &serde_json::Value) -> bool {
    m.get("role").and_then(|v| v.as_str()) == Some("user")
        && !crate::core::agent::reminder::is_reminder_only(
            m.get("content").unwrap_or(&serde_json::Value::Null),
        )
}

/// Index of the `target`-th (0-based) user turn in a wire conversation, i.e.
/// where a rewind or fork to that turn cuts. `None` when there are fewer turns.
pub(crate) fn user_turn_index(history: &[serde_json::Value], target: usize) -> Option<usize> {
    history
        .iter()
        .enumerate()
        .filter(|(_, m)| is_user_turn(m))
        .nth(target)
        .map(|(i, _)| i)
}

/// How many user turns a wire conversation holds.
pub(crate) fn user_turn_count(history: &[serde_json::Value]) -> usize {
    history.iter().filter(|m| is_user_turn(m)).count()
}

/// The thread a fork came from, when this one is a fork.
pub fn forked_parent(thread: &serde_json::Value) -> Option<&str> {
    thread
        .get("metadata")?
        .get(FORKED_FROM_KEY)?
        .get("thread_id")?
        .as_str()
}

/// Metadata for a fork: the source's, minus the bookkeeping that describes turns
/// the branch does not have, plus the parent pointer. Forking a fork overwrites
/// the pointer, so it always names the immediate parent.
fn fork_metadata(
    source_metadata: Option<&serde_json::Value>,
    source_id: &str,
    user_turn: usize,
) -> serde_json::Value {
    let mut meta = source_metadata
        .and_then(|m| m.as_object().cloned())
        .unwrap_or_default();
    if let Some(checkpoints) = meta.get_mut("checkpoints").and_then(|v| v.as_array_mut()) {
        checkpoints.retain(|c| {
            c.get("user_index")
                .and_then(serde_json::Value::as_u64)
                .is_some_and(|i| (i as usize) < user_turn)
        });
    }
    // Two conversations must not edit one checkout: the branch records no
    // worktree, so opening it with worktrees on gets it one of its own, based on
    // where the source left off (see `resolve_workspace`).
    meta.remove(worktree::WORKTREE_KEY);
    meta.insert(
        FORKED_FROM_KEY.to_string(),
        serde_json::json!({ "thread_id": source_id, "user_turn": user_turn }),
    );
    serde_json::Value::Object(meta)
}

/// Branch a saved thread into a new one holding its prefix up to `at_user_turn`
/// (that turn and everything after it are left behind, the same cut a rewind
/// makes), or the whole conversation when `None`. Both the wire history and the
/// display journal are carried, so the fork replays with its tool rows.
///
/// The source is only read, never written: that is the whole point of a fork
/// over a rewind.
///
/// A fork never inherits the source's worktree (see `fork_metadata`): the two
/// conversations diverge from here, and one checkout cannot hold both.
pub fn fork_thread(
    base: &std::path::Path,
    source_id: &str,
    at_user_turn: Option<usize>,
) -> Result<String, String> {
    let source = std::fs::read_to_string(get_thread_metadata_path(base, source_id))
        .map_err(|e| format!("thread '{source_id}' not found: {e}"))?;
    let source: serde_json::Value = serde_json::from_str(&source).map_err(|e| e.to_string())?;

    let (messages, _) = cli_read_messages_lenient(base, source_id)?;
    // Cut the rebuilt conversation, not the raw records: `rebuild_wire_history`
    // is what enforces tool_call/tool_result pairing, and cutting immediately
    // before a user turn leaves that pairing intact because it closes every open
    // call at each turn boundary.
    let mut history = rebuild_wire_history(&messages);
    let mut journal = journal::read_journal(&journal::journal_path(base, source_id));
    if let Some(turn) = at_user_turn {
        let cut = user_turn_index(&history, turn)
            .ok_or_else(|| format!("no message #{} to fork at", turn + 1))?;
        history.truncate(cut);
        // The journal is keyed by its own user entries, not by history indices:
        // it holds rows (tool calls, reasoning) history never had.
        journal.truncate(journal::truncate_at_user(&journal, turn));
    }
    if history.is_empty() {
        return Err("nothing before that message to fork".to_string());
    }

    let model = source
        .get("model")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    // Cutting at user turn N keeps exactly N turns, so the recorded turn is the
    // same number whether the cut was asked for or the whole thread was taken.
    let metadata = fork_metadata(source.get("metadata"), source_id, user_turn_count(&history));
    let id = cli_save_thread(base, None, model, &history, Some(metadata))?;
    journal::write_journal(&journal::journal_path(base, &id), &journal)?;
    Ok(id)
}

/// One row of the fork forest: a thread plus how deep it sits under its root.
pub struct ThreadNode {
    pub thread: serde_json::Value,
    pub depth: usize,
    /// Last among its siblings, so a renderer can pick the corner glyph.
    pub last: bool,
}

fn push_children(stack: &mut Vec<(usize, usize, bool)>, kids: &[usize], depth: usize) {
    // Reversed, so popping yields the children in order.
    for (n, &child) in kids.iter().enumerate().rev() {
        stack.push((child, depth, n + 1 == kids.len()));
    }
}

/// Arrange saved threads into the forest their `forked_from` pointers describe,
/// depth-first, siblings most-recent-first. A thread whose parent is gone is a
/// root, so deleting a session never hides the forks taken from it.
pub fn thread_forest(mut threads: Vec<serde_json::Value>) -> Vec<ThreadNode> {
    use std::collections::HashMap;

    sort_threads_recent(&mut threads);
    let index_of: HashMap<&str, usize> = threads
        .iter()
        .enumerate()
        .filter_map(|(i, t)| Some((t.get("id")?.as_str()?, i)))
        .collect();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); threads.len()];
    let mut roots: Vec<usize> = Vec::new();
    for (i, t) in threads.iter().enumerate() {
        match forked_parent(t)
            .and_then(|p| index_of.get(p))
            .copied()
            .filter(|&p| p != i)
        {
            Some(parent) => children[parent].push(i),
            None => roots.push(i),
        }
    }

    let mut out = Vec::new();
    let mut seen = vec![false; threads.len()];
    let mut stack: Vec<(usize, usize, bool)> = Vec::new();
    push_children(&mut stack, &roots, 0);
    while let Some((i, depth, last)) = stack.pop() {
        if std::mem::replace(&mut seen[i], true) {
            continue;
        }
        push_children(&mut stack, &children[i], depth + 1);
        out.push(ThreadNode {
            thread: threads[i].clone(),
            depth,
            last,
        });
    }
    // A cycle of forks is reachable from no root and would otherwise vanish from
    // the list; show those threads flat rather than lose a session.
    for (i, t) in threads.iter().enumerate() {
        if !seen[i] {
            out.push(ThreadNode {
                thread: t.clone(),
                depth: 0,
                last: true,
            });
        }
    }
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

/// If `text` is a machine-generated skill or plugin-command invocation message
/// (the `[IMPORTANT: You have invoked the "<name>" <kind> - follow its
/// instructions...]` wrapper produced by `skills::build_invocation_message` and
/// `commands::build_message`), return the compact transcript label
/// (`[skill:<name>]` or `[command:<name>]`). `None` for any other text, so a
/// user who types that prefix verbatim still renders normally.
pub fn invocation_label(text: &str) -> Option<String> {
    const PREFIX: &str = "[IMPORTANT: You have invoked the \"";
    let rest = text.strip_prefix(PREFIX)?;
    let (name, rest) = rest.split_once('"')?;
    if name.is_empty() {
        return None;
    }
    let kind = if rest.starts_with(" skill - follow its instructions") {
        "skill"
    } else if rest.starts_with(" command - follow its instructions") {
        "command"
    } else {
        return None;
    };
    Some(format!("[{kind}:{name}]"))
}

/// Fallback thread title: the first user message, whitespace-collapsed and
/// truncated. Used only when no summarized title exists yet.
fn default_thread_title(history: &[serde_json::Value]) -> String {
    let first_user = history
        .iter()
        .find(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
        .map(|m| openai_content_text(m.get("content")))
        .unwrap_or_default();
    if let Some(label) = invocation_label(&first_user) {
        return label;
    }
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

// ── Agent operations ───────────────────────────────────────────────────────

use crate::core::agent::events::StreamEvent;
use crate::core::agent::project::{
    ensure_project, load_agent_config, permissions_from, set_model_in_agent_toml,
};
use crate::core::agent::r#loop::{
    run_orchestration_steered, run_orchestration_streamed, OrchestrationArgs, PermissionRegistry,
    SteeringRequest,
};
use tauri_plugin_agent_tools::workspace;
use crate::core::cli::providers::{load_provider_configs, ProviderOverrides};
use crate::core::cli::run_report::{ndjson_line, OutputFormat, PermissionDecisionRecord, RunReport};
use crate::core::cli::stream_input::{
    parse_input_line, InputErrorRecord, InputFormat, InputMessage, StreamInput,
};
use crate::core::mcp::models::McpSettings;
use std::collections::HashMap;
use std::io::Write as _;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use tokio::sync::{mpsc, Mutex};

/// Token-spend ceiling for one agent run when `agent.toml [budget].max_tokens`
/// is unset. `0` disables the ceiling entirely. Counted marginally by
/// `SessionBudget`, so it tracks real new spend, not the context replayed on
/// every turn.
///
/// Advisory, not a bound: crossing it compacts the history and records a note,
/// then the run carries on (see `body_session_budget`). `--max-turns` and
/// cancellation are what actually stop a runaway loop.
const DEFAULT_MAX_SESSION_TOKENS: u64 = 128_000;

/// Where the session token ceiling in effect came from, so `agent status` can
/// say which source won.
///
/// `agent status` takes no budget flag and so always passes `None`, making
/// `"flag"` unreachable from the binary today. It is kept because the argument
/// mirrors `resolve_session_budget` below: a status surface that does accept
/// the flag (or any caller reporting an in-flight run's ceiling) would
/// otherwise report `agent.toml` for a value the flag had overridden.
fn session_budget_source(flag: Option<u64>, configured: Option<u64>) -> &'static str {
    match (flag, configured) {
        (Some(_), _) => "flag",
        (None, Some(_)) => "agent.toml",
        (None, None) => "default",
    }
}

/// Session token ceiling for one run. Precedence is the per-invocation
/// `--max-session-tokens` flag, then `agent.toml [budget].max_tokens`, then
/// `DEFAULT_MAX_SESSION_TOKENS` - the same flag/config/default shape the
/// sandbox setting resolves with. `0` from either source means unbounded and is
/// carried through as-is (see `body_session_budget`).
fn resolve_session_budget(flag: Option<u64>, configured: Option<u64>) -> u64 {
    flag.or(configured).unwrap_or(DEFAULT_MAX_SESSION_TOKENS)
}

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

    // Resolved once, and reported for every registered composer: "which of my
    // contributors is writing into the cached prefix" is one command, not an
    // investigation. An unusable `[prompt]` policy (an allowlist naming
    // something that varies, or a typo) fails here with the same message
    // composition would give.
    let prompt_policy = crate::core::agent::project::prompt_policy(&project_root);
    let prompt_components: Vec<serde_json::Value> = prompt_policy
        .placements()?
        .into_iter()
        .map(|(composer, placement)| {
            serde_json::json!({
                "id": composer.id(),
                "placement": placement.as_str(),
                "constant": composer.constant(),
                "source": composer.source().as_str(),
                "what": composer.what(),
            })
        })
        .collect();

    // Only providers this build can reach: local-engine entries inherited from
    // the desktop store have no upstream here (see `is_cli_reachable`).
    let mut providers: Vec<serde_json::Value> = provider_configs
        .values()
        .filter(|c| crate::core::cli::providers::is_cli_reachable(c))
        .map(|c| {
            serde_json::json!({
                "provider": c.provider,
                "base_url": c.base_url,
                "has_api_key": crate::core::cli::providers::has_credential(c),
                "models": c.models.len(),
            })
        })
        .collect();
    providers.sort_by(|a, b| a["provider"].as_str().cmp(&b["provider"].as_str()));

    let hooks: Vec<serde_json::Value> =
        crate::core::agent::hooks_config::resolve_hooks(&project_root)
            .all()
            .iter()
            .map(|hook| {
                serde_json::json!({
                    "event": hook.event.as_str(),
                    "matcher": hook.matcher,
                    "command": hook.command,
                    "timeout_secs": hook.timeout_secs,
                    "source": hook.source.to_string_lossy(),
                })
            })
            .collect();
    let plugin_tools: Vec<serde_json::Value> =
        crate::core::agent::hooks_config::resolve_plugin_tools(&project_root)
            .all()
            .iter()
            .map(|tool| {
                serde_json::json!({
                    "name": tool.qualified_name,
                    "plugin": tool.plugin,
                    "description": tool.description,
                    "command": tool.command,
                    "source": tool.source.to_string_lossy(),
                })
            })
            .collect();

    Ok(serde_json::json!({
        "project": project_root.to_string_lossy(),
        "data_folder": resolve_jan_data_folder().to_string_lossy(),
        "model": cfg.agent.model,
        // The effective ceiling with the config files resolved. A
        // `--max-session-tokens` flag is per-invocation and so, like
        // `--sandbox` below, cannot be reflected in a config dump.
        "max_session_tokens": resolve_session_budget(None, cfg.budget.max_tokens),
        "max_session_tokens_source": session_budget_source(None, cfg.budget.max_tokens),
        "tools": {
            "default": cfg.tools.default,
            "allow": cfg.tools.allow,
            "deny": cfg.tools.deny,
            "allow_write": cfg.tools.allow_write,
            "allow_network": cfg.tools.allow_network,
            "allow_home_read": cfg.tools.allow_home_read,
            "sandbox": cfg.tools.sandbox,
        },
        // What `bash` will actually do, with the config files already resolved
        // (the `--sandbox` flag is per-invocation and so cannot be reported
        // here). `backend` names the confinement that would be used and is
        // `none` where none can be established -- with `enabled` true that
        // combination is what withholds `bash` entirely.
        "sandbox": {
            "enabled": crate::core::agent::r#loop::effective_sandbox(&project_root),
            "backend": tauri_plugin_agent_tools::tools::jail::backend().as_str(),
        },
        // The resolved hook set in merge order, each with the file it came
        // from: a hook that surprises the user is worth nothing to debug
        // unless they can tell which of the three layers installed it.
        "hooks": hooks,
        "plugin_tools": plugin_tools,
        // Who may write above the cache line, and where each registered
        // contributor actually lands: the code-level placement, narrowed by
        // `[prompt].prefix_allow`.
        "prompt": {
            "default": prompt_policy.default_placement().as_str(),
            "prefix_allow": prompt_policy.prefix_allow(),
            "components": prompt_components,
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
            clear_api_key: false,
            base_url,
            models,
            api_type,
            ..Default::default()
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

/// List plugins installed for a project.
pub fn cli_plugin_list(project: &str) -> Vec<crate::core::agent::plugins::InstalledPlugin> {
    crate::core::agent::plugins::installed(&resolve_project_root(project))
}

/// Install git or marketplace plugin(s) for a project.
///
/// This is the interactive CLI path: a multi-plugin collection prompts the user
/// to choose which plugins to install (it has an owning terminal, unlike the
/// TUI render loop which reads stdin itself and so uses the non-interactive
/// listing-error behavior). Returns every plugin actually installed.
pub async fn cli_plugin_install(
    project: &str,
    spec: &str,
) -> Result<Vec<crate::core::agent::plugins::InstalledPlugin>, String> {
    crate::core::agent::plugins::install_interactive(&resolve_project_root(project), spec).await
}

/// Remove a plugin from a project.
pub fn cli_plugin_remove(project: &str, name: &str) -> Result<(), String> {
    crate::core::agent::plugins::remove(&resolve_project_root(project), name)
}

/// Search the configured plugin marketplace for a project.
pub async fn cli_plugin_search(
    project: &str,
    query: &str,
) -> Result<Vec<crate::core::agent::plugins::MarketEntry>, String> {
    crate::core::agent::plugins::search(&resolve_project_root(project), query).await
}

/// Autonomous run: as many turns as the task needs, bounded by a `max_turns`
/// cap when one is set, and otherwise only by cancellation. The session token
/// budget is advisory and does not stop the run (see `body_session_budget`).
#[allow(clippy::too_many_arguments)]
pub async fn cli_agent_run(
    project: &str,
    task: &str,
    model: Option<String>,
    overrides: ProviderOverrides,
    flags: SessionFlags,
    resume: Option<ResumeRequest>,
    format: OutputFormat,
    input_format: InputFormat,
) -> Result<(), String> {
    run_agent_loop(
        project,
        task,
        model,
        false,
        overrides,
        flags,
        resume,
        format,
        input_format,
    )
    .await
}

/// Single-turn run for debugging: the turn cap is pinned to 1 here and
/// outranks any `--max-turns`.
pub async fn cli_agent_step(
    project: &str,
    task: &str,
    model: Option<String>,
    overrides: ProviderOverrides,
    flags: SessionFlags,
) -> Result<(), String> {
    run_agent_loop(
        project,
        task,
        model,
        true,
        overrides,
        flags,
        None,
        OutputFormat::Text,
        InputFormat::Text,
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
    sandbox: Option<bool>,
) -> OrchestrationArgs {
    OrchestrationArgs {
        client: crate::core::agent::upstream::agent_http_client(),
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
        // Key the persistent bash `/tmp` scratch to this session. Generated per
        // run/session: a one-shot CLI wipes it after its single run; the TUI
        // reuses `args` across turns and wipes it when the interactive session
        // ends.
        session_id: Some(uuid::Uuid::new_v4().to_string()),
        // Run-owned here, so a headless run parks on its watchers: nobody is
        // there to talk to meanwhile. The TUI installs its session set itself.
        monitors: None,
        // `--sandbox` only when passed; unset falls through to the project's
        // `[tools].sandbox` and then the user's global `sandbox`.
        sandbox,
        // Filled in by `prepare_agent_session`, which is where the route's
        // context window is resolved. The desktop paths leave it `None`: their
        // window lives in the local engine's preset, not in a catalog this
        // builder can read.
        compaction: None,
    }
}

/// Everything needed to drive one agent run: the engine handle, request body,
/// and the shared permission registry. Built once and consumed by either the
/// plain CLI printer or the TUI renderer.
pub(crate) struct PreparedRun {
    pub args: OrchestrationArgs,
    pub body: serde_json::Value,
    /// The provider serving this run's model, for the per-provider price
    /// lookup the JSON envelope's `estimated_cost_usd` goes through.
    pub provider: Option<String>,
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
    /// The checkout this run worked in, recorded on the thread so a later
    /// `--resume` reattaches to it.
    workspace: Option<worktree::Worktree>,
}

/// Per-run limits resolved from agent.toml. Grouped rather than passed as a
/// run of bare numbers, which would be trivial to transpose at a call site.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SessionLimits {
    /// Context window limit in tokens for the model. Resolution order is the
    /// configured `[agent].context_window` override, then the built-in model
    /// catalog, then a 128K fallback. Used to display `ctx N/K` in the header
    /// and trigger compaction.
    pub context_window: u64,
    /// Where `context_window` came from: configured override, catalog, or fallback.
    pub context_window_source: crate::core::cli::model_capabilities::ContextWindowSource,
    /// Share of `context_window` a prompt may fill before a run compacts ahead
    /// of dispatching. Resolved from the route's own `compaction_ratio`, then
    /// `[agent].compaction_ratio`, then the default.
    pub compaction_ratio: f64,
    /// An explicit `[agent].compaction_reserve_tokens`. `Some` pins absolute
    /// headroom and wins over the ratio; `None` - the default - lets the ratio
    /// set the trigger, so it scales with the window.
    pub compaction_reserve_tokens: Option<u64>,
    /// Per-request output cap forwarded to the model as OpenAI `max_tokens`.
    /// `None` omits the field (model default).
    pub max_tokens: Option<u64>,
    /// `--max-session-tokens`, else `[budget].max_tokens`, else the default:
    /// marginal token-spend ceiling for one run. `0` is no ceiling.
    ///
    /// Advisory: crossing it triggers compaction and a recorded note, it does
    /// not end the run. `max_turns` is the hard bound.
    pub max_session_tokens: u64,
    /// `--max-turns`: hard cap on agentic turns for this run, and the only
    /// setting that terminates one. `None` omits the field from the request
    /// body, which the engine reads as unbounded; `0` means unbounded too (see
    /// `body_turn_cap`).
    pub max_turns: Option<u64>,
}

/// Resolved engine handle for a chat session: the args are built once and the
/// request body is assembled per turn (the TUI reuses this across many turns;
/// the plain CLI builds a single body). `model`/`limits` seed each body.
pub(crate) struct AgentSession {
    pub args: OrchestrationArgs,
    pub permission_requests: PermissionRegistry,
    pub model: String,
    /// The provider that will serve `model`, when one offers it. Carried so the
    /// per-provider cached window and prices are read under the provider that
    /// is actually billed, rather than whichever one the catalog finds first.
    pub provider: Option<String>,
    /// Fast model for the `smol` role (goal evaluation). Falls back to `model`.
    pub smol_model: String,
    pub limits: SessionLimits,
    /// Whether the TUI expands `<think>` reasoning blocks (default false).
    pub show_reasoning: bool,
    /// Whether the TUI streams reasoning into the live tail while it folds
    /// (`stream_reasoning` in `~/.jan/config.toml`, default true). Independent
    /// of `show_reasoning`, which unfolds it for good.
    pub stream_reasoning: bool,
    /// Whether to resend a prior assistant turn's reasoning to the model
    /// (default true). False drops `reasoning_content` from outgoing assistant
    /// messages; the display journal still keeps reasoning for a resume.
    pub send_reasoning: bool,
    /// Shared MCP connection map (same Arc held by `args`), so the TUI can
    /// connect/disconnect servers live via `/mcp` and later turns pick them up.
    pub mcp_servers: crate::core::state::SharedMcpServers,
    /// Background connect of `active` MCP servers, awaited before the first turn.
    /// `None` when no server is active. Resolves to the connected server names.
    pub mcp_task: Option<tokio::task::JoinHandle<mcp::ConnectOutcome>>,
    /// The git worktree this session's tools work in, when it has one. `None`
    /// is the default: the agent edits the project directory itself.
    pub workspace: Option<worktree::Worktree>,
    /// Why a requested worktree could not be set up, for the surface to report.
    /// `Some` only when one was asked for and the session fell back to the
    /// project directory.
    pub workspace_note: Option<String>,
}

/// The request body for one turn, as a free function of the parts that shape
/// it. Split out of [`AgentSession::body`] so the wire contract is testable
/// without standing up an orchestration handle (MCP maps, HTTP client, tool
/// permissions), none of which this assembly reads.
fn request_body(
    model: &str,
    limits: &SessionLimits,
    send_reasoning: bool,
    messages: serde_json::Value,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_session_tokens": limits.max_session_tokens,
        "stream": true,
    });
    // Forward the per-request output cap only when configured; it flows to
    // the upstream via `copy_optional_chat_params`.
    if let Some(max) = limits.max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }
    // Single place a turn cap enters the body: `agent step` pins 1 the same
    // way `--max-turns` pins N, so both go through `limits`. Absent rather
    // than 0 when unset, so the engine's own default applies.
    if let Some(turns) = limits.max_turns {
        body["max_turns"] = serde_json::json!(turns);
    }
    // Reasoning resend policy: the request-level flag the loop reads to
    // decide whether prior assistant `reasoning_content` goes back out.
    body["send_reasoning"] = serde_json::json!(send_reasoning);
    body
}

impl AgentSession {
    /// Build a streaming request body for the given conversation history.
    pub(crate) fn body(&self, messages: serde_json::Value) -> serde_json::Value {
        request_body(&self.model, &self.limits, self.send_reasoning, messages)
    }
}

/// The per-invocation switches a session starts with.
///
/// A struct rather than a run of positional `bool`s: `(.., false, false, true)`
/// at a call site names none of them, and the compiler cannot catch two of them
/// being swapped.
#[derive(Debug, Clone, Copy, Default)]
pub struct SessionFlags {
    /// Skip the permission prompt for writes, shell, and MCP calls.
    pub auto_approve: bool,
    /// Start in read-only plan mode.
    pub plan: bool,
    /// Fail when no model resolves instead of launching with an empty one. The
    /// TUI leaves this off so `/login` can fill the model in later.
    pub require_model: bool,
    /// `--sandbox`: run `bash` under OS confinement. `None` (not passed) defers
    /// to `[tools].sandbox`, then the global `sandbox`, then the CLI default of
    /// off.
    pub sandbox: Option<bool>,
    /// `--worktree`: work in a dedicated git checkout. `None` (not passed)
    /// defers to `[agent].worktree`, then the global `worktree`, then the CLI
    /// default of off.
    pub worktree: Option<bool>,
    /// `--max-turns`: hard cap on agentic turns, and the only setting that
    /// ends a run. `None` (not passed) leaves the run unbounded by turns; `0`
    /// is unbounded as well.
    pub max_turns: Option<u64>,
    /// `--max-session-tokens`: advisory session token ceiling, outranking
    /// `[budget].max_tokens`. `None` (not passed) defers to that, then to
    /// `DEFAULT_MAX_SESSION_TOKENS`.
    pub max_session_tokens: Option<u64>,
}

/// The desktop app's currently-selected model, adopted only when signed in to
/// Tokamak. Split out from the resolution chain so the rule is testable without
/// a `settings.json` on disk; see the note at the call site for why the sign-in
/// gates it.
fn inherit_desktop_model(
    signed_in: bool,
    selection: crate::core::cli::providers::DesktopSelection,
) -> Option<String> {
    signed_in.then_some(selection.model).flatten()
}

/// The newest workspace snapshot a thread recorded, which is where a fork of it
/// should start its own checkout: the files as that conversation last left them,
/// rather than a `HEAD` its whole transcript predates.
fn latest_snapshot(thread: Option<&serde_json::Value>) -> Option<String> {
    let metadata = thread?.get("metadata")?;
    metadata
        .get("checkpoints")
        .and_then(|c| c.as_array())
        .and_then(|c| c.last())
        .and_then(|c| c.get("sha"))
        .or_else(|| metadata.get("base_snapshot"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// The metadata to save a thread with so it names the checkout the run worked
/// in, merged into whatever that thread already recorded rather than replacing
/// it. `None` when there is no worktree, which is `cli_save_thread`'s "keep the
/// existing metadata" case.
///
/// Without this a resumed session branches a *fresh* worktree and the model
/// reads a pristine tree, silently losing everything the run it is continuing
/// did in there.
fn worktree_metadata(
    agent_dir: &std::path::Path,
    thread_id: Option<&str>,
    workspace: Option<&worktree::Worktree>,
) -> Option<serde_json::Value> {
    let workspace = workspace?;
    let mut meta = thread_id
        .and_then(|id| cli_get_thread_in(agent_dir, id).ok())
        .and_then(|thread| thread.get("metadata")?.as_object().cloned())
        .unwrap_or_default();
    meta.insert(
        worktree::WORKTREE_KEY.to_string(),
        worktree::to_metadata(workspace),
    );
    Some(serde_json::Value::Object(meta))
}

/// The commit a fork's checkout starts from.
///
/// The newest snapshot the source thread recorded is the best answer: it is the
/// tree that conversation last left. A headless run takes no snapshots (they are
/// the TUI's per-turn checkpoints), so fall back to capturing the source's
/// worktree as it stands -- otherwise the branch opens on a pristine `HEAD`
/// while the transcript it inherited describes work that is not in it, and the
/// model's first act is to re-read files that disagree with what it just said.
///
/// `None` leaves the choice to `HEAD`, which is right when the source never had
/// a checkout of its own.
fn fork_base(source: Option<&serde_json::Value>) -> Option<String> {
    use crate::core::agent::git;

    if let Some(sha) = latest_snapshot(source) {
        return Some(sha);
    }
    let source = source?;
    let workspace = worktree::from_metadata(source.get("metadata"))?;
    if !workspace.path.is_dir() {
        return None;
    }
    // Keyed per source thread and cleaned up: this index is a one-shot, unlike
    // the per-thread one a session keeps warm across its turns.
    let key = format!("fork-base-{}", source.get("id")?.as_str()?);
    let changed: Vec<PathBuf> = git::changed_paths(&workspace.path)
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let sha = git::snapshot(&workspace.path, None, "jan agent fork base", &key, &changed).ok();
    git::cleanup_snapshot_index(&key);
    sha
}

/// Decide the checkout this session's tools work in.
///
/// A plain resume reattaches to the worktree its thread recorded. A fork is a
/// *different* thread, so it branches its own from where the source left off --
/// two conversations editing one checkout is the thing a worktree exists to
/// prevent. A session that cannot get the worktree it asked for runs in the
/// project directory and says why, because that fallback is exactly how every
/// session behaved before worktrees existed.
fn resolve_workspace(
    project_root: &std::path::Path,
    flag: Option<bool>,
    resume: Option<&ResumeRequest>,
) -> (Option<worktree::Worktree>, Option<String>) {
    let configured = crate::core::agent::project::run_settings(project_root).worktree;
    if !worktree::resolve_enabled(flag, configured) {
        return (None, None);
    }
    let forking = resume.is_some_and(|request| request.fork);
    let source = resume
        .and_then(|request| find_resume_thread(&agent_dir_for(project_root), &request.target).ok());
    let recorded = if forking {
        None
    } else {
        worktree::from_metadata(source.as_ref().and_then(|t| t.get("metadata")))
    };
    let base = forking.then(|| fork_base(source.as_ref())).flatten();
    match worktree::for_session(project_root, recorded.as_ref(), base.as_deref()) {
        // A different path than the one recorded means the checkout was gone and
        // a fresh one was branched from HEAD: nothing was committed there, so the
        // resumed conversation now describes edits this tree does not have.
        Ok(workspace) => {
            let note = recorded
                .filter(|old| old.path != workspace.path)
                .map(|old| {
                    format!(
                        "the checkout this thread recorded ({}) is gone; starting fresh from HEAD",
                        old.path.display()
                    )
                });
            (Some(workspace), note)
        }
        Err(e) => (None, Some(format!("no worktree for this session: {e}"))),
    }
}

/// Resolve project config + credentials into a ready-to-run engine handle.
/// Shared by `run_agent_loop` (plain CLI) and `cli_agent_ui` (TUI).
fn prepare_agent_session(
    project: &str,
    model_override: Option<String>,
    overrides: ProviderOverrides,
    flags: SessionFlags,
    resume: Option<&ResumeRequest>,
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
    //
    // The desktop inherit is the last resort and applies only when signed in to
    // Tokamak. Without a sign-in, silently adopting whatever model the desktop
    // app last had selected starts the session on a provider the user never
    // chose here -- and hides the sign-in notice that would otherwise fire,
    // because a non-empty model reads as "configured". Leaving it unset surfaces
    // the notice instead. An explicit --model, agent.toml, or ~/.jan default is
    // unaffected: all three outrank this.
    let explicit = model_override.is_some() || overrides.api_key.is_some();
    let model = model_override
        .or_else(|| cfg.agent.model.clone())
        .or_else(|| crate::core::agent::global_config::default_model().ok().flatten())
        .or_else(|| {
            inherit_desktop_model(
                crate::core::cli::tokamak::auth_status().signed_in,
                crate::core::cli::providers::desktop_selection(),
            )
        });
    // A project or global default can name a model with nobody around to serve
    // it (e.g. this repo's own agent.toml pins one, but a fresh `~/.jan` has no
    // credentials for anything). Trust it only when the user was explicit
    // (--model/--api-key) or some provider can actually be reached; otherwise
    // treat it as unset so the TUI's sign-in notice fires instead of failing on
    // the first message.
    let model = if !flags.require_model
        && !explicit
        && !crate::core::cli::providers::has_usable_provider(Some(&project_root))
    {
        String::new()
    } else {
        model.unwrap_or_default()
    };
    if model.is_empty() && flags.require_model {
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

    // Which provider will serve this model, resolved once here: the cached
    // window and prices are per provider, and two gateways can list one id.
    let serving_provider =
        crate::core::cli::providers::provider_for_model(&model, &provider_configs);

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

    // `think_tags` is user-wide and read from free rendering functions, so it is
    // applied to the process here, the one path every agent surface takes.
    tui::set_think_tags_parsed(crate::core::agent::global_config::think_tags_enabled());

    let permission_requests: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
    let max_parallel_subagents = cfg
        .agent
        .max_parallel_subagents
        .unwrap_or(crate::core::agent::subagent::DEFAULT_MAX_PARALLEL_SUBAGENTS);
    // The tools work in the worktree when there is one; everything else about
    // the session (agent.toml, credentials, the thread store) stays keyed to the
    // project, which is where the user configured it.
    let (workspace, workspace_note) = resolve_workspace(&project_root, flags.worktree, resume);
    let tool_root = workspace
        .as_ref()
        .map(|w| w.path.clone())
        .unwrap_or_else(|| project_root.clone());
    // A provider that names its own ratio wins over the project's: context
    // windows differ by an order of magnitude across providers, so one ratio
    // cannot be right for all of them. Resolved through the same selection the
    // upstream resolution makes, so the ratio always describes the route that
    // will actually serve this request.
    let compaction_ratio =
        crate::core::agent::upstream::pick_provider_for_model(&model, &provider_configs)
            .and_then(|name| provider_configs.get(&name)?.compaction_ratio)
            .or(cfg.agent.compaction_ratio)
            .unwrap_or(crate::core::agent::compaction::DEFAULT_COMPACTION_RATIO);

    let mut args = build_cli_orchestration_args(
        tool_root,
        permissions,
        provider_configs,
        mcp_servers.clone(),
        mcp_settings,
        permission_requests.clone(),
        flags.auto_approve,
        flags.plan,
        max_parallel_subagents,
        flags.sandbox,
    );

    // Resolution order: configured `[agent].context_window` override, then what
    // the provider's own `/models` listing reported, then the built-in model
    // catalog, then the 128K fallback.
    let resolved_window = crate::core::cli::model_capabilities::resolve_context_window(
        &model,
        cfg.agent.context_window,
        crate::core::cli::model_capabilities::reported_window(serving_provider.as_deref(), &model),
    );
    // The CLI is remote-only, so a window always resolves and a budget always
    // exists: a request that outgrows it is compacted before it is sent rather
    // than after the provider rejects it.
    args.compaction = Some(crate::core::agent::compaction::CompactionBudget {
        context_window: resolved_window.tokens,
        ratio: compaction_ratio,
        reserve_tokens: cfg.agent.compaction_reserve_tokens,
    });

    Ok(AgentSession {
        args,
        permission_requests,
        model,
        provider: serving_provider,
        smol_model,
        limits: SessionLimits {
            context_window: resolved_window.tokens,
            context_window_source: resolved_window.source,
            compaction_ratio,
            compaction_reserve_tokens: cfg.agent.compaction_reserve_tokens,
            max_tokens: cfg.agent.max_tokens,
            max_session_tokens: resolve_session_budget(
                flags.max_session_tokens,
                cfg.budget.max_tokens,
            ),
            max_turns: flags.max_turns,
        },
        show_reasoning: cfg.agent.show_reasoning.unwrap_or(false),
        stream_reasoning: crate::core::agent::global_config::stream_reasoning_enabled(),
        send_reasoning: cfg.agent.send_reasoning.unwrap_or(true),
        mcp_servers,
        mcp_task,
        workspace,
        workspace_note,
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
    request: &ResumeRequest,
) -> Result<ResumedSession, String> {
    let thread = resolve_resume(agent_dir, request)?;
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
    flags: SessionFlags,
    resume: Option<ResumeRequest>,
) -> Result<PreparedRun, String> {
    // Non-interactive runs (`agent run`/`step`) have no plan-review handoff, so
    // plan mode stays a TUI-only startup option, and a run with no model has no
    // terminal to recover in, so it must fail rather than launch empty.
    let session = prepare_agent_session(
        project,
        model_override,
        overrides,
        SessionFlags {
            plan: false,
            require_model: true,
            // `agent step` is a single turn by definition and outranks any
            // flag; `agent run` carries whatever `--max-turns` asked for.
            max_turns: if single_turn { Some(1) } else { flags.max_turns },
            ..flags
        },
        resume.as_ref(),
    )?;
    let project_root = resolve_project_root(project);
    if let Some(note) = session.workspace_note.as_deref() {
        eprintln!("({note})");
    }
    if let Some(workspace) = session.workspace.as_ref() {
        eprintln!(
            "(working in {} on {})",
            workspace.path.display(),
            workspace.branch
        );
    }
    // `@path` names a file the agent is about to work on, so it resolves against
    // the checkout the tools see rather than the project directory.
    let read_root = session
        .workspace
        .as_ref()
        .map(|w| w.path.clone())
        .unwrap_or_else(|| project_root.clone());
    let (clean_task, injected) = path_refs::resolve_references(task, &read_root);
    let final_task = if injected.is_empty() {
        clean_task
    } else {
        format!("{clean_task}\n\n---\nReferenced file contents:\n\n{injected}")
    };

    // A failed resume is not fatal: report it and run the prompt in a new session.
    let resumed = resume.and_then(|request| {
        let verb = if request.fork {
            "forked into"
        } else {
            "resumed"
        };
        match load_resume_history(&agent_dir_for(&project_root), &request) {
            Ok(r) => {
                eprintln!(
                    "({verb} session {} with {} message(s))",
                    short_id(&r.thread_id),
                    r.history.len()
                );
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
    let body = session.body(serde_json::json!(history.clone()));
    // Emit resolved references stderr so the user sees what was injected
    if !injected.is_empty() {
        eprintln!("(resolved @path references)");
    }
    Ok(PreparedRun {
        args: session.args,
        body,
        provider: session.provider,
        permission_requests: session.permission_requests,
        mcp_task: session.mcp_task,
        // Non-interactive runs persist into the same per-project store the TUI
        // uses, so a run can later be continued with --resume from either side.
        persist: PersistTarget {
            agent_dir: agent_dir_for(&project_root),
            thread_id: resumed.map(|r| r.thread_id),
            model: session.model,
            history,
            workspace: session.workspace,
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
    flags: SessionFlags,
    resume: Option<ResumeRequest>,
    format: OutputFormat,
    input_format: InputFormat,
) -> Result<(), String> {
    // A duplex run switches off both of the CLI's own answer paths, so the
    // client is the only thing that can resolve a permission request -- and it
    // can only do that if it is being told the request ids. `text` prints them
    // to stderr and `json` prints nothing at all until the run ends, so either
    // pairing leaves a gated call unanswerable. Rejected rather than silently
    // upgraded: a caller parsing plain text should not have the format changed
    // under it.
    if input_format.is_stream_json() && !format.is_stream_json() {
        return Err(
            "--input-format stream-json requires --output-format stream-json (the client answers \
             permission requests, so it must be reading them)"
                .to_string(),
        );
    }
    let started = std::time::Instant::now();
    let prepared = prepare_agent_run(
        project,
        task,
        model_override,
        single_turn,
        overrides,
        flags,
        resume,
    );
    // A setup failure never reaches the event stream, so a JSON consumer would
    // otherwise get an empty stdout and have to parse the human error off stderr.
    let PreparedRun {
        args,
        body,
        provider,
        permission_requests,
        mcp_task,
        persist,
    } = match prepared {
        Ok(prepared) => prepared,
        Err(e) => {
            if format.is_machine() {
                print_report(
                    format,
                    RunReport::setup_failure(&e).finish(
                        None,
                        None,
                        "",
                        started.elapsed().as_millis(),
                        None,
                    ),
                );
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
                // Signing in needs a browser and a keypress, neither of which
                // exists here, so the fix is named rather than attempted.
                if !outcome.needs_auth.is_empty() {
                    log::warn!(
                        "MCP: {} need authentication - run `jan` and use /mcp to sign in",
                        outcome.needs_auth.join(", ")
                    );
                }
            }
            Err(e) => log::warn!("MCP connect task failed: {e}"),
        }
    }

    // The client on stdin, when there is one: it owns every permission decision
    // and can steer or stop the run while it is in flight.
    let input = input_format
        .is_stream_json()
        .then(|| Arc::new(StreamInput::default()));
    let reader = input.as_ref().map(|input| {
        spawn_input_reader(Arc::clone(input), Arc::clone(&permission_requests), format)
    });
    let client = input.clone();

    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    // The report is folded in both formats from the same stream the printer
    // reads, so the JSON envelope can never disagree with the text output.
    let printer = tokio::spawn(async move {
        let mut report = RunReport::default();
        while let Some(ev) = rx.recv().await {
            report.observe(&ev);
            // Asked per event, not once per run: the client owns the decision
            // only while it is still reading. Once stdin has closed, the CLI
            // takes its own path back, which on a pipe is an auto-deny.
            let duplex = client.as_ref().is_some_and(|c| !c.client_gone());
            match format {
                OutputFormat::Text => print_event(ev, &permission_requests, duplex).await,
                OutputFormat::Json => {
                    resolve_permission_silently(ev, &permission_requests, duplex).await;
                }
                OutputFormat::StreamJson => {
                    print_json_line(&ev);
                    if let Some((request_id, decision)) =
                        resolve_permission_silently(ev, &permission_requests, duplex).await
                    {
                        print_json_line(&PermissionDecisionRecord::new(&request_id, decision));
                    }
                }
            }
        }
        report
    });

    // `None` when the client aborted: the run produced no completion, but a
    // deliberate stop is an outcome rather than a failure, so it is reported on
    // the stream and the process still exits 0.
    let outcome = match input.as_ref() {
        Some(input) => run_steered(&tx, &body, &args, input).await,
        None => Some(run_orchestration_streamed(&tx, &body, &args).await),
    };
    if let Some(reader) = reader {
        reader.abort();
    }
    let aborted = outcome.is_none();
    let result = outcome.unwrap_or_else(|| Err(ABORTED_BY_CLIENT.to_string()));
    drop(tx);
    let report = printer.await.unwrap_or_default();
    if let Some(input) = input.as_ref() {
        report_dropped_follow_ups(input, format);
    }

    // Write the turn back so the session stays continuable with --resume.
    let PersistTarget {
        agent_dir,
        thread_id,
        model,
        mut history,
        workspace,
    } = persist;
    let mut session_id = thread_id.clone();
    let mut final_text = None;
    if let Ok(completion) = result.as_ref() {
        final_text = completion_text(completion);
        if let Some(text) = final_text.as_ref() {
            history.push(serde_json::json!({ "role": "assistant", "content": text.clone() }));
        }
        let metadata = worktree_metadata(&agent_dir, thread_id.as_deref(), workspace.as_ref());
        match cli_save_thread(&agent_dir, thread_id.as_deref(), &model, &history, metadata) {
            Ok(id) => {
                if !format.is_machine() {
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
    if format.is_machine() {
        print_report(
            format,
            report.finish(
                session_id.as_deref().map(short_id).as_deref(),
                provider.as_deref(),
                &model,
                started.elapsed().as_millis(),
                final_text.as_deref(),
            ),
        );
    }
    // The one-shot CLI runs exactly one turn, so its session ends here: wipe
    // the persistent bash `/tmp` scratch this run used.
    if let Some(session) = args.session_id.as_deref() {
        let _ = workspace::remove_scratch_dir(session).await;
    }
    if aborted {
        return Ok(());
    }
    result.map(|_| ())
}

/// Stop reason reported for a run the client ended with an `abort` message, and
/// the error the run itself returns -- never printed, since an abort exits 0.
const ABORTED_BY_CLIENT: &str = "aborted by client";

/// Drive the run against a duplex client: the orchestration loop's steering
/// handshake is answered from the queue the reader fills, and an `abort`
/// message drops the run. `None` is that abort.
///
/// Dropping the orchestration future is what stops the run, so anything it was
/// awaiting (an upstream request, a tool) is cancelled where it stands; a child
/// process a `bash` call had already spawned outlives it, as it does on the
/// TUI's cancel path.
async fn run_steered(
    tx: &mpsc::UnboundedSender<StreamEvent>,
    body: &serde_json::Value,
    args: &OrchestrationArgs,
    input: &Arc<StreamInput>,
) -> Option<Result<serde_json::Value, String>> {
    let (steering_tx, mut steering_rx) = mpsc::unbounded_channel::<SteeringRequest>();
    let queue = Arc::clone(input);
    let steerer = tokio::spawn(async move {
        while let Some(request) = steering_rx.recv().await {
            // Empty is the normal answer: the loop asks at every turn boundary.
            let _ = request.reply.send(queue.take_queued());
        }
    });
    let outcome = tokio::select! {
        result = run_orchestration_steered(tx, body, args, Some(&steering_tx)) => Some(result),
        _ = input.aborted() => {
            // The loop emits its own terminal event; an abort pre-empts it, so
            // the report is given one here or it would read as a clean stop.
            let _ = tx.send(StreamEvent::Done {
                stop_reason: "aborted".to_string(),
                usage: None,
            });
            None
        }
    };
    steerer.abort();
    outcome
}

/// What a client line asks the reader to do next.
#[derive(Debug, PartialEq, Eq)]
enum InputFlow {
    Continue,
    /// A permission request was answered; the id and decision are echoed on the
    /// stream so it stays a complete account of the run.
    Decided(String, PermissionDecision),
    /// An `abort`: stop reading, the run is ending.
    Stop,
}

/// Apply one client line. `Err` is the message reported back to the client; it
/// is never fatal, since this is a peer process's output and one malformed line
/// must not cost the work already done.
async fn apply_input_line(
    line: &str,
    input: &StreamInput,
    registry: &PermissionRegistry,
) -> Result<InputFlow, String> {
    match parse_input_line(line)? {
        InputMessage::User(text) => {
            input.queue_user(text);
            Ok(InputFlow::Continue)
        }
        InputMessage::Abort => {
            input.abort();
            Ok(InputFlow::Stop)
        }
        InputMessage::Permission {
            request_id,
            decision,
        } => {
            // Taking the sender is what makes a decision single-use: a second
            // reply for the same id finds nothing and is reported, rather than
            // silently overwriting an answer the run already acted on.
            let sender = registry.lock().await.remove(&request_id);
            let Some(sender) = sender else {
                return Err(format!("no permission request '{request_id}' is pending"));
            };
            let _ = sender.send(decision);
            Ok(InputFlow::Decided(request_id, decision))
        }
    }
}

/// Client lines, read on a detached OS thread.
///
/// Not `tokio::io::stdin`: that parks the read on the runtime's blocking pool,
/// which shutdown waits for, so a client that keeps stdin open -- which is what
/// a duplex client does for the whole run -- leaves the process alive after its
/// terminal record has been printed. A plain thread dies with the process.
fn stdin_lines() -> mpsc::UnboundedReceiver<String> {
    let (tx, rx) = mpsc::unbounded_channel();
    std::thread::spawn(move || {
        use std::io::BufRead as _;
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                return;
            }
        }
    });
    rx
}

/// Consume client messages until `abort` or end of input.
///
/// End of input is not an abort: a client that has said everything it means to
/// say may close the pipe and still want its answer. It *is* the end of the
/// only thing that can answer a permission request, though, so the exit is
/// latched and anything already waiting is released -- see
/// [`strand_pending_permissions`].
async fn read_input_lines(
    mut lines: mpsc::UnboundedReceiver<String>,
    input: Arc<StreamInput>,
    registry: PermissionRegistry,
    format: OutputFormat,
) {
    while let Some(line) = lines.recv().await {
        if line.trim().is_empty() {
            continue;
        }
        match apply_input_line(&line, &input, &registry).await {
            Ok(InputFlow::Continue) => {}
            Ok(InputFlow::Decided(request_id, decision)) => {
                if format.is_stream_json() {
                    print_json_line(&PermissionDecisionRecord::new(&request_id, decision));
                }
            }
            Ok(InputFlow::Stop) => break,
            Err(message) => report_input_error(format, &message, &line),
        }
    }
    // Latch first: a request raised between the drain and the latch would
    // otherwise be recorded as the client's to answer and find no reader.
    input.mark_client_gone();
    strand_pending_permissions(&registry, format).await;
}

/// Name the follow-ups the run ended before reaching. Queued turns are joined
/// at a turn boundary, so a run that stops first (abort, error, or an answer
/// the model considered final) never consumes them; reported one by one, since
/// the text is what the client needs to decide whether to send it again.
fn report_dropped_follow_ups(input: &StreamInput, format: OutputFormat) {
    for turn in input.take_queued() {
        let text = turn["content"].as_str().unwrap_or_default().to_string();
        report_input_error(format, "run ended before this follow-up was read", &text);
    }
}

/// Release every request still waiting on a client that has gone. Dropping the
/// sender is what resolves the run's `rx.await` to `Deny`, so the run declines
/// the call and finishes with its result envelope rather than parking forever.
/// The decision is echoed for the same reason a client-sent one is: the stream
/// stays a complete account of what the run did.
async fn strand_pending_permissions(registry: &PermissionRegistry, format: OutputFormat) {
    let stranded: Vec<String> = registry.lock().await.drain().map(|(id, _)| id).collect();
    for request_id in stranded {
        if format.is_stream_json() {
            print_json_line(&PermissionDecisionRecord::new(
                &request_id,
                PermissionDecision::Deny,
            ));
        } else {
            eprintln!(
                "\x1b[33m[permission] auto-denied '{request_id}' (client closed stdin)\x1b[0m"
            );
        }
    }
}

fn spawn_input_reader(
    input: Arc<StreamInput>,
    registry: PermissionRegistry,
    format: OutputFormat,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(read_input_lines(stdin_lines(), input, registry, format))
}

/// Tell the client its line was rejected, on whichever stream it is reading.
fn report_input_error(format: OutputFormat, message: &str, line: &str) {
    if format.is_stream_json() {
        print_json_line(&InputErrorRecord::new(message, line));
    } else {
        eprintln!("\x1b[33m[input] {message}\x1b[0m");
    }
}

/// Write the result envelope to stdout, the last thing either machine format
/// puts there. `json` pretty-prints it -- those are read by people at least as
/// often as by programs, and `jq` does not care either way -- while
/// `stream-json` must keep it to the one line its contract promises.
fn print_report(format: OutputFormat, report: run_report::RunResult) {
    if format.is_stream_json() {
        print_json_line(&report);
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).unwrap_or_default()
        );
    }
}

/// Write one NDJSON record and flush it, so a consumer reading the pipe sees
/// the event as it happens rather than when the block buffer fills.
fn print_json_line<T: serde::Serialize>(value: &T) {
    let Some(line) = ndjson_line(value) else {
        return;
    };
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.flush();
}

/// Answer a permission request without printing progress, for the machine
/// formats. Leaving it unanswered would wedge the run: the loop waits on the
/// reply. Returns the decision so `stream-json` can report it; with no TTY
/// `prompt_permission` denies rather than blocking on a terminal nobody is at.
async fn resolve_permission_silently(
    ev: StreamEvent,
    registry: &PermissionRegistry,
    duplex: bool,
) -> Option<(String, PermissionDecision)> {
    let StreamEvent::PermissionRequest {
        request_id,
        tool_name,
        capability,
        path,
        command,
        ..
    } = ev
    else {
        return None;
    };
    // With a client on stdin the decision is its call; answering here would
    // race the reply already on its way.
    if duplex {
        return None;
    }
    let detail = command
        .map(|c| format!(" ({c})"))
        .or_else(|| path.map(|p| format!(" on {p}")))
        .unwrap_or_default();
    let decision = prompt_permission(tool_name, capability, detail).await;
    if let Some(sender) = registry.lock().await.remove(&request_id) {
        let _ = sender.send(decision);
    }
    Some((request_id, decision))
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
    flags: SessionFlags,
    resume: Option<ResumeRequest>,
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
    let session = prepare_agent_session(
        project,
        model,
        overrides,
        SessionFlags {
            require_model: false,
            ..flags
        },
        resume.as_ref(),
    )?;
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
async fn print_event(ev: StreamEvent, registry: &PermissionRegistry, duplex: bool) {
    if crate::core::cli::auth::account::take_claude_alias_engaged() {
        eprintln!(
            "\x1b[33m[warning] {}\x1b[0m",
            crate::core::cli::auth::account::CLAUDE_ALIAS_NOTICE
        );
    }
    match ev {
        StreamEvent::Token { text } => {
            print!("{text}");
            let _ = std::io::stdout().flush();
        }
        // A command's live output is progress, not answer: it goes to stderr so a
        // piped stdout still holds only the model's completion. The full output
        // arrives again with the tool result, which is what the model sees; this
        // is purely so a long command is not silent in a headless run.
        StreamEvent::ToolOutputDelta { delta, .. } => {
            eprint!("\x1b[2m{delta}\x1b[0m");
            let _ = std::io::stderr().flush();
        }
        // Reasoning is progress, not answer: dimmed on stderr so piping stdout
        // yields only the real completion.
        StreamEvent::Reasoning { text } => {
            eprint!("\x1b[2m{text}\x1b[0m");
            let _ = std::io::stderr().flush();
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
        StreamEvent::SubagentPlan { pending } => {
            if let Some(max_phase) = pending.iter().map(|p| p.phase).max() {
                eprintln!(
                    "\x1b[2m[plan] {} subagent(s) queued across later phases (through phase {max_phase})\x1b[0m",
                    pending.len()
                )
            }
        }
        StreamEvent::SubagentEnd { name, error, .. } => match error {
            Some(e) => eprintln!("\x1b[2m[subagent:{name}] failed: {e}\x1b[0m"),
            None => eprintln!("\x1b[2m[subagent:{name}] finished\x1b[0m"),
        },
        StreamEvent::Notice { text } => {
            eprintln!("\x1b[2m[notice] {text}\x1b[0m")
        }
        // The snapshot backs a live panel the headless printer has no room
        // for; `Notice` already reports each match as it lands.
        StreamEvent::Monitors { .. } => {}
        StreamEvent::Parked => {
            eprintln!("\x1b[2m[parked] waiting on background work\x1b[0m")
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
        // Headless never renders an ask prompt, so there is nothing to dismiss.
        StreamEvent::AskResolved { .. } => {}
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
            if duplex {
                eprintln!(
                    "\x1b[33m[permission] {capability} via '{tool_name}'{detail} - awaiting '{request_id}' on stdin\x1b[0m"
                );
                return;
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

    /// The duplex channel end to end over a pipe: a follow-up is queued for the
    /// steering handshake, a permission reply reaches the waiting run, a
    /// malformed line is survivable, and `abort` stops the reader.
    ///
    /// Driven through `read_input_lines` rather than the built binary because a
    /// cargo test cannot own process stdin; the binary is exercised by hand.
    #[tokio::test]
    async fn a_duplex_client_steers_answers_and_aborts_over_one_pipe() {
        let input = Arc::new(StreamInput::default());
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let (answer_tx, answer) = tokio::sync::oneshot::channel();
        registry.lock().await.insert("perm-1".to_string(), answer_tx);

        let script = [
            r#"{"type":"user","text":"also check the tests"}"#,
            "   ",
            "{ not json",
            r#"{"type":"permission","request_id":"perm-1","decision":"allow_once"}"#,
            r#"{"type":"user","text":"and the docs"}"#,
            r#"{"type":"abort"}"#,
            r#"{"type":"user","text":"never read"}"#,
        ];
        let (lines_tx, lines) = mpsc::unbounded_channel();
        for line in script {
            lines_tx.send(line.to_string()).expect("reader is alive");
        }
        drop(lines_tx);
        read_input_lines(
            lines,
            Arc::clone(&input),
            Arc::clone(&registry),
            OutputFormat::Json,
        )
        .await;

        assert_eq!(
            answer.await.expect("the run's permission wait is answered"),
            PermissionDecision::AllowOnce
        );
        let queued = input.take_queued();
        assert_eq!(queued.len(), 2, "the bad line cost neither follow-up");
        assert_eq!(queued[0]["content"], "also check the tests");
        assert_eq!(queued[1]["content"], "and the docs");
        // Lines after `abort` are not read: the run is already ending.
        assert!(input.take_queued().is_empty());
        input.aborted().await;
    }

    /// A decision is single-use. The second reply has no sender left to take,
    /// which is what keeps a client from answering a request the run already
    /// acted on.
    #[tokio::test]
    async fn a_second_reply_to_one_request_is_rejected() {
        let input = StreamInput::default();
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let (tx, _rx) = tokio::sync::oneshot::channel();
        registry.lock().await.insert("perm-1".to_string(), tx);
        let line = r#"{"type":"permission","request_id":"perm-1","decision":"deny"}"#;

        assert_eq!(
            apply_input_line(line, &input, &registry).await,
            Ok(InputFlow::Decided(
                "perm-1".to_string(),
                PermissionDecision::Deny
            ))
        );
        let err = apply_input_line(line, &input, &registry)
            .await
            .expect_err("nothing is pending any more");
        assert!(err.contains("no permission request 'perm-1'"), "{err}");
    }

    /// The wedge this guards: with a client on stdin the CLI answers nothing
    /// itself, so a request still pending when the pipe closes had no way out.
    /// Dropping the sender is what resolves the run's wait to `Deny`.
    #[tokio::test]
    async fn closing_stdin_releases_a_request_the_client_never_answered() {
        let input = Arc::new(StreamInput::default());
        let registry: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let (answer_tx, answer) = tokio::sync::oneshot::channel();
        registry
            .lock()
            .await
            .insert("perm-1".to_string(), answer_tx);

        // No lines at all: the client opened the pipe and closed it again.
        let (lines_tx, lines) = mpsc::unbounded_channel::<String>();
        drop(lines_tx);
        read_input_lines(
            lines,
            Arc::clone(&input),
            Arc::clone(&registry),
            OutputFormat::StreamJson,
        )
        .await;

        assert!(
            answer.await.is_err(),
            "the sender is dropped, which the run reads as Deny"
        );
        assert!(registry.lock().await.is_empty());
        assert!(
            input.client_gone(),
            "later requests must not be recorded as the client's to answer"
        );
    }

    /// The other half of the same wedge: a request raised *after* the pipe
    /// closed. The latch is what sends the printer back to its own answer path.
    #[tokio::test]
    async fn a_request_raised_after_the_client_left_is_not_left_to_the_client() {
        let input = StreamInput::default();
        assert!(!input.client_gone());
        input.mark_client_gone();
        assert!(input.client_gone());
    }

    /// `--input-format stream-json` with any other output format leaves the
    /// client unable to see the request ids it is expected to answer.
    #[tokio::test]
    async fn a_duplex_run_is_refused_unless_the_output_is_stream_json() {
        for format in [OutputFormat::Text, OutputFormat::Json] {
            let err = run_agent_loop(
                ".",
                "task",
                None,
                false,
                ProviderOverrides::default(),
                SessionFlags::default(),
                None,
                format,
                InputFormat::StreamJson,
            )
            .await
            .expect_err("the pairing is required");
            assert!(
                err.contains("requires --output-format stream-json"),
                "{err}"
            );
        }
    }

    /// A queued follow-up the run never reached is reported rather than
    /// vanishing, so the client knows to send it again.
    #[test]
    fn follow_ups_the_run_never_read_are_reported() {
        let input = StreamInput::default();
        input.queue_user("and the docs".to_string());
        report_dropped_follow_ups(&input, OutputFormat::StreamJson);
        assert!(
            input.take_queued().is_empty(),
            "reporting drains, so a second call cannot double-report"
        );
    }

    /// Signing in to Tokamak is what unlocks the desktop inherit. Without it the
    /// model stays unset so the TUI's sign-in notice fires, instead of the
    /// session silently starting on whatever the desktop app last had selected.
    #[test]
    fn desktop_model_is_inherited_only_when_signed_in() {
        let selection = crate::core::cli::providers::DesktopSelection {
            provider: Some("llamacpp".into()),
            model: Some("gemma-4-E2B-it-IQ4_XS".into()),
        };
        assert_eq!(
            inherit_desktop_model(true, selection.clone()).as_deref(),
            Some("gemma-4-E2B-it-IQ4_XS"),
        );
        assert_eq!(
            inherit_desktop_model(false, selection),
            None,
            "a signed-out session does not adopt the desktop's selection"
        );
    }

    /// Signed in but the desktop has no selection (or no desktop at all) is not
    /// an error -- it just contributes nothing to the chain.
    #[test]
    fn an_empty_desktop_selection_contributes_nothing() {
        assert_eq!(
            inherit_desktop_model(true, crate::core::cli::providers::DesktopSelection::default()),
            None
        );
    }

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

        let resumed =
            load_resume_history(base, &ResumeRequest::resume(ResumeTarget::Latest)).unwrap();
        assert_eq!(resumed.thread_id, id);
        assert_eq!(resumed.history, history);

        // Continue the session and save back: same thread, appended turns.
        let mut extended = resumed.history;
        extended.push(serde_json::json!({ "role": "user", "content": "second" }));
        let same = cli_save_thread(base, Some(&id), "m", &extended, None).unwrap();
        assert_eq!(same, id);
        assert_eq!(list_threads_in(base).unwrap().len(), 1);
        assert_eq!(
            load_resume_history(
                base,
                &ResumeRequest::resume(ResumeTarget::Id(id[..8].to_string())),
            )
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

        let resumed =
            load_resume_history(base, &ResumeRequest::resume(ResumeTarget::Latest)).unwrap();
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

    // ── invocation_label / default_thread_title ────────────────────────────

    #[test]
    fn invocation_label_recognizes_skill_and_command_wrappers() {
        assert_eq!(
            invocation_label(
                "[IMPORTANT: You have invoked the \"deploy\" skill - follow its instructions. The full skill content is loaded below.]\n\nBody."
            ),
            Some("[skill:deploy]".to_string())
        );
        assert_eq!(
            invocation_label(
                "[IMPORTANT: You have invoked the \"feature-dev\" command - follow its instructions. The full command content is loaded below.]\n\nBuild: $ARGUMENTS"
            ),
            Some("[command:feature-dev]".to_string())
        );
        // Anything that is not the exact machine wrapper stays None.
        assert_eq!(invocation_label("deploy"), None);
        assert_eq!(
            invocation_label("[IMPORTANT: You have invoked the \"\" skill - x"),
            None
        );
        assert_eq!(
            invocation_label("[IMPORTANT: You have invoked the \"deploy\" skill"), // truncated wrapper
            None
        );
        assert_eq!(
            invocation_label("[IMPORTANT: You have invoked the \"deploy\""), // no kind
            None
        );
    }

    #[test]
    fn default_thread_title_uses_invocation_label_for_first_message() {
        let history = serde_json::json!([{
            "role": "user",
            "content": "[IMPORTANT: You have invoked the \"feature-dev\" command - follow its instructions. The full command content is loaded below.]\n\nBuild: auth"
        }]);
        assert_eq!(
            default_thread_title(history.as_array().unwrap()),
            "[command:feature-dev]"
        );
    }

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
                SessionFlags::default(),
                None,
            )
            .expect("TUI session prep must not fail with nothing configured");
            assert_eq!(session.model, "");
        });
    }

    /// End-to-end for the sign-in gate, arranged so the pre-existing
    /// "nothing usable is configured" guard cannot mask it: a usable non-Tokamak
    /// provider is present (so the guard passes) but names no models (so
    /// `default_model` contributes nothing), leaving the desktop inherit as the
    /// only thing that could supply a model. Signed out, it must not.
    #[test]
    fn a_signed_out_session_does_not_adopt_the_desktop_model() {
        crate::core::agent::global_config::with_temp_home(|home| {
            crate::core::agent::global_config::set_provider(
                "openai",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("sk-test".into()),
                    base_url: Some("https://api.openai.com/v1".into()),
                    models: Some(vec![]),
                    ..Default::default()
                },
            )
            .expect("seed provider");

            let data = home.join("jan-data");
            std::fs::create_dir_all(&data).unwrap();
            std::fs::write(
                data.join("settings.json"),
                r#"{"model-provider":"{\"state\":{\"selectedProvider\":\"llamacpp\",\"selectedModel\":{\"id\":\"gemma-4-E2B-it-IQ4_XS\"}}}"}"#,
            )
            .unwrap();
            std::env::set_var("JAN_DATA_FOLDER", &data);

            // Sanity: the desktop selection really is readable, so a passing
            // assertion below means the gate fired, not that the fixture is dead.
            assert_eq!(
                crate::core::cli::providers::desktop_selection().model.as_deref(),
                Some("gemma-4-E2B-it-IQ4_XS")
            );
            assert!(!crate::core::cli::tokamak::auth_status().signed_in);

            let dir = tempfile::tempdir().unwrap();
            let session = prepare_agent_session(
                dir.path().to_str().unwrap(),
                None,
                ProviderOverrides::default(),
                SessionFlags::default(),
                None,
            )
            .expect("session prep");
            std::env::remove_var("JAN_DATA_FOLDER");

            assert_eq!(
                session.model, "",
                "signed out, the desktop's last selection must not become the session model"
            );
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
                    clear_api_key: false,
                    base_url: Some(crate::core::cli::tokamak::BASE_URL.into()),
                    models: Some(vec!["tokamak-1-preview".into()]),
                    api_type: None,
                                    ..Default::default()
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
                SessionFlags::default(),
                None,
            )
            .expect("session prep");
            assert_eq!(session.model, "tokamak-1-preview");
        });
    }

    // ── fork ───────────────────────────────────────────────────────────────

    /// Three user turns, each with a tool call and its result, plus the journal
    /// the TUI would have written for them.
    fn seed_forkable(base: &std::path::Path) -> String {
        let mut history = Vec::new();
        for n in 0..3 {
            history.push(serde_json::json!({ "role": "user", "content": format!("turn {n}") }));
            history.push(serde_json::json!({
                "role": "assistant", "content": "", "tool_calls": [call(&format!("c{n}"), "write")]
            }));
            history.push(serde_json::json!({
                "role": "tool", "tool_call_id": format!("c{n}"), "content": "ok"
            }));
            history
                .push(serde_json::json!({ "role": "assistant", "content": format!("done {n}") }));
        }
        let id = cli_save_thread(base, None, "m", &history, None).unwrap();
        let entries: Vec<journal::DisplayEntry> = (0..3)
            .flat_map(|n| {
                vec![
                    journal::DisplayEntry::User {
                        text: format!("turn {n}"),
                        images: Vec::new(),
                    },
                    journal::DisplayEntry::ToolCall {
                        id: format!("c{n}"),
                        name: "write".into(),
                        args: serde_json::json!({ "path": "a.txt" }),
                    },
                    journal::DisplayEntry::ToolResult {
                        id: format!("c{n}"),
                        content: "ok".into(),
                        is_error: false,
                        diff: None,
                    },
                    journal::DisplayEntry::Assistant {
                        text: format!("done {n}"),
                        reasoning: Vec::new(),
                        reasoning_ms: None,
                    },
                ]
            })
            .collect();
        journal::write_journal(&journal::journal_path(base, &id), &entries).unwrap();
        id
    }

    #[test]
    fn fork_carries_the_prefix_of_both_files_and_leaves_the_source_alone() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);
        let before_messages = std::fs::read(get_messages_path(base, &source)).unwrap();
        let before_journal = std::fs::read(journal::journal_path(base, &source)).unwrap();

        let forked = fork_thread(base, &source, Some(2)).unwrap();
        assert_ne!(forked, source);

        // Two user turns, each still holding its call/result pair.
        let history = load_resume_history(
            base,
            &ResumeRequest::resume(ResumeTarget::Id(forked.clone())),
        )
        .unwrap()
        .history;
        assert_eq!(user_turn_count(&history), 2);
        assert_eq!(history.len(), 8);
        assert!(history
            .iter()
            .all(|m| !thread_message_text(m).contains("turn 2")));
        assert_eq!(
            history
                .iter()
                .filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("tool"))
                .count(),
            2,
            "every carried call keeps its result"
        );

        let journal = journal::read_journal(&journal::journal_path(base, &forked));
        assert_eq!(
            journal.len(),
            8,
            "tool rows were carried, not just the wire history"
        );
        assert!(
            matches!(journal.last(), Some(journal::DisplayEntry::Assistant { text, .. }) if text == "done 1")
        );

        assert_eq!(
            std::fs::read(get_messages_path(base, &source)).unwrap(),
            before_messages,
            "a fork must not touch the thread it came from"
        );
        assert_eq!(
            std::fs::read(journal::journal_path(base, &source)).unwrap(),
            before_journal
        );
    }

    #[test]
    fn fork_records_its_immediate_parent() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);

        let child = fork_thread(base, &source, Some(2)).unwrap();
        let grandchild = fork_thread(base, &child, Some(1)).unwrap();

        let meta =
            |id: &str| cli_get_thread_in(base, id).unwrap()["metadata"][FORKED_FROM_KEY].clone();
        assert_eq!(
            meta(&child),
            serde_json::json!({ "thread_id": source, "user_turn": 2 })
        );
        assert_eq!(
            meta(&grandchild),
            serde_json::json!({ "thread_id": child, "user_turn": 1 }),
            "forking a fork names the fork, not the root"
        );
    }

    #[test]
    fn a_whole_thread_fork_records_every_turn_and_keeps_them() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);

        let forked = fork_thread(base, &source, None).unwrap();
        let thread = cli_get_thread_in(base, &forked).unwrap();
        assert_eq!(thread["metadata"][FORKED_FROM_KEY]["user_turn"], 3);
        assert_eq!(
            journal::read_journal(&journal::journal_path(base, &forked)).len(),
            12
        );
    }

    #[test]
    fn fork_refuses_a_cut_that_would_keep_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);
        assert!(fork_thread(base, &source, Some(0)).is_err());
        assert!(fork_thread(base, &source, Some(9)).is_err());
        assert!(fork_thread(base, "nope", None).is_err());
        assert_eq!(
            list_threads_in(base).unwrap().len(),
            1,
            "a refused fork leaves no half-built thread behind"
        );
    }

    /// A fork drops the checkpoints for turns it does not have: restoring the
    /// workspace to one of them would put the branch in a state it never saw.
    #[test]
    fn fork_drops_checkpoints_past_the_cut() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);
        let history = cli_read_messages_lenient(base, &source).unwrap().0;
        cli_save_thread(
            base,
            Some(&source),
            "m",
            &rebuild_wire_history(&history),
            Some(serde_json::json!({
                "base_snapshot": "aaa",
                "checkpoints": [
                    { "user_index": 0, "preview": "turn 0", "sha": "s0" },
                    { "user_index": 2, "preview": "turn 2", "sha": "s2" },
                ],
            })),
        )
        .unwrap();

        let forked = fork_thread(base, &source, Some(2)).unwrap();
        let meta = cli_get_thread_in(base, &forked).unwrap()["metadata"].clone();
        assert_eq!(
            meta["base_snapshot"], "aaa",
            "the branch shares the base commit"
        );
        assert_eq!(meta["checkpoints"].as_array().unwrap().len(), 1);
        assert_eq!(meta["checkpoints"][0]["sha"], "s0");
    }

    #[test]
    fn resume_request_from_flags() {
        assert_eq!(ResumeRequest::from_flags(None, false, false), None);
        assert_eq!(
            ResumeRequest::from_flags(None, false, true),
            Some(ResumeRequest::fork(ResumeTarget::Latest)),
            "--fork-session alone branches the most recent session"
        );
        assert_eq!(
            ResumeRequest::from_flags(Some(Some("3f7a".into())), false, true),
            Some(ResumeRequest::fork(ResumeTarget::Id("3f7a".into())))
        );
        assert_eq!(
            ResumeRequest::from_flags(None, true, false),
            Some(ResumeRequest::resume(ResumeTarget::Latest))
        );
    }

    #[test]
    fn resolve_resume_forks_into_a_new_id_and_leaves_the_source_resumable() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);

        let opened = resolve_resume(base, &ResumeRequest::fork(ResumeTarget::Latest)).unwrap();
        let forked = opened["id"].as_str().unwrap().to_string();
        assert_ne!(forked, source);
        assert_eq!(opened["metadata"][FORKED_FROM_KEY]["thread_id"], source);
        assert_eq!(
            load_resume_history(
                base,
                &ResumeRequest::resume(ResumeTarget::Id(source.clone()))
            )
            .unwrap()
            .thread_id,
            source,
            "the source is still there to resume"
        );
    }

    #[test]
    fn thread_forest_nests_forks_and_keeps_orphans_as_roots() {
        let node = |id: &str, updated: f64, parent: Option<&str>| {
            let mut t = serde_json::json!({ "id": id, "updated": updated, "metadata": {} });
            if let Some(p) = parent {
                t["metadata"][FORKED_FROM_KEY] =
                    serde_json::json!({ "thread_id": p, "user_turn": 1 });
            }
            t
        };
        let rows = thread_forest(vec![
            node("root", 1.0, None),
            node("child-old", 2.0, Some("root")),
            node("child-new", 3.0, Some("root")),
            node("grandchild", 4.0, Some("child-new")),
            node("orphan", 5.0, Some("deleted")),
        ]);
        let shape: Vec<(String, usize)> = rows
            .iter()
            .map(|n| (n.thread["id"].as_str().unwrap().to_string(), n.depth))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("orphan".into(), 0),
                ("root".into(), 0),
                ("child-new".into(), 1),
                ("grandchild".into(), 2),
                ("child-old".into(), 1),
            ]
        );
        assert!(
            rows.iter()
                .find(|n| n.thread["id"] == "child-old")
                .unwrap()
                .last
        );
    }

    /// A store with no forks is today's flat, most-recent-first list.
    #[test]
    fn thread_forest_of_unforked_threads_is_the_flat_list() {
        let threads = vec![
            serde_json::json!({ "id": "a", "updated": 1.0 }),
            serde_json::json!({ "id": "b", "updated": 2.0 }),
        ];
        let rows = thread_forest(threads);
        assert!(rows.iter().all(|n| n.depth == 0));
        assert_eq!(rows[0].thread["id"], "b");
    }

    /// A fork cycle is reachable from no root; listing it flat beats dropping
    /// the sessions from `/tree` entirely.
    #[test]
    fn thread_forest_survives_a_cycle() {
        let rows = thread_forest(vec![
            serde_json::json!({ "id": "a", "updated": 1.0, "metadata": { FORKED_FROM_KEY: { "thread_id": "b" } } }),
            serde_json::json!({ "id": "b", "updated": 2.0, "metadata": { FORKED_FROM_KEY: { "thread_id": "a" } } }),
        ]);
        assert_eq!(rows.len(), 2);
    }

    // ── worktree ───────────────────────────────────────────────────────────

    #[test]
    fn a_fork_never_inherits_the_parent_checkout() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let source = seed_forkable(base);
        let history = cli_read_messages_lenient(base, &source).unwrap().0;
        cli_save_thread(
            base,
            Some(&source),
            "m",
            &rebuild_wire_history(&history),
            Some(serde_json::json!({
                "base_snapshot": "aaa",
                worktree::WORKTREE_KEY: {
                    "path": "/home/u/.jan/worktrees/jan-abc/deadbeef",
                    "branch": "jan/agent/deadbeef",
                },
            })),
        )
        .unwrap();

        let forked = fork_thread(base, &source, Some(2)).unwrap();
        let meta = cli_get_thread_in(base, &forked).unwrap()["metadata"].clone();
        assert_eq!(
            worktree::from_metadata(Some(&meta)),
            None,
            "two conversations must not edit one checkout"
        );
        assert_eq!(
            meta["base_snapshot"], "aaa",
            "the rest of the bookkeeping is kept"
        );
        // The source still names its own.
        let source_meta = cli_get_thread_in(base, &source).unwrap()["metadata"].clone();
        assert!(worktree::from_metadata(Some(&source_meta)).is_some());
    }

    /// A fork branches from where the source conversation left off, so the
    /// files match the transcript it inherited.
    #[test]
    fn latest_snapshot_prefers_the_newest_checkpoint() {
        let thread = serde_json::json!({ "metadata": {
            "base_snapshot": "base",
            "checkpoints": [
                { "user_index": 0, "preview": "one", "sha": "s0" },
                { "user_index": 1, "preview": "two", "sha": "s1" },
            ],
        }});
        assert_eq!(latest_snapshot(Some(&thread)).as_deref(), Some("s1"));

        // No checkpoints yet: the base snapshot is still better than HEAD.
        let fresh = serde_json::json!({ "metadata": { "base_snapshot": "base" } });
        assert_eq!(latest_snapshot(Some(&fresh)).as_deref(), Some("base"));
        // Nothing recorded at all leaves the choice to the caller (HEAD).
        assert_eq!(latest_snapshot(None), None);
        assert_eq!(
            latest_snapshot(Some(&serde_json::json!({ "metadata": {} }))),
            None
        );
    }

    /// Off by default, and off costs nothing: no git call, no directory.
    #[test]
    fn no_worktree_is_resolved_when_nothing_asks_for_one() {
        let dir = tempfile::tempdir().unwrap();
        let (workspace, note) = resolve_workspace(dir.path(), None, None);
        assert_eq!(workspace, None);
        assert_eq!(note, None);
    }

    /// Asking for a worktree outside a repository is not fatal: the session runs
    /// in the project directory and is told why.
    #[test]
    fn a_worktree_outside_a_repository_falls_back_with_a_reason() {
        let dir = tempfile::tempdir().unwrap();
        let (workspace, note) = resolve_workspace(dir.path(), Some(true), None);
        assert_eq!(workspace, None);
        assert!(
            note.is_some_and(|n| n.contains("not a git repository")),
            "the fallback has to say why"
        );
    }

    /// The regression behind a real failure: a headless run recorded no
    /// checkout, so the next `--resume` branched a fresh worktree and the model
    /// read a pristine tree, losing everything the run it continued had done.
    #[test]
    fn a_saved_thread_names_the_checkout_the_run_worked_in() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let workspace = worktree::Worktree {
            path: std::path::PathBuf::from("/home/u/.jan/worktrees/p-abc/deadbeef"),
            branch: "jan/agent/deadbeef".to_string(),
        };
        let history = vec![serde_json::json!({ "role": "user", "content": "do it" })];

        let meta = worktree_metadata(base, None, Some(&workspace));
        let id = cli_save_thread(base, None, "m", &history, meta).unwrap();
        let saved = cli_get_thread_in(base, &id).unwrap();
        assert_eq!(
            worktree::from_metadata(saved.get("metadata")),
            Some(workspace.clone()),
            "a resume has to be able to find the checkout again"
        );

        // A second turn merges into what is already there rather than replacing
        // it, so the snapshot bookkeeping beside it survives.
        cli_save_thread(
            base,
            Some(&id),
            "m",
            &history,
            Some(serde_json::json!({
                "base_snapshot": "aaa",
                worktree::WORKTREE_KEY: worktree::to_metadata(&workspace),
            })),
        )
        .unwrap();
        let meta = worktree_metadata(base, Some(&id), Some(&workspace)).expect("some");
        assert_eq!(meta["base_snapshot"], "aaa");
        assert_eq!(
            worktree::from_metadata(Some(&meta)),
            Some(workspace),
            "and the pointer is still the one this run used"
        );

        // No worktree: `None` keeps `cli_save_thread`'s preserve-existing path.
        assert_eq!(worktree_metadata(base, Some(&id), None), None);
    }

    /// A headless run takes no snapshots, so without capturing the source's
    /// checkout a fork opens on a pristine `HEAD` while the transcript it
    /// inherited describes work that is not in it. Caught against a live model:
    /// the fork's first `wc -l` disagreed with the answer it had just read.
    #[test]
    fn a_fork_base_captures_the_source_checkout_when_there_is_no_snapshot() {
        fn git(args: &[&str]) -> Option<String> {
            let out = std::process::Command::new("git").args(args).output().ok()?;
            out.status
                .success()
                .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
        }

        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let r = repo.to_string_lossy().to_string();
        // Skip on a box without git rather than failing the suite.
        if git(&["-C", &r, "init", "-q"]).is_none() {
            return;
        }
        git(&["-C", &r, "config", "user.email", "a@b.c"]);
        git(&["-C", &r, "config", "user.name", "t"]);
        std::fs::write(repo.join("notes.txt"), "one\n").unwrap();
        git(&["-C", &r, "add", "-A"]);
        git(&["-C", &r, "commit", "-q", "-m", "init", "--no-gpg-sign"]).expect("commit");

        // A session worked in its own checkout: one tracked edit, one new file.
        let wt = dir.path().join("wt");
        let head = crate::core::agent::git::head_sha(&repo).expect("HEAD");
        crate::core::agent::git::worktree_add(&repo, &wt, "jan/agent/testfb", &head).unwrap();
        std::fs::write(wt.join("notes.txt"), "one\ntwo\n").unwrap();
        std::fs::write(wt.join("added.txt"), "new\n").unwrap();

        let source = serde_json::json!({
            "id": "src-thread",
            "metadata": { worktree::WORKTREE_KEY: {
                "path": wt.to_string_lossy(), "branch": "jan/agent/testfb",
            }},
        });
        let base = fork_base(Some(&source)).expect("the source checkout is captured");
        assert_ne!(
            base, head,
            "a fork must not start at a HEAD the work predates"
        );

        let show = |path: &str| git(&["-C", &r, "show", &format!("{base}:{path}")]);
        assert_eq!(
            show("notes.txt").as_deref(),
            Some("one\ntwo"),
            "the branch starts from the work the conversation did"
        );
        assert_eq!(
            show("added.txt").as_deref(),
            Some("new"),
            "untracked files the agent created are carried too"
        );

        // A recorded checkout the user deleted leaves the choice to HEAD.
        std::fs::remove_dir_all(&wt).unwrap();
        assert_eq!(fork_base(Some(&source)), None);
        // A source that recorded a snapshot uses it, no capture needed.
        let snapped = serde_json::json!({ "id": "s", "metadata": { "base_snapshot": "cafe" } });
        assert_eq!(fork_base(Some(&snapped)).as_deref(), Some("cafe"));
    }

    /// `--max-session-tokens` outranks `[budget].max_tokens`, which outranks
    /// the built-in default; `0` from either source survives as the unbounded
    /// marker `body_session_budget` expects rather than falling through.
    #[test]
    fn session_budget_precedence_is_flag_then_config_then_default() {
        assert_eq!(
            resolve_session_budget(None, None),
            DEFAULT_MAX_SESSION_TOKENS
        );
        assert_eq!(resolve_session_budget(None, Some(50_000)), 50_000);
        assert_eq!(resolve_session_budget(Some(20_000), Some(50_000)), 20_000);
        assert_eq!(resolve_session_budget(Some(20_000), None), 20_000);
        assert_eq!(resolve_session_budget(Some(0), Some(50_000)), 0);
        assert_eq!(resolve_session_budget(None, Some(0)), 0);

        assert_eq!(session_budget_source(None, None), "default");
        assert_eq!(session_budget_source(None, Some(50_000)), "agent.toml");
        assert_eq!(session_budget_source(Some(0), Some(50_000)), "flag");
    }

    fn limits_with(max_turns: Option<u64>, max_session_tokens: u64) -> SessionLimits {
        SessionLimits {
            context_window: 128_000,
            context_window_source:
                crate::core::cli::model_capabilities::ContextWindowSource::Fallback,
            compaction_ratio: crate::core::agent::compaction::DEFAULT_COMPACTION_RATIO,
            compaction_reserve_tokens: None,
            max_tokens: None,
            max_session_tokens,
            max_turns,
        }
    }

    /// The write side of the caps: the limits have to reach the request body in
    /// the encoding `body_turn_cap` / `body_session_budget` read back, or the
    /// flags are inert. `max_turns` is absent (not `0`) when unset, so a caller
    /// that never passes it is byte-identical to before the flag existed.
    #[test]
    fn run_limits_reach_the_request_body() {
        let messages = serde_json::json!([]);

        let unset = request_body("m", &limits_with(None, 128_000), true, messages.clone());
        assert!(
            unset.get("max_turns").is_none(),
            "an unset cap must not write the field at all: {unset}"
        );
        assert_eq!(unset["max_session_tokens"], 128_000);

        // What `agent step` pins, and what `--max-turns 5` pins, by the same route.
        let stepped = request_body("m", &limits_with(Some(1), 128_000), true, messages.clone());
        assert_eq!(stepped["max_turns"], 1);
        let capped = request_body("m", &limits_with(Some(5), 20_000), true, messages.clone());
        assert_eq!(capped["max_turns"], 5);
        assert_eq!(capped["max_session_tokens"], 20_000);

        // An explicit 0 is the engine's "unbounded" encoding and must survive as
        // itself rather than being dropped back to the absent case.
        let zero = request_body("m", &limits_with(Some(0), 0), true, messages);
        assert_eq!(zero["max_turns"], 0);
        assert_eq!(zero["max_session_tokens"], 0);
    }
}
