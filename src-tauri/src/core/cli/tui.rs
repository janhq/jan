//! Interactive chat console over the agent loop (`jan agent ui`). A thin
//! renderer: the engine is shared with the plain CLI path, only the
//! presentation differs. Maintains a running conversation — the user types
//! messages into an input box, each submit spawns an agent run over the shared
//! `AgentSession`, and streamed `StreamEvent`s render as message history plus
//! inline workflow elements (turn steps, tool calls/results). Gated tool calls
//! are approved interactively via the shared `PermissionRegistry`.

use std::future::pending;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

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
use crate::core::agent::git;
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
    Reasoning,
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
    /// Focused diff preview for write/edit prompts, shown so the user approves
    /// with the change in view; `None` for other tools.
    diff: Option<String>,
    offers_always: bool,
    /// Highlighted option in the docked prompt (index into `options()`).
    selected: usize,
    /// Name of the subagent that requested this, when the call originated inside
    /// a nested subagent run; `None` for the parent agent's own calls.
    subagent: Option<String>,
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

    /// Boxed diff preview for the prompt, sized to `inner` width; empty when the
    /// tool carries no diff (exec/read). No gutter: the panel sits flush in the
    /// prompt box, unlike the tool-row-aligned result diff.
    fn diff_preview(&self, inner: u16) -> Vec<Line<'static>> {
        match &self.diff {
            Some(d) => diff_lines(d, (inner as usize).saturating_sub(4).max(1), ""),
            None => Vec::new(),
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
    ToggleMcp,
    /// Double-Esc rewind: pick a past user message to roll back to.
    RewindMessage,
    /// Second step of a rewind: restore conversation only, or + workspace.
    RewindScope,
}

/// Interactive list overlay (`/resume` threads, `/model` models, `/mcp`
/// servers): rows with a highlighted cursor, acted on by `PickerKind` on Enter.
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
            PickerKind::ToggleMcp => " mcp servers ",
            PickerKind::RewindMessage => " rewind to message ",
            PickerKind::RewindScope => " restore ",
        }
    }

    fn action_hint(&self) -> &'static str {
        match self.kind {
            PickerKind::ResumeThread => " ↑/↓ select   Enter resume   Esc cancel",
            PickerKind::SelectModel => " ↑/↓ select   Enter choose   Esc cancel",
            PickerKind::ToggleMcp => " ↑/↓ select   Enter toggle   Esc close",
            PickerKind::RewindMessage => " ↑/↓ select   Enter choose   Esc cancel",
            PickerKind::RewindScope => " ↑/↓ select   Enter restore   Esc cancel",
        }
    }
}

struct PickerItem {
    /// The value acted on (thread id, model id, or MCP server name).
    value: String,
    /// Primary display text.
    label: String,
    /// Optional dim prefix (e.g. a thread's short id).
    hint: Option<String>,
    /// Enabled-state for toggle pickers (`/mcp`); `None` for one-shot pickers.
    checkbox: Option<bool>,
}

/// A spawned agent run: the event stream and its abort handle.
struct CurrentRun {
    rx: mpsc::UnboundedReceiver<StreamEvent>,
    handle: JoinHandle<()>,
}

/// One folded call's retained detail, so an expanded group can reconstruct each
/// individual call and its result without re-fetching anything.
struct GroupedCall {
    id: String,
    /// Past-tense finished label (e.g. "Ran grep -n foo src/").
    done: String,
    /// Raw result content, filled when the matching `ToolResult` arrives.
    content: Option<String>,
    is_error: bool,
    diff: Option<String>,
}

/// A run of consecutive collapsible tool calls folded into one transcript row.
struct ToolGroup {
    /// Transcript index of the row this group owns.
    idx: usize,
    /// Past-tense label shown when the group finalizes as a single call.
    first_done: String,
    /// Per-call noun for the finalized breakdown, paired with whether it is a
    /// read-style op ("memory note"/true, "command"/false, ...). The flag splits
    /// the summary into a "Read ..." clause and a "ran ..." clause so the verb
    /// always agrees with its noun.
    nouns: Vec<(&'static str, bool)>,
    /// Per-call detail retained so the collapsed row can expand back to its
    /// individual calls/results (never discarded at fold time).
    calls: Vec<GroupedCall>,
}

/// A committed `<think>` reasoning block, folded to a one-line summary row.
/// The full dimmed lines are retained so the row can expand back to them.
struct ReasoningBlock {
    /// Transcript index of the summary row this block owns.
    idx: usize,
    /// Full dimmed reasoning lines, revealed when expanded.
    detail: Vec<Line<'static>>,
}

/// A committed workspace state, one per turn that changed files. `user_index` is
/// the position (among user messages) of the message that drove the turn, so a
/// rewind to message N resets to the checkpoint recorded before N.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Checkpoint {
    user_index: usize,
    preview: String,
    sha: String,
}

struct App {
    model: String,
    max_turns: u32,
    /// Repo top-level when the project is a git repo; enables workspace snapshots.
    /// Cleared if git setup fails, permanently disabling snapshots this session.
    repo_root: Option<PathBuf>,
    /// Directory tool paths (`edit`/`write` "path" args) are resolved against.
    project_root: PathBuf,
    /// Absolute paths touched by `edit`/`write` tool calls so far this turn;
    /// drained into the next checkpoint's snapshot and reset per turn. Only
    /// these exact paths are staged -- checkpoints never scan the repo.
    turn_touched: Vec<PathBuf>,
    /// Base snapshot (working-tree state before the first turn) for the active
    /// thread. `Some` once snapshotting is armed; `None` = no workspace restore.
    base_snapshot: Option<String>,
    /// Per-turn workspace checkpoints for the active thread, oldest first.
    checkpoints: Vec<Checkpoint>,
    /// Pending git snapshots, run off the render loop (see `SnapshotJob`).
    snap_queue: std::collections::VecDeque<SnapshotJob>,
    /// Whether a base snapshot has been requested for the active thread (queued,
    /// in flight, done, or resumed), so it is captured at most once per thread.
    base_requested: bool,
    /// Timestamp of the last idle Esc, to detect a double-Esc rewind gesture.
    last_esc: Option<Instant>,
    /// User-message index chosen in the rewind picker, carried into the scope step.
    rewind_target: Option<usize>,
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
    /// Finalized tool groups, retained with their per-call detail so a collapsed
    /// summary row can be expanded back to its individual calls/results.
    groups: Vec<ToolGroup>,
    /// Committed reasoning blocks, folded to a summary row and expandable back to
    /// their full dimmed lines.
    reasoning_blocks: Vec<ReasoningBlock>,
    /// Transcript row indices of collapsed regions (tool groups or reasoning
    /// blocks) the user has expanded to full detail.
    expanded: std::collections::HashSet<usize>,
    /// Transcript row of a region to scroll into view on the next draw (set when
    /// expanding one that may sit above the pinned-to-bottom viewport).
    reveal: Option<usize>,
    input: String,
    /// Caret position as a byte index into `input` (always on a char boundary).
    cursor: usize,
    /// Highlighted row in the slash-command hint popup (clamped to matches).
    slash_selected: usize,
    /// Set by Esc to hide the hint popup without clearing the buffer; cleared on
    /// the next keystroke that edits the input so typing re-shows it.
    slash_dismissed: bool,
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
    /// Live panels for background subagents currently streaming, one per run.
    /// Several may be active at once; each renders its own rolling window.
    subagents: Vec<SubagentPanel>,
    /// Committed finished-subagent summary rows, expandable to their full
    /// tool-call list via Ctrl-O (parallel to `groups`/`reasoning_blocks`).
    subagent_blocks: Vec<SubagentBlock>,
    /// In-flight `await_subagent` calls, `(tool_call_id, subagent_name)`. Each
    /// renders a live throbber row until its tool result arrives.
    awaiting: Vec<(String, String)>,
    /// Monotonic frame counter advanced each render tick; drives the throbber.
    spinner_frame: usize,
}

/// Braille throbber frames for in-progress rows (e.g. awaiting a subagent).
const SPINNER: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Live rolling view of an in-flight subagent's tool calls. The panel shows only
/// the most recent [`SUBAGENT_WINDOW`] calls, but the full list is retained so
/// the finished summary row can expand back to every call (Ctrl-O).
struct SubagentPanel {
    run_id: String,
    name: String,
    calls: Vec<String>,
}

/// A committed finished-subagent summary row, folded to one line but retaining
/// its full tool-call list so the row can expand back to it (like a tool group).
struct SubagentBlock {
    /// Transcript index of the summary row this block owns.
    idx: usize,
    /// Full detail lines (one per tool call), revealed when expanded.
    detail: Vec<Line<'static>>,
}

/// Rolling window size for a subagent's live tool-call list.
const SUBAGENT_WINDOW: usize = 5;

/// A queued git workspace snapshot. Snapshots only stage the paths the agent
/// actually touched this turn (see `App::turn_touched`), never the whole
/// working tree, so this stays cheap on a large repo. Still run off the
/// render loop (via `spawn_blocking`) and serialized (each checkpoint parents
/// the previous), driven from the main loop rather than inline in
/// `submit_user`/`on_done`.
enum SnapshotJob {
    /// Base state captured before the first turn; gates the first run.
    Base,
    /// Per-turn checkpoint keyed to the driving user message, carrying the
    /// paths touched by `edit`/`write` tool calls since the previous one.
    Checkpoint {
        user_index: usize,
        preview: String,
        changed: Vec<PathBuf>,
    },
}

/// `(repo, parent sha, commit message, thread id, changed paths)` resolved
/// from a queued [`SnapshotJob`], ready to hand to `git::snapshot`.
type SnapshotInputs = (PathBuf, Option<String>, String, String, Vec<PathBuf>);

