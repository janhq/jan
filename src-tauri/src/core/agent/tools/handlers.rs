//! Native execution of the built-in tools. Sandbox escape is enforced by the
//! gate before these run; handlers only resolve paths and perform the operation.
//! Errors are returned as a String starting with "ERROR" (matching
//! `execute_mcp_tool_calls`) so the loop flags `is_error` correctly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use ignore::WalkBuilder;
use tokio::sync::oneshot;

use crate::core::agent::project::load_agent_config;
use crate::core::agent::skills;
use crate::core::agent::tools::proc;
use crate::core::agent::tools::sandbox::is_restricted_agent_path;
use crate::core::agent::tools::BuiltinTool;

const MAX_BYTES: usize = 64 * 1024;
const MAX_LINES: usize = 2000;
/// bash output caps: generous enough that typical command output reaches the
/// model intact on a large-context run, spilling to a temp file only past this.
const BASH_MAX_BYTES: usize = 256 * 1024;
const BASH_MAX_LINES: usize = 10_000;
const GREP_MAX_LINE: usize = 500;
const LS_DEFAULT_LIMIT: usize = 500;
const FIND_DEFAULT_LIMIT: usize = 1000;
const GREP_DEFAULT_LIMIT: usize = 100;
/// How long a `bash` call waits for the command before backgrounding it, when
/// the caller doesn't specify `timeout`.
const DEFAULT_BASH_TIMEOUT_SECS: u64 = 30;

/// Counter for unique temp-file names for truncated bash output.
static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);
/// Counter for unique bash background job ids.
static BASH_JOB_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Commands still running past their `bash` call's timeout, keyed by job_id.
/// Each receiver resolves with the same formatted output a foreground call
/// would have returned. Entries are removed once collected via `job_id`;
/// uncollected jobs live for the process's lifetime, same tradeoff as the
/// bash-output temp files this module already leaves on disk.
fn bash_jobs() -> &'static Mutex<HashMap<String, oneshot::Receiver<String>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, oneshot::Receiver<String>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn resolve(project_root: &Path, raw: &str) -> PathBuf {
    if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        project_root.join(raw)
    }
}

fn arg_str<'a>(args: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

fn arg_u64(args: &serde_json::Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| v.as_u64())
}

fn arg_bool(args: &serde_json::Value, key: &str) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn rel_to(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Truncate `s` to the smaller of `max_lines` or `max_bytes`, appending
/// `note` when truncation occurred.
fn cap_output(s: &str, max_lines: usize, max_bytes: usize, note: &str) -> String {
    let mut out = String::new();
    let mut truncated = false;
    for (lines, line) in s.split_inclusive('\n').enumerate() {
        if lines >= max_lines || out.len() + line.len() > max_bytes {
            truncated = true;
            break;
        }
        out.push_str(line);
    }
    if truncated {
        out.push_str(note);
    }
    out
}

/// Collapse carriage-return redraws (`git`/`curl`-style progress lines) to what
/// a terminal would actually show: text after the last `\r` on each line wins.
/// Without this, thousands of `\r`-separated progress frames read as one giant
/// line and blow past the byte cap, so tiny visible output looks truncated.
fn collapse_carriage_returns(s: &str) -> String {
    if !s.contains('\r') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    for line in s.split_inclusive('\n') {
        let (body, nl) = match line.strip_suffix('\n') {
            Some(b) => (b, "\n"),
            None => (line, ""),
        };
        let body = body.strip_suffix('\r').unwrap_or(body);
        out.push_str(body.rsplit('\r').next().unwrap_or(body));
        out.push_str(nl);
    }
    out
}

/// Execute a built-in tool. Returns the tool-result text. Errors are returned
/// as a String STARTING WITH "ERROR" rather than as Err.
pub async fn execute_builtin(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    project_root: &Path,
) -> String {
    match tool.name {
        "read" => read(args, project_root).await,
        "ls" => ls(args, project_root).await,
        "write" => write(args, project_root).await,
        "edit" => edit(args, project_root).await,
        "bash" => bash(args, project_root).await,
        "find" => find(args, project_root).await,
        "grep" => grep(args, project_root).await,
        "memory_list" => workspace_list(project_root, "memory").await,
        "memory_read" => workspace_read(args, project_root, "memory").await,
        "memory_write" => workspace_write(args, project_root, "memory").await,
        // Skills go through the skills module so the tool honors the folder form
        // (`<name>/SKILL.md`) and frontmatter, matching what the UI writes.
        "skill_list" => skill_list(project_root),
        "skill_read" => skill_read(args, project_root),
        "skill_write" => skill_write(args, project_root),
        // Native web tools: compiled into the agent core, not an MCP server.
        "web_search" => crate::core::agent::tools::web::web_search(args).await,
        "web_fetch" => crate::core::agent::tools::web::web_fetch(args).await,
        other => format!("ERROR: unknown built-in tool '{other}'"),
    }
}

/// Focused diff previewing what a `write`/`edit` call would change, without
/// running it. Line-prefixed (`-`/`+`) hunk text with each line numbered against
/// its position in the file; `None` for other tools or when nothing would
/// change. Used to show the change in the permission prompt. Both variants read
/// the prior file: `write` to show its `created`/`overwrote` header, `edit` to
/// locate `old_string` and number the hunk against real file lines.
pub(crate) async fn preview_diff(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    project_root: &Path,
) -> Option<String> {
    match tool.name {
        "edit" => {
            let edits = args.get("edits").and_then(|v| v.as_array())?;
            if edits.is_empty() {
                return None;
            }
            let prior = match arg_str(args, "path") {
                Some(p) => tokio::fs::read_to_string(resolve(project_root, p)).await.unwrap_or_default(),
                None => String::new(),
            };
            let d = render_edit_diff(edits, &prior);
            (!d.is_empty()).then_some(d)
        }
        "write" => {
            let prior = match arg_str(args, "path") {
                Some(p) => tokio::fs::read_to_string(resolve(project_root, p)).await.ok(),
                None => None,
            };
            let new = arg_str(args, "content").unwrap_or("");
            Some(render_write_diff(prior.as_deref(), new))
        }
        _ => None,
    }
}

/// Run a built-in tool and, for `write`/`edit`, also produce a focused diff.
/// Returns `(content, diff)` where `diff` is line-prefixed (`-`/`+`) hunk text
/// for display; `None` for non-mutating tools or on error. Diffs are computed
/// against the pre-execution file so line numbers match the file as the model
/// saw it. For `edit` the diff is also appended to `content` (the model sees
/// exactly what changed); for `write` the diff is display-only and `content`
/// stays the concise summary.
pub(crate) async fn execute_builtin_with_diff(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    project_root: &Path,
) -> (String, Option<String>) {
    match tool.name {
        "edit" => {
            let diff = preview_diff(tool, args, project_root).await;
            let content = execute_builtin(tool, args, project_root).await;
            if content.starts_with("ERROR") {
                return (content, None);
            }
            match diff {
                Some(d) => (format!("{content}\n\n{d}"), Some(d)),
                None => (content, None),
            }
        }
        "write" => {
            let diff = preview_diff(tool, args, project_root).await;
            let content = execute_builtin(tool, args, project_root).await;
            if content.starts_with("ERROR") {
                return (content, None);
            }
            (content, diff)
        }
        _ => (execute_builtin(tool, args, project_root).await, None),
    }
}

/// 1-based line number of the start of `pos` within `text`.
fn line_number_at(text: &str, pos: usize) -> usize {
    text[..pos].matches('\n').count() + 1
}

/// Per-edit `-old`/`+new` hunks, each line numbered against its position in
/// `prior` (the file content before this call's edits are applied). Multiple
/// edits are separated by `@@ edit i/n @@` and applied in order so later edits
/// number against the state left by earlier ones, matching what `edit()` does.
fn render_edit_diff(edits: &[serde_json::Value], prior: &str) -> String {
    let n = edits.len();
    let mut working = prior.to_string();
    let mut out = String::new();
    for (i, e) in edits.iter().enumerate() {
        let old = e.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
        let new = e.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
        if n > 1 {
            out.push_str(&format!("@@ edit {}/{} @@\n", i + 1, n));
        }
        let start = working.find(old).map(|pos| line_number_at(&working, pos)).unwrap_or(1);
        for (j, line) in old.lines().enumerate() {
            out.push_str(&format!("- {:>4} | {line}\n", start + j));
        }
        for (j, line) in new.lines().enumerate() {
            out.push_str(&format!("+ {:>4} | {line}\n", start + j));
        }
        if let Some(pos) = working.find(old) {
            working.replace_range(pos..pos + old.len(), new);
        }
    }
    out.trim_end().to_string()
}

/// Whole-file `+` preview for a write, headed by created/overwrote, each line
/// numbered by its position in the new content. Display-only; the TUI
/// collapses long output.
fn render_write_diff(prior: Option<&str>, content: &str) -> String {
    let mut out = String::from(if prior.is_some() {
        "@@ overwrote file @@\n"
    } else {
        "@@ created file @@\n"
    });
    for (i, line) in content.lines().enumerate() {
        out.push_str(&format!("+ {:>4} | {line}\n", i + 1));
    }
    out.trim_end().to_string()
}

/// `.jan/agent/<kind>` directory for the agent's own workspace.
pub(crate) fn workspace_dir(root: &Path, kind: &str) -> PathBuf {
    root.join(".jan").join("agent").join(kind)
}

/// Sanitize a caller-supplied entry name into a safe `<stem>.md` filename.
/// Rejects path separators and `..` so the result can never escape the
/// workspace. `.md` is appended if absent.
pub(crate) fn workspace_filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.split('.').any(|seg| seg == ".")
        || trimmed.contains("..")
    {
        return Err(format!("ERROR: invalid name '{name}'"));
    }
    let stem = trimmed.strip_suffix(".md").unwrap_or(trimmed);
    Ok(format!("{stem}.md"))
}

