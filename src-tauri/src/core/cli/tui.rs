//! Interactive chat console over the agent loop (`jan agent ui`). A thin
//! renderer: the engine is shared with the plain CLI path, only the
//! presentation differs. Maintains a running conversation — the user types
//! messages into an input box, each submit spawns an agent run over the shared
//! `AgentSession`, and streamed `StreamEvent`s render as message history plus
//! inline workflow elements (turn steps, tool calls/results). Gated tool calls
//! are approved interactively via the shared `PermissionRegistry`.

use std::future::pending;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use ratatui::crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::AgentSession;
use crate::core::agent::events::{describe_tool_call, StreamEvent, Usage};
use crate::core::agent::r#loop::{run_orchestration_streamed, OrchestrationArgs, PermissionRegistry};
use crate::core::agent::tools::gate::PermissionDecision;

#[derive(PartialEq)]
enum Status {
    Idle,
    Running,
}

/// Kind of the last transcript block, used to insert a blank line only when the
/// block kind changes (so consecutive tool lines group, but prose/tool/user
/// turns get breathing room).
#[derive(PartialEq, Clone, Copy)]
enum Kind {
    None,
    User,
    Prose,
    Tool,
    Meta,
}

struct Pending {
    request_id: String,
    tool_name: String,
    capability: String,
    path: Option<String>,
    /// Shell command for exec prompts; drives the command-scoped always-grant.
    command: Option<String>,
    offers_always: bool,
    /// Highlighted option in the docked prompt (index into `options()`).
    selected: usize,
}

impl Pending {
    /// One-line summary for the transcript decision record.
    fn summary(&self) -> String {
        let target = self
            .path
            .as_deref()
            .map(|p| format!(" on {p}"))
            .unwrap_or_default();
        format!("{} via '{}'{target}", self.capability, self.tool_name)
    }

    /// Base command of an exec prompt (`git status` -> `git`), if any.
    fn command_base(&self) -> Option<&str> {
        self.command
            .as_deref()
            .and_then(crate::core::agent::tools::gate::command_base)
    }

    /// Label for the "allow always" option: command-scoped for exec (thread
    /// only), capability-scoped otherwise. All grants are thread-scoped.
    fn always_label(&self) -> String {
        match self.command_base() {
            Some(base) => format!("Allow all '{base}' commands (this thread)"),
            None => "Allow always (this thread)".to_string(),
        }
    }

    /// Selectable decisions, in display order. `AllowAlways` only when offered.
    fn options(&self) -> Vec<(PermissionDecision, String)> {
        let mut opts = vec![(PermissionDecision::AllowOnce, "Allow once".to_string())];
        if self.offers_always {
            opts.push((PermissionDecision::AllowAlways, self.always_label()));
        }
        opts.push((PermissionDecision::Deny, "Deny".to_string()));
        opts
    }

    fn move_selection(&mut self, delta: isize) {
        let len = self.options().len() as isize;
        self.selected = (self.selected as isize + delta).rem_euclid(len) as usize;
    }
}

/// What a highlighted picker row does on Enter.
#[derive(PartialEq, Clone, Copy)]
enum PickerKind {
    ResumeThread,
    SelectModel,
}

/// Interactive list overlay (`/resume` threads, `/model` models): rows with a
/// highlighted cursor, acted on by `PickerKind` on Enter.
struct Picker {
    kind: PickerKind,
    items: Vec<PickerItem>,
    selected: usize,
}

impl Picker {
    fn title(&self) -> &'static str {
        match self.kind {
            PickerKind::ResumeThread => " resume thread ",
            PickerKind::SelectModel => " select model ",
        }
    }

    fn action_hint(&self) -> &'static str {
        match self.kind {
            PickerKind::ResumeThread => " ↑/↓ select   Enter resume   Esc cancel",
            PickerKind::SelectModel => " ↑/↓ select   Enter choose   Esc cancel",
        }
    }
}

struct PickerItem {
    /// The value acted on (thread id or model id).
    value: String,
    /// Primary display text.
    label: String,
    /// Optional dim prefix (e.g. a thread's short id).
    hint: Option<String>,
}

/// A spawned agent run: the event stream and its abort handle.
struct CurrentRun {
    rx: mpsc::UnboundedReceiver<StreamEvent>,
    handle: JoinHandle<()>,
}

/// A run of consecutive collapsible tool calls folded into one transcript row.
struct ToolGroup {
    /// Transcript index of the row this group owns.
    idx: usize,
    /// Activity label of the first call (shown verbatim when the group is a
    /// single call, e.g. "Reading memory notes").
    first_label: String,
    /// Per-call noun for the finalized breakdown ("memory note", "skill", ...).
    nouns: Vec<&'static str>,
    /// True while every call so far is a read-style op (drives "Read" vs "Ran").
    all_read: bool,
}

struct App {
    model: String,
    max_turns: u32,
    /// Project `.jan/agent` dir where this TUI's threads are saved/listed.
    agent_dir: std::path::PathBuf,
    /// OpenAI-shaped conversation history sent with each run.
    history: Vec<serde_json::Value>,
    /// Thread this conversation persists to (set on first save or on resume).
    thread_id: Option<String>,
    /// Styled display transcript (user turns, assistant text, workflow lines).
    transcript: Vec<Line<'static>>,
    /// In-progress assistant text for the current turn, flushed on the next
    /// step/tool/terminal event.
    assistant_buf: String,
    /// The current run of consecutive collapsible tool calls, rendered as one
    /// transcript row that updates in real time and finalizes to a short summary.
    /// edit/write are excluded (they render their own diff panel).
    tool_group: Option<ToolGroup>,
    /// Ids of calls folded into a `ToolGroup`, so their `ToolResult` is swallowed
    /// (the group row already represents them). Survives group finalize.
    grouped_ids: std::collections::HashSet<String>,
    input: String,
    status: Status,
    turn: (u32, u32),
    tokens: u64,
    detail: String,
    pending: Option<Pending>,
    picker: Option<Picker>,
    /// Lines scrolled back from the tail; 0 pins the view to the bottom so new
    /// content follows. Non-zero survives streaming so scroll-back stays usable.
    scrollback: u16,
    /// Set when the user submits a message; the loop spawns a run next tick.
    want_start: bool,
    /// Transcript viewport width in cells, refreshed each `draw`; tables wrap to
    /// it. 0 until the first draw (callers fall back to a default).
    view_width: u16,
    last_kind: Kind,
    should_quit: bool,
}

impl App {
    fn new(model: String, max_turns: u32, agent_dir: std::path::PathBuf) -> Self {
        Self {
            model,
            max_turns,
            agent_dir,
            history: Vec::new(),
            thread_id: None,
            transcript: Vec::new(),
            assistant_buf: String::new(),
            tool_group: None,
            grouped_ids: std::collections::HashSet::new(),
            input: String::new(),
            status: Status::Idle,
            turn: (0, 0),
            tokens: 0,
            detail: String::new(),
            pending: None,
            picker: None,
            scrollback: 0,
            want_start: false,
            view_width: 0,
            last_kind: Kind::None,
            should_quit: false,
        }
    }

    /// Effective width for table wrapping (fallback before the first draw).
    fn render_width(&self) -> u16 {
        if self.view_width == 0 {
            80
        } else {
            self.view_width
        }
    }

    fn push(&mut self, line: Line<'static>) {
        self.transcript.push(line);
    }

    /// Insert a blank separator when the block kind changes, then record it.
    /// Keeps consecutive same-kind lines tight while spacing turn boundaries.
    fn gap(&mut self, next: Kind) {
        let last_blank = self
            .transcript
            .last()
            .map(|l| l.spans.iter().all(|s| s.content.trim().is_empty()))
            .unwrap_or(true);
        if !self.transcript.is_empty() && self.last_kind != next && !last_blank {
            self.transcript.push(Line::raw(""));
        }
        self.last_kind = next;
    }

    /// Append a dim single-line status note (command output, cancel, errors).
    fn note(&mut self, text: &str) {
        self.scrollback = 0;
        self.gap(Kind::Meta);
        self.push(Line::styled(text.to_string(), Style::new().dim()));
    }

    fn flush_assistant(&mut self) {
        let text = self.assistant_buf.trim_end().to_string();
        self.assistant_buf.clear();
        if text.is_empty() {
            return;
        }
        let lines = format_assistant_lines(&text, self.render_width());
        if lines.is_empty() {
            return;
        }
        // Model prose ends the current run of tool calls.
        self.finalize_tool_group();
        self.gap(Kind::Prose);
        self.transcript.extend(lines);
    }

