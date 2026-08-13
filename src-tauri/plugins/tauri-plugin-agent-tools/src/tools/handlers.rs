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

use crate::memory;
use crate::skills;
use crate::tools::jail;
use crate::tools::proc;
use crate::tools::sandbox::{
    escapes_project, in_scratch, is_hidden_jan_path, lexical_normalize, resolve_path,
    scratch_display_path, symlink_escapes_root,
};
use crate::tools::{BuiltinTool, ToolContext};

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

/// How a mutated path is named back to the model: relative inside the project,
/// absolute once it escapes. Normalizes first, since `root/../x` strips to a
/// misleading `../x` against an un-normalized root. A target inside the session
/// scratch is named by whichever spelling the shell can also use there.
fn display_path(root: &Path, scratch: Option<&Path>, target: &Path) -> String {
    if in_scratch(scratch, target) {
        return scratch_display_path(scratch, target);
    }
    rel_to(&lexical_normalize(root), &lexical_normalize(target))
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
    ctx: &ToolContext<'_>,
) -> String {
    let project_root = ctx.project_root;
    let scratch = ctx.scratch_root;
    match tool.name {
        "read" => read(args, project_root, scratch).await,
        "ls" => ls(args, project_root, scratch).await,
        "write" => write(args, project_root, scratch, ctx.confine_writes).await,
        "edit" => edit(args, project_root, scratch, ctx.confine_writes).await,
        "bash" => bash(args, ctx).await,
        "find" => find(args, project_root, scratch).await,
        "grep" => grep(args, project_root, scratch).await,
        // Memory and skills live in the store root, not the sandbox: they must
        // outlive the conversation the filesystem tools are scoped to.
        "memory_list" => memory_list(ctx.store_root).await,
        "memory_read" => memory_read(args, ctx.store_root).await,
        "memory_write" => memory_write(args, ctx.store_root).await,
        // Skills go through the skills module so the tool honors the folder form
        // (`<name>/SKILL.md`) and frontmatter, matching what the UI writes.
        "skill_list" => skill_list(ctx),
        "skill_read" => skill_read(args, ctx),
        "skill_write" => skill_write(args, ctx),
        // Native web tools: compiled into the agent core, not an MCP server.
        "web_search" => crate::tools::web::web_search(args).await,
        "web_fetch" => crate::tools::web::web_fetch(args).await,
        other => format!("ERROR: unknown built-in tool '{other}'"),
    }
}

/// Focused diff previewing what a `write`/`edit` call would change, without
/// running it. Line-prefixed (`-`/`+`) hunk text with each line numbered against
/// its position in the file; `None` for other tools or when nothing would
/// change. Used to show the change in the permission prompt. Both variants read
/// the prior file: `write` to show its `created`/`overwrote` header, `edit` to
/// locate `old_string` and number the hunk against real file lines.
pub async fn preview_diff(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    ctx: &ToolContext<'_>,
) -> Option<String> {
    let project_root = ctx.project_root;
    let scratch = ctx.scratch_root;
    match tool.name {
        "edit" => {
            let edits = args.get("edits").and_then(|v| v.as_array())?;
            if edits.is_empty() {
                return None;
            }
            let prior = match arg_str(args, "path") {
                Some(p) => tokio::fs::read_to_string(resolve_path(project_root, scratch, p))
                    .await
                    .unwrap_or_default(),
                None => String::new(),
            };
            let d = render_edit_diff(edits, &prior);
            (!d.is_empty()).then_some(d)
        }
        "write" => {
            let prior = match arg_str(args, "path") {
                Some(p) => tokio::fs::read_to_string(resolve_path(project_root, scratch, p))
                    .await
                    .ok(),
                None => None,
            };
            let new = arg_str(args, "content").unwrap_or("");
            // A rewrite with identical content changes nothing; showing a full
            // `+` block would misrepresent it as an overwrite.
            if prior.as_deref() == Some(new) {
                return None;
            }
            Some(render_write_diff(prior.as_deref(), new))
        }
        _ => None,
    }
}

/// Run a built-in tool and, for `write`/`edit`, also produce a focused diff.
/// Returns `(content, diff)`. The diff is line-prefixed (`-`/`+`) hunk text for
/// **display only**: the model gets the concise summary in `content`, since the
/// hunk merely replays an edit it just authored and would cost context on every
/// mutating call. Diffs are computed against the pre-execution file so line
/// numbers match the file as the model saw it. `None` for non-mutating tools
/// and on error.
pub async fn execute_builtin_with_diff(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    ctx: &ToolContext<'_>,
) -> (String, Option<String>) {
    match tool.name {
        "write" | "edit" => {
            let diff = preview_diff(tool, args, ctx).await;
            let content = execute_builtin(tool, args, ctx).await;
            if content.starts_with("ERROR") {
                return (content, None);
            }
            (content, diff)
        }
        _ => (execute_builtin(tool, args, ctx).await, None),
    }
}

/// 1-based line number of the start of `pos` within `text`.
fn line_number_at(text: &str, pos: usize) -> usize {
    text[..pos].matches('\n').count() + 1
}

/// Lines of surrounding file context kept around a change, and the threshold
/// past which one edit's hunk is split with a `...` gap. Matches the feel of a
/// unified diff without the `@@ -a,b +c,d @@` range header (the existing
/// `@@ edit i/n @@` marker already identifies the hunk).
const DIFF_CONTEXT: usize = 2;

/// Per-edit hunks computed with a real line-level diff (`similar`), so a
/// one-line change inside a large `old_string`/`new_string` pair shows only the
/// lines that actually differ instead of the whole block as removed and
/// re-added. The compared blocks are widened from the raw arguments to whole
/// lines plus up to `DIFF_CONTEXT` unchanged lines taken from the file, so a
/// change is shown in place even when `old_string` carries no context of its
/// own. Deleted lines are numbered against the file before the edit, kept and
/// inserted lines against the file after it. Multiple edits are separated by
/// `@@ edit i/n @@` and applied in order so later edits number against the
/// state left by earlier ones, matching what `edit()` does.
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
        match working.find(old) {
            Some(pos) => {
                let (old_block, new_block, start) = expand_hunk(&working, pos, old, new);
                out.push_str(&render_hunk_diff(&old_block, &new_block, start));
                working.replace_range(pos..pos + old.len(), new);
            }
            // `edit()` will reject this call, but the arguments are still worth
            // showing; there is no file position to number them against.
            None => out.push_str(&render_hunk_diff(old, new, 1)),
        }
    }
    out.trim_end().to_string()
}

/// Widen the replacement of `old` at `pos` in `text` to whole lines plus
/// `DIFF_CONTEXT` lines of surrounding file context, returning the before and
/// after blocks and the 1-based line the blocks start at. Both blocks share the
/// context verbatim, so the diff renders it as unchanged lines; whole-line
/// bounds keep a match that starts or ends mid-line from being diffed against a
/// line fragment.
fn expand_hunk(text: &str, pos: usize, old: &str, new: &str) -> (String, String, usize) {
    let end = pos + old.len();
    let mut ctx_start = text[..pos].rfind('\n').map_or(0, |i| i + 1);
    for _ in 0..DIFF_CONTEXT {
        if ctx_start == 0 {
            break;
        }
        ctx_start = text[..ctx_start - 1].rfind('\n').map_or(0, |i| i + 1);
    }
    let mut ctx_end = text[end..].find('\n').map_or(text.len(), |i| end + i);
    for _ in 0..DIFF_CONTEXT {
        if ctx_end >= text.len() {
            break;
        }
        ctx_end = text[ctx_end + 1..]
            .find('\n')
            .map_or(text.len(), |i| ctx_end + 1 + i);
    }
    let old_block = text[ctx_start..ctx_end].to_string();
    let new_block = format!("{}{new}{}", &text[ctx_start..pos], &text[end..ctx_end]);
    (old_block, new_block, line_number_at(text, ctx_start))
}