/// The project's enabled-skill whitelist (`[skills].enabled`; empty = all).
/// A missing/malformed config falls back to "all enabled".
fn enabled_skills(root: &Path) -> Vec<String> {
    load_agent_config(root)
        .ok()
        .map(|c| c.skills.enabled)
        .unwrap_or_default()
}

/// `skill_list` tool: catalog of `name — description` lines for ENABLED skills
/// only (disabled skills must stay invisible to the model). Empty if none.
fn skill_list(root: &Path) -> String {
    let enabled = enabled_skills(root);
    skills::catalog(root, &enabled)
        .iter()
        .map(|m| {
            if m.description.is_empty() {
                m.name.clone()
            } else {
                format!("{} — {}", m.name, m.description)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `skill_read` tool: a skill's full instructions (frontmatter stripped). A
/// disabled skill is treated as absent so it never reaches the model.
fn skill_read(args: &serde_json::Value, root: &Path) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    if !skills::is_enabled(&enabled_skills(root), name) {
        return format!("ERROR: skill '{name}' not found");
    }
    match skills::read_body(root, name) {
        Ok(body) => body,
        Err(e) => e,
    }
}

/// `skill_write` tool: create/update a skill (new ones as `<name>/SKILL.md`).
fn skill_write(args: &serde_json::Value, root: &Path) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    match skills::write(root, name, content) {
        Ok(()) => format!("Wrote skill '{name}'"),
        Err(e) => e,
    }
}

async fn workspace_list(root: &Path, kind: &str) -> String {
    let dir = workspace_dir(root, kind);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return String::new(),
    };
    let mut names: Vec<String> = Vec::new();
    while let Ok(Some(e)) = entries.next_entry().await {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    names.join("\n")
}

async fn workspace_read(args: &serde_json::Value, root: &Path, kind: &str) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    let file = match workspace_filename(name) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let target = workspace_dir(root, kind).join(file);
    match tokio::fs::read_to_string(&target).await {
        Ok(c) => c,
        Err(e) => format!("ERROR: {e}"),
    }
}

async fn workspace_write(args: &serde_json::Value, root: &Path, kind: &str) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    let file = match workspace_filename(name) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let dir = workspace_dir(root, kind);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return format!("ERROR: {e}");
    }
    let target = dir.join(&file);
    match tokio::fs::write(&target, content).await {
        Ok(()) => format!("Wrote {} bytes to {kind}/{file}", content.len()),
        Err(e) => format!("ERROR: {e}"),
    }
}