    /// Fold a collapsible tool call into the current group row (extending it and
    /// updating its live status) or open a new group row.
    fn push_grouped_call(&mut self, id: &str, name: &str, label: String) {
        let (noun, is_read) = tool_kind(name);
        self.grouped_ids.insert(id.to_string());
        let extend = self.tool_group.as_mut().map(|g| {
            g.nouns.push(noun);
            g.all_read = g.all_read && is_read;
            (g.idx, g.nouns.len())
        });
        match extend {
            Some((idx, n)) if idx < self.transcript.len() => {
                self.transcript[idx] = tool_row(
                    "▸",
                    Style::new().cyan(),
                    &format!("{label} ({n})"),
                    Style::new().cyan().dim(),
                );
            }
            _ => {
                self.gap(Kind::Tool);
                self.push(tool_row(
                    "▸",
                    Style::new().cyan(),
                    &label,
                    Style::new().cyan().dim(),
                ));
                self.tool_group = Some(ToolGroup {
                    idx: self.transcript.len() - 1,
                    first_label: label,
                    nouns: vec![noun],
                    all_read: is_read,
                });
            }
        }
    }

    /// Close the current tool group, rewriting its row to a `✓` short summary:
    /// the single activity label for one call, else a counted breakdown.
    fn finalize_tool_group(&mut self) {
        let Some(g) = self.tool_group.take() else {
            return;
        };
        if g.idx >= self.transcript.len() {
            return;
        }
        let text = if g.nouns.len() <= 1 {
            g.first_label
        } else {
            group_summary(&g.nouns, g.all_read)
        };
        self.transcript[g.idx] = tool_row("✓", Style::new().green(), &text, Style::new().dim());
    }

    /// Queue a user message: record it in history and the transcript, and ask
    /// the loop to start a run. Flips to `Running` synchronously so further keys
    /// in the same input batch can't slip through as a second submit.
    fn submit_user(&mut self, text: String) {
        self.history
            .push(serde_json::json!({ "role": "user", "content": text }));
        self.gap(Kind::User);
        self.push(Line::from(vec![
            Span::styled("› ", Style::new().light_magenta().bold()),
            Span::styled(text, Style::new().bold()),
        ]));
        self.status = Status::Running;
        self.turn = (0, 0);
        self.scrollback = 0;
        self.want_start = true;
        self.persist();
    }

    fn body(&self) -> serde_json::Value {
        serde_json::json!({
            "model": self.model,
            "messages": self.history,
            "max_turns": self.max_turns,
            "stream": true,
        })
    }

    /// Save the conversation to a thread on disk so it survives and appears in
    /// `/resume`. Fire-and-forget: failures surface in the status detail only.
    fn persist(&mut self) {
        if self.history.is_empty() {
            return;
        }
        match super::cli_save_thread(
            &self.agent_dir,
            self.thread_id.as_deref(),
            &self.model,
            &self.history,
        ) {
            Ok(id) => self.thread_id = Some(id),
            Err(e) => self.detail = format!("save failed: {e}"),
        }
    }

    /// Switch the active model and remember it in the project's agent.toml so it
    /// persists across sessions.
    fn set_model(&mut self, model: String) {
        self.model = model;
        match super::cli_set_project_model(&self.agent_dir, &self.model) {
            Ok(()) => self.note(&format!("model set to {}", self.model)),
            Err(e) => self.note(&format!("model set to {} (not saved: {e})", self.model)),
        }
    }

    /// Non-terminal stream events. `Done`/`Error` are handled by the loop since
    /// they mutate history and the run handle.
    fn apply(&mut self, ev: StreamEvent) {
        match ev {
            StreamEvent::Token { text } => self.assistant_buf.push_str(&text),
            StreamEvent::Step { index, max } => {
                // A new turn closes the previous turn's batch of tool calls.
                self.finalize_tool_group();
                self.flush_assistant();
                self.turn = (index, max);
            }
            StreamEvent::ToolCall { id, name, args } => {
                let max = self.render_width().saturating_sub(6) as usize;
                let label = truncate(&tool_activity(&name, &args), max);
                if matches!(name.as_str(), "edit" | "write") {
                    // Diff-producing tools render standalone (call row + panel).
                    self.finalize_tool_group();
                    self.flush_assistant();
                    self.gap(Kind::Tool);
                    self.push(tool_row("▸", Style::new().cyan(), &label, Style::new().cyan().dim()));
                } else {
                    self.push_grouped_call(&id, &name, label);
                }
            }
            StreamEvent::ToolResult {
                id,
                content,
                is_error,
                diff,
            } => {
                // Grouped calls are already represented by the group row.
                if self.grouped_ids.contains(&id) {
                    return;
                }
                self.flush_assistant();
                let (tag, tag_style) = if is_error {
                    ("✗", Style::new().red())
                } else {
                    ("✓", Style::new().green())
                };
                let max = self.render_width().saturating_sub(8) as usize;
                self.gap(Kind::Tool);
                self.push(Line::from(vec![
                    Span::styled("│   ", Style::new().dark_gray()),
                    Span::styled(format!("{tag} "), tag_style),
                    Span::styled(summarize_result(&content, max), Style::new().dim()),
                ]));
                if let Some(diff) = diff {
                    for line in diff_lines(&diff, max) {
                        self.push(line);
                    }
                }
            }
            StreamEvent::PermissionRequest {
                request_id,
                tool_name,
                capability,
                path,
                command,
                offers_always,
                ..
            } => {
                self.finalize_tool_group();
                self.pending = Some(Pending {
                    request_id,
                    tool_name,
                    capability,
                    path,
                    command,
                    offers_always,
                    selected: 0,
                });
            }
            StreamEvent::Done { .. } | StreamEvent::Error { .. } => {}
        }
    }

    /// Flush the current turn and return its text as the final assistant answer.
    fn take_answer(&mut self) -> String {
        let answer = self.assistant_buf.trim().to_string();
        self.flush_assistant();
        answer
    }

    fn on_done(&mut self, stop_reason: String, usage: Option<Usage>) {
        self.finalize_tool_group();
        let answer = self.take_answer();
        if !answer.is_empty() {
            self.history
                .push(serde_json::json!({ "role": "assistant", "content": answer }));
        }
        self.tokens = usage.and_then(|u| u.total_tokens).unwrap_or(self.tokens);
        self.status = Status::Idle;
        self.detail = format!("stop_reason={stop_reason}");
        self.scrollback = 0;
        self.persist();
    }

    fn on_error(&mut self, code: String, message: String) {
        self.finalize_tool_group();
        self.flush_assistant();
        self.status = Status::Idle;
        self.detail = if message.contains("budget") {
            format!("budget exhausted: {message}")
        } else {
            format!("{code}: {message}")
        };
        self.gap(Kind::Meta);
        self.push(Line::styled(
            format!("error: {message}"),
            Style::new().red().bold(),
        ));
        self.scrollback = 0;
    }

    /// Cancel the in-flight run, keeping the conversation intact.
    fn cancel_run(&mut self) {
        self.finalize_tool_group();
        self.assistant_buf.clear();
        self.status = Status::Idle;
        self.detail = "cancelled".to_string();
        self.scrollback = 0;
        self.gap(Kind::Meta);
        self.push(Line::styled("cancelled", Style::new().yellow()));
    }
}

/// Truncate to `max` chars with a trailing ellipsis (char-safe).
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max.max(1) {
        return s.to_string();
    }
    let head: String = s.chars().take(max.saturating_sub(1).max(1)).collect();
    format!("{head}…")
}

/// Summarize tool output to one transcript line: first non-empty line with its
/// internal whitespace collapsed, truncated to `max`, plus a `(+N lines)`
/// suffix when more follow.
fn summarize_result(s: &str, max: usize) -> String {
    let mut lines = s.lines().filter(|l| !l.trim().is_empty());
    let first = lines.next().unwrap_or("");
    let collapsed = first.split_whitespace().collect::<Vec<_>>().join(" ");
    let extra = lines.count();
    let head = truncate(&collapsed, max);
    if extra > 0 {
        format!("{head}  (+{extra} lines)")
    } else {
        head
    }
}