impl App {
    fn new(
        model: String,
        max_turns: u32,
        agent_dir: std::path::PathBuf,
        project_root: PathBuf,
        repo_root: Option<PathBuf>,
    ) -> Self {
        Self {
            model,
            max_turns,
            repo_root,
            project_root,
            turn_touched: Vec::new(),
            base_snapshot: None,
            checkpoints: Vec::new(),
            snap_queue: std::collections::VecDeque::new(),
            base_requested: false,
            last_esc: None,
            rewind_target: None,
            agent_dir,
            history: Vec::new(),
            thread_id: None,
            transcript: Vec::new(),
            assistant_buf: String::new(),
            tool_group: None,
            grouped_ids: std::collections::HashSet::new(),
            groups: Vec::new(),
            reasoning_blocks: Vec::new(),
            expanded: std::collections::HashSet::new(),
            reveal: None,
            input: String::new(),
            cursor: 0,
            slash_selected: 0,
            slash_dismissed: false,
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
            subagents: Vec::new(),
            subagent_blocks: Vec::new(),
            awaiting: Vec::new(),
            spinner_frame: 0,
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

    /// Drop the current conversation and all transient turn state, detaching from
    /// the saved thread so the next message starts a fresh one. Backs `/clear` and
    /// `/new`; the model/MCP setup and picker state are untouched.
    fn reset_session(&mut self) {
        self.history.clear();
        self.thread_id = None;
        // Detach snapshots; the next submit arms a fresh base + thread id.
        self.base_snapshot = None;
        self.checkpoints.clear();
        self.snap_queue.clear();
        self.base_requested = false;
        self.last_esc = None;
        self.transcript.clear();
        self.tool_group = None;
        self.grouped_ids.clear();
        self.groups.clear();
        self.reasoning_blocks.clear();
        self.subagent_blocks.clear();
        self.expanded.clear();
        self.reveal = None;
        self.assistant_buf.clear();
        self.pending = None;
        self.tokens = 0;
        self.turn = (0, 0);
        self.detail.clear();
        self.scrollback = 0;
        self.last_kind = Kind::None;
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
        // No-op (and, crucially, don't finalize the tool group) on an empty or
        // whitespace-only buffer, so silent consecutive tool calls keep folding.
        if !assistant_has_content(&text) {
            return;
        }
        // Model prose ends the current run of tool calls.
        self.finalize_tool_group();
        self.push_assistant_blocks(&text);
    }

    /// Commit assistant `text` to the transcript in emission order: answer prose
    /// through markdown, each `<think>` block folded to a one-line summary row
    /// whose full dimmed detail is retained for expansion.
    fn push_assistant_blocks(&mut self, text: &str) {
        let width = self.render_width();
        for (reasoning, seg) in split_reasoning(text) {
            if seg.trim().is_empty() {
                continue;
            }
            if reasoning {
                let detail = reasoning_detail_lines(&seg);
                if detail.is_empty() {
                    continue;
                }
                // Distinct Kind so the reasoning->prose transition still gaps
                // (both sharing Kind::Prose would collapse to no separator).
                self.gap(Kind::Reasoning);
                self.push(reasoning_summary_row(detail.len()));
                let idx = self.transcript.len() - 1;
                self.reasoning_blocks.push(ReasoningBlock { idx, detail });
            } else {
                let lines = format_markdown_lines(&seg, width);
                if !lines.is_empty() {
                    self.gap(Kind::Prose);
                    self.transcript.extend(lines);
                }
            }
        }
    }

    /// Fold a collapsible tool call into the current group row (extending it and
    /// updating its live status) or open a new group row.
    fn push_grouped_call(&mut self, id: &str, name: &str, label: String, done: String) {
        let (noun, is_read) = tool_kind(name);
        self.grouped_ids.insert(id.to_string());
        let call = GroupedCall {
            id: id.to_string(),
            done: done.clone(),
            content: None,
            is_error: false,
            diff: None,
        };
        let extend = self.tool_group.as_mut().map(|g| {
            g.nouns.push((noun, is_read));
            g.calls.push(call);
            (g.idx, group_activity(&g.nouns))
        });
        match extend {
            Some((idx, running)) if idx < self.transcript.len() => {
                let max = self.render_width().saturating_sub(6) as usize;
                self.transcript[idx] = tool_row(
                    "▸",
                    Style::new().cyan(),
                    &truncate(&running, max),
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
                    first_done: done.clone(),
                    nouns: vec![(noun, is_read)],
                    calls: vec![GroupedCall {
                        id: id.to_string(),
                        done,
                        content: None,
                        is_error: false,
                        diff: None,
                    }],
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
            g.first_done.clone()
        } else {
            group_summary(&g.nouns)
        };
        self.transcript[g.idx] = tool_row("✓", Style::new().green(), &text, Style::new().dim());
        self.groups.push(g);
    }

    /// Toggle full detail for every collapsed region (tool groups and reasoning
    /// blocks): collapse all when all are already expanded, else expand all and
    /// scroll the most-recent one into view.
    fn toggle_regions(&mut self) {
        let all: Vec<usize> = self
            .groups
            .iter()
            .map(|g| g.idx)
            .chain(self.reasoning_blocks.iter().map(|r| r.idx))
            .chain(self.subagent_blocks.iter().map(|b| b.idx))
            .collect();
        if all.is_empty() {
            return;
        }
        if all.iter().all(|i| self.expanded.contains(i)) {
            self.expanded.clear();
            self.reveal = None;
        } else {
            self.expanded = all.iter().copied().collect();
            // The regions sit above the answer that follows; scroll the latest
            // into view rather than staying pinned to the bottom.
            self.reveal = all.iter().copied().max();
        }
    }

    fn input_clear(&mut self) {
        self.input.clear();
        self.cursor = 0;
        self.reset_slash_hint();
    }

    fn input_insert(&mut self, c: char) {
        self.input.insert(self.cursor, c);
        self.cursor += c.len_utf8();
        self.reset_slash_hint();
    }

    /// Delete the char before the caret (Backspace).
    fn input_backspace(&mut self) {
        if let Some(prev) = self.input[..self.cursor].chars().next_back() {
            self.cursor -= prev.len_utf8();
            self.input.remove(self.cursor);
        }
        self.reset_slash_hint();
    }

    /// Delete the char at the caret (Delete); caret stays put.
    fn input_delete(&mut self) {
        if self.cursor < self.input.len() {
            self.input.remove(self.cursor);
        }
        self.reset_slash_hint();
    }

    /// Reset hint selection and un-dismiss so an edited buffer re-shows the popup.
    fn reset_slash_hint(&mut self) {
        self.slash_selected = 0;
        self.slash_dismissed = false;
    }

    /// Slash commands whose name prefixes the current buffer, or empty when the
    /// popup should not show: not idle, buffer isn't a bare `/name` token (no
    /// whitespace yet), the popup was Esc-dismissed, or nothing matches.
    fn slash_matches(&self) -> Vec<&'static SlashCommand> {
        if self.status != Status::Idle
            || self.slash_dismissed
            || !self.input.starts_with('/')
            || self.input.chars().any(char::is_whitespace)
        {
            return Vec::new();
        }
        SLASH_COMMANDS
            .iter()
            .filter(|c| c.name.starts_with(&self.input))
            .collect()
    }

    /// Move the hint selection, wrapping within the current match count.
    fn slash_move(&mut self, delta: isize) {
        let len = self.slash_matches().len();
        if len == 0 {
            return;
        }
        let cur = self.slash_selected.min(len - 1) as isize;
        self.slash_selected = (cur + delta).rem_euclid(len as isize) as usize;
    }

    /// Fill the buffer with the highlighted command name plus a trailing space,
    /// ready for arguments; the space hides the popup via `slash_matches`.
    fn accept_slash(&mut self) {
        let matches = self.slash_matches();
        if matches.is_empty() {
            return;
        }
        let name = matches[self.slash_selected.min(matches.len() - 1)].name;
        self.input = format!("{name} ");
        self.cursor = self.input.len();
        self.slash_selected = 0;
    }

    fn cursor_left(&mut self) {
        if let Some(prev) = self.input[..self.cursor].chars().next_back() {
            self.cursor -= prev.len_utf8();
        }
    }

    fn cursor_right(&mut self) {
        if let Some(next) = self.input[self.cursor..].chars().next() {
            self.cursor += next.len_utf8();
        }
    }

    /// Queue a user message: record it in history and the transcript, and ask
    /// the loop to start a run. Flips to `Running` synchronously so further keys
    /// in the same input batch can't slip through as a second submit.
    fn submit_user(&mut self, text: String) {
        self.ensure_base_snapshot();
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

    /// Arm workspace snapshots by queuing the base capture before the first turn.
    /// No-op when the project is not a git repo or the base is already armed. The
    /// blocking `git` work runs off the render loop; the run start gates on it.
    /// Allocates the thread id up front so the snapshot ref and the persisted
    /// thread share one id.
    fn ensure_base_snapshot(&mut self) {
        if self.repo_root.is_none() || self.base_requested {
            return;
        }
        if self.thread_id.is_none() {
            self.thread_id = Some(uuid::Uuid::new_v4().to_string());
        }
        self.base_requested = true;
        self.snap_queue.push_back(SnapshotJob::Base);
    }

    /// Thread metadata persisted alongside the conversation: the base snapshot and
    /// per-turn checkpoints, so `/resume` can restore and rewind. `None` when
    /// snapshots are inactive (keeps a plain `{}` metadata block).
    fn thread_metadata(&self) -> Option<serde_json::Value> {
        let base = self.base_snapshot.as_ref()?;
        Some(serde_json::json!({
            "base_snapshot": base,
            "checkpoints": self.checkpoints,
        }))
    }

    /// Queue a checkpoint of the working tree produced by the just-finished turn,
    /// keyed to the driving user message. A turn that changed no files still
    /// snapshots (its tree equals the previous), keeping the message->snapshot map
    /// complete for rewind. The blocking `git` work runs off the render loop.
    fn checkpoint_turn(&mut self) {
        if self.repo_root.is_none() || !self.base_requested {
            return;
        }
        let user_index = self
            .history
            .iter()
            .filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
            .count()
            .saturating_sub(1);
        let preview = self
            .history
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
            .and_then(|m| m.get("content").and_then(|v| v.as_str()))
            .map(truncate_preview)
            .unwrap_or_default();
        self.snap_queue.push_back(SnapshotJob::Checkpoint {
            user_index,
            preview,
            changed: std::mem::take(&mut self.turn_touched),
        });
    }

    /// Resolve the git inputs for the next queued snapshot from current state:
    /// `(repo, parent, message, thread_id, changed paths)`. `None` when
    /// snapshotting is unavailable (not a git repo, or no thread id yet), so the
    /// job is dropped. Changed paths are made relative to `repo`; anything
    /// outside it is dropped rather than passed to `git`.
    fn resolve_snapshot(&self, job: &SnapshotJob) -> Option<SnapshotInputs> {
        let repo = self.repo_root.clone()?;
        let id = self.thread_id.clone()?;
        match job {
            SnapshotJob::Base => Some((repo, None, "jan agent base".to_string(), id, Vec::new())),
            SnapshotJob::Checkpoint { changed, .. } => {
                let parent = self
                    .checkpoints
                    .last()
                    .map(|c| c.sha.clone())
                    .or_else(|| self.base_snapshot.clone());
                let n = self.checkpoints.len() + 1;
                let changed = changed
                    .iter()
                    .filter_map(|p| p.strip_prefix(&repo).ok().map(|p| p.to_path_buf()))
                    .collect();
                Some((repo, parent, format!("jan agent turn {n}"), id, changed))
            }
        }
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
            self.thread_metadata(),
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
            StreamEvent::Token { text } => {
                self.assistant_buf.push_str(&text);
                // Commit the tool group as `✓` once real answer prose begins, so
                // it lands above the streaming response. Reasoning tokens must
                // not trigger this, or every call by a reasoning model splits
                // into its own row.
                if self.tool_group.is_some() && has_answer_text(&self.assistant_buf) {
                    self.finalize_tool_group();
                }
            }
            StreamEvent::Step { index, max } => {
                // Only flush (and thereby close the tool group) once the model
                // has produced answer prose; a turn that only reasoned or only
                // called tools keeps the group open so the next turn's calls
                // keep folding into one summary row instead of a row per turn.
                if has_answer_text(&self.assistant_buf) {
                    self.flush_assistant();
                }
                self.turn = (index, max);
            }
            StreamEvent::ToolCall { id, name, args } => {
                // Awaiting a subagent is a long block: show a live throbber row
                // (advanced each render tick) instead of a static grouped row,
                // cleared when its result arrives.
                if name == "await_subagent" {
                    let run_id = args.get("run_id").and_then(|v| v.as_str()).unwrap_or("");
                    let sub = subagent_name_from_run_id(run_id).to_string();
                    self.awaiting.push((id, sub));
                    return;
                }
                let max = self.render_width().saturating_sub(6) as usize;
                let label = truncate(&tool_activity(&name, &args), max);
                let done = truncate(&tool_finished(&name, &args), max);
                if matches!(name.as_str(), "edit" | "write") {
                    // Record the touched path so the next checkpoint snapshots
                    // exactly this file instead of scanning the whole repo.
                    if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                        self.turn_touched.push(self.project_root.join(p));
                    }
                    // Diff-producing tools render standalone (call row & panel).
                    self.finalize_tool_group();
                    self.flush_assistant();
                    self.gap(Kind::Tool);
                    self.push(tool_row("▸", Style::new().cyan(), &label, Style::new().cyan().dim()));
                } else {
                    // Commit any buffered prose OR reasoning the model emitted
                    // before this call so the timeline stays in emission order
                    // (pre-tool thinking renders above the tool row, not stranded
                    // in the live tail below it). `flush_assistant` no-ops on an
                    // empty buffer, so truly silent consecutive calls still fold.
                    self.flush_assistant();
                    self.push_grouped_call(&id, &name, label, done);
                }
            }
            StreamEvent::ToolResult {
                id,
                content,
                is_error,
                diff,
            } => {
                // Clear the throbber for an awaited subagent once its result lands.
                self.awaiting.retain(|(await_id, _)| await_id != &id);
                // Grouped calls are already represented by the group row; retain
                // their result on the group so an expand can show it later.
                if self.grouped_ids.contains(&id) {
                    if let Some(call) = self
                        .tool_group
                        .as_mut()
                        .and_then(|g| g.calls.iter_mut().find(|c| c.id == id))
                    {
                        call.is_error = is_error;
                        call.diff = diff;
                        call.content = Some(content);
                    }
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
                    for line in diff_lines(&diff, max, "│     ") {
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
                diff,
                offers_always,
                ..
            } => {
                // Don't close the tool group here: the prompt renders docked
                // above the input, and finalizing would break the running row
                // for every gated call (i.e. every exec) into its own line.
                self.pending = Some(Pending {
                    request_id,
                    tool_name,
                    capability,
                    path,
                    command,
                    diff,
                    offers_always,
                    selected: 0,
                    subagent: None,
                });
            }
            StreamEvent::SubagentStart { run_id, name } => {
                // Open a live rolling panel for this run; several may be active.
                self.finalize_tool_group();
                self.flush_assistant();
                self.subagents.push(SubagentPanel {
                    run_id,
                    name,
                    calls: Vec::new(),
                });
            }
            StreamEvent::SubagentEnd { run_id, name } => {
                // Take the run's full call list, commit a folded summary row, and
                // retain the detail so Ctrl-O can expand it (like a tool group).
                let calls = self
                    .subagents
                    .iter()
                    .find(|p| p.run_id == run_id)
                    .map(|p| p.calls.clone())
                    .unwrap_or_default();
                self.subagents.retain(|p| p.run_id != run_id);
                let total = calls.len();
                self.gap(Kind::Tool);
                let noun = if total == 1 { "call" } else { "calls" };
                self.push(tool_row(
                    "↲",
                    Style::new().magenta().dim(),
                    &format!("subagent {name} finished ({total} tool {noun})"),
                    Style::new().magenta().dim(),
                ));
                if total > 0 {
                    let idx = self.transcript.len() - 1;
                    let detail = calls
                        .into_iter()
                        .map(|label| {
                            Line::from(vec![
                                Span::styled("│   ", Style::new().dark_gray()),
                                Span::styled("▸ ", Style::new().magenta()),
                                Span::styled(label, Style::new().dim()),
                            ])
                        })
                        .collect();
                    self.subagent_blocks.push(SubagentBlock { idx, detail });
                }
            }
            StreamEvent::Subagent {
                run_id,
                name,
                event,
            } => self.apply_subagent_event(&run_id, &name, *event),
            StreamEvent::Done { .. } | StreamEvent::Error { .. } => {}
        }
    }

    /// Route one backgrounded subagent's internal event to its run's live panel.
    /// Only tool calls populate the rolling window; the child's own prose/steps/
    /// results are internal. A permission request docks the shared prompt,
    /// attributed to the asking subagent.
    fn apply_subagent_event(&mut self, run_id: &str, name: &str, event: StreamEvent) {
        match event {
            StreamEvent::ToolCall {
                name: tool, args, ..
            } => {
                let max = self.render_width().saturating_sub(6) as usize;
                let label = truncate(&subagent_activity(&tool, &args), max);
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    // Full history retained for expansion; the panel renders only
                    // the last SUBAGENT_WINDOW.
                    panel.calls.push(label);
                }
            }
            StreamEvent::PermissionRequest {
                request_id,
                tool_name,
                capability,
                path,
                command,
                diff,
                offers_always,
                ..
            } => {
                self.pending = Some(Pending {
                    request_id,
                    tool_name,
                    capability,
                    path,
                    command,
                    diff,
                    offers_always,
                    selected: 0,
                    subagent: Some(name.to_string()),
                });
            }
            // Token/Step/ToolResult and any nested bracket are internal to the
            // child run and not surfaced in the parent transcript.
            _ => {}
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
        // Surface abnormal completions in the timeline, not just the footer: a
        // truncated/filtered finish, or a "stop" that yielded no answer (an
        // empty/malformed upstream completion defaults to stop_reason=stop).
        let normal = matches!(stop_reason.as_str(), "stop" | "end_turn" | "stop_sequence");
        let no_answer = !has_answer_text(&answer);
        if !normal || no_answer {
            let msg = if no_answer {
                format!("finished with no answer (stop_reason={stop_reason})")
            } else {
                format!("finished early (stop_reason={stop_reason})")
            };
            self.gap(Kind::Meta);
            self.push(Line::styled(msg, Style::new().yellow().bold()));
        }
        self.checkpoint_turn();
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
        // Commit whatever was streamed before the cancel so partial prose and the
        // preceding tool calls stay in the transcript, and record the partial
        // answer in history so the next turn and a later /resume both see it.
        self.finalize_tool_group();
        let answer = self.take_answer();
        if !answer.is_empty() {
            self.history
                .push(serde_json::json!({ "role": "assistant", "content": answer }));
        }
        self.status = Status::Idle;
        self.detail = "cancelled".to_string();
        self.scrollback = 0;
        self.gap(Kind::Meta);
        self.push(Line::styled("cancelled", Style::new().yellow()));
        self.persist();
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

/// Max chars shown for a bash/shell/exec command label in the transcript.
const COMMAND_LABEL_MAX: usize = 80;

/// Render focused-diff text as a boxed panel: a light rule frames the change,
/// `-` lines red, `+` green, `@@` headers dim-cyan. Content is truncated to
/// `max` and each row padded so the right border aligns. Collapses to
/// `DIFF_MAX_ROWS` with a `(+N more)` tail before the closing rule. `gutter`
/// indents the panel (tool-row alignment under a result; empty in the prompt).
fn diff_lines(diff: &str, max: usize, gutter: &'static str) -> Vec<Line<'static>> {
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
    boxed_panel(rows, max, gutter)
}

/// Frame `(text, style)` rows in a light box, right-padded to the widest row
/// (clamped to `max`). `gutter` prefixes every line to indent the panel.
fn boxed_panel(rows: Vec<(String, Style)>, max: usize, gutter: &'static str) -> Vec<Line<'static>> {
    let inner = rows
        .iter()
        .map(|(t, _)| t.chars().count())
        .max()
        .unwrap_or(0)
        .clamp(1, max.max(1));
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

/// Present-tense activity label for the running tool row ("Executing grep",
/// "Searching"). Completed rows use `tool_finished` / `group_summary`.
/// The subagent name embedded in a `sub-<name>-<seq>` run id (falls back to the
/// raw id when it doesn't match that shape).
fn subagent_name_from_run_id(run_id: &str) -> &str {
    let s = run_id.strip_prefix("sub-").unwrap_or(run_id);
    match s.rfind('-') {
        Some(i) if i + 1 < s.len() && s[i + 1..].bytes().all(|b| b.is_ascii_digit()) => &s[..i],
        _ => s,
    }
}

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
            if cmd.trim().is_empty() {
                "Executing command".to_string()
            } else {
                let collapsed = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
                format!("Executing: {}", truncate(&collapsed, COMMAND_LABEL_MAX))
            }
        }
        "grep" | "search" => "Searching".to_string(),
        "find" | "glob" => "Finding files".to_string(),
        "read" => format!("Reading {}", base(s("path"))),
        "list" | "ls" => "Listing files".to_string(),
        "write" => format!("Writing {}", base(s("path"))),
        "edit" => format!("Editing {}", base(s("path"))),
        "dispatch_subagent" => format!("Dispatching subagent: {}", s("subagent_name")),
        "await_subagent" => format!("Awaiting subagent: {}", subagent_name_from_run_id(s("run_id"))),
        "create_subagent" => format!("Creating subagent: {}", s("name")),
        "list_subagents" => "Listing subagents".to_string(),
        // Skill/memory tools already produce active labels ("Updating memory: X").
        _ => describe_tool_call(name, args),
    }
}

/// Detailed one-line label for a subagent's own tool call, shown in the live
/// panel. Unlike `tool_activity` (deliberately terse for the parent transcript),
/// this keeps the concrete command/path/pattern so consecutive calls are
/// distinguishable ("git log -5" vs "git diff", not two "Executing git" rows).
fn subagent_activity(name: &str, args: &serde_json::Value) -> String {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("");
    match name {
        "bash" | "shell" | "exec" => {
            let cmd = s("command");
            if cmd.trim().is_empty() {
                "command".to_string()
            } else {
                format!("$ {}", cmd.split_whitespace().collect::<Vec<_>>().join(" "))
            }
        }
        "grep" | "search" => format!("grep {}", s("pattern")),
        "find" | "glob" => format!("find {}", s("pattern")),
        "read" => format!("read {}", s("path")),
        "list" | "ls" => format!("ls {}", s("path")),
        "write" => format!("write {}", s("path")),
        "edit" => format!("edit {}", s("path")),
        _ => tool_activity(name, args),
    }
}

/// Past-tense counterpart to `tool_activity` for a finalized single call
/// ("Reading main.rs" -> "Read main.rs"); falls back to `describe_tool_call`.
fn tool_finished(name: &str, args: &serde_json::Value) -> String {
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
            if cmd.trim().is_empty() {
                "Ran command".to_string()
            } else {
                let collapsed = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
                format!("Ran: {}", truncate(&collapsed, COMMAND_LABEL_MAX))
            }
        }
        "grep" | "search" => "Searched".to_string(),
        "find" | "glob" => "Found files".to_string(),
        "read" => format!("Read {}", base(s("path"))),
        "list" | "ls" => "Listed files".to_string(),
        "dispatch_subagent" => format!("Dispatched subagent: {}", s("subagent_name")),
        "await_subagent" => format!("Subagent {} returned", subagent_name_from_run_id(s("run_id"))),
        "create_subagent" => format!("Created subagent: {}", s("name")),
        "list_subagents" => "Listed subagents".to_string(),
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

/// Per-call detail lines for an expanded tool group: each call's finished label
/// with its result summary (and diff, if any) indented under the summary row.
fn group_detail_lines(group: &ToolGroup, width: u16) -> Vec<Line<'static>> {
    let max = width.saturating_sub(8) as usize;
    let mut out = Vec::new();
    for call in &group.calls {
        out.push(Line::from(vec![
            Span::styled("│   ", Style::new().dark_gray()),
            Span::styled("▸ ", Style::new().cyan()),
            Span::styled(call.done.clone(), Style::new().dim()),
        ]));
        if let Some(content) = &call.content {
            let (tag, tag_style) = if call.is_error {
                ("✗", Style::new().red())
            } else {
                ("✓", Style::new().green())
            };
            out.push(Line::from(vec![
                Span::styled("│     ", Style::new().dark_gray()),
                Span::styled(format!("{tag} "), tag_style),
                Span::styled(summarize_result(content, max), Style::new().dim()),
            ]));
            if let Some(diff) = &call.diff {
                for line in diff_lines(diff, max, "│       ") {
                    out.push(line);
                }
            }
        }
    }
    out
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
/// 1 skill" or "Read 20 files; ran 12 commands". Read-style nouns get a "Read"
/// clause and executed nouns a "ran" clause, so the verb always agrees with its
/// noun (never "Ran 1 directory"). Each clause preserves first-seen order.
fn group_summary(nouns: &[(&str, bool)]) -> String {
    group_clauses(nouns, "Read", "ran")
}

/// Present-tense counterpart to `group_summary` for the live, in-progress group
/// row, e.g. "Reading 3 files, 1 directory; running 2 commands". Keeps the row
/// honest about the mix of calls instead of showing the latest call + a count.
fn group_activity(nouns: &[(&str, bool)]) -> String {
    group_clauses(nouns, "Reading", "running")
}

/// Bucket `nouns` into read-style and run-style clauses (first-seen order,
/// counted and pluralized) and join them with the given verbs, so the verb
/// always agrees with its noun (never "Ran 1 directory").
fn group_clauses(nouns: &[(&str, bool)], read_verb: &str, run_verb: &str) -> String {
    let mut read: Vec<(&str, usize)> = Vec::new();
    let mut run: Vec<(&str, usize)> = Vec::new();
    for &(n, is_read) in nouns {
        let bucket = if is_read { &mut read } else { &mut run };
        match bucket.iter_mut().find(|(name, _)| *name == n) {
            Some((_, c)) => *c += 1,
            None => bucket.push((n, 1)),
        }
    }
    let clause = |items: &[(&str, usize)]| {
        items
            .iter()
            .map(|(n, c)| pluralize(n, *c))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut out = String::new();
    if !read.is_empty() {
        out = format!("{read_verb} {}", clause(&read));
    }
    if !run.is_empty() {
        let verb = if out.is_empty() {
            let mut c = run_verb.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        } else {
            format!("; {run_verb}")
        };
        out.push_str(&format!("{verb} {}", clause(&run)));
    }
    out
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

/// True if `buf` contains any answer prose outside `<think>` reasoning. Used to
/// decide when a tool group closes: reasoning streamed between tool calls must
/// not end the run (a reasoning model thinks before every call), only real
/// answer text does.
fn has_answer_text(buf: &str) -> bool {
    split_reasoning(buf)
        .iter()
        .any(|(reasoning, seg)| !reasoning && !seg.trim().is_empty())
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
            lines.extend(reasoning_detail_lines(&seg));
        } else {
            lines.extend(format_markdown_lines(&seg, width));
        }
    }
    lines
}

/// True if `text` has any non-whitespace content in any reasoning/answer run.
fn assistant_has_content(text: &str) -> bool {
    split_reasoning(text)
        .iter()
        .any(|(_, seg)| !seg.trim().is_empty())
}

/// A reasoning block's full dimmed lines (`┊ ` gutter, dim italic body).
fn reasoning_detail_lines(seg: &str) -> Vec<Line<'static>> {
    seg.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            Line::from(vec![
                Span::styled("┊ ", Style::new().dark_gray()),
                Span::styled(l.to_string(), Style::new().dim().italic()),
            ])
        })
        .collect()
}

/// Collapsed summary row for a folded reasoning block.
fn reasoning_summary_row(n: usize) -> Line<'static> {
    let label = if n == 1 {
        "reasoning (1 line)".to_string()
    } else {
        format!("reasoning ({n} lines)")
    };
    Line::from(vec![
        Span::styled("┊ ", Style::new().dark_gray()),
        Span::styled(label, Style::new().dim().italic()),
    ])
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

/// Render answer prose. Fenced code blocks and GitHub pipe tables are rendered
/// ourselves (`render_code_block`/`render_table`) because tui-markdown leaks the
/// ` ``` ` fences as literal text and has no table support; every other block
/// goes through tui-markdown (headings, bold/italic, lists, quotes).
fn format_markdown_lines(text: &str, width: u16) -> Vec<Line<'static>> {
    let src: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let mut prose: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < src.len() {
        if let Some(lang) = src[i].trim_start().strip_prefix("```") {
            flush_prose(&mut prose, &mut out);
            let lang = lang.trim().to_string();
            i += 1;
            let start = i;
            while i < src.len() && !src[i].trim_start().starts_with("```") {
                i += 1;
            }
            out.extend(render_code_block(&src[start..i], &lang, (width as usize).saturating_sub(4)));
            i += usize::from(i < src.len()); // consume closing fence when present
            continue;
        }
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

/// Render a fenced code block as a boxed panel (same frame as `diff_lines`),
/// the language tag (when present) as a dim header row. Content bypasses
/// tui-markdown so code is never reinterpreted as markdown.
fn render_code_block(body: &[&str], lang: &str, max: usize) -> Vec<Line<'static>> {
    let mut rows: Vec<(String, Style)> = Vec::with_capacity(body.len() + 1);
    if !lang.is_empty() {
        rows.push((lang.to_string(), Style::new().dark_gray().italic()));
    }
    for l in body {
        rows.push((truncate(l, max), Style::new()));
    }
    boxed_panel(rows, max, "")
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

/// Await the background router-start task once, then never resolve again (so the
/// select arm stays quiet after the model is ready). `None` -> pends forever.
///
/// The handle is borrowed, not taken: this future is rebuilt (and dropped) every
/// select iteration, so taking it would discard the still-running task the first
/// time another branch wins the race. The slot is cleared only on completion.
async fn await_router(
    task: &mut Option<tokio::task::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    match joined {
        Ok(inner) => inner.map_err(|e| format!("failed to start local model: {e}")),
        Err(e) => Err(format!("router task failed: {e}")),
    }
}

/// Await the background MCP-connect task once, returning the connected server
/// names (empty if none / on task failure). Same cancel-safe borrow as
/// `await_router`: the slot is cleared only on completion.
async fn await_mcp(task: &mut Option<tokio::task::JoinHandle<Vec<String>>>) -> Vec<String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    joined.unwrap_or_default()
}

/// Run one git snapshot (and ref update) off the render loop. Returns the
/// snapshot sha. Only `changed` (the paths touched this turn) are staged, so
/// this stays fast regardless of repo size; the blocking `git` work still runs
/// on a blocking thread so the UI stays responsive.
fn spawn_snapshot(
    repo: PathBuf,
    parent: Option<String>,
    msg: String,
    thread_id: String,
    changed: Vec<PathBuf>,
) -> tokio::task::JoinHandle<Result<String, String>> {
    tokio::task::spawn_blocking(move || {
        let sha = git::snapshot(&repo, parent.as_deref(), &msg, &thread_id, &changed)?;
        git::update_ref(&repo, &thread_id, &sha)?;
        Ok(sha)
    })
}

/// Await the in-flight snapshot task once, clearing the slot. Same cancel-safe
/// borrow as `await_router`; pends forever when idle.
async fn await_snapshot(
    task: &mut Option<tokio::task::JoinHandle<Result<String, String>>>,
) -> Result<String, String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    match joined {
        Ok(inner) => inner,
        Err(e) => Err(format!("snapshot task failed: {e}")),
    }
}

pub async fn run(
    session: AgentSession,
    agent_dir: std::path::PathBuf,
    project_root: PathBuf,
    initial_task: Option<String>,
) -> Result<(), String> {
    let AgentSession {
        args,
        permission_requests,
        model,
        max_turns,
        router_task,
        mcp_servers,
        mcp_task,
    } = session;
    let args = Arc::new(args);

    enable_raw_mode().map_err(|e| e.to_string())?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|e| e.to_string())?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|e| e.to_string())?;