async fn read(args: &serde_json::Value, root: &Path) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let offset = arg_u64(args, "offset").map(|v| v as usize);
    let limit = arg_u64(args, "limit").map(|v| v as usize);
    let target = resolve(root, path);

    let bytes = match tokio::fs::read(&target).await {
        Ok(b) => b,
        Err(e) => return format!("ERROR: {e}"),
    };
    let content = match String::from_utf8(bytes) {
        Ok(c) => c,
        Err(_) => return "ERROR: not a UTF-8 text file".to_string(),
    };

    let selected = if offset.is_some() || limit.is_some() {
        let lines: Vec<&str> = content.split('\n').collect();
        let start = offset.map(|o| o.saturating_sub(1)).unwrap_or(0);
        if start >= lines.len() {
            return format!(
                "ERROR: offset {} is beyond end of file ({} lines total)",
                offset.unwrap_or(1),
                lines.len()
            );
        }
        let end = match limit {
            Some(l) => (start + l).min(lines.len()),
            None => lines.len(),
        };
        lines[start..end].join("\n")
    } else {
        content
    };

    cap_output(
        &selected,
        MAX_LINES,
        MAX_BYTES,
        "\n[truncated: use offset/limit to read more]",
    )
}

async fn ls(args: &serde_json::Value, root: &Path) -> String {
    let path = arg_str(args, "path").unwrap_or(".");
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(LS_DEFAULT_LIMIT);
    let mut entries = match tokio::fs::read_dir(resolve(root, path)).await {
        Ok(rd) => rd,
        Err(e) => return format!("ERROR: {e}"),
    };
    let mut names: Vec<String> = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                let mut name = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    name.push('/');
                }
                names.push(name);
            }
            Ok(None) => break,
            Err(e) => return format!("ERROR: {e}"),
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    let entry_limited = names.len() > limit;
    names.truncate(limit);
    let mut joined = names.join("\n");
    if entry_limited {
        joined.push_str(&format!("\n[truncated: {limit} entry limit]"));
    }
    cap_output(&joined, usize::MAX, MAX_BYTES, "\n[truncated: 64KB limit]")
}

async fn write(args: &serde_json::Value, root: &Path) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    let target = resolve(root, path);
    if let Some(parent) = target.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return format!("ERROR: {e}");
        }
    }
    match tokio::fs::write(&target, content).await {
        Ok(()) => format!("Wrote {} bytes to {}", content.len(), path),
        Err(e) => format!("ERROR: {e}"),
    }
}

async fn edit(args: &serde_json::Value, root: &Path) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(edits) = args.get("edits").and_then(|v| v.as_array()) else {
        return "ERROR: missing required argument 'edits'".to_string();
    };
    if edits.is_empty() {
        return "ERROR: edits must contain at least one replacement".to_string();
    }
    let target = resolve(root, path);
    let mut content = match tokio::fs::read_to_string(&target).await {
        Ok(c) => c,
        Err(e) => return format!("ERROR: {e}"),
    };

    for (i, e) in edits.iter().enumerate() {
        let Some(old_string) = e.get("old_string").and_then(|v| v.as_str()) else {
            return format!("ERROR: edit {}: missing 'old_string'", i + 1);
        };
        let Some(new_string) = e.get("new_string").and_then(|v| v.as_str()) else {
            return format!("ERROR: edit {}: missing 'new_string'", i + 1);
        };
        let count = content.matches(old_string).count();
        if count == 0 {
            return format!("ERROR: edit {}: old_string not found", i + 1);
        }
        if count > 1 {
            return format!(
                "ERROR: edit {}: old_string not unique ({count} matches)",
                i + 1
            );
        }
        content = content.replacen(old_string, new_string, 1);
    }

    match tokio::fs::write(&target, content).await {
        Ok(()) => format!("Applied {} edit(s) to {}", edits.len(), path),
        Err(e) => format!("ERROR: {e}"),
    }
}

async fn bash(args: &serde_json::Value, root: &Path) -> String {
    if let Some(job_id) = arg_str(args, "job_id") {
        return await_bash_job(job_id).await;
    }
    let Some(command) = arg_str(args, "command") else {
        return "ERROR: missing required argument 'command' (or 'job_id' to poll a backgrounded job)"
            .to_string();
    };
    let timeout_secs = arg_u64(args, "timeout").unwrap_or(DEFAULT_BASH_TIMEOUT_SECS);

    if !root.is_dir() {
        return format!(
            "ERROR: working directory does not exist: {}",
            root.display()
        );
    }

    let child = match proc::spawn(proc::shell(), command, root).await {
        Ok(c) => c,
        Err(e) => return format!("ERROR: failed to run command: {e}"),
    };
    let pid = child.id();

    // The child is handed to a detached task immediately so it keeps running
    // (and its output keeps being collected) no matter what the race below
    // does; only the *receiver* end is at risk of being dropped on timeout.
    // The child's pid stays registered until the task ends so a shutdown can
    // reap its whole process tree if it is still running.
    let (tx, mut rx) = oneshot::channel();
    tokio::spawn(async move {
        let out = collect_and_format(child).await;
        if let Some(pid) = pid {
            proc::unregister(pid);
        }
        let _ = tx.send(out);
    });

    tokio::select! {
        res = &mut rx => res.unwrap_or_else(|_| "ERROR: background command ended without producing output".to_string()),
        _ = tokio::time::sleep(std::time::Duration::from_secs(timeout_secs)) => {
            let job_id = format!("bash-{}", BASH_JOB_COUNTER.fetch_add(1, Ordering::SeqCst));
            bash_jobs().lock().unwrap().insert(job_id.clone(), rx);
            format!(
                "Command exceeded {timeout_secs}s and is continuing in the background \
                 (job_id={job_id}). Call bash again with {{\"job_id\": \"{job_id}\"}} (no \
                 command) to wait for and collect its output once it finishes."
            )
        }
    }
}

/// Wait for a previously backgrounded command to finish and return its
/// (already-formatted) output, or an error if `job_id` is unknown or was
/// already collected.
async fn await_bash_job(job_id: &str) -> String {
    let rx = bash_jobs().lock().unwrap().remove(job_id);
    match rx {
        Some(rx) => rx
            .await
            .unwrap_or_else(|_| "ERROR: background command ended without producing output".to_string()),
        None => format!("ERROR: unknown or already-collected job_id '{job_id}'"),
    }
}