/// Max diff rows rendered under a tool result before collapsing the tail.
const DIFF_MAX_ROWS: usize = 20;

/// Render focused-diff text as a boxed panel: a light rule frames the change,
/// `-` lines red, `+` green, `@@` headers dim-cyan. Content is truncated to
/// `max` and each row padded so the right border aligns. Collapses to
/// `DIFF_MAX_ROWS` with a `(+N more)` tail before the closing rule.
fn diff_lines(diff: &str, max: usize) -> Vec<Line<'static>> {
    let all: Vec<&str> = diff.lines().collect();
    let shown = all.len().min(DIFF_MAX_ROWS);
    let truncated = all.len() > shown;

    let mut rows: Vec<(String, Style)> = Vec::with_capacity(shown + 1);
    for line in &all[..shown] {
        let style = match line.as_bytes().first() {
            Some(b'-') => Style::new().red(),
            Some(b'+') => Style::new().green(),
            Some(b'@') => Style::new().cyan().dim(),
            _ => Style::new().dim(),
        };
        rows.push((truncate(line, max), style));
    }
    if truncated {
        rows.push((
            format!("(+{} more)", all.len() - shown),
            Style::new().dim(),
        ));
    }

    let inner = rows
        .iter()
        .map(|(t, _)| t.chars().count())
        .max()
        .unwrap_or(0)
        .clamp(1, max.max(1));

    let gutter = "│     ";
    let border = Style::new().dark_gray();
    let mut out = Vec::with_capacity(rows.len() + 2);
    out.push(Line::from(vec![
        Span::styled(gutter, border),
        Span::styled(format!("┌{}┐", "─".repeat(inner + 2)), border),
    ]));
    for (text, style) in rows {
        let pad = inner.saturating_sub(text.chars().count());
        out.push(Line::from(vec![
            Span::styled(gutter, border),
            Span::styled("│ ", border),
            Span::styled(text, style),
            Span::styled(format!("{} │", " ".repeat(pad)), border),
        ]));
    }
    out.push(Line::from(vec![
        Span::styled(gutter, border),
        Span::styled(format!("└{}┘", "─".repeat(inner + 2)), border),
    ]));
    out
}

/// Concise present-tense activity label for the single, in-place tool row
/// ("Executing grep", "Searching", "Updating memory: X"). Deliberately terse:
/// the running row updates in real time and the completed row keeps this same
/// text with a `✓`/`✗` tag, so it must read well in both states.
fn tool_activity(name: &str, args: &serde_json::Value) -> String {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let base = |p: &str| {
        std::path::Path::new(p)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(p)
            .to_string()
    };
    match name {
        "bash" | "shell" | "exec" => {
            let cmd = s("command");
            let prog = cmd.split_whitespace().next().unwrap_or("");
            let prog = prog.rsplit(['/', '\\']).next().unwrap_or(prog);
            if prog.is_empty() {
                "Executing command".to_string()
            } else {
                format!("Executing {prog}")
            }
        }
        "grep" | "search" => "Searching".to_string(),
        "find" | "glob" => "Finding files".to_string(),
        "read" => format!("Reading {}", base(s("path"))),
        "list" | "ls" => "Listing files".to_string(),
        "write" => format!("Writing {}", base(s("path"))),
        "edit" => format!("Editing {}", base(s("path"))),
        // Skill/memory tools already produce active labels ("Updating memory: X").
        _ => describe_tool_call(name, args),
    }
}

/// A one-line tool row: `│ <tag> <text>` with a styled tag and body.
fn tool_row(tag: &str, tag_style: Style, text: &str, text_style: Style) -> Line<'static> {
    Line::from(vec![
        Span::styled("│ ", Style::new().dark_gray()),
        Span::styled(format!("{tag} "), tag_style),
        Span::styled(text.to_string(), text_style),
    ])
}

/// Classify a collapsible tool into a breakdown noun and whether it is a
/// read-style op (drives the "Read" vs "Ran" verb in a group summary).
fn tool_kind(name: &str) -> (&'static str, bool) {
    match name {
        n if n.starts_with("memory") => ("memory note", true),
        n if n.starts_with("skill") => ("skill", true),
        "read" => ("file", true),
        "list" | "ls" => ("directory", true),
        "grep" | "search" => ("search", false),
        "find" | "glob" => ("file search", false),
        "bash" | "shell" | "exec" => ("command", false),
        _ => ("tool call", false),
    }
}

/// Short sentence summarizing a finished tool group, e.g. "Read 3 memory notes,
/// 1 skill" or "Ran 2 commands, 1 search". Verb is "Read" iff every call was a
/// read-style op.
fn group_summary(nouns: &[&str], all_read: bool) -> String {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for &n in nouns {
        match counts.iter_mut().find(|(name, _)| *name == n) {
            Some((_, c)) => *c += 1,
            None => counts.push((n, 1)),
        }
    }
    let parts: Vec<String> = counts.iter().map(|(n, c)| pluralize(n, *c)).collect();
    let verb = if all_read { "Read" } else { "Ran" };
    format!("{verb} {}", parts.join(", "))
}

/// "3 memory notes", "1 skill", "2 searches", "1 directory".
fn pluralize(noun: &str, n: usize) -> String {
    if n == 1 {
        return format!("1 {noun}");
    }
    let plural = if let Some(stem) = noun.strip_suffix('y') {
        format!("{stem}ies")
    } else if noun.ends_with("ch") || noun.ends_with('s') {
        format!("{noun}es")
    } else {
        format!("{noun}s")
    };
    format!("{n} {plural}")
}

fn think_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"</?[a-zA-Z:]*think>").unwrap())
}

/// Split assistant text into `(is_reasoning, segment)` runs by `<think>` /
/// `<mm:think>` tags (tags themselves dropped). An unterminated open tag makes
/// the trailing text reasoning, which keeps live streaming clean.
fn split_reasoning(text: &str) -> Vec<(bool, String)> {
    let mut out = Vec::new();
    let mut in_think = false;
    let mut last = 0;
    for m in think_re().find_iter(text) {
        let seg = &text[last..m.start()];
        if !seg.is_empty() {
            out.push((in_think, seg.to_string()));
        }
        in_think = !m.as_str().starts_with("</");
        last = m.end();
    }
    let seg = &text[last..];
    if !seg.is_empty() {
        out.push((in_think, seg.to_string()));
    }
    out
}

/// Render assistant text to styled lines: reasoning dimmed, answer prose passed
/// through markdown formatting. `width` bounds table wrapping.
fn format_assistant_lines(text: &str, width: u16) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    for (reasoning, seg) in split_reasoning(text) {
        if reasoning {
            for l in seg.lines() {
                if !l.trim().is_empty() {
                    lines.push(Line::styled(l.to_string(), Style::new().dim().italic()));
                }
            }
        } else {
            lines.extend(format_markdown_lines(&seg, width));
        }
    }
    lines
}

fn table_cells(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|c| c.trim().to_string())
        .collect()
}

/// A `|---|:--:|` markdown table separator row.
fn is_table_separator(line: &str) -> bool {
    let body = line.trim().trim_matches('|');
    !body.is_empty()
        && body.split('|').all(|c| {
            let c = c.trim();
            !c.is_empty() && c.contains('-') && c.chars().all(|ch| matches!(ch, '-' | ':' | ' '))
        })
}

/// Render answer prose: GitHub pipe tables are aligned into padded columns by
/// `render_table` (tui-markdown does not support tables); every other block is
/// rendered by `tui-markdown` (headings, bold/italic, lists, code, quotes).
fn format_markdown_lines(text: &str, width: u16) -> Vec<Line<'static>> {
    let src: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let mut prose: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < src.len() {
        let is_table_head =
            src[i].contains('|') && i + 1 < src.len() && is_table_separator(src[i + 1]);
        if is_table_head {
            flush_prose(&mut prose, &mut out);
            let header = table_cells(src[i]);
            let mut rows = Vec::new();
            i += 2;
            while i < src.len() && src[i].contains('|') && !src[i].trim().is_empty() {
                rows.push(table_cells(src[i]));
                i += 1;
            }
            out.extend(render_table(&header, &rows, width));
        } else {
            prose.push(src[i]);
            i += 1;
        }
    }
    flush_prose(&mut prose, &mut out);
    out
}

fn flush_prose(prose: &mut Vec<&str>, out: &mut Vec<Line<'static>>) {
    if prose.is_empty() {
        return;
    }
    out.extend(markdown_to_lines(&prose.join("\n")));
    prose.clear();
}