/// Line-diff `old` against `new`, rendering each changed/context line with its
/// real line number (`start`-based on both sides, since old and new begin at
/// the same position). Groups distant changes with a `...` gap.
fn render_hunk_diff(old: &str, new: &str, start: usize) -> String {
    use similar::{ChangeTag, TextDiff};

    // `old_string`/`new_string` are exact source snippets and often lack a
    // trailing newline on their last line. `from_lines` tokenizes by keeping
    // each line's newline, so a shared last line would otherwise mismatch
    // (`"b"` vs `"b\n"`) and show as a spurious delete+insert instead of
    // context. Padding both sides equally doesn't change indices or output,
    // since `\n` is stripped again before each line is printed.
    let pad = |s: &str| {
        if s.is_empty() || s.ends_with('\n') {
            s.to_string()
        } else {
            format!("{s}\n")
        }
    };
    let (old, new) = (pad(old), pad(new));
    let diff = TextDiff::from_lines(&old, &new);
    let mut out = String::new();
    for (gi, group) in diff.grouped_ops(DIFF_CONTEXT).iter().enumerate() {
        if gi > 0 {
            out.push_str("      ...\n");
        }
        for op in group {
            for change in diff.iter_changes(op) {
                let text = change.value();
                let text = text.strip_suffix('\n').unwrap_or(text);
                match change.tag() {
                    // Numbered on the new side: context below an insertion or
                    // deletion has moved, and an old-side number there would
                    // run backwards against the `+` lines just above it.
                    ChangeTag::Equal => {
                        let line = start + change.new_index().unwrap_or(0);
                        out.push_str(&format!("  {line:>4} | {text}\n"));
                    }
                    ChangeTag::Delete => {
                        let line = start + change.old_index().unwrap_or(0);
                        out.push_str(&format!("- {line:>4} | {text}\n"));
                    }
                    ChangeTag::Insert => {
                        let line = start + change.new_index().unwrap_or(0);
                        out.push_str(&format!("+ {line:>4} | {text}\n"));
                    }
                }
            }
        }
    }
    out
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

/// `skill_list` tool: catalog of `name — description` lines for ENABLED skills
/// only (disabled skills must stay invisible to the model). Empty if none.
fn skill_list(ctx: &ToolContext<'_>) -> String {
    skills::catalog(ctx.store_root, ctx.enabled_skills)
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
/// disabled skill — or one with `disable-model-invocation: true` — is treated
/// as absent so it never reaches the model.
fn skill_read(args: &serde_json::Value, ctx: &ToolContext<'_>) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    if !skills::is_enabled(ctx.enabled_skills, name) {
        return format!("ERROR: skill '{name}' not found");
    }
    let raw = match skills::read_raw(ctx.store_root, name) {
        Ok(raw) => raw,
        Err(e) => return e,
    };
    let parsed = skills::parse(&raw);
    if !parsed.model_invocable {
        return format!("ERROR: skill '{name}' not found");
    }
    parsed.body
}

/// `skill_write` tool: create/update a skill (new ones as `<name>/SKILL.md`).
/// The `[skills].enabled` whitelist is honored for writes too: a disabled skill
/// is treated as read-only so the model cannot silently overwrite (or resurrect)
/// a skill the user has turned off or locked out of the catalog.
fn skill_write(args: &serde_json::Value, ctx: &ToolContext<'_>) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    if !skills::is_enabled(ctx.enabled_skills, name) {
        return format!("ERROR: skill '{name}' is disabled and read-only");
    }
    match skills::write(ctx.store_root, name, content) {
        Ok(()) => format!("Wrote skill '{name}'"),
        Err(e) => e,
    }
}

/// The memory tools delegate to `crate::memory` so the built-ins and the
/// management commands share one implementation.
async fn memory_list(store: &Path) -> String {
    memory::list(store).await.join("\n")
}

async fn memory_read(args: &serde_json::Value, store: &Path) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    match memory::read(store, name).await {
        Ok(content) => content,
        Err(e) => e,
    }
}

async fn memory_write(args: &serde_json::Value, store: &Path) -> String {
    let Some(name) = arg_str(args, "name") else {
        return "ERROR: missing required argument 'name'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    match memory::write(store, name, content).await {
        Ok(file) => format!("Wrote {} bytes to memory/{file}", content.len()),
        Err(e) => e,
    }
}

async fn read(args: &serde_json::Value, root: &Path, scratch: Option<&Path>) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let offset = arg_u64(args, "offset").map(|v| v as usize);
    let limit = arg_u64(args, "limit").map(|v| v as usize);
    let target = resolve_path(root, scratch, path);
    // Fail closed: a component swapped to a symlink after the gate validated
    // the path must not redirect the open out of the workspace.
    if symlink_escapes_root(root, scratch, &target) {
        return format!("ERROR: refused to read through a symlink out of the workspace: {path}");
    }

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

async fn ls(args: &serde_json::Value, root: &Path, scratch: Option<&Path>) -> String {
    let path = arg_str(args, "path").unwrap_or(".");
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(LS_DEFAULT_LIMIT);
    let target = resolve_path(root, scratch, path);
    // Names are content too: a symlinked directory would list a host directory.
    if symlink_escapes_root(root, scratch, &target) {
        return format!("ERROR: refused to list through a symlink out of the workspace: {path}");
    }
    let mut entries = match tokio::fs::read_dir(&target).await {
        Ok(rd) => rd,
        Err(e) => return format!("ERROR: {e}"),
    };
    let mut names: Vec<String> = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                // Hidden state is omitted, not reported-then-denied: an entry the
                // agent can never open is only an invitation to try.
                if is_hidden_jan_path(root, &entry.path().to_string_lossy()) {
                    continue;
                }
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

async fn write(args: &serde_json::Value, root: &Path, scratch: Option<&Path>, confine: bool) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    // Defense in depth: when the caller confines writes, re-canonicalize on the
    // canonical root (not the raw argument) so `..` and absolute paths are
    // caught even if the gate's decision was made against a stale view.
    let target = resolve_path(root, scratch, path);
    if confine && escapes_project(root, scratch, path).unwrap_or(true) {
        return format!("ERROR: refused to write outside the agent workspace: {path}");
    }
    // Report the resolved location, not the raw argument: an absolute or `../`
    // path lands outside the project and the model must see where it went.
    let shown = display_path(root, scratch, &target);
    // Re-validate before `create_dir_all`, not just before the write: a
    // concurrent sandboxed process can swap a path component between the gate
    // decision and this call, and creating the parents first would already have
    // made directories through the swapped link. Fail closed.
    if symlink_escapes_root(root, scratch, &target) {
        return format!("ERROR: refused to write through a symlink out of the workspace: {path}");
    }
    if let Some(parent) = target.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return format!("ERROR: {shown}: {e}");
        }
    }
    // Existence decides created/overwrote; a non-UTF8 file still exists, so it
    // must not be read_to_string's error path that answers that question.
    let existed = tokio::fs::try_exists(&target).await.unwrap_or(false);
    let unchanged = existed
        && tokio::fs::read_to_string(&target)
            .await
            .is_ok_and(|prior| prior == content);
    let bytes = content.len();
    match tokio::fs::write(&target, content).await {
        Ok(()) if unchanged => format!("No change: {shown} already had these {bytes} bytes"),
        Ok(()) if existed => format!("Overwrote {shown} ({bytes} bytes)"),
        Ok(()) => format!("Created {shown} ({bytes} bytes)"),
        Err(e) => format!("ERROR: {shown}: {e}"),
    }
}