/// Drain a running child's stdout+stderr into a bounded rolling buffer (so a
/// runaway command cannot exhaust memory), then format the result. Output is
/// combined chronologically and spilled to a temp file once it outgrows the
/// in-memory window, so the full text stays readable even though only a bounded
/// tail is kept in RAM.
async fn collect_and_format(mut child: tokio::process::Child) -> String {
    use tokio::io::AsyncReadExt;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut cap = BashCapture::new();
    let mut bo = vec![0u8; 8192];
    let mut be = vec![0u8; 8192];
    let mut out_open = stdout.is_some();
    let mut err_open = stderr.is_some();
    while out_open || err_open {
        tokio::select! {
            r = stdout.as_mut().unwrap().read(&mut bo), if out_open => match r {
                Ok(0) | Err(_) => out_open = false,
                Ok(n) => cap.push(&bo[..n]),
            },
            r = stderr.as_mut().unwrap().read(&mut be), if err_open => match r {
                Ok(0) | Err(_) => err_open = false,
                Ok(n) => cap.push(&be[..n]),
            },
        }
    }
    match child.wait().await {
        Ok(status) => cap.finish(status.code()),
        Err(e) => format!("ERROR: failed to run command: {e}"),
    }
}

/// Bounded, tail-preserving accumulator for a command's combined output.
/// Keeps only the last [`BASH_MAX_BYTES`] raw bytes in memory; once total
/// output exceeds that window it spills every byte to a temp file so nothing
/// is lost while memory stays bounded.
struct BashCapture {
    tail: std::collections::VecDeque<u8>,
    total_bytes: usize,
    total_newlines: usize,
    spill: Option<std::io::BufWriter<std::fs::File>>,
    spill_path: Option<PathBuf>,
}

impl BashCapture {
    fn new() -> Self {
        BashCapture {
            tail: std::collections::VecDeque::new(),
            total_bytes: 0,
            total_newlines: 0,
            spill: None,
            spill_path: None,
        }
    }

    fn push(&mut self, chunk: &[u8]) {
        use std::io::Write;
        // Open the spill file the moment the window would overflow: at that
        // point `tail` still holds every byte seen so far (nothing dropped
        // yet), so dumping it captures the full prefix before we start
        // dropping from the front.
        if self.spill.is_none() && self.tail.len() + chunk.len() > BASH_MAX_BYTES {
            let path = new_temp_path();
            if let Ok(file) = std::fs::File::create(&path) {
                let mut w = std::io::BufWriter::new(file);
                let (a, b) = self.tail.as_slices();
                let _ = w.write_all(a);
                let _ = w.write_all(b);
                self.spill = Some(w);
                self.spill_path = Some(path);
            }
        }
        if let Some(w) = self.spill.as_mut() {
            let _ = w.write_all(chunk);
        }
        self.total_bytes += chunk.len();
        self.total_newlines += bytecount_newlines(chunk);
        self.tail.extend(chunk.iter().copied());
        while self.tail.len() > BASH_MAX_BYTES {
            self.tail.pop_front();
        }
    }

    fn finish(mut self, code: Option<i32>) -> String {
        use std::io::Write;
        if let Some(w) = self.spill.as_mut() {
            let _ = w.flush();
        }
        let retained = String::from_utf8_lossy(self.tail.make_contiguous()).into_owned();
        let collapsed = sanitize_control(&collapse_carriage_returns(&retained));
        let capped = tail_cap(&collapsed, BASH_MAX_LINES, BASH_MAX_BYTES);
        let shown_lines = capped.matches('\n').count();
        // Truncated when the model-facing output lost real lines (front dropped)
        // or bytes (tail cap). CR-only progress redraws collapse to a single
        // line, so they read as complete rather than truncated.
        let truncated = self.total_newlines > shown_lines || capped.len() < collapsed.len();

        // Always emit an explicit exit marker on its own line. A bare exit code
        // (including 0) is the only reliable success signal: commands like
        // `git push` write their normal status to stderr on success, so stderr
        // text must not be read as failure.
        let mut body = capped;
        if !body.is_empty() && !body.ends_with('\n') {
            body.push('\n');
        }
        match code {
            Some(code) => body.push_str(&format!("[exit {code}]")),
            None => body.push_str("[terminated by signal]"),
        }

        if !truncated {
            if let Some(p) = self.spill_path.take() {
                let _ = std::fs::remove_file(p);
            }
            return body;
        }

        let path = match self.spill_path.take() {
            Some(p) => Some(p.to_string_lossy().into_owned()),
            None => write_temp_output(&collapsed),
        };
        match path {
            Some(p) => format!(
                "{body}\n[output truncated at {} of {} bytes; full output written \
                 to {p}. Use the read tool (with offset/limit) on that path to see \
                 the rest]",
                body.len(),
                self.total_bytes,
            ),
            None => format!(
                "{body}\n[output truncated at {} of {} bytes]",
                body.len(),
                self.total_bytes,
            ),
        }
    }
}

fn bytecount_newlines(bytes: &[u8]) -> usize {
    bytes.iter().filter(|&&b| b == b'\n').count()
}

/// Drop control characters that would corrupt the model's view of the output
/// (NUL, bell, ANSI escapes, etc.), keeping only tab and newline. Carriage
/// returns are already resolved by [`collapse_carriage_returns`] beforehand.
fn sanitize_control(s: &str) -> String {
    if !s.chars().any(|c| c.is_control() && c != '\t' && c != '\n') {
        return s.to_string();
    }
    s.chars()
        .filter(|&c| !c.is_control() || c == '\t' || c == '\n')
        .collect()
}

/// Keep the last `max_lines` lines and last `max_bytes` bytes of `s` (trimming
/// at a UTF-8 boundary). Unlike [`cap_output`], this preserves the *end* of the
/// output so a command's final result and error lines survive truncation.
fn tail_cap(s: &str, max_lines: usize, max_bytes: usize) -> String {
    let lines: Vec<&str> = s.split_inclusive('\n').collect();
    let kept = if lines.len() > max_lines {
        &lines[lines.len() - max_lines..]
    } else {
        &lines[..]
    };
    let mut out: String = kept.concat();
    if out.len() > max_bytes {
        let mut cut = out.len() - max_bytes;
        while cut < out.len() && !out.is_char_boundary(cut) {
            cut += 1;
        }
        out = out[cut..].to_string();
    }
    out
}