/// Render a markdown block to owned ratatui lines via `tui-markdown`.
fn markdown_to_lines(text: &str) -> Vec<Line<'static>> {
    let lines: Vec<Line<'static>> = tui_markdown::from_str(text)
        .lines
        .into_iter()
        .map(own_line)
        .collect();
    merge_list_markers(lines)
}

/// tui-markdown renders loose list items with the marker (`1. `, `- `) alone on
/// one line and the item body on the next. Fold a lone-marker line into the
/// following line so list items read as `1. body`.
fn merge_list_markers(lines: Vec<Line<'static>>) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::with_capacity(lines.len());
    let mut iter = lines.into_iter().peekable();
    while let Some(line) = iter.next() {
        if is_lone_list_marker(&line) && iter.peek().is_some() {
            let body = iter.next().unwrap();
            let mut spans = line.spans;
            spans.extend(body.spans);
            let mut merged = Line::from(spans);
            merged.alignment = body.alignment;
            out.push(merged);
        } else {
            out.push(line);
        }
    }
    out
}

/// True if the line is nothing but a list marker: `1.`/`12.` or a `-`/`*`/`•`
/// bullet (trailing spaces allowed).
fn is_lone_list_marker(line: &Line<'_>) -> bool {
    let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
    let t = text.trim();
    if matches!(t, "-" | "*" | "•") {
        return true;
    }
    matches!(t.strip_suffix('.'), Some(d) if !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
}

/// Deep-clone a borrowed `Line` into a `'static` one (own each span's text).
fn own_line(line: Line<'_>) -> Line<'static> {
    let spans: Vec<Span<'static>> = line
        .spans
        .into_iter()
        .map(|s| Span::styled(s.content.into_owned(), s.style))
        .collect();
    let mut owned = Line::from(spans);
    owned.style = line.style;
    owned.alignment = line.alignment;
    owned
}

/// Strip the inline markdown markers that would otherwise show as literal text
/// inside table cells (comfy-table renders plain text).
fn strip_inline_md(s: &str) -> String {
    s.replace("**", "").replace("__", "").replace('`', "")
}

/// Render a markdown table via comfy-table: `Dynamic` arrangement wraps long
/// cells within their column and keeps the whole table within `width`, fixing
/// the overflow/separator-wrap failure of naive padding. Border rows are dimmed.
fn render_table(header: &[String], rows: &[Vec<String>], width: u16) -> Vec<Line<'static>> {
    use comfy_table::{ContentArrangement, Table};

    let mut table = Table::new();
    table
        .load_preset(comfy_table::presets::UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_width(width.max(20))
        .set_header(header.iter().map(|c| strip_inline_md(c)));
    for r in rows {
        table.add_row(r.iter().map(|c| strip_inline_md(c)));
    }

    table
        .to_string()
        .lines()
        .map(|l| {
            let is_border = !l.chars().any(|c| c.is_alphanumeric());
            if is_border {
                Line::styled(l.to_string(), Style::new().dim())
            } else {
                Line::raw(l.to_string())
            }
        })
        .collect()
}

fn spawn_run(args: &Arc<OrchestrationArgs>, body: serde_json::Value) -> CurrentRun {
    let (tx, rx) = mpsc::unbounded_channel::<StreamEvent>();
    let args = Arc::clone(args);
    let handle = tokio::spawn(async move {
        let _ = run_orchestration_streamed(&tx, &body, &args).await;
    });
    CurrentRun { rx, handle }
}

/// Await the next event of the active run, or park forever when idle.
async fn next_event(current: &mut Option<CurrentRun>) -> Option<StreamEvent> {
    match current {
        Some(c) => c.rx.recv().await,
        None => pending().await,
    }
}

pub async fn run(
    session: AgentSession,
    agent_dir: std::path::PathBuf,
    initial_task: Option<String>,
) -> Result<(), String> {
    let AgentSession {
        args,
        permission_requests,
        model,
        max_turns,
    } = session;
    let args = Arc::new(args);

    enable_raw_mode().map_err(|e| e.to_string())?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|e| e.to_string())?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|e| e.to_string())?;

    let mut app = App::new(model, max_turns, agent_dir);
    let res = chat_loop(&mut terminal, &args, &permission_requests, &mut app, initial_task).await;

    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    let _ = terminal.show_cursor();
    res
}

async fn chat_loop<B: Backend>(
    terminal: &mut Terminal<B>,
    args: &Arc<OrchestrationArgs>,
    registry: &PermissionRegistry,
    app: &mut App,
    initial_task: Option<String>,
) -> Result<(), String> {
    let mut current: Option<CurrentRun> = None;
    let mut ticker = tokio::time::interval(Duration::from_millis(50));

    match initial_task {
        Some(task) if !task.trim().is_empty() => app.submit_user(task.trim().to_string()),
        _ => app.note("type a message to start, or /help for commands"),
    }

    while !app.should_quit {
        // Kick off a queued run once the previous one has cleared. `submit_user`
        // already flipped status to Running and reset the turn counter.
        if app.want_start && current.is_none() {
            app.want_start = false;
            current = Some(spawn_run(args, app.body()));
        }

        terminal
            .draw(|f| draw(f, app))
            .map_err(|e| e.to_string())?;

        tokio::select! {
            _ = ticker.tick() => {
                while event::poll(Duration::ZERO).unwrap_or(false) {
                    if let Ok(Event::Key(key)) = event::read() {
                        handle_key(app, key, registry, &mut current).await;
                    }
                }
            }
            ev = next_event(&mut current) => match ev {
                Some(StreamEvent::Done { stop_reason, usage }) => {
                    app.on_done(stop_reason, usage);
                    current = None;
                }
                Some(StreamEvent::Error { code, message }) => {
                    app.on_error(code, message);
                    current = None;
                }
                Some(other) => app.apply(other),
                None => {
                    // Stream closed without a terminal event (aborted task).
                    app.pending = None;
                    if app.status == Status::Running {
                        app.status = Status::Idle;
                        app.assistant_buf.clear();
                    }
                    current = None;
                }
            },
        }
    }

    if let Some(c) = current {
        c.handle.abort();
    }
    Ok(())
}