async fn edit(args: &serde_json::Value, root: &Path, scratch: Option<&Path>, confine: bool) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(edits) = args.get("edits").and_then(|v| v.as_array()) else {
        return "ERROR: missing required argument 'edits'".to_string();
    };
    if edits.is_empty() {
        return "ERROR: edits must contain at least one replacement".to_string();
    }
    let target = resolve_path(root, scratch, path);
    if confine && escapes_project(root, scratch, path).unwrap_or(true) {
        return format!("ERROR: refused to edit outside the agent workspace: {path}");
    }
    let shown = display_path(root, scratch, &target);
    // Re-validate before the final read+write pair so a swapped symlink cannot
    // redirect either the read or the later write.
    if symlink_escapes_root(root, scratch, &target) {
        return format!("ERROR: refused to edit through a symlink out of the workspace: {path}");
    }
    let mut content = match tokio::fs::read_to_string(&target).await {
        Ok(c) => c,
        Err(e) => return format!("ERROR: {shown}: {e}"),
    };

    for (i, e) in edits.iter().enumerate() {
        let Some(old_string) = e.get("old_string").and_then(|v| v.as_str()) else {
            return format!("ERROR: {shown}: edit {}: missing 'old_string'", i + 1);
        };
        let Some(new_string) = e.get("new_string").and_then(|v| v.as_str()) else {
            return format!("ERROR: {shown}: edit {}: missing 'new_string'", i + 1);
        };
        let count = content.matches(old_string).count();
        if count == 0 {
            return format!("ERROR: {shown}: edit {}: old_string not found", i + 1);
        }
        if count > 1 {
            return format!(
                "ERROR: {shown}: edit {}: old_string not unique ({count} matches)",
                i + 1
            );
        }
        content = content.replacen(old_string, new_string, 1);
    }

    match tokio::fs::write(&target, content).await {
        Ok(()) => format!("Applied {} edit(s) to {shown}", edits.len()),
        Err(e) => format!("ERROR: {shown}: {e}"),
    }
}

