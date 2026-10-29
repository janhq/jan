//! Native execution of the built-in tools. Sandbox escape is enforced by the
//! gate before these run; handlers only resolve paths and perform the operation.
//! Errors are returned as a String starting with "ERROR" (matching
//! `execute_mcp_tool_calls`) so the loop flags `is_error` correctly.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use ignore::WalkBuilder;
use tokio::sync::oneshot;

use crate::memory;
use crate::skills;
use crate::tools::jail;
use crate::tools::proc;
use crate::tools::nofollow;
use crate::tools::sandbox::{
    escapes_write_roots, hidden_under, in_scratch, landing, lexical_normalize,
    refuse_windows_name, resolve_path, scratch_display_path, symlink_escapes_any_root, Landing,
};
use crate::screenshot_pages::PageScope;
use crate::tools::{BuiltinTool, ImageContentPart, ScreenshotBackend, ToolContext};

const MAX_BYTES: usize = 64 * 1024;
const MAX_LINES: usize = 2000;
/// Cap on a `read` image payload returned as an `image_url` content part.
/// Mirrors the TUI's `MAX_IMAGE_BYTES` so an oversized raster (or a large
/// text file whose name ends in an image extension) cannot flood the model
/// context as a base64 blob.
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
/// bash output caps, matching the `read` tool. Overflow is not lost: it spills
/// to a temp file the `read` tool can page through, so the cap is tuned for
/// context economy (~16k tokens worst case) rather than for fitting everything.
const BASH_MAX_BYTES: usize = MAX_BYTES;
const BASH_MAX_LINES: usize = MAX_LINES;
const GREP_MAX_LINE: usize = 500;
const LS_DEFAULT_LIMIT: usize = 500;
const FIND_DEFAULT_LIMIT: usize = 1000;
const GREP_DEFAULT_LIMIT: usize = 100;
/// How long a `bash` call waits for the command before backgrounding it, when
/// the caller doesn't specify `timeout`.
const DEFAULT_BASH_TIMEOUT_SECS: u64 = 30;

/// Counter for unique temp-file names for truncated bash output.
static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn arg_str<'a>(args: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

fn arg_u64(args: &serde_json::Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| v.as_u64())
}

fn arg_bool(args: &serde_json::Value, key: &str) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Single-quote a value for a POSIX shell. Single quotes disable `$`/backtick
/// expansion and globbing, and the only escape (closing quote) is handled by
/// the `'\''` idiom. Used when launching headless Chrome through the shell.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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