async fn handle_key(
    app: &mut App,
    key: KeyEvent,
    registry: &PermissionRegistry,
    current: &mut Option<CurrentRun>,
) {
    if key.kind != KeyEventKind::Press {
        return;
    }

    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    let ctrl_c = ctrl && key.code == KeyCode::Char('c');
    let ctrl_d = ctrl && key.code == KeyCode::Char('d');

    // A pending permission prompt captures y/a/n; Ctrl-C cancels the run and
    // Ctrl-D quits, so it can't be wedged waiting on an unanswered prompt.
    if let Some(mut pending) = app.pending.take() {
        if ctrl_c || ctrl_d {
            deny(registry, &pending.request_id).await;
            abort_run(current);
            if ctrl_d {
                app.should_quit = true;
            } else {
                app.cancel_run();
            }
            return;
        }
        let decision = match key.code {
            KeyCode::Up => {
                pending.move_selection(-1);
                None
            }
            KeyCode::Down => {
                pending.move_selection(1);
                None
            }
            KeyCode::Enter => Some(pending.options()[pending.selected].0),
            KeyCode::Char('y') | KeyCode::Char('Y') => Some(PermissionDecision::AllowOnce),
            KeyCode::Char('a') | KeyCode::Char('A') if pending.offers_always => {
                Some(PermissionDecision::AllowAlways)
            }
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                Some(PermissionDecision::Deny)
            }
            _ => None,
        };
        match decision {
            Some(d) => {
                let verb = match d {
                    PermissionDecision::AllowOnce => "allowed once",
                    PermissionDecision::AllowAlways => "allowed always",
                    PermissionDecision::Deny => "denied",
                };
                app.push(Line::styled(
                    format!("• {verb}: {}", pending.summary()),
                    Style::new().yellow(),
                ));
                if let Some(sender) = registry.lock().await.remove(&pending.request_id) {
                    let _ = sender.send(d);
                }
            }
            None => app.pending = Some(pending),
        }
        return;
    }

    // Ctrl-D quits from anywhere; Ctrl-C cancels a run or quits when idle.
    if ctrl_d {
        abort_run(current);
        app.should_quit = true;
        return;
    }

    // The `/resume` picker owns navigation/Enter/Esc while it is open.
    if let Some(picker) = app.picker.as_mut() {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                picker.selected = picker.selected.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Char('j') => {
                picker.selected = (picker.selected + 1).min(picker.items.len() - 1);
            }
            KeyCode::Enter => {
                let kind = picker.kind;
                let value = picker.items[picker.selected].value.clone();
                app.picker = None;
                match kind {
                    PickerKind::ResumeThread => resume_thread(app, &value),
                    PickerKind::SelectModel => app.set_model(value),
                }
            }
            KeyCode::Esc | KeyCode::Char('q') if !ctrl => {
                app.picker = None;
                app.note("resume cancelled");
            }
            _ if ctrl_c => {
                app.picker = None;
                app.note("resume cancelled");
            }
            _ => {}
        }
        return;
    }
    if ctrl_c {
        if app.status == Status::Running {
            abort_run(current);
            app.cancel_run();
        } else {
            app.should_quit = true;
        }
        return;
    }

    match key.code {
        KeyCode::Esc => {
            if app.status == Status::Running {
                abort_run(current);
                app.cancel_run();
            } else if !app.input.is_empty() {
                app.input.clear();
            } else {
                app.should_quit = true;
            }
        }
        // Alt+Enter (or Ctrl+J) inserts a newline for multi-line input; plain
        // Enter submits.
        KeyCode::Enter if app.status == Status::Idle && key.modifiers.contains(KeyModifiers::ALT) => {
            app.input.push('\n');
        }
        KeyCode::Char('j') if app.status == Status::Idle && ctrl => {
            app.input.push('\n');
        }
        KeyCode::Enter => {
            if app.status == Status::Idle {
                let text = app.input.trim().to_string();
                app.input.clear();
                if let Some(cmd) = text.strip_prefix('/') {
                    run_command(app, cmd).await;
                } else if !text.is_empty() {
                    app.submit_user(text);
                }
            }
        }
        KeyCode::Backspace if app.status == Status::Idle => {
            app.input.pop();
        }
        KeyCode::Char(c) if app.status == Status::Idle && !ctrl => {
            app.input.push(c);
        }
        KeyCode::Up | KeyCode::PageUp => {
            let step = if key.code == KeyCode::PageUp { 10 } else { 1 };
            app.scrollback = app.scrollback.saturating_add(step);
        }
        KeyCode::Down | KeyCode::PageDown => {
            let step = if key.code == KeyCode::PageDown { 10 } else { 1 };
            app.scrollback = app.scrollback.saturating_sub(step);
        }
        _ => {}
    }
}

async fn deny(registry: &PermissionRegistry, request_id: &str) {
    if let Some(sender) = registry.lock().await.remove(request_id) {
        let _ = sender.send(PermissionDecision::Deny);
    }
}

fn abort_run(current: &mut Option<CurrentRun>) {
    if let Some(c) = current.take() {
        c.handle.abort();
    }
}

/// Split a command line into `(name, arg)`, UTF-8 safe (no byte slicing).
fn parse_command(line: &str) -> (&str, &str) {
    match line.trim().split_once(char::is_whitespace) {
        Some((n, rest)) => (n, rest.trim()),
        None => (line.trim(), ""),
    }
}

/// Execute a `/command` typed into the input box. Runs only while idle.
async fn run_command(app: &mut App, line: &str) {
    let (name, arg) = parse_command(line);
    match name {
        "" | "help" | "?" => {
            app.gap(Kind::Meta);
            for l in [
                "commands:",
                "  /help              show this help",
                "  /clear             clear the conversation",
                "  /threads           list saved threads",
                "  /resume [id]       pick a saved thread to load (or pass an id)",
                "  /model [id]        pick a provider/model (or pass an id)",
                "  /quit              exit",
            ] {
                app.push(Line::styled(l.to_string(), Style::new().dim()));
            }
        }
        "clear" => {
            app.history.clear();
            app.thread_id = None;
            app.transcript.clear();
            app.tool_group = None;
            app.grouped_ids.clear();
            app.assistant_buf.clear();
            app.pending = None;
            app.tokens = 0;
            app.turn = (0, 0);
            app.detail.clear();
            app.scrollback = 0;
            app.last_kind = Kind::None;
            app.note("conversation cleared");
        }
        "threads" | "list" => match super::list_threads_in(&app.agent_dir) {
            Ok(threads) if threads.is_empty() => {
                app.note("no saved threads found");
            }
            Ok(mut threads) => {
                sort_threads_recent(&mut threads);
                let base = app.agent_dir.clone();
                app.gap(Kind::Meta);
                app.push(Line::styled(
                    format!("{} saved thread(s):", threads.len()),
                    Style::new().dim(),
                ));
                for t in &threads {
                    let id = t.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                    let title =
                        thread_display_name(&base, id, t.get("title").and_then(|v| v.as_str()));
                    let short: String = id.chars().take(8).collect();
                    app.push(Line::from(vec![
                        Span::styled(format!("  {short}  "), Style::new().cyan()),
                        Span::raw(title),
                    ]));
                }
                app.push(Line::styled(
                    "resume with /resume".to_string(),
                    Style::new().dim(),
                ));
            }
            Err(e) => app.note(&format!("failed to list threads: {e}")),
        },
        "resume" => {
            if arg.is_empty() {
                open_thread_picker(app);
            } else {
                resume_thread(app, arg);
            }
        }
        "model" => {
            if arg.is_empty() {
                open_model_picker(app);
            } else {
                app.set_model(arg.to_string());
            }
        }
        "quit" | "exit" => app.should_quit = true,
        other => app.note(&format!("unknown command '/{other}' (try /help)")),
    }
}

/// Display name for a saved thread: its summarized `title` when present, else a
/// snippet of the last user message (so untitled threads still show content),
/// else `(untitled)`.
fn thread_display_name(base: &std::path::Path, id: &str, title: Option<&str>) -> String {
    if let Some(t) = title.map(str::trim).filter(|s| !s.is_empty()) {
        return t.to_string();
    }
    if let Ok(messages) = super::cli_list_messages_in(base, id) {
        if let Some(last_user) = messages
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
        {
            let collapsed = message_text(last_user)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if !collapsed.is_empty() {
                return truncate(&collapsed, 60);
            }
        }
    }
    "(untitled)".to_string()
}