async fn bash(args: &serde_json::Value, ctx: &ToolContext<'_>) -> String {
    if let Some(job_id) = arg_str(args, "job_id") {
        return await_bash_job(job_id).await;
    }
    let Some(command) = arg_str(args, "command") else {
        return "ERROR: missing required argument 'command' (or 'job_id' to poll a backgrounded job)"
            .to_string();
    };
    let timeout_secs = arg_u64(args, "timeout").unwrap_or(DEFAULT_BASH_TIMEOUT_SECS);

    let root = ctx.project_root;
    if !root.is_dir() {
        return format!(
            "ERROR: working directory does not exist: {}",
            root.display()
        );
    }

    let mut policy = jail::Policy::new(root, ctx.allow_network)
        .with_home_readonly(ctx.home_readonly)
        .with_hide_root(&root.join(crate::tools::sandbox::JAN_DIR));
    if let Some(mask) = ctx.mask_root {
        policy = policy.with_mask_root(mask);
    }
    if let Some(scratch) = ctx.scratch_root {
        policy = policy.with_scratch_root(scratch);
    }
    // With the sandbox off the shell is spawned bare, the way the user's own
    // terminal would: no wrapper, no policy, the real `$HOME` and `/tmp`. Only
    // a surface that opted in gets here (the CLI's `--sandbox`/`sandbox`
    // setting); the desktop never does, so `bash` there is still confined or
    // withheld. `policy` is still built either way -- it is what
    // `denial_hint` reads, and an unconfined command can still hit a plain
    // filesystem permission error worth explaining.
    let shell = if ctx.sandbox {
        // No confinement available means no shell: running unsandboxed would give
        // the command the whole machine, which is never what the caller asked for.
        let Some(wrapped) = jail::wrap(proc::shell(), &policy) else {
            return "ERROR: bash is unavailable because no OS sandbox could be established on \
                    this system. Use the read/ls/find/grep tools instead."
                .to_string();
        };
        wrapped
    } else {
        proc::shell().clone()
    };

    let sandbox_tmp = if ctx.sandbox {
        jail::scratch_env_path(jail::backend(), &policy)
    } else {
        None
    };
    let child = match proc::spawn(&shell, command, root, sandbox_tmp.as_deref()).await {
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
    let spill_scratch = ctx.scratch_root.map(Path::to_path_buf);
    let sandboxed = ctx.sandbox;
    tokio::spawn(async move {
        let mut out = collect_and_format(child, spill_scratch).await;
        // Appended inside the task so a backgrounded job carries the hint too.
        // `Permission denied` on its own tells the model nothing about *why*;
        // without this it retries the same command until it gives up. Only when
        // confined: unsandboxed, a denial is an ordinary filesystem permission
        // and the hint would name limits that are not in force.
        if sandboxed && bash_result_failed(&out) && jail::looks_denied(&out) {
            out.push_str(&jail::denial_hint(&policy));
        }
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
        Some(rx) => rx.await.unwrap_or_else(|_| {
            "ERROR: background command ended without producing output".to_string()
        }),
        None => format!("ERROR: unknown or already-collected job_id '{job_id}'"),
    }
}

/// Drain a running child's stdout+stderr into a bounded rolling buffer (so a
/// runaway command cannot exhaust memory), then format the result. Output is
/// combined chronologically and spilled to a temp file once it outgrows the
/// in-memory window, so the full text stays readable even though only a bounded
/// tail is kept in RAM.
async fn collect_and_format(mut child: tokio::process::Child, scratch: Option<PathBuf>) -> String {
    use tokio::io::AsyncReadExt;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut cap = BashCapture::new(scratch);
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
    scratch: Option<PathBuf>,
}

impl BashCapture {
    fn new(scratch: Option<PathBuf>) -> Self {
        BashCapture {
            tail: std::collections::VecDeque::new(),
            total_bytes: 0,
            total_newlines: 0,
            spill: None,
            spill_path: None,
            scratch,
        }
    }

    fn push(&mut self, chunk: &[u8]) {
        use std::io::Write;
        // Open the spill file the moment the window would overflow: at that
        // point `tail` still holds every byte seen so far (nothing dropped
        // yet), so dumping it captures the full prefix before we start
        // dropping from the front.
        if self.spill.is_none() && self.tail.len() + chunk.len() > BASH_MAX_BYTES {
            if let Some(path) = new_temp_path(self.scratch.as_deref()) {
                if let Ok(file) = open_spill_file(&path) {
                    let mut w = std::io::BufWriter::new(file);
                    let (a, b) = self.tail.as_slices();
                    let _ = w.write_all(a);
                    let _ = w.write_all(b);
                    self.spill = Some(w);
                    self.spill_path = Some(path);
                }
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
                remove_spill_file(&p);
            }
            return body;
        }

        let path = match self.spill_path.take() {
            Some(p) => Some(p),
            None => write_temp_output(&collapsed, self.scratch.as_deref()),
        }
        .map(|p| crate::tools::sandbox::scratch_display_path(self.scratch.as_deref(), &p));
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

/// True when a `bash` tool result reports failure via its exit marker: a
/// non-zero `[exit N]` or a signal termination. The marker is emitted by
/// [`BashCapture::finish`] on its own line and a truncation note may follow it,
/// so scan every line rather than only the tail. Model-facing content is
/// deliberately left unprefixed (a non-zero exit is not an "ERROR" string, since
/// commands like `grep`/`diff`/`test` exit non-zero without failing); this feeds
/// the display-only `is_error` flag so the TUI marks the call failed.
pub fn bash_result_failed(content: &str) -> bool {
    content.lines().any(|line| {
        let l = line.trim();
        if l == "[terminated by signal]" {
            return true;
        }
        l.strip_prefix("[exit ")
            .and_then(|r| r.strip_suffix(']'))
            .and_then(|n| n.parse::<i32>().ok())
            .is_some_and(|code| code != 0)
    })
}

impl Drop for BashCapture {
    /// Reclaim the spill file on any path that drops the capture without
    /// consuming it via `finish` (e.g. `child.wait()` erroring). `finish`
    /// clears `spill_path` for files it keeps or deletes itself, so this only
    /// fires on the leak paths.
    fn drop(&mut self) {
        if let Some(p) = self.spill_path.take() {
            remove_spill_file(&p);
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

/// Directory holding bash-output spill files: inside the session scratch when
/// there is one, so the file the truncation note points at is reachable by the
/// same `/tmp/jan-bash/...` name from both the filesystem tools and the shell,
/// and is reclaimed when the session's scratch is removed.
///
/// The directory is validated as a real, non-symlink directory before use: the
/// sandboxed shell can write the scratch, so it could have redirected `jan-bash`
/// at a host directory. Refuse to spill through a redirect (returning `None`)
/// rather than write the model's bytes through an attacker-chosen path.
///
/// Deliberately not swept on first use: the files are removed individually by
/// [`BashCapture::finish`] and its `Drop`, and the host fallback is a shared
/// path, so a global purge there would delete a concurrent instance's live
/// spill files rather than only stale ones.
fn spill_dir(scratch: Option<&Path>) -> Option<PathBuf> {
    let base = scratch
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("jan-bash");
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.is_dir() => return None,
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // create_dir (not create_dir_all) refuses to follow a planted
            // symlink in the path it creates.
            let r = std::fs::create_dir(&dir);
            if let Err(e) = r {
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    return None;
                }
            }
        }
        Err(_) => return None,
    }
    // Re-verify the node is a real directory, not a symlink a concurrent
    // process swapped in between the create and this check.
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => Some(dir),
        _ => None,
    }
}

fn new_temp_path(scratch: Option<&Path>) -> Option<PathBuf> {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    Some(
        spill_dir(scratch)?.join(format!("jan-bash-{}-{}.txt", std::process::id(), n)),
    )
}

/// Open a spill file atomically with `O_EXCL` so we never truncate or write
/// through an existing symlink the shell planted: `create_new` fails if the
/// path already exists (as a file or a symlink). Combined with the validated
/// non-symlink parent from [`spill_dir`], the model-controlled spill bytes
/// cannot be redirected onto a host file.
fn open_spill_file(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new().write(true).create_new(true).open(path)
}

/// Write `content` to a uniquely named temp file, returning its path on
/// success. Uses [`open_spill_file`] so the write never follows a symlink.
fn write_temp_output(content: &str, scratch: Option<&Path>) -> Option<PathBuf> {
    use std::io::Write;
    let path = new_temp_path(scratch)?;
    let mut file = open_spill_file(&path).ok()?;
    file.write_all(content.as_bytes()).ok()?;
    Some(path)
}

/// Remove a spill file only through a real, non-symlink parent directory. The
/// shell controls the scratch, so a redirected `jan-bash` dir must not redirect
/// our cleanup either; if it has been swapped, leave the file behind (it is
/// reclaimed with the session's scratch). `remove_file` itself unlinks a
/// symlink rather than following it, so only the parent needs re-checking.
fn remove_spill_file(path: &Path) {
    if let Some(parent) = path.parent() {
        match std::fs::symlink_metadata(parent) {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => {}
            _ => return,
        }
    }
    let _ = std::fs::remove_file(path);
}

async fn find(args: &serde_json::Value, root: &Path, scratch: Option<&Path>) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(FIND_DEFAULT_LIMIT);
    let base = resolve_path(root, scratch, &path);
    if symlink_escapes_root(root, scratch, &base) {
        return format!("ERROR: refused to search through a symlink out of the workspace: {path}");
    }
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
            if is_hidden_jan_path(&root_owned, &entry.path().to_string_lossy()) {
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

async fn grep(args: &serde_json::Value, root: &Path, scratch: Option<&Path>) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let glob_filter = arg_str(args, "glob").map(String::from);
    let ignore_case = arg_bool(args, "ignore_case");
    let literal = arg_bool(args, "literal");
    let context = arg_u64(args, "context").map(|v| v as usize).unwrap_or(0);
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(GREP_DEFAULT_LIMIT);
    let base = resolve_path(root, scratch, &path);
    if symlink_escapes_root(root, scratch, &base) {
        return format!("ERROR: refused to search through a symlink out of the workspace: {path}");
    }
    let root_owned = root.to_path_buf();
    let scratch_owned = scratch.map(Path::to_path_buf);

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
                let Some(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() {
                    continue;
                }
                // The walk does not descend symlinked directories, but a symlink
                // to a *file* is not a directory and would be opened and read.
                // Checked (not skipped outright) so a link that stays inside the
                // workspace -- every yarn workspace has them -- is still searched.
                if file_type.is_symlink()
                    && symlink_escapes_root(&root_owned, scratch_owned.as_deref(), entry.path())
                {
                    continue;
                }
                if is_hidden_jan_path(&root_owned, &entry.path().to_string_lossy()) {
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
    use crate::tools::lookup;
    use serde_json::json;

    // Root-taking shims over the `ToolContext` entry points. These shadow the
    // glob-imported originals so the tool tests, which almost never care about
    // the skill whitelist, stay readable. Tests that do care build a
    // `ToolContext` and call `super::*` directly.
    //
    // They co-locate the store inside the root (`<root>/.jan/agent`), the layout
    // a project uses, so the memory/skill tests keep asserting against paths
    // relative to their one temp dir. The desktop's split roots are covered in
    // `workspace` and `commands`.
    async fn execute_builtin(tool: &BuiltinTool, args: &serde_json::Value, root: &Path) -> String {
        let store = crate::workspace::project_store(root);
        super::execute_builtin(tool, args, &ToolContext::new(root, &store, &[])).await
    }

    async fn execute_builtin_with_diff(
        tool: &BuiltinTool,
        args: &serde_json::Value,
        root: &Path,
    ) -> (String, Option<String>) {
        let store = crate::workspace::project_store(root);
        super::execute_builtin_with_diff(tool, args, &ToolContext::new(root, &store, &[])).await
    }

    async fn preview_diff(
        tool: &BuiltinTool,
        args: &serde_json::Value,
        root: &Path,
    ) -> Option<String> {
        let store = crate::workspace::project_store(root);
        super::preview_diff(tool, args, &ToolContext::new(root, &store, &[])).await
    }

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
        assert_eq!(w, "Created sub/b.txt (4 bytes)");
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
            out.starts_with("ERROR: d.txt: edit 2: old_string not unique"),
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
            miss.starts_with("ERROR: d.txt: edit 1: old_string not found"),
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
            "@@ edit 1/2 @@\n-    1 | a\n-    2 | b\n+    1 | A\n     2 | c\n@@ edit 2/2 @@\n     1 | A\n-    2 | c\n+    2 | C\n+    3 | D"
        );
    }

    #[test]
    fn edit_diff_numbers_against_real_file_position() {
        let d = render_edit_diff(
            &[json!({"old_string": "two", "new_string": "TWO"})],
            "one\ntwo\nthree",
        );
        assert_eq!(d, "     1 | one\n-    2 | two\n+    2 | TWO\n     3 | three");
    }

    /// Two edits far apart in one call: each hunk carries its own file context
    /// and nothing in between, and the second is numbered against the state the
    /// first left behind (edit 1 adds a line, so `eight` is renumbered 8 -> 9).
    #[test]
    fn edit_diff_numbers_later_edits_against_earlier_ones() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "two", "new_string": "TWO\nTWO.5"}),
                json!({"old_string": "eight", "new_string": "EIGHT"}),
            ],
            "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
        );
        assert_eq!(
            d,
            concat!(
                "@@ edit 1/2 @@\n",
                "     1 | one\n",
                "-    2 | two\n",
                "+    2 | TWO\n",
                "+    3 | TWO.5\n",
                "     4 | three\n",
                "     5 | four\n",
                "@@ edit 2/2 @@\n",
                "     7 | six\n",
                "     8 | seven\n",
                "-    9 | eight\n",
                "+    9 | EIGHT\n",
                "    10 | nine",
            )
        );
    }

    /// A later edit may target text an earlier one inserted, since both run
    /// against the same `working` copy that `edit()` mutates in order.
    #[test]
    fn edit_diff_lets_a_later_edit_target_inserted_text() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "b", "new_string": "b\nBETA"}),
                json!({"old_string": "BETA", "new_string": "GAMMA"}),
            ],
            "a\nb\nc",
        );
        assert_eq!(
            d,
            concat!(
                "@@ edit 1/2 @@\n",
                "     1 | a\n",
                "     2 | b\n",
                "+    3 | BETA\n",
                "     4 | c\n",
                "@@ edit 2/2 @@\n",
                "     1 | a\n",
                "     2 | b\n",
                "-    3 | BETA\n",
                "+    3 | GAMMA\n",
                "     4 | c",
            )
        );
    }

    /// The context around a change comes from the file, not just from whatever
    /// `old_string` happened to include, and stops at `DIFF_CONTEXT` lines.
    #[test]
    fn edit_diff_pads_hunk_with_file_context() {
        let d = render_edit_diff(
            &[json!({"old_string": "four", "new_string": "FOUR"})],
            "one\ntwo\nthree\nfour\nfive\nsix\nseven",
        );
        assert_eq!(
            d,
            "     2 | two\n     3 | three\n-    4 | four\n+    4 | FOUR\n     5 | five\n     6 | six"
        );
    }

    /// A match that starts and ends mid-line is diffed as the whole lines it
    /// sits in, so the surrounding text on those lines is visible.
    #[test]
    fn edit_diff_widens_a_mid_line_match_to_whole_lines() {
        let d = render_edit_diff(
            &[json!({"old_string": "b = 1", "new_string": "b = 2"})],
            "let a = 0;\nlet b = 1;\nlet c = 0;\n",
        );
        assert_eq!(
            d,
            "     1 | let a = 0;\n-    2 | let b = 1;\n+    2 | let b = 2;\n     3 | let c = 0;"
        );
    }

    /// Distant changes inside one edit stay in one hunk, split by a `...` gap
    /// rather than dumping the untouched lines between them.
    #[test]
    fn edit_diff_splits_distant_changes_with_a_gap() {
        let d = render_edit_diff(
            &[json!({
                "old_string": "a\nb\nc\nd\ne\nf\ng\nh\ni",
                "new_string": "A\nb\nc\nd\ne\nf\ng\nh\nI",
            })],
            "a\nb\nc\nd\ne\nf\ng\nh\ni",
        );
        assert_eq!(
            d,
            "-    1 | a\n+    1 | A\n     2 | b\n     3 | c\n      ...\n     7 | g\n     8 | h\n-    9 | i\n+    9 | I"
        );
    }

    /// Nothing to show when the arguments do not change the file: the caller
    /// turns an empty diff into `None`.
    #[test]
    fn edit_diff_is_empty_for_a_no_op_edit() {
        let d = render_edit_diff(
            &[json!({"old_string": "two", "new_string": "two"})],
            "one\ntwo\nthree",
        );
        assert!(d.is_empty(), "unexpected: {d}");
    }

    #[test]
    fn edit_diff_shows_only_the_changed_line_amid_shared_context() {
        let d = render_edit_diff(
            &[json!({
                "old_string": "one\ntwo\nthree",
                "new_string": "one\nTWO\nthree",
            })],
            "one\ntwo\nthree",
        );
        assert_eq!(
            d,
            "     1 | one\n-    2 | two\n+    2 | TWO\n     3 | three"
        );
    }

    #[test]
    fn edit_diff_numbers_inserted_lines_against_new_content() {
        let d = render_edit_diff(
            &[json!({"old_string": "b", "new_string": "b\nc\nd"})],
            "a\nb\ne",
        );
        assert_eq!(
            d,
            "     1 | a\n     2 | b\n+    3 | c\n+    4 | d\n     5 | e"
        );
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
        assert!(
            preview_diff(lookup("read").unwrap(), &json!({"path": "x"}), &root)
                .await
                .is_none()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The diff is display-only for `edit` as well as `write`: the UI renders it,
    /// the model gets the concise summary and never the replayed hunk.
    #[tokio::test]
    async fn edit_diff_is_display_only_and_absent_from_model_content() {
        let root = unique_root();
        std::fs::write(root.join("e.txt"), b"foo").unwrap();
        let (content, diff) = execute_builtin_with_diff(
            lookup("edit").unwrap(),
            &json!({"path": "e.txt", "edits": [{"old_string": "foo", "new_string": "bar"}]}),
            &root,
        )
        .await;
        assert_eq!(content, "Applied 1 edit(s) to e.txt");
        assert!(
            !content.contains('+') && !content.contains('|'),
            "edit content must stay concise: {content}"
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
        assert_eq!(content, "Created w.txt (5 bytes)");
        assert!(!content.contains('+'), "write content must stay concise");
        assert_eq!(diff.as_deref(), Some("@@ created file @@\n+    1 | hello"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The model sees only `content`, not the display diff, so an overwrite must
    /// be distinguishable from a create there -- otherwise clobbering a file
    /// reads exactly like creating one.
    #[tokio::test]
    async fn write_content_distinguishes_overwrite_from_create() {
        let root = unique_root();
        let w = lookup("write").unwrap();
        std::fs::write(root.join("o.txt"), b"ORIGINAL").unwrap();

        let (over, over_diff) =
            execute_builtin_with_diff(w, &json!({"path": "o.txt", "content": "new"}), &root).await;
        assert_eq!(over, "Overwrote o.txt (3 bytes)");
        assert!(over_diff.unwrap().starts_with("@@ overwrote file @@"));

        let created =
            execute_builtin(w, &json!({"path": "fresh.txt", "content": "new"}), &root).await;
        assert_eq!(created, "Created fresh.txt (3 bytes)");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn rewriting_identical_content_reports_no_change_and_no_diff() {
        let root = unique_root();
        let w = lookup("write").unwrap();
        std::fs::write(root.join("same.txt"), b"keep").unwrap();
        let (content, diff) =
            execute_builtin_with_diff(w, &json!({"path": "same.txt", "content": "keep"}), &root)
                .await;
        assert_eq!(content, "No change: same.txt already had these 4 bytes");
        assert!(diff.is_none(), "no-op write must not show a diff: {diff:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Byte count must be UTF-8 bytes actually on disk, not character count.
    #[tokio::test]
    async fn write_reports_utf8_byte_count() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "u.txt", "content": "héllo→"}),
            &root,
        )
        .await;
        let on_disk = std::fs::metadata(root.join("u.txt")).unwrap().len();
        assert_eq!(on_disk, 9);
        assert_eq!(out, "Created u.txt (9 bytes)");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A `../` path really does land outside the project, so the reported
    /// location must be the resolved target rather than the raw argument.
    #[tokio::test]
    async fn write_reports_resolved_path_when_it_escapes_the_project() {
        let root = unique_root();
        let outside = root.parent().unwrap().join("jan_escape_probe.txt");
        let out = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "../jan_escape_probe.txt", "content": "x"}),
            &root,
        )
        .await;
        assert!(outside.exists(), "precondition: the write escapes the root");
        assert!(
            out.contains(outside.to_str().unwrap()),
            "must name the real destination, got: {out}"
        );
        assert!(!out.contains(".."), "must not echo the raw path: {out}");
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// With write confinement enabled, a `..` write is refused at the handler,
    /// independent of the gate -- the defense-in-depth layer.
    #[tokio::test]
    async fn confined_write_refuses_escape_at_handler() {
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[]).with_confined_writes(true);
        let out = super::execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "../escape.txt", "content": "x"}),
            &ctx,
        )
        .await;
        assert!(out.starts_with("ERROR: refused to write outside"), "got: {out}");
        assert!(!root.parent().unwrap().join("escape.txt").exists());

        let out = super::execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "../escape.txt", "edits": [{"old_string": "a", "new_string": "b"}]}),
            &ctx,
        )
        .await;
        assert!(out.starts_with("ERROR: refused to edit outside"), "got: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn write_and_edit_errors_name_the_path() {
        let root = unique_root();
        std::fs::write(root.join("blocker"), b"x").unwrap();
        let w = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "blocker/child.txt", "content": "d"}),
            &root,
        )
        .await;
        assert!(w.starts_with("ERROR: blocker/child.txt: "), "got: {w}");

        std::fs::write(root.join("e.txt"), b"foo").unwrap();
        let e = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "e.txt", "edits": [{"old_string": "nope", "new_string": "x"}]}),
            &root,
        )
        .await;
        assert_eq!(e, "ERROR: e.txt: edit 1: old_string not found");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `find` from a legitimate `/tmp` base must not walk *out* through a
    /// symlinked directory inside the scratch. Pins `WalkBuilder`'s
    /// no-follow default, which is what the containment check cannot cover:
    /// the base path here is honest, only the recursion would escape.
    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn find_does_not_recurse_out_of_the_scratch_via_a_symlink() {
        let root = unique_root();
        let scratch = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"classified").unwrap();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[]).with_scratch_root(&scratch);
        let out = super::execute_builtin(
            lookup("find").unwrap(),
            &json!({"pattern": "*.txt", "path": "/tmp"}),
            &ctx,
        )
        .await;
        assert!(
            !out.contains("secret.txt"),
            "walked out of the scratch through a symlink: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A recursive `grep` must not follow a *file* symlink out of the root.
    /// The directory-symlink case is covered by WalkBuilder's no-follow default
    /// (directories are recursed, symlinks to dirs are not entered), but a
    /// symlink to a file is not classified as a directory and would be opened
    /// and read. Skip every symlink so a planted `key -> $HOME/.ssh/id_rsa`
    /// cannot be disclosed without a separate approval.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn grep_does_not_read_a_file_symlink_out_of_the_root() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"classified").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("key.txt")).unwrap();
        std::fs::write(root.join("real.txt"), b"plain").unwrap();
        let out = execute_builtin(lookup("grep").unwrap(), &json!({"pattern": "classified", "path": "."}), &root).await;
        assert!(
            !out.contains("secret") && !out.contains("classified"),
            "read through a file symlink outside the root: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The escaping-symlink refusals must not become a blanket "no symlinks":
    /// a link that stays inside the workspace is ordinary (every yarn workspace
    /// links `node_modules/<pkg>` back into the repo), so `grep` still searches
    /// through it and `read` still opens it.
    #[cfg(unix)]
    #[tokio::test]
    async fn in_root_symlinks_stay_readable_and_searchable() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("pkg/index.js"), b"needle here").unwrap();
        std::os::unix::fs::symlink(root.join("pkg/index.js"), root.join("linked.js")).unwrap();

        let out = execute_builtin(lookup("read").unwrap(), &json!({"path": "linked.js"}), &root).await;
        assert!(out.contains("needle"), "in-root symlink was refused: {out}");

        let out = execute_builtin(lookup("grep").unwrap(), &json!({"pattern": "needle", "path": "."}), &root).await;
        assert!(out.contains("linked.js"), "in-root symlink was skipped: {out}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A redirected spill directory must refuse to write through it. The shell
    /// can replace `scratch/jan-bash` with a symlink to a host directory (or
    /// point `jan-bash` at one), so both spill entry points must come up empty
    /// rather than place the model's bytes at an attacker-chosen location.
    #[cfg(unix)]
    #[test]
    fn spill_writing_refuses_a_redirected_spill_dir() {
        let scratch = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("jan-bash")).unwrap();

        assert!(new_temp_path(Some(&scratch)).is_none(), "dir symlink accepted");
        assert!(
            write_temp_output("x", Some(&scratch)).is_none(),
            "wrote through a redirected spill dir"
        );
        // The outside host directory is untouched.
        assert_eq!(
            std::fs::read_dir(&outside).unwrap().count(),
            0,
            "host files created via a symlinked spill dir"
        );
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A spill *file* that is a planted symlink must never be opened (truncated
    /// and written through), so the host target it points at stays intact.
    #[cfg(unix)]
    #[test]
    fn spill_file_writes_never_follow_a_planted_symlink() {
        let scratch = unique_root();
        let outside = unique_root();
        std::fs::create_dir_all(scratch.join("jan-bash")).unwrap();
        let victim = outside.join("victim.txt");
        std::fs::write(&victim, b"precious").unwrap();
        let planted = scratch.join("jan-bash/spill.txt");
        std::os::unix::fs::symlink(&victim, &planted).unwrap();

        assert!(open_spill_file(&planted).is_err(), "opened a spill symlink");
        assert_eq!(
            std::fs::read_to_string(&victim).unwrap(),
            "precious",
            "wrote through the spill symlink to the host file"
        );
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The write escape the scratch clamp is there to stop, spelled with a
    /// symlink instead of `..`: a confined `write` through `/tmp/esc` must be
    /// refused and must leave nothing behind outside the scratch.
    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn confined_write_refuses_a_tmp_symlink_escape() {
        let root = unique_root();
        let scratch = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[])
            .with_scratch_root(&scratch)
            .with_confined_writes(true);
        let out = super::execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "/tmp/esc/pwned.txt", "content": "x"}),
            &ctx,
        )
        .await;
        assert!(out.starts_with("ERROR"), "must be refused, got: {out}");
        assert!(
            !outside.join("pwned.txt").exists(),
            "wrote outside the scratch via a symlink"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The handler itself re-checks for symlinks immediately before opening,
    /// closing the gate-vs-use window. A read through a planted symlink must be
    /// refused (not silently resolved), even when the gate already allowed the
    /// path inside the root.
    #[cfg(unix)]
    #[tokio::test]
    async fn read_refuses_a_symlink_redirected_file() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"classified").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("link.txt")).unwrap();
        let out = execute_builtin(lookup("read").unwrap(), &json!({"path": "link.txt"}), &root).await;
        assert!(out.starts_with("ERROR"), "must refuse, got: {out}");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The same re-check on the writing side, and it must fire *before* the
    /// parent directories are created: a refused write that has already made
    /// directories through the planted link has still touched the host.
    #[cfg(unix)]
    #[tokio::test]
    async fn write_and_edit_refuse_a_symlink_redirected_file() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("victim.txt"), b"precious").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();

        let out = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "escape/victim.txt", "content": "owned"}),
            &root,
        )
        .await;
        assert!(out.starts_with("ERROR"), "write must refuse, got: {out}");

        let out = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "escape/victim.txt", "edits": [{"old_string": "precious", "new_string": "owned"}]}),
            &root,
        )
        .await;
        assert!(out.starts_with("ERROR"), "edit must refuse, got: {out}");

        assert_eq!(
            std::fs::read_to_string(outside.join("victim.txt")).unwrap(),
            "precious"
        );
        // Nothing was created through the link on the way to the refusal.
        assert_eq!(
            std::fs::read_dir(&outside).unwrap().count(),
            1,
            "directories were created through the symlink"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A `write` to `/tmp/x` lands in the session scratch, and a `read` of the
    /// same path sees it: every fs tool shares the one `/tmp` the shell sees.
    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn write_then_read_via_tmp_persists_in_scratch() {
        let root = unique_root();
        let scratch = unique_root();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[]).with_scratch_root(&scratch);
        let out = super::execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "/tmp/scratch.txt", "content": "persist"}),
            &ctx,
        )
        .await;
        assert!(out.starts_with("Created /tmp/scratch.txt"), "got: {out}");
        assert!(scratch.join("scratch.txt").exists(), "wrote into scratch");

        let out = super::execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "/tmp/scratch.txt"}),
            &ctx,
        )
        .await;
        assert_eq!(out, "persist");

        // No stray file on the real host /tmp.
        assert!(!Path::new("/tmp/scratch.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The bare `/tmp` dir resolves to the scratch root; files written there by
    /// the shell (or a sibling tool) are listable through the file tools.
    #[test]
    #[cfg(target_os = "linux")]
    fn resolve_path_maps_tmp_into_scratch() {
        let root = unique_root();
        let scratch = unique_root();
        assert_eq!(
            crate::tools::sandbox::resolve_path(&root, Some(&scratch), "/tmp/a/b.txt"),
            scratch.join("a/b.txt")
        );
        assert_eq!(
            crate::tools::sandbox::resolve_path(&root, Some(&scratch), "/tmp"),
            scratch
        );
        // Without a scratch, /tmp stays the host path (i.e. never the project).
        assert_eq!(
            crate::tools::sandbox::resolve_path(&root, None, "/tmp/a.txt"),
            Path::new("/tmp/a.txt")
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// A `..` climb inside `/tmp` must NOT escape the session scratch: an
    /// absolute path maps into the scratch, and a `..` is clamped back to the
    /// scratch root (chroot semantics, matching the `/tmp` bind mount), so it
    /// can never reach the host temp.
    #[test]
    #[cfg(target_os = "linux")]
    fn tmp_path_cannot_climb_out_with_dotdot() {
        let root = unique_root();
        let scratch = unique_root();
        // `/tmp/../evil.txt` clamps inside the scratch, never the host parent.
        let out = crate::tools::sandbox::resolve_path(&root, Some(&scratch), "/tmp/../evil.txt");
        assert!(
            out.starts_with(&scratch),
            "must stay inside the scratch, got: {out:?}"
        );
        assert_eq!(out, scratch.join("evil.txt"));
        // Even a deeper climb stays clamped at the scratch root.
        let deep =
            crate::tools::sandbox::resolve_path(&root, Some(&scratch), "/tmp/../../deep.txt");
        assert_eq!(deep, scratch.join("deep.txt"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The gate treats a scratch-backed `/tmp` write as inside, not an escape.
    #[test]
    #[cfg(target_os = "linux")]
    fn gate_allows_tmp_write_when_scratch_is_set() {
        let root = unique_root();
        let scratch = unique_root();
        let d = crate::tools::gate::resolve_decision(
            lookup("write").unwrap(),
            &json!({"path": "/tmp/x.txt", "content": "y"}),
            &root,
            Some(&scratch),
            &crate::permissions::ToolPermissions::default(),
            &crate::tools::gate::SessionGrants::default(),
        );
        assert_eq!(
            d,
            crate::tools::gate::Decision::Prompt(crate::tools::gate::PromptKind::Write),
            "in-scratch write is an in-project write, not an escape"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The counterpart: the same write spelled through a symlink out of the
    /// scratch is an escape, so it takes the escape prompt (refused outright on
    /// the desktop) rather than the ordinary in-project one.
    #[test]
    #[cfg(target_os = "linux")]
    fn gate_treats_a_tmp_symlink_escape_as_an_escape() {
        let root = unique_root();
        let scratch = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        let d = crate::tools::gate::resolve_decision(
            lookup("write").unwrap(),
            &json!({"path": "/tmp/esc/x.txt", "content": "y"}),
            &root,
            Some(&scratch),
            &crate::permissions::ToolPermissions::default(),
            &crate::tools::gate::SessionGrants::default(),
        );
        assert_eq!(
            d,
            crate::tools::gate::Decision::Prompt(crate::tools::gate::PromptKind::WriteEscape)
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
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

    /// Hidden means absent from the listing, not present-but-unopenable: an
    /// entry the agent can never read is only an invitation to try.
    #[tokio::test]
    async fn ls_omits_the_hidden_jan_dir() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent")).unwrap();
        std::fs::write(root.join("src.rs"), b"x").unwrap();
        std::fs::write(root.join("JAN.md"), b"x").unwrap();
        let out = execute_builtin(lookup("ls").unwrap(), &json!({}), &root).await;
        assert!(out.contains("src.rs"), "unexpected: {out}");
        assert!(out.contains("JAN.md"), "unexpected: {out}");
        assert!(!out.contains(".jan/"), "must not list the agent state dir: {out}");
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
    async fn find_does_not_leak_the_hidden_jan_tree() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent/threads/t1")).unwrap();
        std::fs::write(root.join(".jan/agent/threads/t1/thread.json"), b"{}").unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"[tools]\n").unwrap();
        // Directly under `.jan`, outside `agent/`: hidden by the same rule.
        std::fs::write(root.join(".jan/stray.txt"), b"x").unwrap();
        std::fs::write(root.join("JAN.md"), b"instructions").unwrap();
        std::fs::write(root.join("README.md"), b"x").unwrap();
        let out =
            execute_builtin(lookup("find").unwrap(), &json!({"pattern": "**/*"}), &root).await;
        assert!(
            out.contains("README.md"),
            "should include project file: {out}"
        );
        assert!(
            out.contains("JAN.md"),
            "the root instructions file is an ordinary project file: {out}"
        );
        assert!(
            !out.contains("thread.json"),
            "must not leak thread storage: {out}"
        );
        assert!(
            !out.contains("agent.toml"),
            "must not leak agent config: {out}"
        );
        assert!(
            !out.contains("stray.txt"),
            "the whole .jan dir is hidden, not just agent/: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn grep_does_not_leak_hidden_jan_contents() {
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
        assert!(
            out.contains("README.md"),
            "should match project file: {out}"
        );
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

        let collected =
            execute_builtin(lookup("bash").unwrap(), &json!({"job_id": job_id}), &root).await;
        assert!(collected.contains("done"), "unexpected: {collected}");

        // The job is removed once collected.
        let again =
            execute_builtin(lookup("bash").unwrap(), &json!({"job_id": job_id}), &root).await;
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

    #[test]
    fn bash_result_failed_detects_nonzero_and_signal_markers() {
        assert!(bash_result_failed("output\n[exit 1]"));
        assert!(bash_result_failed("output\n[exit 127]"));
        assert!(bash_result_failed("[terminated by signal]"));
        // Truncation note follows the marker on its own line: still detected.
        assert!(bash_result_failed(
            "output\n[exit 2]\n[output truncated at 10 of 99 bytes]"
        ));
        assert!(!bash_result_failed("output\n[exit 0]"));
        assert!(!bash_result_failed("plain output, no marker"));
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
        assert!(
            out.contains("\n[exit 0]"),
            "marker not on its own line: {out}"
        );
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
        assert!(
            !out.contains("[truncated"),
            "should not truncate: len={}",
            out.len()
        );
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
        assert!(
            !out.contains("output truncated"),
            "spurious truncation: {out}"
        );
        assert!(
            out.contains("Receiving objects: 30000"),
            "final redraw lost: {out}"
        );
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
        assert!(
            out.contains("output truncated at"),
            "unexpected: end of {out}"
        );
        assert!(
            out.contains("Use the read tool"),
            "should guide the agent: {out}"
        );
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
        assert!(
            full.contains("015999") || full.contains("016000"),
            "tail readable: {full}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The same overflow with a session scratch set: the spill must land in the
    /// scratch and be advertised by the one name that works from both the fs
    /// tools and the shell, so the `read` the note asks for actually finds it.
    /// The no-scratch case above cannot catch this -- there `/tmp` is not remapped.
    #[tokio::test]
    async fn bash_spill_is_readable_when_a_scratch_is_set() {
        let root = unique_root();
        let scratch = unique_root();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[]).with_scratch_root(&scratch);
        let out = super::execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "for i in $(seq 1 16000); do printf '%064d\\n' \"$i\"; done"}),
            &ctx,
        )
        .await;
        let path = out
            .rsplit("full output written to ")
            .next()
            .and_then(|s| s.split(". Use the read tool").next())
            .unwrap_or("");
        if cfg!(target_os = "linux") {
            assert!(
                path.starts_with("/tmp/"),
                "must be advertised as the /tmp name the shell also sees: {out}"
            );
        }
        let full = super::execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": path, "offset": 15999, "limit": 1}),
            &ctx,
        )
        .await;
        assert!(
            full.contains("015999") || full.contains("016000"),
            "spill at {path} must be readable back: {full}"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// With the sandbox off, `bash` runs bare instead of being wrapped or
    /// withheld. The point of the opt-out is that it works on a machine where
    /// no backend can be established, so this must not depend on one.
    #[cfg(unix)]
    #[tokio::test]
    async fn unsandboxed_bash_runs_without_a_backend() {
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[]).with_sandbox(false);
        let out = super::execute_builtin(
            lookup("bash").unwrap(),
            &json!({"command": "echo unconfined"}),
            &ctx,
        )
        .await;
        assert!(out.contains("unconfined"), "unsandboxed bash did not run: {out}");
        assert!(
            !out.contains("no OS sandbox could be established"),
            "withheld despite the opt-out: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Dropping the sandbox drops the scratch with it, in either builder order.
    /// A scratch that outlived the sandbox would leave the fs tools rewriting
    /// `/tmp/...` into a directory the unconfined shell never looks at.
    #[test]
    fn unsandboxed_context_has_no_scratch() {
        let root = unique_root();
        let scratch = unique_root();
        let store = crate::workspace::project_store(&root);
        assert!(ToolContext::new(&root, &store, &[])
            .with_scratch_root(&scratch)
            .with_sandbox(false)
            .scratch_root
            .is_none());
        assert!(ToolContext::new(&root, &store, &[])
            .with_sandbox(false)
            .with_scratch_root(&scratch)
            .scratch_root
            .is_none());
        // The sandboxed default still binds it.
        assert_eq!(
            ToolContext::new(&root, &store, &[])
                .with_scratch_root(&scratch)
                .scratch_root,
            Some(scratch.as_path())
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
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
        assert!(
            out.contains("output truncated at"),
            "should truncate: end of {out}"
        );
        assert!(
            out.contains("\nL12000\n"),
            "last line must survive: end of {out}"
        );
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
        assert!(
            out.contains("red"),
            "text must survive sanitization: {out:?}"
        );
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
            execute_builtin(lookup("bash").unwrap(), &json!({"command": "cat"}), &root),
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
    async fn built_in_jan_skill_is_available_without_project_skills() {
        let root = unique_root();

        let list = execute_builtin(lookup("skill_list").unwrap(), &json!({}), &root).await;
        assert!(
            list.lines()
                .any(|line| line == "jan" || line.starts_with("jan — ")),
            "unexpected list: {list}"
        );

        let body = execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "jan"}),
            &root,
        )
        .await;
        assert!(!body.trim().is_empty(), "unexpected body: {body}");

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
        // Whitelist only "on". The whitelist is injected, so this no longer
        // needs an agent.toml round-trip to set up.
        let enabled = ["on".to_string()];
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &enabled);

        let list = super::execute_builtin(lookup("skill_list").unwrap(), &json!({}), &ctx).await;
        assert!(list.contains("on"), "list: {list}");
        assert!(!list.contains("off body"), "disabled skill leaked: {list}");

        // Disabled skill is unreadable.
        let read_off =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "off"}), &ctx)
                .await;
        assert!(read_off.starts_with("ERROR"), "disabled read: {read_off}");

        // Enabled skill still readable.
        let read_on =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "on"}), &ctx)
                .await;
        assert_eq!(read_on, "on body");

        // A disabled skill is read-only for the model: writing to it is refused
        // and the on-disk content is untouched.
        let write_off = super::execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "off", "content": "evil body"}),
            &ctx,
        )
        .await;
        assert!(
            write_off.starts_with("ERROR"),
            "disabled write: {write_off}"
        );
        let r =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "off"}), &ctx)
                .await;
        assert!(r.starts_with("ERROR"), "still disabled after write");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn skill_tools_hide_user_invoked_skills_from_model() {
        let root = unique_root();
        // A `disable-model-invocation: true` skill: only the human may fire it.
        execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "secret",
                    "content": "---\ndescription: internal ritual\ndisable-model-invocation: true\n---\nsecret body"}),
            &root,
        )
        .await;
        execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "plain", "content": "---\ndescription: open\n---\nplain body"}),
            &root,
        )
        .await;

        let list = execute_builtin(lookup("skill_list").unwrap(), &json!({}), &root).await;
        assert!(list.contains("plain"), "list: {list}");
        assert!(
            !list.contains("internal ritual"),
            "user-only skill leaked: {list}"
        );

        let read_secret = execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "secret"}),
            &root,
        )
        .await;
        assert!(
            read_secret.starts_with("ERROR"),
            "user-only read: {read_secret}"
        );

        let read_plain = execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "plain"}),
            &root,
        )
        .await;
        assert_eq!(read_plain, "plain body");
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
            assert!(
                out.starts_with("ERROR"),
                "name {bad:?} should be rejected: {out}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