    // A git repo enables workspace snapshots (rewind can restore files); a
    // non-repo runs exactly as before with conversation-only rewind.
    let repo_root = git::repo_root(&project_root);
    let mut app = App::new(model, max_turns, agent_dir, project_root, repo_root);
    let res = chat_loop(
        &mut terminal,
        &args,
        &permission_requests,
        &mut app,
        initial_task,
        router_task,
        mcp_task,
        &mcp_servers,
    )
    .await;

    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    let _ = terminal.show_cursor();
    res
}

#[allow(clippy::too_many_arguments)]
async fn chat_loop<B: Backend>(
    terminal: &mut Terminal<B>,
    args: &Arc<OrchestrationArgs>,
    registry: &PermissionRegistry,
    app: &mut App,
    initial_task: Option<String>,
    mut router_task: Option<tokio::task::JoinHandle<Result<(), String>>>,
    mut mcp_task: Option<tokio::task::JoinHandle<Vec<String>>>,
    mcp_servers: &crate::core::state::SharedMcpServers,
) -> Result<(), String> {
    let mut current: Option<CurrentRun> = None;
    let mut ticker = tokio::time::interval(Duration::from_millis(50));

    // A local model and active MCP servers load in the background; gate the first
    // run on both so the model's tools (collected once per run) are ready.
    let mut router_ready = router_task.is_none();
    let mut mcp_ready = mcp_task.is_none();
    let mut loading_noted = false;

    // Off-loop git snapshotting: one job at a time (checkpoints must stay
    // ordered), driven from the queue `App` fills in submit_user/on_done.
    let mut snap_task: Option<tokio::task::JoinHandle<Result<String, String>>> = None;
    let mut snap_inflight: Option<SnapshotJob> = None;

    match initial_task {
        Some(task) if !task.trim().is_empty() => app.submit_user(task.trim().to_string()),
        _ => app.note("type a message to start, or /help for commands"),
    }

    while !app.should_quit {
        // Drive the snapshot queue: run one job off-loop at a time. A job whose
        // inputs no longer resolve (snapshots disabled) is dropped.
        if snap_task.is_none() {
            while let Some(job) = app.snap_queue.pop_front() {
                if let Some((repo, parent, msg, id, changed)) = app.resolve_snapshot(&job) {
                    snap_task = Some(spawn_snapshot(repo, parent, msg, id, changed));
                    snap_inflight = Some(job);
                    break;
                }
            }
        }

        // Kick off a queued run once the previous one has cleared, the local
        // model (if any) is loaded, and the base snapshot (if any) is captured.
        // `submit_user` already flipped status to Running and reset the counter.
        if app.want_start && current.is_none() {
            let base_ready = app.repo_root.is_none() || app.base_snapshot.is_some();
            if router_ready && mcp_ready && base_ready {
                app.want_start = false;
                current = Some(spawn_run(args, app.body()));
            } else if !loading_noted && (!router_ready || !mcp_ready) {
                // The base snapshot gates silently; only model/MCP loads note.
                loading_noted = true;
                app.note(if !router_ready {
                    "loading local model..."
                } else {
                    "connecting MCP servers..."
                });
            }
        }

        terminal
            .draw(|f| draw(f, app))
            .map_err(|e| e.to_string())?;

        tokio::select! {
            _ = ticker.tick() => {
                // Advance the throbber (~20fps) so awaiting rows animate.
                if !app.awaiting.is_empty() {
                    app.spinner_frame = app.spinner_frame.wrapping_add(1);
                }
                while event::poll(Duration::ZERO).unwrap_or(false) {
                    if let Ok(Event::Key(key)) = event::read() {
                        handle_key(app, key, registry, &mut current, mcp_servers).await;
                    }
                }
            }
            router_res = await_router(&mut router_task) => {
                router_ready = true;
                if let Err(e) = router_res {
                    app.want_start = false;
                    app.on_error(String::new(), e);
                }
            }
            connected = await_mcp(&mut mcp_task) => {
                mcp_ready = true;
                match connected.as_slice() {
                    [] => {}
                    names => app.note(&format!("MCP ready: {}", names.join(", "))),
                }
            }
            snap_res = await_snapshot(&mut snap_task) => {
                match (snap_inflight.take(), snap_res) {
                    (Some(SnapshotJob::Base), Ok(sha)) => {
                        app.base_snapshot = Some(sha);
                        app.persist();
                    }
                    (Some(SnapshotJob::Checkpoint { user_index, preview, .. }), Ok(sha)) => {
                        app.checkpoints.push(Checkpoint { user_index, preview, sha });
                        app.persist();
                    }
                    (Some(SnapshotJob::Base), Err(e)) => {
                        // Base failed: disable snapshots for the session and drop
                        // any queued checkpoints (they have no base to parent).
                        app.note(&format!("workspace snapshots disabled: {e}"));
                        app.repo_root = None;
                        app.snap_queue.clear();
                    }
                    (Some(SnapshotJob::Checkpoint { .. }), Err(e)) => {
                        app.detail = format!("checkpoint failed: {e}");
                    }
                    (None, _) => {}
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
                    // Keep any partial prose/tool calls already streamed.
                    app.pending = None;
                    if app.status == Status::Running {
                        app.flush_assistant();
                        app.finalize_tool_group();
                        app.status = Status::Idle;
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
    mcp_servers: &crate::core::state::SharedMcpServers,
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
                // Only record denials: the tool row that follows an allow
                // already shows the call proceeded, so an "allowed" line is
                // pure noise once granted.
                if matches!(d, PermissionDecision::Deny) {
                    app.push(Line::styled(
                        format!("• denied: {}", pending.summary()),
                        Style::new().red(),
                    ));
                }
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

    // An open picker owns navigation/Enter/Esc. One-shot pickers (thread/model)
    // act and close; the `/mcp` picker toggles the selected row in place.
    if let Some(picker) = app.picker.as_mut() {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                picker.selected = picker.selected.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Char('j') => {
                picker.selected = (picker.selected + 1).min(picker.items.len() - 1);
            }
            KeyCode::Enter if picker.kind == PickerKind::ToggleMcp => {
                let item = &mut picker.items[picker.selected];
                let name = item.value.clone();
                let enable = !item.checkbox.unwrap_or(false);
                item.checkbox = Some(enable);
                toggle_mcp_server(app, mcp_servers, name, enable);
            }
            KeyCode::Enter => {
                let kind = picker.kind;
                let value = picker.items[picker.selected].value.clone();
                app.picker = None;
                match kind {
                    PickerKind::ResumeThread => resume_thread(app, &value),
                    PickerKind::SelectModel => app.set_model(value),
                    PickerKind::ToggleMcp => {}
                    PickerKind::RewindMessage => {
                        if let Ok(idx) = value.parse::<usize>() {
                            open_rewind_scope(app, idx);
                        }
                    }
                    PickerKind::RewindScope => {
                        if let Some(idx) = app.rewind_target.take() {
                            rewind_to(app, idx, value == "workspace");
                        }
                    }
                }
            }
            KeyCode::Esc | KeyCode::Char('q') if !ctrl => {
                app.picker = None;
            }
            _ if ctrl_c => {
                app.picker = None;
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

    // Slash-command hint popup: while typing a `/command` name (idle, no space
    // yet) with at least one match, it owns Up/Down/Tab/Esc and Enter-to-accept.
    // Enter on a fully-typed command falls through to run it; typed chars fall
    // through to normal editing (which re-filters the popup live).
    if !app.slash_matches().is_empty() {
        match key.code {
            KeyCode::Up => {
                app.slash_move(-1);
                return;
            }
            KeyCode::Down => {
                app.slash_move(1);
                return;
            }
            KeyCode::Tab => {
                app.accept_slash();
                return;
            }
            KeyCode::Esc => {
                app.slash_dismissed = true;
                return;
            }
            KeyCode::Enter => {
                let matches = app.slash_matches();
                let sel = app.slash_selected.min(matches.len() - 1);
                if app.input.trim() != matches[sel].name {
                    app.accept_slash();
                    return;
                }
                // Exact match: fall through to the normal Enter path to run it.
            }
            _ => {}
        }
    }

    match key.code {
        KeyCode::Esc => {
            // Esc cancels a run or clears typed input; it never quits (that's
            // Ctrl-D / Ctrl-C when idle), so a stray Esc can't close the app.
            if app.status == Status::Running {
                abort_run(current);
                app.cancel_run();
                app.last_esc = None;
            } else {
                // A second idle Esc within the window opens the rewind picker;
                // a lone Esc clears the input as before.
                let double = app
                    .last_esc
                    .is_some_and(|t| t.elapsed() < Duration::from_millis(600));
                if double {
                    app.last_esc = None;
                    open_rewind_picker(app);
                } else {
                    app.last_esc = Some(Instant::now());
                    app.input_clear();
                }
            }
        }
        // Alt+Enter (or Ctrl+J) inserts a newline for multi-line input; plain
        // Enter submits.
        KeyCode::Enter if app.status == Status::Idle && key.modifiers.contains(KeyModifiers::ALT) => {
            app.input_insert('\n');
        }
        KeyCode::Char('j') if app.status == Status::Idle && ctrl => {
            app.input_insert('\n');
        }
        // Ctrl-O expands/collapses all folded regions (tool groups and reasoning
        // blocks), scrolling the latest into view.
        KeyCode::Char('o') if ctrl => {
            app.toggle_regions();
        }
        KeyCode::Enter => {
            if app.status == Status::Idle {
                let text = app.input.trim().to_string();
                app.input_clear();
                if let Some(cmd) = text.strip_prefix('/') {
                    run_command(app, cmd).await;
                } else if !text.is_empty() {
                    app.submit_user(text);
                }
            }
        }
        KeyCode::Backspace if app.status == Status::Idle => {
            app.input_backspace();
        }
        KeyCode::Delete if app.status == Status::Idle => {
            app.input_delete();
        }
        KeyCode::Left if app.status == Status::Idle => {
            app.cursor_left();
        }
        KeyCode::Right if app.status == Status::Idle => {
            app.cursor_right();
        }
        KeyCode::Home if app.status == Status::Idle => {
            app.cursor = 0;
        }
        KeyCode::End if app.status == Status::Idle => {
            app.cursor = app.input.len();
        }
        KeyCode::Char(c) if app.status == Status::Idle && !ctrl => {
            app.input_insert(c);
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

/// A slash command's name, argument hint, and description. Single source of
/// truth shared by the hint popup and the `/help` listing so they never drift
/// as commands are added or removed.
struct SlashCommand {
    /// Includes the leading slash, e.g. `/resume`.
    name: &'static str,
    /// Argument hint (`[id]`) or empty when the command takes none.
    hint: &'static str,
    description: &'static str,
}

const SLASH_COMMANDS: &[SlashCommand] = &[
    SlashCommand {
        name: "/help",
        hint: "",
        description: "Show available commands",
    },
    SlashCommand {
        name: "/new",
        hint: "",
        description: "Start a new session",
    },
    SlashCommand {
        name: "/clear",
        hint: "",
        description: "Clear the conversation",
    },
    SlashCommand {
        name: "/threads",
        hint: "",
        description: "List saved threads for this project",
    },
    SlashCommand {
        name: "/resume",
        hint: "[id]",
        description: "Resume a thread (bare: pick interactively)",
    },
    SlashCommand {
        name: "/model",
        hint: "[id]",
        description: "Switch model (bare: pick interactively)",
    },
    SlashCommand {
        name: "/mcp",
        hint: "",
        description: "Enable/disable MCP servers",
    },
    SlashCommand {
        name: "/quit",
        hint: "",
        description: "Exit the TUI",
    },
];

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
            app.push(Line::styled("commands:".to_string(), Style::new().dim()));
            for c in SLASH_COMMANDS {
                let sig = if c.hint.is_empty() {
                    c.name.to_string()
                } else {
                    format!("{} {}", c.name, c.hint)
                };
                app.push(Line::styled(
                    format!("  {sig:18} {}", c.description),
                    Style::new().dim(),
                ));
            }
        }
        "clear" => {
            app.reset_session();
            app.note("conversation cleared");
        }
        "new" => {
            app.reset_session();
            app.note("started a new session");
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
        "mcp" => open_mcp_picker(app),
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
                    Some(PickerItem { value: id, label, hint, checkbox: None })
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
            checkbox: None,
        })
        .collect();
    app.picker = Some(Picker {
        kind: PickerKind::SelectModel,
        items,
        selected,
    });
}

/// Open the `/mcp` picker listing configured MCP servers with their enabled
/// state. Enter toggles a row in place (see `toggle_mcp_server`).
fn open_mcp_picker(app: &mut App) {
    let servers = super::mcp::list_servers();
    if servers.is_empty() {
        return app.note("no MCP servers configured (add them in the desktop app or mcp_config.json)");
    }
    let items = servers
        .into_iter()
        .map(|s| PickerItem {
            label: s.name.clone(),
            value: s.name,
            hint: None,
            checkbox: Some(s.active),
        })
        .collect();
    app.picker = Some(Picker {
        kind: PickerKind::ToggleMcp,
        items,
        selected: 0,
    });
}

/// Persist a server's enabled flag and connect/disconnect it in the background
/// (off the render loop, so a cold stdio spawn never freezes the UI). Later
/// turns read the shared map fresh, so tools appear/vanish once the task lands.
fn toggle_mcp_server(
    app: &mut App,
    mcp_servers: &crate::core::state::SharedMcpServers,
    name: String,
    enable: bool,
) {
    if let Err(e) = super::mcp::set_active(&name, enable) {
        app.note(&format!("failed to update mcp_config.json: {e}"));
        return;
    }
    let servers = mcp_servers.clone();
    let task_name = name.clone();
    tokio::spawn(async move {
        if enable {
            let cfg = super::mcp::list_servers()
                .into_iter()
                .find(|s| s.name == task_name)
                .map(|s| s.config);
            if let Some(cfg) = cfg {
                if let Err(e) = super::mcp::connect(&task_name, &cfg, &servers).await {
                    log::warn!("MCP: {e}");
                }
            }
        } else {
            super::mcp::disconnect(&task_name, &servers).await;
        }
    });
    app.note(&if enable {
        format!("enabling MCP server '{name}'...")
    } else {
        format!("disabled MCP server '{name}'")
    });
}

/// Resolve a thread by id (exact or unique prefix), load its messages into the
/// conversation history, and render them into the transcript.
/// Reload workspace-snapshot bookkeeping for a resumed thread from its persisted
/// metadata. Snapshots live in the git object store (kept alive by the thread's
/// ref), so there is nothing on disk to reattach; a later rewind restores them.
fn restore_snapshots(app: &mut App, metadata: Option<&serde_json::Value>) {
    app.base_snapshot = None;
    app.checkpoints.clear();
    app.snap_queue.clear();
    app.base_requested = false;
    let Some(meta) = metadata else { return };
    let Some(base) = meta
        .get("base_snapshot")
        .and_then(|v| v.as_str())
        .map(str::to_string)
    else {
        return;
    };
    app.checkpoints = meta
        .get("checkpoints")
        .and_then(|v| serde_json::from_value::<Vec<Checkpoint>>(v.clone()).ok())
        .unwrap_or_default();
    app.base_snapshot = Some(base);
    // A resumed thread already has its base; don't re-snapshot on next submit.
    app.base_requested = true;
}

/// Open the double-Esc rewind picker listing the conversation's user messages.
fn open_rewind_picker(app: &mut App) {
    let mut items = Vec::new();
    let mut ui = 0usize;
    for m in &app.history {
        if m.get("role").and_then(|v| v.as_str()) == Some("user") {
            let text = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
            items.push(PickerItem {
                value: ui.to_string(),
                label: truncate_preview(text),
                hint: Some(format!("#{}", ui + 1)),
                checkbox: None,
            });
            ui += 1;
        }
    }
    if items.is_empty() {
        return app.note("nothing to rewind to");
    }
    let selected = items.len() - 1;
    app.picker = Some(Picker {
        kind: PickerKind::RewindMessage,
        items,
        selected,
    });
}

/// Second rewind step: choose whether to also reset the isolated workspace. The
/// workspace option is offered only when the session has a worktree.
fn open_rewind_scope(app: &mut App, user_index: usize) {
    app.rewind_target = Some(user_index);
    let mut items = vec![PickerItem {
        value: "conversation".to_string(),
        label: "conversation only".to_string(),
        hint: None,
        checkbox: None,
    }];
    if app.base_snapshot.is_some() {
        items.push(PickerItem {
            value: "workspace".to_string(),
            label: "conversation + workspace".to_string(),
            hint: None,
            checkbox: None,
        });
    }
    app.picker = Some(Picker {
        kind: PickerKind::RewindScope,
        items,
        selected: 0,
    });
}

/// Roll the conversation back to just before the `target`-th user message,
/// dropping it and everything after. When `restore_workspace`, also hard-reset
/// the worktree to the checkpoint that preceded that message (or the base commit).
fn rewind_to(app: &mut App, target: usize, restore_workspace: bool) {
    let mut ui = 0usize;
    let mut cut = None;
    for (i, m) in app.history.iter().enumerate() {
        if m.get("role").and_then(|v| v.as_str()) == Some("user") {
            if ui == target {
                cut = Some(i);
                break;
            }
            ui += 1;
        }
    }
    let Some(cut) = cut else {
        return app.note("rewind target not found");
    };

    if restore_workspace {
        if let (Some(repo), Some(base)) = (app.repo_root.clone(), app.base_snapshot.clone()) {
            // State before the target turn = the newest checkpoint that predates
            // it, else the base snapshot. `latest` (newest snapshot) tells restore
            // which files were added since, so they can be removed.
            let sha = app
                .checkpoints
                .iter()
                .rev()
                .find(|c| c.user_index < target)
                .map(|c| c.sha.clone())
                .unwrap_or(base.clone());
            let latest = app
                .checkpoints
                .last()
                .map(|c| c.sha.clone())
                .unwrap_or(base);
            match git::restore(&repo, &sha, &latest) {
                Ok(()) => app.note("workspace restored"),
                Err(e) => app.note(&format!("workspace restore failed: {e}")),
            }
        }
    }

    app.history.truncate(cut);
    app.checkpoints.retain(|c| c.user_index < target);
    rebuild_transcript(app);
    app.status = Status::Idle;
    app.scrollback = 0;
    app.note(&format!("rewound to message #{}", target + 1));
    app.persist();
}

/// Re-render the transcript from the current `history` after a rewind.
fn rebuild_transcript(app: &mut App) {
    app.transcript.clear();
    app.tool_group = None;
    app.grouped_ids.clear();
    app.groups.clear();
    app.reasoning_blocks.clear();
    app.subagent_blocks.clear();
    app.expanded.clear();
    app.reveal = None;
    app.assistant_buf.clear();
    app.last_kind = Kind::None;
    let history = app.history.clone();
    for m in &history {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let text = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if text.is_empty() {
            continue;
        }
        if role == "user" {
            app.gap(Kind::User);
            app.push(Line::from(vec![
                Span::styled("› ", Style::new().light_magenta().bold()),
                Span::styled(text.to_string(), Style::new().bold()),
            ]));
        } else if role == "assistant" {
            app.push_assistant_blocks(text);
        }
    }
}

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
    app.groups.clear();
    app.reasoning_blocks.clear();
    app.subagent_blocks.clear();
    app.expanded.clear();
    app.reveal = None;
    app.assistant_buf.clear();
    app.turn = (0, 0);
    app.tokens = 0;
    app.scrollback = 0;
    restore_snapshots(app, thread.get("metadata"));

    // Adopt the thread's model so continuation stays coherent.
    if let Some(model) = thread
        .get("model")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
    {
        app.model = model.to_string();
    }

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
            app.push_assistant_blocks(&text);
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

/// Whitespace-collapsed, char-truncated one-liner for checkpoint/rewind labels.
fn truncate_preview(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > 60 {
        let head: String = collapsed.chars().take(57).collect();
        format!("{head}...")
    } else {
        collapsed
    }
}

/// Blank lines to prepend so a transcript shorter than the body viewport pins
/// to the bottom (terminal-chat feel) instead of top-anchoring with a gap
/// below. Zero once the wrapped content fills or overflows `inner_h`, so the
/// scrollback path is left untouched.
fn transcript_top_padding(total: u16, inner_h: u16) -> u16 {
    inner_h.saturating_sub(total)
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

    let mut lines: Vec<Line<'static>> = Vec::with_capacity(app.transcript.len());
    let mut reveal_at: Option<usize> = None;
    for (i, line) in app.transcript.iter().enumerate() {
        if app.reveal == Some(i) {
            reveal_at = Some(lines.len());
        }
        lines.push(line.clone());
        if app.expanded.contains(&i) {
            if let Some(group) = app.groups.iter().find(|g| g.idx == i) {
                lines.extend(group_detail_lines(group, width));
            } else if let Some(block) = app.reasoning_blocks.iter().find(|r| r.idx == i) {
                lines.extend(block.detail.iter().cloned());
            } else if let Some(block) = app.subagent_blocks.iter().find(|b| b.idx == i) {
                lines.extend(block.detail.iter().cloned());
            }
        }
    }
    for (_, name) in &app.awaiting {
        let frame = SPINNER[app.spinner_frame % SPINNER.len()];
        lines.push(Line::from(vec![
            Span::styled(format!("{frame} "), Style::new().cyan()),
            Span::styled(
                format!("Awaiting subagent: {name}"),
                Style::new().cyan().dim(),
            ),
        ]));
    }
    for panel in &app.subagents {
        let last_blank = lines
            .last()
            .map(|l| l.spans.iter().all(|s| s.content.trim().is_empty()))
            .unwrap_or(true);
        if !last_blank {
            lines.push(Line::raw(""));
        }
        // Down-then-left arrow header, then the rolling window (last N calls).
        lines.push(Line::from(vec![
            Span::styled("↲ ", Style::new().magenta()),
            Span::styled(
                format!("subagent: {}", panel.name),
                Style::new().magenta().dim(),
            ),
        ]));
        let start = panel.calls.len().saturating_sub(SUBAGENT_WINDOW);
        for label in &panel.calls[start..] {
            lines.push(Line::from(vec![
                Span::styled("    ", Style::new().dark_gray()),
                Span::styled(label.clone(), Style::new().dim()),
            ]));
        }
    }
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
            // Live tail: same renderer as finalized messages, so an open
            // (unterminated) <think> block dims and grows during streaming.
            lines.extend(tail);
        }
    }
    let block = Block::default().borders(Borders::TOP | Borders::BOTTOM);
    let inner_h = chunks[1].height.saturating_sub(2);

    // Wrapping only grows the line count, so if the unwrapped count already
    // fills the viewport no padding is possible; skip the measuring clone and
    // keep the long-transcript path allocation-free.
    let pad = if (lines.len() as u16) < inner_h {
        let total = Paragraph::new(lines.clone())
            .wrap(Wrap { trim: false })
            .block(block.clone())
            .line_count(width)
            .min(u16::MAX as usize) as u16;
        transcript_top_padding(total, inner_h)
    } else {
        0
    };
    if pad > 0 {
        let mut padded = vec![Line::raw(""); pad as usize];
        padded.append(&mut lines);
        lines = padded;
        reveal_at = reveal_at.map(|n| n + pad as usize);
    }

    // Wrapped-content offset of the row we want scrolled into view, in the same
    // coordinate space as `scroll` (TOP/BOTTOM borders don't affect wrapping).
    let reveal_scroll = reveal_at.map(|n| {
        Paragraph::new(lines[..n].to_vec())
            .wrap(Wrap { trim: false })
            .line_count(width)
            .min(u16::MAX as usize) as u16
    });

    let body = Paragraph::new(lines).wrap(Wrap { trim: false }).block(block);
    let total = body.line_count(width).min(u16::MAX as usize) as u16;
    let max_back = total.saturating_sub(inner_h);
    if let Some(target) = reveal_scroll {
        // Position the region near the top of the viewport; clamps to pinned
        // bottom when it is already close enough to the end.
        app.scrollback = max_back.saturating_sub(target);
    }
    app.reveal = None;
    app.scrollback = app.scrollback.min(max_back);
    let scroll = max_back - app.scrollback;
    f.render_widget(body.scroll((scroll, 0)), chunks[1]);

    // Keep the cursor row visible when the input outgrows the box.
    let input_scroll = if app.status == Status::Idle && app.picker.is_none() {
        let visible = chunks[2].height.saturating_sub(2);
        let total = Paragraph::new(input_content_lines(&app.input, app.cursor))
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
        let detail_rows = 1
            + u16::from(pending.path.is_some() || pending.command.is_some())
            + u16::from(pending.subagent.is_some());
        let diff_rows = pending.diff_preview(chunks[2].width.saturating_sub(2)).len() as u16;
        let height =
            (pending.options().len() as u16 + detail_rows + diff_rows + 2).min(chunks[1].height);
        let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
        let rect = ratatui::layout::Rect {
            x: chunks[2].x,
            y,
            width: chunks[2].width,
            height,
        };
        draw_permission(f, rect, pending);
    } else {
        // Dock the slash-command hints above the input box, growing upward and
        // clamped to the body so they never overrun the transcript. Mutually
        // exclusive with the permission prompt (that only shows while running).
        let matches = app.slash_matches();
        if !matches.is_empty() {
            let height = (matches.len() as u16 + 2).min(chunks[1].height);
            let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
            let rect = ratatui::layout::Rect {
                x: chunks[2].x,
                y,
                width: chunks[2].width,
                height,
            };
            draw_slash_hints(f, rect, &matches, app.slash_selected);
        }
    }
}

/// Slash-command hint popup: one row per match (`/name [hint]  description`),
/// the highlighted row reversed. Docked above the input box.
fn draw_slash_hints(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    matches: &[&SlashCommand],
    selected: usize,
) {
    use ratatui::widgets::{Clear, List, ListItem, ListState};

    let dim = Style::new().dark_gray();
    let items: Vec<ListItem> = matches
        .iter()
        .map(|c| {
            let mut spans = vec![Span::styled(c.name, Style::new().cyan().bold())];
            if !c.hint.is_empty() {
                spans.push(Span::styled(format!(" {}", c.hint), dim));
            }
            spans.push(Span::styled(format!("  {}", c.description), dim));
            ListItem::new(Line::from(spans))
        })
        .collect();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().dark_gray())
        .title(Span::styled(" commands ", Style::new().dim()));
    f.render_widget(Clear, area);
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::new().reversed())
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(selected.min(matches.len().saturating_sub(1))));
    f.render_stateful_widget(list, area, &mut state);
}

/// Permission prompt docked above the input: names the tool, capability, and
/// target path, then an arrow-navigable option list (Enter confirms the
/// highlighted choice; `y`/`a`/`n` still work as shortcuts).
fn draw_permission(f: &mut Frame, area: ratatui::layout::Rect, pending: &Pending) {
    use ratatui::widgets::{Clear, List, ListItem, ListState};

    let dim = Style::new().dark_gray();
    let mut detail = Vec::new();
    if let Some(name) = &pending.subagent {
        detail.push(Line::from(vec![
            Span::styled("subagent ", dim),
            Span::styled(name.clone(), Style::new().magenta().bold()),
            Span::styled(" is asking:", dim),
        ]));
    }
    detail.push(Line::from(vec![
        Span::styled(pending.tool_name.clone(), Style::new().cyan().bold()),
        Span::styled(" wants ", dim),
        Span::styled(pending.capability.clone(), Style::new().yellow().bold()),
    ]));
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

    let diff = pending.diff_preview(inner.width);
    let rows = Layout::vertical([
        Constraint::Length(detail.len() as u16),
        Constraint::Min(diff.len() as u16),
        Constraint::Length(pending.options().len() as u16),
    ])
    .split(inner);
    f.render_widget(Paragraph::new(detail).wrap(Wrap { trim: false }), rows[0]);
    if !diff.is_empty() {
        f.render_widget(Paragraph::new(diff), rows[1]);
    }

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
    f.render_stateful_widget(list, rows[2], &mut state);
}

fn draw_picker(f: &mut Frame, area: ratatui::layout::Rect, picker: &Picker) {
    use ratatui::widgets::{List, ListItem, ListState};

    let items: Vec<ListItem> = picker
        .items
        .iter()
        .map(|it| {
            let mut spans = Vec::new();
            if let Some(on) = it.checkbox {
                let (mark, style) = if on {
                    ("[x] ", Style::new().green())
                } else {
                    ("[ ] ", Style::new().dark_gray())
                };
                spans.push(Span::styled(mark, style));
            }
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
    let turn = match app.turn {
        (0, _) => String::new(),
        (n, 0) => format!("turn {n}  "),
        (n, m) => format!("turn {n}/{m}  "),
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
        let rows = Paragraph::new(input_content_lines(&app.input, app.cursor))
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
/// continuations, caret `▏` at the byte offset `cursor` (on the line that
/// contains it). Wrapping is left to the Paragraph so long single lines fold
/// within the box width.
fn input_content_lines(input: &str, cursor: usize) -> Vec<Line<'static>> {
    let arrow = Span::styled("› ", Style::new().cyan().bold());
    let segments: Vec<&str> = input.split('\n').collect();
    let last = segments.len() - 1;
    // Locate the segment + in-segment byte offset holding the caret.
    let (mut caret_seg, mut caret_off) = (last, segments[last].len());
    let mut acc = 0usize;
    for (i, seg) in segments.iter().enumerate() {
        let seg_end = acc + seg.len();
        if cursor <= seg_end {
            caret_seg = i;
            caret_off = cursor - acc;
            break;
        }
        acc = seg_end + 1; // skip the '\n'
    }
    segments
        .into_iter()
        .enumerate()
        .map(|(i, seg)| {
            let prefix = if i == 0 {
                arrow.clone()
            } else {
                Span::raw("  ")
            };
            let text = if i == caret_seg {
                let (a, b) = seg.split_at(caret_off);
                format!("{a}▏{b}")
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
        Paragraph::new(input_content_lines(&app.input, app.cursor))
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
        Status::Running => "Esc/Ctrl-C cancel   ↑/↓ scroll   Ctrl-O expand all",
        Status::Idle => "Enter send   Alt+Enter newline   /help   ↑/↓ scroll   Ctrl-O expand all   Ctrl-D quit",
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
        diff_lines, group_activity, group_detail_lines, group_summary, input_content_lines,
        is_table_separator, message_text,
        parse_command, render_table, run_command, split_reasoning, subagent_activity,
        subagent_name_from_run_id, summarize_result, tool_activity, tool_finished,
        transcript_top_padding, App, Pending, SnapshotJob, DIFF_MAX_ROWS,
    };
    use ratatui::{style::Modifier, text::Line};
    use crate::core::agent::events::StreamEvent;
    use crate::core::agent::tools::gate::PermissionDecision;
    use serde_json::json;

    fn test_app() -> App {
        // Persist into a unique temp dir so tests that save threads never
        // dirty the working tree (src-tauri/threads/).
        let agent_dir = std::env::temp_dir().join(format!(
            "jan_tui_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        App::new("m".into(), 8, agent_dir, std::path::PathBuf::from("/tmp/repo"), None)
    }

    fn pending(offers_always: bool) -> Pending {
        Pending {
            request_id: "r".into(),
            tool_name: "bash".into(),
            capability: "execute".into(),
            path: None,
            command: Some("git status".into()),
            diff: None,
            offers_always,
            selected: 0,
            subagent: None,
        }
    }

    #[test]
    fn transcript_bottom_anchors_short_content() {
        // Short transcript: pad to push the last line to the viewport bottom.
        assert_eq!(transcript_top_padding(3, 20), 17);
        // Exactly full: no padding.
        assert_eq!(transcript_top_padding(20, 20), 0);
        // Overflowing viewport: no padding, scrollback path stays untouched.
        assert_eq!(transcript_top_padding(45, 20), 0);
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
    fn write_permission_prompt_carries_diff_into_pending() {
        let mut app = test_app();
        app.apply(StreamEvent::PermissionRequest {
            request_id: "w1".into(),
            tool_name: "write".into(),
            capability: "write".into(),
            path: Some("out.txt".into()),
            command: None,
            diff: Some("@@ created file @@\n+ hi".into()),
            prompt_kind: "write".into(),
            offers_always: true,
        });
        let p = app.pending.as_ref().unwrap();
        assert_eq!(p.diff.as_deref(), Some("@@ created file @@\n+ hi"));
        let preview = p.diff_preview(60);
        assert!(preview.len() >= 4, "boxed diff expected, got {preview:?}");
        let text: String = preview.iter().map(line_text).collect();
        assert!(text.contains('┌') && text.contains('┘'), "no box frame: {text}");
        assert!(text.contains("+ hi"), "diff content missing: {text}");
    }

    #[test]
    fn exec_permission_prompt_has_no_diff_preview() {
        let mut app = test_app();
        app.apply(StreamEvent::PermissionRequest {
            request_id: "e1".into(),
            tool_name: "bash".into(),
            capability: "exec".into(),
            path: None,
            command: Some("ls".into()),
            diff: None,
            prompt_kind: "exec".into(),
            offers_always: true,
        });
        assert!(app.pending.as_ref().unwrap().diff_preview(60).is_empty());
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
    fn live_tail_dims_open_think_block_instead_of_stripping() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.assistant_buf = "<think>pondering the answer".to_string();
        let mut terminal = Terminal::new(TestBackend::new(60, 30)).unwrap();
        terminal.draw(|f| super::draw(f, &mut app)).unwrap();
        let buf = terminal.backend().buffer().clone();

        let mut found_dim = false;
        for y in 0..buf.area.height {
            let row: String = (0..buf.area.width).map(|x| buf[(x, y)].symbol()).collect();
            if row.contains("pondering") {
                let x = row.find("pondering").unwrap() as u16;
                assert!(
                    buf[(x, y)].style().add_modifier.contains(Modifier::DIM),
                    "open <think> content must render dimmed while streaming"
                );
                found_dim = true;
            }
        }
        assert!(found_dim, "open <think> content must still appear in the live tail");
    }

    #[test]
    fn expanded_reasoning_renders_full_detail_in_draw() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.submit_user("hi".to_string());
        app.apply(StreamEvent::Token {
            text: "<think>secret plan line</think>Answer.".into(),
        });
        app.on_done("stop".into(), None);
        assert_eq!(app.reasoning_blocks.len(), 1);

        let render = |app: &mut App| {
            let mut terminal = Terminal::new(TestBackend::new(60, 30)).unwrap();
            terminal.draw(|f| super::draw(f, app)).unwrap();
            let buf = terminal.backend().buffer().clone();
            (0..buf.area.height)
                .map(|y| {
                    (0..buf.area.width)
                        .map(|x| buf[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        let collapsed = render(&mut app);
        assert!(!collapsed.contains("secret plan line"), "collapsed: {collapsed}");
        assert!(collapsed.contains("reasoning (1 line)"));

        app.toggle_regions();
        let expanded = render(&mut app);
        assert!(
            expanded.contains("secret plan line"),
            "expanded draw must reveal the reasoning: {expanded}"
        );
    }

    #[test]
    fn expanding_offscreen_region_scrolls_it_into_view() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.submit_user("hi".to_string());
        // Reasoning near the top, then a long answer that fills past a short
        // viewport so the folded row is off-screen when pinned to the bottom.
        app.apply(StreamEvent::Token {
            text: "<think>hidden rationale</think>".into(),
        });
        for i in 0..40 {
            app.apply(StreamEvent::Token {
                text: format!("answer line {i}\n"),
            });
        }
        app.on_done("stop".into(), None);
        assert_eq!(app.reasoning_blocks.len(), 1);

        let render = |app: &mut App| {
            let mut terminal = Terminal::new(TestBackend::new(60, 12)).unwrap();
            terminal.draw(|f| super::draw(f, app)).unwrap();
            let buf = terminal.backend().buffer().clone();
            (0..buf.area.height)
                .map(|y| {
                    (0..buf.area.width)
                        .map(|x| buf[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        // Pinned to the bottom: the folded reasoning row is not on screen.
        assert!(!render(&mut app).contains("reasoning (1 line)"));

        // Expanding scrolls the region into view so its detail is visible.
        app.toggle_regions();
        let expanded = render(&mut app);
        assert!(
            expanded.contains("hidden rationale"),
            "expanded region must be scrolled into view: {expanded}"
        );
    }

    #[test]
    fn toggle_expands_and_collapses_all_regions_at_once() {
        let mut app = test_app();
        // Two reasoning blocks and two tool groups interleaved across turns.
        app.apply(StreamEvent::Token { text: "<think>a</think>".into() });
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "ls" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        app.apply(StreamEvent::Token { text: "<think>b</think>".into() });
        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "bash".into(),
            args: json!({ "command": "pwd" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c2".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        app.on_done("stop".into(), None);
        assert_eq!(app.reasoning_blocks.len(), 2);
        assert_eq!(app.groups.len(), 2);

        // One toggle expands every region.
        app.toggle_regions();
        let all: std::collections::HashSet<usize> = app
            .groups
            .iter()
            .map(|g| g.idx)
            .chain(app.reasoning_blocks.iter().map(|r| r.idx))
            .collect();
        assert_eq!(app.expanded, all);

        // A second toggle collapses them all.
        app.toggle_regions();
        assert!(app.expanded.is_empty());
    }

    #[test]
    fn long_user_prompt_wraps_in_transcript() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        let msg = "Check why in this project, for some models like Gemma 4 12b, \
                   the cache is never stored and it starts reprocessing the prompt \
                   from the beginning on every turn";
        app.submit_user(msg.to_string());
        let mut terminal = Terminal::new(TestBackend::new(60, 30)).unwrap();
        terminal.draw(|f| super::draw(f, &mut app)).unwrap();
        let buf = terminal.backend().buffer().clone();
        let rows: Vec<String> = (0..buf.area.height)
            .map(|y| {
                (0..buf.area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect();
        // The last word must survive on a wrapped continuation row.
        assert!(
            rows.iter().any(|r| r.contains("beginning")),
            "user prompt truncated instead of wrapping:\n{}",
            rows.join("\n")
        );

        // And it must re-wrap after the terminal shrinks (resize mid-session).
        terminal.backend_mut().resize(40, 30);
        terminal.draw(|f| super::draw(f, &mut app)).unwrap();
        let buf = terminal.backend().buffer().clone();
        let rows: Vec<String> = (0..buf.area.height)
            .map(|y| {
                (0..buf.area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect();
        assert!(
            rows.iter().any(|r| r.contains("beginning")),
            "user prompt truncated after resize:\n{}",
            rows.join("\n")
        );
    }

    #[test]
    fn group_summary_counts_and_pluralizes() {
        assert_eq!(
            group_summary(&[("memory note", true), ("skill", true), ("memory note", true)]),
            "Read 2 memory notes, 1 skill"
        );
        assert_eq!(
            group_summary(&[("command", false), ("search", false), ("search", false)]),
            "Ran 1 command, 2 searches"
        );
        assert_eq!(
            group_summary(&[("directory", true), ("directory", true)]),
            "Read 2 directories"
        );
    }

    #[test]
    fn group_summary_splits_read_and_run_clauses() {
        // Mixed ops keep the verb agreeing with its noun: never "Ran 1 directory".
        assert_eq!(
            group_summary(&[
                ("directory", true),
                ("search", false),
                ("file", true),
                ("command", false),
            ]),
            "Read 1 directory, 1 file; ran 1 search, 1 command"
        );
    }

    #[test]
    fn group_activity_is_present_tense_running_breakdown() {
        assert_eq!(
            group_activity(&[("file", true), ("file", true), ("command", false)]),
            "Reading 2 files; running 1 command"
        );
        assert_eq!(
            group_activity(&[("search", false), ("search", false)]),
            "Running 2 searches"
        );
        assert_eq!(
            group_activity(&[("file", true), ("directory", true)]),
            "Reading 1 file, 1 directory"
        );
    }

    #[test]
    fn tool_activity_is_concise_present_tense() {
        assert_eq!(
            tool_activity("bash", &json!({ "command": "/usr/bin/grep -n foo src/" })),
            "Executing: /usr/bin/grep -n foo src/"
        );
        assert_eq!(
            tool_activity("bash", &json!({ "command": "cargo test" })),
            "Executing: cargo test"
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

    #[test]
    fn tool_finished_is_concise_past_tense() {
        assert_eq!(
            tool_finished("bash", &json!({ "command": "/usr/bin/grep -n foo src/" })),
            "Ran: /usr/bin/grep -n foo src/"
        );
        assert_eq!(tool_finished("grep", &json!({ "pattern": "foo" })), "Searched");
        assert_eq!(
            tool_finished("read", &json!({ "path": "src/main.rs" })),
            "Read main.rs"
        );
        assert_eq!(tool_finished("list", &json!({})), "Listed files");
    }

    fn line_text(line: &ratatui::text::Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[test]
    fn base_snapshot_is_queued_off_loop_not_run_inline() {
        let mut app = test_app();
        app.repo_root = Some(std::path::PathBuf::from("/tmp/repo"));
        app.submit_user("hi".into());
        // Queued for the loop to run off-thread; NOT captured synchronously here.
        assert!(app.base_requested);
        assert!(app.thread_id.is_some());
        assert!(app.base_snapshot.is_none(), "no inline git on the render thread");
        assert_eq!(app.snap_queue.len(), 1);
        assert!(matches!(app.snap_queue.front(), Some(SnapshotJob::Base)));
        // Idempotent: a second submit does not re-queue the base.
        app.submit_user("again".into());
        assert_eq!(
            app.snap_queue
                .iter()
                .filter(|j| matches!(j, SnapshotJob::Base))
                .count(),
            1
        );
    }

    #[test]
    fn checkpoint_is_queued_only_after_base_armed() {
        let mut app = test_app();
        app.repo_root = Some(std::path::PathBuf::from("/tmp/repo"));
        app.thread_id = Some("t1".into());
        app.history.push(json!({ "role": "user", "content": "do it" }));
        // No base armed yet -> no checkpoint.
        app.checkpoint_turn();
        assert!(app.snap_queue.is_empty());
        app.base_requested = true;
        app.checkpoint_turn();
        match app.snap_queue.front() {
            Some(SnapshotJob::Checkpoint { user_index, preview, .. }) => {
                assert_eq!(*user_index, 0);
                assert_eq!(preview, "do it");
            }
            other => panic!("expected a checkpoint job, got {:?}", other.is_some()),
        }
    }

    #[test]
    fn resolve_snapshot_builds_git_inputs() {
        let mut app = test_app();
        app.repo_root = Some(std::path::PathBuf::from("/tmp/repo"));
        app.thread_id = Some("t1".into());
        let (_, parent, msg, id, changed) = app.resolve_snapshot(&SnapshotJob::Base).unwrap();
        assert!(parent.is_none());
        assert_eq!(msg, "jan agent base");
        assert_eq!(id, "t1");
        assert!(changed.is_empty());

        app.base_snapshot = Some("basesha".into());
        let job = SnapshotJob::Checkpoint {
            user_index: 0,
            preview: "x".into(),
            changed: vec![std::path::PathBuf::from("/tmp/repo/src/a.rs")],
        };
        let (_, parent, msg, _, changed) = app.resolve_snapshot(&job).unwrap();
        assert_eq!(parent.as_deref(), Some("basesha"), "first checkpoint parents the base");
        assert_eq!(msg, "jan agent turn 1");
        assert_eq!(changed, vec![std::path::PathBuf::from("src/a.rs")]);

        // Disabled (no repo) -> job dropped.
        app.repo_root = None;
        assert!(app.resolve_snapshot(&SnapshotJob::Base).is_none());
    }

    #[test]
    fn subagent_tool_rows_have_readable_labels() {
        let dispatch = json!({ "subagent_name": "reviewer", "description": "x" });
        assert_eq!(tool_activity("dispatch_subagent", &dispatch), "Dispatching subagent: reviewer");
        assert_eq!(tool_finished("dispatch_subagent", &dispatch), "Dispatched subagent: reviewer");
        let await_args = json!({ "run_id": "sub-sycl-cuda-gap-explorer-1" });
        assert_eq!(
            tool_activity("await_subagent", &await_args),
            "Awaiting subagent: sycl-cuda-gap-explorer"
        );
        assert_eq!(tool_activity("list_subagents", &json!({})), "Listing subagents");
        assert_eq!(tool_activity("create_subagent", &json!({"name": "r"})), "Creating subagent: r");
    }

    #[test]
    fn subagent_name_from_run_id_strips_prefix_and_seq() {
        assert_eq!(subagent_name_from_run_id("sub-reviewer-3"), "reviewer");
        assert_eq!(subagent_name_from_run_id("sub-a-b-c-12"), "a-b-c");
        // Non-conforming ids pass through.
        assert_eq!(subagent_name_from_run_id("weird"), "weird");
    }

    #[test]
    fn subagent_panel_labels_keep_command_detail() {
        // The panel must distinguish consecutive bash calls, not collapse to
        // "Executing git".
        assert_eq!(
            subagent_activity("bash", &json!({ "command": "git log --oneline -5" })),
            "$ git log --oneline -5"
        );
        assert_eq!(
            subagent_activity("bash", &json!({ "command": "git diff" })),
            "$ git diff"
        );
        assert_eq!(
            subagent_activity("read", &json!({ "path": "src/main.rs" })),
            "read src/main.rs"
        );
        assert_eq!(
            subagent_activity("grep", &json!({ "pattern": "TODO" })),
            "grep TODO"
        );
    }

    #[test]
    fn await_subagent_shows_throbber_until_result() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "a1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "sub-reviewer-1" }),
        });
        // Tracked as an awaiting throbber (not folded into a tool group row).
        assert_eq!(app.awaiting.len(), 1);
        assert_eq!(app.awaiting[0], ("a1".to_string(), "reviewer".to_string()));
        assert!(app.tool_group.is_none(), "await must not open a tool group");
        // The result clears the throbber.
        app.apply(StreamEvent::ToolResult {
            id: "a1".into(),
            content: "the subagent's answer".into(),
            is_error: false,
            diff: None,
        });
        assert!(app.awaiting.is_empty());
    }

    fn wrap(run_id: &str, name: &str, event: StreamEvent) -> StreamEvent {
        StreamEvent::Subagent {
            run_id: run_id.into(),
            name: name.into(),
            event: Box::new(event),
        }
    }

    #[test]
    fn subagent_calls_fill_rolling_panel_capped_at_window() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        // Seven calls; only the last SUBAGENT_WINDOW remain visible.
        for i in 0..7 {
            app.apply(wrap(
                "r1",
                "reviewer",
                StreamEvent::ToolCall {
                    id: format!("c{i}"),
                    name: "bash".into(),
                    args: json!({ "command": format!("cmd{i}") }),
                },
            ));
            // Results are internal to the subagent and must not surface.
            app.apply(wrap(
                "r1",
                "reviewer",
                StreamEvent::ToolResult {
                    id: format!("c{i}"),
                    content: "ok".into(),
                    is_error: false,
                    diff: None,
                },
            ));
        }
        let panel = app.subagents.iter().find(|p| p.run_id == "r1").expect("active");
        // Full history retained (for later expansion); the window is a render concern.
        assert_eq!(panel.calls.len(), 7);
        assert!(panel.calls.first().unwrap().contains("cmd0"));
        assert!(panel.calls.last().unwrap().contains("cmd6"));
        // The live panel renders only the last SUBAGENT_WINDOW calls.
        use ratatui::{backend::TestBackend, Terminal};
        let render = |app: &mut App| {
            let mut terminal = Terminal::new(TestBackend::new(80, 30)).unwrap();
            terminal.draw(|f| super::draw(f, app)).unwrap();
            let buf = terminal.backend().buffer().clone();
            (0..buf.area.height)
                .map(|y| (0..buf.area.width).map(|x| buf[(x, y)].symbol()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n")
        };
        let out = render(&mut app);
        assert!(out.contains("cmd6") && out.contains("cmd2"), "window tail shown");
        assert!(!out.contains("cmd0") && !out.contains("cmd1"), "oldest scrolled out: {out}");
    }

    #[test]
    fn concurrent_subagents_track_independent_panels() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "alpha".into(),
        });
        app.apply(StreamEvent::SubagentStart {
            run_id: "r2".into(),
            name: "beta".into(),
        });
        app.apply(wrap(
            "r2",
            "beta",
            StreamEvent::ToolCall {
                id: "c0".into(),
                name: "bash".into(),
                args: json!({ "command": "beta-cmd" }),
            },
        ));
        assert_eq!(app.subagents.len(), 2);
        let alpha = app.subagents.iter().find(|p| p.run_id == "r1").unwrap();
        let beta = app.subagents.iter().find(|p| p.run_id == "r2").unwrap();
        assert_eq!(alpha.calls.len(), 0, "beta's call must not land on alpha");
        assert_eq!(beta.calls.len(), 1);
        assert!(beta.calls.last().unwrap().contains("beta-cmd"));
    }

    #[test]
    fn finished_subagent_summary_expands_full_call_list_via_ctrl_o() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        // More calls than the live window, so expansion reveals ones it hid.
        for i in 0..7 {
            app.apply(wrap(
                "r1",
                "reviewer",
                StreamEvent::ToolCall {
                    id: format!("c{i}"),
                    name: "bash".into(),
                    args: json!({ "command": format!("cmd{i}") }),
                },
            ));
        }
        app.apply(StreamEvent::SubagentEnd {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        // A collapsed summary row + a retained expandable block.
        assert_eq!(app.subagent_blocks.len(), 1);
        let idx = app.subagent_blocks[0].idx;

        use ratatui::{backend::TestBackend, Terminal};
        let render = |app: &mut App| {
            let mut terminal = Terminal::new(TestBackend::new(80, 40)).unwrap();
            terminal.draw(|f| super::draw(f, app)).unwrap();
            let buf = terminal.backend().buffer().clone();
            (0..buf.area.height)
                .map(|y| (0..buf.area.width).map(|x| buf[(x, y)].symbol()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n")
        };
        // Collapsed: full list (e.g. the oldest call) is hidden.
        assert!(!render(&mut app).contains("cmd0"));
        // Ctrl-O expand-all reveals every call, including ones outside the window.
        app.toggle_regions();
        assert!(app.expanded.contains(&idx));
        let expanded = render(&mut app);
        assert!(expanded.contains("cmd0"), "expanded must reveal earliest call: {expanded}");
        assert!(expanded.contains("cmd6"));
        // Toggling again collapses it.
        app.toggle_regions();
        assert!(!app.expanded.contains(&idx));
    }

    #[test]
    fn subagent_end_commits_summary_and_clears_only_that_panel() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        app.apply(wrap(
            "r1",
            "reviewer",
            StreamEvent::ToolCall {
                id: "c0".into(),
                name: "bash".into(),
                args: json!({ "command": "ls" }),
            },
        ));
        app.apply(StreamEvent::SubagentEnd {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        assert!(app.subagents.iter().all(|p| p.run_id != "r1"));
        assert!(app
            .transcript
            .iter()
            .any(|l| line_text(l).contains("subagent reviewer finished (1 tool call)")));
    }

    #[test]
    fn parent_tokens_still_render_while_subagent_active() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        // A wrapped child token is internal and dropped.
        app.apply(wrap(
            "r1",
            "reviewer",
            StreamEvent::Token {
                text: "child prose".into(),
            },
        ));
        assert!(app.assistant_buf.is_empty());
        // The parent's own token still streams even with a child active.
        app.apply(StreamEvent::Token {
            text: "parent prose".into(),
        });
        assert_eq!(app.assistant_buf, "parent prose");
    }

    #[test]
    fn permission_inside_subagent_attributes_the_asking_subagent() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
        });
        app.apply(wrap(
            "r1",
            "reviewer",
            StreamEvent::PermissionRequest {
                request_id: "p1".into(),
                tool_name: "bash".into(),
                capability: "exec".into(),
                path: None,
                command: Some("cargo test".into()),
                diff: None,
                prompt_kind: "exec".into(),
                offers_always: true,
            },
        ));
        assert_eq!(
            app.pending.as_ref().and_then(|p| p.subagent.as_deref()),
            Some("reviewer")
        );
    }

    #[test]
    fn input_lines_single_line_has_arrow_and_cursor() {
        let lines = input_content_lines("hello", 5);
        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "› hello▏");
    }

    #[test]
    fn input_lines_multiline_hangs_and_cursor_on_last() {
        let lines = input_content_lines("one\ntwo\nthree", "one\ntwo\nthree".len());
        assert_eq!(lines.len(), 3);
        assert_eq!(line_text(&lines[0]), "› one");
        assert_eq!(line_text(&lines[1]), "  two");
        assert_eq!(line_text(&lines[2]), "  three▏");
    }

    #[test]
    fn input_lines_trailing_newline_gives_empty_cursor_row() {
        let lines = input_content_lines("hi\n", 3);
        assert_eq!(lines.len(), 2);
        assert_eq!(line_text(&lines[0]), "› hi");
        assert_eq!(line_text(&lines[1]), "  ▏");
    }

    #[test]
    fn input_lines_caret_renders_mid_string() {
        // Caret sits between "he" and "llo" on a single line.
        let lines = input_content_lines("hello", 2);
        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "› he▏llo");
    }

    #[test]
    fn input_lines_caret_on_earlier_line_only() {
        // Cursor inside the first segment: caret there, none on later lines.
        let lines = input_content_lines("one\ntwo", 1);
        assert_eq!(line_text(&lines[0]), "› o▏ne");
        assert_eq!(line_text(&lines[1]), "  two");
    }

    #[test]
    fn input_editing_moves_and_deletes_at_caret() {
        let mut app = test_app();
        for c in "abc".chars() {
            app.input_insert(c);
        }
        assert_eq!((app.input.as_str(), app.cursor), ("abc", 3));
        app.cursor_left();
        app.cursor_left();
        app.input_insert('X'); // insert between a and b
        assert_eq!((app.input.as_str(), app.cursor), ("aXbc", 2));
        app.input_backspace(); // delete X
        assert_eq!((app.input.as_str(), app.cursor), ("abc", 1));
        app.input_delete(); // delete b at caret
        assert_eq!((app.input.as_str(), app.cursor), ("ac", 1));
        app.cursor = app.input.len();
        app.cursor_right(); // clamp at end
        assert_eq!(app.cursor, 2);
    }

    #[test]
    fn diff_lines_renders_all_when_under_cap() {
        let out = diff_lines("- foo\n+ bar", 80, "│     ");
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
        let out = diff_lines(&diff, 80, "│     ");
        // DIFF_MAX_ROWS content rows + a `(+N more)` row, framed by 2 borders.
        assert_eq!(out.len(), DIFF_MAX_ROWS + 1 + 2);
        // The tail sits just above the closing border.
        let tail = line_text(&out[out.len() - 2]);
        assert!(tail.contains("(+10 more)"), "tail: {tail}");
    }

    #[test]
    fn cancel_keeps_streamed_prose_and_tool_calls() {
        let mut app = test_app();
        app.submit_user("do a thing".into());
        // Model calls a tool, then streams a partial answer.
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "grep -n foo src/" }),
        });
        app.apply(StreamEvent::Token {
            text: "Here is what I found so far".into(),
        });
        app.cancel_run();
        let body: Vec<String> = app.transcript.iter().map(line_text).collect();
        let joined = body.join("\n");
        assert!(
            joined.contains("Here is what I found so far"),
            "streamed prose vanished on cancel:\n{joined}"
        );
        assert!(
            joined.contains("grep"),
            "tool call vanished on cancel:\n{joined}"
        );
        assert!(joined.contains("cancelled"), "no cancel marker:\n{joined}");
        assert!(app.assistant_buf.is_empty());
        // The partial answer is recorded in history for the next turn / resume.
        let last = app.history.last().expect("history entry");
        assert_eq!(last["role"], "assistant");
        assert!(
            last["content"]
                .as_str()
                .unwrap_or_default()
                .contains("Here is what I found so far"),
            "partial answer not in history: {last}"
        );
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
        assert!(running.contains("▸ Executing: grep"), "running: {running}");
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
        assert!(row.contains("✓") && row.contains("Ran: grep"), "row: {row}");
        assert!(!row.contains("lines"), "row: {row}");
        assert!(app.tool_group.is_none());
    }

    #[test]
    fn first_streamed_token_finalizes_open_tool_group() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "grep -n foo src/" }),
        });
        assert!(app.tool_group.is_some());
        // Prose begins streaming in the same turn (no intervening Step): the
        // group's status must land in the timeline as `✓` right away.
        app.apply(StreamEvent::Token { text: "Here".into() });
        assert!(app.tool_group.is_none());
        let row = app
            .transcript
            .iter()
            .rev()
            .map(line_text)
            .find(|t| t.contains("Ran: grep"))
            .unwrap();
        assert!(row.contains("✓"), "row: {row}");
        // Later tokens must not re-trigger finalize work.
        app.apply(StreamEvent::Token { text: " goes".into() });
        assert!(app.tool_group.is_none());
    }

    #[test]
    fn pre_tool_prose_lands_above_the_tool_row() {
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "Let me check the README.".into(),
        });
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "grep -n foo src/" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        app.apply(StreamEvent::Token {
            text: "Found it.".into(),
        });
        app.apply(StreamEvent::Step { index: 2, max: 8 });
        let rows: Vec<String> = app.transcript.iter().map(line_text).collect();
        let prose = rows.iter().position(|r| r.contains("check the README")).unwrap();
        let tool = rows.iter().position(|r| r.contains("Ran: grep")).unwrap();
        let after = rows.iter().position(|r| r.contains("Found it")).unwrap();
        assert!(prose < tool && tool < after, "rows: {rows:?}");
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
        // The live row is an honest present-tense breakdown, not "<latest> (4)".
        assert!(line_text(app.transcript.last().unwrap())
            .contains("Reading 3 memory notes, 1 skill"));
        // The model speaking finalizes it to a short summary sentence.
        app.apply(StreamEvent::Token { text: "Done.".into() });
        let row = line_text(app.transcript.last().unwrap());
        assert!(row.contains("✓ Read 3 memory notes, 1 skill"), "row: {row}");
    }

    #[test]
    fn folded_group_expands_and_collapses_via_keybinding() {
        let mut app = test_app();
        let calls = [
            ("c1", "memory_read", json!({ "name": "project-overview" })),
            ("c2", "memory_read", json!({ "name": "top-p" })),
        ];
        for (id, name, args) in calls {
            app.apply(StreamEvent::ToolCall {
                id: id.into(),
                name: name.into(),
                args,
            });
            app.apply(StreamEvent::ToolResult {
                id: id.into(),
                content: format!("result for {id}"),
                is_error: false,
                diff: None,
            });
        }
        app.apply(StreamEvent::Token { text: "Done.".into() });
        assert_eq!(app.groups.len(), 1);

        // Collapsed by default: draw injects no per-call detail.
        assert!(app.expanded.is_empty());
        let group_idx = app.groups[0].idx;
        let detail = group_detail_lines(&app.groups[0], 80);
        let detail_text: Vec<String> = detail.iter().map(line_text).collect();
        assert!(detail_text.iter().any(|l| l.contains("result for c1")));
        assert!(detail_text.iter().any(|l| l.contains("result for c2")));

        // Ctrl-O expands, a second toggle collapses.
        app.toggle_regions();
        assert!(app.expanded.contains(&group_idx));
        app.toggle_regions();
        assert!(app.expanded.is_empty());
    }

    #[test]
    fn silent_tool_turns_keep_folding_across_step_boundaries() {
        let mut app = test_app();
        // One tool per turn (Step between each), no prose: the agent-loop shape.
        for (i, id) in ["c1", "c2", "c3"].iter().enumerate() {
            app.apply(StreamEvent::Step {
                index: i as u32 + 1,
                max: 8,
            });
            app.apply(StreamEvent::ToolCall {
                id: (*id).into(),
                name: "bash".into(),
                args: json!({ "command": "ls" }),
            });
            app.apply(StreamEvent::ToolResult {
                id: (*id).into(),
                content: "ok".into(),
                is_error: false,
                diff: None,
            });
        }
        // Still one open group after three turns, not a row per turn.
        assert!(app.tool_group.is_some());
        let tool_rows = app
            .transcript
            .iter()
            .filter(|l| { let t = line_text(l); t.contains("Executing") || t.contains("Running") })
            .count();
        assert_eq!(tool_rows, 1);
        app.on_done("stop".into(), None);
        let row = app
            .transcript
            .iter()
            .map(line_text)
            .find(|t| t.contains("Ran "))
            .unwrap();
        assert!(row.contains("✓ Ran 3 commands"), "row: {row}");
    }

    #[test]
    fn reasoning_before_tool_call_renders_above_it_in_order() {
        let mut app = test_app();
        // Reasoning model thinks, then acts. The thought must commit above the
        // tool row (emission order), not linger in the live tail below it.
        app.apply(StreamEvent::Token {
            text: "<think>let me look at the config</think>".into(),
        });
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "ls" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        // Buffer is drained: the reasoning is committed, not stranded below.
        assert!(app.assistant_buf.is_empty());
        // Reasoning folds to a collapsed summary row (raw thought hidden), which
        // still lands above the tool row it preceded (emission order).
        let rows: Vec<String> = app.transcript.iter().map(line_text).collect();
        assert!(
            !rows.iter().any(|r| r.contains("let me look")),
            "raw reasoning must be hidden by default: {rows:?}"
        );
        let think_at = rows.iter().position(|r| r.contains("reasoning (1 line)")).unwrap();
        let tool_at = rows
            .iter()
            .position(|r| r.contains("Executing") || r.contains("Running"))
            .unwrap();
        assert!(
            think_at < tool_at,
            "reasoning must render above the tool row it preceded: {rows:?}"
        );
        // The raw thought is retained on the block for expansion.
        let block = &app.reasoning_blocks[0];
        assert!(block.detail.iter().map(line_text).any(|l| l.contains("let me look")));
    }

    #[test]
    fn reasoning_row_is_separated_from_following_prose_by_a_blank_line() {
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "<think>thinking</think>Hi there!".into(),
        });
        app.apply(StreamEvent::Step { index: 1, max: 8 });
        let rows: Vec<String> = app.transcript.iter().map(line_text).collect();
        let think_at = rows.iter().position(|r| r.contains("reasoning (1 line)")).unwrap();
        let prose_at = rows.iter().position(|r| r.contains("Hi there!")).unwrap();
        assert!(think_at < prose_at);
        // A blank line must sit between the reasoning row and the prose.
        assert!(
            rows[think_at + 1..prose_at].iter().any(|r| r.trim().is_empty()),
            "expected a blank line between reasoning and prose: {rows:?}"
        );
    }

    #[test]
    fn committed_reasoning_folds_and_expands_via_keybinding() {
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "<think>step one\nstep two</think>The answer is 42.".into(),
        });
        // A turn boundary commits the buffer.
        app.apply(StreamEvent::Step { index: 1, max: 8 });

        let rows: Vec<String> = app.transcript.iter().map(line_text).collect();
        assert!(rows.iter().any(|r| r.contains("reasoning (2 lines)")));
        assert!(rows.iter().any(|r| r.contains("The answer is 42")));
        // Raw reasoning is hidden until expanded.
        assert!(!rows.iter().any(|r| r.contains("step one")));
        assert_eq!(app.reasoning_blocks.len(), 1);

        let idx = app.reasoning_blocks[0].idx;
        app.toggle_regions();
        assert!(app.expanded.contains(&idx));
        app.toggle_regions();
        assert!(app.expanded.is_empty());
    }

    #[test]
    fn silent_consecutive_tool_calls_still_fold() {
        let mut app = test_app();
        // No reasoning/prose between calls: they must fold into one group row.
        for id in ["c1", "c2", "c3"] {
            app.apply(StreamEvent::ToolCall {
                id: id.into(),
                name: "bash".into(),
                args: json!({ "command": "ls" }),
            });
            app.apply(StreamEvent::ToolResult {
                id: id.into(),
                content: "ok".into(),
                is_error: false,
                diff: None,
            });
        }
        assert!(app.tool_group.is_some());
        let tool_rows = app
            .transcript
            .iter()
            .filter(|l| {
                let t = line_text(l);
                t.contains("Executing") || t.contains("Running")
            })
            .count();
        assert_eq!(tool_rows, 1);
        app.apply(StreamEvent::Token {
            text: "All done.".into(),
        });
        assert!(app.tool_group.is_none());
        let row = app
            .transcript
            .iter()
            .map(line_text)
            .find(|t| t.contains("Ran "))
            .unwrap();
        assert!(row.contains("✓ Ran 3 commands"), "row: {row}");
    }

    #[test]
    fn on_done_normal_stop_with_answer_has_no_warning() {
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "The answer.".into(),
        });
        app.on_done("stop".into(), None);
        assert!(!app
            .transcript
            .iter()
            .any(|l| line_text(l).contains("finished")));
    }

    #[test]
    fn on_done_truncated_finish_warns_in_timeline() {
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "partial".into(),
        });
        app.on_done("length".into(), None);
        let warn = app
            .transcript
            .iter()
            .map(line_text)
            .find(|t| t.contains("finished early"))
            .unwrap();
        assert!(warn.contains("length"), "warn: {warn}");
    }

    #[test]
    fn on_done_stop_without_answer_warns() {
        let mut app = test_app();
        // Only reasoning, no answer prose (or an empty/malformed completion).
        app.apply(StreamEvent::Token {
            text: "<think>hmm</think>".into(),
        });
        app.on_done("stop".into(), None);
        assert!(app
            .transcript
            .iter()
            .any(|l| line_text(l).contains("finished with no answer")));
    }

    #[test]
    fn permission_prompt_does_not_break_tool_folding() {
        let mut app = test_app();
        for id in ["c1", "c2"] {
            app.apply(StreamEvent::ToolCall {
                id: id.into(),
                name: "bash".into(),
                args: json!({ "command": "grep -n foo src/" }),
            });
            app.apply(StreamEvent::PermissionRequest {
                request_id: format!("p-{id}"),
                tool_name: "bash".into(),
                capability: "exec".into(),
                path: None,
                command: Some("grep -n foo src/".into()),
                diff: None,
                prompt_kind: "exec".into(),
                offers_always: true,
            });
            app.pending = None; // simulate approval
            app.apply(StreamEvent::ToolResult {
                id: id.into(),
                content: "ok".into(),
                is_error: false,
                diff: None,
            });
        }
        // Both gated calls stayed in one running group despite the prompts.
        assert!(app.tool_group.is_some());
        let tool_rows = app
            .transcript
            .iter()
            .filter(|l| { let t = line_text(l); t.contains("Executing") || t.contains("Running") })
            .count();
        assert_eq!(tool_rows, 1);
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
    fn format_markdown_renders_code_fence_without_literal_backticks() {
        let md = "before\n\n```cpp\nconst bool x = true;\nif (x) { foo(); }\n```\n\nafter";
        let text = joined(&super::format_markdown_lines(md, 80));
        assert!(!text.contains("```"), "fence markers leaked: {text}");
        assert!(text.contains("const bool x = true;"));
        assert!(text.contains("if (x) { foo(); }"));
        assert!(text.contains("cpp"), "language tag missing: {text}");
        assert!(text.contains("before") && text.contains("after"));
        assert!(text.contains('┌') && text.contains('┘'), "missing box frame: {text}");
    }

    #[test]
    fn format_markdown_handles_unterminated_code_fence() {
        let md = "```rust\nfn main() {}";
        let text = joined(&super::format_markdown_lines(md, 80));
        assert!(!text.contains("```"), "fence leaked: {text}");
        assert!(text.contains("fn main() {}"));
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

    #[tokio::test]
    async fn new_command_resets_session() {
        let mut app = test_app();
        app.history.push(json!({ "role": "user", "content": "hi" }));
        app.thread_id = Some("t-123".into());
        app.tokens = 42;
        app.push(Line::raw("old content"));

        run_command(&mut app, "new").await;

        assert!(app.history.is_empty());
        assert!(app.thread_id.is_none(), "must detach from the saved thread");
        assert_eq!(app.tokens, 0);
        let text: String = app.transcript.iter().map(line_text).collect();
        assert!(!text.contains("old content"), "transcript not reset: {text}");
        assert!(text.contains("started a new session"), "missing note: {text}");
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

    fn names(app: &App) -> Vec<&'static str> {
        app.slash_matches().iter().map(|c| c.name).collect()
    }

    #[test]
    fn slash_bare_lists_all_commands() {
        let mut app = test_app();
        app.input = "/".into();
        assert_eq!(names(&app).len(), super::SLASH_COMMANDS.len());
    }

    #[test]
    fn slash_prefix_narrows_and_unmatched_hides() {
        let mut app = test_app();
        app.input = "/re".into();
        assert_eq!(names(&app), vec!["/resume"]);
        app.input = "/xyz".into();
        assert!(app.slash_matches().is_empty());
    }

    #[test]
    fn slash_hidden_when_not_command_or_has_space() {
        let mut app = test_app();
        app.input = "hello".into();
        assert!(app.slash_matches().is_empty());
        // A space means the user is typing an argument, not the command name.
        app.input = "/resume ".into();
        assert!(app.slash_matches().is_empty());
    }

    #[test]
    fn slash_hidden_while_running() {
        let mut app = test_app();
        app.input = "/".into();
        app.status = super::Status::Running;
        assert!(app.slash_matches().is_empty());
    }

    #[test]
    fn slash_move_wraps_within_matches() {
        let mut app = test_app();
        app.input = "/".into();
        let n = super::SLASH_COMMANDS.len();
        app.slash_move(-1);
        assert_eq!(app.slash_selected, n - 1);
        app.slash_move(1);
        assert_eq!(app.slash_selected, 0);
    }

    #[test]
    fn accept_slash_fills_buffer_with_trailing_space() {
        let mut app = test_app();
        app.input = "/re".into();
        app.accept_slash();
        assert_eq!(app.input, "/resume ");
        assert_eq!(app.cursor, app.input.len());
        // Trailing space now hides the popup.
        assert!(app.slash_matches().is_empty());
    }

    #[test]
    fn esc_dismiss_hides_until_next_edit() {
        let mut app = test_app();
        app.input = "/re".into();
        app.cursor = app.input.len();
        app.slash_dismissed = true;
        assert!(app.slash_matches().is_empty());
        // Editing the buffer re-shows the popup.
        app.input_insert('s');
        assert_eq!(names(&app), vec!["/resume"]);
    }
}