/// Recency sort key for a saved thread (`updated`, falling back to `created`).
fn thread_recency(t: &serde_json::Value) -> f64 {
    t.get("updated")
        .or_else(|| t.get("created"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
}

/// Sort threads most-recent-first (by `updated`/`created`).
fn sort_threads_recent(threads: &mut [serde_json::Value]) {
    threads.sort_by(|a, b| {
        thread_recency(b)
            .partial_cmp(&thread_recency(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

/// Load saved threads and open the interactive picker (Enter selects). Falls
/// back to a note when there is nothing to resume.
fn open_thread_picker(app: &mut App) {
    match super::list_threads_in(&app.agent_dir) {
        Ok(threads) if threads.is_empty() => app.note("no saved threads found"),
        Ok(mut threads) => {
            sort_threads_recent(&mut threads);
            let base = app.agent_dir.clone();
            let items = threads
                .iter()
                .filter_map(|t| {
                    let id = t.get("id").and_then(|v| v.as_str())?.to_string();
                    let label =
                        thread_display_name(&base, &id, t.get("title").and_then(|v| v.as_str()));
                    let hint = Some(id.chars().take(8).collect());
                    Some(PickerItem { value: id, label, hint })
                })
                .collect::<Vec<_>>();
            if items.is_empty() {
                app.note("no saved threads found");
            } else {
                app.picker = Some(Picker {
                    kind: PickerKind::ResumeThread,
                    items,
                    selected: 0,
                });
            }
        }
        Err(e) => app.note(&format!("failed to list threads: {e}")),
    }
}

/// Open the `/model` selector listing `provider / model` pairs from the desktop
/// store, with the current model pre-highlighted.
fn open_model_picker(app: &mut App) {
    let pairs = super::providers::list_provider_models();
    if pairs.is_empty() {
        return app.note("no models available (configure a provider in the desktop app)");
    }
    let selected = pairs.iter().position(|(_, m)| *m == app.model).unwrap_or(0);
    let items = pairs
        .into_iter()
        .map(|(provider, model)| PickerItem {
            label: format!("{provider} / {model}"),
            value: model,
            hint: None,
        })
        .collect();
    app.picker = Some(Picker {
        kind: PickerKind::SelectModel,
        items,
        selected,
    });
}

/// Resolve a thread by id (exact or unique prefix), load its messages into the
/// conversation history, and render them into the transcript.
fn resume_thread(app: &mut App, id_arg: &str) {
    let threads = match super::list_threads_in(&app.agent_dir) {
        Ok(t) => t,
        Err(e) => return app.note(&format!("failed to list threads: {e}")),
    };
    let matches: Vec<&serde_json::Value> = threads
        .iter()
        .filter(|t| {
            t.get("id")
                .and_then(|v| v.as_str())
                .is_some_and(|full| full == id_arg || full.starts_with(id_arg))
        })
        .collect();
    let thread = match matches.as_slice() {
        [] => return app.note(&format!("no thread matches '{id_arg}'")),
        [t] => *t,
        _ => return app.note(&format!("'{id_arg}' is ambiguous ({} matches)", matches.len())),
    };
    let full_id = thread.get("id").and_then(|v| v.as_str()).unwrap_or_default();

    let messages = match super::cli_list_messages_in(&app.agent_dir, full_id) {
        Ok(m) => m,
        Err(e) => return app.note(&format!("failed to load messages: {e}")),
    };

    app.history.clear();
    app.thread_id = Some(full_id.to_string());
    app.transcript.clear();
    app.tool_group = None;
    app.grouped_ids.clear();
    app.assistant_buf.clear();
    app.turn = (0, 0);
    app.tokens = 0;
    app.scrollback = 0;

    // Adopt the thread's model so continuation stays coherent.
    if let Some(model) = thread
        .get("model")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
    {
        app.model = model.to_string();
    }

    let width = app.render_width();
    let mut count = 0;
    for msg in &messages {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let text = message_text(msg);
        if text.is_empty() || !matches!(role, "user" | "assistant") {
            continue;
        }
        app.history
            .push(serde_json::json!({ "role": role, "content": text }));
        if role == "user" {
            app.gap(Kind::User);
            app.push(Line::from(vec![
                Span::styled("› ", Style::new().light_magenta().bold()),
                Span::styled(text, Style::new().bold()),
            ]));
        } else {
            let lines = format_assistant_lines(&text, width);
            if lines.is_empty() {
                continue;
            }
            app.gap(Kind::Prose);
            app.transcript.extend(lines);
        }
        count += 1;
    }

    let title = thread
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("(untitled)");
    app.note(&format!("resumed \"{title}\" ({count} messages)"));
}

/// Extract plain text from a stored thread message (`content` is an array of
/// `{type,text:{value}}` parts, or occasionally a bare string).
fn message_text(msg: &serde_json::Value) -> String {
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

fn draw(f: &mut Frame, app: &mut App) {
    let input_h = input_box_height(app, f.area().width);
    let chunks = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(input_h),
        Constraint::Length(1),
    ])
    .split(f.area());

    f.render_widget(header(app), chunks[0]);

    // Top/bottom borders only, so wrapping uses the full width; the two border
    // rows reduce the vertical viewport. Cache the width so flushed tables wrap.
    let width = chunks[1].width.max(1);
    app.view_width = width;

    if let Some(picker) = &app.picker {
        draw_picker(f, chunks[1], picker);
        f.render_widget(input_box(app), chunks[2]);
        f.render_widget(footer(app), chunks[3]);
        return;
    }

    let mut lines = app.transcript.clone();
    if !app.assistant_buf.is_empty() {
        let tail = format_assistant_lines(&app.assistant_buf, width);
        if !tail.is_empty() {
            // Mirror flush_assistant's `gap(Kind::Prose)` so the separator above
            // streaming prose is present live, not only once it's finalized.
            let last_blank = lines
                .last()
                .map(|l| l.spans.iter().all(|s| s.content.trim().is_empty()))
                .unwrap_or(true);
            if !last_blank {
                lines.push(Line::raw(""));
            }
            // Live tail: strip reasoning tags so partial streaming stays clean.
            lines.extend(tail);
        }
    }
    let body = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .block(Block::default().borders(Borders::TOP | Borders::BOTTOM));
    let inner_h = chunks[1].height.saturating_sub(2);
    let total = body.line_count(width).min(u16::MAX as usize) as u16;
    let max_back = total.saturating_sub(inner_h);
    app.scrollback = app.scrollback.min(max_back);
    let scroll = max_back - app.scrollback;
    f.render_widget(body.scroll((scroll, 0)), chunks[1]);

    // Keep the cursor row visible when the input outgrows the box.
    let input_scroll = if app.status == Status::Idle && app.picker.is_none() {
        let visible = chunks[2].height.saturating_sub(2);
        let total = Paragraph::new(input_content_lines(&app.input))
            .wrap(Wrap { trim: false })
            .line_count(chunks[2].width.saturating_sub(2).max(1))
            .min(u16::MAX as usize) as u16;
        total.saturating_sub(visible)
    } else {
        0
    };
    f.render_widget(input_box(app).scroll((input_scroll, 0)), chunks[2]);
    f.render_widget(footer(app), chunks[3]);

    // Dock the permission prompt directly above the input box, growing upward
    // and clamped to the body area so it never overruns the transcript.
    if let Some(pending) = &app.pending {
        let detail_rows = 1 + u16::from(pending.path.is_some() || pending.command.is_some());
        let height = (pending.options().len() as u16 + detail_rows + 2).min(chunks[1].height);
        let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
        let rect = ratatui::layout::Rect {
            x: chunks[2].x,
            y,
            width: chunks[2].width,
            height,
        };
        draw_permission(f, rect, pending);
    }
}

/// Permission prompt docked above the input: names the tool, capability, and
/// target path, then an arrow-navigable option list (Enter confirms the
/// highlighted choice; `y`/`a`/`n` still work as shortcuts).
fn draw_permission(f: &mut Frame, area: ratatui::layout::Rect, pending: &Pending) {
    use ratatui::widgets::{Clear, List, ListItem, ListState};

    let dim = Style::new().dark_gray();
    let mut detail = vec![Line::from(vec![
        Span::styled(pending.tool_name.clone(), Style::new().cyan().bold()),
        Span::styled(" wants ", dim),
        Span::styled(pending.capability.clone(), Style::new().yellow().bold()),
    ])];
    if let Some(command) = &pending.command {
        detail.push(Line::from(vec![
            Span::styled("$ ", dim),
            Span::styled(command.clone(), Style::new().white()),
        ]));
    } else if let Some(path) = &pending.path {
        detail.push(Line::from(vec![
            Span::styled("on ", dim),
            Span::styled(path.clone(), Style::new().white()),
        ]));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().yellow())
        .title(Span::styled(
            " permission required ",
            Style::new().on_yellow().black().bold(),
        ));
    let inner = block.inner(area);
    f.render_widget(Clear, area);
    f.render_widget(block, area);

    let rows = Layout::vertical([
        Constraint::Length(detail.len() as u16),
        Constraint::Min(1),
    ])
    .split(inner);
    f.render_widget(Paragraph::new(detail).wrap(Wrap { trim: false }), rows[0]);

    let items: Vec<ListItem> = pending
        .options()
        .into_iter()
        .map(|(_, label)| ListItem::new(Line::raw(label)))
        .collect();
    let list = List::new(items)
        .highlight_style(Style::new().reversed().bold())
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(pending.selected));
    f.render_stateful_widget(list, rows[1], &mut state);
}

fn draw_picker(f: &mut Frame, area: ratatui::layout::Rect, picker: &Picker) {
    use ratatui::widgets::{List, ListItem, ListState};

    let items: Vec<ListItem> = picker
        .items
        .iter()
        .map(|it| {
            let mut spans = Vec::new();
            if let Some(hint) = &it.hint {
                spans.push(Span::styled(format!("{hint}  "), Style::new().dark_gray()));
            }
            spans.push(Span::raw(it.label.clone()));
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(picker.title()))
        .highlight_style(Style::new().reversed())
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(picker.selected));
    f.render_stateful_widget(list, area, &mut state);
}

fn header(app: &App) -> Paragraph<'static> {
    let (status, style) = match app.status {
        Status::Idle => ("ready", Style::new().green()),
        Status::Running => ("working", Style::new().yellow().bold()),
    };
    let turn = if app.turn.1 > 0 {
        format!("turn {}/{}  ", app.turn.0, app.turn.1)
    } else {
        String::new()
    };
    Paragraph::new(Line::from(vec![
        Span::styled(" jan agent ", Style::new().on_blue().white().bold()),
        Span::raw(format!("  {}  {turn}tokens {}  ", app.model, app.tokens)),
        Span::styled(format!("[{status}]"), style),
    ]))
}

/// Max content rows the input box grows to before it scrolls internally.
const MAX_INPUT_ROWS: u16 = 8;

/// Height (incl. borders) the message box should occupy: 1 content row for the
/// idle/working placeholder, or the wrapped input height clamped to
/// `MAX_INPUT_ROWS` while editing.
fn input_box_height(app: &App, width: u16) -> u16 {
    let content = if app.status == Status::Idle && app.picker.is_none() {
        let inner = width.saturating_sub(2).max(1);
        let rows = Paragraph::new(input_content_lines(&app.input))
            .wrap(Wrap { trim: false })
            .line_count(inner)
            .max(1) as u16;
        rows.min(MAX_INPUT_ROWS)
    } else {
        1
    };
    content + 2
}

/// Visible input as styled lines: `› ` on the first line, 2-space hang on
/// continuations, cursor `▏` appended to the last line. Wrapping is left to the
/// Paragraph so long single lines fold within the box width.
fn input_content_lines(input: &str) -> Vec<Line<'static>> {
    let arrow = Span::styled("› ", Style::new().cyan().bold());
    let segments: Vec<&str> = input.split('\n').collect();
    let last = segments.len() - 1;
    segments
        .into_iter()
        .enumerate()
        .map(|(i, seg)| {
            let prefix = if i == 0 {
                arrow.clone()
            } else {
                Span::raw("  ")
            };
            let text = if i == last {
                format!("{seg}▏")
            } else {
                seg.to_string()
            };
            Line::from(vec![prefix, Span::raw(text)])
        })
        .collect()
}

fn input_box(app: &App) -> Paragraph<'static> {
    let block = Block::default().borders(Borders::ALL).title(" message ");
    if app.picker.is_some() {
        Paragraph::new(Line::styled("selecting…", Style::new().dim().italic())).block(block)
    } else if app.status == Status::Running {
        Paragraph::new(Line::styled(
            "working… (Esc to cancel)",
            Style::new().dim().italic(),
        ))
        .block(block)
    } else {
        Paragraph::new(input_content_lines(&app.input))
            .wrap(Wrap { trim: false })
            .block(block)
    }
}

fn footer(app: &App) -> Paragraph<'static> {
    if app.pending.is_some() {
        return Paragraph::new(Line::styled(
            " ↑/↓ select   Enter confirm   Esc deny   Ctrl-C cancel",
            Style::new().yellow().dim(),
        ));
    }
    if let Some(picker) = &app.picker {
        return Paragraph::new(Line::styled(picker.action_hint(), Style::new().dim()));
    }
    let hint = match app.status {
        Status::Running => "Esc/Ctrl-C cancel   ↑/↓ scroll",
        Status::Idle => "Enter send   Alt+Enter newline   /help   ↑/↓ scroll   Ctrl-D quit",
    };
    let detail = if app.detail.is_empty() {
        String::new()
    } else {
        format!("   {}", app.detail)
    };
    Paragraph::new(Line::styled(format!(" {hint}{detail}"), Style::new().dim()))
}

#[cfg(test)]
mod tests {
    use super::{
        diff_lines, group_summary, input_content_lines, is_table_separator, message_text,
        parse_command, render_table, split_reasoning, summarize_result, tool_activity, App,
        Pending, DIFF_MAX_ROWS,
    };
    use crate::core::agent::events::StreamEvent;
    use crate::core::agent::tools::gate::PermissionDecision;
    use serde_json::json;

    fn test_app() -> App {
        App::new("m".into(), 8, std::path::PathBuf::from("."))
    }

    fn pending(offers_always: bool) -> Pending {
        Pending {
            request_id: "r".into(),
            tool_name: "bash".into(),
            capability: "execute".into(),
            path: None,
            command: Some("git status".into()),
            offers_always,
            selected: 0,
        }
    }

    #[test]
    fn always_label_is_command_scoped_for_exec() {
        assert_eq!(
            pending(true).always_label(),
            "Allow all 'git' commands (this thread)"
        );
        let mut p = pending(true);
        p.command = None;
        assert_eq!(p.always_label(), "Allow always (this thread)");
    }

    #[test]
    fn pending_options_include_always_only_when_offered() {
        assert_eq!(pending(false).options().len(), 2);
        let opts = pending(true).options();
        assert_eq!(opts.len(), 3);
        assert_eq!(opts[1].0, PermissionDecision::AllowAlways);
    }

    #[test]
    fn pending_selection_wraps_both_directions() {
        let mut p = pending(true); // 3 options
        p.move_selection(-1);
        assert_eq!(p.selected, 2);
        p.move_selection(1);
        assert_eq!(p.selected, 0);
        p.move_selection(1);
        assert_eq!(p.selected, 1);
    }

    #[test]
    fn split_reasoning_separates_think_blocks() {
        let segs = split_reasoning("before<think>hidden</think>after");
        assert_eq!(
            segs,
            vec![
                (false, "before".to_string()),
                (true, "hidden".to_string()),
                (false, "after".to_string()),
            ]
        );
    }

    #[test]
    fn split_reasoning_handles_namespaced_and_unterminated_tags() {
        let segs = split_reasoning("<mm:think>reasoning tail");
        assert_eq!(segs, vec![(true, "reasoning tail".to_string())]);
    }

    #[test]
    fn group_summary_counts_and_pluralizes() {
        assert_eq!(
            group_summary(&["memory note", "skill", "memory note"], true),
            "Read 2 memory notes, 1 skill"
        );
        assert_eq!(
            group_summary(&["command", "search", "search"], false),
            "Ran 1 command, 2 searches"
        );
        assert_eq!(group_summary(&["directory", "directory"], true), "Read 2 directories");
    }

    #[test]
    fn tool_activity_is_concise_present_tense() {
        assert_eq!(
            tool_activity("bash", &json!({ "command": "/usr/bin/grep -n foo src/" })),
            "Executing grep"
        );
        assert_eq!(
            tool_activity("bash", &json!({ "command": "cargo test" })),
            "Executing cargo"
        );
        assert_eq!(tool_activity("grep", &json!({ "pattern": "foo" })), "Searching");
        assert_eq!(
            tool_activity("read", &json!({ "path": "src/main.rs" })),
            "Reading main.rs"
        );
        assert_eq!(
            tool_activity("memory_write", &json!({ "name": "decisions" })),
            "Updating memory: decisions"
        );
    }

    fn line_text(line: &ratatui::text::Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[test]
    fn input_lines_single_line_has_arrow_and_cursor() {
        let lines = input_content_lines("hello");
        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "› hello▏");
    }

    #[test]
    fn input_lines_multiline_hangs_and_cursor_on_last() {
        let lines = input_content_lines("one\ntwo\nthree");
        assert_eq!(lines.len(), 3);
        assert_eq!(line_text(&lines[0]), "› one");
        assert_eq!(line_text(&lines[1]), "  two");
        assert_eq!(line_text(&lines[2]), "  three▏");
    }

    #[test]
    fn input_lines_trailing_newline_gives_empty_cursor_row() {
        let lines = input_content_lines("hi\n");
        assert_eq!(lines.len(), 2);
        assert_eq!(line_text(&lines[0]), "› hi");
        assert_eq!(line_text(&lines[1]), "  ▏");
    }

    #[test]
    fn diff_lines_renders_all_when_under_cap() {
        let out = diff_lines("- foo\n+ bar", 80);
        // 2 content rows framed by a top and bottom border.
        assert_eq!(out.len(), 4);
        assert!(line_text(&out[0]).contains('┌'), "top: {}", line_text(&out[0]));
        assert!(
            line_text(out.last().unwrap()).contains('┘'),
            "bottom: {}",
            line_text(out.last().unwrap())
        );
    }

    #[test]
    fn diff_lines_collapses_tail_past_cap() {
        let diff = (0..30)
            .map(|i| format!("+ line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let out = diff_lines(&diff, 80);
        // DIFF_MAX_ROWS content rows + a `(+N more)` row, framed by 2 borders.
        assert_eq!(out.len(), DIFF_MAX_ROWS + 1 + 2);
        // The tail sits just above the closing border.
        let tail = line_text(&out[out.len() - 2]);
        assert!(tail.contains("(+10 more)"), "tail: {tail}");
    }

    #[test]
    fn single_collapsible_tool_folds_to_one_row() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "grep -n foo src/" }),
        });
        let running = line_text(app.transcript.last().unwrap());
        assert!(running.contains("▸ Executing grep"), "running: {running}");
        let before = app.transcript.len();
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "match\nmatch\n(+50 lines)".into(),
            is_error: false,
            diff: None,
        });
        // Result is swallowed: still one row, still running.
        assert_eq!(app.transcript.len(), before);
        // Finalizing (turn boundary / done) marks it complete on the same row.
        app.finalize_tool_group();
        let row = line_text(app.transcript.last().unwrap());
        assert!(row.contains("✓") && row.contains("Executing grep"), "row: {row}");
        assert!(!row.contains("lines"), "row: {row}");
        assert!(app.tool_group.is_none());
    }

    #[test]
    fn consecutive_collapsible_tools_fold_into_one_summary_row() {
        let mut app = test_app();
        let calls = [
            ("c1", "memory_list", json!({})),
            ("c2", "skill_list", json!({})),
            ("c3", "memory_read", json!({ "name": "project-overview" })),
            ("c4", "memory_read", json!({ "name": "top-p" })),
        ];
        for (id, name, args) in calls {
            app.apply(StreamEvent::ToolCall {
                id: id.into(),
                name: name.into(),
                args,
            });
            app.apply(StreamEvent::ToolResult {
                id: id.into(),
                content: "ok".into(),
                is_error: false,
                diff: None,
            });
        }
        // All four folded into a single running row with a live counter.
        let tool_rows = app
            .transcript
            .iter()
            .filter(|l| line_text(l).contains("Reading") || line_text(l).contains("Read "))
            .count();
        assert_eq!(tool_rows, 1);
        assert!(line_text(app.transcript.last().unwrap()).contains("(4)"));
        // A turn boundary finalizes it to a short summary sentence.
        app.apply(StreamEvent::Step { index: 2, max: 8 });
        let row = line_text(app.transcript.last().unwrap());
        assert!(row.contains("✓ Read 3 memory notes, 1 skill"), "row: {row}");
    }

    #[test]
    fn diff_tool_result_keeps_separate_rows_and_panel() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "edit".into(),
            args: json!({ "path": "a.txt" }),
        });
        let before = app.transcript.len();
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "edited".into(),
            is_error: false,
            diff: Some("- old\n+ new".into()),
        });
        // Call row preserved; result row + boxed diff appended below it.
        assert!(app.transcript.len() > before);
        let joined: String = app
            .transcript
            .iter()
            .map(|l| line_text(l))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Editing a.txt"), "{joined}");
        assert!(joined.contains('┌') && joined.contains('┘'), "{joined}");
    }

    #[test]
    fn summarize_result_first_line_plus_count() {
        assert_eq!(summarize_result("only line", 80), "only line");
        assert_eq!(summarize_result("a\nb\nc", 80), "a  (+2 lines)");
        assert_eq!(summarize_result("  \nreal\nx", 80), "real  (+1 lines)");
        // Collapses internal whitespace runs (e.g. columnar grep output).
        assert_eq!(summarize_result("a    b\tc", 80), "a b c");
        // Truncates the head to max.
        assert_eq!(summarize_result("abcdefgh", 4), "abc…");
    }

    #[test]
    fn sort_threads_recent_orders_newest_first() {
        let mut threads = vec![
            json!({ "id": "a", "updated": 100.0 }),
            json!({ "id": "b", "updated": 300.0 }),
            json!({ "id": "c", "created": 200.0 }),
            json!({ "id": "d" }),
        ];
        super::sort_threads_recent(&mut threads);
        let ids: Vec<&str> = threads.iter().map(|t| t["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["b", "c", "a", "d"]);
    }

    #[test]
    fn thread_display_name_prefers_title() {
        let base = std::path::Path::new("/nonexistent");
        assert_eq!(super::thread_display_name(base, "id", Some("My Title")), "My Title");
        assert_eq!(super::thread_display_name(base, "id", Some("  padded  ")), "padded");
    }

    #[test]
    fn truncate_is_char_safe() {
        assert_eq!(super::truncate("héllo wörld", 5), "héll…");
        assert_eq!(super::truncate("short", 20), "short");
    }

    #[test]
    fn table_separator_detection() {
        assert!(is_table_separator("|---|:--:|"));
        assert!(is_table_separator(" --- | --- "));
        assert!(!is_table_separator("| a | b |"));
        assert!(!is_table_separator("plain text"));
    }

    #[test]
    fn loose_list_marker_merges_into_body_line() {
        // tui-markdown splits loose-list markers onto their own line; the merge
        // pass folds "1. " and "- " back onto the item body.
        let md = "1. first item\n\n2. second item";
        let lines: Vec<String> = super::markdown_to_lines(md)
            .iter()
            .map(line_text)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert_eq!(lines, ["1. first item", "2. second item"], "{lines:?}");

        let bullets: Vec<String> = super::markdown_to_lines("- alpha\n\n- beta")
            .iter()
            .map(line_text)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert_eq!(bullets, ["- alpha", "- beta"], "{bullets:?}");
    }

    #[test]
    fn markdown_renders_bold_and_keeps_text() {
        // tui-markdown should strip the ** markers and keep the word.
        let lines = super::markdown_to_lines("hello **world**");
        let text: String = lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .map(|s| s.content.as_ref())
            .collect();
        assert!(text.contains("hello"), "got {text:?}");
        assert!(text.contains("world"), "got {text:?}");
        assert!(!text.contains("**"), "markers not stripped: {text:?}");
    }

    fn joined(lines: &[ratatui::text::Line]) -> String {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .map(|s| s.content.as_ref())
            .collect()
    }

    #[test]
    fn format_markdown_routes_table_through_comfy_table() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |";
        let lines = super::format_markdown_lines(md, 40);
        let text = joined(&lines);
        // No raw markdown pipes; cell content preserved; wrapped within width.
        assert!(text.contains('a') && text.contains('b') && text.contains('1'));
        assert!(lines.iter().all(|l| joined(std::slice::from_ref(l)).chars().count() <= 40));
    }

    #[test]
    fn render_table_wraps_and_strips_inline_md() {
        let header = vec!["name".to_string(), "note".to_string()];
        let rows = vec![vec![
            "**apple**".to_string(),
            "a `very` long note that must wrap across several lines".to_string(),
        ]];
        let lines = render_table(&header, &rows, 30);
        let text = joined(&lines);
        assert!(text.contains("apple") && !text.contains('*'), "md not stripped: {text:?}");
        assert!(!text.contains('`'), "backticks not stripped: {text:?}");
        // Dynamic wrapping keeps every rendered row within the target width.
        assert!(lines.iter().all(|l| joined(std::slice::from_ref(l)).chars().count() <= 30));
    }

    #[test]
    fn parse_command_splits_name_and_arg() {
        assert_eq!(parse_command("resume abc123"), ("resume", "abc123"));
        assert_eq!(parse_command("help"), ("help", ""));
        assert_eq!(parse_command("  resume   abc  "), ("resume", "abc"));
        assert_eq!(parse_command(""), ("", ""));
    }

    #[test]
    fn parse_command_handles_multibyte_without_panic() {
        // Leading space + multibyte would panic under byte slicing.
        assert_eq!(parse_command(" résumé foo"), ("résumé", "foo"));
        assert_eq!(parse_command("café"), ("café", ""));
    }

    #[test]
    fn message_text_extracts_content_parts() {
        let msg = json!({
            "role": "user",
            "content": [{ "type": "text", "text": { "value": "hello", "annotations": [] } }]
        });
        assert_eq!(message_text(&msg), "hello");
    }

    #[test]
    fn message_text_joins_multiple_parts_and_handles_string() {
        let multi = json!({ "content": [
            { "text": { "value": "a" } },
            { "text": { "value": "b" } },
        ] });
        assert_eq!(message_text(&multi), "ab");
        let bare = json!({ "content": "plain" });
        assert_eq!(message_text(&bare), "plain");
        let empty = json!({ "role": "user" });
        assert_eq!(message_text(&empty), "");
    }
}