/// Command output as it should be shown to the model or a person: carriage-return
/// redraws collapsed to their final frame, then control characters dropped. The
/// one sanitizer for the tool result, the `/shells` live tail and the TUI's
/// streamed view, so all three show the same text.
pub fn sanitize_output(s: &str) -> String {
    sanitize_control(&collapse_carriage_returns(s))
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

/// Execute a built-in tool. Returns the tool-result text plus, for a `read` of
/// an image file, the base64 `image_url` content parts the model needs to see
/// the image. Errors are returned as a String STARTING WITH "ERROR" rather than
/// as Err.
///
/// The run's `PreToolUse` and `PostToolUse` hooks wrap this function rather
/// than the caller's invoker. The invoker sits above it, so a surface that
/// builds its own -- the desktop IPC command today, an out-of-process caller
/// tomorrow -- would otherwise bypass every hook, including a `PreToolUse`
/// deny. A denial returns here in the ERROR form the gate's denials take, so
/// the model and the transcript cannot tell the two apart.
pub async fn execute_builtin(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    ctx: &ToolContext<'_>,
) -> (String, Option<Vec<ImageContentPart>>) {
    let payload = crate::tools::hooks::HookPayload {
        tool_name: Some(tool.name.to_string()),
        tool_input: Some(args.clone()),
        ..Default::default()
    };
    if let Some(reason) = crate::tools::hooks::fire_from_context(
        crate::tools::hooks::HookEvent::PreToolUse,
        &payload,
        ctx,
    )
    .await
    {
        return (
            format!("ERROR: tool '{}' denied: {reason}", tool.name),
            None,
        );
    }
    let (content, images) = execute_builtin_unhooked(tool, args, ctx).await;
    let post = crate::tools::hooks::HookPayload {
        tool_result: Some(content.clone()),
        ..payload
    };
    // A PostToolUse deny is meaningless -- the call already happened -- so the
    // return is dropped here; `run_hooks` only honors a deny for PreToolUse.
    let _ = crate::tools::hooks::fire_from_context(
        crate::tools::hooks::HookEvent::PostToolUse,
        &post,
        ctx,
    )
    .await;
    (content, images)
}

/// The tool dispatch itself, without the hook wrapping. Split out so
/// [`execute_builtin`] can name the un-hooked call once instead of duplicating
/// the `read`-plus-images shape inside its own hook bracket.
async fn execute_builtin_unhooked(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    ctx: &ToolContext<'_>,
) -> (String, Option<Vec<ImageContentPart>>) {
    let project_root = ctx.project_root;
    let scratch = ctx.scratch_root;
    let (content, images) = match tool.name {
        "read" => read(args, project_root, scratch, ctx.read_roots).await,
        #[cfg(feature = "tauri")]
        "screenshot" => {
            screenshot(
                args,
                project_root,
                scratch,
                ctx.read_roots,
                ctx.screenshot_backend.as_ref(),
            )
            .await
        }
        _ => (execute_text(tool, args, ctx).await, None),
    };
    (content, images)
}

/// The text result for every tool except `read`. Split out so `read` can also
/// return image parts without duplicating the remaining tool dispatch.
async fn execute_text(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    ctx: &ToolContext<'_>,
) -> String {
    let project_root = ctx.project_root;
    let scratch = ctx.scratch_root;
    match tool.name {
        // Read tools consult the attached read-only roots; `write`/`edit`
        // deliberately do not, which is what keeps an attached folder
        // readable and unwritable.
        "read" => read(args, project_root, scratch, ctx.read_roots).await.0,
        "ls" => ls(args, project_root, scratch, ctx.read_roots, ctx.hidden_root).await,
        "write" => {
            write(
                args,
                project_root,
                scratch,
                ctx.confine_writes,
                ctx.write_roots,
            )
            .await
        }
        "edit" => {
            edit(
                args,
                project_root,
                scratch,
                ctx.confine_writes,
                ctx.write_roots,
            )
            .await
        }
        crate::tools::SHELL_TOOL => bash(args, ctx).await,
        "find" => find(args, project_root, scratch, ctx.read_roots, ctx.hidden_root).await,
        "grep" => grep(args, project_root, scratch, ctx.read_roots, ctx.hidden_root).await,
        // Memory and skills live in the store root, not the sandbox: they must
        // outlive the conversation the filesystem tools are scoped to.
        crate::tools::MEMORY_TOOL => {
            memory_tool(args, ctx.memory_scopes(), ctx.memory_change_budget).await
        }
        // Skills go through the skills module so the tool honors the folder form
        // (`<name>/SKILL.md`) and frontmatter, matching what the UI writes.
        "skill_list" => skill_list(ctx),
        "skill_read" => skill_read(args, ctx),
        "skill_write" => skill_write(args, ctx),
        // Native web tools: compiled into the agent core, not an MCP server.
        "web_search" => crate::tools::web::web_search(args, ctx.web_search).await,
        "web_fetch" => crate::tools::web::web_fetch(args, ctx.web_search).await,
        other => format!("ERROR: unknown built-in tool '{other}'"),
    }
}

/// Focused diff previewing what a `write`/`edit` call would change, without
/// running it. Line-prefixed (`-`/`+`) hunk text with each line numbered against
/// its position in the file; `None` for other tools or when nothing would
/// change. Used to show the change in the permission prompt. Both variants read
/// the prior file: `write` to show its `created`/`overwrote` header, `edit` to
/// apply the batch and number the hunks against real file lines.
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
/// mutating call. The diff compares the file before and after the call, so
/// deleted lines carry their original numbers and kept or inserted lines their
/// numbers in the result. `None` for non-mutating tools and on error.
pub async fn execute_builtin_with_diff(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    ctx: &ToolContext<'_>,
) -> (String, Option<String>, Option<Vec<ImageContentPart>>) {
    match tool.name {
        "write" | "edit" => {
            let diff = preview_diff(tool, args, ctx).await;
            let (content, images) = execute_builtin(tool, args, ctx).await;
            if content.starts_with("ERROR") {
                return (content, None, None);
            }
            (content, diff, images)
        }
        "read" => {
            let (content, images) = execute_builtin(tool, args, ctx).await;
            (content, None, images)
        }
        _ => (execute_builtin(tool, args, ctx).await.0, None, None),
    }
}

/// Lines of surrounding file context kept around a change, and the threshold
/// past which distant changes are split with a `...` gap. Matches the feel of a
/// unified diff without the `@@ -a,b +c,d @@` range header.
const DIFF_CONTEXT: usize = 2;

/// One line-level diff (`similar`) of the file before and after the whole
/// batch, so hunks come out in file order however the edits are listed,
/// overlapping edits show only their net change, and a one-line change inside
/// a large `old_string`/`new_string` pair shows only the lines that differ.
/// Deleted lines are numbered against the file before the batch, kept and
/// inserted lines against the file after it. When the batch would be rejected
/// (an `old_string` missing or not unique) there is no file position to number
/// against, so each edit's arguments are shown on their own, numbered from 1.
fn render_edit_diff(edits: &[serde_json::Value], prior: &str) -> String {
    let out = match apply_edits(prior, edits) {
        Ok(updated) => render_hunk_diff(prior, &updated, 1),
        Err(_) => edits
            .iter()
            .map(|e| {
                let old = e.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let new = e.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
                let (old, new) = line_endings_of_file(prior, old, new);
                render_hunk_diff(&old, &new, 1)
            })
            .collect::<Vec<_>>()
            .join("      ...\n"),
    };
    out.trim_end().to_string()
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
    // Bounded so a large rewrite of a big file cannot stall the async thread;
    // past the deadline `similar` falls back to a coarser but valid diff.
    let diff = TextDiff::configure()
        .timeout(std::time::Duration::from_secs(1))
        .diff_lines(&old, &new);
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
    let entries: Vec<(String, String)> = match &ctx.skill_source {
        Some(source) => source.catalog(),
        None => skills::catalog_layered(&ctx.skill_roots(), ctx.enabled_skills)
            .into_iter()
            .map(|m| (m.name, m.description))
            .collect(),
    };
    entries
        .into_iter()
        .map(|(name, description)| {
            if description.is_empty() {
                name
            } else {
                format!("{name} — {description}")
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
    if let Some(source) = &ctx.skill_source {
        return source.read(name).unwrap_or_else(|e| e);
    }
    if !skills::is_enabled(ctx.enabled_skills, name) {
        return format!("ERROR: skill '{name}' not found");
    }
    let raw = match skills::read_raw_layered(&ctx.skill_roots(), name) {
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
/// `scope` picks the store: `project` (the default, `store_root`) or `user`
/// (`skill_user_root`, i.e. `~/.jan/skills`, visible from every project).
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
    let (store, label) = match arg_str(args, "scope").unwrap_or("project") {
        "project" => (ctx.store_root, "skill"),
        "user" => match ctx.skill_user_root {
            Some(root) => (root, "user skill"),
            None => return "ERROR: scope 'user' is not available here".to_string(),
        },
        other => {
            return format!("ERROR: invalid scope '{other}' (expected \"project\" or \"user\")")
        }
    };
    match skills::write(store, name, content) {
        Ok(()) => format!("Wrote {label} '{name}'"),
        Err(e) => e,
    }
}

/// The `memory` tool delegates every op to `crate::memory`, so the built-in
/// and the management commands share one implementation. A `budget` (Jan's
/// tidy subagent) caps the mutations: each write, edit, delete and move takes
/// one change before it runs and gives it back if it changed nothing.
async fn memory_tool(
    args: &serde_json::Value,
    scopes: memory::Scopes<'_>,
    budget: Option<&memory::ChangeBudget>,
) -> String {
    let need = |key: &str| {
        arg_str(args, key).ok_or_else(|| format!("ERROR: op needs the '{key}' argument"))
    };
    let op = arg_str(args, "op");
    if matches!(op, Some("write" | "edit" | "delete" | "move")) {
        if let Some(Err(e)) = budget.map(memory::ChangeBudget::take) {
            return e;
        }
    }
    let result = match op {
        Some("view") => scopes.view(arg_str(args, "name")).await,
        Some("search") => match need("query") {
            Ok(query) => scopes.search(query),
            Err(e) => Err(e),
        },
        Some("write") => match (need("name"), need("content")) {
            (Ok(name), Ok(content)) => scopes.write(name, arg_str(args, "title"), content).await,
            (Err(e), _) | (_, Err(e)) => Err(e),
        },
        Some("edit") => match (need("name"), need("old"), need("new")) {
            (Ok(name), Ok(old), Ok(new)) => scopes.edit(name, old, new).await,
            (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => Err(e),
        },
        Some("delete") => match need("name") {
            Ok(name) => scopes.delete(name).await,
            Err(e) => Err(e),
        },
        Some("move") => match (need("name"), need("to")) {
            (Ok(name), Ok(to)) => scopes.rename(name, to).await,
            (Err(e), _) | (_, Err(e)) => Err(e),
        },
        Some(other) => Err(format!(
            "ERROR: unknown memory op '{other}' (expected view, search, write, edit, delete or move)"
        )),
        None => Err("ERROR: missing required argument 'op'".to_string()),
    };
    // A refused or no-op change (a missing note to delete) spends nothing.
    let changed = matches!(&result, Ok(text) if !text.starts_with("No note"));
    if !changed && matches!(op, Some("write" | "edit" | "delete" | "move")) {
        if let Some(budget) = budget {
            budget.refund();
        }
    }
    result.unwrap_or_else(|e| e)
}

async fn read(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
) -> (String, Option<Vec<ImageContentPart>>) {
    let Some(path) = arg_str(args, "path") else {
        return ("ERROR: missing required argument 'path'".to_string(), None);
    };
    let offset = arg_u64(args, "offset").map(|v| v as usize);
    let limit = arg_u64(args, "limit").map(|v| v as usize);
    let target = resolve_path(root, scratch, path);
    // Fail closed: a component swapped to a symlink after the gate validated
    // the path must not redirect the open out of the workspace.
    if symlink_escapes_any_root(root, scratch, read_roots, &target) {
        return (
            format!("ERROR: refused to read through a symlink out of the workspace: {path}"),
            None,
        );
    }

    let bytes = match tokio::fs::read(&target).await {
        Ok(b) => b,
        Err(e) => return (format!("ERROR: {e}"), None),
    };

    // An image file is returned as an OpenAI `image_url` content part rather
    // than text: the model cannot see a raster through a base64 string. Only a
    // plain read (no offset/limit) does this, since slicing an image makes no
    // sense and offset/limit still refers to text lines.
    if offset.is_none() && limit.is_none() && bytes.len() <= MAX_IMAGE_BYTES {
        if let Some(mime) = crate::tools::image::detect(&target) {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let name = target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("image")
                .to_string();
            let note = format!("Read image {name} ({mime}, {} bytes)", bytes.len());
            let image = ImageContentPart {
                data_url: format!("data:{mime};base64,{b64}"),
                name,
            };
            return (note, Some(vec![image]));
        }
    }

    let content = match String::from_utf8(bytes) {
        Ok(c) => c,
        Err(_) => return ("ERROR: not a UTF-8 text file".to_string(), None),
    };

    let selected = if offset.is_some() || limit.is_some() {
        let lines: Vec<&str> = content.split('\n').collect();
        let start = offset.map(|o| o.saturating_sub(1)).unwrap_or(0);
        if start >= lines.len() {
            return (
                format!(
                    "ERROR: offset {} is beyond end of file ({} lines total)",
                    offset.unwrap_or(1),
                    lines.len()
                ),
                None,
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

    (
        cap_output(
            &selected,
            MAX_LINES,
            MAX_BYTES,
            "\n[truncated: use offset/limit to read more]",
        ),
        None,
    )
}

async fn ls(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    hidden: Option<&Path>,
) -> String {
    let path = arg_str(args, "path").unwrap_or(".");
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(LS_DEFAULT_LIMIT);
    let target = resolve_path(root, scratch, path);
    // Names are content too: a symlinked directory would list a host directory.
    if symlink_escapes_any_root(root, scratch, read_roots, &target) {
        return format!("ERROR: refused to list through a symlink out of the workspace: {path}");
    }
    let mut entries = match tokio::fs::read_dir(&target).await {
        Ok(rd) => rd,
        Err(e) => return format!("ERROR: {e}"),
    };
    // Omitted, not reported-then-denied: an entry the agent can never open is
    // only an invitation to try.
    let skip = hidden.and_then(|h| hidden_under(&target, h));
    let mut names: Vec<String> = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                if skip.as_deref() == Some(entry.path().as_path()) {
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

async fn write(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    confine: bool,
    write_roots: &[PathBuf],
) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(content) = arg_str(args, "content") else {
        return "ERROR: missing required argument 'content'".to_string();
    };
    if let Some((name, why)) = refuse_windows_name(path) {
        return format!("ERROR: refused to write '{name}' in {path}: the name {why}");
    }
    // Defense in depth: when the caller confines writes, re-canonicalize on the
    // canonical root (not the raw argument) so `..` and absolute paths are
    // caught even if the gate's decision was made against a stale view.
    // `write_roots` widen the confinement exactly as they widened the gate.
    let target = resolve_path(root, scratch, path);
    if confine && escapes_write_roots(root, scratch, write_roots, path).unwrap_or(true) {
        return format!("ERROR: refused to write outside the agent workspace: {path}");
    }
    // Report the resolved location, not the raw argument: an absolute or `../`
    // path lands outside the project and the model must see where it went.
    let shown = display_path(root, scratch, &target);
    // Resolve once, before any directory is created, and open only what that
    // resolution approved: a concurrent sandboxed process can swap a path
    // component for a link at any point, and both `create_dir_all` and a
    // by-name write would follow it.
    let real = match write_landing(root, scratch, write_roots, &target) {
        Ok(real) => real,
        Err(()) => {
            return format!("ERROR: refused to write through a symlink out of the workspace: {path}")
        }
    };
    let content = content.to_string();
    let outcome = tokio::task::spawn_blocking(move || {
        // Existence decides created/overwrote; a non-UTF8 file still exists, so
        // it must not be a failed UTF-8 decode that answers that question.
        let prior = nofollow::read(&real);
        let existed = !matches!(&prior, Err(e) if e.kind() == std::io::ErrorKind::NotFound);
        let unchanged = prior.is_ok_and(|p| p == content.as_bytes());
        nofollow::write(&real, content.as_bytes()).map(|()| (existed, unchanged, content.len()))
    })
    .await;
    match outcome {
        Ok(Ok((_, true, bytes))) => format!("No change: {shown} already had these {bytes} bytes"),
        Ok(Ok((true, _, bytes))) => format!("Overwrote {shown} ({bytes} bytes)"),
        Ok(Ok((false, _, bytes))) => format!("Created {shown} ({bytes} bytes)"),
        Ok(Err(e)) if nofollow::is_link_refused(&e) => {
            format!("ERROR: refused to write through a symlink out of the workspace: {path}")
        }
        Ok(Err(e)) => format!("ERROR: {shown}: {e}"),
        Err(e) => format!("ERROR: {shown}: {e}"),
    }
}

/// The link-free path a `write`/`edit` must open, or `Err` to refuse.
///
/// A target under a trusted root must resolve inside one. A target outside
/// every root was already put to the user by the gate as an escape, so it is
/// written where it really lands; one that cannot be resolved at all is
/// refused rather than handed to a by-name open.
fn write_landing(
    root: &Path,
    scratch: Option<&Path>,
    write_roots: &[PathBuf],
    target: &Path,
) -> Result<PathBuf, ()> {
    match landing(root, scratch, write_roots, target) {
        Landing::Inside(real) | Landing::Outside(Some(real)) => Ok(real),
        Landing::Escapes | Landing::Outside(None) => Err(()),
    }
}

/// Make an edit's line endings agree with the file it targets.
///
/// `read` hands the model a CRLF file verbatim, but a model writes a plain `\n`
/// between the lines of a multi-line `old_string`, so on a Windows project the
/// edit never matched (#9262). An exact match always wins; only when it fails,
/// the file has CRLF, and the CRLF spelling of `old_string` does match is that
/// spelling used -- for `new_string` as well, so the replaced lines keep the
/// file's own endings. Text the edit does not touch is never rewritten, so a
/// file with mixed endings stays mixed.
fn line_endings_of_file<'a>(
    content: &str,
    old: &'a str,
    new: &'a str,
) -> (std::borrow::Cow<'a, str>, std::borrow::Cow<'a, str>) {
    use std::borrow::Cow;
    let crlf = |s: &str| Cow::Owned::<str>(s.replace("\r\n", "\n").replace('\n', "\r\n"));
    if !old.contains('\n') || content.contains(old) || !content.contains("\r\n") {
        return (Cow::Borrowed(old), Cow::Borrowed(new));
    }
    let old_crlf = crlf(old);
    if content.contains(&*old_crlf) {
        (old_crlf, crlf(new))
    } else {
        (Cow::Borrowed(old), Cow::Borrowed(new))
    }
}

/// Apply an `edit` call's replacements to `content` in order, so a later edit
/// may target text an earlier one inserted. Each `old_string` must match
/// exactly once in the text as it stands at that point. Shared by `edit()` and
/// its diff preview so the preview always shows the change that is applied.
fn apply_edits(content: &str, edits: &[serde_json::Value]) -> Result<String, String> {
    let mut content = content.to_string();
    for (i, e) in edits.iter().enumerate() {
        let Some(old_string) = e.get("old_string").and_then(|v| v.as_str()) else {
            return Err(format!("edit {}: missing 'old_string'", i + 1));
        };
        let Some(new_string) = e.get("new_string").and_then(|v| v.as_str()) else {
            return Err(format!("edit {}: missing 'new_string'", i + 1));
        };
        let (old_string, new_string) = line_endings_of_file(&content, old_string, new_string);
        let count = content.matches(&*old_string).count();
        if count == 0 {
            return Err(format!("edit {}: old_string not found", i + 1));
        }
        if count > 1 {
            return Err(format!(
                "edit {}: old_string not unique ({count} matches)",
                i + 1
            ));
        }
        content = content.replacen(&*old_string, &new_string, 1);
    }
    Ok(content)
}

async fn edit(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    confine: bool,
    write_roots: &[PathBuf],
) -> String {
    let Some(path) = arg_str(args, "path") else {
        return "ERROR: missing required argument 'path'".to_string();
    };
    let Some(edits) = args.get("edits").and_then(|v| v.as_array()) else {
        return "ERROR: missing required argument 'edits'".to_string();
    };
    if edits.is_empty() {
        return "ERROR: edits must contain at least one replacement".to_string();
    }
    if let Some((name, why)) = refuse_windows_name(path) {
        return format!("ERROR: refused to edit '{name}' in {path}: the name {why}");
    }
    let target = resolve_path(root, scratch, path);
    if confine && escapes_write_roots(root, scratch, write_roots, path).unwrap_or(true) {
        return format!("ERROR: refused to edit outside the agent workspace: {path}");
    }
    let shown = display_path(root, scratch, &target);
    // Resolve once and use that path for both the read and the write, each
    // opened without following links, so a swapped component redirects neither.
    let Ok(real) = write_landing(root, scratch, write_roots, &target) else {
        return format!("ERROR: refused to edit through a symlink out of the workspace: {path}");
    };
    let read_path = real.clone();
    let read = tokio::task::spawn_blocking(move || nofollow::read(&read_path)).await;
    let content = match read {
        Ok(Ok(bytes)) => match String::from_utf8(bytes) {
            Ok(c) => c,
            Err(_) => return format!("ERROR: {shown}: stream did not contain valid UTF-8"),
        },
        Ok(Err(e)) if nofollow::is_link_refused(&e) => {
            return format!("ERROR: refused to edit through a symlink out of the workspace: {path}")
        }
        Ok(Err(e)) => return format!("ERROR: {shown}: {e}"),
        Err(e) => return format!("ERROR: {shown}: {e}"),
    };

    let content = match apply_edits(&content, edits) {
        Ok(c) => c,
        Err(e) => return format!("ERROR: {shown}: {e}"),
    };

    let written = tokio::task::spawn_blocking(move || nofollow::write(&real, content.as_bytes()));
    match written.await {
        Ok(Ok(())) => format!("Applied {} edit(s) to {shown}", edits.len()),
        Ok(Err(e)) if nofollow::is_link_refused(&e) => {
            format!("ERROR: refused to edit through a symlink out of the workspace: {path}")
        }
        Ok(Err(e)) => format!("ERROR: {shown}: {e}"),
        Err(e) => format!("ERROR: {shown}: {e}"),
    }
}

/// The shell a confined command launches with: the (possibly jail-wrapped)
/// shell config, the path the sandbox exposes as its temp dir, and the policy
/// itself (which `denial_hint` reads even when the shell runs unconfined).
///
/// With the sandbox off the shell is spawned bare, the way the user's own
/// terminal would run it: no wrapper, no policy mounts, the real `$HOME` and
/// `/tmp`. Only a surface that opted in gets that (the CLI's
/// `--sandbox`/`sandbox` setting); the desktop never does, so an exec there is
/// still confined or withheld. Shared by `bash` and the `monitor` condition
/// scripts so a monitored evaluation runs under exactly the policy a `bash`
/// call would.
pub(crate) fn confined_shell(
    ctx: &ToolContext<'_>,
) -> Result<(proc::ShellConfig, Option<PathBuf>, jail::Policy), String> {
    let root = ctx.project_root;
    let mut policy =
        jail::Policy::new(root, ctx.allow_network).with_home_readonly(ctx.home_readonly);
    if let Some(mask) = ctx.mask_root {
        policy = policy.with_mask_root(mask);
    }
    if let Some(hide) = ctx.hidden_root {
        policy = policy.with_hide_root(hide);
    }
    if let Some(scratch) = ctx.scratch_root {
        policy = policy.with_scratch_root(scratch);
    }
    if !ctx.read_roots.is_empty() {
        policy = policy.with_read_roots(ctx.read_roots.to_vec());
    }
    if !ctx.write_roots.is_empty() {
        policy = policy.with_write_roots(ctx.write_roots.to_vec());
    }
    let shell = if ctx.sandbox {
        // No confinement available means no shell: running unsandboxed would give
        // the command the whole machine, which is never what the caller asked for.
        let Some(wrapped) = jail::wrap(proc::shell(), &policy) else {
            return Err(
                "ERROR: the shell tool is unavailable because no OS sandbox could be established on \
                 this system. Use the read/ls/find/grep tools instead."
                    .to_string(),
            );
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
    Ok((shell, sandbox_tmp, policy))
}

async fn bash(args: &serde_json::Value, ctx: &ToolContext<'_>) -> String {
    let Some(command) = arg_str(args, "command").filter(|command| !command.trim().is_empty())
    else {
        return "ERROR: missing required argument 'command'".to_string();
    };
    let timeout_secs = arg_u64(args, "timeout").unwrap_or(DEFAULT_BASH_TIMEOUT_SECS);

    let root = ctx.project_root;
    if !root.is_dir() {
        return format!(
            "ERROR: working directory does not exist: {}",
            root.display()
        );
    }

    let (shell, sandbox_tmp, policy) = match confined_shell(ctx) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let child = match proc::spawn(
        &shell,
        command,
        root,
        sandbox_tmp.as_deref(),
        ctx.shell_env(),
        ctx.thread_id,
    )
    .await
    {
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
    // Taken before the race so a backgrounded command's reported runtime covers
    // its whole life, not just the part after the timeout.
    let started = std::time::Instant::now();
    let spill_scratch = ctx.scratch_root.map(Path::to_path_buf);
    // Owned for the detached task, which unregisters from the same session
    // bucket the child was registered under.
    let thread_owned = ctx.thread_id.map(str::to_string);
    // Cloned into the detached task, which is what keeps a backgrounded command
    // collecting output after this call has already returned.
    let sink = ctx.on_output.clone();
    let sandboxed = ctx.sandbox;
    let escalation = ctx.escalation;
    // Fed from the first byte, so a command the user opens in `/shells` after it
    // backgrounded still shows what it printed before the timeout.
    let tail = pid.and_then(proc::output_handle);
    tokio::spawn(async move {
        let mut out = collect_and_format(child, spill_scratch, sink, tail).await;
        // Appended inside the task so a backgrounded job carries the hint too.
        if sandboxed {
            out.push_str(&sandbox_denial_note(&out, &policy, escalation));
        }
        if let Some(pid) = pid {
            proc::unregister(thread_owned.as_deref(), pid);
        }
        let _ = tx.send(out);
    });

    tokio::select! {
        res = &mut rx => res.unwrap_or_else(|_| "ERROR: background command ended without producing output".to_string()),
        by_user = hand_off_after(timeout_secs, ctx.detach_signal.clone()) => {
            // The command outran its timeout, or the user wants the agent back
            // sooner. Rather than killing it or blocking this call, let it keep
            // running and have the detached task's result land in a file the
            // agent reads when it is ready -- no second tool mode, no job
            // registry. `None` means the background file could not
            // be created; the command still runs, its output just isn't captured.
            // Flag it in the process registry so the `/shells` inspector lists it
            // as a detached shell the user can stop.
            let lead = if by_user {
                format!(
                    "{DETACHED_PREFIX}after {}s because the user sent a message, and is \
                     still running",
                    started.elapsed().as_secs()
                )
            } else {
                format!("{BACKGROUNDED_PREFIX}{timeout_secs}s and is still running in the background")
            };
            if let Some(pid) = pid {
                proc::mark_backgrounded(ctx.thread_id, pid);
            }
            // Rung by the detached task once the command really ends, so the
            // caller can ping the model rather than leaving it to poll the file.
            let done_sink = ctx.shell_done_sink.clone();
            let command_owned = command.to_string();
            let id = next_background_id();
            let temp = new_temp_path(ctx.scratch_root);
            let display = temp
                .as_ref()
                .map(|p| crate::tools::sandbox::scratch_display_path(ctx.scratch_root, p));
            // Raised before this call returns, so the caller is already owed a
            // result by the time the turn that made the call can end.
            if let Some(sink) = &done_sink {
                sink(crate::tools::ShellEvent::Backgrounded(
                    crate::tools::ShellBackgrounded { id, timeout_secs },
                ));
            }
            match (temp, display) {
                (Some(path), Some(display)) => {
                    let done_display = display.clone();
                    tokio::spawn(async move {
                        let out = rx.await.unwrap_or_else(|_| {
                            "ERROR: background command ended without producing output".to_string()
                        });
                        // The file is published before the doorbell rings, so a
                        // model reacting to the ping always finds the output
                        // already there -- and if publishing failed the ping
                        // says nothing was captured rather than naming a file
                        // that is absent or stale.
                        let published = write_background_output(&path, &out);
                        if let Some(sink) = done_sink {
                            sink(crate::tools::ShellEvent::Finished(crate::tools::ShellDone {
                                id,
                                command: command_owned,
                                elapsed_secs: started.elapsed().as_secs(),
                                output_path: published.then_some(done_display),
                                failed: bash_result_failed(&out),
                            }));
                        }
                    });
                    let ping = if ctx.shell_done_sink.is_some() {
                        " You do not have to wait or poll for it: you are notified \
                         automatically when it finishes, so carry on with other work \
                         or end your turn."
                    } else {
                        ""
                    };
                    format!(
                        "{lead}. Its result will be written to {display} once it \
                         finishes; read that file to collect it (if the output was large \
                         that file keeps a tail and points to the full log).{ping}"
                    )
                }
                _ => {
                    // No file, but the completion is still worth reporting: the
                    // model otherwise has no way to learn the command ended.
                    tokio::spawn(async move {
                        let out = rx.await.unwrap_or_default();
                        if let Some(sink) = done_sink {
                            sink(crate::tools::ShellEvent::Finished(crate::tools::ShellDone {
                                id,
                                command: command_owned,
                                elapsed_secs: started.elapsed().as_secs(),
                                output_path: None,
                                failed: bash_result_failed(&out),
                            }));
                        }
                    });
                    format!(
                        "{lead}, but a file to capture its output could not be created, \
                         so the output will not be collected."
                    )
                }
            }
        }
    }
}

/// How long a command runs before a detach request moves it to the background,
/// so a quick command started beside a typed message still answers inline.
const DETACH_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// Resolves once a running command is to be handed to the background: when its
/// timeout passes (`false`) or, sooner, when `detach` turns true after
/// [`DETACH_GRACE`] (`true`). A closed channel leaves only the timeout.
async fn hand_off_after(
    timeout_secs: u64,
    detach: Option<tokio::sync::watch::Receiver<bool>>,
) -> bool {
    let requested = async move {
        let Some(mut detach) = detach else {
            return std::future::pending::<()>().await;
        };
        tokio::time::sleep(DETACH_GRACE).await;
        if detach.wait_for(|on| *on).await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    tokio::select! {
        _ = tokio::time::sleep(std::time::Duration::from_secs(timeout_secs)) => false,
        _ = requested => true,
    }
}

/// Serial number for one backgrounded command, so a completion can be paired
/// with the hand-off that created it.
fn next_background_id() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Atomically publish a backgrounded command's formatted output at `path`: write
/// a sibling `.part` file, then rename it into place, so an agent polling for
/// `path` never observes a half-written file (existence means complete). Uses
/// [`open_spill_file`] so the write never follows a symlink; leaves nothing
/// behind on failure.
///
/// Returns whether `path` now holds this command's output. The caller reports
/// the path to the model only on `true`: on ENOSPC, or a leftover `.part` from
/// an earlier crash, the promise "its output is in {path}" would otherwise name
/// a file that is absent or stale.
fn write_background_output(path: &Path, content: &str) -> bool {
    use std::io::Write;
    let part = path.with_extension("part");
    let Ok(mut file) = open_spill_file(&part) else {
        return false;
    };
    if file.write_all(content.as_bytes()).is_err() || file.flush().is_err() {
        drop(file);
        remove_spill_file(&part);
        return false;
    }
    drop(file);
    if std::fs::rename(&part, path).is_err() {
        remove_spill_file(&part);
        return false;
    }
    true
}

/// Drain a running child's stdout+stderr into a bounded rolling buffer (so a
/// runaway command cannot exhaust memory), then format the result. Output is
/// combined chronologically and spilled to a temp file once it outgrows the
/// in-memory window, so the full text stays readable even though only a bounded
/// tail is kept in RAM.
async fn collect_and_format(
    mut child: tokio::process::Child,
    scratch: Option<PathBuf>,
    sink: Option<crate::tools::OutputSink>,
    tail: Option<proc::OutputTail>,
) -> String {
    use tokio::io::AsyncReadExt;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut cap = BashCapture::new(scratch);
    let mut bo = vec![0u8; 8192];
    let mut be = vec![0u8; 8192];
    let mut out_open = stdout.is_some();
    let mut err_open = stderr.is_some();
    // A read boundary can land mid-character, so decoding each chunk on its own
    // would emit a replacement character for any multi-byte sequence unlucky
    // enough to straddle one. Hold the incomplete tail back for the next chunk.
    let mut carry: Vec<u8> = Vec::new();
    let tee = |bytes: &[u8], carry: &mut Vec<u8>| {
        if let Some(tail) = tail.as_ref() {
            tail.push(bytes);
        }
        let Some(sink) = sink.as_ref() else { return };
        carry.extend_from_slice(bytes);
        let text = match std::str::from_utf8(carry) {
            Ok(_) => std::mem::take(carry),
            // Everything before the first bad byte is complete; the rest is
            // either a split character or genuinely invalid, and waiting one
            // more chunk tells us which.
            Err(e) => carry.drain(..e.valid_up_to()).collect(),
        };
        if !text.is_empty() {
            sink(String::from_utf8_lossy(&text).into_owned());
        }
    };
    while out_open || err_open {
        tokio::select! {
            r = stdout.as_mut().unwrap().read(&mut bo), if out_open => match r {
                Ok(0) | Err(_) => out_open = false,
                Ok(n) => { cap.push(&bo[..n]); tee(&bo[..n], &mut carry); }
            },
            r = stderr.as_mut().unwrap().read(&mut be), if err_open => match r {
                Ok(0) | Err(_) => err_open = false,
                Ok(n) => { cap.push(&be[..n]); tee(&be[..n], &mut carry); }
            },
        }
    }
    // Whatever is left was never completed: emit it lossily rather than losing it.
    if !carry.is_empty() {
        if let Some(sink) = sink.as_ref() {
            sink(String::from_utf8_lossy(&carry).into_owned());
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
        let collapsed = sanitize_output(&retained);
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

/// Whether a built-in call's result is a failure: an `ERROR` prefix for any
/// tool, or a failed exit marker from the exec tool. Keyed on the capability
/// rather than a tool name, so the agent loop, the desktop command and the MCP
/// server share one rule that a rename cannot leave behind.
pub fn tool_result_failed(tool: &BuiltinTool, content: &str) -> bool {
    content.starts_with("ERROR")
        || (tool.capability == super::Capability::Exec && bash_result_failed(content))
}

/// What a confined command's output gets appended when it failed on the
/// sandbox, empty otherwise. `Permission denied` on its own tells the model
/// nothing about *why*; without this it retries the same command until it
/// gives up. Only for a confined run: unsandboxed, a denial is an ordinary
/// filesystem permission and the note would name limits that are not in force.
/// With `escalation` the note also names the way out, so the model reaches for
/// it exactly when it applies rather than from the tool description alone.
fn sandbox_denial_note(out: &str, policy: &jail::Policy, escalation: bool) -> String {
    if !(bash_result_failed(out) && jail::looks_denied(out)) {
        return String::new();
    }
    let mut note = jail::denial_hint(policy);
    if escalation {
        note.push_str(ESCALATION_HINT);
    }
    note
}

/// The escalation half of [`sandbox_denial_note`].
const ESCALATION_HINT: &str = "\n[If this command is needed for the task, rerun it with `escalate: true` and a `justification` to ask the user to run it outside the sandbox.]";

/// True when a shell tool result reports failure via its exit marker: a
/// non-zero `[exit N]` or a signal termination. The marker is emitted by
/// [`BashCapture::finish`] on its own line and a truncation note may follow it,
/// so scan every line rather than only the tail. Model-facing content is
/// deliberately left unprefixed (a non-zero exit is not an "ERROR" string, since
/// commands like `grep`/`diff`/`test` exit non-zero without failing); this feeds
/// the display-only `is_error` flag so the TUI marks the call failed.
pub fn bash_result_failed(content: &str) -> bool {
    content
        .lines()
        .any(|line| matches!(exit_marker(line), Some(code) if code != Some(0)))
}

/// The exit marker [`BashCapture::finish`] writes, read off one line: `Some`
/// with the code for `[exit N]`, `Some(None)` for a signal, `None` for any
/// other line. Public so a renderer splits the marker off by the same rule.
pub fn exit_marker(line: &str) -> Option<Option<i32>> {
    let l = line.trim();
    if l == "[terminated by signal]" {
        return Some(None);
    }
    l.strip_prefix("[exit ")
        .and_then(|r| r.strip_suffix(']'))
        .and_then(|n| n.parse::<i32>().ok())
        .map(Some)
}

/// How the result of a command that outran its timeout starts. Private: callers
/// ask [`bash_result_backgrounded`], which also rules out real output that
/// happens to begin with the same words.
const BACKGROUNDED_PREFIX: &str = "Command exceeded ";

/// How the result of a command the user's message moved to the background
/// starts (see [`hand_off_after`]).
const DETACHED_PREFIX: &str = "Command moved to the background ";

/// True when a shell tool result is the hand-off of a command that outran its
/// timeout and kept running in the background, rather than its output. Such a
/// result carries no exit marker: the command has not finished.
pub fn bash_result_backgrounded(content: &str) -> bool {
    (content.starts_with(BACKGROUNDED_PREFIX) || content.starts_with(DETACHED_PREFIX))
        && !content.lines().any(|l| exit_marker(l).is_some())
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
/// A CSI sequence (colour, cursor movement) goes whole: dropping only its ESC
/// would leave `[31m` in the text.
fn sanitize_control(s: &str) -> String {
    if !s.chars().any(|c| c.is_control() && c != '\t' && c != '\n') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.next_if_eq(&'[').is_some() {
            // Parameter and intermediate bytes, then one final byte. Anything
            // else means the sequence was cut off: stop there and keep it, so
            // a broken escape cannot eat the lines after it.
            while chars.next_if(|b| (' '..='?').contains(b)).is_some() {}
            chars.next_if(|b| ('@'..='~').contains(b));
        } else if !c.is_control() || c == '\t' || c == '\n' {
            out.push(c);
        }
    }
    out
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
    crate::tools::spill::validated_subdir(&base, "jan-bash")
}

fn new_temp_path(scratch: Option<&Path>) -> Option<PathBuf> {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    Some(spill_dir(scratch)?.join(format!("jan-bash-{}-{}.txt", std::process::id(), n)))
}

/// Open a spill file atomically; see [`crate::tools::spill::open_excl`].
/// Combined with the validated non-symlink parent from [`spill_dir`], the
/// model-controlled spill bytes cannot be redirected onto a host file.
fn open_spill_file(path: &Path) -> std::io::Result<std::fs::File> {
    crate::tools::spill::open_excl(path)
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

const SCREENSHOT_MAX_PNG_BYTES: usize = 4 * 1024 * 1024; // 4 MiB

fn chrome_binary() -> Option<PathBuf> {
    if let Ok(env) = std::env::var("CHROME_PATH") {
        if !env.is_empty() {
            return Some(PathBuf::from(env));
        }
    }
    const CANDIDATES: &[&str] = &[
        // macOS (bundled browsers)
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        // Linux
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ];
    CANDIDATES
        .iter()
        .find(|p| Path::new(p).exists())
        .map(PathBuf::from)
}

/// Render a local HTML/SVG file to PNG bytes.
///
/// `backend`, when present, renders through the desktop's own webview (no Chrome
/// needed), and its result is final: the webview checks every frame the page
/// loads against the screenshot's own folder, and headless Chrome has no such
/// check, so a page that makes the webview fail must not get a second render
/// through Chrome. `None` (no desktop webview, e.g. the CLI) goes to Chrome.
/// Either way the viewport clamping and output cap are identical.
///
/// `width`/`height` are the viewport in CSS pixels; `scale` is the device pixel
/// ratio, so the PNG comes out `width*scale` pixels wide with the layout
/// unchanged.
pub async fn render_html_png(
    target: &Path,
    width: u64,
    height: u64,
    scale: f64,
    scope: PageScope,
    backend: Option<&ScreenshotBackend>,
) -> Result<Vec<u8>, String> {
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "html" && ext != "htm" && ext != "svg" {
        return Err(format!(
            "screenshot only renders .html/.htm/.svg files, got .{ext}"
        ));
    }
    if !target.is_file() {
        return Err(format!("file not found: {}", target.display()));
    }

    let width = width.clamp(320, 4096);
    let height = height.clamp(240, 4096);
    let scale = if scale.is_finite() {
        scale.clamp(1.0, 3.0)
    } else {
        1.0
    };

    // The desktop's webview capture, when injected, is the only renderer: see
    // the doc comment for why a failure here does not fall through to Chrome.
    if let Some(backend) = backend {
        let png = backend(target.to_path_buf(), width, height, scale, scope).await?;
        return finalize_screenshot_png(png);
    }

    let Some(chrome) = chrome_binary() else {
        return Err(
            "no Chrome/Chromium binary found (set CHROME_PATH to point at one)".to_string(),
        );
    };

    // A per-call profile (pid + nanos) keeps headless Chrome from colliding
    // with a running browser or a leftover from a previous call; `--screenshot`
    // exits after writing, but the wait below is bounded in case it lingers.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let shot = std::env::temp_dir().join(format!("jan-shot-{}-{nanos}.png", std::process::id()));
    let profile = std::env::temp_dir().join(format!("jan-chrome-{}-{nanos}", std::process::id()));

    // file:// lets the page resolve relative assets against its own directory,
    // matching what the artifact preview does.
    let file_url = format!("file://{}", target.display());
    // Chrome is spawned through the shell (`sh -c`): on macOS, a Chrome
    // headless-new process spawned directly by a non-bundled parent fails its
    // singleton/TCC check with "Multiple targets are not supported in headless
    // mode", while the same invocation via the shell succeeds. The `bash` tool
    // already relies on this property, so we inherit it here. The quoting below
    // is POSIX, so a PowerShell or cmd shell (Windows, where the quirk does not
    // exist) gets Chrome directly with its arguments instead.
    let chrome_args = [
        "--headless=new".to_string(),
        "--disable-gpu".to_string(),
        "--hide-scrollbars".to_string(),
        "--no-sandbox".to_string(),
        "--disable-dev-shm-usage".to_string(),
        "--no-first-run".to_string(),
        format!("--user-data-dir={}", profile.display()),
        format!("--force-device-scale-factor={scale}"),
        format!("--window-size={width},{height}"),
        format!("--screenshot={}", shot.display()),
        file_url.clone(),
    ];
    let shell = proc::shell();
    let mut launcher = if shell.kind == proc::ShellKind::Posix {
        let line = std::iter::once(chrome.to_string_lossy().into_owned())
            .chain(chrome_args.iter().cloned())
            .map(|a| shell_quote(&a))
            .collect::<Vec<_>>()
            .join(" ");
        let mut c = tokio::process::Command::new(&shell.program);
        c.args(&shell.args).arg(line);
        c
    } else {
        let mut c = tokio::process::Command::new(&chrome);
        c.args(&chrome_args);
        c
    };
    let mut child = match launcher
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("failed to launch Chrome: {e}")),
    };
    // Bounded: headless Chrome can linger after writing the PNG. Give it a
    // generous window, then reap whatever is left and proceed if the file
    // exists. stderr is drained on a background task so a chatty Chrome never
    // fills the pipe and deadlocks.
    let stderr_pipe = child.stderr.take();
    let drain = tokio::spawn(async move {
        use tokio::io::AsyncReadExt as _;
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let _ = tokio::time::timeout(std::time::Duration::from_secs(30), child.wait()).await;
    let _ = child.kill().await;
    let stderr = drain.await.unwrap_or_default();
    let _ = tokio::fs::remove_dir_all(&profile).await;

    let png = match tokio::fs::read(&shot).await {
        Ok(b) => b,
        Err(e) => {
            let detail = stderr.lines().take(3).collect::<Vec<_>>().join(" | ");
            return Err(format!("screenshot not produced: {e} (chrome: {detail})"));
        }
    };
    let _ = tokio::fs::remove_file(&shot).await;

    finalize_screenshot_png(png)
}

/// Shared empty-check and size cap for a rendered PNG, whatever produced it.
fn finalize_screenshot_png(png: Vec<u8>) -> Result<Vec<u8>, String> {
    if png.is_empty() {
        return Err("screenshot came out empty (page may be blank)".to_string());
    }
    if png.len() > SCREENSHOT_MAX_PNG_BYTES {
        return Err(format!(
            "screenshot is {} KiB, over the {}-MiB cap; try a smaller viewport",
            png.len() / 1024,
            SCREENSHOT_MAX_PNG_BYTES / 1024 / 1024
        ));
    }
    Ok(png)
}

/// Render a local HTML/SVG file and hand the model the image.
///
/// Returns an `ImageContentPart` rather than a data URL pasted into the text,
/// matching what `read` does for images: that is the form a vision model
/// actually consumes, and it keeps a megabyte of base64 out of the transcript.
///
/// Desktop-only (`feature = "tauri"`): the headless CLI has no webview to render
/// through and no window to show a Chrome fallback, so `screenshot` is not
/// advertised there. See `BUILTIN_TOOLS` and `builtin_tool_schemas`.
#[cfg(feature = "tauri")]
async fn screenshot(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    backend: Option<&ScreenshotBackend>,
) -> (String, Option<Vec<ImageContentPart>>) {
    let Some(path) = arg_str(args, "path") else {
        return ("ERROR: missing required argument 'path'".to_string(), None);
    };
    let width = arg_u64(args, "width").unwrap_or(1280).clamp(320, 4096);
    let height = arg_u64(args, "height").unwrap_or(960).clamp(240, 4096);
    let target = resolve_path(root, scratch, path);
    // A page the user approved outside the trusted roots gets no neighbours:
    // its directory was never part of what they approved.
    let scope = match landing(root, scratch, read_roots, &target) {
        Landing::Escapes => {
            return (
                format!(
                    "ERROR: refused to screenshot through a symlink out of the workspace: {path}"
                ),
                None,
            );
        }
        Landing::Inside(_) => PageScope::Directory,
        Landing::Outside(_) => PageScope::FileOnly,
    };
    let png = match render_html_png(&target, width, height, 1.0, scope, backend).await {
        Ok(b) => b,
        Err(e) => return (format!("ERROR: {e}"), None),
    };
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    (
        format!("Screenshot of {path} ({width}x{height})"),
        Some(vec![ImageContentPart {
            data_url: format!("data:image/png;base64,{b64}"),
            name,
        }]),
    )
}

async fn find(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    hidden: Option<&Path>,
) -> String {
    let pattern = arg_str(args, "pattern").map(String::from);
    let path = arg_str(args, "path").unwrap_or(".").to_string();
    let limit = arg_u64(args, "limit")
        .map(|v| v as usize)
        .unwrap_or(FIND_DEFAULT_LIMIT);
    let base = resolve_path(root, scratch, &path);
    if symlink_escapes_any_root(root, scratch, read_roots, &base) {
        return format!("ERROR: refused to search through a symlink out of the workspace: {path}");
    }
    let skip = hidden.and_then(|h| hidden_under(&base, h));

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
            .filter_entry(move |e| skip.as_deref() != Some(e.path()))
            .build()
            .flatten()
        {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(true) {
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

async fn grep(
    args: &serde_json::Value,
    root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    hidden: Option<&Path>,
) -> String {
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
    if symlink_escapes_any_root(root, scratch, read_roots, &base) {
        return format!("ERROR: refused to search through a symlink out of the workspace: {path}");
    }
    let root_owned = root.to_path_buf();
    let scratch_owned = scratch.map(Path::to_path_buf);
    // Owned for the blocking walk closure, which outlives this frame.
    let roots_owned = read_roots.to_vec();
    let skip = hidden.and_then(|h| hidden_under(&base, h));

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
                .filter_entry(move |e| skip.as_deref() != Some(e.path()))
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
                    && symlink_escapes_any_root(
                        &root_owned,
                        scratch_owned.as_deref(),
                        &roots_owned,
                        entry.path(),
                    )
                {
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
    // They use the project's store (`workspace::project_store`, under a test
    // temp home), the layout the CLI uses. The desktop's split roots are
    // covered in `workspace` and `commands`.
    async fn execute_builtin(tool: &BuiltinTool, args: &serde_json::Value, root: &Path) -> String {
        let store = crate::workspace::project_store(root);
        super::execute_builtin(tool, args, &ToolContext::new(root, &store, &[]))
            .await
            .0
    }

    async fn execute_builtin_with_diff(
        tool: &BuiltinTool,
        args: &serde_json::Value,
        root: &Path,
    ) -> (String, Option<String>) {
        let store = crate::workspace::project_store(root);
        let (content, diff, _images) =
            super::execute_builtin_with_diff(tool, args, &ToolContext::new(root, &store, &[]))
                .await;
        (content, diff)
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
    async fn read_returns_image_payload_for_a_png() {
        let root = unique_root();
        // Minimal valid PNG signature suffices for detection; the payload is
        // what the tool validates, not a decodable image.
        let bytes: Vec<u8> = vec![
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52,
        ];
        std::fs::write(root.join("pic.png"), &bytes).unwrap();
        let (content, images) = super::execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "pic.png"}),
            &ToolContext::new(&root, &crate::workspace::project_store(&root), &[]),
        )
        .await;
        assert!(content.contains("image/png"), "note: {content}");
        let img = images.expect("an image read must return image parts");
        assert_eq!(img.len(), 1);
        assert_eq!(img[0].name, "pic.png");
        assert!(img[0].data_url.starts_with("data:image/png;base64,"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_extension_fallback_catches_a_misnamed_image() {
        let root = unique_root();
        // No valid signature header, but the extension says PNG: the extension
        // fallback still returns an image payload.
        std::fs::write(root.join("scanned.png"), b"not a real png").unwrap();
        let (content, images) = super::execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "scanned.png"}),
            &ToolContext::new(&root, &crate::workspace::project_store(&root), &[]),
        )
        .await;
        assert!(!content.starts_with("ERROR"), "got: {content}");
        assert!(
            images.is_some(),
            "extension-matching png must yield an image"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_image_with_offset_falls_back_to_text_error() {
        let root = unique_root();
        let bytes: Vec<u8> = vec![0x89, b'P', b'N', b'G'];
        std::fs::write(root.join("pic.png"), &bytes).unwrap();
        let out = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "pic.png", "offset": 1, "limit": 1}),
            &root,
        )
        .await;
        assert!(
            out.starts_with("ERROR"),
            "slicing an image must not render: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_image_over_cap_falls_back_to_text_error() {
        let root = unique_root();
        // Valid PNG signature but far larger than MAX_IMAGE_BYTES: the size
        // gate must refuse to base64-dump it into model context.
        let mut bytes: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        bytes.resize(MAX_IMAGE_BYTES + 1, 0u8);
        std::fs::write(root.join("huge.png"), &bytes).unwrap();
        let (content, images) = super::execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "huge.png"}),
            &ToolContext::new(&root, &crate::workspace::project_store(&root), &[]),
        )
        .await;
        assert!(
            images.is_none(),
            "an over-cap image must not yield image parts"
        );
        assert!(content.starts_with("ERROR"), "got: {content}");
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

    async fn edit_file(root: &Path, file: &str, old: &str, new: &str) -> String {
        execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": file, "edits": [{"old_string": old, "new_string": new}]}),
            root,
        )
        .await
    }

    /// #9262: `read` shows a CRLF file with its `\r\n`, a model writes `\n`.
    #[tokio::test]
    async fn edit_matches_a_multi_line_old_string_in_a_crlf_file() {
        let root = unique_root();
        std::fs::write(root.join("a.txt"), b"one\r\ntwo\r\nthree\r\n").unwrap();
        let out = edit_file(&root, "a.txt", "one\ntwo", "ONE\nTWO").await;
        assert_eq!(out, "Applied 1 edit(s) to a.txt");
        // The replacement carries the file's own endings, and the rest is untouched.
        assert_eq!(
            std::fs::read(root.join("a.txt")).unwrap(),
            b"ONE\r\nTWO\r\nthree\r\n"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn edit_keeps_working_when_the_model_already_sends_crlf() {
        let root = unique_root();
        std::fs::write(root.join("a.txt"), b"one\r\ntwo\r\nthree\r\n").unwrap();
        let out = edit_file(&root, "a.txt", "one\r\ntwo", "X").await;
        assert_eq!(out, "Applied 1 edit(s) to a.txt");
        assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), b"X\r\nthree\r\n");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A file with mixed endings: an exact match wins, so the model's own
    /// spelling is never rewritten when it already fits.
    #[tokio::test]
    async fn edit_prefers_an_exact_match_in_a_mixed_ending_file() {
        let root = unique_root();
        std::fs::write(root.join("m.txt"), b"a\nb\r\nc\r\n").unwrap();
        let out = edit_file(&root, "m.txt", "a\nb", "A\nB").await;
        assert_eq!(out, "Applied 1 edit(s) to m.txt");
        assert_eq!(std::fs::read(root.join("m.txt")).unwrap(), b"A\nB\r\nc\r\n");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An LF file is not touched by the CRLF fallback.
    #[tokio::test]
    async fn edit_does_not_introduce_crlf_into_an_lf_file() {
        let root = unique_root();
        std::fs::write(root.join("l.txt"), b"one\ntwo\nthree\n").unwrap();
        let out = edit_file(&root, "l.txt", "one\ntwo", "ONE\nTWO").await;
        assert_eq!(out, "Applied 1 edit(s) to l.txt");
        assert_eq!(std::fs::read(root.join("l.txt")).unwrap(), b"ONE\nTWO\nthree\n");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A genuine miss in a CRLF file is still a miss, and a repeated block is
    /// still ambiguous after the endings are reconciled.
    #[tokio::test]
    async fn edit_crlf_fallback_still_reports_a_miss_and_ambiguity() {
        let root = unique_root();
        std::fs::write(root.join("d.txt"), b"x\r\ny\r\nx\r\ny\r\n").unwrap();
        let miss = edit_file(&root, "d.txt", "x\nz", "q").await;
        assert_eq!(miss, "ERROR: d.txt: edit 1: old_string not found");
        let dup = edit_file(&root, "d.txt", "x\ny", "q").await;
        assert!(dup.contains("old_string not unique (2 matches)"), "got: {dup}");
        assert_eq!(
            std::fs::read(root.join("d.txt")).unwrap(),
            b"x\r\ny\r\nx\r\ny\r\n"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The approval preview must locate the edit the way `edit` will, or the
    /// user is shown a different change from the one that is applied.
    #[tokio::test]
    async fn crlf_edit_preview_matches_the_applied_change() {
        let root = unique_root();
        std::fs::write(root.join("p.txt"), b"zero\r\none\r\ntwo\r\nthree\r\n").unwrap();
        let args = json!({"path": "p.txt", "edits": [{"old_string": "one\ntwo", "new_string": "ONE\nTWO"}]});
        let diff = preview_diff(lookup("edit").unwrap(), &args, &root)
            .await
            .expect("a diff");
        assert!(diff.contains("ONE") && diff.contains("TWO"), "got: {diff}");
        // A miss is numbered from line 1; a located edit is numbered where it is.
        assert!(diff.contains("-    2 | one"), "numbered against the real file: {diff}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// #9263: Windows-only, because a name is only a problem where Win32 rewrites it.
    #[tokio::test]
    #[cfg(windows)]
    async fn write_and_edit_refuse_names_windows_cannot_address() {
        let root = unique_root();
        for name in ["aux", "con.txt", "NUL", "com1.log", "name.", "name ", "a.txt:stream", "sub/prn.c"] {
            let w = execute_builtin(
                lookup("write").unwrap(),
                &json!({"path": name, "content": "x"}),
                &root,
            )
            .await;
            assert!(w.starts_with("ERROR: refused to write"), "{name}: {w}");
            let e = edit_file(&root, name, "a", "b").await;
            assert!(e.starts_with("ERROR: refused to edit"), "{name}: {e}");
        }
        // Nothing was created, not even the parent of a refused nested path.
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn write_still_accepts_ordinary_names_that_resemble_reserved_ones() {
        let root = unique_root();
        for name in ["auxiliary.txt", "console.log", "com10.txt", "lpt.txt", "a.b.c", ".gitignore", "x y.txt"] {
            let w = execute_builtin(
                lookup("write").unwrap(),
                &json!({"path": name, "content": "x"}),
                &root,
            )
            .await;
            assert!(w.starts_with("Created "), "{name}: {w}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn edit_diff_single_hunk_has_no_header() {
        let d = render_edit_diff(&[json!({"old_string": "foo", "new_string": "bar"})], "foo");
        assert_eq!(d, "-    1 | foo\n+    1 | bar");
    }

    /// A batch renders as one diff of the file before and after all its edits,
    /// with no per-edit headers.
    #[test]
    fn edit_diff_merges_a_batch_into_one_numbered_diff() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "a\nb", "new_string": "A"}),
                json!({"old_string": "c", "new_string": "C\nD"}),
            ],
            "a\nb\nc",
        );
        assert_eq!(
            d,
            "-    1 | a\n-    2 | b\n-    3 | c\n+    1 | A\n+    2 | C\n+    3 | D"
        );
    }

    #[test]
    fn edit_diff_numbers_against_real_file_position() {
        let d = render_edit_diff(
            &[json!({"old_string": "two", "new_string": "TWO"})],
            "one\ntwo\nthree",
        );
        assert_eq!(
            d,
            "     1 | one\n-    2 | two\n+    2 | TWO\n     3 | three"
        );
    }

    /// Two edits far apart in one call: one diff of the final file, split by a
    /// gap. Deleted lines keep their old number and the rest take the final
    /// one, so `eight` (old line 8) becomes `EIGHT` on line 9 after the
    /// insertion above it.
    #[test]
    fn edit_diff_numbers_later_edits_against_earlier_ones() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "two", "new_string": "TWO\nTWO.5"}),
                json!({"old_string": "eight", "new_string": "EIGHT"}),
            ],
            "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
        );
        assert_eq!(d, SPREAD_EDITS_DIFF);
    }

    const SPREAD_EDITS_DIFF: &str = concat!(
        "     1 | one\n",
        "-    2 | two\n",
        "+    2 | TWO\n",
        "+    3 | TWO.5\n",
        "     4 | three\n",
        "     5 | four\n",
        "      ...\n",
        "     7 | six\n",
        "     8 | seven\n",
        "-    8 | eight\n",
        "+    9 | EIGHT\n",
        "    10 | nine",
    );

    /// The edits array need not follow file order: the diff is still listed
    /// top to bottom with ascending line numbers.
    #[test]
    fn edit_diff_lists_out_of_order_edits_in_file_order() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "eight", "new_string": "EIGHT"}),
                json!({"old_string": "two", "new_string": "TWO"}),
            ],
            "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
        );
        assert_eq!(
            d,
            concat!(
                "     1 | one\n",
                "-    2 | two\n",
                "+    2 | TWO\n",
                "     3 | three\n",
                "     4 | four\n",
                "      ...\n",
                "     6 | six\n",
                "     7 | seven\n",
                "-    8 | eight\n",
                "+    8 | EIGHT\n",
                "     9 | nine",
            )
        );
    }

    /// An insertion listed after an edit further down still shifts that edit's
    /// final line numbers, exactly as when the edits come in file order.
    #[test]
    fn edit_diff_shifts_an_earlier_listed_edit_below_a_later_insertion() {
        let d = render_edit_diff(
            &[
                json!({"old_string": "eight", "new_string": "EIGHT"}),
                json!({"old_string": "two", "new_string": "TWO\nTWO.5"}),
            ],
            "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
        );
        assert_eq!(d, SPREAD_EDITS_DIFF);
    }

    /// A later edit may target text an earlier one inserted, as `edit()`
    /// applies them in order; the diff shows only the net change.
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
            "     1 | a\n     2 | b\n+    3 | GAMMA\n     4 | c"
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
        // A probe left by an aborted run would turn this into a "No change" write.
        let _ = std::fs::remove_file(&outside);
        let out = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "../jan_escape_probe.txt", "content": "x"}),
            &root,
        )
        .await;
        assert!(outside.exists(), "precondition: the write escapes the root");
        assert!(!out.contains(".."), "must not echo the raw path: {out}");
        // Compare the named path by what it resolves to, not by spelling: on
        // Windows the message uses `/` separators, and the temp dir may be
        // spelled with an 8.3 short name on one side and not the other.
        let shown = out
            .strip_prefix("Created ")
            .and_then(|rest| rest.rsplit_once(" ("))
            .map(|(path, _)| path)
            .unwrap_or_else(|| panic!("unexpected message shape: {out}"));
        assert!(
            Path::new(shown).is_absolute(),
            "an escape is named by its absolute path, got: {out}"
        );
        assert_eq!(
            std::fs::canonicalize(shown).ok(),
            std::fs::canonicalize(&outside).ok(),
            "must name the real destination, got: {out}"
        );
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A write through a dangling link out of the project must not create the
    /// link's target, confined or not: the handler's symlink re-check is what
    /// stands between an approved in-project name and the host file.
    #[cfg(unix)]
    #[tokio::test]
    async fn write_through_dangling_symlink_is_refused() {
        let root = unique_root();
        let outside = unique_root();
        let target = outside.join("authorized_keys");
        std::os::unix::fs::symlink(&target, root.join("notes.md")).unwrap();
        let store = crate::workspace::project_store(&root);
        for confine in [false, true] {
            let ctx = ToolContext::new(&root, &store, &[]).with_confined_writes(confine);
            let out = super::execute_builtin(
                lookup("write").unwrap(),
                &json!({"path": "notes.md", "content": "ATTACKER"}),
                &ctx,
            )
            .await
            .0;
            assert!(out.starts_with("ERROR: refused to write"), "confine={confine}: {out}");
            assert!(!target.exists(), "confine={confine}: target was created");
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// Links that stay inside the project (a yarn workspace's shape) keep
    /// working for both `write` and `edit`, landing on the real file.
    #[cfg(unix)]
    #[tokio::test]
    async fn write_and_edit_follow_an_in_project_link() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::os::unix::fs::symlink(root.join("pkg"), root.join("linked")).unwrap();
        let w = execute_builtin(
            lookup("write").unwrap(),
            &json!({"path": "linked/new/a.txt", "content": "one"}),
            &root,
        )
        .await;
        assert_eq!(w, "Created linked/new/a.txt (3 bytes)");
        let e = execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "linked/new/a.txt", "edits": [{"old_string": "one", "new_string": "two"}]}),
            &root,
        )
        .await;
        assert_eq!(e, "Applied 1 edit(s) to linked/new/a.txt");
        assert_eq!(std::fs::read_to_string(root.join("pkg/new/a.txt")).unwrap(), "two");
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
        .await
        .0;
        assert!(
            out.starts_with("ERROR: refused to write outside"),
            "got: {out}"
        );
        assert!(!root.parent().unwrap().join("escape.txt").exists());

        let out = super::execute_builtin(
            lookup("edit").unwrap(),
            &json!({"path": "../escape.txt", "edits": [{"old_string": "a", "new_string": "b"}]}),
            &ctx,
        )
        .await
        .0;
        assert!(
            out.starts_with("ERROR: refused to edit outside"),
            "got: {out}"
        );
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
        .await
        .0;
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
        let out = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "classified", "path": "."}),
            &root,
        )
        .await;
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

        let out = execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "linked.js"}),
            &root,
        )
        .await;
        assert!(out.contains("needle"), "in-root symlink was refused: {out}");

        let out = execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "needle", "path": "."}),
            &root,
        )
        .await;
        assert!(
            out.contains("linked.js"),
            "in-root symlink was skipped: {out}"
        );

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

        assert!(
            new_temp_path(Some(&scratch)).is_none(),
            "dir symlink accepted"
        );
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
        .await
        .0;
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
        let out =
            execute_builtin(lookup("read").unwrap(), &json!({"path": "link.txt"}), &root).await;
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
        .await
        .0;
        assert!(out.starts_with("Created /tmp/scratch.txt"), "got: {out}");
        assert!(scratch.join("scratch.txt").exists(), "wrote into scratch");

        let out = super::execute_builtin(
            lookup("read").unwrap(),
            &json!({"path": "/tmp/scratch.txt"}),
            &ctx,
        )
        .await
        .0;
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
            &crate::tools::gate::GateContext {
                project_root: &root,
                scratch: Some(&scratch),
                read_roots: &[],
                write_roots: &[],
                hidden_root: None,
            },
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
            &crate::tools::gate::GateContext {
                project_root: &root,
                scratch: Some(&scratch),
                read_roots: &[],
                write_roots: &[],
                hidden_root: None,
            },
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

    /// With `$HOME` as the project, a walk of `.` would otherwise read the Jan
    /// home: the gate only sees the `.` argument, so the walks skip it too.
    #[tokio::test]
    async fn walks_skip_the_jan_home_inside_the_project() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(jan.join("projects/p-1")).unwrap();
        std::fs::write(jan.join("config.toml"), b"api_key = SECRET_MARKER").unwrap();
        std::fs::write(jan.join("projects/p-1/agent.toml"), b"SECRET_MARKER").unwrap();
        std::fs::write(home.join("notes.txt"), b"SECRET_MARKER").unwrap();
        std::fs::write(home.join(".janitor"), b"SECRET_MARKER").unwrap();
        let store = crate::workspace::project_store(&home);
        let ctx = ToolContext::new(&home, &store, &[]).with_hidden_root(Some(&jan));
        let run = |tool: &'static str, args: serde_json::Value| {
            let ctx = ctx.clone();
            async move { super::execute_builtin(lookup(tool).unwrap(), &args, &ctx).await.0 }
        };
        for path in [".", "./"] {
            let ls = run("ls", json!({"path": path})).await;
            assert!(ls.contains("notes.txt") && ls.contains(".janitor"), "{ls}");
            assert!(!ls.lines().any(|l| l == ".jan/"), "{ls}");
            let find = run("find", json!({"pattern": "**/*", "path": path})).await;
            assert!(find.contains("notes.txt"), "{find}");
            assert!(!find.contains("config.toml") && !find.contains("agent.toml"), "{find}");
            let grep = run("grep", json!({"pattern": "SECRET_MARKER", "path": path})).await;
            assert!(grep.contains("notes.txt") && grep.contains(".janitor"), "{grep}");
            assert!(!grep.contains("config.toml") && !grep.contains("agent.toml"), "{grep}");
        }
        // Unset (sandbox off), the home is walked like any other directory.
        let open = ToolContext::new(&home, &store, &[]);
        let grep = super::execute_builtin(
            lookup("grep").unwrap(),
            &json!({"pattern": "SECRET_MARKER"}),
            &open,
        )
        .await
        .0;
        assert!(grep.contains("config.toml"), "{grep}");
        let _ = std::fs::remove_dir_all(&home);
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

    /// A command's output reaches the sink as it is produced, not just in the
    /// returned string -- this is what makes a long command visible while it runs.
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_streams_output_to_the_sink() {
        let root = unique_root();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = {
            let seen = seen.clone();
            std::sync::Arc::new(move |chunk: String| {
                seen.lock().unwrap().push_str(&chunk);
            }) as crate::tools::OutputSink
        };
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[])
            .with_sandbox(false)
            .with_output_sink(sink);
        let out = super::execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "printf 'one\ntwo\n'"}),
            &ctx,
        )
        .await
        .0;
        let streamed = seen.lock().unwrap().clone();
        assert!(streamed.contains("one"), "sink saw nothing: {streamed:?}");
        assert!(
            streamed.contains("two"),
            "sink missed a chunk: {streamed:?}"
        );
        // The return value still carries it, so the model's view is unchanged.
        assert!(out.contains("one") && out.contains("two"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A backgrounded command keeps streaming after the call has returned: the
    /// sink lives in the detached task, which is the whole reason a long job can
    /// show progress while it runs on.
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_backgrounded_command_keeps_streaming() {
        let root = unique_root();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = {
            let seen = seen.clone();
            std::sync::Arc::new(move |chunk: String| {
                seen.lock().unwrap().push_str(&chunk);
            }) as crate::tools::OutputSink
        };
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[])
            .with_sandbox(false)
            .with_output_sink(sink);
        // timeout 0 => backgrounds immediately, before the command prints.
        let out = super::execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "sleep 0.2; printf 'late\n'", "timeout": 0}),
            &ctx,
        )
        .await
        .0;
        assert!(
            out.contains("still running in the background"),
            "should background: {out}"
        );
        assert!(
            seen.lock().unwrap().is_empty(),
            "nothing printed yet at hand-off"
        );
        // The detached task is still running and still holds the sink.
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;
        let streamed = seen.lock().unwrap().clone();
        assert!(
            streamed.contains("late"),
            "a backgrounded job must keep reporting: {streamed:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The doorbell: a backgrounded command must announce itself the moment it
    /// is detached (so the caller knows a result is owed and does not end the
    /// run under it) and report again when it really finishes, naming the file
    /// the output was published to. The order matters -- the file is written
    /// before the ping, so reacting to the ping always finds it there.
    // POSIX command text, and a 1.2s budget a cold PowerShell start can miss.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_backgrounded_command_rings_the_doorbell_when_it_finishes() {
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = events.clone();
        let ctx = ToolContext::new(&root, &store, &[]).with_shell_done_sink(std::sync::Arc::new(
            move |e: crate::tools::ShellEvent| seen.lock().unwrap().push(e),
        ));
        let out = super::execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "sleep 0.3; echo done; exit 3", "timeout": 0}),
            &ctx,
        )
        .await
        .0;
        assert!(out.contains("still running in the background"), "{out}");
        assert!(
            out.contains("pinged automatically") || out.contains("notified automatically"),
            "a sink-backed run must tell the model not to poll: {out}"
        );
        // Owed immediately, before the command has ended.
        let handoff = {
            let got = events.lock().unwrap();
            let [crate::tools::ShellEvent::Backgrounded(handoff)] = got.as_slice() else {
                panic!("must announce the hand-off synchronously: {got:?}");
            };
            handoff.clone()
        };
        assert_eq!(
            handoff.timeout_secs, 0,
            "the park budget is sized from this"
        );
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        let got = events.lock().unwrap().clone();
        let Some(crate::tools::ShellEvent::Finished(done)) = got.get(1) else {
            panic!("no completion event: {got:?}");
        };
        assert_eq!(
            done.id, handoff.id,
            "the completion closes its own hand-off"
        );
        assert!(done.failed, "exit 3 must be reported as a failure");
        assert!(done.command.contains("echo done"), "names the command");
        let path = done.output_path.clone().expect("an output file");
        let collected =
            super::execute_builtin(lookup("read").unwrap(), &json!({"path": path}), &ctx)
                .await
                .0;
        assert!(
            collected.contains("done"),
            "the output must already be readable when the ping lands: {collected}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A detach request moves a long command to the background well before
    /// its timeout, through the same hand-off, while a quick command started
    /// under the same request still answers inline.
    // POSIX command text.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_detach_request_backgrounds_a_long_command_but_not_a_quick_one() {
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = events.clone();
        let (_detach, signal) = tokio::sync::watch::channel(true);
        let ctx = ToolContext::new(&root, &store, &[])
            .with_sandbox(false)
            .with_detach_signal(signal)
            .with_shell_done_sink(std::sync::Arc::new(move |e: crate::tools::ShellEvent| {
                seen.lock().unwrap().push(e)
            }));
        let quick = super::execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "echo quick", "timeout": 600}),
            &ctx,
        )
        .await
        .0;
        assert!(quick.contains("quick") && quick.contains("[exit 0]"), "{quick}");
        let command = format!("sleep 30; echo detach-{}", std::process::id());
        let started = std::time::Instant::now();
        let out = super::execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": command, "timeout": 600}),
            &ctx,
        )
        .await
        .0;
        let waited = started.elapsed();
        if let Some(shell) = proc::snapshot().into_iter().find(|s| s.command == command) {
            proc::kill(shell.pid);
        }
        assert!(waited < std::time::Duration::from_secs(10), "{waited:?}");
        assert!(waited >= DETACH_GRACE, "{waited:?}");
        assert!(bash_result_backgrounded(&out), "{out}");
        assert!(out.contains("because the user sent a message"), "{out}");
        assert!(out.contains("notified automatically"), "{out}");
        assert!(matches!(
            events.lock().unwrap().as_slice(),
            [crate::tools::ShellEvent::Backgrounded(_)]
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Without a sink the tool must not promise a ping that will never come.
    #[tokio::test]
    async fn backgrounding_without_a_doorbell_still_tells_the_model_to_read_the_file() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "sleep 2", "timeout": 0}),
            &root,
        )
        .await;
        assert!(out.contains("result will be written to"), "{out}");
        assert!(
            !out.contains("notified automatically"),
            "no sink, no promise of a ping: {out}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A backgrounded command's live tail holds what it printed before the
    /// timeout as well as after, and the registry lets go of it once the
    /// command ends.
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_backgrounded_command_feeds_its_live_tail() {
        let root = unique_root();
        let marker = format!("tail-{}", std::process::id());
        let command = format!("printf 'early {marker}\\n'; sleep 1.5; printf 'late\\n'; sleep 0.5");
        let out = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": command, "timeout": 1}),
            &root,
        )
        .await;
        assert!(out.contains("still running in the background"), "{out}");
        let pid = proc::snapshot()
            .into_iter()
            .find(|s| s.command == command && s.backgrounded)
            .expect("listed as a background shell")
            .pid;
        let tail = proc::output_handle(pid).expect("tail while running");
        let (early, _) = tail.read();
        assert!(early.contains(&format!("early {marker}")), "{early:?}");
        // Polled rather than slept for a fixed time: a loaded machine can run
        // the command well past its nominal two seconds.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while proc::output_handle(pid).is_some() && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(proc::output_handle(pid).is_none(), "the registry let go when it ended");
        let (all, bytes) = tail.read();
        assert!(all.ends_with("late\n") && all.contains("early"), "{all:?}");
        assert_eq!(bytes, all.len() as u64);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The hand-off is recognisable as such, while finished output that
    /// happens to start with the same words is not.
    #[test]
    fn only_the_hand_off_reads_as_backgrounded() {
        assert!(bash_result_backgrounded(&format!(
            "{BACKGROUNDED_PREFIX}5s and is still running in the background."
        )));
        assert!(bash_result_backgrounded(&format!(
            "{DETACHED_PREFIX}after 5s because the user sent a message, and is still running."
        )));
        assert!(!bash_result_backgrounded("Command exceeded quota\n[exit 1]"));
        assert!(!bash_result_backgrounded("ok\n[exit 0]"));
    }

    #[tokio::test]
    async fn bash_exceeding_timeout_backgrounds_instead_of_erroring() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "sleep 2", "timeout": 0}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(out.contains("still running in the background"), "{out}");
        assert!(out.contains("result will be written to"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The path in the backgrounding notice: the detached task's full formatted
    /// output lands there when the command finishes, so the agent reads that file
    /// to collect the result instead of a second tool call.
    #[tokio::test]
    #[cfg_attr(
        windows,
        ignore = "re-execs the test binary as the AppContainer helper; covered by tests/sandbox_spawn.rs"
    )]
    async fn backgrounded_output_lands_in_the_reported_file() {
        let root = unique_root();
        let started = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "sleep 0.2; echo done", "timeout": 0}),
            &root,
        )
        .await;
        let path = started
            .split("written to ")
            .nth(1)
            .and_then(|rest| rest.split(" once it finishes").next())
            .map(str::trim)
            .map(std::path::PathBuf::from)
            .expect("notice names the output file");

        // The file appears only once the command has finished (atomic rename),
        // so its existence is the completion signal the agent polls for.
        let mut body = None;
        for _ in 0..50 {
            if path.exists() {
                body = Some(std::fs::read_to_string(&path).unwrap());
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let body = body.expect("output file must appear after the command finishes");
        assert!(body.contains("done"), "unexpected: {body}");
        assert!(body.contains("[exit 0]"), "carries the exit marker: {body}");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn bash_missing_command_errors() {
        let root = unique_root();
        let out = execute_builtin(lookup("shell").unwrap(), &json!({}), &root).await;
        assert!(out.starts_with("ERROR: missing required argument"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A sandbox denial names the way out only when the run offers it, and an
    /// ordinary failure (or a success) gets no note at all.
    #[test]
    fn sandbox_denial_note_mentions_escalation_only_when_offered() {
        let policy = jail::Policy::new(Path::new("/w"), true);
        let denied = "touch: cannot touch '/x': Read-only file system\n[exit 1]";
        let plain = sandbox_denial_note(denied, &policy, false);
        assert!(plain.contains("[sandbox:"), "got: {plain}");
        assert!(!plain.contains("escalate"));
        let offered = sandbox_denial_note(denied, &policy, true);
        assert!(offered.starts_with(&plain));
        assert!(offered.contains("escalate: true"));
        assert!(sandbox_denial_note("no such file\n[exit 1]", &policy, true).is_empty());
        assert!(sandbox_denial_note("Read-only file system\n[exit 0]", &policy, true).is_empty());
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
    #[cfg_attr(
        windows,
        ignore = "re-execs the test binary as the AppContainer helper; covered by tests/sandbox_spawn.rs"
    )]
    async fn bash_nonzero_exit_is_not_error() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("shell").unwrap(),
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
    #[cfg_attr(
        windows,
        ignore = "re-execs the test binary as the AppContainer helper; covered by tests/sandbox_spawn.rs"
    )]
    async fn bash_success_emits_exit_0_marker() {
        let root = unique_root();
        let out = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "echo done"}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(out.contains("done"), "unexpected: {out}");
        assert!(out.contains("[exit 0]"), "unexpected: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_exit_marker_is_on_its_own_line() {
        let root = unique_root();
        // stderr-only output with no trailing newline (mirrors `git push`).
        let out = execute_builtin(
            lookup("shell").unwrap(),
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

    /// Typical command output (well under the caps) must reach the model whole:
    /// lowering the caps for context economy must not start truncating the
    /// everyday `cargo check` / `git status` sized result.
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_output_under_the_cap_survives_intact() {
        let root = unique_root();
        // ~32KB over 500 lines: half the byte cap, a quarter of the line cap.
        let out = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "for i in $(seq 1 500); do printf '%064d\\n' \"$i\"; done"}),
            &root,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "unexpected: {out}");
        assert!(
            !out.contains("output truncated"),
            "should not truncate: len={}",
            out.len()
        );
        assert!(out.contains("000500"), "last line lost: end of {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The counterpart: past the cap the notice appears. Pinned just above
    /// 64KB so the test fails if the cap drifts back up to the old 256KB.
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_output_past_the_byte_cap_is_truncated() {
        let root = unique_root();
        // ~128KB over 2000 lines of 64 chars: over the byte cap, at the line cap.
        let out = execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "for i in $(seq 1 2000); do printf '%064d\\n' \"$i\"; done"}),
            &root,
        )
        .await;
        assert!(
            out.contains("output truncated at"),
            "should truncate: end of {out}"
        );
        // Pinned just above BASH_MAX_BYTES (not at some loose multiple of it):
        // the notice alone already fails at the old 256KB cap, so only a tight
        // bound actually pins the byte cap itself.
        assert!(
            out.len() < BASH_MAX_BYTES + 6 * 1024,
            "cap not honoured: len={}",
            out.len()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_cr_progress_is_collapsed_not_truncated() {
        let root = unique_root();
        // Mimics git progress: one logical line redrawn thousands of times with
        // \r (no \n). Raw bytes exceed the byte cap, but only the final redraw
        // is visible, so the model must see it intact with no truncation notice.
        let out = execute_builtin(
            lookup("shell").unwrap(),
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

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_output_overflow_spills_to_readable_temp_file() {
        let root = unique_root();
        // ~1MB of output: over the bash cap, so it must spill to a temp file
        // and tell the agent how to read the rest.
        let out = execute_builtin(
            lookup("shell").unwrap(),
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
    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_spill_is_readable_when_a_scratch_is_set() {
        let root = unique_root();
        let scratch = unique_root();
        let store = crate::workspace::project_store(&root);
        let ctx = ToolContext::new(&root, &store, &[]).with_scratch_root(&scratch);
        let out = super::execute_builtin(
            lookup("shell").unwrap(),
            &json!({"command": "for i in $(seq 1 16000); do printf '%064d\\n' \"$i\"; done"}),
            &ctx,
        )
        .await
        .0;
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
        .await
        .0;
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
            lookup("shell").unwrap(),
            &json!({"command": "echo unconfined"}),
            &ctx,
        )
        .await
        .0;
        assert!(
            out.contains("unconfined"),
            "unsandboxed bash did not run: {out}"
        );
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

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_line_overflow_keeps_the_tail_not_the_head() {
        let root = unique_root();
        // 12000 short lines: well over the line cap. Tail truncation must keep
        // the LAST lines (final result/errors) and drop the earliest ones.
        let out = execute_builtin(
            lookup("shell").unwrap(),
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

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_strips_control_chars_but_keeps_text() {
        let root = unique_root();
        // NUL and bell around visible text plus an ANSI color escape.
        let out = execute_builtin(
            lookup("shell").unwrap(),
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
        assert!(out.contains("abred\n"), "the whole colour sequence goes: {out:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A cut-off or malformed `ESC[` ends at the first byte that cannot belong
    /// to it, so the text after it survives.
    #[test]
    fn a_broken_escape_does_not_swallow_what_follows() {
        assert_eq!(sanitize_control("\u{1b}[\n12\n34\nok"), "\n12\n34\nok");
    }

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
    #[tokio::test]
    async fn bash_command_reading_stdin_does_not_hang() {
        let root = unique_root();
        // stdin is /dev/null, so a command that reads it gets immediate EOF and
        // returns instead of blocking the agent loop forever (e.g. a `sudo`
        // password prompt). The failure/output comes back as a normal result.
        let out = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            execute_builtin(lookup("shell").unwrap(), &json!({"command": "cat"}), &root),
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
            lookup("shell").unwrap(),
            &json!({"command": "echo hi"}),
            &root,
        )
        .await;
        assert!(
            out.starts_with("ERROR: working directory does not exist"),
            "unexpected: {out}"
        );
    }

    /// #497 bug 3: the harness side of a conservative tidy, on a store modeled
    /// on the smoke test (neutral notes plus explicitly finished ones). The
    /// model's choices cannot be unit-tested; what is tested is what the
    /// harness enforces whatever the model does: `move` keeps a note's front
    /// matter and recency, an `index`/`MEMORY` note is refused, and a run with
    /// a change budget stops mutating at the cap and says so.
    #[tokio::test]
    async fn a_capped_tidy_moves_archives_and_stops_at_the_cap() {
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let dir = store.join("memory");
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..70 {
            std::fs::write(
                dir.join(format!("note-{i:03}.md")),
                format!("Note {i:03} about area {i} with a fairly long descriptive title\n\nBody {i}.\n"),
            )
            .unwrap();
        }
        for i in 0..10 {
            std::fs::write(
                dir.join(format!("shipped-{i:02}.md")),
                format!("PR {} merged and released, work finished\n\nNothing left.\n", 9100 + i),
            )
            .unwrap();
        }
        let budget = crate::memory::ChangeBudget::new(crate::memory::TIDY_MAX_CHANGES);
        let memory = lookup("memory").unwrap();
        let ctx = ToolContext::new(&root, &store, &[]).with_memory_change_budget(Some(&budget));
        let run = |args: serde_json::Value| {
            let ctx = ctx.clone();
            async move { super::execute_builtin(memory, &args, &ctx).await.0 }
        };

        // An archived note moved into a folder keeps its front matter.
        let a = run(json!({"op": "edit", "name": "shipped-00", "old": "PR 9100", "new": "---\nstatus: done\n---\nPR 9100"})).await;
        assert!(a.contains("archived"), "{a}");
        let m = run(json!({"op": "move", "name": "shipped-00", "to": "shipped/9100"})).await;
        assert_eq!(m, "Moved memory/shipped-00 to memory/shipped/9100", "{m}");
        let moved = std::fs::read_to_string(dir.join("shipped/9100.md")).unwrap();
        assert!(moved.starts_with("---\nstatus: done\n---\nPR 9100"), "{moved}");
        assert!(!dir.join("shipped-00.md").exists());
        let meta = std::fs::read_to_string(dir.join(".meta.json")).unwrap();
        assert!(meta.contains("shipped/9100") && !meta.contains("\"shipped-00\""), "{meta}");
        // A move onto an existing note, or of a missing one, changes nothing.
        assert!(run(json!({"op": "move", "name": "note-001", "to": "note-002"})).await.starts_with("ERROR"));
        assert!(run(json!({"op": "move", "name": "nope", "to": "x"})).await.starts_with("ERROR"));
        assert!(run(json!({"op": "move", "name": "note-001"})).await.contains("'to'"));

        // The harness builds the index; a note named like it is refused.
        for bad in ["index", "subsystems/index", "MEMORY", "tui/Memory", "INDEX.md"] {
            let w = run(json!({"op": "write", "name": bad, "content": "links"})).await;
            assert!(w.starts_with("ERROR") && w.contains("index"), "{bad}: {w}");
            let mv = run(json!({"op": "move", "name": "note-003", "to": bad})).await;
            assert!(mv.starts_with("ERROR"), "{bad}: {mv}");
        }

        // 2 changes so far; 28 more fit, then every mutation is refused.
        for i in 10..38 {
            let r = run(json!({"op": "move", "name": format!("note-{i:03}"), "to": format!("area/{i:03}")})).await;
            assert!(r.starts_with("Moved"), "{i}: {r}");
        }
        assert_eq!(budget.used(), 30);
        for args in [
            json!({"op": "edit", "name": "shipped-01", "old": "PR", "new": "---\nstatus: done\n---\nPR"}),
            json!({"op": "write", "name": "x", "content": "y"}),
            json!({"op": "delete", "name": "note-040"}),
            json!({"op": "move", "name": "note-041", "to": "area/041"}),
        ] {
            let r = run(args).await;
            assert!(r.starts_with("ERROR") && r.contains("30"), "{r}");
        }
        assert!(dir.join("note-040.md").exists() && dir.join("note-041.md").exists());
        assert_eq!(budget.refused(), 4);
        // Reads are never capped.
        assert!(run(json!({"op": "view", "name": "shipped-01"})).await.starts_with("PR 9101"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Without a budget (the main agent) nothing is capped, and `move` works.
    #[tokio::test]
    async fn the_main_agent_moves_notes_uncapped() {
        let root = unique_root();
        let memory = lookup("memory").unwrap();
        for i in 0..40 {
            let w = execute_builtin(memory, &json!({"op": "write", "name": format!("n{i}"), "content": "x"}), &root).await;
            assert!(w.starts_with("Wrote"), "{w}");
        }
        let m = execute_builtin(memory, &json!({"op": "move", "name": "n1", "to": "grp/n1"}), &root).await;
        assert!(m.starts_with("Moved"), "{m}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn the_memory_tool_runs_every_op() {
        let root = unique_root();
        let memory = lookup("memory").unwrap();
        let run = |args: serde_json::Value| {
            let root = root.clone();
            async move { execute_builtin(memory, &args, &root).await }
        };
        let w = run(json!({"op": "write", "name": "drift", "title": "Drift", "content": "553 behind"})).await;
        assert!(w.starts_with("Wrote"), "unexpected: {w}");
        // Landed at the canonical workspace path, title first.
        assert_eq!(
            std::fs::read_to_string(crate::workspace::project_store(&root).join("memory/drift.md"))
                .unwrap(),
            "Drift\n\n553 behind"
        );
        assert_eq!(run(json!({"op": "view", "name": "drift"})).await, "Drift\n\n553 behind");
        assert!(run(json!({"op": "view"})).await.contains("- `drift` - Drift"));
        assert!(run(json!({"op": "search", "query": "553"})).await.contains("`drift`"));
        assert!(run(json!({"op": "edit", "name": "drift", "old": "553", "new": "554"})).await.starts_with("Edited"));
        assert!(run(json!({"op": "view", "name": "drift"})).await.ends_with("554 behind"));
        assert!(run(json!({"op": "delete", "name": "drift"})).await.starts_with("Deleted"));
        assert!(run(json!({"op": "view", "name": "drift"})).await.starts_with("ERROR"));
        assert!(run(json!({"op": "write", "name": "x"})).await.contains("'content'"));
        assert!(run(json!({"op": "rename"})).await.contains("unknown memory op"));
        assert!(run(json!({"op": "rename"})).await.contains("move"));
        assert!(run(json!({})).await.contains("'op'"));
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
        assert!(crate::workspace::project_store(&root)
            .join("skills/deploy/SKILL.md")
            .exists());

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
    async fn skill_write_scope_picks_the_project_or_user_store() {
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let home = root.join("home-jan");
        let ctx = ToolContext::new(&root, &store, &[]).with_skill_user_root(Some(&home));
        let write = |args: serde_json::Value| {
            let ctx = ctx.clone();
            async move { super::execute_builtin(lookup("skill_write").unwrap(), &args, &ctx).await.0 }
        };

        // No scope: the project store, as before.
        let out = write(json!({"name": "a", "content": "x"})).await;
        assert_eq!(out, "Wrote skill 'a'");
        assert!(store.join("skills/a/SKILL.md").is_file());
        assert!(!home.join("skills/a").exists());

        // scope: "project" is the same thing, spelled out.
        write(json!({"name": "b", "content": "x", "scope": "project"})).await;
        assert!(store.join("skills/b/SKILL.md").is_file());

        // scope: "user" writes to `<jan home>/skills`.
        let out = write(json!({"name": "c", "content": "x", "scope": "user"})).await;
        assert_eq!(out, "Wrote user skill 'c'");
        assert!(home.join("skills/c/SKILL.md").is_file());
        assert!(!store.join("skills/c").exists());

        // An unknown scope is refused, not silently defaulted.
        let out = write(json!({"name": "d", "content": "x", "scope": "global"})).await;
        assert!(out.starts_with("ERROR: invalid scope"), "{out}");

        // A surface with no user root refuses the user scope.
        let bare = ToolContext::new(&root, &store, &[]);
        let out = super::execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "e", "content": "x", "scope": "user"}),
            &bare,
        )
        .await
        .0;
        assert!(out.starts_with("ERROR: scope 'user'"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_skill_source_overrides_list_and_read() {
        struct Fixed;
        impl crate::tools::SkillProvider for Fixed {
            fn catalog(&self) -> Vec<(String, String)> {
                vec![("p:one".into(), "first".into()), ("two".into(), String::new())]
            }
            fn read(&self, name: &str) -> Result<String, String> {
                (name == "p:one")
                    .then(|| "body one".to_string())
                    .ok_or_else(|| format!("ERROR: skill '{name}' not found"))
            }
        }
        let root = unique_root();
        let store = crate::workspace::project_store(&root);
        let ctx =
            ToolContext::new(&root, &store, &[]).with_skill_source(std::sync::Arc::new(Fixed));
        let list = super::execute_builtin(lookup("skill_list").unwrap(), &json!({}), &ctx)
            .await
            .0;
        assert_eq!(list, "p:one — first\ntwo");
        let read = super::execute_builtin(
            lookup("skill_read").unwrap(),
            &json!({"name": "p:one"}),
            &ctx,
        )
        .await
        .0;
        assert_eq!(read, "body one");
        let missing =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "x"}), &ctx)
                .await
                .0;
        assert!(missing.starts_with("ERROR"), "{missing}");
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

        let list = super::execute_builtin(lookup("skill_list").unwrap(), &json!({}), &ctx)
            .await
            .0;
        assert!(list.contains("on"), "list: {list}");
        assert!(!list.contains("off body"), "disabled skill leaked: {list}");

        // Disabled skill is unreadable.
        let read_off =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "off"}), &ctx)
                .await
                .0;
        assert!(read_off.starts_with("ERROR"), "disabled read: {read_off}");

        // Enabled skill still readable.
        let read_on =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "on"}), &ctx)
                .await
                .0;
        assert_eq!(read_on, "on body");

        // A disabled skill is read-only for the model: writing to it is refused
        // and the on-disk content is untouched.
        let write_off = super::execute_builtin(
            lookup("skill_write").unwrap(),
            &json!({"name": "off", "content": "evil body"}),
            &ctx,
        )
        .await
        .0;
        assert!(
            write_off.starts_with("ERROR"),
            "disabled write: {write_off}"
        );
        let r =
            super::execute_builtin(lookup("skill_read").unwrap(), &json!({"name": "off"}), &ctx)
                .await
                .0;
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
        for bad in ["../escape", "a/b/c", "..", ""] {
            let out = execute_builtin(
                lookup("memory").unwrap(),
                &json!({"op": "write", "name": bad, "content": "x"}),
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
    // ---- screenshot ---------------------------------------------------------

    /// Two headless Chromes racing for the same profile dir collide, so the
    /// tests that actually launch one are serialised. An async mutex so the test
    /// can hold it across the awaited screenshot without `await_holding_lock`.
    #[cfg(feature = "tauri")]
    static CHROME_TEST_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    #[cfg(feature = "tauri")]
    #[tokio::test]
    async fn screenshot_rejects_a_non_html_file() {
        let root = unique_root();
        std::fs::write(root.join("a.txt"), b"nope").unwrap();
        let (out, images) = screenshot(&json!({"path": "a.txt"}), &root, None, &[], None).await;
        assert!(out.contains("only renders"), "{out}");
        assert!(images.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "tauri")]
    #[tokio::test]
    async fn screenshot_rejects_a_missing_file() {
        let root = unique_root();
        let (out, images) = screenshot(&json!({"path": "gone.html"}), &root, None, &[], None).await;
        assert!(out.contains("file not found"), "{out}");
        assert!(images.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "tauri")]
    #[tokio::test]
    async fn screenshot_requires_a_path() {
        let root = unique_root();
        let (out, _) = screenshot(&json!({}), &root, None, &[], None).await;
        assert!(out.contains("missing required argument"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(all(unix, feature = "tauri"))]
    #[tokio::test]
    async fn screenshot_refuses_a_symlink_out_of_the_workspace() {
        let root = unique_root();
        let outside = unique_root();
        let secret = outside.join("secret.html");
        std::fs::write(&secret, b"<h1>secret</h1>").unwrap();
        let link = root.join("innocent.html");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let (out, images) = screenshot(&json!({"path": "innocent.html"}), &root, None, &[], None).await;
        assert!(out.contains("symlink"), "{out}");
        assert!(images.is_none());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A page in a trusted root may load the files beside it; one the user
    /// approved outside every root may load only itself.
    #[cfg(feature = "tauri")]
    #[tokio::test]
    async fn screenshot_confines_a_page_outside_the_roots_to_itself() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(root.join("in.html"), b"<h1>in</h1>").unwrap();
        let out_page = outside.join("out.html");
        std::fs::write(&out_page, b"<h1>out</h1>").unwrap();
        let out_page = out_page.to_str().unwrap();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen_by_backend = seen.clone();
        let backend: ScreenshotBackend = std::sync::Arc::new(move |_, _, _, _, scope| {
            seen_by_backend.lock().unwrap().push(scope);
            Box::pin(async { Ok(b"png".to_vec()) })
        });

        for (path, read_roots) in [
            ("in.html", vec![]),
            (out_page, vec![]),
            (out_page, vec![outside.clone()]),
        ] {
            let (out, _) =
                screenshot(&json!({"path": path}), &root, None, &read_roots, Some(&backend)).await;
            assert!(!out.starts_with("ERROR"), "{out}");
        }
        assert_eq!(
            *seen.lock().unwrap(),
            [PageScope::Directory, PageScope::FileOnly, PageScope::Directory]
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A failing desktop renderer is the answer: the page is not rendered a
    /// second time through Chrome, which would not check its frames.
    #[tokio::test]
    async fn a_failing_screenshot_backend_does_not_fall_back_to_chrome() {
        let root = unique_root();
        let page = root.join("page.html");
        std::fs::write(&page, b"<h1>page</h1>").unwrap();
        let backend: ScreenshotBackend = std::sync::Arc::new(|_, _, _, _, _| {
            Box::pin(async { Err("webview capture timed out".to_string()) })
        });

        let result =
            render_html_png(&page, 800, 600, 1.0, PageScope::Directory, Some(&backend)).await;
        assert_eq!(result, Err("webview capture timed out".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Renders for real when a browser is present, and returns an image part
    /// rather than a data URL buried in the text.
    #[cfg(feature = "tauri")]
    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn screenshot_returns_an_image_part_when_chrome_is_present() {
        if chrome_binary().is_none() {
            return;
        }
        let _guard = CHROME_TEST_LOCK.lock().await;
        let root = unique_root();
        std::fs::write(
            root.join("page.html"),
            b"<html><body style=\"background:#0af\"><h1>hi</h1></body></html>",
        )
        .unwrap();

        let (out, images) = screenshot(
            &json!({"path": "page.html", "width": 400, "height": 300}),
            &root,
            None,
            &[],
            None,
        )
        .await;
        assert!(!out.starts_with("ERROR"), "{out}");
        let images = images.expect("an image part");
        assert_eq!(images.len(), 1);
        assert!(images[0].data_url.starts_with("data:image/png;base64,"));
        assert_eq!(images[0].name, "page.html");
        // The base64 stays out of the model-facing text.
        assert!(!out.contains("base64"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