fn new_temp_path() -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!("jan-bash-{}-{}.txt", std::process::id(), n))
}

/// Write `content` to a uniquely named temp file, returning its path on success.
fn write_temp_output(content: &str) -> Option<String> {
    let path = new_temp_path();
    std::fs::write(&path, content).ok()?;
    Some(path.to_string_lossy().into_owned())
}

async fn find(args: &serde_json::Value, root: &Path) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(FIND_DEFAULT_LIMIT);
    let base = resolve(root, &path);
    let root_owned = root.to_path_buf();

    let Some(pattern) = pattern else {
        return "ERROR: missing required argument 'pattern'".to_string();
    };
    let res = tokio::task::spawn_blocking(move || {
        let pat = match glob::Pattern::new(&pattern) {
            Ok(p) => p,
            Err(e) => return format!("ERROR: invalid pattern: {e}"),
        };
        let opts = glob::MatchOptions {
            case_sensitive: true,
            require_literal_separator: false,
            require_literal_leading_dot: false,
        };
        let mut matches: Vec<String> = Vec::new();
        for entry in WalkBuilder::new(&base)
            .hidden(false)
            .require_git(false)
            .build()
            .flatten()
        {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(true) {
                continue;
            }
            if is_restricted_agent_path(&root_owned, &entry.path().to_string_lossy()) {
                continue;
            }
            let rel = rel_to(&base, entry.path());
            if pat.matches_with(&rel, opts) {
                matches.push(rel);
                if matches.len() >= limit {
                    break;
                }
            }
        }
        if matches.is_empty() {
            "No matches.".to_string()
        } else {
            matches.join("\n")
        }
    })
    .await;
    res.unwrap_or_else(|e| format!("ERROR: {e}"))
}

async fn grep(args: &serde_json::Value, root: &Path) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let glob_filter = arg_str(args, "glob").map(String::from);
    let ignore_case = arg_bool(args, "ignore_case");
    let literal = arg_bool(args, "literal");
    let context = arg_u64(args, "context").map(|v| v as usize).unwrap_or(0);
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(GREP_DEFAULT_LIMIT);
    let base = resolve(root, &path);
    let root_owned = root.to_path_buf();

    let Some(pattern) = pattern else {
        return "ERROR: missing required argument 'pattern'".to_string();
    };
    let res = tokio::task::spawn_blocking(move || {
        let effective = if literal {
            regex::escape(&pattern)
        } else {
            pattern.clone()
        };
        let re = match regex::RegexBuilder::new(&effective)
            .case_insensitive(ignore_case)
            .build()
        {
            Ok(r) => r,
            Err(e) => return format!("ERROR: invalid pattern: {e}"),
        };
        let glob_pat = match &glob_filter {
            Some(g) => match glob::Pattern::new(g) {
                Ok(p) => Some(p),
                Err(e) => return format!("ERROR: invalid glob: {e}"),
            },
            None => None,
        };

        let is_file = base.is_file();
        let mut matches: Vec<String> = Vec::new();
        let mut count = 0usize;

        let mut search_file = |file: &Path, rel_base: &Path| -> bool {
            if let Some(gp) = &glob_pat {
                let rel = rel_to(rel_base, file);
                if !gp.matches(&rel)
                    && !gp.matches(
                        &file
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                    )
                {
                    return true;
                }
            }
            let content = match std::fs::read_to_string(file) {
                Ok(c) => c,
                Err(_) => return true,
            };
            let rel = rel_to(rel_base, file);
            let lines: Vec<&str> = content.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if re.is_match(line) {
                    if context > 0 {
                        let start = i.saturating_sub(context);
                        let end = (i + context + 1).min(lines.len());
                        for (j, item) in lines.iter().enumerate().take(end).skip(start) {
                            let text = truncate_line(item);
                            if j == i {
                                matches.push(format!("{rel}:{}:{text}", j + 1));
                            } else {
                                matches.push(format!("{rel}-{}-{text}", j + 1));
                            }
                        }
                    } else {
                        matches.push(format!("{rel}:{}:{}", i + 1, truncate_line(line)));
                    }
                    count += 1;
                    if count >= limit {
                        return false;
                    }
                }
            }
            true
        };

        if is_file {
            let rel_base = base.parent().unwrap_or(&base);
            search_file(&base, rel_base);
        } else {
            for entry in WalkBuilder::new(&base)
                .hidden(false)
                .require_git(false)
                .build()
                .flatten()
            {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(true) {
                    continue;
                }
                if is_restricted_agent_path(&root_owned, &entry.path().to_string_lossy()) {
                    continue;
                }
                if !search_file(entry.path(), &base) {
                    break;
                }
            }
        }

        if matches.is_empty() {
            "No matches.".to_string()
        } else {
            cap_output(
                &matches.join("\n"),
                usize::MAX,
                MAX_BYTES,
                "\n[truncated: 64KB limit]",
            )
        }
    })
    .await;
    res.unwrap_or_else(|e| format!("ERROR: {e}"))
}

fn truncate_line(line: &str) -> String {
    if line.chars().count() > GREP_MAX_LINE {
        let truncated: String = line.chars().take(GREP_MAX_LINE).collect();
        format!("{truncated}...")
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::tools::lookup;
    use serde_json::json;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("jan_handlers_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    #[tokio::test]
    async fn read_returns_contents() {
        let root = unique_root();
        std::fs::write(root.join("a.txt"), b"hello").unwrap();
        let out = execute_builtin(lookup("read").unwrap(), &json!({"path": "a.txt"}), &root).await;
        assert_eq!(out, "hello");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_with_offset_and_limit_slices_lines() {
        let root = unique_root();
        std::fs::write(root.join("lines.txt"), b"l1\nl2\nl3\nl4\nl5").unwrap();
        let out = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "lines.txt", "offset": 2, "limit": 2}),
            &root,
        )
        .await;
        assert_eq!(out, "l2\nl3");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_rejects_binary() {
        let root = unique_root();
        std::fs::write(root.join("bin"), [0xff, 0xfe, 0x00]).unwrap();
        let out = execute_builtin(lookup("read").unwrap(), &json!({"path": "bin"}), &root).await;
        assert!(out.starts_with("ERROR"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn write_then_read_roundtrips() {
        let root = unique_root();
        let w = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "sub/b.txt", "content": "data"}),
            &root,
        )
        .await;
        assert!(w.starts_with("Wrote"), "unexpected: {w}");
        let r = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "sub/b.txt"}),
            &root,
        )
        .await;
        assert_eq!(r, "data");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_applies_two_edits_atomically() {
        let root = unique_root();
        std::fs::write(root.join("c.txt"), b"foo bar baz").unwrap();
        let ok = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "c.txt", "edits": [
                {"old_string": "foo", "new_string": "FOO"},
                {"old_string": "baz", "new_string": "BAZ"}
            ]}),
            &root,
        )
        .await;
        assert_eq!(ok, "Applied 2 edit(s) to c.txt");
        assert_eq!(
            std::fs::read_to_string(root.join("c.txt")).unwrap(),
            "FOO bar BAZ"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_errors_without_partial_write() {
        let root = unique_root();
        std::fs::write(root.join("d.txt"), b"one two two").unwrap();
        // First edit ok, second not unique -> whole op fails, file unchanged.
        let out = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "d.txt", "edits": [
                {"old_string": "one", "new_string": "ONE"},
                {"old_string": "two", "new_string": "TWO"}
            ]}),
            &root,
        )
        .await;
        assert!(
            out.starts_with("ERROR: edit 2: old_string not unique"),
            "unexpected: {out}"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("d.txt")).unwrap(),
            "one two two"
        );

        let miss = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "d.txt", "edits": [{"old_string": "nope", "new_string": "x"}]}),
            &root,
        )
        .await;
        assert!(
            miss.starts_with("ERROR: edit 1: old_string not found"),
            "unexpected: {miss}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn edit_diff_single_hunk_has_no_header() {
        let d = render_edit_diff(&[json!({"old_string": "foo", "new_string": "bar"})], "foo");
        assert_eq!(d, "-    1 | foo\n+    1 | bar");
    }

    #[test]
    fn edit_diff_multi_hunk_is_numbered_and_multiline() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "a\nb", "new_string": "A"}),
                json!({"old_string": "c", "new_string": "C\nD"}),
            ],
            "a\nb\nc",
        );
        assert_eq!(
            d,
            "@@ edit 1/2 @@\n-    1 | a\n-    2 | b\n+    1 | A\n@@ edit 2/2 @@\n-    2 | c\n+    2 | C\n+    3 | D"
        );
    }

    #[test]
    fn edit_diff_numbers_against_real_file_position() {
        let d = render_edit_diff(
            &[json!({"old_string": "two", "new_string": "TWO"})],
            "one\ntwo\nthree",
        );
        assert_eq!(d, "-    2 | two\n+    2 | TWO");
    }

    #[test]
    fn write_diff_headers_created_vs_overwrote() {
        assert_eq!(
            render_write_diff(None, "x\ny"),
            "@@ created file @@\n+    1 | x\n+    2 | y"
        );
        assert_eq!(
            render_write_diff(Some("old"), "x"),
            "@@ overwrote file @@\n+    1 | x"
        );
    }

    #[tokio::test]
    async fn preview_diff_does_not_write_and_matches_execution_diff() {
        let root = unique_root();
        // edit preview reads the current file to number the hunk, but never writes.
        std::fs::write(root.join("p.txt"), b"foo").unwrap();
        let edit_preview = preview_diff(
            lookup("edit").unwrap(),
            &json!({"path": "p.txt", "edits": [{"old_string": "foo", "new_string": "bar"}]}),
            &root,
        )
        .await;
        assert_eq!(edit_preview.as_deref(), Some("-    1 | foo\n+    1 | bar"));
        assert_eq!(std::fs::read_to_string(root.join("p.txt")).unwrap(), "foo");

        // write preview reflects prior-file state and does not create the file.
        let write_preview = preview_diff(
            lookup("write").unwrap(),
            &json!({"path": "new.txt", "content": "hello"}),
            &root,
        )
        .await;
        assert_eq!(
            write_preview.as_deref(),
            Some("@@ created file @@\n+    1 | hello")
        );
        assert!(!root.join("new.txt").exists(), "preview must not write");

        // non-mutating tools have no preview.
        assert!(preview_diff(lookup("read").unwrap(), &json!({"path": "x"}), &root)
            .await
            .is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_with_diff_appends_hunks_to_model_content() {
        let root = unique_root();
        std::fs::write(root.join("e.txt"), b"foo").unwrap();
        let (content, diff) = execute_builtin_with_diff(
            lookup("edit").unwrap(),
            &json!({"path": "e.txt", "edits": [{"old_string": "foo", "new_string": "bar"}]}),
            &root,
        )
        .await;
        assert_eq!(
            content,
            "Applied 1 edit(s) to e.txt\n\n-    1 | foo\n+    1 | bar"
        );
        assert_eq!(diff.as_deref(), Some("-    1 | foo\n+    1 | bar"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn write_with_diff_keeps_content_concise() {
        let root = unique_root();
        let (content, diff) = execute_builtin_with_diff(
            lookup("write").unwrap(),
            &json!({"path": "w.txt", "content": "hello"}),
            &root,
        )
        .await;
        assert!(content.starts_with("Wrote"), "unexpected: {content}");
        assert!(!content.contains('+'), "write content must stay concise");
        assert_eq!(
            diff.as_deref(),
            Some("@@ created file @@\n+    1 | hello")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_error_yields_no_diff() {
        let root = unique_root();
        std::fs::write(root.join("err.txt"), b"foo").unwrap();
        let (content, diff) = execute_builtin_with_diff(
            lookup("edit").unwrap(),
            &json!({"path": "err.txt", "edits": [{"old_string": "nope", "new_string": "x"}]}),
            &root,
        )
        .await;
        assert!(content.starts_with("ERROR"), "unexpected: {content}");
        assert!(diff.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn ls_lists_created_file() {
        let root = unique_root();
        std::fs::write(root.join("listed.txt"), b"x").unwrap();
        let out = execute_builtin(lookup("ls").unwrap(), &json!({}), &root).await;
        assert!(out.contains("listed.txt"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn find_glob_respects_gitignore() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("keep")).unwrap();
        std::fs::create_dir_all(root.join("skip")).unwrap();
        std::fs::write(root.join("keep/a.txt"), b"x").unwrap();
        std::fs::write(root.join("skip/b.txt"), b"x").unwrap();
        std::fs::write(root.join(".gitignore"), b"skip/\n").unwrap();
        let out = execute_builtin(
            lookup("find").unwrap(),
            &json!({"pattern": "**/*.txt"}),
            &root,
        )
        .await;
        assert!(out.contains("keep/a.txt"), "should include keep: {out}");
        assert!(
            !out.contains("skip/b.txt"),
            "should exclude gitignored skip: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn find_does_not_leak_restricted_agent_tree() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent/threads/t1")).unwrap();
        std::fs::write(root.join(".jan/agent/threads/t1/thread.json"), b"{}").unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"[tools]\n").unwrap();
        std::fs::write(root.join(".jan/agent/AGENT.md"), b"instructions").unwrap();
        std::fs::write(root.join("README.md"), b"x").unwrap();
        let out = execute_builtin(
            lookup("find").unwrap(),
            &json!({"pattern": "**/*"}),
            &root,
        )
        .await;
        assert!(out.contains("README.md"), "should include project file: {out}");
        assert!(
            out.contains(".jan/agent/AGENT.md"),
            "AGENT.md is readable, should be listed: {out}"
        );
        assert!(
            !out.contains("thread.json"),
            "must not leak thread storage: {out}"
        );
        assert!(
            !out.contains("agent.toml"),
            "must not leak agent config: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn grep_does_not_leak_restricted_agent_contents() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent/threads/t1")).unwrap();
        std::fs::write(
            root.join(".jan/agent/threads/t1/messages.jsonl"),
            b"SECRET_MARKER thread content",
        )
        .unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"SECRET_MARKER config").unwrap();
        std::fs::write(root.join("README.md"), b"SECRET_MARKER readme").unwrap();
        let out = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "SECRET_MARKER"}),
            &root,
        )
        .await;
        assert!(out.contains("README.md"), "should match project file: {out}");
        assert!(
            !out.contains("messages.jsonl"),
            "must not grep thread storage: {out}"
        );
        assert!(
            !out.contains("agent.toml"),
            "must not grep agent config: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn grep_regex_and_literal_and_ignore_case() {
        let root = unique_root();
        std::fs::write(
            root.join("code.rs"),
            b"fn main() {}\nLet x = 1.5;\nother line",
        )
        .unwrap();

        let re = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "fn \\w+"}),
            &root,
        )
        .await;
        assert!(re.contains("code.rs:1:fn main"), "regex: {re}");

        // Literal: "1.5" as regex would match "1x5" too; literal must match exactly.
        let lit = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "1.5", "literal": true}),
            &root,
        )
        .await;
        assert!(lit.contains("code.rs:2:"), "literal: {lit}");

        let ci = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "let", "ignore_case": true}),
            &root,
        )
        .await;
        assert!(ci.contains("code.rs:2:"), "ignore_case: {ci}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn grep_invalid_pattern_errors() {
        let root = unique_root();
        std::fs::write(root.join("f.txt"), b"x").unwrap();
        let out = execute_builtin(lookup("grep").unwrap(), &json!({"pattern": "("}), &root).await;
        assert!(
            out.starts_with("ERROR: invalid pattern"),
            "unexpected: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_exceeding_timeout_backgrounds_instead_of_erroring() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "sleep 2", "timeout": 0}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(out.contains("continuing in the background"), "{out}");
        assert!(out.contains("job_id=bash-"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_job_id_waits_for_and_collects_background_output() {
        let root = unique_root();
        let started = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "sleep 0.2; echo done", "timeout": 0}),
            &root,
        )
        .await;
        let job_id = started
            .split("job_id=")
            .nth(1)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap()
            .trim_end_matches(|c: char| !c.is_alphanumeric());

        let collected = execute_builtin(lookup("bash").unwrap(), &json!({"job_id": job_id}), &root).await;
        assert!(collected.contains("done"), "unexpected: {collected}");

        // The job is removed once collected.
        let again = execute_builtin(lookup("bash").unwrap(), &json!({"job_id": job_id}), &root).await;
        assert!(
            again.starts_with("ERROR: unknown or already-collected"),
            "unexpected: {again}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_unknown_job_id_errors() {
        let root = unique_root();
        let out = execute_builtin(lookup("bash").unwrap(), &json!({"job_id": "nope"}), &root).await;
        assert!(
            out.starts_with("ERROR: unknown or already-collected"),
            "unexpected: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_missing_command_and_job_id_errors() {
        let root = unique_root();
        let out = execute_builtin(lookup("bash").unwrap(), &json!({}), &root).await;
        assert!(out.starts_with("ERROR: missing required argument"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_nonzero_exit_is_not_error() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "echo hi; exit 3"}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(out.contains("hi"), "unexpected: {out}");
        assert!(out.contains("[exit 3]"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_success_emits_exit_0_marker() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "echo done"}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(out.contains("done"), "unexpected: {out}");
        assert!(out.contains("[exit 0]"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_exit_marker_is_on_its_own_line() {
        let root = unique_root();
        // stderr-only output with no trailing newline (mirrors `git push`).
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "printf 'to remote' 1>&2"}),
            &root,
        )
        .await;
        assert!(out.contains("\n[exit 0]"), "marker not on its own line: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_output_past_old_64kb_cap_survives_intact() {
        let root = unique_root();
        // ~128KB of output: over the shared 64KB cap, under the bash cap.
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "for i in $(seq 1 2000); do printf '%064d\\n' \"$i\"; done"}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(!out.contains("[truncated"), "should not truncate: len={}", out.len());
        assert!(out.len() > 64 * 1024, "expected >64KB, got {}", out.len());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_cr_progress_is_collapsed_not_truncated() {
        let root = unique_root();
        // Mimics git progress: one logical line redrawn thousands of times with
        // \r (no \n). Raw bytes exceed the byte cap, but only the final redraw
        // is visible, so the model must see it intact with no truncation notice.
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "for i in $(seq 1 30000); do printf 'Receiving objects: %d\\r' \"$i\"; done 1>&2"}),
            &root,
        )
        .await;
        assert!(!out.contains("output truncated"), "spurious truncation: {out}");
        assert!(out.contains("Receiving objects: 30000"), "final redraw lost: {out}");
        assert!(out.contains("[exit 0]"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_output_overflow_spills_to_readable_temp_file() {
        let root = unique_root();
        // ~1MB of output: over the bash cap, so it must spill to a temp file
        // and tell the agent how to read the rest.
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "for i in $(seq 1 16000); do printf '%064d\\n' \"$i\"; done"}),
            &root,
        )
        .await;
        assert!(out.contains("output truncated at"), "unexpected: end of {out}");
        assert!(out.contains("Use the read tool"), "should guide the agent: {out}");
        let path = out
            .rsplit("full output written to ")
            .next()
            .and_then(|s| s.split(". Use the read tool").next())
            .unwrap_or("");
        let full = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": path, "offset": 15999, "limit": 1}),
            &root,
        )
        .await;
        assert!(full.contains("015999") || full.contains("016000"), "tail readable: {full}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_line_overflow_keeps_the_tail_not_the_head() {
        let root = unique_root();
        // 12000 short lines: over the 10000-line cap but under the byte cap.
        // Tail truncation must keep the LAST lines (final result/errors) and
        // drop the earliest ones.
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "for i in $(seq 1 12000); do echo \"L$i\"; done"}),
            &root,
        )
        .await;
        assert!(out.contains("output truncated at"), "should truncate: end of {out}");
        assert!(out.contains("\nL12000\n"), "last line must survive: end of {out}");
        assert!(!out.contains("\nL5\n"), "earliest lines must be dropped");
        assert!(out.contains("[exit 0]"), "exit marker must survive: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_strips_control_chars_but_keeps_text() {
        let root = unique_root();
        // NUL and bell around visible text plus an ANSI color escape.
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "printf 'a\\000b\\007\\033[31mred\\033[0m\\n'"}),
            &root,
        )
        .await;
        assert!(out.contains("red"), "text must survive sanitization: {out:?}");
        assert!(!out.contains('\u{0}'), "NUL must be stripped");
        assert!(!out.contains('\u{7}'), "bell must be stripped");
        assert!(!out.contains('\u{1b}'), "escape must be stripped");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_command_reading_stdin_does_not_hang() {
        let root = unique_root();
        // stdin is /dev/null, so a command that reads it gets immediate EOF and
        // returns instead of blocking the agent loop forever (e.g. a `sudo`
        // password prompt). The failure/output comes back as a normal result.
        let out = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            execute_builtin(
                lookup("bash").unwrap(),
                &json!({"command": "cat"}),
                &root,
            ),
        )
        .await
        .expect("must not hang on stdin read");
        assert!(out.contains("[exit 0]"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_missing_working_dir_errors() {
        let root = unique_root().join("does-not-exist");
        let out = execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "echo hi"}),
            &root,
        )
        .await;
        assert!(
            out.starts_with("ERROR: working directory does not exist"),
            "unexpected: {out}"
        );
    }

    #[tokio::test]
    async fn memory_write_read_list_roundtrip() {
        let root = unique_root();
        let w = execute_builtin(
            lookup("memory_write").unwrap(),
            &json!({"name": "drift", "content": "553 behind"}),
            &root,
        )
        .await;
        assert!(w.starts_with("Wrote"), "unexpected: {w}");
        // Landed at the canonical workspace path.
        assert_eq!(
            std::fs::read_to_string(root.join(".jan/agent/memory/drift.md")).unwrap(),
            "553 behind"
        );

        let r = execute_builtin(
            lookup("memory_read").unwrap(),
            &json!({"name": "drift"}),
            &root,
        )
        .await;
        assert_eq!(r, "553 behind");

        let l = execute_builtin(lookup("memory_list").unwrap(), &json!({}), &root).await;
        assert_eq!(l, "drift");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn skill_write_creates_folder_form_and_skill_read_returns_body() {
        let root = unique_root();
        let w = execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "deploy.md", "content": "steps"}),
            &root,
        )
        .await;
        assert!(w.contains("deploy"), "unexpected: {w}");
        // New skills are written as the folder form `<name>/SKILL.md`.
        assert!(root.join(".jan/agent/skills/deploy/SKILL.md").exists());

        // skill_read returns the body on demand (progressive disclosure).
        let r = execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "deploy"}),
            &root,
        )
        .await;
        assert_eq!(r, "steps");

        // skill_list surfaces the catalog line.
        let l = execute_builtin(lookup("skill_list").unwrap(), &json!({}), &root).await;
        assert!(l.contains("deploy"), "unexpected list: {l}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn skill_tools_hide_disabled_skills() {
        let root = unique_root();
        execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "on", "content": "on body"}),
            &root,
        )
        .await;
        execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "off", "content": "off body"}),
            &root,
        )
        .await;
        // Whitelist only "on".
        crate::core::agent::project::ensure_project(&root).unwrap();
        crate::core::agent::project::set_skills_enabled_in_agent_toml(
            &crate::core::agent::project::agent_toml_path(&root),
            &["on".to_string()],
        )
        .unwrap();

        let list = execute_builtin(lookup("skill_list").unwrap(), &json!({}), &root).await;
        assert!(list.contains("on"), "list: {list}");
        assert!(!list.contains("off body"), "disabled skill leaked: {list}");

        // Disabled skill is unreadable.
        let read_off = execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "off"}),
            &root,
        )
        .await;
        assert!(read_off.starts_with("ERROR"), "disabled read: {read_off}");

        // Enabled skill still readable.
        let read_on = execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "on"}),
            &root,
        )
        .await;
        assert_eq!(read_on, "on body");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn workspace_name_rejects_traversal() {
        let root = unique_root();
        for bad in ["../escape", "sub/x", "..", ""] {
            let out = execute_builtin(
                lookup("memory_write").unwrap(),
                &json!({"name": bad, "content": "x"}),
                &root,
            )
            .await;
            assert!(out.starts_with("ERROR"), "name {bad:?} should be rejected: {out}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
