//! Interactive chat console over the agent loop (bare `jan`). A thin
//! renderer: the engine is shared with the plain CLI path, only the
//! presentation differs. Maintains a running conversation — the user types
//! messages into an input box, each submit spawns an agent run over the shared
//! `AgentSession`, and streamed `StreamEvent`s render as message history plus
//! inline workflow elements (turn steps, tool calls/results). Gated tool calls
//! are approved interactively via the shared `PermissionRegistry`.

use std::collections::HashMap;
use std::future::pending;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::path_refs;

use ratatui::crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, Event, KeyCode,
        KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
    },
    execute,
    style::Print,
    terminal::{
        disable_raw_mode, enable_raw_mode, BeginSynchronizedUpdate, EndSynchronizedUpdate,
        EnterAlternateScreen, LeaveAlternateScreen,
    },
};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

mod highlight;
mod markdown;

use markdown::{
    format_markdown_lines, live_assistant_lines, reasoning_detail_lines, reasoning_summary_row,
};

use super::brand;
use super::journal::{self, DisplayEntry};
use super::mcp::McpServerEntry;
use super::{sort_threads_recent, AgentSession, ResumeTarget, SessionLimits};
use serde_json::Value;
use crate::core::agent::events::{describe_tool_call, StreamEvent, Usage};
use crate::core::agent::git;
use crate::core::agent::r#loop::{run_orchestration_streamed, OrchestrationArgs, PermissionRegistry};
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use tauri_plugin_agent_tools::workspace;

/// Mouse tracking, hand-rolled instead of crossterm's `EnableMouseCapture`,
/// which also turns on any-motion reporting (1003) -- a stream of events for
/// every idle pointer move. Buttons and the wheel (1000) plus motion *while a
/// button is held* (1002), with SGR coordinates (1006), is exactly what
/// drag-to-select needs and nothing more.
const MOUSE_TRACK_ON: &str = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
/// Alternate scroll (1007) makes the terminal translate the wheel into arrow
/// keys, which the composer reads as message-history recall -- so it is saved
/// and forced off for the session, then restored on exit. Needed whether or not
/// tracking is on, since with tracking off the wheel would otherwise type.
const ALT_SCROLL_SAVE_OFF: &str = "\x1b[?1007s\x1b[?1007l";
const ALT_SCROLL_RESTORE: &str = "\x1b[?1007r";

/// How long the dock advertises a finished copy.
const COPY_NOTICE: Duration = Duration::from_millis(1500);
/// Terminals cap the OSC 52 payload they will accept; past this the sequence is
/// skipped and the in-process clipboard is the only path.
const OSC52_MAX_BYTES: usize = 100_000;

/// Which cells a drag covers. `Linear` follows reading order, taking whole rows
/// between the endpoints; `Block` takes the rectangle between them, for lifting
/// one column out of a table or a diff without its `+`/`-` markers. Alt held as
/// the drag starts picks `Block`.
#[derive(Debug, Clone, Copy, PartialEq)]
enum SelectionMode {
    Linear,
    Block,
}

/// A mouse selection in frame cell coordinates. The TUI owns selection outright
/// because mouse tracking takes it away from the terminal: without this, a drag
/// with tracking on would do nothing at all.
#[derive(Debug, Clone, Copy)]
struct Selection {
    anchor: (u16, u16),
    head: (u16, u16),
    mode: SelectionMode,
    /// Button still held, so edge auto-scroll may run.
    dragging: bool,
    /// The pointer moved since the press. A press that never moves is a click
    /// (expand a tool row), not a selection.
    moved: bool,
}

impl Selection {
    fn new(at: (u16, u16), mode: SelectionMode) -> Self {
        Self {
            anchor: at,
            head: at,
            mode,
            dragging: true,
            moved: false,
        }
    }

    /// Covered cells as `(row, first_col, last_col)`, inclusive on both ends and
    /// clipped to `width`. Ordered top to bottom regardless of drag direction.
    fn spans(&self, width: u16) -> Vec<(u16, u16, u16)> {
        let last = width.saturating_sub(1);
        let (a, h) = (self.anchor, self.head);
        match self.mode {
            SelectionMode::Block => {
                let (c0, c1) = (a.0.min(h.0).min(last), a.0.max(h.0).min(last));
                (a.1.min(h.1)..=a.1.max(h.1)).map(|r| (r, c0, c1)).collect()
            }
            SelectionMode::Linear => {
                let (start, end) = if (a.1, a.0) <= (h.1, h.0) { (a, h) } else { (h, a) };
                (start.1..=end.1)
                    .map(|r| {
                        let c0 = if r == start.1 { start.0.min(last) } else { 0 };
                        let c1 = if r == end.1 { end.0.min(last) } else { last };
                        (r, c0, c1)
                    })
                    .collect()
            }
        }
    }
}

#[derive(Debug, PartialEq)]
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

/// Gutter glyph for a system line. A category with its own established glyph
/// (`◎` for a goal) passes that instead, so the column always carries exactly
/// one marker.
const SYSTEM_GLYPH: &str = "•";

/// Gutter glyph for goal-loop lines, matching the header's `◎ /goal` badge.
const GOAL_GLYPH: &str = "◎";

/// Gutter for the body rows of a multi-line system block. Distinct from the tool
/// rows' `│` and the reasoning rows' `┊`, so three stacked blocks stay tellable
/// apart at a glance.
const SYSTEM_CONT: &str = "┆";

/// How loud a system line is. The only thing that varies between them, so it is
/// a parameter rather than a colour picked at each of the ~90 call sites.
#[derive(Copy, Clone, PartialEq)]
enum Level {
    /// A dim acknowledgement or status note.
    Info,
    /// Something the user should notice but that needs no action.
    Warn,
    /// A failed turn, tool or command.
    Error,
    /// Work that completed successfully.
    Good,
}

impl Level {
    /// `(gutter, body)` styles. The gutter always carries colour so the marker
    /// is scannable down the left edge even when the body is dim.
    fn styles(self) -> (Style, Style) {
        match self {
            Level::Info => (Style::new().light_blue(), Style::new().dim()),
            Level::Warn => (Style::new().yellow(), Style::new().yellow()),
            Level::Error => (Style::new().red().bold(), Style::new().red().bold()),
            Level::Good => (Style::new().green(), Style::new().green().bold()),
        }
    }
}

/// Blocks that read as one run of activity and so need no blank between them.
/// A turn alternating folded reasoning summaries with tool rows was spending a
/// blank line on every switch, which is most of the turn.
fn band(kind: Kind) -> u8 {
    match kind {
        Kind::Tool | Kind::Reasoning => 0,
        Kind::None => 1,
        Kind::User => 2,
        Kind::Prose => 3,
        Kind::Meta => 4,
    }
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

    /// Label for the "allow always" option: command-scoped for exec (thread
    /// only), capability-scoped otherwise. All grants are thread-scoped. For an
    /// exec prompt the label names every base the command runs, so the user
    /// sees exactly what a grant covers (`git status && rm foo` -> git AND rm);
    /// commands that can't be decomposed grant only their exact text.
    fn always_label(&self) -> String {
        use tauri_plugin_agent_tools::tools::cmdscan::{scan_command, CommandScan};
        let Some(command) = self.command.as_deref() else {
            return "Allow always (this thread)".to_string();
        };
        match scan_command(command) {
            CommandScan::Bases(bases) if !bases.is_empty() => {
                let list = bases
                    .iter()
                    .map(|b| format!("'{b}'"))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("Allow all {list} commands (this thread)")
            }
            CommandScan::Bases(_) => "Allow always (this thread)".to_string(),
            CommandScan::Opaque => "Allow this exact command (this thread)".to_string(),
        }
    }

    /// Boxed diff preview for the prompt, sized to `inner` width; empty when the
    /// tool carries no diff (exec/read). No gutter: the panel sits flush in the
    /// prompt box, unlike the tool-row-aligned result diff.
    fn diff_preview(&self, inner: u16) -> Vec<Line<'static>> {
        match &self.diff {
            Some(d) => diff_lines(
                d,
                inner as usize,
                DIFF_PREVIEW_MAX_ROWS,
                "",
                self.path.as_deref(),
            ),
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
#[derive(PartialEq, Clone, Copy, Debug)]
enum PickerKind {
    ResumeThread,
    SelectModel,
    ToggleMcp,
    /// Double-Esc rewind: pick a past user message to roll back to.
    RewindMessage,
    /// Second step of a rewind: restore conversation only, or + workspace.
    RewindScope,
    /// Read-only view of `~/.jan/config.toml` providers (`/config`). Enter closes.
    ViewConfig,
    /// `/settings`: browse editable `[agent]` keys from agent.toml; Enter opens
    /// a docked edit prompt for the selected row.
    AgentSettings,
    /// `/todo` editor: browse the phased list and mutate the selected task
    /// (done/drop/rm) through the same canonical `TodoList` the model uses.
    Todo,
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
            PickerKind::ViewConfig => " provider config ",
            PickerKind::AgentSettings => " agent settings ",
            PickerKind::Todo => " todo ",
        }
    }

    fn action_hint(&self) -> &'static str {
        match self.kind {
            PickerKind::ResumeThread => " ↑/↓ select   Enter resume   Esc cancel",
            PickerKind::SelectModel => " ↑/↓ select   Enter choose   Esc cancel",
            PickerKind::ToggleMcp => " ↑/↓ select   Enter toggle   a add   e edit   d delete   Esc close",
            PickerKind::RewindMessage => " ↑/↓ select   Enter choose   Esc cancel",
            PickerKind::RewindScope => " ↑/↓ select   Enter restore   Esc cancel",
            PickerKind::ViewConfig => " set via: jan config set --provider <id> ...   Esc close",
            PickerKind::AgentSettings => " ↑/↓ select   Enter edit   x unset   Esc close",
            PickerKind::Todo => " ↑/↓ select   d done   x abandon   r remove   Esc close",
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

/// `/login` key entry: a docked prompt that collects a Tokamak API key without
/// echoing it. Verification runs off the render loop (see `login_task` in
/// `chat_loop`), so `verifying` marks the window where the prompt is read-only.
struct LoginPrompt {
    /// The key as typed/pasted. Never rendered verbatim -- see `masked`.
    input: String,
    /// Why the previous attempt failed, shown above the field.
    error: Option<String>,
    verifying: bool,
}

impl LoginPrompt {
    fn new() -> Self {
        Self {
            input: String::new(),
            error: None,
            verifying: false,
        }
    }

    fn masked(&self) -> String {
        super::secret_input::mask(self.input.chars().count())
    }

    fn paste(&mut self, text: &str) {
        if !self.verifying {
            self.input.push_str(super::secret_input::pasted(text));
        }
    }
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
    /// Present-tense label (e.g. "Executing grep -n foo src/"), shown on the
    /// live row while this is the group's only call.
    activity: String,
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
    /// When the group opened, so the running row can show elapsed time.
    started: Instant,
    /// Outcome of the most recently *arrived* result, which is what the
    /// collapsed row reports. Results can land out of dispatch order, so this
    /// can't be read back off `calls`.
    last_result_error: Option<bool>,
}

impl ToolGroup {
    /// Whether any call is still awaiting its `ToolResult`. A group can stay
    /// open with every call resolved so future calls keep folding into it; the
    /// throbber must not show while that's the case. Results within a batch can
    /// land out of dispatch order, so this looks at every call, not the last.
    fn is_running(&self) -> bool {
        self.calls.iter().any(|c| c.content.is_none())
    }

    /// Terminal marker for the collapsed row: the latest result's status, so a
    /// call that failed and then succeeded on a retry reads as resolved. The
    /// per-call failure stays visible in the expanded detail. A failure still
    /// outranks an unresolved call: it is the more specific thing to report.
    fn outcome_tag(&self, interrupted: bool) -> (&'static str, Style) {
        if self.last_result_error == Some(true) {
            ("✗", Style::new().red())
        } else if interrupted && self.is_running() {
            ("○", Style::new().yellow())
        } else {
            ("✓", Style::new().green())
        }
    }

    /// Live label for an open group: the tool still in flight, so a running
    /// batch reads as that tool rather than a counted breakdown like "Running
    /// 2 commands, 5 searches" (which would wrongly imply all of them are
    /// executing at once). The past-tense summary only appears once the group
    /// resolves. Results can land out of dispatch order, so the in-flight call
    /// is the latest one still awaiting its result.
    fn activity(&self) -> String {
        self.calls
            .iter()
            .rev()
            .find(|c| c.content.is_none())
            .or_else(|| self.calls.last())
            .map(|c| c.activity.clone())
            .unwrap_or_default()
    }

    /// The group's row: present-tense `▸` only while it is open with a call in
    /// flight, otherwise a resolved tag plus past-tense summary. The label is
    /// stored untruncated; `Row::Tool` clamps it to the current draw width.
    fn row(&self, state: GroupRow) -> Row {
        if state == GroupRow::Open && self.is_running() {
            return RowKind::Tool {
                tag: "▸".to_string(),
                tag_style: Style::new().cyan(),
                label: self.activity(),
                label_style: Style::new().cyan().dim(),
                reserve: TOOL_ROW_RESERVE,
            }
            .into();
        }
        let label = if self.nouns.len() <= 1 {
            self.first_done.clone()
        } else {
            group_summary(&self.nouns)
        };
        let (tag, tag_style) = self.outcome_tag(state == GroupRow::Aborted);
        RowKind::Tool {
            tag: tag.to_string(),
            tag_style,
            label,
            label_style: Style::new().dim(),
            reserve: TOOL_ROW_RESERVE,
        }
        .into()
    }
}

/// How a group's row should read: still open to further calls, closed normally,
/// or closed by an abort that left calls unresolved.
#[derive(Clone, Copy, PartialEq)]
enum GroupRow {
    Open,
    Closed,
    Aborted,
}

/// A standalone (diff-producing) tool row awaiting its `ToolResult`, retained so
/// an aborted run can mark it interrupted instead of leaving a `▸` that reads as
/// work still in flight.
struct PendingToolRow {
    id: String,
    idx: usize,
    label: String,
    /// Past-tense label the row is rewritten to once its result lands.
    done: String,
}

/// What the session opens with: the `jan` wordmark plus the facts a first-time
/// reader needs (which project, how tool calls are approved) and the commands to
/// go on with. Held as data rather than rendered lines so the row re-lays out at
/// the draw width like every other width-dependent row.
struct Banner {
    version: &'static str,
    project: String,
    branch: Option<String>,
    /// How tool calls are approved this session (sandboxed, or `--safe`).
    tools: String,
    /// False when `--task` already seeded the first message, so the splash does
    /// not invite one.
    awaiting_first_message: bool,
}

/// Indent shared by every splash row, matching `jan --help`.
const BANNER_INDENT: u16 = 2;

/// Commands worth putting in front of a first-time reader. The full list is
/// behind `/help` (see `SLASH_COMMANDS`).
const BANNER_HINTS: &[(&str, &str)] = &[
    ("/help", "commands"),
    ("/init", "onboard this project"),
    ("/model", "switch model"),
    ("/resume", "reopen a session"),
    ("Ctrl-D", "quit"),
];

fn banner_lines(banner: &Banner, width: u16) -> Vec<Line<'static>> {
    let accent = Style::new().yellow().bold();
    let label = Style::new().dark_gray();
    let dim = Style::new().dim();
    let indent = " ".repeat(BANNER_INDENT as usize);
    let mut out: Vec<Line<'static>> = Vec::new();

    // A clipped wordmark reads as breakage, so a narrow terminal gets the name
    // as text instead.
    if width >= brand::LOGO_WIDTH + BANNER_INDENT * 2 {
        for art in brand::LOGO {
            out.push(Line::styled(format!("{indent}{art}"), accent));
        }
        out.push(Line::raw(""));
        out.push(Line::styled(
            format!("{indent}interactive agent console · v{}", banner.version),
            dim,
        ));
    } else {
        out.push(Line::from(vec![
            Span::styled(format!("{indent}jan"), accent),
            Span::styled(format!(" v{}", banner.version), dim),
        ]));
    }
    out.push(Line::raw(""));

    let value_max = width.saturating_sub(BANNER_INDENT + 10).max(8) as usize;
    let mut field = |name: &str, value: String| {
        out.push(Line::from(vec![
            Span::styled(format!("{indent}{name:<8}"), label),
            Span::styled(truncate(&value, value_max), dim),
        ]));
    };
    // No `model` row: the header leads with it, bold, two rows above. The
    // location is a different case -- the dock's copy is dim and easy to miss,
    // and the tools act on that directory, so a `jan` started in the wrong one
    // is the mistake worth catching before the first message.
    let location = match &banner.branch {
        Some(branch) => format!("{} ⎇ {branch}", banner.project),
        None => banner.project.clone(),
    };
    field("project", location);
    field("tools", banner.tools.clone());
    out.push(Line::raw(""));

    for row in hint_rows(BANNER_HINTS, width) {
        out.push(row);
    }
    if banner.awaiting_first_message {
        let long = "type a message to start";
        let invite = if width as usize >= BANNER_INDENT as usize + long.len() {
            long
        } else {
            "type a message"
        };
        out.push(Line::styled(format!("{indent}{invite}"), dim));
    }
    out
}

/// Pack `(key, label)` hints into as few indented rows as `width` allows, so a
/// narrow terminal wraps between hints instead of mid-hint.
fn hint_rows(pairs: &[(&str, &str)], width: u16) -> Vec<Line<'static>> {
    let key_style = Style::new().cyan().bold();
    // `hint_spans` opens with one space; the splash indents by two.
    let row = |group: &[(&str, &str)]| {
        let mut spans = vec![Span::raw(" ")];
        spans.extend(hint_spans(key_style, group));
        Line::from(spans)
    };
    let mut groups: Vec<Vec<(&str, &str)>> = Vec::new();
    let mut group: Vec<(&str, &str)> = Vec::new();
    for pair in pairs {
        group.push(*pair);
        if row_width(&row(&group)) > width as usize && group.len() > 1 {
            group.pop();
            groups.push(std::mem::take(&mut group));
            group.push(*pair);
        }
    }
    if !group.is_empty() {
        groups.push(group);
    }
    groups
        .into_iter()
        .map(|group| {
            let full = row(&group);
            if row_width(&full) <= width as usize {
                return full;
            }
            // A hint too wide even on its own keeps its key and drops the
            // description; the key is the part the user has to type.
            row(&group.iter().map(|(key, _)| (*key, "")).collect::<Vec<_>>())
        })
        .collect()
}

#[cfg(test)]
thread_local! {
    /// Counts `Row::lines` calls, so a test can assert that `draw` materializes
    /// a viewport's worth of rows rather than the whole transcript.
    static ROW_CLONES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Rows a `Paragraph` occupies once it word-wraps `lines` at `width`, measured
/// with the same wrap the body uses so the two cannot disagree. ratatui wraps
/// each `Line` independently and never merges across them, so summing this over
/// a run of rows equals measuring their concatenation -- which is what lets
/// `draw` add up cached per-row heights instead of wrapping the whole session.
fn wrapped_height(lines: Vec<Line<'static>>, width: u16) -> u16 {
    Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .line_count(width.max(1))
        .min(u16::MAX as usize) as u16
}

/// One committed transcript entry. Width-dependent entries keep their *source*
/// rather than rendered lines, so a terminal resize re-lays them out at the new
/// width instead of leaving tables, boxed diffs and truncated labels sized for
/// the old one. `Line` holds content whose layout is width-independent (it wraps
/// naturally in the body `Paragraph`).
///
/// A row may render to several lines; transcript indices (group/reasoning/
/// pending-row `idx`, `expanded`, `reveal`) address rows, so they stay valid
/// across a resize no matter how the line count changes.
struct Row {
    kind: RowKind,
    /// Last render, keyed by the width that produced it. The whole transcript
    /// is laid out on every frame, so without this a long session would
    /// re-parse its markdown and re-highlight its diffs 20 times a second;
    /// only a width change invalidates the entry.
    cache: std::cell::RefCell<Option<RowRender>>,
}

/// A row's rendered lines plus the height they occupy once the body
/// `Paragraph` word-wraps them. `height` is what lets `draw` locate the visible
/// window without materializing (let alone wrapping) the rows above it.
struct RowRender {
    width: u16,
    lines: Vec<Line<'static>>,
    height: u16,
}

enum RowKind {
    Line(Line<'static>),
    /// Assistant prose, re-wrapped through markdown at the draw width.
    Markdown(String),
    /// The opening splash, re-laid out at the draw width (the wordmark is
    /// dropped and the hints re-packed on a terminal too narrow for them).
    Banner(Box<Banner>),
    /// A line the app is saying: `glyph` in the gutter column, body wrapped at
    /// the draw width, so the gutter owns the left edge of the whole row instead
    /// of only its first line. `cont` is what a wrapped continuation puts in the
    /// column: an edge glyph repeats, a marker glyph gives way to blanks (a
    /// second `•` would read as a second note).
    System {
        glyph: &'static str,
        cont: &'static str,
        gutter: Style,
        body: Vec<Span<'static>>,
    },
    /// A tool call/summary row, re-truncated to `width - reserve`.
    Tool {
        tag: String,
        tag_style: Style,
        label: String,
        label_style: Style,
        reserve: u16,
    },
    /// A tool result summary plus its optional boxed diff panel. `content` is
    /// `None` when the call row above already says the same thing.
    Result {
        tag: &'static str,
        tag_style: Style,
        content: Option<String>,
        diff: Option<String>,
        /// Path of the edited file, for diff syntax highlighting.
        lang: Option<String>,
    },
}

impl From<RowKind> for Row {
    fn from(kind: RowKind) -> Self {
        Row {
            kind,
            cache: std::cell::RefCell::new(None),
        }
    }
}

impl Row {
    fn line(line: Line<'static>) -> Row {
        RowKind::Line(line).into()
    }

    fn lines(&self, width: u16) -> Vec<Line<'static>> {
        #[cfg(test)]
        ROW_CLONES.with(|n| n.set(n.get() + 1));
        self.fill(width);
        self.cache
            .borrow()
            .as_ref()
            .map(|r| r.lines.clone())
            .unwrap_or_default()
    }

    /// Wrapped height at `width`, without cloning the row's lines. `draw` calls
    /// this for every row on every frame and `lines` only for the visible few,
    /// so this must stay O(1) once the row is cached.
    fn height(&self, width: u16) -> u16 {
        self.fill(width);
        self.cache.borrow().as_ref().map_or(0, |r| r.height)
    }

    fn fill(&self, width: u16) {
        if self.cache.borrow().as_ref().is_some_and(|r| r.width == width) {
            return;
        }
        let lines = self.render(width);
        let height = wrapped_height(lines.clone(), width);
        *self.cache.borrow_mut() = Some(RowRender {
            width,
            lines,
            height,
        });
    }

    fn render(&self, width: u16) -> Vec<Line<'static>> {
        match &self.kind {
            RowKind::Line(line) => vec![line.clone()],
            RowKind::Markdown(text) => format_markdown_lines(text, width),
            RowKind::Banner(banner) => banner_lines(banner, width),
            RowKind::System {
                glyph,
                cont,
                gutter,
                body,
            } => {
                let lead = glyph.chars().count() + 1;
                let max = width.saturating_sub(lead as u16).max(8) as usize;
                markdown::wrap_spans_at_words(body.clone(), max)
                    .into_iter()
                    .enumerate()
                    .map(|(i, spans)| {
                        let mark = if i == 0 { *glyph } else { *cont };
                        let mut row = vec![Span::styled(
                            format!("{mark:<width$}", width = lead),
                            *gutter,
                        )];
                        row.extend(spans);
                        Line::from(row)
                    })
                    .collect()
            }
            RowKind::Tool {
                tag,
                tag_style,
                label,
                label_style,
                reserve,
            } => {
                let max = width.saturating_sub(*reserve).max(1) as usize;
                vec![tool_row(
                    tag,
                    *tag_style,
                    &truncate(label, max),
                    *label_style,
                )]
            }
            RowKind::Result {
                tag,
                tag_style,
                content,
                diff,
                lang,
            } => {
                let max = width.saturating_sub(8).max(1) as usize;
                let mut out: Vec<Line<'static>> = content
                    .iter()
                    .map(|c| {
                        Line::from(vec![
                            Span::styled("│   ", Style::new().dark_gray()),
                            Span::styled(format!("{tag} "), *tag_style),
                            Span::styled(summarize_result(c, max), Style::new().dim()),
                        ])
                    })
                    .collect();
                if let Some(diff) = diff {
                    out.extend(diff_lines(
                        diff,
                        width as usize,
                        DIFF_MAX_ROWS,
                        "│     ",
                        lang.as_deref(),
                    ));
                }
                out
            }
        }
    }

    /// Whether this row is the blank separator `gap` inserts. Only a literal
    /// blank line qualifies; a source-backed row always renders content.
    fn is_blank(&self) -> bool {
        match &self.kind {
            RowKind::Line(line) => line.spans.iter().all(|s| s.content.trim().is_empty()),
            _ => false,
        }
    }
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

/// An image staged by `/image <path>`, sent with the next user message as an
/// OpenAI `image_url` content part. `name` is the basename shown in the
/// transcript; `data_url` is the `data:<mime>;base64,...` payload.
struct PendingImage {
    name: String,
    data_url: String,
}

/// One entry in the file-path hint popup triggered by typing `@`.
struct PathHintItem {
    /// Display path (relative to project root).
    path: String,
    /// Basename for display.
    name: String,
    /// Whether this is a directory.
    is_dir: bool,
}

struct PendingAsk {
    request_id: String,
    request: crate::core::agent::interaction::AskRequest,
    answers: Vec<crate::core::agent::interaction::QuestionResult>,
    question_index: usize,
    selected: usize,
    editing_custom: bool,
    custom_input: String,
    rect: Rect,
    row_hitboxes: Vec<(u16, usize)>,
}

impl PendingAsk {
    fn new(request_id: String, request: crate::core::agent::interaction::AskRequest) -> Self {
        let answers = request
            .questions
            .iter()
            .map(|question| crate::core::agent::interaction::QuestionResult {
                id: question.id.clone(),
                selected: Vec::new(),
                custom_input: None,
            })
            .collect();
        Self {
            request_id,
            request,
            answers,
            question_index: 0,
            selected: 0,
            editing_custom: false,
            custom_input: String::new(),
            rect: Rect::default(),
            row_hitboxes: Vec::new(),
        }
    }

    fn question(&self) -> &crate::core::agent::interaction::Question {
        &self.request.questions[self.question_index]
    }
    fn row_count(&self) -> usize {
        self.question().options.len() + 1 + usize::from(self.question().multi)
    }

    fn move_selection(&mut self, delta: isize) {
        self.selected =
            (self.selected as isize + delta).rem_euclid(self.row_count() as isize) as usize;
    }

    fn move_question(&mut self, delta: isize) {
        let last = self.request.questions.len().saturating_sub(1) as isize;
        self.question_index = (self.question_index as isize + delta).clamp(0, last) as usize;
        self.selected = 0;
        self.editing_custom = false;
        self.custom_input.clear();
    }

    fn all_answered(&self) -> bool {
        self.answers
            .iter()
            .all(|answer| !answer.selected.is_empty() || answer.custom_input.is_some())
    }

    /// Apply the highlighted row. Returns true once every question is answered.
    fn choose(&mut self) -> bool {
        let option_count = self.question().options.len();
        let multi = self.question().multi;
        if multi && self.selected == option_count + 1 {
            return self.advance_or_finish();
        }
        if self.selected == option_count {
            self.editing_custom = true;
            self.custom_input = self.answers[self.question_index]
                .custom_input
                .clone()
                .unwrap_or_default();
            return false;
        }
        let label = self.question().options[self.selected].label.clone();
        let answer = &mut self.answers[self.question_index];
        answer.custom_input = None;
        if multi {
            if let Some(index) = answer.selected.iter().position(|item| item == &label) {
                answer.selected.remove(index);
            } else {
                answer.selected.push(label);
            }
            false
        } else {
            answer.selected = vec![label];
            self.advance_or_finish()
        }
    }

    fn accept_custom(&mut self) -> bool {
        let value = self.custom_input.trim().to_string();
        if value.is_empty() {
            return false;
        }
        let id = self.question().id.clone();
        self.answers[self.question_index] = crate::core::agent::interaction::QuestionResult {
            id,
            selected: Vec::new(),
            custom_input: Some(value),
        };
        self.editing_custom = false;
        self.advance_or_finish()
    }

    fn advance_or_finish(&mut self) -> bool {
        if self.question_index + 1 < self.request.questions.len() {
            self.move_question(1);
            return false;
        }
        if self.all_answered() {
            true
        } else {
            self.question_index = self
                .answers
                .iter()
                .position(|answer| answer.selected.is_empty() && answer.custom_input.is_none())
                .unwrap_or(self.question_index);
            self.selected = 0;
            false
        }
    }
}

struct App {
    model: String,
    /// Fast model for the `smol` role, used by `/goal` evaluation. Defaults to
    /// `model` when no smol model is configured.
    smol_model: String,
    /// Active `/goal`, if any: the loop keeps firing turns until the evaluator
    /// judges the condition met. Persisted with the thread so it survives
    /// restart/resume. `None` = no goal.
    goal: Option<crate::core::agent::goal::GoalState>,
    /// Set after a turn finishes while a goal is active: the chat loop runs the
    /// evaluator off the render loop, then auto-continues or returns control.
    goal_eval_pending: bool,
    /// Read-only plan mode. `Plan` blocks mutation-capable tools at the core
    /// dispatcher (advisory prompt is defense in depth only). Persisted with
    /// the thread so it survives restart/resume.
    run_mode: crate::core::agent::plan::RunMode,
    /// Orchestration handle for out-of-run model calls (the `/compact` command).
    /// `None` in unit tests, set by `run` for the live session.
    args: Option<Arc<OrchestrationArgs>>,
    /// Context window limit for the current model (default 128K).
    context_window: u64,
    /// Tokens to reserve for the model's response (compaction triggers at limit - reserve).
    reserve_tokens: u64,
    /// Per-request output cap forwarded to the model as OpenAI `max_tokens`.
    /// `None` omits the field (model default).
    max_tokens: Option<u64>,
    /// Token-spend ceiling for one message's run; `0` is unbounded. The only
    /// cap on run length -- there is no turn limit.
    max_session_tokens: u64,
    /// Repo top-level when the project is a git repo; enables workspace snapshots.
    /// Cleared if git setup fails, permanently disabling snapshots this session.
    repo_root: Option<PathBuf>,
    /// Current git branch name, if the project is inside a git repo.
    git_branch: Option<String>,
    /// Directory tool paths (`edit`/`write` "path" args) are resolved against.
    project_root: PathBuf,
    /// Absolute paths touched by `edit`/`write` tool calls so far this turn;
    /// drained into the next checkpoint's snapshot and reset per turn. Only
    /// these exact paths are staged -- checkpoints never scan the repo.
    turn_touched: Vec<PathBuf>,
    /// Destination path of each in-flight `edit`/`write` call, keyed by call id,
    /// so the diff in its `ToolResult` (which carries no path) can be
    /// syntax-highlighted for the right language. Removed as results arrive.
    diff_paths: HashMap<String, String>,
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
    /// Display transcript (user turns, assistant text, workflow lines). Rows,
    /// not lines: width-dependent entries keep their source and re-render on
    /// resize (see `Row`).
    transcript: Vec<Row>,
    /// What was rendered, in emission order, so a resumed session gets its
    /// reasoning and tool calls back. `history` cannot serve this: reasoning is
    /// kept out of it and tool calls are flattened away on save. Dumped off the
    /// render loop by `persist`, replayed by `replay_display_log`.
    display_log: Vec<DisplayEntry>,
    /// Background journal writer, created on the first dump and joined on exit.
    journal_writer: Option<journal::Writer>,
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
    /// Standalone (edit/write) call rows still awaiting their result. Several
    /// can be open at once: a batch emits every `ToolCall` before any result.
    pending_rows: Vec<PendingToolRow>,
    /// Committed reasoning blocks, folded to a summary row and expandable back to
    /// their full dimmed lines.
    reasoning_blocks: Vec<ReasoningBlock>,
    /// Whether `<think>` reasoning reveals in full instead of folding. Defaults
    /// from `[agent].show_reasoning` in agent.toml (false). Ctrl-O toggles every
    /// existing block between its summary row and full detail for the session.
    show_reasoning: bool,
    /// Transcript row indices of collapsed regions (tool groups or reasoning
    /// blocks) the user has expanded to full detail.
    expanded: std::collections::HashSet<usize>,
    /// Transcript row of a region to scroll into view on the next draw (set when
    /// expanding one that may sit above the pinned-to-bottom viewport).
    reveal: Option<usize>,
    input: String,
    /// Composer entries submitted this session, oldest first, for Up/Down recall.
    input_history: Vec<String>,
    /// Position in `input_history` while recalling; `None` is the fresh buffer.
    recall_pos: Option<usize>,
    /// Images staged by `/image`, flushed into the next submitted user message.
    pending_images: Vec<PendingImage>,
    /// Caret position as a byte index into `input` (always on a char boundary).
    cursor: usize,
    /// Highlighted row in the slash-command hint popup (clamped to matches).
    slash_selected: usize,
    /// Set by Esc to hide the hint popup without clearing the buffer; cleared on
    /// the next keystroke that edits the input so typing re-shows it.
    slash_dismissed: bool,
    /// File-path hint entries matching the current `@query` in the input buffer.
    path_hints: Vec<PathHintItem>,
    /// Highlighted row in the path-hint popup (clamped to matches).
    path_hint_selected: usize,
    /// Set by Esc to dismiss the path-hint popup; cleared on next char edit.
    path_hint_dismissed: bool,
    status: Status,
    /// Wall-clock start of the current reasoning `<think>` block while it is
    /// open (the model is actively reasoning). `None` between blocks.
    thinking_since: Option<Instant>,
    /// Duration of the reasoning block that just closed, cached so the header
    /// can show `[thought for Ns]` transiently. `None` after the reasoning is
    /// shown inline (or none has happened yet).
    thought_for: Option<Duration>,
    /// Wall-clock time `thought_for` was last set, so the `[thought for Ns]`
    /// summary can expire back to the plain `[working]` after a short while
    /// rather than persisting for the rest of the turn. `None` when `thought_for`
    /// is `None` or not yet set.
    thought_for_since: Option<Instant>,
    turn: (u32, u32),
    tokens: u64,
    detail: String,
    /// Outstanding permission requests, oldest first. Several subagents (or a
    /// subagent and the parent) can request approval concurrently; only the
    /// front is shown/answerable at a time, later ones queue and surface once
    /// the front resolves so no requester is silently dropped/left hanging.
    pending_queue: std::collections::VecDeque<Pending>,
    /// Structured questions waiting for this TUI, oldest first.
    ask_queue: std::collections::VecDeque<PendingAsk>,
    picker: Option<Picker>,
    /// Active `/login` prompt; owns the keyboard while open.
    login: Option<LoginPrompt>,
    /// Active `/settings` edit prompt (docked like `/login`); owns the
    /// keyboard while open. Holds the setting being edited and any validation
    /// error; writes go straight to agent.toml on Enter.
    settings_prompt: Option<SettingsPrompt>,
    /// Active MCP add/edit wizard (docked); owns the keyboard while open.
    mcp_prompt: Option<McpPrompt>,
    /// Key handed off to the loop to verify off the render loop. Taken once.
    login_submit: Option<String>,
    /// `/update` handed off to the loop, which spawns the install. Taken once.
    update_requested: bool,
    /// Compaction handed off to the loop, which spawns the summarizing model
    /// call off the render loop. Taken once.
    compact_request: Option<CompactKind>,
    /// A compaction is in flight: the header and the input box show a throbber,
    /// a second request is refused, and no run starts until it lands (its result
    /// replaces `history`, so a run reading the old one would be clobbered).
    compacting: Option<CompactKind>,
    /// When the in-flight compaction started, for the elapsed counter.
    compact_started: Option<Instant>,
    /// The in-flight compaction was triggered by a context-overflow error, so
    /// the errored turn is resumed once it lands.
    retry_after_compact: bool,
    /// Overflow retries spent in the current user turn, capped so a model that
    /// overflows no matter how small the context cannot spin forever.
    overflow_retries: u8,
    /// False once a prompt the provider *accepted* exceeded `context_window`,
    /// which proves the configured value wrong. Nothing then divides by it: the
    /// gauge drops its denominator, the subagent share is hidden, and proactive
    /// compaction stands down in favour of the loop's reactive path.
    context_window_trusted: bool,
    /// An install is in flight: `/update` is refused (two processes must not
    /// rewrite the same binary) and the footer shows progress.
    update_installing: bool,
    /// Lines scrolled back from the tail; 0 pins the view to the bottom so new
    /// content follows. Non-zero survives streaming so scroll-back stays usable.
    scrollback: u16,
    /// Set when the user submits a message; the loop spawns a run next tick.
    want_start: bool,
    /// Turns (model roundtrips, plus the submission that kicked off a run)
    /// since the todo list last had open work. The list is the model's own
    /// scratchpad, so a finished one lingers until it declares a new plan --
    /// which may never happen. This counts down a grace period instead of
    /// clearing the moment the last task closes, so a model that is still
    /// mid-flow (about to append, or reopening a task) keeps its list.
    turns_since_todos_closed: u32,
    /// When the plan last went from having open work to having none. Drives the
    /// dock's own, wall-clock hide: `turns_since_todos_closed` only advances on
    /// model roundtrips, so a run that finishes its plan and stops would pin a
    /// fully checked-off list on screen indefinitely.
    todos_closed_at: Option<Instant>,
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
    /// In-flight `await_subagent` calls, `(tool_call_id, run_id, subagent_name)`.
    /// Cleared on the matching `ToolResult` or `SubagentEnd`, whichever comes
    /// first (the two can race).
    awaiting: Vec<(String, String, String)>,
    /// Tool calls whose arguments are still streaming. Rendered live -- a file
    /// body previews as it arrives, anything else gets a throbber -- and
    /// cleared on the matching `ToolCall` (full args) or on the next `Step`,
    /// whichever comes first.
    starting: Vec<StartingCall>,
    /// Monotonic frame counter driving the throbber. Advanced by whole
    /// `SPINNER_ADVANCE_MS` steps elapsed since `last_spinner_advance`, not once
    /// per tick, so the animation runs at a fixed cadence and catches up after a
    /// stalled loop instead of lagging.
    spinner_frame: usize,
    /// Wall-clock baseline for the last spinner advance; moved forward by whole
    /// frames only so leftover sub-frame time carries into the next tick.
    last_spinner_advance: Instant,
    /// Output tokens/sec of the last completed turn, cached so the header holds a
    /// steady value between turns instead of flickering to 0. Cleared at turn
    /// start; recomputed from the turn's `usage` sample at `on_done`.
    tokens_per_sec: Option<f64>,
    /// Output tokens produced across every request in the current turn. Summed
    /// from `TurnUsage` rather than read off `Done`, which reports only the
    /// final request and so undercounts any turn that used tools.
    turn_output_tokens: u64,
    /// Context size of the current turn's most recent request.
    turn_prompt_tokens: u64,
    /// Transcript viewport rect from the last draw, for mapping mouse clicks
    /// to rows.
    transcript_rect: Rect,
    /// Wrapped-line scroll offset from the last draw (`0` = top). Only the
    /// selection anchor uses it now, to follow content that moved under it.
    last_scroll: u16,
    /// Body screen row -> source transcript index from the last draw (`None`
    /// for synthetic rows: top padding, awaiting throbbers, streaming prose).
    /// One entry per visible row, in wrapped coordinates, so a click maps
    /// straight through even where a row wrapped.
    row_index: Vec<Option<usize>>,
    /// When the current run started, so the header can show elapsed time.
    /// `None` while idle.
    run_started: Option<Instant>,
    /// Mouse selection, live or finished. Cleared by any key, wheel notch or
    /// fresh press.
    selection: Option<Selection>,
    /// Set when a drag ends: the next `draw` lifts the text out of the buffer it
    /// just rendered (only `draw` holds one) and hands it to `chat_loop`.
    copy_armed: bool,
    /// Selected text waiting to reach the clipboard.
    copy_request: Option<String>,
    /// (when, line count) of the last copy, for the transient dock notice.
    copied: Option<(Instant, usize)>,
    /// Messages queued while a run is in progress, dequeued automatically
    /// when the current turn finishes.
    message_queue: std::collections::VecDeque<String>,
    /// Canonical session todo list projection, kept in sync via
    /// `StreamEvent::TodoUpdate`. Empty = no todos declared this session.
    todos: crate::core::agent::todo::TodoList,
    /// Set when the model issued a `todo` tool call in the current turn; cleared
    /// at each turn start. Drives the reminder suppression / retry policy.
    todo_call_this_turn: bool,
    /// Set when a `todo` mutation succeeded this turn (a `TodoUpdate` arrived);
    /// a call without a success means the mutation failed (retry reminder).
    todo_ok_this_turn: bool,
    /// Open-work summary last surfaced as a reminder, so the same reminder never
    /// fires twice in a row without the state changing (reminder dedup).
    last_todo_reminder: Option<String>,
    /// Stop-time reminders sent so far this prompt cycle; caps at
    /// `TODO_REMINDER_MAX` so a summary that keeps changing slightly can't
    /// nag indefinitely even though the same-summary dedup above wouldn't
    /// catch it.
    reminder_count: u32,
    /// True right after a reminder fires, cleared the moment any tool result
    /// lands. Blocks a second reminder from piling onto one the model hasn't
    /// had a chance to act on yet.
    reminder_awaiting_progress: bool,
}

/// How long a fully checked-off plan stays in the dock before it hides: just
/// long enough to see the last task tick over. The list itself lives on until
/// `age_closed_todos` drops it, and `/todo` reopens it at any point.
const TODO_HIDE_AFTER: Duration = Duration::from_secs(3);

/// Braille throbber frames for in-progress rows (e.g. awaiting a subagent).
const SPINNER: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Milliseconds per spinner frame, decoupled from the 50ms render tick.
const SPINNER_ADVANCE_MS: u64 = 80;

/// How long the `[thought for Ns]` header summary lingers after a reasoning
/// block closes before it falls back to the plain `[working]` status. The
/// summary is only a transient cue that a block finished; it should not pin the
/// header for the rest of the turn once the model gets back to work.
const THOUGHT_FOR_TTL: Duration = Duration::from_secs(3);

/// Live rolling view of an in-flight subagent's tool calls. The panel shows only
/// the most recent [`SUBAGENT_WINDOW`] calls, but the full list is retained so
/// the finished summary row can expand back to every call (Ctrl-O).
struct SubagentPanel {
    run_id: String,
    name: String,
    /// The task this child was dispatched with. Shown above the agent list so
    /// the block says what the fan-out is *for*, not just who is running.
    task: String,
    calls: Vec<String>,
    /// Upstream requests this child has made, counted from its `Step` events.
    /// Distinct from `calls.len()`: one request can carry several tool calls,
    /// and a request can carry none.
    requests: u32,
    /// Context occupied by the child's most recent request. The high-water
    /// mark of how full its window is, which is the number worth watching --
    /// a subagent silently filling its context is the failure this surfaces.
    prompt_tokens: u64,
    /// The call the child is currently assembling, if any. Without this a
    /// child streaming a large `write` reports nothing at all for the whole
    /// request -- no completed tool call yet, so a stats line frozen at
    /// "0 tools" and an activity line stuck on "starting…".
    active: Option<StartingCall>,
    /// True while the dispatch is parked on the parent run's
    /// `max_parallel_subagents` cap (reported via `SubagentQueued`); flipped
    /// off when the child's `SubagentStart` arrives. Queued panels render
    /// "queued (N waiting)" instead of live stats, so a capped fan-out reads
    /// as a queue rather than a wall of silently-idle agents.
    queued: bool,
    /// 1-based position in the queue at the time the child was queued.
    waiting: u32,
}

/// A committed finished-subagent summary row, folded to one line but retaining
/// its full tool-call list so the row can expand back to it (like a tool group).
struct SubagentBlock {
    /// Transcript index of the summary row this block owns.
    idx: usize,
    /// Tool-call labels, revealed when expanded. Held as text, not lines, so
    /// they re-truncate to the draw width.
    calls: Vec<String>,
}

impl SubagentBlock {
    fn detail_lines(&self, width: u16) -> Vec<Line<'static>> {
        let max = width.saturating_sub(8).max(1) as usize;
        self.calls
            .iter()
            .map(|label| {
                Line::from(vec![
                    Span::styled("│   ", Style::new().dark_gray()),
                    Span::styled("▸ ", Style::new().magenta()),
                    Span::styled(truncate(label, max), Style::new().dim()),
                ])
            })
            .collect()
    }
}

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
    #[allow(clippy::too_many_arguments)]
    fn new(
        model: String,
        limits: SessionLimits,
        show_reasoning: bool,
        agent_dir: std::path::PathBuf,
        project_root: PathBuf,
        repo_root: Option<PathBuf>,
    ) -> Self {
        Self {
            smol_model: model.clone(),
            model,
            goal: None,
            goal_eval_pending: false,
            run_mode: crate::core::agent::plan::RunMode::Normal,
            args: None,
            context_window: limits.context_window,
            reserve_tokens: limits.reserve_tokens,
            max_tokens: limits.max_tokens,
            max_session_tokens: limits.max_session_tokens,
            repo_root,
            git_branch: git::current_branch(&project_root),
            project_root,
            turn_touched: Vec::new(),
            diff_paths: HashMap::new(),
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
            display_log: Vec::new(),
            journal_writer: None,
            assistant_buf: String::new(),
            tool_group: None,
            grouped_ids: std::collections::HashSet::new(),
            groups: Vec::new(),
            pending_rows: Vec::new(),
            reasoning_blocks: Vec::new(),
            show_reasoning,
            expanded: std::collections::HashSet::new(),
            reveal: None,
            input: String::new(),
            input_history: Vec::new(),
            recall_pos: None,
            pending_images: Vec::new(),
            cursor: 0,
            slash_selected: 0,
            slash_dismissed: false,
            path_hints: Vec::new(),
            path_hint_selected: 0,
            path_hint_dismissed: false,
            status: Status::Idle,
            thinking_since: None,
            thought_for: None,
            thought_for_since: None,
            turn: (0, 0),
            tokens: 0,
            detail: String::new(),
            pending_queue: std::collections::VecDeque::new(),
            ask_queue: std::collections::VecDeque::new(),
            picker: None,
            login: None,
            settings_prompt: None,
            mcp_prompt: None,
            login_submit: None,
            update_requested: false,
            update_installing: false,
            compact_request: None,
            compacting: None,
            compact_started: None,
            retry_after_compact: false,
            overflow_retries: 0,
            context_window_trusted: true,
            scrollback: 0,
            want_start: false,
            turns_since_todos_closed: 0,
            todos_closed_at: None,
            view_width: 0,
            last_kind: Kind::None,
            should_quit: false,
            subagents: Vec::new(),
            subagent_blocks: Vec::new(),
            awaiting: Vec::new(),
            starting: Vec::new(),
            spinner_frame: 0,
            last_spinner_advance: Instant::now(),
            tokens_per_sec: None,
            turn_output_tokens: 0,
            turn_prompt_tokens: 0,
            transcript_rect: Rect::default(),
            last_scroll: 0,
            row_index: Vec::new(),
            run_started: None,
            selection: None,
            copy_armed: false,
            copy_request: None,
            copied: None,
            message_queue: std::collections::VecDeque::new(),
            todos: crate::core::agent::todo::TodoList::default(),
            todo_call_this_turn: false,
            todo_ok_this_turn: false,
            last_todo_reminder: None,
            reminder_count: 0,
            reminder_awaiting_progress: false,
        }
    }

    /// The permission request currently shown/answerable, if any (the front of
    /// `pending_queue`). Later queued requests stay hidden until this resolves.
    fn pending(&self) -> Option<&Pending> {
        self.pending_queue.front()
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
        self.transcript.push(Row::line(line));
    }

    fn push_row(&mut self, row: impl Into<Row>) {
        self.transcript.push(row.into());
    }

    /// Insert a blank separator when the block *band* changes, then record the
    /// kind. Keeps consecutive same-kind lines tight while spacing turn
    /// boundaries.
    fn gap(&mut self, next: Kind) {
        let last_blank = self.transcript.last().map(Row::is_blank).unwrap_or(true);
        if !self.transcript.is_empty() && band(self.last_kind) != band(next) && !last_blank {
            self.transcript.push(Row::line(Line::raw("")));
        }
        self.last_kind = next;
    }

    /// Drop the current conversation and all transient turn state, detaching from
    /// the saved thread so the next message starts a fresh one. Backs `/clear` and
    /// `/new`; the model/MCP setup and picker state are untouched.
    fn reset_session(&mut self) {
        self.history.clear();
        self.thread_id = None;
        // A fresh session drops any active goal along with the conversation.
        self.goal = None;
        self.goal_eval_pending = false;
        // Detach snapshots; the next submit arms a fresh base + thread id.
        self.base_snapshot = None;
        self.checkpoints.clear();
        self.snap_queue.clear();
        self.base_requested = false;
        self.last_esc = None;
        self.transcript.clear();
        self.display_log.clear();
        self.tool_group = None;
        self.grouped_ids.clear();
        self.starting.clear();
        self.groups.clear();
        self.pending_rows.clear();
        self.reasoning_blocks.clear();
        self.subagent_blocks.clear();
        self.subagents.clear();
        self.expanded.clear();
        self.reveal = None;
        self.assistant_buf.clear();
        self.message_queue.clear();
        self.pending_queue.clear();
        self.ask_queue.clear();
        self.pending_images.clear();
        self.tokens = 0;
        self.tokens_per_sec = None;
        self.turn = (0, 0);
        self.detail.clear();
        self.scrollback = 0;
        self.last_kind = Kind::None;
        // A fresh session drops the todo projection and reminder state; the
        // model re-declares work with a new `todo init`.
        self.todos = crate::core::agent::todo::TodoList::default();
        self.todos_closed_at = None;
        self.todo_call_this_turn = false;
        self.todo_ok_this_turn = false;
        self.last_todo_reminder = None;
        self.reminder_count = 0;
        self.reminder_awaiting_progress = false;
    }

    /// Drop any selection, and with it a copy armed but not yet lifted out of a
    /// frame -- otherwise it would fire against whatever is selected next.
    fn clear_selection(&mut self) {
        self.selection = None;
        self.copy_armed = false;
    }

    /// Line count of a copy recent enough to still advertise, if any.
    fn copy_notice(&self) -> Option<usize> {
        self.copied
            .filter(|(at, _)| at.elapsed() < COPY_NOTICE)
            .map(|(_, lines)| lines)
    }

    /// Open the session with the splash: the wordmark, this session's project
    /// and approval mode, and where to go next.
    fn push_banner(&mut self, tools: &str, awaiting_first_message: bool) {
        let banner = Banner {
            version: super::updater::build_version(),
            project: tilde_path(&self.project_root),
            branch: self.git_branch.clone(),
            tools: tools.to_string(),
            awaiting_first_message,
        };
        self.gap(Kind::Meta);
        self.push_row(RowKind::Banner(Box::new(banner)));
        // Whatever follows -- a startup note, or the first message -- gets a
        // blank line off the splash instead of butting against its last row.
        self.last_kind = Kind::None;
    }

    /// Append a line the *app* is saying, in its own gutter column. Every other
    /// transcript class owns one (`› ` user, `│ ` tool, `┊ ` reasoning), so
    /// without it a note is indistinguishable from model prose. `glyph` names the
    /// category and `level` carries severity.
    fn system_marked(&mut self, glyph: &'static str, level: Level, text: &str) {
        self.scrollback = 0;
        self.gap(Kind::Meta);
        let (gutter, body) = level.styles();
        self.push_row(RowKind::System {
            glyph,
            cont: " ",
            gutter,
            body: vec![Span::styled(text.to_string(), body)],
        });
    }

    fn system(&mut self, level: Level, text: &str) {
        self.system_marked(SYSTEM_GLYPH, level, text);
    }

    /// A dim informational note: the common case, and what every `/command`
    /// acknowledgement and background result goes through.
    fn note(&mut self, text: &str) {
        self.system(Level::Info, text);
    }

    /// A body row of a multi-line system block (`/help`, `/threads`, a goal
    /// status), under the header its `system*` call pushed. The gutter keeps
    /// running so the block reads as one unit instead of leaving its body
    /// unattributed, and the body starts in the header's column.
    ///
    /// Fixed dim styling rather than the header's `Level`: blocks are
    /// informational -- a warning or an error is a single line.
    fn system_detail(&mut self, body: Vec<Span<'static>>) {
        self.push_row(RowKind::System {
            glyph: SYSTEM_CONT,
            cont: SYSTEM_CONT,
            gutter: Style::new().dark_gray(),
            body,
        });
    }

    fn system_detail_text(&mut self, text: &str) {
        self.system_detail(vec![Span::styled(text.to_string(), Style::new().dim())]);
    }

    fn flush_assistant(&mut self) {
        let text = self.assistant_buf.trim_end().to_string();
        self.assistant_buf.clear();
        // The buffered stream is committed: any open reasoning window closes
        // (its elapsed time was stashed when the block itself closed, so this
        // only matters for a flush that happens mid-block, e.g. a tool call).
        self.thinking_since = None;
        // No-op (and, crucially, don't finalize the tool group) on an empty or
        // whitespace-only buffer, so silent consecutive tool calls keep folding.
        if !assistant_has_content(&text) {
            return;
        }
        // Model prose ends the current run of tool calls.
        self.finalize_tool_group();
        // Journaled with its `<think>` markers intact: this is the only place the
        // reasoning exists (it is kept out of `history` on purpose), and the
        // replay folds it exactly as the live turn did.
        self.display_log.push(DisplayEntry::Assistant {
            text: text.clone(),
        });
        self.push_assistant_blocks(&text);
    }

    /// Commit assistant `text` to the transcript in emission order: answer prose
    /// through markdown, each `<think>` block folded to a one-line summary row
    /// whose full dimmed detail is retained for expansion.
    fn push_assistant_blocks(&mut self, text: &str) {
        let text = strip_system_xml_tags(text);
        for (reasoning, seg) in split_reasoning(&text) {
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
                if self.show_reasoning {
                    self.transcript.extend(detail.into_iter().map(Row::line));
                } else {
                    self.push(reasoning_summary_row(detail.len()));
                    let idx = self.transcript.len() - 1;
                    self.reasoning_blocks.push(ReasoningBlock { idx, detail });
                }
            } else {
                // Kept as source: the markdown re-wraps at the draw width, so a
                // resize re-flows tables and code blocks instead of stranding
                // them at the width they were committed at. Markup that renders
                // to nothing (a bare HTML comment) still emits no row.
                let row: Row = RowKind::Markdown(seg.to_string()).into();
                if !row.lines(self.render_width()).is_empty() {
                    self.gap(Kind::Prose);
                    self.push_row(row);
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
            activity: label.clone(),
            done: done.clone(),
            content: None,
            is_error: false,
            diff: None,
        };
        let extend = self
            .tool_group
            .as_ref()
            .is_some_and(|g| g.idx < self.transcript.len());
        if extend {
            let g = self.tool_group.as_mut().expect("group checked above");
            g.nouns.push((noun, is_read));
            g.calls.push(call);
            self.refresh_group_row();
            return;
        }
        self.gap(Kind::Tool);
        self.push_row(RowKind::Tool {
            tag: "▸".to_string(),
            tag_style: Style::new().cyan(),
            label,
            label_style: Style::new().cyan().dim(),
            reserve: TOOL_ROW_RESERVE,
        });
        self.tool_group = Some(ToolGroup {
            idx: self.transcript.len() - 1,
            first_done: done,
            nouns: vec![(noun, is_read)],
            calls: vec![call],
            started: Instant::now(),
            last_result_error: None,
        });
    }

    /// Rewrite the open group's row for its current state, leaving it open so
    /// later calls keep folding in. Called as each result lands so the status
    /// resolves then, rather than lagging until the group closes (which only
    /// happens once the model starts answering).
    fn refresh_group_row(&mut self) {
        let Some((idx, row)) = self
            .tool_group
            .as_ref()
            .filter(|g| g.idx < self.transcript.len())
            .map(|g| (g.idx, g.row(GroupRow::Open)))
        else {
            return;
        };
        self.transcript[idx] = row;
    }

    /// Close the current tool group, rewriting its row to a short summary: the
    /// single activity label for one call, else a counted breakdown.
    fn finalize_tool_group(&mut self) {
        self.close_tool_group(false);
    }

    /// `interrupted` marks calls that never received a result as unresolved
    /// rather than done. Only an abort knows that: a normal finalize can land
    /// while a call is legitimately still running (a `dispatch_subagent`
    /// resolves after its child's panel opens).
    fn close_tool_group(&mut self, interrupted: bool) {
        let Some(g) = self.tool_group.take() else {
            return;
        };
        if g.idx >= self.transcript.len() {
            return;
        }
        let state = if interrupted {
            GroupRow::Aborted
        } else {
            GroupRow::Closed
        };
        self.transcript[g.idx] = g.row(state);
        self.groups.push(g);
    }

    /// Fold one finished child into a summary row, retaining its call list so
    /// the row can expand back to it (like a tool group). `finished` separates a
    /// clean `SubagentEnd` from a child the run ended out from under.
    fn push_subagent_summary(&mut self, name: &str, calls: Vec<String>, finished: bool) {
        self.display_log.push(DisplayEntry::Subagent {
            name: name.to_string(),
            calls: calls.clone(),
            finished,
        });
        let total = calls.len();
        let noun = if total == 1 { "call" } else { "calls" };
        let verb = if finished { "finished" } else { "interrupted" };
        let style = if finished {
            Style::new().magenta().dim()
        } else {
            Style::new().yellow()
        };
        self.gap(Kind::Tool);
        self.push_row(RowKind::Tool {
            tag: "↲".to_string(),
            tag_style: style,
            label: format!("subagent {name} {verb} ({total} tool {noun})"),
            label_style: if finished { style } else { Style::new().dim() },
            reserve: TOOL_ROW_RESERVE,
        });
        if total > 0 {
            let idx = self.transcript.len() - 1;
            self.subagent_blocks.push(SubagentBlock { idx, calls });
        }
    }

    /// Close every live child panel, for a run that ended without their own
    /// `SubagentEnd` events (an upstream error mid-fan-out, a `Done` that beats
    /// the children, a cancel). The panel is live state and must not outlive the
    /// run -- a stranded block spins in the dock on an idle session -- but a
    /// child that did work still earns its summary row, so the calls it made are
    /// accounted for rather than vanishing with the panel.
    fn close_live_subagents(&mut self) {
        for panel in std::mem::take(&mut self.subagents) {
            self.push_subagent_summary(&panel.name, panel.calls, false);
        }
        self.awaiting.clear();
    }

    /// Rewrite a standalone tool row to its resolved form once its result lands:
    /// past-tense label plus an outcome tag, matching how a tool group's row
    /// resolves. Without this a finished `edit` keeps reading as "Editing X".
    /// Returns whether the row was found and rewritten.
    fn resolve_pending_row(&mut self, id: &str, is_error: bool) -> bool {
        let Some(pos) = self.pending_rows.iter().position(|row| row.id == id) else {
            return false;
        };
        let row = self.pending_rows.remove(pos);
        if row.idx >= self.transcript.len() {
            return false;
        }
        let (tag, tag_style) = if is_error {
            ("✗", Style::new().red())
        } else {
            ("✓", Style::new().green())
        };
        self.transcript[row.idx] = RowKind::Tool {
            tag: tag.to_string(),
            tag_style,
            label: row.done,
            label_style: Style::new().dim(),
            reserve: TOOL_ROW_RESERVE,
        }
        .into();
        true
    }

    /// Resolve every row still awaiting a result: the run ended (cancel, error,
    /// aborted stream) and no `ToolResult` is coming, so a `▸`/`✓` would read as
    /// work that is still running or that succeeded.
    fn abort_tool_rows(&mut self) {
        self.close_tool_group(true);
        self.resolve_orphan_tool_rows();
    }

    /// Retire every in-flight tool row the stream will never speak for again.
    /// Shared by the abort paths and by `on_done`: a run that ends normally can
    /// still leave both behind (an upstream that stops mid tool call, or a soft
    /// stop that returns before the calls are dispatched), and neither a
    /// "Preparing X" throbber nor a `▸` row has anything left to resolve it.
    fn resolve_orphan_tool_rows(&mut self) {
        // A call whose args were still streaming never gets its "Preparing X"
        // throbber cleared by the `ToolCall` that would have superseded it, so
        // it animates on past the end of the run, naming a tool that never ran.
        self.starting.clear();
        // Same for a wait whose `ToolResult` never landed: its child cannot
        // outlive the run, so the row has nothing left to wait for.
        self.awaiting.clear();
        for row in std::mem::take(&mut self.pending_rows) {
            if row.idx < self.transcript.len() {
                self.transcript[row.idx] = RowKind::Tool {
                    tag: "○".to_string(),
                    tag_style: Style::new().yellow(),
                    label: row.label,
                    label_style: Style::new().dim(),
                    reserve: TOOL_ROW_RESERVE,
                }
                .into();
            }
        }
    }

    /// Stamp the moment the plan ran out of open work, and clear the stamp the
    /// moment it has some again. Called once per frame rather than at each
    /// mutation site, so the four places that write `todos` cannot disagree.
    fn refresh_todo_deadline(&mut self) {
        if self.todos.is_empty() || self.todos.has_open() {
            self.todos_closed_at = None;
        } else if self.todos_closed_at.is_none() {
            self.todos_closed_at = Some(Instant::now());
        }
    }

    /// True once a fully checked-off plan has sat closed for `TODO_HIDE_AFTER`.
    /// Only the dock hides: the list still exists, `/todo` still opens it, and
    /// `age_closed_todos` still owns actually dropping it. A finished plan stops
    /// being live state the moment it is read, and holding those rows costs the
    /// conversation the space they take.
    fn todos_expired(&self) -> bool {
        self.todos_closed_at
            .is_some_and(|closed| closed.elapsed() >= TODO_HIDE_AFTER)
    }

    /// True while a reasoning block is streaming with folding on: the one
    /// stretch of a run that puts nothing on screen, so the header badge is the
    /// only place progress can show.
    fn is_thinking(&self) -> bool {
        self.status != Status::Idle && !self.show_reasoning && thinking_open(&self.assistant_buf)
    }

    /// Header status while a turn is running with reasoning folding on:
    /// `[thinking]` while a reasoning block is actively streaming, `[thought for
    /// Ns]` for a short while after a block closes, then back to `None` (the
    /// plain `[working]`) once the model is working again. `None` when no
    /// reasoning has happened recently this turn.
    fn reasoning_status(&self) -> Option<(String, Style)> {
        if thinking_open(&self.assistant_buf) {
            Some(("thinking".to_string(), Style::new().yellow().bold()))
        } else {
            // The summary is transient: it lasts only `THOUGHT_FOR_TTL` after the
            // block closed, so a long tool call or answer prose falls back to the
            // plain [working] instead of pinning [thought for Ns] till turn end.
            match (self.thought_for, self.thought_for_since) {
                (Some(d), Some(since)) if since.elapsed() < THOUGHT_FOR_TTL => {
                    Some((
                        format!("thought for {}", format_elapsed(d.as_secs())),
                        Style::new().yellow(),
                    ))
                }
                _ => None,
            }
        }
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

    /// Toggle a single collapsed region by its transcript row index (a click on
    /// its summary row); no-op if `idx` isn't an expandable region.
    fn toggle_region(&mut self, idx: usize) {
        let is_region = self.groups.iter().any(|g| g.idx == idx)
            || self.reasoning_blocks.iter().any(|r| r.idx == idx)
            || self.subagent_blocks.iter().any(|b| b.idx == idx)
            || self.tool_group.as_ref().is_some_and(|g| g.idx == idx);
        if !is_region {
            return;
        }
        if !self.expanded.remove(&idx) {
            self.expanded.insert(idx);
        }
    }

    fn input_clear(&mut self) {
        self.input.clear();
        self.cursor = 0;
        self.reset_slash_hint();
        self.path_hints.clear();
        self.path_hint_selected = 0;
        self.reset_recall();
    }

    /// Leave recall: the next Up starts again from the newest entry.
    fn reset_recall(&mut self) {
        self.recall_pos = None;
    }

    /// Record a submitted line for recall, skipping a repeat of the newest entry.
    fn record_submitted(&mut self, text: &str) {
        if self.input_history.last().map(String::as_str) != Some(text) {
            self.input_history.push(text.to_string());
        }
        self.reset_recall();
    }

    /// Replace the buffer with a recalled entry, caret at the end.
    fn set_input(&mut self, text: String) {
        self.input = text;
        self.cursor = self.input.len();
        self.reset_slash_hint();
        self.path_hints.clear();
        self.path_hint_selected = 0;
    }

    /// Up: step back through submitted messages. Recall only starts on an empty
    /// buffer, so Up still scrolls the transcript while something is typed;
    /// once recalling, it keeps stepping even though the buffer is now full.
    /// Returns false when the key should fall through to scrollback.
    fn recall_prev(&mut self) -> bool {
        if self.input_history.is_empty() {
            return false;
        }
        match self.recall_pos {
            Some(pos) => {
                let next = pos.saturating_sub(1);
                self.recall_pos = Some(next);
                self.set_input(self.input_history[next].clone());
            }
            None => {
                if !self.input.is_empty() {
                    return false;
                }
                let last = self.input_history.len() - 1;
                self.recall_pos = Some(last);
                self.set_input(self.input_history[last].clone());
            }
        }
        true
    }

    /// Down: step forward through recalled messages; past the newest, the
    /// composer returns to an empty new message (recall only ever starts from
    /// an empty buffer, so there is no draft to restore). Returns false when
    /// not recalling, so Down still scrolls the transcript.
    fn recall_next(&mut self) -> bool {
        let Some(pos) = self.recall_pos else {
            return false;
        };
        if pos + 1 < self.input_history.len() {
            self.recall_pos = Some(pos + 1);
            self.set_input(self.input_history[pos + 1].clone());
        } else {
            self.input_clear();
        }
        true
    }

    fn input_insert(&mut self, c: char) {
        // Tab must never be inserted as a literal character; some terminals
        // deliver it as KeyCode::Char('\t') instead of KeyCode::Tab.
        if c == '\t' {
            return;
        }
        self.input.insert(self.cursor, c);
        self.cursor += c.len_utf8();
        self.reset_slash_hint();
        // Refresh path hints on any character edit
        self.refresh_path_hints();
    }

    /// Delete the char before the caret (Backspace).
    fn input_backspace(&mut self) {
        if let Some(prev) = self.input[..self.cursor].chars().next_back() {
            self.cursor -= prev.len_utf8();
            self.input.remove(self.cursor);
        }
        self.reset_slash_hint();
        self.refresh_path_hints();
    }

    /// Delete the char at the caret (Delete); caret stays put.
    fn input_delete(&mut self) {
        if self.cursor < self.input.len() {
            self.input.remove(self.cursor);
        }
        self.reset_slash_hint();
        self.refresh_path_hints();
    }

    /// Reset hint selection and un-dismiss so an edited buffer re-shows the popup.
    fn reset_slash_hint(&mut self) {
        self.slash_selected = 0;
        self.slash_dismissed = false;
        self.path_hint_dismissed = false;
    }

    /// Slash commands and installed project skills whose name prefixes the
    /// current buffer, or empty when the popup should not show: not idle,
    /// buffer isn't a bare `/name` token (no whitespace yet), the popup was
    /// Esc-dismissed, or nothing matches. Skills honor the `[skills].enabled`
    /// whitelist exactly like the model-facing `skill_list` tool, so the popup
    /// never offers a skill the agent cannot see.
    fn slash_matches(&self) -> Vec<SlashMatch> {
        if self.status != Status::Idle
            || self.slash_dismissed
            || !self.input.starts_with('/')
            || self.input.chars().any(char::is_whitespace)
        {
            return Vec::new();
        }
        let mut out: Vec<SlashMatch> = SLASH_COMMANDS
            .iter()
            .filter(|c| c.name.starts_with(&self.input))
            .map(SlashMatch::Command)
            .collect();
        // A command wins a name collision: a skill named `cancel` is dropped
        // from the short form (it could never run - the command arm wins) but
        // stays reachable via its unambiguous `/skill:cancel` form.
        let taken: std::collections::HashSet<&str> = out
            .iter()
            .filter_map(|m| match m {
                SlashMatch::Command(c) => Some(c.name),
                SlashMatch::Skill { .. } => None,
            })
            .collect();
        let colon_form = self.input.starts_with("/skill:");
        let enabled = crate::core::agent::project::load_agent_config(&self.project_root)
            .ok()
            .map(|c| c.skills.enabled)
            .unwrap_or_default();
        for meta in crate::core::agent::skills::catalog(&self.project_root, &enabled) {
            let name = if colon_form {
                format!("/skill:{}", meta.name)
            } else {
                format!("/{}", meta.name)
            };
            if name.starts_with(&self.input)
                && (colon_form || !taken.contains(name.as_str()))
            {
                out.push(SlashMatch::Skill {
                    name,
                    description: meta.description,
                });
            }
        }
        out
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

    /// Fill the buffer with the highlighted command or skill name plus a
    /// trailing space, ready for arguments; the space hides the popup via
    /// `slash_matches`.
    fn accept_slash(&mut self) {
        let matches = self.slash_matches();
        if matches.is_empty() {
            return;
        }
        let name = matches[self.slash_selected.min(matches.len() - 1)].name();
        self.input = format!("{name} ");
        self.cursor = self.input.len();
        self.slash_selected = 0;
    }

    /// Extract the current `@query` from the input buffer, if any.
    /// Returns `None` when the cursor is not inside or immediately after
    /// a `@`-prefixed token (no space since the `@`), or when the `@` does
    /// not start a token (e.g. `user@host` is not a file reference).
    ///
    /// Supports quoted references: `@"path with spaces"` - the query is the
    /// text between the quotes, and the closing quote is optional (the user
    /// may still be typing).
    fn path_hint_query(&self) -> Option<String> {
        let before = &self.input[..self.cursor];
        let at_idx = path_refs::last_ref_start(before)?;
        let after_at = &before[at_idx + 1..];

        // Quoted reference: @"query..."
        if let Some(inner) = after_at.strip_prefix('"') {
            // If the cursor is right after the opening quote, return empty query.
            if inner.is_empty() {
                return Some(String::new());
            }
            // Find the closing quote within the typed text.
            if let Some(close) = inner.find('"') {
                // Cursor is inside or at the closing quote - extract the query.
                return Some(inner[..close].to_string());
            }
            // No closing quote yet - the user is still typing inside quotes.
            return Some(inner.to_string());
        }

        if after_at.contains(' ') {
            return None; // space after @ means the token ended
        }
        if after_at.is_empty() {
            return Some(String::new());
        }
        Some(after_at.to_string())
    }

    /// Refresh path hints from the input buffer: detect `@query`, search files.
    fn refresh_path_hints(&mut self) {
        if self.path_hint_dismissed || self.status != Status::Idle {
            self.path_hints.clear();
            return;
        }
        let Some(query) = self.path_hint_query() else {
            self.path_hints.clear();
            return;
        };

        let entries = path_refs::search_files_sync(&self.project_root, &query, 30);
        self.path_hints = entries
            .into_iter()
            .map(|(path, name, is_dir)| PathHintItem {
                path,
                name,
                is_dir,
            })
            .collect();
        self.path_hint_selected = 0;
    }

    /// Accept the highlighted path hint: replace the `@query` token with the
    /// selected path. Quoted references (`@"query"`) are replaced with the
    /// quoted form (`@"selected/path"`).
    fn accept_path_hint(&mut self) {
        if self.path_hints.is_empty() {
            return;
        }
        let sel = self.path_hint_selected.min(self.path_hints.len() - 1);
        let selected = &self.path_hints[sel];
        let before = &self.input[..self.cursor];
        let at_idx = match path_refs::last_ref_start(before) {
            Some(i) => i,
            None => return,
        };
        let after_at = &before[at_idx + 1..];
        let after = &self.input[self.cursor..];

        // Quoted reference: replace @"..." with @"selected/path"
        if after_at.starts_with('"') {
            // rest[0] is the opening quote; the closing quote may be past the
            // cursor. A missing closing quote means the user is still typing
            // the token, so delete through the end of the input.
            let rest = &self.input[at_idx + 1..];
            let full_len = rest[1..].find('"').map(|i| i + 2).unwrap_or(rest.len());
            let replacement = format!("@\"{}\"", selected.path);
            let new_input = format!(
                "{}{}{}",
                &self.input[..at_idx],
                replacement,
                &self.input[at_idx + 1 + full_len..]
            );
            self.input = new_input;
            self.cursor = at_idx + replacement.len();
        } else {
            // Replace the `@query` token but keep the `@` marker so the result
            // stays a reference, and append `/` for directories so the user
            // can keep drilling into them.
            let marker = "@";
            let path = &selected.path;
            let trailing = if selected.is_dir { "/" } else { "" };
            let replacement = format!("{marker}{path}{trailing}");
            let new_input = format!("{}{}{}", &self.input[..at_idx], replacement, after);
            self.input = new_input;
            self.cursor = at_idx + replacement.len();
        }
        self.path_hints.clear();
        self.path_hint_dismissed = false;
    }

    fn path_hint_move(&mut self, delta: isize) {
        if self.path_hints.is_empty() {
            return;
        }
        let len = self.path_hints.len();
        let cur = self.path_hint_selected.min(len - 1) as isize;
        self.path_hint_selected = (cur + delta).rem_euclid(len as isize) as usize;
    }

    /// True when the path-hint popup has entries to show.
    fn has_path_hints(&self) -> bool {
        if self.path_hint_dismissed || self.status != Status::Idle {
            return false;
        }
        self.path_hint_query().is_some() && !self.path_hints.is_empty()
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
    /// When already running, the message is enqueued instead and auto-submitted
    /// when the current turn finishes.
    /// Advance the spinner by however many whole `SPINNER_ADVANCE_MS` frames
    /// have elapsed since the last advance (0 if under one frame, >1 on catch-up
    /// after a stalled tick). The baseline moves forward by whole frames only so
    /// leftover sub-frame milliseconds are not lost across ticks.
    fn advance_spinner(&mut self, now: Instant) {
        let elapsed = now.duration_since(self.last_spinner_advance).as_millis() as u64;
        let frames = (elapsed / SPINNER_ADVANCE_MS) as usize;
        if frames > 0 {
            self.spinner_frame = self.spinner_frame.wrapping_add(frames);
            self.last_spinner_advance += Duration::from_millis(frames as u64 * SPINNER_ADVANCE_MS);
        }
    }

    fn submit_user(&mut self, text: String) {
        self.submit_user_text(text, true)
    }

    /// Start a user turn whose text the model sees but the transcript never
    /// shows. For commands that expand into a long canned prompt (`/init`): the
    /// command's own note already says what is happening, and pasting the
    /// prompt body into the transcript is noise. Hidden turns leave
    /// `pending_images` staged for the user's next real message rather than
    /// attaching them to a prompt they did not write.
    fn submit_user_hidden(&mut self, text: String) {
        self.submit_user_text(text, false)
    }

    fn submit_user_text(&mut self, text: String, display: bool) {
        if self.model.is_empty() {
            self.note("not signed in — run /login to sign in to Tokamak first");
            return;
        }
        // If a turn is already in progress, enqueue the message instead
        if self.status == Status::Running {
            self.message_queue.push_back(text.clone());
            self.note(&format!("⏳ message queued ({} in queue)", self.message_queue.len()));
            return;
        }
        // Mid-prompt `/skill:<name>` token: dispatch to the skill, threading
        // the surrounding prose as its arguments (queued messages re-enter
        // this method via `dequeue_next`, so the token is re-parsed there too).
        if let Some((name, args)) = crate::core::agent::skills::parse_invocation(&text) {
            if self.dispatch_skill(&name, &args) {
                return;
            }
        }
        self.ensure_base_snapshot();
        let images = if display {
            std::mem::take(&mut self.pending_images)
        } else {
            Vec::new()
        };
        let names: Vec<String> = images.iter().map(|i| i.name.clone()).collect();
        // Resolve @path file references before sending
        let (clean_text, injected_contents) =
            path_refs::resolve_references(&text, &self.project_root);
        let final_text = if injected_contents.is_empty() {
            clean_text
        } else {
            format!("{clean_text}\n\n---\nReferenced file contents:\n\n{injected_contents}")
        };
        self.history.push(build_user_message(&final_text, &images));
        if display {
            self.push_user_line(&text, &names);
            // The typed text, not `final_text`: `@path` expansions are context
            // for the model, and the row never showed them.
            self.display_log.push(DisplayEntry::User {
                text: text.clone(),
                images: names,
            });
        }
        self.begin_turn();
        // A fresh user turn is new context: allow the next boundary to remind
        // again even if the open work is unchanged (dedup is "twice in a row"),
        // and rearm the per-cycle reminder budget. A reminder's own follow-up
        // turn (`submit_reminder`, below) deliberately does NOT reset these --
        // the count must persist across the very continuation it triggers, or
        // the cap could never actually be reached.
        self.last_todo_reminder = None;
        self.reminder_count = 0;
        self.reminder_awaiting_progress = false;
        // A fresh turn gets a fresh overflow-recovery budget: the previous
        // turn's failures say nothing about this one's size.
        self.overflow_retries = 0;
        self.want_start = true;
        self.persist();
    }

    /// Invoke an enabled project skill by name: load its full instructions and
    /// submit them as the user message so the agent follows the procedure
    /// directly (no `skill_read` round trip). The transcript shows one compact
    /// `[skill:<name>]` row with the user's args, never the body text. `args`
    /// are threaded into the message like a command's arguments. Returns false
    /// when the skill is unknown or disabled, leaving the caller to treat the
    /// text as a plain message. Message assembly lives in
    /// `skills::build_invocation_message` so other UIs (desktop/web) invoke
    /// skills with identical semantics.
    fn dispatch_skill(&mut self, name: &str, args: &str) -> bool {
        let root = &self.project_root;
        let (msg, description) =
            match crate::core::agent::skills::build_invocation_message(root, name, args) {
                Ok(pair) => pair,
                Err(_) => return false,
            };
        let args = args.trim();
        self.history
            .push(serde_json::json!({ "role": "user", "content": msg }));
        let mut spans = vec![Span::styled("› ", Style::new().light_magenta().bold())];
        spans.push(Span::styled(
            format!("[skill:{name}]"),
            Style::new().cyan().bold(),
        ));
        if !args.is_empty() {
            spans.push(Span::raw(format!(" {args}")));
        } else if !description.is_empty() {
            spans.push(Span::raw(format!(" - {description}")));
        }
        self.gap(Kind::User);
        self.push(Line::from(spans));
        self.begin_turn();
        // A fresh user turn is new context: same reminder reset as submit_user.
        self.last_todo_reminder = None;
        self.reminder_count = 0;
        self.reminder_awaiting_progress = false;
        self.want_start = true;
        self.persist();
        true
    }

    /// Inject a hidden todo reminder and continue with one more model turn. The
    /// reminder text enters the conversation (so the model sees it) but renders
    /// as a dim system note, never a user-authored transcript row.
    fn submit_reminder(&mut self, text: String) {
        self.history
            .push(serde_json::json!({ "role": "user", "content": text }));
        self.note("todo reminder — unfinished work, continuing");
        self.begin_turn();
        self.want_start = true;
        self.persist();
    }

    /// Reminder policy (spec: one bounded reminder at a clean turn boundary).
    /// Fires at most one hidden reminder when open work remains and the assistant
    /// yielded as if finished. Suppressed while an ask/permission is pending, a
    /// goal/plan transition already queued the next turn, another message is
    /// armed, the agent already updated todos this turn, the assistant's own
    /// final text is itself asking the user something, a prior reminder is
    /// still unanswered, or the per-cycle reminder budget is spent. A todo
    /// mutation that failed this turn queues one retry reminder instead.
    fn maybe_inject_todo_reminder(&mut self, normal: bool, no_answer: bool, answer: &str) {
        /// Reminders fired per prompt cycle before the policy goes quiet, even
        /// if the open-work summary keeps changing slightly (the same-summary
        /// dedup below only catches an unchanged summary, not a moving one).
        const TODO_REMINDER_MAX: u32 = 3;
        // A goal/plan continuation or a queued message already owns the next
        // turn; a pending ask/permission blocks the boundary; plan mode is a
        // read-only exploration where todos are only staged for handoff.
        if self.want_start
            || self.goal_eval_pending
            || self.run_mode == crate::core::agent::plan::RunMode::Plan
            || !self.ask_queue.is_empty()
        {
            return;
        }
        let failed = self.todo_call_this_turn && !self.todo_ok_this_turn;
        if !failed {
            // The agent actively managed todos this turn (or the turn ended
            // abnormally/emptily): don't nag.
            if self.todo_call_this_turn || !normal || no_answer {
                return;
            }
        }
        // The assistant may be legitimately waiting on the user (a plain-text
        // question, or a "let me know"/"please confirm" cue) rather than
        // idling mid-task -- nudging "keep working" here would talk over its
        // own question.
        if assistant_is_awaiting_user_answer(answer) {
            return;
        }
        // A prior reminder hasn't seen any follow-up action yet, or the
        // per-cycle budget is already spent: stay silent rather than pile on.
        if self.reminder_awaiting_progress || self.reminder_count >= TODO_REMINDER_MAX {
            return;
        }
        let Some(summary) = self.todos.open_summary() else {
            return;
        };
        // Dedup: the same open-work summary never reminds twice in a row.
        if self.last_todo_reminder.as_deref() == Some(summary.as_str()) {
            return;
        }
        let text = if failed {
            format!(
                "Reminder: your last todo update failed and unfinished work remains:\n{summary}\n\nRetry the update or continue the work; call `todo` to record progress."
            )
        } else {
            format!(
                "Reminder: unfinished todos remain:\n{summary}\n\nContinue the work, or call `todo` to mark items done/abandoned."
            )
        };
        self.last_todo_reminder = Some(summary);
        self.reminder_count += 1;
        self.reminder_awaiting_progress = true;
        self.submit_reminder(text);
    }

    /// Dequeue the next message from the queue and submit it. Called after
    /// `on_done` / `on_error` / `cancel_run` to continue processing.
    fn dequeue_next(&mut self) {
        if self.message_queue.is_empty() {
            return;
        }
        let next = self.message_queue.pop_front().expect("checked non-empty above");
        if !next.is_empty() {
            self.note(&format!(
                "⏩ dequeuing next message ({} remaining)",
                self.message_queue.len()
            ));
            self.submit_user(next);
        }
    }

    /// Render a user turn: the prompt line, then one dotted connector row per
    /// attached image ending in an `[IMAGE]` label (basename when known).
    fn push_user_line(&mut self, text: &str, images: &[String]) {
        self.gap(Kind::User);
        self.push(Line::from(vec![
            Span::styled("› ", Style::new().light_magenta().bold()),
            Span::styled(text.to_string(), Style::new().bold()),
        ]));
        for name in images {
            let label = if name.is_empty() {
                "[IMAGE]".to_string()
            } else {
                format!("[IMAGE] {name}")
            };
            self.push(Line::from(vec![
                Span::styled("  ┊ ", Style::new().dim()),
                Span::styled(label, Style::new().cyan()),
            ]));
        }
    }

    /// Stage the OS clipboard's image for the next message, noting the result.
    fn attach_clipboard_image(&mut self) {
        match clipboard_image() {
            Ok(img) => {
                let name = img.name.clone();
                self.pending_images.push(img);
                self.note(&format!(
                    "attached {name} ({} image(s) pending)",
                    self.pending_images.len()
                ));
            }
            Err(e) => self.note(&format!("no image in clipboard: {e}")),
        }
    }

    fn body(&self) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": self.history,
            "max_session_tokens": self.max_session_tokens,
            "stream": true,
        });
        // Forward the per-request output cap only when configured; it reaches
        // the upstream via `copy_optional_chat_params`.
        if let Some(max) = self.max_tokens {
            body["max_tokens"] = serde_json::json!(max);
        }
        // Live plan-mode toggle: the backend reads this per turn and falls back
        // to the session default when absent. Only forwarded in Plan so normal
        // turns keep an unchanged body.
        if self.run_mode == crate::core::agent::plan::RunMode::Plan {
            body["run_mode"] = serde_json::to_value(self.run_mode).unwrap_or(serde_json::Value::Null);
        }
        // Only an active `/goal` forces the model to stage a todo plan; a normal
        // turn leaves that to its own judgement. Forwarded only while the goal
        // runs, so an achieved or cleared goal reverts to an unchanged body.
        if self.goal.as_ref().is_some_and(|g| g.is_active()) {
            body["goal_mode"] = serde_json::json!(true);
        }
        body
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
        // Persist metadata when snapshots, a goal, or plan mode are present; each
        // must survive restart/resume even in a non-git project (no snapshots).
        let planning = self.run_mode == crate::core::agent::plan::RunMode::Plan;
        if self.base_snapshot.is_none()
            && self.goal.is_none()
            && !planning
            && self.todos.is_empty()
        {
            return None;
        }
        let mut meta = serde_json::Map::new();
        if let Some(base) = self.base_snapshot.as_ref() {
            meta.insert("base_snapshot".to_string(), serde_json::json!(base));
            meta.insert("checkpoints".to_string(), serde_json::json!(self.checkpoints));
        }
        if let Some(goal) = self.goal.as_ref() {
            meta.insert(
                "goal".to_string(),
                serde_json::to_value(goal).unwrap_or(serde_json::Value::Null),
            );
        }
        // Only persisted in Plan (Normal is the default; keeps old threads clean).
        if planning {
            meta.insert(
                "run_mode".to_string(),
                serde_json::to_value(self.run_mode).unwrap_or(serde_json::Value::Null),
            );
        }
        // Persist the canonical todos so resume/branch reconstructs the list.
        if !self.todos.is_empty() {
            meta.insert(
                "todos".to_string(),
                serde_json::to_value(&self.todos).unwrap_or(serde_json::Value::Null),
            );
        }
        Some(serde_json::Value::Object(meta))
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
            Ok(id) => {
                self.thread_id = Some(id);
                self.dump_display_log();
            }
            Err(e) => self.detail = format!("save failed: {e}"),
        }
    }

    /// Hand the rendered transcript to the writer thread, so a turn boundary (or
    /// a cancel) leaves a resumable journal without a frame paying for the write.
    fn dump_display_log(&mut self) {
        let Some(id) = self.thread_id.clone() else {
            return;
        };
        let path = journal::journal_path(&self.agent_dir, &id);
        self.journal_writer
            .get_or_insert_with(journal::Writer::new)
            .dump(path, self.display_log.clone());
    }

    /// Wait for queued journal dumps to reach disk (session exit, tests).
    fn join_journal(&mut self) {
        if let Some(writer) = self.journal_writer.as_mut() {
            writer.join();
        }
        self.journal_writer = None;
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
                // Track the live thinking state so the header can fold reasoning
                // to `[thinking]` / `[thought for Ns]`. Start the timer when a
                //  block opens; close it (stashing the duration) once the block
                // closes or the tool group proceeds.
                let open = thinking_open(&self.assistant_buf);
                if open && self.thinking_since.is_none() {
                    self.thinking_since = Some(Instant::now());
                } else if !open {
                    if let Some(started) = self.thinking_since.take() {
                        self.thought_for = Some(started.elapsed());
                        self.thought_for_since = Some(Instant::now());
                    }
                }
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
                self.starting.clear();
                self.turn = (index, max);
            }
            StreamEvent::ToolCallStarted { id, name } => {
                // Commit buffered prose/reasoning so it renders above the
                // in-progress throbber, matching the grouped-call ordering.
                self.flush_assistant();
                if !self.starting.iter().any(|c| c.id == id) {
                    self.starting.push(StartingCall::new(id, name));
                }
            }
            StreamEvent::ToolCallArgsDelta { id, delta } => {
                if let Some(call) = self.starting.iter_mut().find(|c| c.id == id) {
                    call.args.push_str(&delta);
                }
            }
            StreamEvent::ToolCall { id, name, args } => {
                // The full call (with parsed args) supersedes its in-progress
                // throbber.
                self.starting.retain(|c| c.id != id);
                // Commit buffered prose/reasoning before anything else: every
                // branch below does it anyway (so the timeline stays in emission
                // order), and doing it here keeps the journal in that order too
                // -- text that preceded the call, then the call. `flush_assistant`
                // no-ops on an empty buffer, so silent consecutive calls still
                // fold into one group row.
                self.flush_assistant();
                // `await_subagent` renders a live throbber that its result
                // clears, so journaling the call would replay a spinner nothing
                // ever stops; its result row is journaled below either way.
                if name != "await_subagent" {
                    self.display_log.push(DisplayEntry::ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        args: args.clone(),
                    });
                }
                // Track todo activity this turn so the reminder policy can tell
                // an engaged turn (mutated todos) from a stalled one.
                if name == "todo" {
                    self.todo_call_this_turn = true;
                }
                // Awaiting a subagent is a long block: show a live throbber row
                // (advanced each render tick) instead of a static grouped row,
                // cleared when its result arrives.
                if name == "await_subagent" {
                    let run_id = args.get("run_id").and_then(|v| v.as_str()).unwrap_or("");
                    let sub = subagent_name_from_run_id(run_id).to_string();
                    self.awaiting.push((id, run_id.to_string(), sub));
                    return;
                }
                // Untruncated: every row that shows these clamps to the width it
                // is drawn at, so they survive a resize either way.
                let label = tool_activity(&name, &args);
                let done = tool_finished(&name, &args);
                if matches!(name.as_str(), "edit" | "write") {
                    // Record the touched path so the next checkpoint snapshots
                    // exactly this file instead of scanning the whole repo.
                    if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                        self.turn_touched.push(self.project_root.join(p));
                        self.diff_paths.insert(id.clone(), p.to_string());
                    }
                    // Diff-producing tools render standalone (call row & panel).
                    self.finalize_tool_group();
                    self.gap(Kind::Tool);
                    self.push_row(RowKind::Tool {
                        tag: "▸".to_string(),
                        tag_style: Style::new().cyan(),
                        label: label.clone(),
                        label_style: Style::new().cyan().dim(),
                        reserve: TOOL_ROW_RESERVE,
                    });
                    self.pending_rows.push(PendingToolRow {
                        id: id.clone(),
                        idx: self.transcript.len() - 1,
                        label,
                        done,
                    });
                } else {
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
                self.awaiting.retain(|(await_id, ..)| await_id != &id);
                self.display_log.push(DisplayEntry::ToolResult {
                    id: id.clone(),
                    content: content.clone(),
                    is_error,
                    diff: diff.clone(),
                });
                let resolved = self.resolve_pending_row(&id, is_error);
                // Any tool result means the model took some action since the last
                // reminder fired; let a later stop remind again if work is still
                // open. Set unconditionally, before the grouped-call early return
                // below, so it applies no matter how the result renders.
                self.reminder_awaiting_progress = false;
                // Grouped calls are already represented by the group row; retain
                // their result on the group so an expand can show it later.
                if self.grouped_ids.contains(&id) {
                    if let Some(group) = self.tool_group.as_mut() {
                        if let Some(call) = group.calls.iter_mut().find(|c| c.id == id) {
                            call.is_error = is_error;
                            call.diff = diff;
                            call.content = Some(content);
                            group.last_result_error = Some(is_error);
                        }
                    }
                    self.refresh_group_row();
                    return;
                }
                self.flush_assistant();
                let (tag, tag_style) = if is_error {
                    ("✗", Style::new().red())
                } else {
                    ("✓", Style::new().green())
                };
                let lang = diff.is_some().then(|| self.diff_paths.remove(&id)).flatten();
                // The resolved call row above already names the tool and file in
                // past tense, so a successful "Applied N edit(s) to X" only
                // repeats it; the diff is the informative part. Errors keep their
                // text -- the row says nothing about why the call failed.
                let content = (!(resolved && !is_error && diff.is_some())).then_some(content);
                self.gap(Kind::Tool);
                self.push_row(RowKind::Result {
                    tag,
                    tag_style,
                    content,
                    diff,
                    lang,
                });
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
                self.pending_queue.push_back(Pending {
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
            StreamEvent::AskRequest {
                request_id,
                request,
            } => self
                .ask_queue
                .push_back(PendingAsk::new(request_id, request)),
            StreamEvent::SubagentStart { run_id, name, task } => {
                // A queued dispatch already opened a panel for this run; promote
                // it to running instead of pushing a duplicate. Otherwise open a
                // fresh live panel (several may be active).
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    panel.queued = false;
                } else {
                    self.finalize_tool_group();
                    self.flush_assistant();
                    self.subagents.push(SubagentPanel {
                        run_id,
                        name,
                        task: task.unwrap_or_default(),
                        calls: Vec::new(),
                        requests: 0,
                        prompt_tokens: 0,
                        active: None,
                        queued: false,
                        waiting: 0,
                    });
                }
            }
            StreamEvent::SubagentQueued {
                run_id,
                name,
                task,
                waiting,
            } => {
                // The cap is exhausted; this dispatch will start when a running
                // child finishes. Open its panel now, marked queued, so the
                // fan-out shows the queue instead of hiding dispatches.
                self.finalize_tool_group();
                self.flush_assistant();
                self.subagents.push(SubagentPanel {
                    run_id,
                    name,
                    task: task.unwrap_or_default(),
                    calls: Vec::new(),
                    requests: 0,
                    prompt_tokens: 0,
                    active: None,
                    queued: true,
                    waiting,
                });
            }
            StreamEvent::SubagentEnd { run_id, name } => {
                let calls = self
                    .subagents
                    .iter()
                    .find(|p| p.run_id == run_id)
                    .map(|p| p.calls.clone())
                    .unwrap_or_default();
                self.subagents.retain(|p| p.run_id != run_id);
                self.awaiting.retain(|(_, r, _)| r != &run_id);
                self.push_subagent_summary(&name, calls, true);
            }
            StreamEvent::Subagent {
                run_id,
                name,
                event,
            } => self.apply_subagent_event(&run_id, &name, *event),
            StreamEvent::TurnUsage { usage } => {
                self.turn_output_tokens += usage.completion_tokens.unwrap_or(0);
                // Latest request's context, not a sum: each request resends the
                // whole conversation, so adding them would be meaningless.
                if let Some(prompt) = usage.prompt_tokens {
                    self.turn_prompt_tokens = prompt;
                    // Keep the header's context gauge live during the turn
                    // instead of jumping only when the run ends.
                    self.tokens = prompt + usage.completion_tokens.unwrap_or(0);
                    self.observe_prompt_tokens(prompt);
                }
            }
            StreamEvent::Done { .. } | StreamEvent::Error { .. } => {}
            StreamEvent::MessagesUpdated { messages } => {
                self.history = messages;
                self.persist();
            }
            StreamEvent::TodoUpdate { list } => {
                self.todos = list;
                // A snapshot only arrives on a successful mutation; its absence
                // after a todo call means the mutation failed (retry reminder).
                self.todo_ok_this_turn = true;
            }
        }
    }

    /// Route one backgrounded subagent's internal event to its run's live panel.
    /// Only tool calls populate the rolling window; the child's own prose/steps/
    /// results are internal. A permission request docks the shared prompt,
    /// attributed to the asking subagent.
    fn apply_subagent_event(&mut self, run_id: &str, name: &str, event: StreamEvent) {
        match event {
            StreamEvent::ToolCall {
                id, name: tool, args,
            } => {
                // Stored untruncated; the panel clamps it to the draw width.
                let label = subagent_activity(&tool, &args);
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    // The completed call supersedes its in-progress view.
                    if panel.active.as_ref().is_some_and(|c| c.id == id) {
                        panel.active = None;
                    }
                    // Full history retained for expansion; the panel renders only
                    // the last SUBAGENT_WINDOW.
                    panel.calls.push(label);
                }
            }
            // A child's arguments stream just like the parent's, and for a big
            // `write` that window is most of the run. Track it so the panel
            // reports the call being built instead of going silent until it
            // lands.
            StreamEvent::ToolCallStarted { id, name: tool } => {
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    panel.active = Some(StartingCall::new(id, tool));
                }
            }
            StreamEvent::ToolCallArgsDelta { id, delta } => {
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    if let Some(call) = panel.active.as_mut().filter(|c| c.id == id) {
                        call.args.push_str(&delta);
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
                self.pending_queue.push_back(Pending {
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
            // Each child request bumps its counter, so the panel shows work
            // happening even during a long think with no tool calls.
            StreamEvent::Step { .. } => {
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    panel.requests += 1;
                }
            }
            StreamEvent::TurnUsage { usage } => {
                if let Some(panel) = self.subagents.iter_mut().find(|p| p.run_id == run_id) {
                    panel.prompt_tokens = usage.prompt_tokens.unwrap_or(panel.prompt_tokens);
                }
            }
            // Token/ToolResult and any nested bracket are internal to the child
            // run and not surfaced in the parent transcript.
            _ => {}
        }
    }

    /// Arm the per-turn state shared by a user submit and a reminder
    /// continuation. Both paths start a run, so both must reset every
    /// turn-scoped counter -- keeping two hand-maintained copies in sync is how
    /// a new counter ends up reset on one path and accumulating on the other.
    fn begin_turn(&mut self) {
        self.status = Status::Running;
        self.run_started = Some(Instant::now());
        self.turn = (0, 0);
        self.tokens_per_sec = None;
        self.turn_output_tokens = 0;
        self.turn_prompt_tokens = 0;
        self.scrollback = 0;
        self.todo_call_this_turn = false;
        self.todo_ok_this_turn = false;
        // A fresh turn starts with no active reasoning.
        self.thinking_since = None;
        self.thought_for = None;
        self.thought_for_since = None;
        // A call cancelled before its result would otherwise leave its path
        // behind for the life of the session.
        self.diff_paths.clear();
    }

    /// Current throbber frame. `spinner_frame` is advanced on a fixed cadence
    /// by the render loop, so every animated row in a frame shows the same
    /// glyph and they turn together instead of drifting apart.
    fn spinner(&self) -> &'static str {
        SPINNER[self.spinner_frame % SPINNER.len()]
    }

    /// Flush the current turn and return its text as the final assistant answer.
    fn take_answer(&mut self) -> String {
        let answer = self.assistant_buf.trim().to_string();
        self.flush_assistant();
        answer
    }

    fn on_done(&mut self, stop_reason: String, usage: Option<Usage>) {
        self.finalize_tool_group();
        // Done is terminal: nothing more arrives on this stream, so a call that
        // never completed cannot be left animating for the rest of the session.
        self.resolve_orphan_tool_rows();
        // Children cannot outlive the run that dispatched them: their events
        // arrive on its stream. Any panel still open here never got its own
        // `SubagentEnd`.
        self.close_live_subagents();
        let answer = self.take_answer();
        let wire = answer_without_reasoning(&answer);
        if !wire.is_empty() {
            self.history
                .push(serde_json::json!({ "role": "assistant", "content": wire }));
        }
        // A closing receipt for the turn: when, how much context went up, how
        // much came back, how long it took, how fast. Cheap to skim, and the
        // only place the cost of a turn is visible after the fact.
        if let Some(started) = self.run_started {
            // Normally `TurnUsage` has already reported every request. Fall
            // back to the terminal usage only for an upstream that reports
            // nothing until the end, so the receipt isn't blank.
            if self.turn_output_tokens == 0 {
                self.turn_output_tokens =
                    usage.as_ref().and_then(|u| u.completion_tokens).unwrap_or(0);
            }
            let stats = turn_stats_line(
                self.turn_prompt_tokens,
                self.turn_output_tokens,
                started.elapsed(),
            );
            self.gap(Kind::Meta);
            self.push(stats);
        }
        // Cache this turn's output rate from the single `usage` sample and its
        // streaming duration, before `run_started` is cleared below. Holds
        // steady in the header until the next turn resets it.
        if let (Some(out), Some(started)) = (
            usage.as_ref().and_then(|u| u.completion_tokens),
            self.run_started,
        ) {
            self.tokens_per_sec =
                Some(tokens_per_second(out, started.elapsed().as_millis() as u64));
        }
        self.tokens = usage.and_then(|u| u.total_tokens).unwrap_or(self.tokens);
        self.status = Status::Idle;
        self.run_started = None;
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
            self.system(Level::Warn, &msg);
        }
        self.checkpoint_turn();
        // A turn just completed under an active goal: count it and queue an
        // evaluation. The chat loop runs the (stateless) evaluator off the
        // render loop, then auto-continues or hands control back.
        // Plan mode pauses the goal loop: never auto-continue a goal while
        // planning (spec: entering plan pauses an active goal).
        let planning = self.run_mode == crate::core::agent::plan::RunMode::Plan;
        if let Some(goal) = self.goal.as_mut() {
            if goal.is_active() && !planning {
                goal.turns = goal.turns.saturating_add(1);
                // Only evaluate on a normal completion; an early/no-answer finish
                // is surfaced above and the user decides what to do next.
                self.goal_eval_pending = normal && !no_answer;
            }
        }
        // Auto-dequeue the next queued message, if any
        self.dequeue_next();
        // Reminder policy runs last: only if nothing else already claimed the
        // next turn (goal eval, a dequeued message) and open work remains.
        self.maybe_inject_todo_reminder(normal, no_answer, &answer);
        self.persist();
    }

    /// Whether auto-compaction should trigger after a turn completes. Requires
    /// a window worth measuring against: with the configured one disproven,
    /// this would fire on every remaining turn of the session.
    fn should_auto_compact(&self) -> bool {
        let limit = self.context_window.saturating_sub(self.reserve_tokens);
        self.context_window_trusted
            && self.tokens > limit
            && self.tokens > 0
            && self.history.len() > 4
    }

    /// Fold an accepted request's prompt size into the session's view of the
    /// context window. `context_window` is a guess (`[agent].context_window`,
    /// default 128K) with nothing tying it to the model actually in use, so a
    /// prompt the provider served proves it wrong when it exceeds it -- the
    /// real window is at least this big. How much bigger is unknowable from
    /// here, so nothing is invented: the value is simply no longer used as a
    /// denominator, and the user is told once how to set it.
    fn observe_prompt_tokens(&mut self, prompt_tokens: u64) {
        if !self.context_window_trusted || prompt_tokens <= self.context_window {
            return;
        }
        self.context_window_trusted = false;
        self.note(&format!(
            "a {}K prompt exceeded the configured {}K context window: set [agent].context_window in agent.toml",
            (prompt_tokens + 500) / 1000,
            self.context_window / 1000,
        ));
    }

    /// Queue a compaction and a retry for a context-overflow error, reporting
    /// whether recovery was taken up. Declines when the error is something
    /// else, the turn's retry budget is spent, a compaction is already in
    /// flight, or there is too little history for compaction to shrink -- in
    /// those cases a retry would re-send the request that just failed.
    fn request_overflow_recovery(&mut self, message: &str) -> bool {
        if !crate::core::agent::upstream::is_context_overflow_error(message)
            || self.overflow_retries >= MAX_OVERFLOW_RETRIES
            || self.compacting.is_some()
            || self.history.len() <= 4
        {
            return false;
        }
        self.overflow_retries += 1;
        self.retry_after_compact = true;
        self.compact_request = Some(CompactKind::Auto);
        self.detail = "context overflow: compacting".to_string();
        self.note("context overflow: compacting and retrying the turn");
        true
    }

    fn on_error(&mut self, code: String, message: String) {
        self.abort_tool_rows();
        self.close_live_subagents();
        self.flush_assistant();
        self.status = Status::Idle;
        self.run_started = None;
        self.detail = if message.contains("budget") {
            format!("budget exhausted: {message}")
        } else {
            format!("{code}: {message}")
        };
        self.system(Level::Error, &format!("error: {message}"));
        // A context overflow is the one error the session can recover from by
        // itself: compact, then resume the turn that failed. The goal loop and
        // the message queue are left alone until the retry resolves, so neither
        // acts on a turn that is about to run again.
        if self.request_overflow_recovery(&message) {
            return;
        }
        self.halt_turn();
    }

    /// Hand control back after a turn ended abnormally. Also reached from
    /// `finish_compaction` when an overflow recovery is abandoned, so the two
    /// paths cannot drift.
    fn halt_turn(&mut self) {
        // An errored turn halts the goal loop; the user decides how to recover.
        self.goal_eval_pending = false;
        if let Some(goal) = self.goal.as_ref() {
            if goal.is_active() {
                self.note("goal paused (turn errored); /goal to review, /goal clear to stop");
            }
        }
        // Auto-dequeue the next queued message, if any
        self.dequeue_next();
    }

    /// Run one goal evaluation and act on the verdict. Called by the chat loop
    /// when a turn finished under an active goal (`goal_eval_pending`). Makes one
    /// stateless `smol`-model call (no tools), then either auto-submits the next
    /// turn (goal unmet) or marks the goal achieved and returns control (goal
    /// met). Runs only while idle; blocks the loop for the single eval call.
    async fn run_goal_evaluation(&mut self) {
        self.goal_eval_pending = false;
        let Some(goal) = self.goal.clone() else {
            return;
        };
        if !goal.is_active() {
            return;
        }
        let Some(args) = self.args.clone() else {
            // No live session (e.g. tests): cannot evaluate. Leave control with
            // the user rather than looping blindly.
            return;
        };
        self.note("◎ evaluating goal...");
        let verdict = crate::core::agent::r#loop::evaluate_goal(
            &args,
            &self.smol_model,
            &goal.condition,
            &self.history,
        )
        .await;

        match verdict {
            Ok(v) => {
                if let Some(g) = self.goal.as_mut() {
                    g.last_reason = v.reason.clone();
                }
                if v.met {
                    if let Some(g) = self.goal.as_mut() {
                        g.status = crate::core::agent::goal::GoalStatus::Achieved;
                    }
                    let turns = self.goal.as_ref().map(|g| g.turns).unwrap_or(0);
                    let elapsed = self.goal.as_ref().map(|g| g.elapsed_secs()).unwrap_or(0);
                    self.system_marked(
                        GOAL_GLYPH,
                        Level::Good,
                        &format!("goal achieved in {turns} turn(s), {}", fmt_duration(elapsed)),
                    );
                    self.system_detail_text(&v.reason);
                    self.persist();
                } else {
                    // Goal unmet: surface the reason as guidance and start the
                    // next turn automatically, no user prompt needed.
                    self.system_marked(
                        GOAL_GLYPH,
                        Level::Info,
                        &format!("goal not met: {} — continuing", v.reason),
                    );
                    let prompt =
                        crate::core::agent::goal::continuation_prompt(&goal.condition, &v.reason);
                    self.submit_user(prompt);
                }
            }
            Err(e) => {
                // Evaluation failed: don't loop blindly. Keep the goal so the
                // user can retry, and hand control back.
                self.note(&format!(
                    "◎ goal evaluation failed: {e} (goal kept; /goal clear to stop)"
                ));
                self.persist();
            }
        }
    }

    /// Cancel the in-flight run, keeping the conversation intact.
    fn cancel_run(&mut self) {
        // Commit whatever was streamed before the cancel so partial prose and the
        // preceding tool calls stay in the transcript, and record the partial
        // answer in history so the next turn and a later /resume both see it.
        self.abort_tool_rows();
        let answer = answer_without_reasoning(&self.take_answer());
        if !answer.is_empty() {
            self.history
                .push(serde_json::json!({ "role": "assistant", "content": answer }));
        }
        self.status = Status::Idle;
        self.run_started = None;
        // Drop any run queued but not yet spawned (still gated on model/MCP/
        // snapshot readiness); otherwise the loop starts it once ready and the
        // cancel is silently undone.
        self.want_start = false;
        self.close_live_subagents();
        self.detail = "cancelled".to_string();
        self.scrollback = 0;
        self.system(Level::Warn, "cancelled");
        // A cancel stops the goal loop mid-flight; the goal itself is kept so
        // the user can inspect it (/goal) or clear it (/goal clear).
        self.goal_eval_pending = false;
        // Auto-dequeue the next queued message, if any
        self.dequeue_next();
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

/// Per-message envelope (role, delimiters) in the estimate below, the usual
/// OpenAI-accounting constant.
const TOKENS_PER_MESSAGE: u64 = 4;

/// Rough token count (~4 chars per token) for a history the provider has not
/// reported usage for: the window between a compaction and the next response.
/// Counts what actually goes on the wire -- text content including multimodal
/// text parts, tool-call names and arguments, tool-result ids -- so a
/// tool-heavy history is not scored as empty. Image parts are left out: their
/// cost is a provider-specific function of resolution, and inventing a number
/// there is worse than omitting one.
fn estimate_token_count(messages: &[serde_json::Value]) -> u64 {
    let mut total_chars: usize = 0;
    for msg in messages {
        match msg.get("content") {
            Some(serde_json::Value::String(text)) => total_chars += text.len(),
            Some(serde_json::Value::Array(parts)) => {
                for part in parts {
                    total_chars += part
                        .get("text")
                        .and_then(|t| t.as_str())
                        .map_or(0, str::len);
                }
            }
            _ => {}
        }
        for call in msg
            .get("tool_calls")
            .and_then(|c| c.as_array())
            .into_iter()
            .flatten()
        {
            // Arguments live under `function`, not on the call itself.
            if let Some(f) = call.get("function") {
                total_chars += f.get("name").and_then(|n| n.as_str()).map_or(0, str::len);
                total_chars += f
                    .get("arguments")
                    .and_then(|a| a.as_str())
                    .map_or(0, str::len);
            }
        }
        total_chars += msg
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .map_or(0, str::len);
    }
    let envelope = TOKENS_PER_MESSAGE * messages.len() as u64;
    ((total_chars / 4) as u64 + envelope).max(1)
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

/// Max diff rows rendered under a tool result before collapsing the tail. The
/// transcript scrolls, so a whole edit is worth showing; only pathological
/// machine-generated diffs hit this.
const DIFF_MAX_ROWS: usize = 1000;

/// Max diff rows in the permission prompt, which does not scroll: its box grows
/// upward into the transcript and shares the space with the decision list, so a
/// long diff has to collapse rather than crowd out the options.
const DIFF_PREVIEW_MAX_ROWS: usize = 20;

/// Max chars shown for a bash/shell/exec command label in the transcript.
const COMMAND_LABEL_MAX: usize = 80;

/// Cells a `tool_row` spends on its gutter and tag, subtracted from the draw
/// width to bound the label so the row never wraps.
const TOOL_ROW_RESERVE: u16 = 6;

/// Diff row backgrounds. Dark and desaturated on purpose: the syntax-highlighted
/// foreground is drawn on top of them, so the tint has to read as added/removed
/// at a glance without swallowing the code.
const DIFF_ADD_BG: Color = Color::Rgb(22, 52, 32);
const DIFF_DEL_BG: Color = Color::Rgb(66, 26, 30);

/// Render focused-diff text as a boxed panel: a light rule frames the change,
/// `+` rows on a green background and `-` rows on a red one across the whole row
/// (so the change reads as a band), `@@` headers dim-cyan. Every row keeps its
/// syntax highlighting, changed or not; only the background says what happened.
/// Content is truncated to what `width` leaves after the gutter and the frame,
/// and each row padded so the right border aligns.
/// Collapses to `max_rows` with a `(+N more)` tail before the closing rule.
/// `gutter` indents the panel (tool-row alignment under a result; empty in the
/// prompt).
fn diff_lines(
    diff: &str,
    width: usize,
    max_rows: usize,
    gutter: &'static str,
    lang: Option<&str>,
) -> Vec<Line<'static>> {
    let max = panel_inner(width, gutter);
    let all: Vec<&str> = diff.lines().collect();
    let shown = all.len().min(max_rows);
    let truncated = all.len() > shown;

    // Truncate before highlighting so the width arithmetic is unchanged.
    let kept: Vec<String> = all[..shown].iter().map(|l| truncate(l, max)).collect();
    // Highlight the body with the `-`/`+` markers stripped, so a multi-line
    // string or comment keeps its colour across the hunk instead of restarting
    // on every row; the markers are re-attached with their own colour below.
    // Hunk headers are not code and stay out of it.
    let bodies: Vec<&str> = kept.iter().map(|l| split_diff_marker(l).1).collect();
    let highlighted: Option<Vec<Vec<Span<'static>>>> = match lang {
        Some(l) if !l.is_empty() => Some(highlight::block(&bodies, l)),
        _ => None,
    };

    let mut rows: Vec<Line<'static>> = Vec::with_capacity(shown + 1);
    for (i, line) in kept.iter().enumerate() {
        let (marker, body) = split_diff_marker(line);
        if marker.starts_with('@') {
            rows.push(Line::styled(line.clone(), Style::new().cyan().dim()));
            continue;
        }
        let bg = match marker.as_bytes().first() {
            Some(b'-') => Some(DIFF_DEL_BG),
            Some(b'+') => Some(DIFF_ADD_BG),
            _ => None,
        };
        let mut spans = Vec::with_capacity(2);
        if !marker.is_empty() {
            // On a tinted row the marker takes the strong colour and the code
            // keeps its own; elsewhere it recedes.
            let marker_style = match marker.as_bytes().first() {
                Some(b'-') => Style::new().red().bold(),
                Some(b'+') => Style::new().green().bold(),
                _ => Style::new().dim(),
            };
            spans.push(Span::styled(marker.to_string(), marker_style));
        }
        match &highlighted {
            Some(h) => spans.extend(h[i].iter().cloned()),
            // Dimming an unhighlighted body would fight the tint behind it.
            None if bg.is_some() => spans.push(Span::raw(body.to_string())),
            None => spans.push(Span::styled(body.to_string(), Style::new().dim())),
        }
        // The tint rides on the line so `boxed_panel` can carry it across the
        // padding too, making the band reach the right border.
        let row = Line::from(spans);
        rows.push(match bg {
            Some(bg) => row.style(Style::new().bg(bg)),
            None => row,
        });
    }
    if truncated {
        rows.push(Line::styled(
            format!("(+{} more)", all.len() - shown),
            Style::new().dim(),
        ));
    }
    boxed_panel(rows, width, gutter)
}

/// Split a diff row into its leading marker and the code after it. A `@@` hunk
/// header is returned whole as the marker, since none of it is code.
fn split_diff_marker(line: &str) -> (&str, &str) {
    if line.starts_with("@@") {
        return (line, "");
    }
    match line.as_bytes().first() {
        Some(b'-') | Some(b'+') | Some(b' ') => line.split_at(1),
        _ => ("", line),
    }
}

/// Total display width of a row's spans.
fn row_width(row: &Line<'_>) -> usize {
    row.spans.iter().map(|s| s.content.chars().count()).sum()
}

/// Content columns a panel of total `width` has left after its gutter and the
/// four the frame spends (`│ ` and ` │`). Callers size their rows with this so
/// the closing border lands inside the terminal instead of wrapping onto a line
/// of its own.
pub(super) fn panel_inner(width: usize, gutter: &str) -> usize {
    width.saturating_sub(gutter.chars().count() + 4).max(1)
}

/// Frame styled rows in a light box, right-padded to the widest row (clamped to
/// what `width` leaves for content). Rows carry their own spans so style can vary
/// within a row (syntax highlighting); `gutter` prefixes every line to indent the
/// panel. A row's line-level style is folded into its spans, since the framed
/// line replaces it with the border's own style, and a row-level background also
/// fills the interior padding so a highlighted row reads as a band from border to
/// border rather than stopping at the end of its text.
fn boxed_panel(rows: Vec<Line<'static>>, width: usize, gutter: &'static str) -> Vec<Line<'static>> {
    let inner = rows
        .iter()
        .map(row_width)
        .max()
        .unwrap_or(0)
        .clamp(1, panel_inner(width, gutter));
    let border = Style::new().dark_gray();
    let mut out = Vec::with_capacity(rows.len() + 2);
    out.push(Line::from(vec![
        Span::styled(gutter, border),
        Span::styled(format!("┌{}┐", "─".repeat(inner + 2)), border),
    ]));
    for row in rows {
        let pad = inner.saturating_sub(row_width(&row));
        let row_style = row.style;
        // Interior spacing carries the row's background but not its foreground:
        // the frame itself stays neutral, so only the padding between the
        // borders is tinted.
        let fill = match row_style.bg {
            Some(bg) => border.bg(bg),
            None => border,
        };
        let mut spans = vec![
            Span::styled(gutter, border),
            Span::styled("│", border),
            Span::styled(" ", fill),
        ];
        spans.extend(
            row.spans
                .into_iter()
                .map(|s| Span::styled(s.content, row_style.patch(s.style))),
        );
        spans.push(Span::styled(format!("{} ", " ".repeat(pad)), fill));
        spans.push(Span::styled("│", border));
        out.push(Line::from(spans));
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
                // Untruncated: the row clamps to the draw width, so the command
                // fills the terminal rather than eliding at a fixed 80.
                let collapsed = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
                format!("Executing: {collapsed}")
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
        "web_search" => {
            let q = s("query");
            if q.is_empty() {
                "Searching the web".to_string()
            } else {
                format!("Searching the web: {}", truncate(q, COMMAND_LABEL_MAX))
            }
        }
        "web_fetch" => {
            let u = s("url");
            if u.is_empty() {
                "Fetching a page".to_string()
            } else {
                format!("Fetching: {}", truncate(u, COMMAND_LABEL_MAX))
            }
        }
        "ask" => "Asking a question".to_string(),
        "todo" => format!("{} {}", todo_op_verb(args, false), todo_target_label(args)),
        // Skill/memory tools already produce active labels ("Updating memory: X").
        _ => describe_tool_call(name, args),
    }
}

/// Present/past-tense verb for a `todo` tool call, keyed on its `op` argument.
fn todo_op_verb(args: &serde_json::Value, past: bool) -> &'static str {
    match (args.get("op").and_then(|v| v.as_str()).unwrap_or(""), past) {
        ("init", false) => "Planning",
        ("init", true) => "Planned",
        ("start", false) => "Starting",
        ("start", true) => "Started",
        ("done", false) => "Completing",
        ("done", true) => "Completed",
        ("drop", false) => "Abandoning",
        ("drop", true) => "Abandoned",
        ("rm", false) => "Removing",
        ("rm", true) => "Removed",
        ("append", false) => "Adding",
        ("append", true) => "Added",
        ("view", false) => "Checking",
        ("view", true) => "Checked",
        (_, false) => "Updating",
        (_, true) => "Updated",
    }
}

/// Concise subject for a `todo` tool call's verb: the named task/phase, an
/// item count for `append`, or "todos" as a generic fallback.
fn todo_target_label(args: &serde_json::Value) -> String {
    if let Some(task) = args.get("task").and_then(|v| v.as_str()) {
        return format!("task: {}", truncate(task, COMMAND_LABEL_MAX));
    }
    if let Some(phase) = args.get("phase").and_then(|v| v.as_str()) {
        if let Some(items) = args.get("items").and_then(|v| v.as_array()) {
            if !items.is_empty() {
                let n = items.len();
                return format!("{n} task{} to {phase}", if n == 1 { "" } else { "s" });
            }
        }
        return format!("phase: {phase}");
    }
    if let Some(list) = args.get("list").and_then(|v| v.as_array()) {
        let n = list.len();
        return format!("{n} phase{}", if n == 1 { "" } else { "s" });
    }
    if args.get("all").and_then(|v| v.as_bool()) == Some(true) {
        return "all tasks".to_string();
    }
    "todos".to_string()
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
                format!("Ran: {collapsed}")
            }
        }
        "grep" | "search" => "Searched".to_string(),
        "find" | "glob" => "Found files".to_string(),
        "read" => format!("Read {}", base(s("path"))),
        "list" | "ls" => "Listed files".to_string(),
        "write" => format!("Wrote {}", base(s("path"))),
        "edit" => format!("Edited {}", base(s("path"))),
        "dispatch_subagent" => format!("Dispatched subagent: {}", s("subagent_name")),
        "await_subagent" => format!("Subagent {} returned", subagent_name_from_run_id(s("run_id"))),
        "create_subagent" => format!("Created subagent: {}", s("name")),
        "list_subagents" => "Listed subagents".to_string(),
        "web_search" => {
            let q = s("query");
            if q.is_empty() {
                "Searched the web".to_string()
            } else {
                format!("Searched the web: {}", truncate(q, COMMAND_LABEL_MAX))
            }
        }
        "web_fetch" => {
            let u = s("url");
            if u.is_empty() {
                "Fetched a page".to_string()
            } else {
                format!("Fetched: {}", truncate(u, COMMAND_LABEL_MAX))
            }
        }
        "ask" => "Asked a question".to_string(),
        "todo" => format!("{} {}", todo_op_verb(args, true), todo_target_label(args)),
        _ => describe_tool_call(name, args),
    }
}

/// A one-line tool row: `│ <tag> <text>` with a styled tag and body.
/// What a still-streaming call has revealed about itself so far. Derived from
/// the raw arguments, and cached: deriving it costs a full scan and unescape of
/// everything received, which at file scale is far too much to repeat on every
/// 50ms frame when the underlying bytes usually haven't moved.
#[derive(Default)]
struct StartingPreview {
    /// Destination path, available well before the body since `path` is short
    /// and models emit it first.
    path: Option<String>,
    /// Trailing lines of the file body, newest last, syntax-highlighted from
    /// `path`'s extension. `None` until a `write` call's `content` field opens.
    tail: Option<Vec<Vec<Span<'static>>>>,
    /// Body lines scrolled off the top of `tail`.
    skipped: usize,
}

/// A tool call announced by the model whose arguments are still arriving.
struct StartingCall {
    id: String,
    name: String,
    /// Raw JSON arguments accumulated so far -- a truncated prefix of the
    /// object the model is emitting, not valid JSON until the call completes.
    args: String,
    preview: StartingPreview,
    /// `args.len()` when `preview` was derived. The buffer is append-only, so
    /// an unchanged length means unchanged content and the cache holds.
    preview_at: Option<usize>,
}

impl StartingCall {
    fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            args: String::new(),
            preview: StartingPreview::default(),
            preview_at: None,
        }
    }

    /// Re-derive the preview if new argument bytes have arrived since the last
    /// derivation. Called from the render path, so the work happens at most
    /// once per frame *and* at most once per delta, whichever is rarer.
    fn refresh_preview(&mut self) {
        if self.preview_at == Some(self.args.len()) {
            return;
        }
        self.preview_at = Some(self.args.len());
        self.preview.path =
            partial_json_field(&self.args, "path").map(unescape_partial_json_string);
        let body = (self.name == "write")
            .then(|| partial_json_field(&self.args, "content"))
            .flatten()
            .map(unescape_partial_json_string);
        let Some(body) = body else {
            self.preview.tail = None;
            self.preview.skipped = 0;
            return;
        };
        // `rsplit` walks back from the end and stops once the window is full,
        // so a large body never materializes a line list it would discard.
        // `split` (not `lines`) so a trailing newline shows as the empty line
        // the model just opened, which is where the next content will land.
        let mut tail: Vec<&str> = body.rsplit('\n').take(STREAM_TAIL_LINES).collect();
        tail.reverse();
        let total = body.bytes().filter(|&b| b == b'\n').count() + 1;
        self.preview.skipped = total - tail.len();
        // Highlighted here rather than in the row builder so the cost tracks
        // arriving bytes, not the frame rate: this window is a fresh cache key
        // on every delta, and highlighting 12 lines costs ~4.6ms.
        let lang = self.preview.path.clone().unwrap_or_default();
        self.preview.tail = Some(highlight::block(&tail, &lang));
    }
}

impl StartingCall {
    /// One-line "what is this call doing" for a compact row, resolved as far as
    /// the arguments allow: the destination once `path` has streamed, the tool
    /// name alone before that.
    fn activity_label(&mut self) -> String {
        self.refresh_preview();
        match self.preview.path.as_deref() {
            Some(path) if !path.is_empty() => format!("{} {path}", self.name),
            _ => format!("{}…", self.name),
        }
    }
}

/// How many trailing lines of a streaming file body stay on screen. Enough to
/// see the model actually working without the preview owning the viewport.
const STREAM_TAIL_LINES: usize = 12;
/// Minimum width of the line-number gutter, so a short preview doesn't jitter
/// sideways as the count crosses 10 / 100.
const STREAM_GUTTER_MIN: usize = 3;

/// Pull one *string-valued* field out of a JSON object that is still streaming
/// and therefore almost certainly truncated mid-value.
///
/// A real parser can't help here: the input is a prefix like
/// `{"path":"a.html","content":"<!doctype html>\n<html` with no closing quote
/// or brace. This scans for `"<field>"` followed by `:` and an opening quote,
/// then walks the value honoring backslash escapes, stopping at the closing
/// quote *or* at end-of-input -- whichever comes first. Returns the raw
/// (still escaped) value; see `unescape_partial_json_string`.
fn partial_json_field<'a>(raw: &'a str, field: &str) -> Option<&'a str> {
    let mut rest = raw;
    let needle = format!("\"{field}\"");
    loop {
        let at = rest.find(&needle)?;
        let after = &rest[at + needle.len()..];
        let after_colon = after.trim_start();
        // `"content"` could also appear inside some earlier string value; if
        // what follows isn't `: "`, keep looking.
        let Some(after_colon) = after_colon.strip_prefix(':') else {
            rest = &rest[at + needle.len()..];
            continue;
        };
        let Some(value) = after_colon.trim_start().strip_prefix('"') else {
            rest = &rest[at + needle.len()..];
            continue;
        };
        let mut escaped = false;
        for (i, c) in value.char_indices() {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                return Some(&value[..i]);
            }
        }
        // No closing quote: the value is still streaming, take all of it.
        return Some(value);
    }
}

/// Turn a raw JSON string body into display text, tolerating a truncated tail.
///
/// The stream can cut anywhere, including the middle of an escape sequence, so
/// drop a dangling `\` and a partial `\uXXXX` before handing the rest to the
/// parser. Falls back to the raw text if it still won't parse -- a preview is
/// never worth failing a render over.
fn unescape_partial_json_string(raw: &str) -> String {
    let mut s = raw;
    // Partial `\uXXXX`: 0-3 hex digits arrived so far.
    if let Some(at) = s.rfind("\\u") {
        let tail = &s[at + 2..];
        if tail.len() < 4 && tail.chars().all(|c| c.is_ascii_hexdigit()) {
            s = &s[..at];
        }
    }
    // Dangling escape: an odd number of trailing backslashes means the last one
    // is opening an escape whose payload hasn't arrived.
    let trailing_slashes = s.chars().rev().take_while(|&c| c == '\\').count();
    if trailing_slashes % 2 == 1 {
        s = &s[..s.len() - 1];
    }
    serde_json::from_str::<String>(&format!("\"{s}\"")).unwrap_or_else(|_| s.to_string())
}

/// Rows for one in-flight tool call.
///
/// A `write` whose body has started arriving renders as a live preview: the
/// destination, a tail window of the content with line numbers, and a footer
/// marking it as still streaming. Everything else -- and a `write` before its
/// `content` field opens -- falls back to a one-line throbber, which is all
/// there is to say about a call whose arguments haven't arrived.
///
/// Derivation is cached on the call (see `refresh_preview`), so the cost
/// tracks how fast bytes arrive rather than the frame rate: ~0.15ms per frame
/// at 400KB of arguments, against ~2ms without the cache. A rescan is still
/// linear in the whole buffer, so a multi-megabyte write would make each
/// *delta* expensive -- if that shows up, unescape only from the last
/// `STREAM_TAIL_LINES` newline escapes instead of the whole body.
fn starting_call_lines(call: &mut StartingCall, frame: &str) -> Vec<Line<'static>> {
    call.refresh_preview();
    let Some(tail) = call.preview.tail.as_ref() else {
        let label = match call.preview.path.as_deref() {
            // Even without a body, the path lands early enough to be worth
            // showing -- "Preparing write" alone says nothing about what. Any
            // path-carrying tool reaches here, so the name comes from the call.
            Some(path) if !path.is_empty() => format!("Preparing {}: {path}", call.name),
            _ => format!("Preparing {}", call.name),
        };
        return vec![tool_row(frame, Style::new().cyan(), &label, Style::new().cyan().dim())];
    };

    let mut out = Vec::new();
    out.push(Line::from(vec![
        Span::styled("│ ", Style::new().dark_gray()),
        Span::styled("Write: ", Style::new().cyan()),
        Span::styled(
            call.preview.path.clone().unwrap_or_default(),
            Style::new().cyan().dim(),
        ),
    ]));

    let start = call.preview.skipped;
    let gutter = (start + tail.len()).to_string().len().max(STREAM_GUTTER_MIN);
    if start > 0 {
        out.push(Line::from(vec![
            Span::styled("│ ", Style::new().dark_gray()),
            Span::styled(
                format!("… ({})", pluralize("earlier line", start)),
                Style::new().dark_gray(),
            ),
        ]));
    }
    for (offset, code) in tail.iter().enumerate() {
        let mut spans = vec![
            Span::styled("│ ", Style::new().dark_gray()),
            Span::styled(
                format!("{:>gutter$} ", start + offset + 1, gutter = gutter),
                Style::new().dark_gray(),
            ),
        ];
        spans.extend(code.iter().cloned());
        out.push(Line::from(spans));
    }
    out.push(Line::from(vec![
        Span::styled("│ ", Style::new().dark_gray()),
        Span::styled(format!("{frame} "), Style::new().cyan()),
        Span::styled("… (streaming)", Style::new().dark_gray()),
    ]));
    out
}

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
    // A single-call group's summary row already IS that call's `done` label, so
    // repeating it here would duplicate it; only multi-call groups (whose
    // summary is a counted breakdown) need the per-call headers.
    let show_headers = group.calls.len() > 1;
    let (tag_gutter, cont_gutter) = if show_headers {
        ("│     ", "│       ")
    } else {
        ("│   ", "│     ")
    };
    for call in &group.calls {
        if show_headers {
            out.push(Line::from(vec![
                Span::styled("│   ", Style::new().dark_gray()),
                Span::styled("▸ ", Style::new().cyan()),
                Span::styled(truncate(&call.done, max), Style::new().dim()),
            ]));
        }
        if let Some(content) = &call.content {
            let (tag, tag_style) = if call.is_error {
                ("✗", Style::new().red())
            } else {
                ("✓", Style::new().green())
            };
            // Expanded view shows the full output verbatim (one row per line,
            // width-clamped): the tag rides the first line, the rest indent to
            // align under it. Empty content still gets a bare tag row.
            let mut content_lines = content.lines();
            let first = content_lines.next().unwrap_or("");
            out.push(Line::from(vec![
                Span::styled(tag_gutter, Style::new().dark_gray()),
                Span::styled(format!("{tag} "), tag_style),
                Span::styled(truncate(first, max), Style::new().dim()),
            ]));
            for line in content_lines {
                out.push(Line::from(vec![
                    Span::styled(cont_gutter, Style::new().dark_gray()),
                    Span::styled(truncate(line, max), Style::new().dim()),
                ]));
            }
            if let Some(diff) = &call.diff {
                for line in diff_lines(diff, width as usize, DIFF_MAX_ROWS, cont_gutter, None) {
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

/// Live row for the still-open tool group: a braille throbber in place of the
/// static `▸` tag, plus elapsed time, so the user can see it's actively
/// working and how long it's taken. Rebuilt fresh every draw (not stored in
/// `transcript`) since the group's row there is only overwritten on the next
/// tool call, not every tick.
fn running_group_row(group: &ToolGroup, spinner_frame: usize, width: u16) -> Line<'static> {
    let frame = SPINNER[spinner_frame % SPINNER.len()];
    let elapsed = group.started.elapsed().as_secs();
    let text = format!("{} ({elapsed}s)", group.activity());
    let max = (width as usize).saturating_sub(6).max(1);
    tool_row(frame, Style::new().cyan(), &truncate(&text, max), Style::new().cyan().dim())
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

/// `text` with its reasoning removed, for the copy that goes into `history`.
/// Reasoning is display-only and must never be resent to the model (see
/// `SseAccumulator`); the display journal is what keeps it for a resume.
pub(crate) fn answer_without_reasoning(text: &str) -> String {
    split_reasoning(text)
        .into_iter()
        .filter_map(|(reasoning, seg)| (!reasoning).then_some(seg))
        .collect::<String>()
        .trim()
        .to_string()
}

/// A leading markdown list/blockquote marker (`> `, `- `, `1. `), stripped
/// before checking whether a line reads as a question.
fn markdown_prefix_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^(?:>\s*)?(?:(?:[-*+]|\d+[.)])\s+)*").unwrap())
}

/// A leading label like `Q:`, `Question 2:`, `Ask:`.
fn prompt_label_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)^(?:q(?:uestion)?|ask)\s*\d*\s*[:.)-]\s*").unwrap())
}

/// A line starting with a question word (what/how/can/should/...).
fn question_word_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)^(?:what|which|when|where|why|how|who|whom|whose|do|does|did|can|could|would|will|should|is|are|am|may|shall)\b",
        )
        .unwrap()
    })
}

/// A line directly addressing the user ("you", "your", "we", "our").
fn user_directed_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)\b(?:you|your|we|our)\b").unwrap())
}

/// An explicit request for the user to respond ("let me know", "please
/// confirm"), independent of a trailing question mark.
fn response_cue_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)^(?:please\s+)?(?:confirm|reply|choose|pick|decide|advise)\b|^(?:please\s+)?answer\b|^(?:please\s+)?(?:let\s+me\s+know|tell\s+me)\b",
        )
        .unwrap()
    })
}

/// True when the assistant's final line reads as a question or an explicit
/// request for the user to respond, rather than the model idling mid-task
/// with work still open. A plain-text cue counts just as much as the
/// structured `ask` tool -- either way, the todo reminder must not talk over
/// the assistant's own question by nudging it to "keep working."
fn assistant_is_awaiting_user_answer(text: &str) -> bool {
    let Some(last_line) = text
        .split(['\n', '\r'])
        .map(str::trim)
        .rfind(|l| !l.is_empty())
    else {
        return false;
    };
    let without_markdown = markdown_prefix_re().replace(last_line, "");
    let without_markdown = without_markdown.trim();
    let without_label = prompt_label_re().replace(without_markdown, "");
    let without_label = without_label.trim();
    let had_label = without_label != without_markdown;
    let is_question = without_label.ends_with('?') || without_label.ends_with('？');
    if is_question
        && (had_label
            || question_word_re().is_match(without_label)
            || user_directed_re().is_match(without_label))
    {
        return true;
    }
    let without_trailing_punct = without_label.trim_end_matches(['.', '!', '?', '。', '！', '？']);
    response_cue_re().is_match(without_trailing_punct)
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

/// True if `text` ends inside an unclosed ` think>` block (an opening tag whose
/// matching close has not yet streamed). Used to show `[thinking]` while
/// reasoning streams. Re-uses the same tag matcher as `split_reasoning`.
fn thinking_open(text: &str) -> bool {
    let mut open = false;
    for m in think_re().find_iter(text) {
        open = !m.as_str().starts_with("</");
    }
    open
}

/// True if `text` has any non-whitespace content in any reasoning/answer run.
fn assistant_has_content(text: &str) -> bool {
    split_reasoning(text)
        .iter()
        .any(|(_, seg)| !seg.trim().is_empty())
}

/// Regex matching `<system>`, `<system-notice>`, `<system-directive>`,
/// `<system-conventions>`, etc. - any XML tag named `system` or `system-*`.
/// Complete tags (`<system-notice>...</system-notice>`) are matched first; when
/// no closing tag exists, everything from the opening tag to end-of-string is
/// consumed. A bare word like `<systemic>` is not a tag and passes through.
fn system_tag_re() -> &'static regex::Regex {
    use std::sync::LazyLock;
    static RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"(?s)<system(?:-[a-zA-Z]+)?>.*?</system(?:-[a-zA-Z]+)?>|<system(?:-[a-zA-Z]+)?>.*$",
        )
        .unwrap()
    });
    &RE
}

/// Strip harness-injected `<system...>` XML tags from assistant text so the
/// user never sees raw markup. These tags carry internal instructions that
/// should not be rendered in the TUI transcript.
fn strip_system_xml_tags(text: &str) -> String {
    system_tag_re().replace_all(text, "").to_string()
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

/// Await the background MCP-connect task once, returning the connected server
/// names (empty if none / on task failure).
///
/// The handle is borrowed, not taken: this future is rebuilt (and dropped) every
/// select iteration, so taking it would discard the still-running task the first
/// time another branch wins the race. The slot is cleared only on completion.
async fn await_mcp(
    task: &mut Option<tokio::task::JoinHandle<crate::core::cli::mcp::ConnectOutcome>>,
) -> crate::core::cli::mcp::ConnectOutcome {
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
/// borrow as `await_mcp`; pends forever when idle.
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

/// Await an in-flight `/login` verification, parking forever when none is
/// running so this can sit in the loop's `select!` unconditionally.
async fn await_login(
    task: &mut Option<tokio::task::JoinHandle<Result<super::tokamak::Login, String>>>,
) -> Result<super::tokamak::Login, String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    match joined {
        Ok(inner) => inner,
        Err(e) => Err(format!("sign-in task failed: {e}")),
    }
}

/// How often the dock's branch indicator re-reads `HEAD`, so a checkout made
/// outside the TUI (another terminal, an editor) shows up without needing a
/// restart. Cheap (`rev-parse --abbrev-ref HEAD`) but still shells out, so this
/// is a poll, not every tick.
const BRANCH_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Re-read the current git branch off-loop (a blocking `git` call), only when
/// no poll is already in flight. A no-op when the project isn't a git repo.
fn spawn_branch_poll(project_root: &std::path::Path) -> tokio::task::JoinHandle<Option<String>> {
    let root = project_root.to_path_buf();
    tokio::task::spawn_blocking(move || git::current_branch(&root))
}

/// Await an in-flight branch poll once, clearing the slot. Same cancel-safe
/// borrow as `await_mcp`; pends forever when idle.
async fn await_branch_poll(
    task: &mut Option<tokio::task::JoinHandle<Option<String>>>,
) -> Option<String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    joined.ok().flatten()
}

/// Await the startup update check once, clearing the slot. Same cancel-safe
/// borrow as `await_mcp`; pends forever before it is spawned and after it has
/// been consumed, so it can sit in the loop's `select!` unconditionally.
async fn await_update_check(
    task: &mut Option<tokio::task::JoinHandle<Option<super::updater::AvailableUpdate>>>,
) -> Option<super::updater::AvailableUpdate> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    joined.ok().flatten()
}

/// Surface a newer published build in the transcript. The stderr notice the
/// non-interactive commands print is invisible here (the alternate screen wipes
/// it), so the TUI has to say it itself.
fn note_update(app: &mut App, update: Option<super::updater::AvailableUpdate>) {
    if let Some(update) = update {
        app.note(&format!("{}; run /update to install it", update.summary()));
    }
}

/// Hand `/update` to the loop, which downloads and swaps the binary off the
/// render loop. Refused while one install is already in flight.
fn update_command(app: &mut App) {
    if app.update_installing {
        app.note("an update is already installing");
        return;
    }
    app.update_requested = true;
    app.note("downloading the latest build...");
}

/// Await an in-flight `/update` install, parking forever when none is running.
/// Same cancel-safe borrow as `await_mcp`.
async fn await_update_install(
    task: &mut Option<tokio::task::JoinHandle<Result<super::updater::UpdateOutcome, String>>>,
) -> Result<super::updater::UpdateOutcome, String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    match joined {
        Ok(inner) => inner,
        Err(e) => Err(format!("update task failed: {e}")),
    }
}

/// Report an install. The swap replaced the file on disk, not this process's
/// image, so the new build only runs after a restart. A failure clears the
/// in-flight flag too, so `/update` can be retried.
fn finish_update_install(app: &mut App, result: Result<super::updater::UpdateOutcome, String>) {
    use super::updater::UpdateOutcome;
    app.update_installing = false;
    app.detail.clear();
    match result {
        Ok(UpdateOutcome::Installed { from, to, path }) => app.note(&format!(
            "updated {} from {from} -> {to}; restart jan to run it",
            tilde_path(&path)
        )),
        Ok(UpdateOutcome::UpToDate { version }) => {
            app.note(&format!("already up to date ({version})"))
        }
        Err(e) => app.note(&format!("update failed: {e}")),
    }
}

pub async fn run(
    session: AgentSession,
    agent_dir: std::path::PathBuf,
    project_root: PathBuf,
    initial_task: Option<String>,
    initial_images: Vec<String>,
    resume: Option<ResumeTarget>,
) -> Result<(), String> {
    let AgentSession {
        mut args,
        permission_requests,
        model,
        smol_model,
        limits,
        show_reasoning,
        mcp_servers,
        mcp_task,
    } = session;
    let ask_requests = crate::core::agent::interaction::new_registry();
    args.ask_requests = Some(ask_requests.clone());
    let todo_registry = crate::core::agent::todo::new_registry();
    args.todo_registry = Some(todo_registry.clone());
    let session_scratch = args.session_id.clone();
    let args = Arc::new(args);

    // Deserializing syntect's syntax/theme dumps takes tens of milliseconds.
    // Doing it here, off the render loop, keeps the first code block of a
    // response from stalling a frame mid-stream.
    tokio::task::spawn_blocking(highlight::warm);

    // `env_logger` writes to stderr, which is still the user's terminal once we
    // switch to the alternate screen -- a single `log::warn!` from anywhere
    // (MCP, http, a dependency) then paints raw text over the frame and stays
    // there until the next full repaint. Nothing may write to the terminal
    // except the renderer, so mute the log facade for the duration and restore
    // it on the way out. Anything worth the user's attention is a transcript
    // note; see `connect_active` for the MCP case.
    let prev_log_level = log::max_level();
    log::set_max_level(log::LevelFilter::Off);

    enable_raw_mode().map_err(|e| e.to_string())?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableBracketedPaste).map_err(|e| e.to_string())?;
    let mut modes = String::from(ALT_SCROLL_SAVE_OFF);
    if crate::core::agent::global_config::mouse_enabled() {
        modes.push_str(MOUSE_TRACK_ON);
    }
    let _ = stdout.write_all(modes.as_bytes());
    let _ = stdout.flush();
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|e| e.to_string())?;

    // A git repo enables workspace snapshots (rewind can restore files); a
    // non-repo runs exactly as before with conversation-only rewind.
    let repo_root = git::repo_root(&project_root);
    let mut app = App::new(
        model,
        limits,
        show_reasoning,
        agent_dir,
        project_root,
        repo_root,
    );
    app.smol_model = smol_model;
    app.args = Some(args.clone());
    // Adopt the session's startup run mode (e.g. `--plan`) so the header badge
    // shows immediately; a resumed thread overrides this via restore_run_mode.
    app.run_mode = args.run_mode;
    let seeded = initial_task
        .as_deref()
        .is_some_and(|t| !t.trim().is_empty());
    // The banner has to name the confinement, not assume it: "auto-approved
    // inside the OS sandbox" is a promise, and with the sandbox off it is the
    // wrong one. Unconfined, an approved command has exactly the access the
    // user does, and that is the thing worth saying up front.
    let sandboxed = args
        .sandbox
        .unwrap_or_else(|| crate::core::agent::r#loop::effective_sandbox(&app.project_root));
    app.push_banner(
        match (args.auto_approve, sandboxed) {
            (true, true) => "auto-approved inside the OS sandbox (start with --safe to be asked first)",
            (true, false) => "auto-approved and unsandboxed: commands run with your own access (--safe to be asked first, --sandbox to confine)",
            (false, true) => "--safe: writes, shell commands and MCP tool calls need approval",
            (false, false) => "--safe: approval needed, but unsandboxed - what you approve runs with your own access (--sandbox to confine)",
        },
        !seeded,
    );
    if app.model.is_empty() {
        app.note("not signed in — run /login to sign in to Tokamak, or `jan config set` to configure a provider manually");
    }
    // Only when there is nothing to load: a project that already has JAN.md needs
    // no invitation, and the splash hint covers re-running /init deliberately.
    if !crate::core::agent::context::has_context_file(&app.project_root) {
        app.note("no JAN.md here — run /init to study this project and write one");
    }
    // A failed resume is not fatal: the note explains why and the blank session
    // the user already has stays usable.
    if let Some(target) = &resume {
        apply_resume(&mut app, target).await;
        if app.thread_id.is_none() {
            app.note("starting a new session");
        }
    }
    if app.run_mode == crate::core::agent::plan::RunMode::Plan {
        app.note("◈ PLAN · read only — investigate, then propose a plan for review");
    }
    for path in &initial_images {
        match load_image_file(path) {
            Ok(img) => app.pending_images.push(img),
            Err(e) => app.note(&format!("could not attach image: {e}")),
        }
    }
    let res = chat_loop(
        &mut terminal,
        &args,
        &permission_requests,
        &ask_requests,
        &mut app,
        initial_task,
        mcp_task,
        &mcp_servers,
    )
    .await;

    // The last turn's journal may still be queued on the writer thread; a
    // process that exits now would lose it, and with it that turn's resume.
    app.join_journal();

    let _ = disable_raw_mode();
    let _ = execute!(
        terminal.backend_mut(),
        DisableBracketedPaste,
        DisableMouseCapture,
        Print(ALT_SCROLL_RESTORE),
        LeaveAlternateScreen,
    );
    let _ = terminal.show_cursor();
    log::set_max_level(prev_log_level);
    // Quitting cancels an in-flight `/update` (the runtime drops the task), so
    // say so on the real terminal now that the alternate screen is gone -- a
    // transcript note would vanish with it.
    if app.update_installing {
        eprintln!("the update was still installing when jan exited; run `jan update` to finish it");
    }
    // The interactive session is over: wipe the persistent bash `/tmp` scratch
    // that its turns shared.
    if let Some(session) = session_scratch.as_deref() {
        let _ = workspace::remove_scratch_dir(session).await;
    }
    res
}

#[allow(clippy::too_many_arguments)]
async fn chat_loop<B: Backend>(
    terminal: &mut Terminal<B>,
    args: &Arc<OrchestrationArgs>,
    registry: &PermissionRegistry,
    ask_requests: &crate::core::agent::interaction::AskRegistry,
    app: &mut App,
    initial_task: Option<String>,
    mut mcp_task: Option<tokio::task::JoinHandle<crate::core::cli::mcp::ConnectOutcome>>,
    mcp_servers: &crate::core::state::SharedMcpServers,
) -> Result<(), String> {
    let mut current: Option<CurrentRun> = None;
    let mut ticker = tokio::time::interval(Duration::from_millis(50));
    // Active MCP servers connect in the background; gate the first run on them
    // so the model's tools (collected once per run) are ready.
    let mut mcp_ready = mcp_task.is_none();
    let mut loading_noted = false;

    // Off-loop git snapshotting: one job at a time (checkpoints must stay
    // ordered), driven from the queue `App` fills in submit_user/on_done.
    let mut snap_task: Option<tokio::task::JoinHandle<Result<String, String>>> = None;
    let mut snap_inflight: Option<SnapshotJob> = None;

    // `/login` key verification: an HTTP round trip, so it runs off the render
    // loop and the prompt keeps repainting ("verifying...") while it's in flight.
    let mut login_task: Option<
        tokio::task::JoinHandle<Result<super::tokamak::Login, String>>,
    > = None;

    // The update check is a network round trip, so it runs off the render loop
    // and notes itself whenever it lands rather than delaying the first frame.
    let mut update_task = Some(tokio::spawn(super::updater::available_update()));

    // Anonymous usage ping (see `telemetry::ping_if_due`), same reasoning:
    // detached so it never delays the first frame. Nothing is noted for it --
    // it has no user-visible outcome.
    tokio::spawn(super::telemetry::ping_if_due());

    // `/update` downloads tens of megabytes and rewrites the binary; off the
    // render loop for the same reason, and one at a time.
    let mut update_install_task: Option<
        tokio::task::JoinHandle<Result<super::updater::UpdateOutcome, String>>,
    > = None;

    // Compaction is a summarizing model call, so it runs off the render loop
    // too; `compact_base` is the history length it was computed from.
    let mut compact_task: Option<tokio::task::JoinHandle<Result<Vec<serde_json::Value>, String>>> =
        None;
    let mut compact_base = 0usize;

    // The dock's branch indicator is captured once at startup; re-read it on a
    // slow timer so a checkout made outside the TUI (another terminal, an
    // editor) is reflected without a restart. `None` once the project proves
    // not to be a git repo, so a plain directory never shells out every tick.
    let mut branch_task: Option<tokio::task::JoinHandle<Option<String>>> = None;
    let mut branch_poll = tokio::time::interval(BRANCH_POLL_INTERVAL);
    branch_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    // Nothing to say when there is no seed message: the splash already invites
    // the first one (`Banner::awaiting_first_message`).
    if let Some(task) = initial_task.filter(|t| !t.trim().is_empty()) {
        app.submit_user(task.trim().to_string());
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

        // Esc closed the prompt while a verification was in flight: drop it, so a
        // late reply can't report a sign-in the user walked away from.
        if app.login.is_none() {
            if let Some(task) = login_task.take() {
                task.abort();
            }
        }

        // A key was submitted at the `/login` prompt: verify it off-loop. One at
        // a time -- the prompt is read-only while `verifying`.
        if login_task.is_none() {
            if let Some(key) = app.login_submit.take() {
                login_task = Some(tokio::spawn(
                    async move { super::tokamak::login(&key).await },
                ));
            }
        }

        // `/update` was typed: install off-loop. The flag is only honored when
        // no install is in flight, so a repeated request can't spawn a second
        // process rewriting the same binary.
        if app.update_requested {
            app.update_requested = false;
            if update_install_task.is_none() {
                app.update_installing = true;
                app.detail = "installing update...".to_string();
                update_install_task = Some(tokio::spawn(super::updater::self_update(false)));
            }
        }

        // `/compact` (or the auto trigger) was requested: summarize off-loop.
        // One at a time -- both request sites already refuse while one is in
        // flight, and the result replaces `history` wholesale.
        if compact_task.is_none() {
            if let Some(kind) = app.compact_request.take() {
                let args = args.clone();
                let model = app.model.clone();
                let history = app.history.clone();
                compact_base = history.len();
                app.compacting = Some(kind);
                app.compact_started = Some(Instant::now());
                compact_task = Some(tokio::spawn(async move {
                    crate::core::agent::r#loop::compact_history(
                        &args,
                        &model,
                        &history,
                        kind.keep_recent(),
                    )
                    .await
                }));
            }
        }

        // A turn finished under an active goal: run the (stateless) evaluator
        // before anything else. It either auto-submits the next turn (setting
        // want_start) or hands control back. Gated on an idle, run-free state so
        // it never races an in-flight turn.
        if app.goal_eval_pending && current.is_none() && !app.want_start {
            app.run_goal_evaluation().await;
        }

        // Kick off a queued run once the previous one has cleared, the MCP
        // servers (if any) are connected, and the base snapshot (if any) is
        // captured. `submit_user` already flipped status to Running and reset
        // the counter.
        // A compaction in flight is also a gate: it replaces `history`, so a run
        // started against the pre-compaction copy would be clobbered.
        if app.want_start && current.is_none() && compact_task.is_none() {
            let base_ready = app.repo_root.is_none() || app.base_snapshot.is_some();
            if mcp_ready && base_ready {
                app.want_start = false;
                // The submission itself is one human turn toward the aging
                // grace period; model roundtrips count via `Step` events.
                age_closed_todos(app).await;
                current = Some(spawn_run(args, app.body()));
            } else if !loading_noted && !mcp_ready {
                // The base snapshot gates silently; only the MCP connect notes.
                loading_noted = true;
                app.note("connecting MCP servers...");
            }
        }

        // Wrap the repaint in synchronized-output (`\x1b[?2026h/l`) so the
        // terminal buffers the whole frame and flips it atomically, eliminating
        // tearing. Written straight to stdout (not the generic `Backend`) for the
        // same reason the clipboard write below is: `chat_loop` is generic over
        // B for TestBackend, which isn't `io::Write`. ratatui already diffs the
        // buffer and emits ANSI only for changed cells.
        let _ = execute!(io::stdout(), BeginSynchronizedUpdate);
        let draw_result = terminal.draw(|f| draw(f, app)).map_err(|e| e.to_string());
        let _ = execute!(io::stdout(), EndSynchronizedUpdate);
        draw_result?;
        // Outside the synchronized block: `draw` only extracts the text, so the
        // OSC 52 write can't land in the middle of a frame.
        if let Some(text) = app.copy_request.take() {
            copy_to_clipboard(&text);
        }

        tokio::select! {
            _ = ticker.tick() => {
                // Advance the throbber at its own fixed cadence, catching up
                // whole frames if a tick stalled (a burst of deltas / slow term).
                app.advance_spinner(Instant::now());
                while event::poll(Duration::ZERO).unwrap_or(false) {
                    match event::read() {
                        Ok(Event::Key(key)) => {
                            // Typing moves the content under a highlight, and the
                            // copy already happened on release.
                            app.clear_selection();
                            if !handle_ask_key(app, key, ask_requests).await {
                                handle_key(app, key, registry, &mut current, mcp_servers).await;
                            }
                        }
                        Ok(event @ Event::Paste(_)) => route_paste_event(app, event),
                        // `handle_ask_mouse` mutates app state, so it stays in the
                        // arm body rather than a match guard that hides the effect.
                        #[allow(clippy::collapsible_match)]
                        Ok(Event::Mouse(mouse)) => {
                            if !handle_ask_mouse(app, mouse, ask_requests).await {
                                handle_mouse(app, mouse);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ = branch_poll.tick() => {
                if branch_task.is_none() {
                    branch_task = Some(spawn_branch_poll(&app.project_root));
                }
            }
            branch = await_branch_poll(&mut branch_task) => {
                app.git_branch = branch;
            }
            outcome = await_mcp(&mut mcp_task) => {
                mcp_ready = true;
                if !outcome.connected.is_empty() {
                    app.note(&format!("MCP ready: {}", outcome.connected.join(", ")));
                }
                // Right after the ready line, so a server that didn't come up
                // is visible at start/resume instead of being lost to a log
                // line painted over the frame.
                for failure in &outcome.failed {
                    app.note(&format!("MCP: {failure}"));
                }
            }
            login_res = await_login(&mut login_task) => {
                finish_login(app, login_res);
            }
            update = await_update_check(&mut update_task) => {
                note_update(app, update);
            }
            install = await_update_install(&mut update_install_task) => {
                finish_update_install(app, install);
            }
            compacted = await_compaction(&mut compact_task) => {
                finish_compaction(app, compacted, compact_base);
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
                    // Auto-compact when approaching the context limit. Handed to
                    // the loop like `/compact` so the summarizing call runs off
                    // the render loop.
                    if app.should_auto_compact() && app.compacting.is_none() {
                        app.compact_request = Some(CompactKind::Auto);
                    }
                }
                Some(StreamEvent::Error { code, message }) => {
                    app.on_error(code, message);
                    current = None;
                }
                // Each model roundtrip is one turn toward the finished-todo
                // aging grace period. A single run can span many tool-call
                // turns, so aging must count turns, not runs -- otherwise a
                // finished plan lingers through the rest of a long run.
                Some(ev @ StreamEvent::Step { .. }) => {
                    app.apply(ev);
                    age_closed_todos(app).await;
                }
                Some(other) => app.apply(other),
                None => {
                    // Stream closed without a terminal event (aborted task).
                    // Keep any partial prose/tool calls already streamed.
                    app.pending_queue.clear();
                    if app.status == Status::Running {
                        app.flush_assistant();
                        app.abort_tool_rows();
                        app.status = Status::Idle;
                        app.run_started = None;
                    }
                    // Auto-dequeue the next queued message
                    app.dequeue_next();
                    current = None;
                }
            },
        }
    }

    if let Some(c) = current {
        c.handle.abort();
    }
    crate::core::agent::interaction::cancel_all(ask_requests).await;
    Ok(())
}

/// Wheel, drag-to-select and click-to-expand. Press/release are split: the
/// toggle fires on release and only when the pointer never moved, so a drag that
/// starts on a folded row selects text instead of expanding it.
fn handle_mouse(app: &mut App, mouse: MouseEvent) {
    // Wheel scrolls the transcript (clamped to `max_back` on the next draw);
    // one notch matches a single arrow-key step. Scrolling moves the content out
    // from under a finished selection, so it drops one.
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            app.clear_selection();
            app.scrollback = app.scrollback.saturating_add(1);
        }
        MouseEventKind::ScrollDown => {
            app.clear_selection();
            app.scrollback = app.scrollback.saturating_sub(1);
        }
        MouseEventKind::Down(MouseButton::Left) => {
            app.copy_armed = false;
            let mode = if mouse.modifiers.contains(KeyModifiers::ALT) {
                SelectionMode::Block
            } else {
                SelectionMode::Linear
            };
            app.selection = Some(Selection::new((mouse.column, mouse.row), mode));
        }
        MouseEventKind::Drag(MouseButton::Left) => {
            if let Some(sel) = app.selection.as_mut() {
                let at = (mouse.column, mouse.row);
                sel.moved |= at != sel.anchor;
                sel.head = at;
            }
        }
        MouseEventKind::Up(MouseButton::Left) => {
            let Some(sel) = app.selection.as_mut() else {
                return;
            };
            sel.dragging = false;
            if sel.moved {
                // The text lives in the rendered buffer, which only `draw` has;
                // it copies on the next frame (<=50ms).
                app.copy_armed = true;
            } else {
                app.clear_selection();
                click_region(app, mouse.column, mouse.row);
            }
        }
        _ => {}
    }
}

/// A click that never became a drag: expand or collapse the region whose summary
/// row it landed on. Ignores clicks outside the transcript viewport or on rows
/// that aren't a region's own summary row (detail lines, blank padding, etc).
fn click_region(app: &mut App, column: u16, row: u16) {
    let rect = app.transcript_rect;
    if column < rect.x
        || column >= rect.x + rect.width
        || row <= rect.y
        || row >= rect.y + rect.height.saturating_sub(1)
    {
        return;
    }
    // Top border consumes one row; the rest maps 1:1 onto `row_index`, which is
    // built in the body's own wrapped screen coordinates.
    let body_row = (row - rect.y - 1) as usize;
    if let Some(Some(idx)) = app.row_index.get(body_row) {
        app.toggle_region(*idx);
    }
}

/// Extend a held drag past the top or bottom edge of the transcript by scrolling
/// a row per frame toward the pointer. Only nudges `scrollback`; `draw` clamps it
/// and shifts the anchor by however much the view actually moved.
fn autoscroll_selection(app: &mut App) {
    let Some(sel) = app.selection.filter(|s| s.dragging) else {
        return;
    };
    let rect = app.transcript_rect;
    if rect.height <= 2 {
        return;
    }
    if sel.head.1 <= rect.y {
        app.scrollback = app.scrollback.saturating_add(1);
    } else if sel.head.1 >= rect.y + rect.height.saturating_sub(1) {
        app.scrollback = app.scrollback.saturating_sub(1);
    }
}

/// Lift the selected cells out of a rendered frame. Rows are joined with
/// newlines and stripped of trailing padding, so a copied command pastes as the
/// command and not as the width of the terminal.
fn selection_text(buf: &Buffer, sel: Selection, area: Rect) -> String {
    sel.spans(area.width)
        .into_iter()
        .filter(|(row, _, _)| *row < area.height)
        .map(|(row, c0, c1)| {
            // Wide glyphs park an empty symbol in their second cell, so plain
            // concatenation already reconstructs them.
            let line: String = (c0..=c1)
                .filter_map(|col| buf.cell((col, row)))
                .map(|cell| cell.symbol())
                .collect();
            line.trim_end().to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Put a selection on the system clipboard by both routes available to a TUI:
/// `arboard`, which serves it for as long as this process runs, and OSC 52,
/// which hands it to the terminal emulator so it survives `jan` exiting and
/// crosses an ssh/tmux session. OSC 52 goes second so that where it is supported
/// the terminal ends up owning the selection.
fn copy_to_clipboard(text: &str) {
    let owned = text.to_string();
    std::thread::spawn(move || {
        let Ok(mut clip) = arboard::Clipboard::new() else {
            return;
        };
        // X11/Wayland ownership lives with the setter, so this thread parks
        // inside `wait()` until something else claims the clipboard; returning
        // immediately would drop the text on the floor.
        #[cfg(target_os = "linux")]
        {
            use arboard::SetExtLinux;
            let _ = clip.set().wait().text(owned);
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = clip.set_text(owned);
        }
    });
    if text.len() <= OSC52_MAX_BYTES {
        use base64::Engine;
        let payload = base64::engine::general_purpose::STANDARD.encode(text);
        let mut out = io::stdout();
        let _ = write!(out, "\x1b]52;c;{payload}\x07");
        let _ = out.flush();
    }
}

async fn resolve_front_ask(
    app: &mut App,
    registry: &crate::core::agent::interaction::AskRegistry,
    cancelled: bool,
) {
    let Some(ask) = app.ask_queue.pop_front() else {
        return;
    };
    // Reserved plan-review ask: a single question with the exact id drives the
    // mode transition. Capture the chosen label before `answers` is moved into
    // the outcome. Skipped on cancel so a cancelled review never changes mode.
    let plan_choice = (!cancelled
        && ask.request.questions.len() == 1
        && ask.request.questions[0].id == crate::core::agent::plan::PLAN_REVIEW_QUESTION_ID)
        .then(|| ask.answers.first().and_then(|a| a.selected.first().cloned()))
        .flatten();
    let outcome = if cancelled {
        Err(crate::core::agent::interaction::AskError::Cancelled)
    } else {
        Ok(ask.answers)
    };
    // Always respond so the model's in-flight turn completes normally.
    let _ = crate::core::agent::interaction::respond(registry, &ask.request_id, outcome).await;
    if let Some(label) = plan_choice {
        apply_plan_review(app, &label);
    }
}

/// Drive the plan-mode transition from a `plan_review` answer. The model has
/// already staged todos via `todo(init)` earlier in the same turn; here we only
/// flip the mode (and, for Execute, queue the continuation turn). Persists so
/// the mode survives resume.
fn apply_plan_review(app: &mut App, label: &str) {
    use crate::core::agent::plan::{self, RunMode};
    match label {
        plan::EXECUTE_PLAN_LABEL => {
            // Atomic handoff: refuse to leave Plan unless the plan was actually
            // staged (spec: failed todo init keeps the agent in Plan intact).
            if app.todos.is_empty() {
                app.note("cannot execute: no plan staged (todo init first); staying in plan mode");
                return;
            }
            app.run_mode = RunMode::Normal;
            app.persist();
            app.note("▶ executing plan (normal mode)");
            // Enqueues while the ask turn is still running; on_done dequeues it,
            // starting execution only after the mode switch has committed.
            app.submit_user("Proceed with the plan.".to_string());
        }
        plan::KEEP_PLANNING_LABEL => app.note("continuing to plan (read only)"),
        plan::EXIT_PLAN_LABEL => {
            app.run_mode = RunMode::Normal;
            app.persist();
            app.note("exited plan mode (no execution)");
        }
        other => app.note(&format!("unknown plan review choice: {other}")),
    }
}

/// Handle keys owned by the front interactive question. Returns false only for
/// global Ctrl-C/Ctrl-D, which must continue into the normal run cancellation
/// path after every ask waiter has been released.
async fn handle_ask_key(
    app: &mut App,
    key: KeyEvent,
    registry: &crate::core::agent::interaction::AskRegistry,
) -> bool {
    if app.ask_queue.is_empty() {
        return false;
    }
    if key.kind == KeyEventKind::Release {
        return true;
    }
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    if ctrl && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('d')) {
        crate::core::agent::interaction::cancel_all(registry).await;
        app.ask_queue.clear();
        return false;
    }
    if key.code == KeyCode::Esc {
        resolve_front_ask(app, registry, true).await;
        return true;
    }

    let mut submit = false;
    {
        let ask = app.ask_queue.front_mut().expect("checked non-empty above");
        if ask.editing_custom {
            match key.code {
                KeyCode::Enter => submit = ask.accept_custom(),
                KeyCode::Backspace => {
                    ask.custom_input.pop();
                }
                KeyCode::Char(ch) if !ctrl => ask.custom_input.push(ch),
                _ => {}
            }
        } else {
            match key.code {
                KeyCode::Up => ask.move_selection(-1),
                KeyCode::Down => ask.move_selection(1),
                KeyCode::Left => ask.move_question(-1),
                KeyCode::Right => ask.move_question(1),
                KeyCode::Char(' ') if ask.question().multi => {
                    submit = ask.choose();
                }
                KeyCode::Enter => submit = ask.choose(),
                _ => {}
            }
        }
    }
    if submit {
        resolve_front_ask(app, registry, false).await;
    }
    true
}

/// Route a bracketed paste event to the active input owner.
fn route_paste_event(app: &mut App, event: Event) {
    let Event::Paste(text) = event else {
        return;
    };
    if let Some(prompt) = app.login.as_mut() {
        // A pasted API key belongs to the login field, not the chat composer
        // (where it would echo).
        prompt.paste(&text);
    } else if !app.ask_queue.is_empty() {
        handle_ask_paste(app, &text);
    } else {
        for c in text.chars() {
            app.input_insert(c);
        }
    }
}

/// Append bracketed paste to the active custom answer only.
fn handle_ask_paste(app: &mut App, text: &str) {
    if let Some(ask) = app.ask_queue.front_mut() {
        if ask.editing_custom {
            ask.custom_input.push_str(text);
        }
    }
}

async fn handle_ask_mouse(
    app: &mut App,
    mouse: MouseEvent,
    registry: &crate::core::agent::interaction::AskRegistry,
) -> bool {
    let Some(ask) = app.ask_queue.front_mut() else {
        return false;
    };
    if !matches!(mouse.kind, MouseEventKind::Down(MouseButton::Left)) {
        return true;
    }
    let inside = mouse.column >= ask.rect.x
        && mouse.column < ask.rect.x.saturating_add(ask.rect.width)
        && mouse.row >= ask.rect.y
        && mouse.row < ask.rect.y.saturating_add(ask.rect.height);
    if !inside {
        return true;
    }
    let Some((_, selected)) = ask
        .row_hitboxes
        .iter()
        .find(|(row, _)| *row == mouse.row)
        .copied()
    else {
        return true;
    };
    ask.selected = selected;
    let submit = ask.choose();
    if submit {
        resolve_front_ask(app, registry, false).await;
    }
    true
}

/// Keys for the `/login` prompt. Enter hands the key to the loop for
/// verification (`login_submit`); Esc or Ctrl-C abandons sign-in. While a
/// verification is in flight the field is read-only, so a stray keystroke cannot
/// edit the key being checked -- but Esc still cancels, so the prompt can never
/// wedge the TUI.
fn handle_login_key(app: &mut App, key: KeyEvent, ctrl: bool) {
    let cancel = key.code == KeyCode::Esc
        || (ctrl && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('d')));
    if cancel {
        app.login = None;
        app.login_submit = None;
        app.note("sign-in cancelled (run /login again any time)");
        return;
    }
    // Ctrl-V: terminals deliver a normal paste as `Event::Paste`, but some send
    // Ctrl-V through as a key, so read the clipboard directly for those.
    if ctrl && key.code == KeyCode::Char('v') {
        match clipboard_text() {
            Ok(text) => {
                if let Some(prompt) = app.login.as_mut() {
                    prompt.paste(&text);
                }
            }
            Err(e) => {
                if let Some(prompt) = app.login.as_mut() {
                    prompt.error = Some(format!("could not read the clipboard: {e}"));
                }
            }
        }
        return;
    }

    let Some(prompt) = app.login.as_mut() else {
        return;
    };
    if prompt.verifying {
        return;
    }
    match key.code {
        KeyCode::Enter => match super::tokamak::sanitize_key(&prompt.input) {
            Ok(key) => {
                prompt.verifying = true;
                prompt.error = None;
                app.login_submit = Some(key);
            }
            Err(e) => {
                prompt.input.clear();
                prompt.error = Some(e);
            }
        },
        KeyCode::Backspace => {
            prompt.input.pop();
        }
        KeyCode::Char(ch) if !ctrl => prompt.input.push(ch),
        _ => {}
    }
}

/// Plain text from the OS clipboard, for Ctrl-V in the `/login` prompt (the
/// image path is `clipboard_image`).
fn clipboard_text() -> Result<String, String> {
    super::secret_input::clipboard_text()
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

    // The `/login` prompt owns the keyboard while open: every keystroke is part
    // of a secret being typed, so none of it may reach the input box or the
    // transcript shortcuts.
    if app.login.is_some() {
        handle_login_key(app, key, ctrl);
        return;
    }

    // The `/settings` edit dock owns the keyboard while open, same as `/login`.
    if app.settings_prompt.is_some() {
        handle_settings_key(app, key, ctrl);
        return;
    }

    // The MCP add/edit wizard owns the keyboard while open.
    if app.mcp_prompt.is_some() {
        handle_mcp_prompt_key(app, key, ctrl, mcp_servers).await;
        return;
    }

    // A pending permission prompt captures y/a/n; Ctrl-C cancels the run and
    // Ctrl-D quits, so it can't be wedged waiting on an unanswered prompt.
    // Several subagents can have requests queued at once (see `pending_queue`),
    // so cancelling/quitting denies all of them, not just the one on screen.
    if !app.pending_queue.is_empty() {
        if ctrl_c || ctrl_d {
            for pending in app.pending_queue.drain(..) {
                deny(registry, &pending.request_id).await;
            }
            abort_run(current);
            if ctrl_d {
                app.should_quit = true;
            } else {
                app.cancel_run();
            }
            return;
        }
        let pending = app.pending_queue.front_mut().expect("checked non-empty above");
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
        if let Some(d) = decision {
            // Only the front request resolves here; any others stay queued and
            // surface on the next draw once this one is popped.
            let pending = app.pending_queue.pop_front().expect("checked non-empty above");
            // Only record denials: the tool row that follows an allow
            // already shows the call proceeded, so an "allowed" line is
            // pure noise once granted.
            if matches!(d, PermissionDecision::Deny) {
                app.system(Level::Error, &format!("denied: {}", pending.summary()));
            }
            if let Some(sender) = registry.lock().await.remove(&pending.request_id) {
                let _ = sender.send(d);
            }
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
            // `/mcp` picker: `a` opens the add wizard, `e` opens the edit
            // wizard prefilled from the selected row, `d` removes it after a
            // confirmation keystroke. All act through the shared config layer.
            KeyCode::Char('a') if picker.kind == PickerKind::ToggleMcp => {
                app.picker = None;
                app.mcp_prompt = Some(McpPrompt {
                    editing: None,
                    field: McpField::Name,
                    name: String::new(),
                    transport: "stdio".to_string(),
                    command: String::new(),
                    args: String::new(),
                    env: String::new(),
                    url: String::new(),
                    headers: String::new(),
                    active: false,
                    error: None,
                });
            }
            KeyCode::Char('e') if picker.kind == PickerKind::ToggleMcp => {
                let name = picker.items[picker.selected].value.clone();
                let entry = super::mcp::get_server(&name);
                if let Some(entry) = entry {
                    app.picker = None;
                    app.mcp_prompt = Some(McpPrompt::from_entry(&entry));
                } else {
                    app.note(&format!("server '{name}' no longer exists"));
                }
            }
            KeyCode::Char('d') if picker.kind == PickerKind::ToggleMcp => {
                let name = picker.items[picker.selected].value.clone();
                app.picker = None;
                if let Err(e) = super::mcp::remove_server(&name) {
                    app.note(&format!("failed to remove '{name}': {e}"));
                } else {
                    super::mcp::disconnect(&name, mcp_servers).await;
                    app.note(&format!("removed MCP server '{name}'"));
                }
            }
            // `/todo` editor: d/Enter = done, x = abandon (drop), r = remove.
            // Each mutates the canonical list and rebuilds the overlay in place;
            // opening/closing the view itself never mutates state.
            KeyCode::Char('d') | KeyCode::Char('x') | KeyCode::Char('r') | KeyCode::Enter
                if picker.kind == PickerKind::Todo =>
            {
                let code = key.code;
                let content = picker.items.get(picker.selected).map(|i| i.value.clone());
                // (picker borrow ends here; nothing below reads it before rebuild)
                if let Some(content) = content {
                    use crate::core::agent::todo::Target;
                    let result = match code {
                        KeyCode::Char('x') => {
                            apply_todo_mutation(app, |l| l.drop_target(Target::Task(&content))).await
                        }
                        KeyCode::Char('r') => {
                            apply_todo_mutation(app, |l| l.rm(Target::Task(&content))).await
                        }
                        _ => apply_todo_mutation(app, |l| l.done(Target::Task(&content))).await,
                    };
                    if let Err(e) = result {
                        app.note(&format!("todo update failed: {e}"));
                    }
                    // Rebuild from the mutated list; close once nothing remains.
                    if app.todos.is_empty() {
                        app.picker = None;
                    } else if let Some(picker) = app.picker.as_mut() {
                        picker.items = build_todo_items(&app.todos);
                        picker.selected =
                            picker.selected.min(picker.items.len().saturating_sub(1));
                    }
                }
            }
            // `/settings` picker: `x` restores the selected key to its default
            // by removing it from agent.toml - same write as clearing the
            // field in the edit dock, one keypress instead of two.
            KeyCode::Char('x') if picker.kind == PickerKind::AgentSettings => {
                let key = picker.items[picker.selected].value.clone();
                // (picker borrow ends here; nothing below reads it before rebuild)
                let toml_path = app.agent_dir.join("agent.toml");
                match crate::core::agent::project::set_agent_key(&toml_path, &key, None) {
                    Ok(()) => {
                        app.note(&format!(
                            "{key} unset (default applies); takes effect on the next run"
                        ));
                        if let Some(picker) = app.picker.as_mut() {
                            picker.items = build_agent_settings_items(&toml_path);
                            picker.selected =
                                picker.selected.min(picker.items.len().saturating_sub(1));
                        }
                    }
                    Err(e) => app.note(&format!("failed to write {}: {e}", toml_path.display())),
                }
            }
            KeyCode::Enter => {
                let kind = picker.kind;
                let value = picker.items[picker.selected].value.clone();
                app.picker = None;
                match kind {
                    PickerKind::ResumeThread => resume_thread(app, &value).await,
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
                    PickerKind::ViewConfig => {}
                    // `/settings`: open the edit dock for the selected row.
                    PickerKind::AgentSettings => {
                        if let Some(def) = AGENT_SETTINGS.iter().find(|d| d.key == value) {
                            let toml_path = app.agent_dir.join("agent.toml");
                            let current = current_agent_value(&toml_path, def.key);
                            app.settings_prompt =
                                Some(SettingsPrompt::new(def, current.as_deref()));
                        }
                    }
                    // Todo Enter is handled by the guarded action arm above.
                    PickerKind::Todo => {}
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
                if app.input.trim() != matches[sel].name() {
                    app.accept_slash();
                    return;
                }
                // Exact match: fall through to the normal Enter path to run it.
            }
            _ => {}
        }
    }

    // Path-hint popup: while `@query` is active with at least one match,
    // it owns Up/Down/Tab/Esc/Enter in the same pattern as slash hints.
    if app.has_path_hints() {
        match key.code {
            KeyCode::Up => {
                app.path_hint_move(-1);
                return;
            }
            KeyCode::Down => {
                app.path_hint_move(1);
                return;
            }
            KeyCode::Tab | KeyCode::Enter => {
                app.accept_path_hint();
                return;
            }
            KeyCode::Esc => {
                app.path_hint_dismissed = true;
                app.path_hints.clear();
                return;
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
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::ALT) => {
            app.input_insert('\n');
        }
        KeyCode::Char('j') if ctrl => {
            app.input_insert('\n');
        }
        // Ctrl-O expands/collapses all folded regions (tool groups and reasoning
        // blocks), scrolling the latest into view.
        KeyCode::Char('o') if ctrl => {
            app.toggle_regions();
        }
        // Ctrl-V stages an image from the OS clipboard (terminal paste is
        // text-only, so we read the clipboard directly) for the next message.
        KeyCode::Char('v') if ctrl => {
            app.attach_clipboard_image();
        }
        KeyCode::Enter => {
            let text = app.input.trim().to_string();
            app.input_clear();
            if !text.is_empty() {
                app.record_submitted(&text);
                if let Some(cmd) = text.strip_prefix('/') {
                    run_command(app, cmd).await;
                } else {
                    app.submit_user(text);
                }
            }
        }
        KeyCode::Backspace => {
            app.input_backspace();
        }
        KeyCode::Delete => {
            app.input_delete();
        }
        KeyCode::Left => {
            app.cursor_left();
        }
        KeyCode::Right => {
            app.cursor_right();
        }
        KeyCode::Home => {
            app.cursor = 0;
        }
        KeyCode::End => {
            app.cursor = app.input.len();
        }
        // Tab is a no-op in normal input mode; slash-command and path-hint
        // popups intercept it before reaching this arm.
        KeyCode::Tab => {}
        KeyCode::Char(c) if !ctrl => {
            app.input_insert(c);
        }
        // Up/Down recall submitted messages into the composer when there is
        // something to recall; otherwise they scroll the transcript as before.
        // PageUp/PageDown always scroll, so scrollback is never unreachable.
        KeyCode::Up | KeyCode::PageUp => {
            if key.code == KeyCode::Up && app.recall_prev() {
                return;
            }
            let step = if key.code == KeyCode::PageUp { 10 } else { 1 };
            app.scrollback = app.scrollback.saturating_add(step);
        }
        KeyCode::Down | KeyCode::PageDown => {
            if key.code == KeyCode::Down && app.recall_next() {
                return;
            }
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

/// One row of the slash-command popup: a built-in command, or an installed
/// project skill (`.jan/agent/skills/<name>/SKILL.md`) offered by name so
/// `/deploy` behaves like a command the user can tab-complete and run.
enum SlashMatch {
    Command(&'static SlashCommand),
    Skill { name: String, description: String },
}

impl SlashMatch {
    /// Full invocation name including the leading slash.
    fn name(&self) -> &str {
        match self {
            SlashMatch::Command(c) => c.name,
            SlashMatch::Skill { name, .. } => name,
        }
    }
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
        name: "/init",
        hint: "",
        description: "Study the project, then write JAN.md, skills, and memory",
    },
    SlashCommand {
        name: "/compact",
        hint: "",
        description: "Summarize older turns to free up context",
    },
    SlashCommand {
        name: "/goal",
        hint: "[condition|clear]",
        description: "Keep working until a condition is met (bare: status)",
    },
    SlashCommand {
        name: "/plan",
        hint: "[exit|text]",
        description: "Enter read-only plan mode, optionally seeding it with a message; /plan exit to leave",
    },
    SlashCommand {
        name: "/todo",
        hint: "[add [phase|] text | clear]",
        description: "Open the todo editor (bare), /todo add ... to append, /todo clear to drop all",
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
        description: "List, add, edit, remove, or toggle MCP servers",
    },
    SlashCommand {
        name: "/cancel",
        hint: "[N]",
        description: "Cancel queued messages (bare: all, or index)",
    },
    SlashCommand {
        name: "/login",
        hint: "",
        description: "Sign in to Tokamak and save the API key",
    },
    SlashCommand {
        name: "/config",
        hint: "",
        description: "View provider config (~/.jan/config.toml)",
    },
    SlashCommand {
        name: "/settings",
        hint: "[max_parallel_subagents N]",
        description: "Edit [agent] settings from agent.toml (menu); takes effect next run",
    },
    SlashCommand {
        name: "/update",
        hint: "",
        description: "Install the latest published build (takes effect on restart)",
    },
    SlashCommand {
        name: "/quit",
        hint: "",
        description: "Exit the TUI",
    },
];

/// Every keybinding worth advertising, as `(keys, description)`. Single source
/// of truth for the `/help` listing and the first-run footer hint, so the two
/// can't drift. Deliberately not rendered on every frame -- the footer is for
/// transient state (running, prompts, pickers), not a permanent cheat sheet.
const KEY_BINDINGS: &[(&str, &str)] = &[
    ("Enter", "Send the message"),
    ("Alt+Enter / Ctrl-J", "Insert a newline"),
    ("Esc / Ctrl-C", "Cancel the running turn"),
    ("Esc Esc", "Rewind to an earlier message"),
    ("↑/↓", "Recall sent messages (scrolls while the input has text)"),
    ("PgUp/PgDn", "Scroll the transcript"),
    ("Ctrl-O", "Expand or collapse all tool calls"),
    ("Ctrl-V", "Paste an image from the clipboard"),
    ("Drag", "Select text, copied on release (Alt+drag for a block)"),
    ("Ctrl-D", "Quit"),
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
            app.note("commands:");
            for c in SLASH_COMMANDS {
                let sig = if c.hint.is_empty() {
                    c.name.to_string()
                } else {
                    format!("{} {}", c.name, c.hint)
                };
                app.system_detail_text(&format!("{sig:18} {}", c.description));
            }
            app.note("keys:");
            for (keys, description) in KEY_BINDINGS {
                app.system_detail_text(&format!("{keys:18} {description}"));
            }
        }
        "clear" => {
            app.reset_session();
            clear_todos(app).await;
            app.note("conversation cleared");
        }
        "new" => {
            app.reset_session();
            clear_todos(app).await;
            app.note("started a new session");
        }
        "compact" => compact_command(app),
        "threads" | "list" => match super::list_threads_in(&app.agent_dir) {
            Ok(threads) if threads.is_empty() => {
                app.note("no saved threads found");
            }
            Ok(mut threads) => {
                sort_threads_recent(&mut threads);
                let base = app.agent_dir.clone();
                app.note(&format!("{} saved thread(s):", threads.len()));
                for t in &threads {
                    let id = t.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                    let title =
                        thread_display_name(&base, id, t.get("title").and_then(|v| v.as_str()));
                    let short: String = id.chars().take(8).collect();
                    app.system_detail(vec![
                        Span::styled(format!("{short}  "), Style::new().cyan()),
                        Span::raw(title),
                    ]);
                }
                app.system_detail_text("resume with /resume");
            }
            Err(e) => app.note(&format!("failed to list threads: {e}")),
        },
        "resume" => {
            if arg.is_empty() {
                open_thread_picker(app);
            } else {
                resume_thread(app, arg).await;
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
        "login" => open_login_prompt(app),
        "update" => update_command(app),
        "config" => open_config_screen(app),
        "settings" => settings_command(app, arg),
        "goal" => goal_command(app, arg),
        "init" => init_command(app),
        "plan" => plan_command(app, arg),
        "todo" => todo_command(app, arg).await,
        "cancel" => cancel_command(app, arg),
        "quit" | "exit" => app.should_quit = true,
        other => {
            // A `/name` that isn't a built-in is an installed project skill:
            // `/deploy` (short form) or `/skill:deploy` (explicit form that
            // never collides with a command name), with optional args threaded
            // into the skill message. Unknown names still note.
            let (skill_name, skill_args) = match other.split_once(':') {
                Some(("skill", name)) => (name, arg),
                _ => (other, arg),
            };
            if app.dispatch_skill(skill_name, skill_args) {
                return;
            }
            app.note(&format!("unknown command '/{other}' (try /help)"));
        }
    }
}

/// The `/init` prompt. Onboarding a project means producing the three things a
/// later session reads back: the root `JAN.md` (ingested as project context),
/// skills for repeatable workflows, and memory for durable facts. Phrased as a
/// task for the model rather than executed here -- only the model can read the
/// project and judge what is worth writing down.
const INIT_PROMPT: &str = "Onboard yourself to this project so future sessions start informed.\n\n\
1. Study the project first. Read the README and any contributor docs, map the directory layout, and \
find the real build, test, lint, and type-check commands (from the manifests and CI config, not from \
guesswork). Note the conventions the code actually follows.\n\n\
2. Write `JAN.md` in the project root. It is the only instructions file loaded into your system \
prompt, and it is loaded every session, so it must earn its tokens: the commands to build/test/lint, \
the architecture a newcomer cannot infer from the tree, and the conventions worth enforcing. Skip \
anything obvious from a directory listing, and do not pad it. If `JAN.md` already exists, read it and \
correct what has drifted instead of rewriting it wholesale.\n\n\
3. Write skills with `skill_write` for the project's repeatable procedures -- releasing, running \
migrations, adding a module, debugging a subsystem -- one skill per procedure, only where a real \
multi-step recipe exists. Do not invent skills to fill space.\n\n\
4. Record durable project facts with `memory_write`: decisions, constraints, and gotchas that are \
true beyond this session and not already stated in the code.\n\n\
Then report what you wrote and why, briefly.";

/// `/init`: hand the model the onboarding task as a user turn, so it runs with
/// the normal toolset, permission gate, and transcript. The prompt body itself
/// is hidden -- the note below is what the user asked for, the canned text is
/// not. Idle-only, like the other commands that start a turn -- queueing it
/// behind a running turn would have it survey a project mid-change.
fn init_command(app: &mut App) {
    if app.status != Status::Idle {
        app.note("/init is only available while idle");
        return;
    }
    let existing = crate::core::agent::context::has_context_file(&app.project_root);
    app.note(if existing {
        "◈ init · reviewing JAN.md, skills, and memory for this project"
    } else {
        "◈ init · studying the project to write JAN.md, skills, and memory"
    });
    app.submit_user_hidden(INIT_PROMPT.to_string());
}

/// Manually compact the conversation: summarize older turns, keeping the recent
/// tail, then persist. Blocks the event loop for one model call; runs only while
/// idle (the caller gates on `Status::Idle`).
fn compact_command(app: &mut App) {
    if app.compacting.is_some() {
        app.note("already compacting");
        return;
    }
    if app.args.is_none() {
        app.note("compaction unavailable (no active session)");
        return;
    }
    app.compact_request = Some(CompactKind::Manual);
}

/// Compact-and-retry attempts allowed per user turn. The loop already retries
/// within a single request (`MAX_COMPACTION_ATTEMPTS`); this bounds the outer
/// recovery so a model that overflows at any size still hands control back.
const MAX_OVERFLOW_RETRIES: u8 = 2;

/// Which path asked for a compaction: `/compact` keeps a shorter tail than the
/// automatic one and reports itself differently.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum CompactKind {
    Manual,
    Auto,
}

impl CompactKind {
    fn keep_recent(self) -> usize {
        match self {
            CompactKind::Manual => crate::core::agent::compaction::MANUAL_KEEP_RECENT,
            CompactKind::Auto => crate::core::agent::compaction::DEFAULT_KEEP_RECENT,
        }
    }

    fn label(self) -> &'static str {
        match self {
            CompactKind::Manual => "compacting",
            CompactKind::Auto => "auto-compacting",
        }
    }

    fn done_label(self) -> &'static str {
        match self {
            CompactKind::Manual => "compacted",
            CompactKind::Auto => "auto-compacted",
        }
    }
}

/// Await an in-flight compaction, parking forever when none is running so this
/// can sit in the loop's `select!` unconditionally.
async fn await_compaction(
    task: &mut Option<tokio::task::JoinHandle<Result<Vec<serde_json::Value>, String>>>,
) -> Result<Vec<serde_json::Value>, String> {
    let joined = match task.as_mut() {
        Some(h) => h.await,
        None => return pending().await,
    };
    *task = None;
    match joined {
        Ok(inner) => inner,
        Err(e) => Err(format!("compaction task failed: {e}")),
    }
}

/// Apply a finished compaction. `base_len` is the history length the summary was
/// computed from: anything appended since (a message submitted while the call was
/// in flight) is carried over rather than dropped.
fn finish_compaction(
    app: &mut App,
    result: Result<Vec<serde_json::Value>, String>,
    base_len: usize,
) {
    let kind = app.compacting.take().unwrap_or(CompactKind::Manual);
    app.compact_started = None;
    let retrying = std::mem::take(&mut app.retry_after_compact);
    match result {
        Ok(mut compacted) if compacted.len() < base_len => {
            compacted.extend(app.history.split_off(base_len.min(app.history.len())));
            app.history = compacted;
            app.persist();
            // Estimate tokens from compacted message content (~4 chars ≈ 1 token).
            app.tokens = estimate_token_count(&app.history);
            app.note(&format!(
                "{} {base_len} -> {} messages (ctx {}K/{}K)",
                kind.done_label(),
                app.history.len(),
                app.tokens / 1000,
                app.context_window / 1000,
            ));
            // The turn this compaction was queued for died on an overflow
            // error: resume it now that the history it failed on is smaller.
            if retrying {
                app.begin_turn();
                app.want_start = true;
            }
        }
        Ok(_) => {
            if kind == CompactKind::Manual {
                app.note("nothing to compact yet");
            }
            // Nothing shrank, so the retry would re-send the request that
            // already overflowed. Hand control back instead.
            if retrying {
                app.note("nothing left to compact: the turn cannot be retried");
                app.halt_turn();
            }
        }
        Err(e) => {
            app.note(&format!("{} failed: {e}", kind.label()));
            if retrying {
                app.halt_turn();
            }
        }
    }
}

/// `/goal` dispatcher: `clear` removes an active goal, a bare command shows
/// status, and any other argument sets a new goal and starts a turn toward it.
/// Runs only while idle (the caller gates on `Status::Idle`).
fn goal_command(app: &mut App, arg: &str) {
    let arg = arg.trim();
    match arg {
        "clear" => {
            if app.goal.take().is_some() {
                app.goal_eval_pending = false;
                app.persist();
                app.note("goal cleared");
            } else {
                app.note("no active goal");
            }
        }
        "" => show_goal_status(app),
        condition => set_goal(app, condition),
    }
}

/// One editable `[agent]` key surfaced by `/settings`. Mirrors the template's
/// knobs; defaults match `load_agent_config`. `model` is deliberately absent:
/// it has its own `/model` picker.
struct AgentSettingDef {
    key: &'static str,
    label: &'static str,
    desc: &'static str,
    kind: AgentSettingKind,
}

enum AgentSettingKind {
    Int { default: Option<u64>, min: u64 },
    /// Exact-match choice: Enter writes one of `options`, cleared field
    /// unsets. Covers the `read-only | deny | allow` and `always | relevance`
    /// toggles that hand-editing agent.toml previously required.
    Enum { options: &'static [&'static str], default: &'static str },
    /// Boolean toggle: Enter writes a TOML boolean (the Enum kind would emit a
    /// quoted string). Unset clears the key so its default applies.
    Bool { default: bool },
}

const AGENT_SETTINGS: &[AgentSettingDef] = &[
    AgentSettingDef {
        key: "context_window",
        label: "context_window",
        desc: "context limit in tokens",
        kind: AgentSettingKind::Int { default: Some(128000), min: 1 },
    },
    AgentSettingDef {
        key: "compaction_reserve_tokens",
        label: "compaction_reserve_tokens",
        desc: "headroom kept free before compaction",
        kind: AgentSettingKind::Int { default: Some(16384), min: 0 },
    },
    AgentSettingDef {
        key: "max_tokens",
        label: "max_tokens",
        desc: "cap on tokens generated per response (omitted when unset)",
        kind: AgentSettingKind::Int { default: None, min: 1 },
    },
    AgentSettingDef {
        key: "max_parallel_subagents",
        label: "max_parallel_subagents",
        desc: "subagents that may run at once; extra dispatches queue FIFO",
        kind: AgentSettingKind::Int { default: Some(10), min: 1 },
    },
    AgentSettingDef {
        key: "budget.max_tokens",
        label: "budget.max_tokens",
        desc: "token-spend ceiling per run; the only cap on run length",
        kind: AgentSettingKind::Int { default: Some(128000), min: 0 },
    },
    AgentSettingDef {
        key: "tools.default",
        label: "tools.default",
        desc: "tool permission mode; deny locks down MCP tools",
        kind: AgentSettingKind::Enum {
            options: &["read-only", "deny", "allow"],
            default: "read-only",
        },
    },
    AgentSettingDef {
        key: "skills.inject",
        label: "skills.inject",
        desc: "when project skills are injected into the prompt",
        kind: AgentSettingKind::Enum {
            options: &["always", "relevance"],
            default: "always",
        },
    },
    AgentSettingDef {
        key: "show_reasoning",
        label: "show_reasoning",
        desc: "expand  reasoning in the transcript (Ctrl-O still toggles)",
        kind: AgentSettingKind::Bool { default: false },
    },
];

/// Docked edit prompt for one `/settings` row: value field, inline validation
/// error, Enter saves / Esc cancels / cleared field unsets.
struct SettingsPrompt {
    key: &'static str,
    input: String,
    error: Option<String>,
}

impl SettingsPrompt {
    fn new(def: &AgentSettingDef, current: Option<&str>) -> Self {
        Self {
            key: def.key,
            input: current.unwrap_or_default().to_string(),
            error: None,
        }
    }

    fn def(&self) -> &'static AgentSettingDef {
        AGENT_SETTINGS
            .iter()
            .find(|d| d.key == self.key)
            .expect("settings prompt always opens for a def row")
    }
}

/// A docked multi-field wizard for adding or editing an MCP server. Collects
/// the fields the desktop form also asks for (name, transport, then the
/// transport-specific bits), validating on save through the shared
/// `core::cli::mcp` layer. `edit` mode prefills from the existing entry and
/// defaults `name` to it; `add` mode starts blank.
struct McpPrompt {
    /// `Some(original_name)` when editing; `None` when adding a new server.
    editing: Option<String>,
    /// Which field the keyboard is currently filling in.
    field: McpField,
    name: String,
    transport: String,
    command: String,
    args: String,
    env: String,
    url: String,
    headers: String,
    active: bool,
    error: Option<String>,
}

/// The fields of `McpPrompt`, in input order. `Transport` is a toggle row
/// rather than a free-text field, so it is navigated but not typed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum McpField {
    Name,
    Transport,
    Command,
    Args,
    Env,
    Url,
    Headers,
    Active,
}

impl McpPrompt {
    const FIELD_ORDER: [McpField; 8] = [
        McpField::Name,
        McpField::Transport,
        McpField::Command,
        McpField::Args,
        McpField::Env,
        McpField::Url,
        McpField::Headers,
        McpField::Active,
    ];

    /// The fields relevant to the current transport, in input order. stdio
    /// servers never ask for url/headers; http/sse never ask for command/args.
    fn visible_fields(&self) -> Vec<McpField> {
        let transport = self.transport.as_str();
        Self::FIELD_ORDER
            .iter()
            .copied()
            .filter(|f| match f {
                McpField::Command | McpField::Args | McpField::Env => transport == "stdio",
                McpField::Url | McpField::Headers => transport != "stdio",
                _ => true,
            })
            .collect()
    }

    fn next_field(&mut self) {
        let fields = self.visible_fields();
        let pos = fields
            .iter()
            .position(|f| *f == self.field)
            .unwrap_or(usize::MAX);
        if pos + 1 < fields.len() {
            self.field = fields[pos + 1];
        } else {
            self.field = fields[0];
        }
    }

    fn prev_field(&mut self) {
        let fields = self.visible_fields();
        let pos = fields
            .iter()
            .position(|f| *f == self.field)
            .unwrap_or(0);
        self.field = fields[if pos == 0 { fields.len() - 1 } else { pos - 1 }];
    }

    fn from_entry(entry: &McpServerEntry) -> Self {
        let cfg = &entry.config;
        let transport = cfg
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("stdio")
            .to_string();
        let env = pairs_to_str(cfg.get("env").and_then(Value::as_object));
        let headers = pairs_to_str(cfg.get("headers").and_then(Value::as_object));
        Self {
            editing: Some(entry.name.clone()),
            field: McpField::Name,
            name: entry.name.clone(),
            transport: transport.clone(),
            command: cfg
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            args: cfg
                .get("args")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default(),
            env,
            url: cfg
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            headers,
            active: entry.active,
            error: None,
        }
    }

    /// Build and persist the entry, then (dis)connect live as needed.
    /// Returns an error string on invalid input so the caller can keep the
    /// prompt open with the reason shown.
    async fn save(
        &mut self,
        mcp_servers: &crate::core::state::SharedMcpServers,
    ) -> Result<(), String> {
        let config = super::mcp::build_server_config(
            self.transport.trim(),
            Some(self.command.trim()).filter(|s| !s.is_empty()),
            super::mcp::parse_args(self.args.trim()),
            super::mcp::parse_pairs(self.env.trim(), "env")?,
            Some(self.url.trim()).filter(|s| !s.is_empty()),
            super::mcp::parse_pairs(self.headers.trim(), "header")?,
            self.active,
        )?;
        super::mcp::upsert_server(self.name.trim(), &config)?;
        let name = self.name.trim().to_string();
        let was_active = self.editing.as_deref().is_some_and(|n| {
            super::mcp::get_server(n).is_some_and(|e| e.active)
        });
        // Disconnect the old live service on rename/edit, then reconnect if active.
        if let Some(old) = self.editing.take() {
            if old != name {
                super::mcp::disconnect(&old, mcp_servers).await;
            }
        }
        if self.active {
            let cfg = super::mcp::list_servers()
                .into_iter()
                .find(|s| s.name == name)
                .map(|s| s.config);
            if let Some(cfg) = cfg {
                if let Err(e) = super::mcp::connect(&name, &cfg, mcp_servers).await {
                    log::warn!("MCP: {e}");
                }
            }
        } else if was_active {
            super::mcp::disconnect(&name, mcp_servers).await;
        }
        Ok(())
    }
}

/// Render a `KEY=VALUE` map as a comma-separated string, for pre-filling the
/// form fields (the inverse of `parse_pairs`).
fn pairs_to_str(map: Option<&serde_json::Map<String, Value>>) -> String {
    map.map(|m| {
        m.iter()
            .filter_map(|(k, v)| v.as_str().map(|v| format!("{k}={v}")))
            .collect::<Vec<_>>()
            .join(",")
    })
    .unwrap_or_default()
}

/// Value of an `[agent]` key in `agent.toml` as a display string, `None` when
/// unset or the file is unreadable. Reads the inner value directly so the
/// display is not padded by the document's alignment.
fn current_agent_value(toml_path: &std::path::Path, key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(toml_path).ok()?;
    let doc = raw.parse::<toml_edit::DocumentMut>().ok()?;
    let (section, key) = match key.split_once('.') {
        Some((section, key)) => (section, key),
        None => ("agent", key),
    };
    let item = doc.get(section)?.get(key)?;
    Some(match item.as_value() {
        Some(toml_edit::Value::Integer(i)) => i.value().to_string(),
        Some(toml_edit::Value::String(s)) => s.value().to_string(),
        Some(toml_edit::Value::Boolean(b)) => b.value().to_string(),
        _ => item.to_string(),
    })
}

/// `/settings` dispatcher: bare opens the interactive settings menu (an
/// `AgentSettings` picker over the `[agent]` keys; Enter on a row docks an edit
/// prompt); `max_parallel_subagents <N>` still works as a one-shot shortcut.
/// Writes are format-preserving and take effect on the next run (the current
/// run snapshotted its config at start). Runs only while idle, like every
/// command.
fn settings_command(app: &mut App, arg: &str) {
    let toml_path = app.agent_dir.join("agent.toml");
    let arg = arg.trim();
    let Some((key, value)) = arg.split_once(char::is_whitespace) else {
        return open_settings_screen(app);
    };
    match key {
        "max_parallel_subagents" => {
            let n: u64 = match value.parse() {
                Ok(n) => n,
                Err(_) => return app.note(&format!("'{value}' is not an integer")),
            };
            if n < 1 {
                return app.note("max_parallel_subagents must be at least 1");
            }
            match crate::core::agent::project::set_agent_key(
                &toml_path,
                key,
                Some(toml_edit::value(n as i64)),
            ) {
                Ok(()) => app.note(&format!(
                    "max_parallel_subagents = {n} written; takes effect on the next run"
                )),
                Err(e) => app.note(&format!("failed to write {}: {e}", toml_path.display())),
            }
        }
        other => app.note(&format!(
            "unknown setting '/settings {other}' (bare /settings opens the menu)"
        )),
    }
}

/// One picker row per `[agent]` def; the hint carries the current on-disk
/// value (`= 400`) or `(unset)` when the default applies. `value` is the key
/// so the edit dock and the `x` unset shortcut can act on it.
fn build_agent_settings_items(toml_path: &std::path::Path) -> Vec<PickerItem> {
    AGENT_SETTINGS
        .iter()
        .map(|def| {
            let current = current_agent_value(toml_path, def.key);
            PickerItem {
                value: def.key.to_string(),
                label: def.label.to_string(),
                hint: Some(match &current {
                    Some(v) => format!("= {v}"),
                    None => "(unset)".to_string(),
                }),
                checkbox: None,
            }
        })
        .collect()
}

/// Open the `/settings` menu: a picker row per `[agent]` key, hint showing the
/// current value (or `unset`), Enter docking the edit prompt for that row, `x`
/// removing the key so its default applies again.
fn open_settings_screen(app: &mut App) {
    let toml_path = app.agent_dir.join("agent.toml");
    app.picker = Some(Picker {
        kind: PickerKind::AgentSettings,
        items: build_agent_settings_items(&toml_path),
        selected: 0,
    });
}

/// Keyboard for the `/settings` edit dock: chars/backspace edit the field,
/// Enter validates and writes (empty clears the key), Esc cancels. Mirrors
/// `handle_login_key`, minus the secret/verify machinery.
fn handle_settings_key(app: &mut App, key: KeyEvent, ctrl: bool) {    if (key.code == KeyCode::Esc || (ctrl && key.code == KeyCode::Char('c'))) && app.settings_prompt.is_some()
    {
        app.settings_prompt = None;
        return;
    }
    let Some(prompt) = app.settings_prompt.as_mut() else {
        return;
    };
    match key.code {
        KeyCode::Enter => {
            let toml_path = app.agent_dir.join("agent.toml");
            let value: Option<toml_edit::Item> = match prompt.def().kind {
                AgentSettingKind::Int { default, min } => {
                    if prompt.input.trim().is_empty() {
                        None
                    } else {
                        match prompt.input.trim().parse::<u64>() {
                            Ok(n) if n >= min => Some(toml_edit::value(n as i64)),
                            Ok(_) => {
                                prompt.error = Some(format!(
                                    "must be at least {min} (default: {})",
                                    default
                                        .map(|d| d.to_string())
                                        .unwrap_or_else(|| "unset".into())
                                ));
                                return;
                            }
                            Err(_) => {
                                prompt.error = Some(format!("'{}' is not an integer", prompt.input));
                                return;
                            }
                        }
                    }
                }
                AgentSettingKind::Enum { options, default } => {
                    let input = prompt.input.trim();
                    if input.is_empty() {
                        None
                    } else if options.contains(&input) {
                        Some(toml_edit::value(input.to_string()))
                    } else {
                        prompt.error = Some(format!(
                            "must be one of: {} (default: {default})",
                            options.join(" | ")
                        ));
                        return;
                    }
                }
                AgentSettingKind::Bool { default } => {
                    let input = prompt.input.trim();
                    if input.is_empty() {
                        None
                    } else if let Ok(b) = input.parse::<bool>() {
                        Some(toml_edit::value(b))
                    } else {
                        prompt.error = Some(format!(
                            "must be true or false (default: {default})"
                        ));
                        return;
                    }
                }
            };
            match crate::core::agent::project::set_agent_key(&toml_path, prompt.key, value) {
                Ok(()) => {
                    let what = if prompt.input.trim().is_empty() {
                        format!("{} unset (default applies)", prompt.key)
                    } else {
                        format!("{} = {} written", prompt.key, prompt.input.trim())
                    };
                    app.note(&format!("{what}; takes effect on the next run"));
                    app.settings_prompt = None;
                }
                Err(e) => {
                    prompt.error = Some(format!("failed to write {}: {e}", toml_path.display()));
                }
            }
        }
        KeyCode::Backspace => {
            prompt.input.pop();
        }
        KeyCode::Char(ch) if !ctrl => prompt.input.push(ch),
        _ => {}
    }
}

/// Keyboard for the MCP add/edit wizard: Up/Down move between fields, chars/
/// backspace edit the current text field, Space toggles the transport/active
/// rows, Enter saves and connects, Esc cancels.
#[allow(clippy::too_many_lines)]
async fn handle_mcp_prompt_key(
    app: &mut App,
    key: KeyEvent,
    ctrl: bool,
    mcp_servers: &crate::core::state::SharedMcpServers,
) {
    if (key.code == KeyCode::Esc || (ctrl && key.code == KeyCode::Char('c')))
        && app.mcp_prompt.is_some()
    {
        app.mcp_prompt = None;
        return;
    }
    let Some(prompt) = app.mcp_prompt.as_mut() else {
        return;
    };
    match key.code {
        KeyCode::Up | KeyCode::Char('k') => prompt.prev_field(),
        KeyCode::Down | KeyCode::Char('j') => prompt.next_field(),
        KeyCode::Tab => prompt.next_field(),
        KeyCode::Enter => {
            // Take the prompt out so `save` can borrow `app` freely for notes
            // and put it back on error.
            let mut taken = app.mcp_prompt.take().expect("prompt is Some");
            match taken.save(mcp_servers).await {
                Ok(()) => {
                    let name = taken.name.trim().to_string();
                    app.note(&format!("saved MCP server '{name}'"));
                }
                Err(e) => {
                    taken.error = Some(e);
                    app.mcp_prompt = Some(taken);
                }
            }
        }
        KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right => {
            match prompt.field {
                McpField::Transport => {
                    prompt.transport = if prompt.transport == "stdio" {
                        "http".to_string()
                    } else {
                        "stdio".to_string()
                    };
                    // Reset to a valid field for the new transport.
                    prompt.field = prompt.visible_fields()[0];
                }
                McpField::Active => prompt.active = !prompt.active,
                _ => {}
            }
        }
        KeyCode::Backspace => match prompt.field {
            McpField::Name => { prompt.name.pop(); }
            McpField::Command => { prompt.command.pop(); }
            McpField::Args => { prompt.args.pop(); }
            McpField::Env => { prompt.env.pop(); }
            McpField::Url => { prompt.url.pop(); }
            McpField::Headers => { prompt.headers.pop(); }
            _ => {}
        },
        KeyCode::Char(ch) if !ctrl => {
            match prompt.field {
                McpField::Name => prompt.name.push(ch),
                McpField::Command => prompt.command.push(ch),
                McpField::Args => prompt.args.push(ch),
                McpField::Env => prompt.env.push(ch),
                McpField::Url => prompt.url.push(ch),
                McpField::Headers => prompt.headers.push(ch),
                _ => {}
            }
        }
        _ => {}
    }
}

/// `/plan` dispatcher: bare enters read-only plan mode, `/plan exit` leaves
/// it, and `/plan <text>` enters plan mode (if not already in it) and
/// immediately submits `<text>` as the first message to investigate — same
/// convenience as seeding the bare TUI with a task. Only settable while idle
/// so it never races the live tool set of a running turn (spec). Enforcement
/// is at the core dispatcher; this just flips the per-turn flag forwarded in
/// `App::body()` and persists it.
fn plan_command(app: &mut App, arg: &str) {
    use crate::core::agent::plan::RunMode;
    if app.status != Status::Idle {
        app.note("plan mode is only settable while idle");
        return;
    }
    let arg = arg.trim();
    if arg == "exit" {
        if app.run_mode == RunMode::Plan {
            app.run_mode = RunMode::Normal;
            app.persist();
            app.note("exited plan mode (normal execution)");
        } else {
            app.note("not in plan mode");
        }
        return;
    }
    if app.run_mode == RunMode::Plan {
        if arg.is_empty() {
            app.note("already in plan mode (/plan exit to leave)");
        } else {
            app.submit_user(arg.to_string());
        }
        return;
    }
    app.run_mode = RunMode::Plan;
    app.persist();
    app.note("◈ PLAN · read only — investigate, then propose a plan for review");
    if app.goal.is_some() {
        app.note("active goal paused while planning; it resumes on exit");
    }
    if !arg.is_empty() {
        app.submit_user(arg.to_string());
    }
}

/// Apply one user-initiated todo mutation to the canonical `TodoList`. Prefers
/// the shared registry (the model's source of truth) so agent and user share one
/// state; falls back to the local projection when no live session is attached
/// (e.g. tests). Syncs the TUI projection and persists on success.
async fn apply_todo_mutation(
    app: &mut App,
    op: impl FnOnce(&mut crate::core::agent::todo::TodoList) -> Result<(), String>,
) -> Result<(), String> {
    if let Some(args) = app.args.clone() {
        if let Some(registry) = args.todo_registry.as_ref() {
            let mut list = registry.lock().await;
            op(&mut list)?;
            app.todos = list.clone();
            app.persist();
            return Ok(());
        }
    }
    let mut list = app.todos.clone();
    op(&mut list)?;
    app.todos = list;
    app.persist();
    Ok(())
}

/// Turns (model roundtrips or user submissions) allowed to pass with a fully
/// closed-out todo list before it is dropped. One is too eager -- a model
/// often closes the last task and then appends follow-up work in the next
/// turn, and clearing between the two would destroy a list it is still using.
const TODO_KEEP_CLOSED_TURNS: u32 = 2;

/// Clear the canonical todo list and the TUI projection together.
///
/// Goes through `apply_todo_mutation` so the registry -- the model's source of
/// truth -- is cleared too. Dropping only the projection would leave the model
/// appending to a list the user believes is gone, and the next `TodoUpdate`
/// would resurrect it on screen.
async fn clear_todos(app: &mut App) {
    // `Target::All` clears unconditionally; the Result exists for the
    // unknown-task and unknown-phase targets.
    let _ = apply_todo_mutation(app, |list| {
        list.rm(crate::core::agent::todo::Target::All)
    })
    .await;
    app.last_todo_reminder = None;
    app.turns_since_todos_closed = 0;
}

/// Age a finished todo list, dropping it once it has survived
/// `TODO_KEEP_CLOSED_TURNS` turns without the model reopening or extending it.
/// Called on every model roundtrip (`Step`) and at each run kick, so a single
/// run's many tool-call turns all count -- a finished plan does not outlive
/// the long run that produced it.
///
/// Without this the widget is sticky: `is_empty` means "no tasks exist", and a
/// completed task is still a task, so a finished plan renders forever and only
/// a fresh `todo init` ever replaces it. Users end up reading a plan that
/// belongs to work they finished several tasks ago.
async fn age_closed_todos(app: &mut App) {
    if app.todos.is_empty() || app.todos.has_open() {
        // Nothing to age, or the model still has open work.
        app.turns_since_todos_closed = 0;
        return;
    }
    app.turns_since_todos_closed += 1;
    if app.turns_since_todos_closed > TODO_KEEP_CLOSED_TURNS {
        clear_todos(app).await;
        app.persist();
    }
}

/// Build the `/todo` editor rows: one per task, in phase/task order, prefixed by
/// a status glyph. `value` is the task content (its stable mutation id).
fn build_todo_items(todos: &crate::core::agent::todo::TodoList) -> Vec<PickerItem> {
    use crate::core::agent::todo::TodoStatus;
    let mut items = Vec::new();
    for phase in &todos.phases {
        for task in &phase.tasks {
            let marker = match task.status {
                TodoStatus::InProgress => "▸",
                TodoStatus::Pending => "○",
                TodoStatus::Completed => "✔",
                TodoStatus::Abandoned => "✗",
            };
            items.push(PickerItem {
                value: task.content.clone(),
                label: format!("{marker} {}", task.content),
                hint: (!phase.name.is_empty()).then(|| phase.name.clone()),
                checkbox: None,
            });
        }
    }
    items
}

/// Open the `/todo` editor overlay over the current phased list.
fn open_todo_picker(app: &mut App) {
    if app.todos.is_empty() {
        app.note("no todos yet — the agent declares them, or add one: /todo add TEXT");
        return;
    }
    app.picker = Some(Picker {
        kind: PickerKind::Todo,
        items: build_todo_items(&app.todos),
        selected: 0,
    });
}

/// `/todo` handler. Bare opens the editor overlay; `/todo add [PHASE |] TEXT`
/// appends a pending task through the canonical `append` op (default phase
/// "Tasks"), so a user-added task is indistinguishable from a model-added one.
async fn todo_command(app: &mut App, arg: &str) {
    let arg = arg.trim();
    if arg.is_empty() {
        open_todo_picker(app);
        return;
    }
    // Drop the whole list in one step. A finished (or abandoned) task set
    // otherwise lingers in the HUD until every item is removed by hand in the
    // editor, since the model does not always close its own todos out.
    if arg == "clear" {
        if app.todos.is_empty() {
            app.note("no todos to clear");
            return;
        }
        match apply_todo_mutation(app, |list| {
            list.rm(crate::core::agent::todo::Target::All)
        })
        .await
        {
            Ok(()) => app.note("cleared all todos"),
            Err(e) => app.note(&format!("todo clear failed: {e}")),
        }
        return;
    }
    let Some(rest) = arg.strip_prefix("add") else {
        app.note("usage: /todo   (open editor)   |   /todo add [PHASE |] TEXT   |   /todo clear");
        return;
    };
    let rest = rest.trim();
    let (phase, text) = match rest.split_once('|') {
        Some((p, t)) => (p.trim().to_string(), t.trim().to_string()),
        None => ("Tasks".to_string(), rest.to_string()),
    };
    if text.is_empty() {
        app.note("usage: /todo add [PHASE |] TEXT");
        return;
    }
    let phase_label = phase.clone();
    match apply_todo_mutation(app, move |list| list.append(&phase, vec![text])).await {
        Ok(()) => app.note(&format!("added todo to '{phase_label}'")),
        Err(e) => app.note(&format!("todo add failed: {e}")),
    }
}

/// `/cancel` handler: without an argument, clears ALL queued messages.
/// With a numeric argument `/cancel N` (1-indexed), removes the Nth queued
/// message. Notes the result or when the queue is empty.
fn cancel_command(app: &mut App, arg: &str) {
    if app.message_queue.is_empty() {
        app.note("no queued messages to cancel");
        return;
    }
    if arg.is_empty() {
        let n = app.message_queue.len();
        app.message_queue.clear();
        app.note(&format!("cancelled all {n} queued message(s)"));
        return;
    }
    // Try to parse as a 1-indexed position
    if let Ok(idx) = arg.parse::<usize>() {
        if idx == 0 || idx > app.message_queue.len() {
            app.note(&format!(
                "no message at position {idx} (queue has {} messages)",
                app.message_queue.len()
            ));
            return;
        }
        let removed = app.message_queue.remove(idx - 1);
        if let Some(text) = removed {
            let preview = truncate(&text, 40);
            app.note(&format!(
                "cancelled message #{idx}: \"{preview}\" ({} remaining)",
                app.message_queue.len()
            ));
        }
        return;
    }
    app.note(&format!(
        "usage: /cancel [N]  — cancel all or the Nth queued message (queue has {})",
        app.message_queue.len()
    ));
}

/// Print the active goal's condition, turn count, duration, and the evaluator's
/// latest reason. Notes when there is no goal.
fn show_goal_status(app: &mut App) {
    use crate::core::agent::goal::GoalStatus;
    let Some(goal) = app.goal.clone() else {
        app.note("no active goal (set one with /goal <condition>)");
        return;
    };
    let state = match goal.status {
        GoalStatus::Active => "active",
        GoalStatus::Achieved => "achieved",
    };
    app.system_marked(GOAL_GLYPH, Level::Info, &format!("goal [{state}]"));
    app.system_detail_text(&format!("condition: {}", goal.condition));
    app.system_detail_text(&format!(
        "turns: {}   duration: {}",
        goal.turns,
        fmt_duration(goal.elapsed_secs())
    ));
    let reason = if goal.last_reason.is_empty() {
        "(not evaluated yet)"
    } else {
        &goal.last_reason
    };
    app.system_detail_text(&format!("evaluator: {reason}"));
}

/// Set a new goal from `condition` and immediately start a turn toward it (the
/// condition is the first prompt). Replaces any existing goal.
fn set_goal(app: &mut App, condition: &str) {
    use crate::core::agent::goal::GoalState;
    if app.status != Status::Idle {
        app.note("cannot set a goal while a turn is running");
        return;
    }
    let goal = GoalState::new(condition);
    let cond = goal.condition.clone();
    app.goal = Some(goal);
    app.goal_eval_pending = false;
    app.note(&format!("◎ goal set: {cond}"));
    // Start the first turn with the condition as the prompt; on_done triggers
    // the evaluator, which drives the loop from there.
    app.submit_user(cond);
}

/// Format a duration in whole seconds as `Nh Nm Ns` / `Nm Ns` / `Ns`.
fn fmt_duration(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}h {m}m {s}s")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
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

/// Open the `/model` selector listing the `provider / model` pairs this build
/// can actually run, with the current model pre-highlighted.
fn open_model_picker(app: &mut App) {
    let pairs = super::providers::list_provider_models(Some(&app.project_root));
    if pairs.is_empty() {
        return app.note(
            "no models available (add a provider with `jan config set`, or configure one in the desktop app)",
        );
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
/// state. Enter toggles a row in place (see `toggle_mcp_server`); `a` adds, `e`
/// edits, and `d` removes (see the picker key handler).
fn open_mcp_picker(app: &mut App) {
    let servers = super::mcp::list_servers();
    if servers.is_empty() {
        return app.note("no MCP servers configured (press a to add one, or use `jan cli mcp add ...`)");
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

/// Open the `/login` prompt: send the user to Tokamak's API-keys page and wait
/// for the key they paste back. The URL is always written to the transcript, not
/// just handed to the browser, so a headless or remote session can still be
/// completed by hand.
fn open_login_prompt(app: &mut App) {
    app.note("sign in to Tokamak and create an API key:");
    app.system_detail(vec![Span::styled(
        super::tokamak::API_KEYS_URL,
        Style::new().cyan(),
    )]);
    let browser = match super::tokamak::open_api_keys_page() {
        Ok(()) => "opening that page in your browser".to_string(),
        Err(e) => format!("open that URL yourself ({e})"),
    };
    app.system_detail_text(&browser);
    app.login = Some(LoginPrompt::new());
}

/// Apply a finished verification. Success persists the key and, when the session
/// is pointed at a model this account cannot serve, moves it onto one that works
/// -- otherwise signing in would appear to do nothing on the next message.
fn finish_login(app: &mut App, result: Result<super::tokamak::Login, String>) {
    match result {
        Ok(login) => {
            app.login = None;
            app.note(&format!(
                "signed in to Tokamak - {} model(s) available, key saved to {}",
                login.models.len(),
                login.config_path.display()
            ));
            adopt_login_model(app, &login);
        }
        Err(e) => {
            // Keep the prompt open with the reason: a rejected key is usually a
            // partial paste, and reopening from scratch loses that context.
            if let Some(prompt) = app.login.as_mut() {
                prompt.verifying = false;
                prompt.input.clear();
                prompt.error = Some(e);
            } else {
                app.note(&format!("sign-in failed: {e}"));
            }
        }
    }
}

/// Point the session at a Tokamak model when the current one is not runnable.
/// A model that already resolves is left alone: `/login` is also used to refresh
/// an expired key, which must not silently switch models.
fn adopt_login_model(app: &mut App, login: &super::tokamak::Login) {
    let runnable = super::providers::list_provider_models(Some(&app.project_root));
    if runnable.iter().any(|(_, m)| *m == app.model) {
        return;
    }
    if let Some(model) = login.models.first() {
        app.set_model(model.clone());
    }
}

/// Open the `/config` screen: a read-only view of the providers configured in
/// `~/.jan/config.toml` (the standalone-agent credential store), with API keys
/// redacted. Editing is headless via `jan config set/unset` (shown in the
/// footer), since a TUI is not the safe place to type secrets.
fn open_config_screen(app: &mut App) {
    let configs = match crate::core::agent::global_config::load_global_config() {
        Ok(c) => c,
        Err(e) => return app.note(&format!("failed to read ~/.jan/config.toml: {e}")),
    };
    let mut providers: Vec<_> = configs.into_values().collect();
    providers.sort_by(|a, b| a.provider.cmp(&b.provider));

    let items: Vec<PickerItem> = if providers.is_empty() {
        vec![PickerItem {
            label: "no providers configured - run: jan config set --provider <id> --api-key <key>"
                .to_string(),
            value: String::new(),
            hint: None,
            checkbox: None,
        }]
    } else {
        providers
            .into_iter()
            .map(|c| {
                let key = if c.api_key.is_some() { "key set" } else { "no key" };
                let base = c.base_url.as_deref().unwrap_or("default url");
                PickerItem {
                    label: format!("{key}  {base}  {} model(s)", c.models.len()),
                    value: c.provider.clone(),
                    hint: Some(c.provider),
                    checkbox: None,
                }
            })
            .collect()
    };
    app.picker = Some(Picker {
        kind: PickerKind::ViewConfig,
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

/// Reload an active `/goal` for a resumed thread from its persisted metadata.
/// An old thread with no goal (or a malformed one) simply clears the goal.
fn restore_goal(app: &mut App, metadata: Option<&serde_json::Value>) {
    app.goal = None;
    app.goal_eval_pending = false;
    let Some(meta) = metadata else { return };
    if let Some(goal) = meta
        .get("goal")
        .and_then(|v| serde_json::from_value::<crate::core::agent::goal::GoalState>(v.clone()).ok())
    {
        if goal.is_active() {
            app.note(&format!("resumed active goal: {}", goal.condition));
        }
        app.goal = Some(goal);
    }
}

/// Reload the persisted `RunMode` for a resumed thread. Defaults to `Normal` on
/// absence/malformed metadata. Resume restores the mode only; the run stays at
/// `Status::Idle` (set by the resume path), so a saved plan never auto-executes.
fn restore_run_mode(app: &mut App, metadata: Option<&serde_json::Value>) {
    use crate::core::agent::plan::RunMode;
    app.run_mode = RunMode::Normal;
    let Some(meta) = metadata else { return };
    if let Some(mode) = meta
        .get("run_mode")
        .and_then(|v| serde_json::from_value::<RunMode>(v.clone()).ok())
    {
        app.run_mode = mode;
        if mode == RunMode::Plan {
            app.note("resumed in plan mode (read only); /plan exit to leave");
        }
    }
}

/// Reload the canonical todo list for a resumed thread from its persisted
/// metadata into the TUI projection. The caller also mirrors it into the shared
/// registry so the model's next `todo` op operates on the reconstructed state.
fn restore_todos(app: &mut App, metadata: Option<&serde_json::Value>) {
    app.todos = crate::core::agent::todo::TodoList::default();
    app.last_todo_reminder = None;
    let Some(meta) = metadata else { return };
    if let Some(todos) = meta
        .get("todos")
        .and_then(|v| serde_json::from_value::<crate::core::agent::todo::TodoList>(v.clone()).ok())
    {
        app.todos = todos;
    }
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

    // Lift the target user message's text into the input area so the user
    // can re-submit (or edit) it after the rewind. Image-only content yields
    // no text.
    let fill = user_content_parts(
        app.history.get(cut).and_then(|m| m.get("content")).unwrap_or(&serde_json::Value::Null),
    )
    .0;

    app.history.truncate(cut);
    // The journal is keyed by its own user entries, not by history indices: it
    // holds rows (tool calls, reasoning) that history never had.
    app.display_log
        .truncate(journal::truncate_at_user(&app.display_log, target));
    app.checkpoints.retain(|c| c.user_index < target);
    rebuild_transcript(app);
    rebuild_recall(app);
    app.status = Status::Idle;
    app.run_started = None;
    app.scrollback = 0;
    app.input_clear();
    app.input = fill;
    app.cursor = app.input.len();
    app.note(&format!("rewound to message #{}", target + 1));
    app.persist();
}

/// Rebuild Up/Down recall from `history`, the conversation being the one source
/// of truth for it. Anything that replaces or truncates the conversation
/// (resume, rewind) calls this, so recall can never offer a message the thread
/// no longer contains -- nor lose the ones it does.
fn rebuild_recall(app: &mut App) {
    app.input_history.clear();
    app.reset_recall();
    let texts: Vec<String> = app
        .history
        .iter()
        .filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
        .filter_map(|m| m.get("content"))
        .map(|c| user_content_parts(c).0)
        .filter(|t| !t.is_empty())
        .collect();
    for text in texts {
        app.record_submitted(&text);
    }
}

/// Replay a display journal through the very paths that rendered it live, so a
/// resumed or rewound transcript keeps its reasoning, tool rows and diff panels.
/// The replayed events journal themselves again, so `entries` is reinstated as
/// the log afterwards instead of whatever the replay appended.
fn replay_display_log(app: &mut App, entries: Vec<DisplayEntry>) {
    for entry in &entries {
        match entry {
            DisplayEntry::User { text, images } => {
                app.finalize_tool_group();
                app.push_user_line(text, images);
            }
            // Through `flush_assistant`, not `push_assistant_blocks`: the prose
            // is also what closes the preceding run of grouped calls. Rendering
            // the blocks directly leaves the group open, so every later call
            // folds back into one row that is never committed -- the whole turn's
            // tool calls then render as nothing at all.
            DisplayEntry::Assistant { text } => {
                app.assistant_buf = text.clone();
                app.flush_assistant();
            }
            DisplayEntry::ToolCall { id, name, args } => app.apply(StreamEvent::ToolCall {
                id: id.clone(),
                name: name.clone(),
                args: args.clone(),
            }),
            DisplayEntry::ToolResult {
                id,
                content,
                is_error,
                diff,
            } => app.apply(StreamEvent::ToolResult {
                id: id.clone(),
                content: content.clone(),
                is_error: *is_error,
                diff: diff.clone(),
            }),
            DisplayEntry::Subagent {
                name,
                calls,
                finished,
            } => {
                app.finalize_tool_group();
                app.push_subagent_summary(name, calls.clone(), *finished);
            }
        }
    }
    // A replay is rendering, not work: the calls it re-renders must not stage
    // files for the next checkpoint, leave a call awaiting a diff, or read as
    // todo activity in the turn that follows.
    app.finalize_tool_group();
    app.turn_touched.clear();
    app.diff_paths.clear();
    app.todo_call_this_turn = false;
    app.display_log = entries;
}

/// Re-render the transcript after a rewind: from the display journal when there
/// is one (so the kept turns keep their reasoning and tool rows), else from the
/// `history` the rewind left behind.
fn rebuild_transcript(app: &mut App) {
    app.transcript.clear();
    app.tool_group = None;
    app.grouped_ids.clear();
    app.starting.clear();
    app.groups.clear();
    app.pending_rows.clear();
    app.reasoning_blocks.clear();
    app.subagent_blocks.clear();
    app.expanded.clear();
    app.reveal = None;
    app.assistant_buf.clear();
    app.last_kind = Kind::None;
    if !app.display_log.is_empty() {
        let logged = std::mem::take(&mut app.display_log);
        return replay_display_log(app, logged);
    }
    let history = app.history.clone();
    for m in &history {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role == "user" {
            let (text, images) = user_content_parts(m.get("content").unwrap_or(&serde_json::Value::Null));
            if text.is_empty() && images.is_empty() {
                continue;
            }
            app.push_user_line(&text, &images);
        } else if role == "assistant" {
            let text = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if !text.is_empty() {
                app.push_assistant_blocks(text);
            }
        }
    }
}

async fn resume_thread(app: &mut App, id_arg: &str) {
    apply_resume(app, &ResumeTarget::Id(id_arg.to_string())).await;
}

/// Resolve a resume target and load it into the app, reporting why not when it
/// cannot be resolved. The session is left untouched on failure.
async fn apply_resume(app: &mut App, target: &ResumeTarget) {
    match super::find_resume_thread(&app.agent_dir, target) {
        Ok(thread) => load_thread(app, &thread).await,
        Err(e) => app.note(&e),
    }
}

/// Replace the live session with a saved thread's state: history, transcript,
/// snapshots, goal, and model. Only user/assistant text is replayed (tool calls
/// are not persisted as messages).
async fn load_thread(app: &mut App, thread: &serde_json::Value) {
    let full_id = thread.get("id").and_then(|v| v.as_str()).unwrap_or_default();

    let (messages, skipped) = match super::cli_read_messages_lenient(&app.agent_dir, full_id) {
        Ok(m) => m,
        Err(e) => return app.note(&format!("failed to load messages: {e}")),
    };

    app.history.clear();
    app.thread_id = Some(full_id.to_string());
    app.transcript.clear();
    app.tool_group = None;
    app.grouped_ids.clear();
    app.groups.clear();
    app.pending_rows.clear();
    app.reasoning_blocks.clear();
    app.subagent_blocks.clear();
    app.expanded.clear();
    app.reveal = None;
    app.assistant_buf.clear();
    app.turn = (0, 0);
    app.tokens = 0;
    app.scrollback = 0;
    app.message_queue.clear();
    restore_snapshots(app, thread.get("metadata"));
    restore_goal(app, thread.get("metadata"));
    restore_run_mode(app, thread.get("metadata"));
    restore_todos(app, thread.get("metadata"));
    // Mirror the reconstructed todos into the shared registry so the model's
    // next `todo` mutation operates on the resumed state, not an empty list.
    if let Some(args) = app.args.as_ref() {
        if let Some(registry) = args.todo_registry.as_ref() {
            *registry.lock().await = app.todos.clone();
        }
    }

    // Adopt the thread's model so continuation stays coherent.
    if let Some(model) = thread
        .get("model")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
    {
        app.model = model.to_string();
    }

    // The journal holds what was rendered (reasoning, tool rows, diffs); the
    // messages hold what the model is sent. Prefer the journal for the
    // transcript, and fall back to replaying the messages for a thread saved
    // before journaling (or whose journal was lost).
    let logged = journal::read_journal(&journal::journal_path(&app.agent_dir, full_id));
    app.history = super::rebuild_wire_history(&messages);
    let count = app
        .history
        .iter()
        .filter(|m| {
            matches!(
                m.get("role").and_then(|v| v.as_str()),
                Some("user" | "assistant")
            )
        })
        .count();
    app.display_log.clear();
    if logged.is_empty() {
        rebuild_transcript(app);
    } else {
        replay_display_log(app, logged);
    }
    // Recall follows the conversation, so the replaced session's lines go with
    // it and the resumed thread's come back.
    rebuild_recall(app);

    let title = thread
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("(untitled)");
    app.note(&format!("resumed \"{title}\" ({count} messages)"));
    if skipped > 0 {
        app.note(&format!("{skipped} unreadable message(s) were skipped"));
    }
}

/// Largest image accepted from a path or the clipboard, before base64 (which
/// inflates it by 4/3).
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// Infer an image MIME type from a file extension. `None` when the extension is
/// not a known image type.
fn image_mime_of(path: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Infer an image MIME type from a file extension, defaulting to PNG.
fn image_mime(path: &str) -> &'static str {
    image_mime_of(path).unwrap_or("image/png")
}

/// Read an image file into a `PendingImage` (base64 data URL + basename).
fn load_image_file(path: &str) -> Result<PendingImage, String> {
    use base64::Engine;
    let len = std::fs::metadata(path)
        .map_err(|e| format!("{path}: {e}"))?
        .len();
    if len > MAX_IMAGE_BYTES {
        return Err(format!(
            "{path}: too large ({} MB, max {} MB)",
            len / (1024 * 1024),
            MAX_IMAGE_BYTES / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    if bytes.is_empty() {
        return Err(format!("{path}: empty file"));
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image")
        .to_string();
    Ok(PendingImage {
        name,
        data_url: format!("data:{};base64,{b64}", image_mime(path)),
    })
}

/// Percent-decode a `file://` URI or plain path from clipboard text into a
/// filesystem path. Takes the first line (uri-lists are newline-separated) and
/// strips a `file://[host]` scheme; decodes `%XX` byte escapes.
fn clipboard_path(text: &str) -> Option<String> {
    let line = text.lines().find(|l| !l.trim().is_empty())?.trim();
    let raw = line
        .strip_prefix("file://localhost")
        .or_else(|| line.strip_prefix("file://"))
        .unwrap_or(line);
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&raw[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok().filter(|p| !p.is_empty())
}

/// Load the first loadable image out of a clipboard file list, skipping entries
/// that are missing, oversized, or not a known image type -- the list is
/// whatever the user copied, not necessarily an image.
fn load_first_file_image(files: &[PathBuf]) -> Option<PendingImage> {
    files.iter().find_map(|p| {
        let path = p.to_str()?;
        image_mime_of(path)?;
        load_image_file(path).ok()
    })
}

/// Read an image from the OS clipboard into a `PendingImage`. Prefers raw image
/// data (PNG-encoding it); falls back to treating clipboard text as an image
/// file path or `file://` URI (as file managers and browsers put on the
/// clipboard). Errors when neither yields an image.
fn clipboard_image() -> Result<PendingImage, String> {
    use base64::Engine;
    let mut clip = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = match clip.get_image() {
        Ok(img) => img,
        Err(image_err) => {
            if let Some(path) = clip.get_text().ok().as_deref().and_then(clipboard_path) {
                if std::path::Path::new(&path).is_file() {
                    return load_image_file(&path);
                }
            }
            // macOS Finder copies publish a file URL, not raster data.
            if let Some(img) = clip
                .get()
                .file_list()
                .ok()
                .and_then(|files| load_first_file_image(&files))
            {
                return Ok(img);
            }
            return Err(image_err.to_string());
        }
    };
    let mut png = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut png, img.width as u32, img.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&img.bytes)
            .map_err(|e| e.to_string())?;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(PendingImage {
        name: "clipboard.png".to_string(),
        data_url: format!("data:image/png;base64,{b64}"),
    })
}

/// Build the OpenAI-shaped user message: a plain string with no images, else a
/// content-part array (text first, then `image_url` parts) matching the desktop
/// web-app wire shape.
fn build_user_message(text: &str, images: &[PendingImage]) -> serde_json::Value {
    if images.is_empty() {
        return serde_json::json!({ "role": "user", "content": text });
    }
    let mut parts = Vec::with_capacity(images.len() + 1);
    if !text.is_empty() {
        parts.push(serde_json::json!({ "type": "text", "text": text }));
    }
    for img in images {
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": img.data_url, "detail": "auto" }
        }));
    }
    serde_json::json!({ "role": "user", "content": parts })
}

/// Split a user message's `content` into display text and one label per attached
/// image. Handles plain-string content and the `image_url` content-part array;
/// data-URL parts carry no filename, so their label is empty.
fn user_content_parts(content: &serde_json::Value) -> (String, Vec<String>) {
    match content {
        serde_json::Value::String(s) => (s.clone(), Vec::new()),
        serde_json::Value::Array(parts) => {
            let mut text = String::new();
            let mut images = Vec::new();
            for p in parts {
                match p.get("type").and_then(|v| v.as_str()) {
                    Some("text") => {
                        if let Some(t) = p.get("text").and_then(|v| v.as_str()) {
                            text.push_str(t);
                        }
                    }
                    Some("image_url") => images.push(String::new()),
                    _ => {}
                }
            }
            (text, images)
        }
        _ => (String::new(), Vec::new()),
    }
}

/// Extract plain text from a stored thread message (`content` is an array of
/// `{type,text:{value}}` parts, or occasionally a bare string).
fn message_text(msg: &serde_json::Value) -> String {
    super::thread_message_text(msg)
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

/// One contiguous run of body lines. A committed transcript row is held by
/// index alone, so its cached lines are cloned only when the viewport reaches
/// it; volatile content -- a running group's spinner row, expanded detail, the
/// streaming tail -- is rebuilt every frame regardless and carries its lines
/// inline.
struct Segment {
    idx: Option<usize>,
    height: u16,
    lines: Option<Vec<Line<'static>>>,
}

impl Segment {
    fn eager(idx: Option<usize>, lines: Vec<Line<'static>>, width: u16) -> Segment {
        Segment {
            idx,
            height: wrapped_height(lines.clone(), width),
            lines: Some(lines),
        }
    }
}

/// Whether the body currently ends on a blank line, so `draw` knows if the
/// streaming tail needs a separator above it. Reads the last rendered line
/// rather than the last row's source, since a row renders to several lines.
fn trailing_blank(tail: &[Line<'static>], transcript: &[Row], width: u16) -> bool {
    let blank = |line: &Line<'static>| line.spans.iter().all(|s| s.content.trim().is_empty());
    match tail.last() {
        Some(line) => blank(line),
        None => transcript
            .last()
            .is_none_or(|row| row.lines(width).last().is_none_or(blank)),
    }
}

/// Rows the status panel may take, given the frame it has to share. The
/// conversation is the point of the screen, so the panel is what gives way: it
/// gets what is left after the header, rule, input, dock and
/// `MIN_TRANSCRIPT_ROWS`, capped at `PANEL_MAX_ROWS`, and disappears entirely
/// on a frame with nothing to spare.
fn panel_budget(frame_h: u16, input_h: u16) -> usize {
    let fixed = 1 + 1 + input_h + 1; // header, rule, input, dock
    frame_h
        .saturating_sub(fixed + MIN_TRANSCRIPT_ROWS)
        .min(PANEL_MAX_ROWS as u16) as usize
}

fn draw(f: &mut Frame, app: &mut App) {
    // Cached before anything reads it: the status panel sizes the layout, so a
    // stale width would mis-size the frame a resize lands on. The body spans
    // the full frame width (its border is top-only).
    app.view_width = f.area().width.max(1);
    // Every frame, so a finished plan hides on wall-clock time even with the
    // session idle -- the loop redraws on its tick either way, and ratatui
    // emits nothing until the panel actually changes.
    app.refresh_todo_deadline();
    // Before the layout reads `scrollback`: a drag held past an edge keeps
    // pulling content into view a row per frame.
    autoscroll_selection(app);
    let input_h = input_box_height(app, f.area().width);
    // Live state -- the plan and the running fan-out -- is docked, not woven
    // into the transcript: it describes *now*, and it is what the eye wants
    // right where the typing happens. Built at most once per frame, since its
    // own height sizes the layout, and clamped to what the frame can spare so a
    // short terminal loses panel rows rather than conversation.
    let panel_lines = app
        .picker
        .is_none()
        .then(|| {
            let width = f.area().width.max(1);
            status_panel(app, width, panel_budget(f.area().height, input_h))
        })
        .filter(|l| !l.is_empty());
    let panel_h = panel_lines.as_ref().map_or(0, |l| l.len() as u16);
    // The header stays pinned at the top; the working dir/branch and the
    // transient key hints share the single row *below* the input, so the whole
    // "where am I, what's happening" block reads as one unit at the bottom edge
    // next to where the user types, instead of being split across both ends and
    // spending two rows on it. The panel sits directly above the input box --
    // the last thing in view right before where the user types, not competing
    // with the header for attention. The separator rule is its own row *below*
    // the panel (rather than the body's own bottom border) so the live state
    // reads as part of the input dock, above the line, instead of stranded
    // between the rule and the prompt. A zero-length slot collapses away, so a
    // session with neither todos nor subagents renders exactly as before.
    let raw = Layout::vertical([
        Constraint::Length(1),                 // 0: header
        Constraint::Min(1),                    // 1: body
        Constraint::Length(panel_h),           // 2: status panel
        Constraint::Length(1),                 // 3: separator rule
        Constraint::Length(input_h),           // 4: input
        Constraint::Length(1),                 // 5: path + key hints
    ])
    .split(f.area());
    let panel_area = raw[2];
    let chunks = [raw[0], raw[1], raw[4], raw[5]];

    f.render_widget(header(app), chunks[0]);
    // Drawn for every path (picker included) so the dock always reads the same.
    f.render_widget(Block::default().borders(Borders::TOP), raw[3]);

    // Top border only, so wrapping uses the full width; the border row reduces
    // the vertical viewport.
    let width = chunks[1].width.max(1);

    if let Some(picker) = &app.picker {
        app.row_index.clear();
        let toml_path = app.agent_dir.join("agent.toml");
        draw_picker(f, chunks[1], picker, &toml_path);
        f.render_widget(input_box(app), chunks[2]);
        f.render_widget(dock_line(app, chunks[3].width), chunks[3]);
        return;
    }

    // ---- Measure ----
    // Every committed row contributes only its *height* here, read from the row
    // cache in O(1); the rows the viewport actually shows are the only ones
    // materialized and word-wrapped, in the pass below. Laying the whole
    // session out every frame is what made a long transcript crawl: the body
    // Paragraph wrapped all of it twice (once to count, once to render), so the
    // per-frame cost tracked history rather than what was on screen.
    let mut segs: Vec<Segment> = Vec::with_capacity(app.transcript.len() + 8);
    let mut content_h: u16 = 0;
    let mut reveal_at: Option<u16> = None;
    let frame = app.spinner();
    for (i, row) in app.transcript.iter().enumerate() {
        if app.reveal == Some(i) {
            reveal_at = Some(content_h);
        }
        // Every committed row re-renders at the current width, so a resize
        // re-flows prose, re-boxes diffs and re-truncates labels. The running
        // group's row animates, so it can never come from the row cache.
        let seg = match app
            .tool_group
            .as_ref()
            .filter(|g| g.idx == i && g.is_running())
        {
            Some(g) => Segment::eager(
                Some(i),
                vec![running_group_row(g, app.spinner_frame, width)],
                width,
            ),
            None => Segment {
                idx: Some(i),
                height: row.height(width),
                lines: None,
            },
        };
        content_h = content_h.saturating_add(seg.height);
        segs.push(seg);
        if app.expanded.contains(&i) {
            // Detail rows map back to the same owning idx (not `None`), so a
            // click anywhere in an expanded block collapses it -- not just on
            // its header row, which may have scrolled out of view once the
            // block grew past the viewport (long reasoning, many tool calls).
            let running_group = app.tool_group.as_ref().filter(|g| g.idx == i);
            let detail = app
                .groups
                .iter()
                .find(|g| g.idx == i)
                // The still-running group isn't finalized into `groups` yet,
                // but its row is already clickable/expandable like any other.
                .or(running_group)
                .map(|group| group_detail_lines(group, width))
                .or_else(|| {
                    app.reasoning_blocks
                        .iter()
                        .find(|r| r.idx == i)
                        .map(|block| block.detail.clone())
                })
                .or_else(|| {
                    app.subagent_blocks
                        .iter()
                        .find(|b| b.idx == i)
                        .map(|block| block.detail_lines(width))
                });
            if let Some(detail) = detail {
                let seg = Segment::eager(Some(i), detail, width);
                content_h = content_h.saturating_add(seg.height);
                segs.push(seg);
            }
        }
    }

    // Streaming prose and the awaiting throbbers have no transcript index; they
    // are rebuilt every frame and ride along as one trailing segment.
    let mut tail: Vec<Line<'static>> = Vec::new();
    if !app.assistant_buf.is_empty() {
        let live = live_assistant_lines(&app.assistant_buf, width, !app.show_reasoning);
        if !live.is_empty() {
            // Mirror flush_assistant's `gap(Kind::Prose)` so the separator above
            // streaming prose is present live, not only once it's finalized.
            if !trailing_blank(&tail, &app.transcript, width) {
                tail.push(Line::raw(""));
            }
            // Live tail: same renderer as finalized messages, so an open
            // (unterminated) <think> block dims and grows during streaming.
            tail.extend(live);
        }
    }
    // Awaiting throbbers render last: below the assistant's reasoning/message
    // so the "still waiting" state trails the prose that led up to the wait.
    // A child with a live panel already shows its own throbber in the fan-out
    // block, so only orphaned waits (the child ended, its result has not
    // landed) get a row -- otherwise every parallel dispatch is listed twice.
    let orphaned: Vec<&String> = app
        .awaiting
        .iter()
        .filter(|(_, run_id, _)| !app.subagents.iter().any(|p| &p.run_id == run_id))
        .map(|(_, _, name)| name)
        .collect();
    if (!orphaned.is_empty() || !app.starting.is_empty())
        && !trailing_blank(&tail, &app.transcript, width)
    {
        tail.push(Line::raw(""));
    }
    for name in orphaned {
        tail.push(tool_row(
            frame,
            Style::new().cyan(),
            &format!("Awaiting subagent: {name}"),
            Style::new().cyan().dim(),
        ));
    }
    // In-progress tool calls whose arguments are still streaming: a throbber
    // trails the prose until the full call (with args) arrives and renders its
    // own row.
    for call in &mut app.starting {
        tail.extend(starting_call_lines(call, frame));
    }
    if !tail.is_empty() {
        let seg = Segment::eager(None, tail, width);
        content_h = content_h.saturating_add(seg.height);
        segs.push(seg);
    }

    // TOP border only: the rule under the transcript is now its own row below
    // the todo HUD (see the layout above), not this block's bottom border.
    let inner_h = chunks[1].height.saturating_sub(1);
    let pad = transcript_top_padding(content_h, inner_h);
    if pad > 0 {
        segs.insert(
            0,
            Segment {
                idx: None,
                height: pad,
                lines: Some(vec![Line::raw(""); pad as usize]),
            },
        );
        reveal_at = reveal_at.map(|n| n.saturating_add(pad));
    }
    let total = content_h.saturating_add(pad);
    let max_back = total.saturating_sub(inner_h);
    if let Some(target) = reveal_at {
        // Position the region near the top of the viewport; clamps to pinned
        // bottom when it is already close enough to the end.
        app.scrollback = max_back.saturating_sub(target);
    }
    app.reveal = None;
    app.scrollback = app.scrollback.min(max_back);
    let scroll = max_back - app.scrollback;

    // ---- Materialize the visible window ----
    // Only segments overlapping [scroll, scroll + inner_h) are cloned, so the
    // Paragraph below wraps a viewport's worth of lines instead of the session.
    let end = scroll.saturating_add(inner_h);
    let mut visible: Vec<Line<'static>> = Vec::new();
    // Parallel to the *screen* rows of the body, in wrapped coordinates: which
    // transcript index (if any) owns each one, so a mouse click can be mapped
    // back to a region to toggle.
    let mut row_index: Vec<Option<usize>> = Vec::with_capacity(inner_h as usize);
    let mut first_start: Option<u16> = None;
    let mut at: u16 = 0;
    for seg in segs {
        let seg_end = at.saturating_add(seg.height);
        if seg_end > scroll && at < end {
            first_start.get_or_insert(at);
            visible.extend(match seg.lines {
                Some(lines) => lines,
                // Committed rows are cloned out of the cache only here.
                None => seg
                    .idx
                    .and_then(|i| app.transcript.get(i))
                    .map(|row| row.lines(width))
                    .unwrap_or_default(),
            });
            let visible_rows = seg_end.min(end).saturating_sub(at.max(scroll));
            row_index.extend(std::iter::repeat_n(seg.idx, visible_rows as usize));
        }
        at = seg_end;
        if at >= end {
            break;
        }
    }
    row_index.resize(inner_h as usize, None);

    // What the body still has to skip inside the first partially-scrolled
    // segment; everything before it was never materialized.
    let offset = scroll.saturating_sub(first_start.unwrap_or(scroll));
    let body = Paragraph::new(visible)
        .wrap(Wrap { trim: false })
        .block(Block::default().borders(Borders::TOP));
    f.render_widget(body.scroll((offset, 0)), chunks[1]);
    // The anchor is a screen cell, so content moving under it has to move it
    // too, or an auto-scrolled drag would keep re-selecting the same rows.
    if let Some(sel) = app.selection.as_mut().filter(|s| s.dragging) {
        let delta = scroll as i32 - app.last_scroll as i32;
        if delta != 0 {
            sel.anchor.1 = (sel.anchor.1 as i32 - delta).clamp(0, u16::MAX as i32) as u16;
            sel.moved = true;
        }
    }
    app.transcript_rect = chunks[1];
    app.last_scroll = scroll;
    app.row_index = row_index;

    // Keep the cursor row visible when the input outgrows the box.
    let input_scroll = if app.status == Status::Idle && app.picker.is_none() {
        let visible = chunks[2].height.saturating_sub(1);
        let total = Paragraph::new(input_content_lines(&app.input, app.cursor))
            .wrap(Wrap { trim: false })
            .line_count(chunks[2].width.saturating_sub(2).max(1))
            .min(u16::MAX as usize) as u16;
        total.saturating_sub(visible)
    } else {
        0
    };
    if let Some(lines) = panel_lines {
        f.render_widget(Paragraph::new(lines), panel_area);
    }
    f.render_widget(input_box(app).scroll((input_scroll, 0)), chunks[2]);
    f.render_widget(dock_line(app, chunks[3].width), chunks[3]);

    // `/login` is modal and user-initiated (only reachable while idle), so it
    // outranks the queues below: nothing else may take keystrokes meant for a key.
    if let Some(prompt) = &app.login {
        let height = (LOGIN_PROMPT_ROWS + u16::from(prompt.error.is_some())).min(chunks[1].height);
        let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
        let rect = ratatui::layout::Rect {
            x: chunks[2].x,
            y,
            width: chunks[2].width,
            height,
        };
        draw_login(f, rect, prompt);
    } else if let Some(prompt) = &app.settings_prompt {
        let height = (5 + u16::from(prompt.error.is_some())).min(chunks[1].height);
        let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
        let rect = ratatui::layout::Rect {
            x: chunks[2].x,
            y,
            width: chunks[2].width,
            height,
        };
        let toml_path = app.agent_dir.join("agent.toml");
        draw_settings_prompt(f, rect, prompt, &toml_path);
    } else if let Some(prompt) = &app.mcp_prompt {
        let height = prompt.visible_fields().len() as u16 + 3;
        let height = height.min(chunks[1].height);
        let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
        let rect = ratatui::layout::Rect {
            x: chunks[2].x,
            y,
            width: chunks[2].width,
            height,
        };
        draw_mcp_prompt(f, rect, prompt);
    } else if !app.ask_queue.is_empty() {
        let queue_len = app.ask_queue.len();
        let ask = app.ask_queue.front_mut().expect("checked non-empty above");
        let height = (ask.row_count() as u16 + 4).min(chunks[1].height);
        let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
        let rect = ratatui::layout::Rect {
            x: chunks[2].x,
            y,
            width: chunks[2].width,
            height,
        };
        draw_ask(f, rect, ask, queue_len);
    } else if let Some(pending) = app.pending() {
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
        draw_permission(f, rect, pending, app.pending_queue.len());
    } else {
        // Dock the slash-command hints above the input box, growing upward
        // and clamped to the body so they never overrun the transcript.
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
        } else if app.has_path_hints() {
            let height = (app.path_hints.len() as u16 + 2).min(chunks[1].height);
            let y = chunks[2].y.saturating_sub(height).max(chunks[1].y);
            let rect = ratatui::layout::Rect {
                x: chunks[2].x,
                y,
                width: chunks[2].width,
                height,
            };
            draw_path_hints(f, rect, &app.path_hints, app.path_hint_selected);
        }
    }

    // Last, over the finished frame, so the highlight covers every surface --
    // transcript, dock, overlays -- without each having to know about it.
    if let Some(sel) = app.selection {
        let area = f.area();
        let buf = f.buffer_mut();
        if std::mem::take(&mut app.copy_armed) {
            let text = selection_text(buf, sel, area);
            if !text.trim().is_empty() {
                app.copied = Some((Instant::now(), text.lines().count()));
                app.copy_request = Some(text);
            }
        }
        for (row, c0, c1) in sel.spans(area.width) {
            for col in c0..=c1 {
                if let Some(cell) = buf.cell_mut((col, row)) {
                    let style = cell.style().add_modifier(Modifier::REVERSED);
                    cell.set_style(style);
                }
            }
        }
    }
}

fn draw_ask(f: &mut Frame, area: Rect, ask: &mut PendingAsk, queue_len: usize) {
    use ratatui::widgets::{Clear, List, ListItem, ListState};

    let question = ask.question().clone();
    let answer = ask.answers[ask.question_index].clone();
    let dim = Style::new().dark_gray();
    let title = if queue_len > 1 {
        format!(
            " question {}/{} · request 1/{queue_len} ",
            ask.question_index + 1,
            ask.request.questions.len()
        )
    } else {
        format!(
            " question {}/{} ",
            ask.question_index + 1,
            ask.request.questions.len()
        )
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().cyan())
        .title(Span::styled(title, Style::new().on_cyan().black().bold()));
    let inner = block.inner(area);
    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(ask.row_count() as u16),
        Constraint::Length(1),
    ])
    .split(inner);

    let mut items = Vec::with_capacity(ask.row_count());
    for (index, option) in question.options.iter().enumerate() {
        let selected = answer.selected.iter().any(|label| label == &option.label);
        let mark = if question.multi {
            if selected {
                "[x] "
            } else {
                "[ ] "
            }
        } else if selected {
            "● "
        } else {
            "○ "
        };
        let mut spans = vec![
            Span::styled(mark, Style::new().cyan()),
            Span::raw(option.label.clone()),
        ];
        if question.recommended == Some(index) {
            spans.push(Span::styled("  recommended", Style::new().green().dim()));
        }
        if let Some(description) = &option.description {
            spans.push(Span::styled(format!("  {description}"), dim));
        }
        items.push(ListItem::new(Line::from(spans)));
    }
    let custom_mark = if question.multi {
        if answer.custom_input.is_some() {
            "[x] "
        } else {
            "[ ] "
        }
    } else if answer.custom_input.is_some() {
        "● "
    } else {
        "○ "
    };
    items.push(ListItem::new(Line::from(vec![
        Span::styled(custom_mark, Style::new().cyan()),
        Span::raw("Other (type your own)"),
    ])));
    if question.multi {
        items.push(ListItem::new(Line::styled(
            "Submit answers",
            Style::new().green().bold(),
        )));
    }

    ask.rect = area;
    ask.row_hitboxes = (0..items.len())
        .filter_map(|index| {
            let y = rows[1].y.saturating_add(index as u16);
            (y < rows[1].y.saturating_add(rows[1].height)).then_some((y, index))
        })
        .collect();

    f.render_widget(Clear, area);
    f.render_widget(block, area);
    f.render_widget(
        Paragraph::new(Line::styled(question.question, Style::new().bold())),
        rows[0],
    );
    let list = List::new(items)
        .highlight_style(Style::new().reversed().bold())
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(ask.selected));
    f.render_stateful_widget(list, rows[1], &mut state);
    let help = if ask.editing_custom {
        Line::from(vec![
            Span::styled("Other: ", Style::new().cyan()),
            Span::raw(ask.custom_input.clone()),
            Span::styled("█", Style::new().cyan()),
        ])
    } else {
        Line::styled(
            if question.multi {
                "↑↓ move · Space toggle · Enter choose · ←→ question · Esc cancel"
            } else {
                "↑↓ move · Enter choose · ←→ question · Esc cancel"
            },
            dim,
        )
    };
    f.render_widget(Paragraph::new(help), rows[2]);
}

/// Rows the `/login` box needs: two borders, the URL, the field, and the help
/// line. An error adds one more (see the `draw` call site).
const LOGIN_PROMPT_ROWS: u16 = 5;

/// The `/login` prompt: the API-keys URL, a masked key field, and a help line.
/// The key is never rendered, so a shared screen or scrollback capture cannot
/// leak it.
fn draw_login(f: &mut Frame, area: ratatui::layout::Rect, prompt: &LoginPrompt) {
    use ratatui::widgets::Clear;

    let dim = Style::new().dark_gray();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().cyan())
        .title(Span::styled(
            " tokamak sign-in ",
            Style::new().on_cyan().black().bold(),
        ));

    let mut lines = vec![Line::from(vec![
        Span::styled("get a key at ", dim),
        Span::styled(super::tokamak::API_KEYS_URL, Style::new().cyan()),
    ])];
    if let Some(error) = &prompt.error {
        lines.push(Line::styled(error.clone(), Style::new().red()));
    }
    if prompt.verifying {
        lines.push(Line::styled(
            "verifying...".to_string(),
            Style::new().yellow(),
        ));
        lines.push(Line::styled("Esc cancel".to_string(), dim));
    } else {
        lines.push(Line::from(vec![
            Span::styled("API key: ", Style::new().bold()),
            Span::raw(prompt.masked()),
            Span::styled("█", Style::new().cyan()),
        ]));
        lines.push(Line::styled(
            "paste the key · Enter verify · Esc cancel".to_string(),
            dim,
        ));
    }

    f.render_widget(Clear, area);
    let inner = block.inner(area);
    f.render_widget(block, area);
    f.render_widget(Paragraph::new(lines), inner);
}

/// Docked `/settings` edit prompt, styled like the `/login` dock: description,
/// the current on-disk value, the field being edited, an inline validation
/// error when one fired, and the save/cancel keys.
fn draw_settings_prompt(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    prompt: &SettingsPrompt,
    toml_path: &std::path::Path,
) {
    use ratatui::widgets::Clear;

    let dim = Style::new().dark_gray();
    let def = prompt.def();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().cyan())
        .title(Span::styled(
            format!(" agent settings: {} ", def.key),
            Style::new().on_cyan().black().bold(),
        ));

    let mut lines = vec![Line::from(vec![
        Span::styled(def.desc, dim),
        Span::styled("   current: ", dim),
        Span::styled(
            current_agent_value(toml_path, def.key).unwrap_or_else(|| "unset".to_string()),
            Style::new().cyan(),
        ),
    ])];
    lines.push(Line::styled(
        match def.kind {
            AgentSettingKind::Int { default, min } => {
                let d = default
                    .map(|d| d.to_string())
                    .unwrap_or_else(|| "unset".to_string());
                format!("default: {d} · valid: >= {min}")
            }
            AgentSettingKind::Enum { options, default } => {
                format!("default: {default} · valid: {}", options.join(" | "))
            }
            AgentSettingKind::Bool { default } => {
                format!("default: {default} · valid: true | false")
            }
        },
        dim,
    ));
    if let Some(error) = &prompt.error {
        lines.push(Line::styled(error.clone(), Style::new().red()));
    }
    lines.push(Line::from(vec![
        Span::styled("value: ", Style::new().bold()),
        Span::raw(prompt.input.clone()),
        Span::styled("█", Style::new().cyan()),
    ]));
    lines.push(Line::styled(
        "Enter save · Esc cancel · clear field to unset (default applies)".to_string(),
        dim,
    ));

    f.render_widget(Clear, area);
    let inner = block.inner(area);
    f.render_widget(block, area);
    f.render_widget(Paragraph::new(lines), inner);
}

/// Dock the MCP add/edit wizard above the input: one row per visible field,
/// the active field highlighted, with a toggle marker on transport/active.
fn draw_mcp_prompt(f: &mut Frame, area: ratatui::layout::Rect, prompt: &McpPrompt) {
    use ratatui::widgets::Clear;

    let dim = Style::new().dark_gray();
    let title = if prompt.editing.is_some() {
        " mcp server: edit "
    } else {
        " mcp server: add "
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().cyan())
        .title(Span::styled(title, Style::new().on_cyan().black().bold()));

    let mut lines = Vec::new();
    for field in prompt.visible_fields() {
        let selected = field == prompt.field;
        let (label, value, toggle) = match field {
            McpField::Name => ("name", prompt.name.as_str(), None),
            McpField::Transport => ("type", prompt.transport.as_str(), Some(prompt.transport.as_str())),
            McpField::Command => ("command", prompt.command.as_str(), None),
            McpField::Args => ("args", prompt.args.as_str(), None),
            McpField::Env => ("env", prompt.env.as_str(), None),
            McpField::Url => ("url", prompt.url.as_str(), None),
            McpField::Headers => ("headers", prompt.headers.as_str(), None),
            McpField::Active => {
                ("active", if prompt.active { "yes" } else { "no" }, Some(if prompt.active { "yes" } else { "no" }))
            }
        };
        let marker = if selected { "› " } else { "  " };
        let style = if selected {
            Style::new().bold()
        } else {
            dim
        };
        let mut spans = vec![
            Span::styled(format!("{marker}{label}: "), style),
        ];
        if let Some(toggle) = toggle {
            spans.push(Span::styled(toggle.to_string(), if selected { Style::new().cyan() } else { dim }));
        } else {
            spans.push(Span::styled(value.to_string(), style));
            if selected {
                spans.push(Span::styled("█", Style::new().cyan()));
            }
        }
        lines.push(Line::from(spans));
    }
    if let Some(error) = &prompt.error {
        lines.push(Line::styled(error.clone(), Style::new().red()));
    }
    lines.push(Line::styled(
        "↑/↓ move · Enter save · Space toggle · Esc cancel".to_string(),
        dim,
    ));

    f.render_widget(Clear, area);
    let inner = block.inner(area);
    f.render_widget(block, area);
    f.render_widget(Paragraph::new(lines), inner);
}

/// the highlighted row reversed. Docked above the input box.
/// Slash hint popup: one row per match (`/name [hint]  description`), the
/// highlighted row reversed. Built-in commands render cyan; installed project
/// skills render magenta so a `/deploy` completion is distinguishable from a
/// command at a glance. Docked above the input box.
fn draw_slash_hints(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    matches: &[SlashMatch],
    selected: usize,
) {
    use ratatui::widgets::{Clear, List, ListItem, ListState};

    let dim = Style::new().dark_gray();
    let items: Vec<ListItem> = matches
        .iter()
        .map(|m| match m {
            SlashMatch::Command(c) => {
                let mut spans = vec![Span::styled(c.name, Style::new().cyan().bold())];
                if !c.hint.is_empty() {
                    spans.push(Span::styled(format!(" {}", c.hint), dim));
                }
                spans.push(Span::styled(format!("  {}", c.description), dim));
                ListItem::new(Line::from(spans))
            }
            SlashMatch::Skill { name, description } => {
                let desc = if description.is_empty() {
                    "project skill".to_string()
                } else {
                    description.clone()
                };
                ListItem::new(Line::from(vec![
                    Span::styled(name.clone(), Style::new().magenta().bold()),
                    Span::styled(format!("  {desc}"), dim),
                ]))
            }
        })
        .collect();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().dark_gray())
        .title(Span::styled(" commands + skills ", Style::new().dim()));
    f.render_widget(Clear, area);
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::new().reversed())
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(selected.min(matches.len().saturating_sub(1))));
    f.render_stateful_widget(list, area, &mut state);
}

/// File-path hint popup docked above the input when typing `@query`.
/// Shows matching files/directories; arrow keys to navigate, Tab/Enter to
/// select, Esc to dismiss.
fn draw_path_hints(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    entries: &[PathHintItem],
    selected: usize,
) {
    use ratatui::widgets::{Clear, List, ListItem, ListState};

    let dim = Style::new().dark_gray();
    let items: Vec<ListItem> = entries
        .iter()
        .map(|e| {
            let icon = if e.is_dir {
                Span::styled("", Style::new().yellow())
            } else {
                Span::styled("", Style::new().cyan())
            };
            let mut spans = vec![
                icon,
                Span::raw(" "),
                Span::styled(&e.name, Style::new().bold()),
            ];
            let rel = &e.path;
            if rel != &e.name {
                spans.push(Span::styled(format!("  ({rel})"), dim));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().dark_gray())
        .title(Span::styled(" path ", dim));
    f.render_widget(Clear, area);
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::new().reversed())
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(selected.min(entries.len().saturating_sub(1))));
    f.render_stateful_widget(list, area, &mut state);
}

/// Permission prompt docked above the input: names the tool, capability, and
/// target path, then an arrow-navigable option list (Enter confirms the
/// highlighted choice; `y`/`a`/`n` still work as shortcuts).
fn draw_permission(f: &mut Frame, area: ratatui::layout::Rect, pending: &Pending, queue_len: usize) {
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

    let title = if queue_len > 1 {
        format!(" permission required (1 of {queue_len}) ")
    } else {
        " permission required ".to_string()
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::new().yellow())
        .title(Span::styled(title, Style::new().on_yellow().black().bold()));
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

fn draw_picker(
    f: &mut Frame,
    area: ratatui::layout::Rect,
    picker: &Picker,
    toml_path: &std::path::Path,
) {
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

    // The settings menu keeps two rows under the list for the selected
    // setting's description, default, valid range, and current value - the
    // rows themselves stay terse (`key  = value`) because the detail footer
    // explains what each knob does.
    if picker.kind == PickerKind::AgentSettings {
        let list_area = Rect {
            height: area.height.saturating_sub(2),
            ..area
        };
        f.render_stateful_widget(list, list_area, &mut state);
        if let Some(def) = picker
            .items
            .get(picker.selected)
            .and_then(|it| AGENT_SETTINGS.iter().find(|d| d.key == it.value))
        {
            let current = current_agent_value(toml_path, def.key)
                .unwrap_or_else(|| "unset".to_string());
            let meta = match def.kind {
                AgentSettingKind::Int { default, min } => {
                    let d = default
                        .map(|d| d.to_string())
                        .unwrap_or_else(|| "unset".to_string());
                    format!("default: {d} · valid: >= {min} · current: {current}")
                }
                AgentSettingKind::Enum { options, default } => {
                    format!(
                        "default: {default} · valid: {} · current: {current}",
                        options.join(" | ")
                    )
                }
                AgentSettingKind::Bool { default } => {
                    format!("default: {default} · valid: true | false · current: {current}")
                }
            };
            let dim = Style::new().dark_gray();
            f.render_widget(
                Paragraph::new(vec![
                    Line::styled(def.desc.to_string(), dim),
                    Line::styled(meta, dim),
                ]),
                Rect {
                    y: list_area.y + list_area.height,
                    height: area.height - list_area.height,
                    ..area
                },
            );
        }
    } else {
        f.render_stateful_widget(list, area, &mut state);
    }
}

/// Render a duration as a compact `"12s"` / `"3m12s"` / `"1h04m"` label.
/// Output tokens per second, flooring the duration at 100ms so a near-instant
/// turn cannot produce a divide-by-tiny spike.
fn tokens_per_second(output_tokens: u64, duration_ms: u64) -> f64 {
    let d = duration_ms.max(100);
    output_tokens as f64 * 1000.0 / d as f64
}

/// Rows the docked status panel may occupy. Both columns elide to fit; a short
/// terminal shrinks the budget further (see `draw`), and a terminal with no
/// room left for the conversation drops the panel entirely.
const PANEL_MAX_ROWS: usize = 8;

/// Conversation rows the panel may never eat into. Below this the panel gives
/// up its own rows first: the transcript is the point of the screen.
const MIN_TRANSCRIPT_ROWS: u16 = 4;

/// Narrowest terminal that still gets two side-by-side columns. Under it they
/// stack, plan first, because a 30-column half fits neither a task nor an agent.
const PANEL_SPLIT_MIN_WIDTH: u16 = 76;

/// Cells between the two columns, including the divider glyph.
const PANEL_GUTTER: u16 = 3;

/// Detail rows one agent may occupy under its stats line, when the budget
/// stretches that far: the dispatch brief and the current activity.
const AGENT_MAX_ROWS: usize = 3;

/// The live fan-out, as a column: one stats line per child plus as much detail
/// as `rows` allows.
///
/// Parallel agents are otherwise unreadable -- N growing sections, with the
/// interesting question (which of these is progressing, and is one about to
/// blow its context) answerable only by counting rows. Here every child gets
/// the same shape, so the whole fan-out reads at a glance and holds a fixed
/// height as the work runs.
fn agents_column(
    panels: &mut [SubagentPanel],
    context_window: u64,
    width: u16,
    rows: usize,
    frame: &str,
) -> Vec<Line<'static>> {
    if panels.is_empty() || rows == 0 {
        return Vec::new();
    }
    let dim = Style::new().dark_gray();
    let max = width.max(8) as usize;
    let mut out = vec![Line::from(vec![
        Span::styled("≡ ", Style::new().magenta()),
        Span::styled(
            pluralize("agent", panels.len()),
            Style::new().magenta().bold(),
        ),
    ])];

    // Fit as many children as the budget allows at one line each, keeping the
    // last row for the count of those that did not fit.
    let body = rows - 1;
    let (shown, hidden) = if panels.len() <= body {
        (panels.len(), 0)
    } else {
        (body.saturating_sub(1), panels.len() - body.saturating_sub(1))
    };
    // Whatever is left over after one line each is spread evenly as detail.
    let per = (body - shown)
        .checked_div(shown)
        .map_or(0, |n| n.min(AGENT_MAX_ROWS - 1));

    for panel in panels.iter_mut().take(shown) {
        let mut spans = vec![Span::styled(
            format!("{} ", if panel.queued { "·" } else { frame }),
            Style::new().magenta(),
        )];
        if panel.queued {
            // Parked on the `max_parallel_subagents` cap; the child has not
            // started, so there are no live stats -- its queue position instead.
            spans.push(Span::styled(
                truncate(&panel.name, max.saturating_sub(14)),
                Style::new().magenta().dim(),
            ));
            spans.push(Span::styled(
                format!("  queued ({})", panel.waiting),
                Style::new().yellow(),
            ));
        } else {
            spans.push(Span::styled(
                truncate(&panel.name, max.saturating_sub(20)),
                Style::new().magenta(),
            ));
            // Compact stats: side by side with the plan there is no room for
            // "33 tools  ·  24 req", and the units are obvious in context.
            let mut stats = format!("  {}t · {}r", panel.calls.len(), panel.requests);
            // Only once the child has reported usage; "0%" before its first
            // response would read as a stalled agent rather than a starting one.
            // `context_window` arrives as 0 when the session has disproven it,
            // and the share is clamped: a child on a model with a larger window
            // than the parent's config would otherwise report past 100%.
            if panel.prompt_tokens > 0 && context_window > 0 {
                let pct = (panel.prompt_tokens as f64 / context_window as f64 * 100.0).min(100.0);
                stats.push_str(&format!(" · {pct:.1}%"));
            }
            spans.push(Span::styled(stats, dim));
        }
        out.push(Line::from(spans));

        if per == 0 {
            continue;
        }
        // The dispatch brief says what this child is *for*. Split on the task's
        // own newlines rather than word-wrapping: models write these as
        // structured briefs whose first line is the summary.
        let brief = panel.task.lines().find(|l| !l.trim().is_empty());
        let activity = match panel.active.as_mut() {
            Some(call) => Some((format!("{frame} {}", call.activity_label()), Style::new().cyan().dim())),
            None => panel
                .calls
                .last()
                .map(|label| (label.clone(), Style::new().dim()))
                .or_else(|| (!panel.queued).then(|| ("starting…".to_string(), Style::new().dim()))),
        };
        // With only one detail row the activity wins: what it is doing now is
        // worth more than what it was asked, which the transcript already shows.
        let detail: Vec<(String, Style)> = match (per, brief, activity) {
            (1, _, Some(a)) => vec![a],
            (1, Some(b), None) => vec![(b.trim().to_string(), Style::new().dim().italic())],
            (_, Some(b), Some(a)) => {
                vec![(b.trim().to_string(), Style::new().dim().italic()), a]
            }
            (_, None, Some(a)) => vec![a],
            (_, Some(b), None) => vec![(b.trim().to_string(), Style::new().dim().italic())],
            _ => Vec::new(),
        };
        for (text, style) in detail {
            out.push(Line::from(vec![
                Span::raw("   "),
                Span::styled(truncate(&text, max.saturating_sub(3)), style),
            ]));
        }
    }
    if hidden > 0 {
        out.push(Line::from(vec![Span::styled(
            format!("  +{hidden} more running"),
            dim,
        )]));
    }
    out.truncate(rows);
    out
}

/// Token counts as `43K` / `1.1K` / `840` -- three significant characters, so a
/// column of them stays the same width as the numbers grow.
fn compact_tokens(n: u64) -> String {
    match n {
        0..=999 => n.to_string(),
        1_000..=9_999 => format!("{:.1}K", n as f64 / 1000.0),
        10_000..=999_999 => format!("{}K", n / 1000),
        _ => format!("{:.1}M", n as f64 / 1_000_000.0),
    }
}

/// Per-turn receipt: wall-clock, context sent, tokens produced, elapsed, rate.
fn turn_stats_line(prompt_tokens: u64, output_tokens: u64, elapsed: Duration) -> Line<'static> {
    let secs = elapsed.as_secs_f64();
    let rate = tokens_per_second(output_tokens, elapsed.as_millis() as u64);
    let dim = Style::new().dark_gray();
    let mut spans = vec![Span::styled(local_timestamp(), dim)];
    for (glyph, value) in [
        ("↑", compact_tokens(prompt_tokens)),
        ("↓", compact_tokens(output_tokens)),
        ("⏱", format!("{secs:.1}s")),
        ("⚡", format!("{rate:.1}/s")),
    ] {
        spans.push(Span::styled(format!("  {glyph} "), dim));
        spans.push(Span::styled(value, Style::new().dim()));
    }
    Line::from(spans)
}

/// `YYYY-MM-DD HH:MM` in local time, without pulling in a date library:
/// `chrono` is already a dependency, so this is just the formatting choice.
fn local_timestamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn format_elapsed(secs: u64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m{:02}s", secs / 60, secs % 60)
    } else {
        format!("{}h{:02}m", secs / 3600, (secs % 3600) / 60)
    }
}

/// Frames the shimmer rests between sweeps, so the wave reads as a pulse
/// rather than a continuously scrolling band.
const SHIMMER_PAUSE: usize = 4;

/// Sweep a crest across `text`, one character per spinner frame: `palette` is
/// `[crest, trail, base]`, applied to the character under the crest, the one
/// behind it, and everything else.
///
/// Folded reasoning is the one stretch of a run that produces no output at all
/// -- no prose, no tool rows, nothing moving -- so the badge is the only thing
/// that can say the model is still going. The sweep animates in place, without
/// changing the text's width, so nothing to its left shifts as it runs.
fn shimmer_spans(text: &str, palette: [Style; 3], frame: usize) -> Vec<Span<'static>> {
    let chars: Vec<char> = text.chars().collect();
    let head = frame % (chars.len() + SHIMMER_PAUSE);
    chars
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let style = match head.checked_sub(i) {
                Some(0) => palette[0],
                Some(1) => palette[1],
                _ => palette[2],
            };
            Span::styled(c.to_string(), style)
        })
        .collect()
}

fn header(app: &App) -> Paragraph<'static> {
    Paragraph::new(Line::from(header_spans(app)))
}

fn header_spans(app: &App) -> Vec<Span<'static>> {
    let (status, style): (String, Style) = if let Some(kind) = app.compacting {
        (kind.label().to_string(), Style::new().magenta().bold())
    } else if app.status == Status::Idle {
        ("ready".to_string(), Style::new().green())
    } else if !app.show_reasoning {
        // Reasoning folding is on: show the live thought state in place of the
        // generic 'working'. [thinking] while a  block streams; [thought for
        // Ns] for the rest of the turn once it closes.
        match app.reasoning_status() {
            Some(s) => s,
            None => ("working".to_string(), Style::new().cyan().bold()),
        }
    } else {
        ("working".to_string(), Style::new().cyan().bold())
    };
    let turn = match app.turn {
        (0, _) => String::new(),
        (n, 0) => format!("turn {n}  "),
        (n, m) => format!("turn {n}/{m}  "),
    };
    let elapsed = app
        .run_started
        .map(|t| format!("  {}", format_elapsed(t.elapsed().as_secs())))
        .unwrap_or_default();
    // No name chip: the splash names the app (see `Banner`), and the header's
    // columns are better spent on state that changes. The model leads instead,
    // bold so the row still has an anchor on the left; an unset model says so
    // rather than opening the row with blanks.
    let mut spans = vec![if app.model.is_empty() {
        Span::styled(" no model  ", Style::new().red().bold())
    } else {
        Span::styled(format!(" {}  ", app.model), Style::new().bold())
    }];
    // Wall-clock (local) segment, mirroring the reference status line's leading
    // HH:MM. Shown only while a run is active: a clock that ticks once per
    // minute repaints the screen only on the minute, which clears the terminal's
    // text selection mid-drag less often. An idle frame must be fully static so
    // the transcript stays selectable/copyable (the 50ms ticker then emits no
    // output at all).
    if app.run_started.is_some() {
        spans.push(Span::styled(
            format!("  {}", chrono::Local::now().format("%H:%M")),
            Style::new().dim(),
        ));
    }
    spans.push(Span::raw(format!("  {turn}")));
    // The denominator is dropped once an accepted prompt has disproven the
    // configured window: `ctx 143K/128K` is not a gauge, it is a contradiction.
    match (app.tokens, app.context_window_trusted) {
        // Round to nearest K for display clarity.
        (0, true) => spans.push(Span::raw(format!("ctx 0/{}K  ", app.context_window / 1000))),
        (n, true) => spans.push(Span::raw(format!(
            "ctx {}K/{}K  ",
            (n + 500) / 1000,
            app.context_window / 1000
        ))),
        (n, false) => spans.push(Span::raw(format!("ctx {}K  ", (n + 500) / 1000))),
    }
    spans.push(Span::styled(elapsed, Style::new().dim()));
    // Output rate segment: last completed turn's tokens/sec, cached so it holds
    // steady instead of flickering to 0 between turns.
    if let Some(rate) = app.tokens_per_sec {
        spans.push(Span::styled(format!("  {rate:.1}/s"), Style::new().dim()));
    }
    // Active-goal indicator: `◎ /goal active <duration>` (cyan while running,
    // green once achieved), so an unattended run shows the goal is still live.
    if let Some(goal) = app.goal.as_ref() {
        use crate::core::agent::goal::GoalStatus;
        let (label, gstyle) = match goal.status {
            GoalStatus::Active => (
                format!("  ◎ /goal active {}", fmt_duration(goal.elapsed_secs())),
                Style::new().cyan().bold(),
            ),
            GoalStatus::Achieved => ("  ◎ /goal done".to_string(), Style::new().green()),
        };
        spans.push(Span::styled(label, gstyle));
    }
    // Plan-mode badge: `PLAN · read only`. Only shown in Plan mode; normal mode
    // keeps its existing layout unchanged (spec).
    if app.run_mode == crate::core::agent::plan::RunMode::Plan {
        spans.push(Span::styled(
            "  PLAN · read only",
            Style::new().magenta().bold(),
        ));
    }
    spans.push(Span::raw("  "));
    if app.is_thinking() {
        spans.push(Span::styled("[", style));
        spans.extend(shimmer_spans(
            &status,
            [
                Style::new().yellow().bold(),
                Style::new().yellow(),
                Style::new().yellow().dim(),
            ],
            app.spinner_frame,
        ));
        spans.push(Span::styled("]", style));
    } else {
        spans.push(Span::styled(format!("[{status}]"), style));
    }
    spans
}

/// One task row: ` <glyph> <text>`, styled by status. Pending is dim,
/// in-progress accent, completed dim+strikethrough, abandoned red+strikethrough
/// with a distinct `☒` glyph.
fn todo_task_row(task: &crate::core::agent::todo::TodoItem, max: usize) -> Line<'static> {
    use crate::core::agent::todo::TodoStatus;
    let (glyph, style) = match task.status {
        TodoStatus::Pending => ("☐", Style::new().dim()),
        TodoStatus::InProgress => ("☐", Style::new().cyan()),
        TodoStatus::Completed => ("☑", Style::new().dim().add_modifier(Modifier::CROSSED_OUT)),
        TodoStatus::Abandoned => ("☒", Style::new().red().add_modifier(Modifier::CROSSED_OUT)),
    };
    Line::from(vec![
        Span::raw(" "),
        Span::styled(format!("{glyph} "), style),
        Span::styled(truncate(&task.content, max), style),
    ])
}

/// Which phase holds the in-progress task, if any.
fn active_phase(todos: &crate::core::agent::todo::TodoList) -> Option<usize> {
    use crate::core::agent::todo::TodoStatus;
    todos
        .phases
        .iter()
        .position(|p| p.tasks.iter().any(|t| t.status == TodoStatus::InProgress))
}

/// `done/total` over a phase's tasks; abandoned counts as closed.
fn phase_progress(phase: &crate::core::agent::todo::TodoPhase) -> (usize, usize) {
    use crate::core::agent::todo::TodoStatus;
    let done = phase
        .tasks
        .iter()
        .filter(|t| matches!(t.status, TodoStatus::Completed | TodoStatus::Abandoned))
        .count();
    (done, phase.tasks.len())
}

/// 1-based index of the phase the plan is on, for the `idx/count` suffix. With
/// no active task (all done, or none started) this counts the fully finished
/// phases, so a completed plan reads `N/N`.
fn phase_position(todos: &crate::core::agent::todo::TodoList) -> usize {
    active_phase(todos).map(|i| i + 1).unwrap_or_else(|| {
        todos
            .phases
            .iter()
            .filter(|p| {
                let (done, total) = phase_progress(p);
                done == total
            })
            .count()
            .max(1)
    })
}

/// Head line of the plan column: the phase the plan is on, how far into it the
/// agent is, and the command that opens the editor.
///
/// ```text
/// Todos · 1/2 · backend 1/3   /todo
/// ```
fn todo_pin(todos: &crate::core::agent::todo::TodoList) -> Line<'static> {
    let mut spans = vec![Span::styled("Todos", Style::new().cyan().bold())];
    if todos.phases.len() > 1 {
        spans.push(Span::styled(
            format!(" · {}/{}", phase_position(todos), todos.phases.len()),
            Style::new().cyan(),
        ));
    }
    // The phase in flight, or the last one, so a finished plan still reports.
    let idx = active_phase(todos).unwrap_or(todos.phases.len().saturating_sub(1));
    if let Some(phase) = todos.phases.get(idx) {
        let (done, total) = phase_progress(phase);
        let label = if todos.phases.len() > 1 {
            format!(" · {} {done}/{total}", phase.name)
        } else {
            format!(" · {done}/{total}")
        };
        spans.push(Span::styled(label, Style::new().dim()));
    }
    spans.push(Span::styled("   /todo".to_string(), Style::new().dark_gray()));
    Line::from(spans)
}

/// The plan as a column, capped at `rows`:
///
/// ```text
/// Todos · 1/2 · backend 1/3   /todo
///  ☑ scaffold
///  ☐ wire routes
///  +3 more
/// ```
///
/// Only the phase in flight expands its tasks -- the head line already names it
/// and counts the rest, so a header per phase would spend rows repeating that.
fn todo_column(
    todos: &crate::core::agent::todo::TodoList,
    width: u16,
    rows: usize,
) -> Vec<Line<'static>> {
    if todos.is_empty() || rows == 0 {
        return Vec::new();
    }
    let mut lines = vec![todo_pin(todos)];
    let idx = active_phase(todos).unwrap_or(todos.phases.len().saturating_sub(1));
    let Some(phase) = todos.phases.get(idx) else {
        return lines;
    };
    let max = width.saturating_sub(4).max(8) as usize;
    let body = rows - 1;
    let (shown, hidden) = if phase.tasks.len() <= body {
        (phase.tasks.len(), 0)
    } else {
        // Keep the last row for the count of what did not fit.
        let shown = body.saturating_sub(1);
        (shown, phase.tasks.len() - shown)
    };
    for task in phase.tasks.iter().take(shown) {
        lines.push(todo_task_row(task, max));
    }
    if hidden > 0 {
        lines.push(Line::from(vec![Span::styled(
            format!("  +{hidden} more"),
            Style::new().dark_gray(),
        )]));
    }
    lines.truncate(rows);
    lines
}

/// Pad `lines` to exactly `rows` entries so a column keeps its shape when the
/// other one is taller.
fn pad_column(mut lines: Vec<Line<'static>>, rows: usize) -> Vec<Line<'static>> {
    lines.resize_with(rows, || Line::raw(""));
    lines
}

/// Set two columns side by side, `left` padded out to `left_w` and separated by
/// a dim divider. Callers pass columns already clamped to their own widths.
fn join_columns(
    left: Vec<Line<'static>>,
    right: Vec<Line<'static>>,
    left_w: u16,
) -> Vec<Line<'static>> {
    let rows = left.len().max(right.len());
    let (left, right) = (pad_column(left, rows), pad_column(right, rows));
    left.into_iter()
        .zip(right)
        .map(|(l, r)| {
            let pad = (left_w as usize).saturating_sub(spans_width(&l.spans));
            let mut spans = l.spans;
            spans.push(Span::raw(" ".repeat(pad)));
            spans.push(Span::styled(" │ ", Style::new().dark_gray()));
            spans.extend(r.spans);
            Line::from(spans)
        })
        .collect()
}

/// The docked status panel: the plan on the left, the live fan-out on the
/// right, both bounded by `rows`.
///
/// Neither belongs in the transcript -- they describe *now*, not what was said
/// -- so they sit above the input where the eye already is, and they use the
/// width instead of stacking. When the terminal is too narrow to split, the
/// columns stack (plan first, since it is the shorter of the two); when it is
/// too short, `rows` shrinks and each column elides its own tail.
fn status_panel(app: &mut App, width: u16, rows: usize) -> Vec<Line<'static>> {
    if rows == 0 {
        return Vec::new();
    }
    let frame = app.spinner();
    // 0 is the columns' "unknown window" encoding: they suppress the share
    // rather than divide by a value the session has already disproven.
    let context_window = if app.context_window_trusted {
        app.context_window
    } else {
        0
    };
    let has_todos = !app.todos.is_empty() && !app.todos_expired();
    let has_agents = !app.subagents.is_empty();
    match (has_todos, has_agents) {
        (false, false) => Vec::new(),
        (true, false) => todo_column(&app.todos, width, rows),
        (false, true) => agents_column(&mut app.subagents, context_window, width, rows, frame),
        (true, true) if width < PANEL_SPLIT_MIN_WIDTH => {
            // Stacked: the plan keeps its head line plus whatever is left after
            // the agents, which are the thing actually moving.
            let agents = agents_column(
                &mut app.subagents,
                context_window,
                width,
                rows.saturating_sub(1),
                frame,
            );
            let mut out = todo_column(&app.todos, width, rows - agents.len());
            out.extend(agents);
            out
        }
        (true, true) => {
            let left_w = (width.saturating_sub(PANEL_GUTTER)) / 2;
            let right_w = width.saturating_sub(left_w + PANEL_GUTTER);
            let left = todo_column(&app.todos, left_w, rows);
            let right = agents_column(
                &mut app.subagents,
                context_window,
                right_w,
                rows,
                frame,
            );
            join_columns(left, right, left_w)
        }
    }
}

/// Max content rows the input box grows to before it scrolls internally.
const MAX_INPUT_ROWS: u16 = 8;

/// Rows the message box occupies: 1 content row for the idle/working
/// placeholder, or the wrapped input height clamped to `MAX_INPUT_ROWS` while
/// editing, plus one row of air above the dock. The box is borderless, so the
/// two rows this used to add on top of its content were simply blank.
fn input_box_height(app: &App, width: u16) -> u16 {
    let content = if app.picker.is_none() && !(app.status == Status::Running && app.input.is_empty()) {
        let inner = width.saturating_sub(2).max(1);
        let rows = Paragraph::new(input_content_lines(&app.input, app.cursor))
            .wrap(Wrap { trim: false })
            .line_count(inner)
            .max(1) as u16;
        rows.min(MAX_INPUT_ROWS)
    } else {
        1
    };
    content + 1
}

/// Visible input as styled lines: `› ` on the first line, 2-space hang on
/// continuations, and a solid block cursor at the byte offset `cursor` (the
/// character under the cursor is drawn in reverse video; at end of line a
/// reversed space forms the block). Wrapping is left to the Paragraph so long
/// single lines fold within the box width.
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
            let mut spans = vec![prefix];
            if i == caret_seg {
                let (a, b) = seg.split_at(caret_off);
                if !a.is_empty() {
                    spans.push(Span::raw(a.to_string()));
                }
                // Big fixed block cursor: reverse-video the char under the
                // cursor, or a reversed space when at the end of the line.
                let mut chars = b.chars();
                let under = chars.next().unwrap_or(' ');
                spans.push(Span::styled(
                    under.to_string(),
                    Style::new().add_modifier(Modifier::REVERSED),
                ));
                let rest: String = chars.collect();
                if !rest.is_empty() {
                    spans.push(Span::raw(rest));
                }
            } else if !seg.is_empty() {
                spans.push(Span::raw(seg.to_string()));
            }
            Line::from(spans)
        })
        .collect()
}

fn input_box(app: &App) -> Paragraph<'static> {
    let block = Block::default();
    if let Some(kind) = app.compacting.filter(|_| app.input.is_empty()) {
        // Compaction puts nothing in the transcript while it runs, so the input
        // row carries the throbber and the elapsed seconds.
        let elapsed = app
            .compact_started
            .map(|t| format!(" {}", format_elapsed(t.elapsed().as_secs())))
            .unwrap_or_default();
        Paragraph::new(Line::from(vec![
            Span::styled(format!("{} ", app.spinner()), Style::new().magenta()),
            Span::styled(
                format!("{} conversation…{elapsed}", kind.label()),
                Style::new().dim().italic(),
            ),
        ]))
        .block(block)
    } else if app.picker.is_some() {
        Paragraph::new(Line::styled("selecting…", Style::new().dim().italic())).block(block)
    } else if app.status == Status::Running && app.input.is_empty() {
        // Show queue status when running with empty input
        if app.message_queue.is_empty() {
            // The spinner carries the motion; the rest of the row is static so
            // the text stays readable rather than shifting under the eye.
            Paragraph::new(Line::from(vec![
                Span::styled(format!("{} ", app.spinner()), Style::new().cyan()),
                Span::styled(
                    "working… (Esc to cancel, type to queue next message)",
                    Style::new().dim().italic(),
                ),
            ]))
            .block(block)
        } else {
            let n = app.message_queue.len();
            Paragraph::new(Line::from(vec![
                Span::styled(format!("{} ", app.spinner()), Style::new().yellow()),
                Span::styled(
                    format!("⏳ Queued ({n}) — Esc to cancel, type to add more"),
                    Style::new().yellow(),
                ),
            ]))
            .block(block)
        }
    } else if app.input.is_empty() {
        // Same `› ` arrow as the typing view, then a fixed (non-blinking)
        // block cursor in front of the placeholder.
        let placeholder = if app.status == Status::Running {
            "Type to queue next message"
        } else {
            "Type here to chat with agent"
        };
        let cursor_spans: Vec<Span<'static>> = vec![
            Span::styled("› ", Style::new().cyan().bold()),
            Span::styled(" ", Style::new().add_modifier(Modifier::REVERSED)),
            Span::raw(" "),
            Span::styled(placeholder, Style::new().dim().italic()),
        ];
        Paragraph::new(Line::from(cursor_spans)).block(block)
    } else {
        Paragraph::new(input_content_lines(&app.input, app.cursor))
            .wrap(Wrap { trim: false })
            .block(block)
    }
}

/// Build a footer hint line from `(key, label)` pairs, with the key bright and
/// bold so it stands out against the dim label text.
fn hint_spans(key_style: Style, pairs: &[(&str, &str)]) -> Vec<Span<'static>> {
    let mut spans = vec![Span::raw(" ")];
    for (i, (key, label)) in pairs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("   "));
        }
        spans.push(Span::styled(key.to_string(), key_style));
        if !label.is_empty() {
            spans.push(Span::styled(format!(" {label}"), Style::new().dim()));
        }
    }
    spans
}

/// Abbreviate a leading `$HOME` to `~`, so the line reads as a location rather
/// than an absolute path. Non-home paths are returned unchanged.
fn tilde_path(path: &std::path::Path) -> String {
    let full = path.to_string_lossy().into_owned();
    let Some(home) = std::env::var_os("HOME") else {
        return full;
    };
    let home = std::path::Path::new(&home);
    match path.strip_prefix(home) {
        // The home dir itself, not a `~`-prefixed child.
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Ok(rest) => format!("~/{}", rest.to_string_lossy()),
        Err(_) => full,
    }
}

/// Working-dir + branch spans, the left half of the dock row.
fn path_spans(app: &App) -> Vec<Span<'static>> {
    let mut spans = vec![
        Span::styled("📂 ", Style::new().dark_gray()),
        Span::styled(tilde_path(&app.project_root), Style::new().dark_gray()),
    ];
    if let Some(branch) = app.git_branch.as_ref() {
        spans.push(Span::styled(
            format!(" ⎇ {}", branch),
            Style::new().dark_gray(),
        ));
    }
    spans
}

/// Display width of a row, in cells. `Span::width` is grapheme-aware, which a
/// char count is not: the dock opens with an emoji that occupies two cells.
fn spans_width(spans: &[Span<'static>]) -> usize {
    spans.iter().map(Span::width).sum()
}

/// The single row below the input: location on the left, key hints and status
/// on the right. Two separate rows spent a whole line of a small terminal on
/// text that is static all session; merged, the location keeps its place and
/// the hints keep theirs, and only a terminal too narrow for both drops the
/// location.
fn dock_line(app: &App, width: u16) -> Paragraph<'static> {
    let hints = footer_spans(app);
    let mut spans = path_spans(app);
    let (used, hint_w) = (spans_width(&spans), spans_width(&hints));
    // `hint_spans` already opens with a pad; a gap of at least two keeps the
    // location from running into it.
    if used + hint_w + 2 > width as usize {
        return Paragraph::new(Line::from(hints));
    }
    spans.push(Span::raw(" ".repeat(width as usize - used - hint_w)));
    spans.extend(hints);
    Paragraph::new(Line::from(spans))
}

fn footer_spans(app: &App) -> Vec<Span<'static>> {
    if !app.pending_queue.is_empty() {
        return hint_spans(
            Style::new().yellow().bold(),
            &[
                ("↑/↓", "select"),
                ("Enter", "confirm"),
                ("Esc", "deny"),
                ("Ctrl-C", "cancel"),
            ],
        );
    }
    if let Some(picker) = &app.picker {
        return vec![Span::styled(picker.action_hint(), Style::new().dim())];
    }
    // Briefly, and never over a prompt whose keys the user needs: a copy is
    // invisible otherwise, and a transcript note would shift the rows the
    // pointer is still sitting on.
    if let Some(lines) = app.copy_notice() {
        let plural = if lines == 1 { "" } else { "s" };
        return vec![Span::styled(
            format!(" copied {lines} line{plural}"),
            Style::new().green().bold(),
        )];
    }
    let key_style = Style::new().cyan().bold();
    let queue_count = app.message_queue.len();
    let mut spans = match app.status {
        Status::Running => {
            let mut s = hint_spans(
                key_style,
                &[
                    ("Esc/Ctrl-C", "cancel"),
                    ("PgUp/PgDn", "scroll"),
                    ("Ctrl-O", "expand all"),
                ],
            );
            if queue_count > 0 {
                s.insert(0, Span::styled(
                    format!("⏳ Queued ({queue_count})  "),
                    Style::new().yellow().bold(),
                ));
            }
            s
        }
        Status::Idle => {
            // Idle is the default state, so a cheat sheet here is permanent
            // noise. Discovery is already covered without it: the session opens
            // with the splash (`Banner`, which names `/help`), and `/help`
            // carries the full list (see `KEY_BINDINGS`). Keep only the
            // leading pad `hint_spans` emits, so a queue count or detail suffix
            // lands in the same column as the other states.
            let mut s = vec![Span::raw(" ")];
            if queue_count > 0 {
                s.insert(0, Span::styled(
                    format!("⏳ Queued ({queue_count})  "),
                    Style::new().yellow().bold(),
                ));
            }
            s
        }
    };
    if !app.detail.is_empty() {
        // Only separate from a preceding hint; on a bare idle footer the detail
        // is the whole line and should start at the same column as the hints.
        let pad = if spans.len() > 1 { "   " } else { "" };
        spans.push(Span::styled(
            format!("{pad}{}", app.detail),
            Style::new().dim(),
        ));
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::SessionLimits;
    use super::{journal, DisplayEntry};
    use super::{
        age_closed_todos, apply_resume, assistant_is_awaiting_user_answer, brand, build_user_message,
        clipboard_path,
        diff_lines, Row, group_detail_lines, group_summary, handle_ask_key,
        handle_ask_mouse, handle_key, handle_mouse, image_mime, input_content_lines,
        route_paste_event,
        compact_tokens, finish_compaction, finish_login, finish_update_install,
        image_mime_of, load_first_file_image, load_image_file, MAX_IMAGE_BYTES,
        message_text, CompactKind, MAX_OVERFLOW_RETRIES,
        estimate_token_count, header_spans, status_panel, SubagentPanel,
        note_update, open_config_screen, spawn_branch_poll, await_branch_poll,
        parse_command, partial_json_field, restore_goal, restore_run_mode, restore_todos,
        McpPrompt, McpField, pairs_to_str,
        autoscroll_selection, selection_text, Selection, SelectionMode, COPY_NOTICE,
        run_command, starting_call_lines, unescape_partial_json_string,
        running_group_row, split_reasoning, strip_system_xml_tags, subagent_activity,
        subagent_name_from_run_id, summarize_result, tilde_path, tokens_per_second,
        tool_activity, tool_finished,
        transcript_top_padding, rewind_to,
        row_width, user_content_parts, App, CurrentRun, Pending, PendingImage, PickerKind,
        ResumeTarget, RowKind,
        SnapshotJob, Status, AGENT_SETTINGS, ALT_SCROLL_RESTORE, ALT_SCROLL_SAVE_OFF,
        COMMAND_LABEL_MAX, DIFF_ADD_BG, DIFF_DEL_BG, DIFF_MAX_ROWS, DIFF_PREVIEW_MAX_ROWS,
        KEY_BINDINGS, MOUSE_TRACK_ON, SLASH_COMMANDS, SPINNER,
        SPINNER_ADVANCE_MS,
    };
    use std::time::{Duration, Instant};
    use ratatui::crossterm::event::{
        Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent,
        MouseEventKind,
    };
    use ratatui::buffer::Buffer;
    use ratatui::layout::Rect;
    use ratatui::{
        style::{Color, Modifier, Style},
        text::Line,
    };
    use crate::core::agent::events::{StreamEvent, Usage};
    use crate::core::cli::updater::{AvailableUpdate, UpdateOutcome};
    use crate::core::agent::r#loop::PermissionRegistry;
    use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;

    /// A bare key press with no modifiers.
    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn mouse_at(kind: MouseEventKind, column: u16, row: u16) -> MouseEvent {
        MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        }
    }

    /// Press and release without moving: the gesture that toggles a region.
    fn click(app: &mut App, column: u16, row: u16) {
        handle_mouse(
            app,
            mouse_at(MouseEventKind::Down(MouseButton::Left), column, row),
        );
        handle_mouse(
            app,
            mouse_at(MouseEventKind::Up(MouseButton::Left), column, row),
        );
    }

    /// Wraps an `App` bound to a temp dir that is removed when the wrapper is
    /// dropped, so tests that persist threads or journals never leak under
    /// `/tmp` and never dirty the working tree.
    struct TestApp {
        app: App,
        _dir: tempfile::TempDir,
    }

    impl std::ops::Deref for TestApp {
        type Target = App;

        fn deref(&self) -> &App {
            &self.app
        }
    }

    impl std::ops::DerefMut for TestApp {
        fn deref_mut(&mut self) -> &mut App {
            &mut self.app
        }
    }

    fn test_app() -> TestApp {
        // Persist into a unique temp dir so tests that save threads never
        // dirty the working tree (src-tauri/threads/) and the dir is removed on
        // drop.
        let dir = tempfile::tempdir().unwrap();
        let limits = SessionLimits {
            context_window: 128_000,
            reserve_tokens: 16_384,
            max_tokens: None,
            max_session_tokens: 128_000,
        };
        let app = App::new(
            "m".into(),
            limits,
            false,
            dir.path().to_path_buf(),
            std::path::PathBuf::from("/tmp/repo"),
            None,
        );
        TestApp { app, _dir: dir }
    }

    /// App whose project has one installed skill `<name>/SKILL.md` with the
    /// given frontmatter description, so slash-popup and dispatch tests run
    /// against a real `.jan/agent/skills/` tree. Returns the temp project
    /// root for cleanup.
    fn skill_test_app(name: &str, description: &str) -> (App, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "jan_tui_skill_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let agent_dir = root.join(".jan/agent");
        std::fs::create_dir_all(agent_dir.join("skills").join(name)).unwrap();
        std::fs::write(
            agent_dir.join("skills").join(name).join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n\nBody.\n"),
        )
        .unwrap();
        (
            App::new(
                "m".into(),
                8,
                128_000,
                16_384,
                None,
                agent_dir,
                root.clone(),
                None,
            ),
            root,
        )
    }

    /// Draw `app` into an off-screen terminal and return its rows as strings.
    fn render_rows(app: &mut App, w: u16, h: u16) -> Vec<String> {
        use ratatui::{backend::TestBackend, Terminal};
        let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
        terminal.draw(|f| super::draw(f, app)).unwrap();
        let buf = terminal.backend().buffer().clone();
        (0..buf.area.height)
            .map(|y| {
                (0..buf.area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect()
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
    fn tokens_per_second_floors_duration_at_100ms() {
        // 100 tokens over exactly 1s -> 100/s.
        assert_eq!(tokens_per_second(100, 1000), 100.0);
        // Sub-100ms durations are floored at 100ms, so no divide-by-tiny spike:
        // 10 tokens / 0ms and / 100ms both yield 100/s, not infinity.
        assert_eq!(tokens_per_second(10, 0), 100.0);
        assert_eq!(tokens_per_second(10, 50), 100.0);
        assert_eq!(tokens_per_second(10, 100), 100.0);
        // Zero output is a clean 0, never NaN.
        assert_eq!(tokens_per_second(0, 500), 0.0);
    }

    fn available_update(current: &str, latest: &str) -> AvailableUpdate {
        AvailableUpdate {
            channel: "agent-nightly",
            current: current.into(),
            latest: latest.into(),
            url: None,
            sha256: None,
        }
    }

    #[test]
    fn a_newer_build_is_noted_in_the_transcript() {
        let mut app = test_app();
        note_update(&mut app, Some(available_update("0.8.4-10", "0.8.4-11")));
        let text = app
            .transcript
            .iter()
            .map(message_text_of)
            .collect::<String>();
        assert!(text.contains("0.8.4-10 -> 0.8.4-11"), "{text}");
        assert!(text.contains("/update"), "{text}");
    }

    /// A local build, an unreachable manifest and an already-current binary all
    /// arrive as `None`, and must leave the transcript untouched.
    #[test]
    fn no_update_available_notes_nothing() {
        let mut app = test_app();
        let before = app.transcript.len();
        note_update(&mut app, None);
        assert_eq!(app.transcript.len(), before);
    }

    fn transcript_text(app: &App) -> String {
        app.transcript.iter().map(message_text_of).collect()
    }

    #[tokio::test]
    async fn update_command_requests_an_install_once() {
        let mut app = test_app();
        run_command(&mut app, "update").await;
        assert!(app.update_requested, "the loop should pick up the request");
        assert!(transcript_text(&app).contains("downloading"), "no progress note");

        // A second /update while the first is still downloading must not queue a
        // concurrent install (two processes rewriting the same binary).
        app.update_installing = true;
        app.update_requested = false;
        run_command(&mut app, "update").await;
        assert!(!app.update_requested);
        assert!(transcript_text(&app).contains("already installing"));
    }

    #[test]
    fn install_outcome_reports_the_new_version_and_clears_the_flag() {
        let mut app = test_app();
        app.update_installing = true;
        finish_update_install(
            &mut app,
            Ok(UpdateOutcome::Installed {
                from: "0.8.4-10".into(),
                to: "0.8.4-11".into(),
                path: std::path::PathBuf::from("/home/u/.local/bin/jan"),
            }),
        );
        assert!(!app.update_installing);
        let text = transcript_text(&app);
        assert!(text.contains("0.8.4-10 -> 0.8.4-11"), "{text}");
        assert!(text.contains("restart"), "must say the swap needs a restart: {text}");
    }

    #[test]
    fn a_failed_install_is_reported_and_retryable() {
        let mut app = test_app();
        app.update_installing = true;
        finish_update_install(&mut app, Err("checksum mismatch".into()));
        assert!(!app.update_installing, "a failure must allow a retry");
        assert!(transcript_text(&app).contains("checksum mismatch"));
    }

    #[test]
    fn an_already_current_binary_is_not_reinstalled() {
        let mut app = test_app();
        app.update_installing = true;
        finish_update_install(
            &mut app,
            Ok(UpdateOutcome::UpToDate {
                version: "0.8.4-11".into(),
            }),
        );
        assert!(!app.update_installing);
        assert!(transcript_text(&app).contains("0.8.4-11"));
    }

    fn message_text_of(row: &Row) -> String {
        row_text(row)
    }

    /// Text a committed transcript row renders to at a nominal width, joined
    /// across the lines a multi-line row (prose, a diff panel) expands to.
    fn row_text(row: &Row) -> String {
        row_lines(std::slice::from_ref(row))
            .iter()
            .map(line_text)
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Every line the given rows render to at a nominal width.
    fn row_lines(rows: &[Row]) -> Vec<Line<'static>> {
        rows.iter().flat_map(|r| r.lines(80)).collect()
    }

    #[test]
    fn spinner_advances_only_after_a_full_frame_elapses() {
        let mut app = test_app();
        let t0 = Instant::now();
        app.last_spinner_advance = t0;
        app.spinner_frame = 0;
        // One 50ms tick is under the 80ms frame time: no advance.
        app.advance_spinner(t0 + Duration::from_millis(50));
        assert_eq!(app.spinner_frame, 0);
        // A second tick brings cumulative elapsed to 100ms (>= 80): +1 frame.
        app.advance_spinner(t0 + Duration::from_millis(100));
        assert_eq!(app.spinner_frame, 1);
        // Leftover 20ms carried forward: next advance is at 160ms, not 180ms.
        app.advance_spinner(t0 + Duration::from_millis(150));
        assert_eq!(app.spinner_frame, 1);
        app.advance_spinner(t0 + Duration::from_millis(165));
        assert_eq!(app.spinner_frame, 2);
    }

    #[test]
    fn spinner_catches_up_multiple_frames_after_a_stall() {
        let mut app = test_app();
        let t0 = Instant::now();
        app.last_spinner_advance = t0;
        app.spinner_frame = 0;
        // A 500ms stall == floor(500/80) = 6 frames caught up in one advance.
        app.advance_spinner(t0 + Duration::from_millis(500));
        assert_eq!(app.spinner_frame, (500 / SPINNER_ADVANCE_MS) as usize);
        assert_eq!(app.spinner_frame, 6);
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

    /// Committed markdown keeps its source, so a resize re-wraps the table to
    /// the new width instead of leaving rows sized for the old one.
    #[test]
    fn committed_prose_reflows_when_the_terminal_resizes() {
        let mut app = test_app();
        app.push_assistant_blocks(
            "| column one heading | column two heading |\n|---|---|\n\
             | a reasonably long value here | another reasonably long value |",
        );
        let wide = render_rows(&mut app, 100, 20);
        let narrow = render_rows(&mut app, 46, 20);
        let table_row = |rows: &[String]| {
            rows.iter()
                .find(|r| r.contains("column one"))
                .expect("no table row")
                .trim_end()
                .to_string()
        };
        let (w, n) = (table_row(&wide), table_row(&narrow));
        assert!(w.chars().count() > n.chars().count(), "table did not reflow: {w:?} vs {n:?}");
        assert!(n.chars().count() <= 46, "table overflows the narrow frame: {n:?}");
    }

    /// The boxed diff panel is re-drawn at the current width, so its right
    /// border still lands inside the frame after a shrink.
    #[test]
    fn a_committed_diff_panel_reboxes_on_resize() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "e1".into(),
            name: "edit".into(),
            args: json!({"path": "src/main.rs"}),
        });
        app.apply(StreamEvent::ToolResult {
            id: "e1".into(),
            content: "edited".into(),
            is_error: false,
            diff: Some("@@ edit 1/1 @@\n-    let value = compute_something_long(1, 2, 3);\n+    let value = compute_something_much_longer(1, 2, 3, 4);".into()),
        });
        let border_width = |rows: &[String]| {
            rows.iter()
                .find(|r| r.contains('┌'))
                .map(|r| r.trim_end().chars().count())
                .expect("no diff panel")
        };
        let wide = border_width(&render_rows(&mut app, 100, 24));
        let narrow_rows = render_rows(&mut app, 50, 24);
        let narrow = border_width(&narrow_rows);
        assert!(narrow < wide, "panel kept its old width: {narrow} vs {wide}");
        assert!(narrow <= 50, "panel overflows the frame: {narrow}");
        // Every panel row still closes inside the frame, so the box reads as a box.
        for row in narrow_rows.iter().filter(|r| r.contains('│')) {
            assert!(row.trim_end().chars().count() <= 50, "row overflows: {row:?}");
        }
    }

    /// A standalone diff row already names the file in past tense, so the
    /// tool's own "Applied N edit(s) to <path>" summary must not repeat it.
    #[test]
    fn standalone_diff_result_drops_the_redundant_summary_line() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "e1".into(),
            name: "edit".into(),
            args: json!({"path": "src/core/cli/tui.rs"}),
        });
        app.apply(StreamEvent::ToolResult {
            id: "e1".into(),
            content: "Applied 1 edit(s) to src/core/cli/tui.rs".into(),
            is_error: false,
            diff: Some("@@ edit 1/1 @@\n-a\n+b".into()),
        });
        let rows = render_rows(&mut app, 100, 24);
        assert!(
            rows.iter().any(|r| r.contains("Edited tui.rs")),
            "call row lost: {rows:?}"
        );
        assert!(
            !rows.iter().any(|r| r.contains("Applied 1 edit(s)")),
            "duplicate summary line: {rows:?}"
        );
        assert!(
            rows.iter().any(|r| r.contains('┌')),
            "diff panel lost: {rows:?}"
        );
    }

    /// A failed edit's row only says "Edited <file>" with a cross, so the error
    /// text is the only place the reason survives and must still render.
    #[test]
    fn failed_diff_result_keeps_its_error_text() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "e1".into(),
            name: "edit".into(),
            args: json!({"path": "src/main.rs"}),
        });
        app.apply(StreamEvent::ToolResult {
            id: "e1".into(),
            content: "ERROR: src/main.rs: edit 1: old_string not found".into(),
            is_error: true,
            diff: None,
        });
        let rows = render_rows(&mut app, 100, 24);
        assert!(
            rows.iter().any(|r| r.contains("old_string not found")),
            "error text lost: {rows:?}"
        );
    }

    /// A tool row's label is stored untruncated and clamped at draw time, so it
    /// grows back when the terminal widens rather than staying elided.
    #[test]
    fn tool_row_labels_retruncate_on_resize() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "t1".into(),
            name: "bash".into(),
            args: json!({"command": "echo the quick brown fox jumps over the lazy dog"}),
        });
        app.apply(StreamEvent::ToolResult {
            id: "t1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        // Close the group so its row reads as the finished command, not the
        // live "running 1 command" throbber.
        app.finalize_tool_group();
        let label = |rows: &[String]| {
            rows.iter()
                .find(|r| r.contains("Ran: echo"))
                .expect("no tool row")
                .trim_end()
                .to_string()
        };
        let narrow = label(&render_rows(&mut app, 40, 12));
        let wide = label(&render_rows(&mut app, 100, 12));
        assert!(narrow.contains('…'), "narrow row was not elided: {narrow:?}");
        assert!(narrow.chars().count() <= 40, "narrow row overflows: {narrow:?}");
        assert!(
            wide.chars().count() > narrow.chars().count(),
            "row did not grow back: {wide:?}"
        );
    }

    /// Degenerate frames (a sliver of a terminal mid-drag) must render, not panic.
    #[test]
    fn tiny_frames_render_without_panicking() {
        let mut app = test_app();
        app.push_user_line("hello", &[]);
        app.push_assistant_blocks("| a | b |\n|---|---|\n| 1 | 2 |\n\n```rs\nlet x = 1;\n```");
        app.apply(StreamEvent::ToolResult {
            id: "x".into(),
            content: "done".into(),
            is_error: false,
            diff: Some("@@ edit 1/1 @@\n-a\n+b".into()),
        });
        let sizes = [(1, 1), (2, 3), (8, 4), (20, 6), (40, 2), (200, 80)];
        for (w, h) in sizes {
            render_rows(&mut app, w, h);
        }
        // The permission prompt grows upward from the input dock and sizes its
        // diff preview from the frame, so it is the overlay most exposed to a
        // frame that has just shrunk out from under it.
        let mut p = pending(true);
        p.diff = Some("@@ edit 1/1 @@\n-old line of code\n+new line of code".into());
        p.path = Some("src/main.rs".into());
        app.pending_queue.push_back(p);
        for (w, h) in sizes {
            render_rows(&mut app, w, h);
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
        let p = app.pending().unwrap();
        assert_eq!(p.diff.as_deref(), Some("@@ created file @@\n+ hi"));
        let preview = p.diff_preview(60);
        assert!(preview.len() >= 4, "boxed diff expected, got {preview:?}");
        let text: String = preview.iter().map(line_text).collect();
        assert!(text.contains('┌') && text.contains('┘'), "no box frame: {text}");
        assert!(text.contains("+ hi"), "diff content missing: {text}");
    }

    #[test]
    fn config_screen_opens_as_readonly_viewer() {
        let mut app = test_app();
        open_config_screen(&mut app);
        let picker = app.picker.as_ref().expect("config screen opens a picker");
        assert!(picker.kind == PickerKind::ViewConfig);
        // Always at least one row: real providers, or the "no providers" hint.
        assert!(!picker.items.is_empty());
        // Enter is a no-op close (never mutates model/thread), matching the arm.
        assert!(picker.title().contains("config"));
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
        assert!(app.pending().unwrap().diff_preview(60).is_empty());
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

    fn ask_request(
        multi: bool,
        two_questions: bool,
    ) -> crate::core::agent::interaction::AskRequest {
        let mut questions = vec![json!({
            "id": "scope",
            "question": "Which scope?",
            "options": [{"label": "Small"}, {"label": "Large", "description": "Everything"}],
            "multi": multi,
            "recommended": 0
        })];
        if two_questions {
            questions.push(json!({
                "id": "speed",
                "question": "Which speed?",
                "options": [{"label": "Fast"}, {"label": "Careful"}]
            }));
        }
        crate::core::agent::interaction::AskRequest::parse(&json!({
            "questions": questions
        }))
        .unwrap()
    }

    async fn press_ask(
        app: &mut App,
        registry: &crate::core::agent::interaction::AskRegistry,
        code: KeyCode,
    ) {
        assert!(handle_ask_key(app, KeyEvent::new(code, KeyModifiers::NONE), registry,).await);
    }

    #[tokio::test]
    async fn ask_keyboard_preserves_answers_across_questions() {
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, true),
        });

        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert_eq!(app.ask_queue.front().unwrap().question_index, 1);
        press_ask(&mut app, &registry, KeyCode::Left).await;
        assert_eq!(
            app.ask_queue.front().unwrap().answers[0].selected,
            vec!["Small"]
        );
        press_ask(&mut app, &registry, KeyCode::Right).await;
        press_ask(&mut app, &registry, KeyCode::Down).await;
        press_ask(&mut app, &registry, KeyCode::Enter).await;

        assert!(app.ask_queue.is_empty(), "final answer did not submit");
        assert!(
            registry.lock().await.is_empty(),
            "ask sender was not resolved"
        );
        let answers = receiver.await.unwrap().unwrap();
        assert_eq!(answers[0].selected, vec!["Small"]);
        assert_eq!(answers[1].selected, vec!["Careful"]);
        assert!(app.ask_queue.is_empty());
    }

    #[tokio::test]
    async fn ask_keyboard_accepts_repeated_key_events() {
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });

        let mut key = KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE);
        key.kind = KeyEventKind::Repeat;
        assert!(handle_ask_key(&mut app, key, &registry).await);

        let answers = receiver.await.unwrap().unwrap();
        assert_eq!(answers[0].selected, vec!["Small"]);
        assert!(app.ask_queue.is_empty());
    }

    #[tokio::test]
    async fn ask_keyboard_handles_multi_select_and_cancellation() {
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(true, false),
        });

        press_ask(&mut app, &registry, KeyCode::Char(' ')).await;
        for _ in 0..3 {
            press_ask(&mut app, &registry, KeyCode::Down).await;
        }
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert!(app.ask_queue.is_empty(), "multi-select did not submit");
        assert!(
            registry.lock().await.is_empty(),
            "ask sender was not resolved"
        );
        let answers = receiver.await.unwrap().unwrap();
        assert_eq!(answers[0].selected, vec!["Small"]);

        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });
        press_ask(&mut app, &registry, KeyCode::Esc).await;
        assert!(matches!(
            receiver.await.unwrap(),
            Err(crate::core::agent::interaction::AskError::Cancelled)
        ));
        assert!(app.ask_queue.is_empty());
    }

    #[tokio::test]
    async fn ask_mouse_opens_custom_editor_and_submits_text() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });
        let mut terminal = Terminal::new(TestBackend::new(36, 24)).unwrap();
        terminal.draw(|frame| super::draw(frame, &mut app)).unwrap();
        let other_row = app.ask_queue.front().unwrap().row_hitboxes[2].0;

        assert!(
            handle_ask_mouse(
                &mut app,
                MouseEvent {
                    kind: MouseEventKind::Down(MouseButton::Left),
                    column: 2,
                    row: other_row,
                    modifiers: KeyModifiers::NONE,
                },
                &registry,
            )
            .await
        );
        assert!(app.ask_queue.front().unwrap().editing_custom);
        for ch in "custom answer".chars() {
            press_ask(&mut app, &registry, KeyCode::Char(ch)).await;
        }
        press_ask(&mut app, &registry, KeyCode::Enter).await;

        assert!(app.ask_queue.is_empty(), "custom answer did not submit");
        assert!(
            registry.lock().await.is_empty(),
            "ask sender was not resolved"
        );
        let answers = receiver.await.unwrap().unwrap();
        assert_eq!(answers[0].custom_input.as_deref(), Some("custom answer"));
        assert!(app.ask_queue.is_empty());
    }

    #[tokio::test]
    async fn ask_paste_event_prefers_login_over_active_custom_editor() {
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, _receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });

        press_ask(&mut app, &registry, KeyCode::Down).await;
        press_ask(&mut app, &registry, KeyCode::Down).await;
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert!(app.ask_queue.front().unwrap().editing_custom);
        app.login = Some(super::LoginPrompt::new());

        route_paste_event(&mut app, Event::Paste("tokamak-api-key".into()));

        assert_eq!(app.login.as_ref().unwrap().input, "tokamak-api-key");
        assert!(app.ask_queue.front().unwrap().custom_input.is_empty());
        assert!(app.input.is_empty(), "paste leaked into chat composer");
    }

    #[tokio::test]
    async fn ask_paste_event_resolves_custom_response() {
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });

        press_ask(&mut app, &registry, KeyCode::Down).await;
        press_ask(&mut app, &registry, KeyCode::Down).await;
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert!(app.ask_queue.front().unwrap().editing_custom);

        route_paste_event(&mut app, Event::Paste("pasted answer".into()));

        assert_eq!(
            app.ask_queue.front().unwrap().custom_input,
            "pasted answer"
        );
        assert!(app.input.is_empty(), "paste leaked into chat composer");

        press_ask(&mut app, &registry, KeyCode::Enter).await;
        let answers = receiver.await.unwrap().unwrap();
        assert_eq!(answers[0].custom_input.as_deref(), Some("pasted answer"));
        assert!(app.ask_queue.is_empty());
    }

    #[tokio::test]
    async fn ask_paste_event_does_not_leak_during_option_selection() {
        let mut app = test_app();
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, _receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });

        route_paste_event(&mut app, Event::Paste("must not become chat".into()));

        assert!(app.ask_queue.front().unwrap().custom_input.is_empty());
        assert!(app.input.is_empty(), "paste leaked into chat composer");
    }

    #[test]
    fn paste_event_routes_to_chat_composer_without_login_or_ask() {
        let mut app = test_app();

        route_paste_event(&mut app, Event::Paste("chat text".into()));

        assert_eq!(app.input, "chat text");
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
    fn strip_system_xml_tags_removes_system_blocks() {
        assert_eq!(
            strip_system_xml_tags(
                "answer<system-notice>internal nudge</system-notice>tail"
            ),
            "answertail"
        );
    }

    #[test]
    fn strip_system_xml_tags_removes_multiline_and_unterminated() {
        assert_eq!(
            strip_system_xml_tags(
                "a<system-directive>\nline one\nline two</system-directive>b"
            ),
            "ab"
        );
        assert_eq!(
            strip_system_xml_tags("a<system-notice>never closed"),
            "a"
        );
    }

    #[test]
    fn strip_system_xml_tags_keeps_plain_text() {
        assert_eq!(
            strip_system_xml_tags("no tags here <systemic> not a tag"),
            "no tags here <systemic> not a tag"
        );
    }

    #[test]
    fn live_tail_hides_open_think_block_and_shows_it_when_revealed() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.assistant_buf = "<think>pondering the answer".to_string();

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

        // Reasoning folding is the default: an open  block is hidden from
        // the live tail (the header shows [thinking] instead).
        let hidden = render(&mut app);
        assert!(
            !hidden.contains("pondering"),
            "open reasoning must be hidden by default"
        );

        // With show_reasoning on, the streaming reasoning renders dimmed as before.
        app.show_reasoning = true;
        let shown = render(&mut app);
        assert!(shown.contains("pondering"), "revealed live tail must contain it");
    }

    #[test]
    fn header_shows_thinking_and_thought_for_status_when_folded() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.submit_user("hi".to_string());

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

        // Open reasoning -> [thinking] (replacing [working]).
        app.apply(StreamEvent::Token {
            text: "<think>pondering the plan".into(),
        });
        let thinking = render(&mut app);
        assert!(thinking.contains("[thinking]"), "thinking: {thinking}");
        assert!(!thinking.contains("[working]"), "thinking: {thinking}");

        // Block closes -> [thought for Ns] for a short while after.
        app.apply(StreamEvent::Token {
            text: "</think>Answer.".into(),
        });
        let done = render(&mut app);
        assert!(done.contains("[thought for"), "thought-for: {done}");
    }

    #[test]
    fn thought_for_falls_back_to_working_after_ttl() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.submit_user("hi".to_string());

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

        // Open then close a reasoning block so the summary appears.
        app.apply(StreamEvent::Token {
            text: "<think>ponder the plan".into(),
        });
        app.apply(StreamEvent::Token {
            text: "</think> responseA.".into(),
        });
        let fresh = render(&mut app);
        assert!(fresh.contains("[thought for"), "fresh: {fresh}");

        // Age the summary beyond its TTL; it must fall back to [working] rather
        // than pinning [thought for Ns] for the rest of the turn.
        if let Some(since) = app.thought_for_since {
            app.thought_for_since =
                Some(since - super::THOUGHT_FOR_TTL - std::time::Duration::from_secs(1));
        }
        let stale = render(&mut app);
        assert!(stale.contains("[working]"), "stale should be [working]: {stale}");
        assert!(!stale.contains("[thought for"), "stale thought-for: {stale}");
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
    fn tool_activity_is_concise_present_tense() {
        assert_eq!(
            tool_activity("bash", &json!({ "command": "/usr/bin/grep -n foo src/" })),
            "Executing: /usr/bin/grep -n foo src/"
        );
        assert_eq!(
            tool_activity("bash", &json!({ "command": "cargo test" })),
            "Executing: cargo test"
        );
        // Kept whole: the row clamps to the draw width, so a long command fills
        // the terminal instead of being cut at a fixed 80.
        let long = format!("echo {}", "x".repeat(2 * COMMAND_LABEL_MAX));
        assert_eq!(
            tool_activity("bash", &json!({ "command": long })),
            format!("Executing: {long}")
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
        // Whole command on the finished row too, for the same reason as
        // `tool_activity`: the row clamps to the draw width.
        let long = format!("echo {}", "x".repeat(2 * COMMAND_LABEL_MAX));
        assert_eq!(
            tool_finished("bash", &json!({ "command": long })),
            format!("Ran: {long}")
        );
        assert_eq!(tool_finished("grep", &json!({ "pattern": "foo" })), "Searched");
        assert_eq!(
            tool_finished("read", &json!({ "path": "src/main.rs" })),
            "Read main.rs"
        );
        assert_eq!(tool_finished("list", &json!({})), "Listed files");
        assert_eq!(
            tool_finished("write", &json!({ "path": "src/main.rs" })),
            "Wrote main.rs"
        );
        assert_eq!(
            tool_finished("edit", &json!({ "path": "src/main.rs" })),
            "Edited main.rs"
        );
    }

    /// `web_search`/`web_fetch`/`ask`/`todo` used to fall through to the raw
    /// `"{name} {args}"` dump (no `tool_activity`/`tool_finished` match arm),
    /// so a session mixing them with grep/read looked visually inconsistent
    /// (friendly labels next to raw JSON blobs). Every builtin the model can
    /// call now gets a concise label like the rest.
    #[test]
    fn every_builtin_gets_a_friendly_label_not_a_raw_json_dump() {
        assert_eq!(
            tool_activity("web_search", &json!({ "query": "rust async runtime" })),
            "Searching the web: rust async runtime"
        );
        assert_eq!(
            tool_finished("web_search", &json!({ "query": "rust async runtime" })),
            "Searched the web: rust async runtime"
        );
        assert_eq!(
            tool_activity("web_fetch", &json!({ "url": "https://example.com" })),
            "Fetching: https://example.com"
        );
        assert_eq!(
            tool_finished("web_fetch", &json!({ "url": "https://example.com" })),
            "Fetched: https://example.com"
        );
        assert_eq!(tool_activity("ask", &json!({ "questions": [] })), "Asking a question");
        assert_eq!(tool_finished("ask", &json!({ "questions": [] })), "Asked a question");
    }

    #[test]
    fn todo_tool_label_names_the_op_and_target() {
        assert_eq!(
            tool_activity("todo", &json!({ "op": "start", "task": "write tests" })),
            "Starting task: write tests"
        );
        assert_eq!(
            tool_finished("todo", &json!({ "op": "done", "task": "write tests" })),
            "Completed task: write tests"
        );
        assert_eq!(
            tool_activity("todo", &json!({ "op": "drop", "all": true })),
            "Abandoning all tasks"
        );
        assert_eq!(
            tool_activity(
                "todo",
                &json!({ "op": "append", "phase": "Build", "items": ["a", "b"] })
            ),
            "Adding 2 tasks to Build"
        );
        assert_eq!(
            tool_activity(
                "todo",
                &json!({ "op": "init", "list": [{ "phase": "Research", "items": ["a"] }] })
            ),
            "Planning 1 phase"
        );
        assert_eq!(tool_activity("todo", &json!({ "op": "view" })), "Checking todos");
    }

    fn line_text(line: &ratatui::text::Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    /// Text of a streaming write preview's tail, dropping the highlight styles.
    fn tail_text(call: &super::StartingCall) -> Option<Vec<String>> {
        call.preview.tail.as_ref().map(|rows| {
            rows.iter()
                .map(|r| r.iter().map(|s| s.content.as_ref()).collect())
                .collect()
        })
    }

    /// Like `line_text`, but marks the reverse-video block cursor with `▏` at its
    /// left edge so caret-position assertions survive the styled-space rendering.
    /// The synthetic end-of-line filler space is represented by the marker alone.
    fn caret_text(line: &ratatui::text::Line) -> String {
        let mut out = String::new();
        for s in &line.spans {
            if s.style.add_modifier.contains(Modifier::REVERSED) {
                out.push('▏');
                if s.content.as_ref() != " " {
                    out.push_str(s.content.as_ref());
                }
            } else {
                out.push_str(s.content.as_ref());
            }
        }
        out
    }

    #[test]
    fn image_mime_infers_from_extension() {
        assert_eq!(image_mime("a.png"), "image/png");
        assert_eq!(image_mime("a.JPG"), "image/jpeg");
        assert_eq!(image_mime("a.jpeg"), "image/jpeg");
        assert_eq!(image_mime("noext"), "image/png");
    }

    #[test]
    fn clipboard_path_parses_file_uri_and_plain_path() {
        assert_eq!(
            clipboard_path("file:///home/u/my%20pic.png\n").as_deref(),
            Some("/home/u/my pic.png")
        );
        assert_eq!(
            clipboard_path("file://localhost/tmp/a.png").as_deref(),
            Some("/tmp/a.png")
        );
        assert_eq!(clipboard_path("/tmp/b.jpg").as_deref(), Some("/tmp/b.jpg"));
        assert_eq!(clipboard_path("   \n  "), None);
    }

    #[test]
    fn build_user_message_is_plain_string_without_images() {
        let m = build_user_message("hi", &[]);
        assert_eq!(m["content"], json!("hi"));
    }

    #[test]
    fn build_user_message_wraps_text_and_image_parts() {
        let imgs = vec![PendingImage {
            name: "p.png".into(),
            data_url: "data:image/png;base64,AAAA".into(),
        }];
        let m = build_user_message("look", &imgs);
        let parts = m["content"].as_array().unwrap();
        assert_eq!(parts[0], json!({ "type": "text", "text": "look" }));
        assert_eq!(parts[1]["type"], "image_url");
        assert_eq!(parts[1]["image_url"]["url"], "data:image/png;base64,AAAA");
    }

    #[test]
    fn build_user_message_omits_empty_text_part() {
        let imgs = vec![PendingImage {
            name: "p.png".into(),
            data_url: "data:image/png;base64,AAAA".into(),
        }];
        let parts = build_user_message("", &imgs)["content"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "image_url");
    }

    #[test]
    fn user_content_parts_splits_text_and_images() {
        let content = json!([
            { "type": "text", "text": "hello" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
        ]);
        let (text, images) = user_content_parts(&content);
        assert_eq!(text, "hello");
        assert_eq!(images.len(), 1);
        let (text, images) = user_content_parts(&json!("plain"));
        assert_eq!(text, "plain");
        assert!(images.is_empty());
    }

    #[test]
    fn load_image_file_encodes_base64_data_url() {
        let path = std::env::temp_dir().join(format!("jan_img_{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&path, [1u8, 2, 3, 4]).unwrap();
        let img = load_image_file(path.to_str().unwrap()).unwrap();
        assert!(img.data_url.starts_with("data:image/png;base64,"));
        assert!(img.name.ends_with(".png"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_first_file_image_skips_unloadable_entries() {
        let dir = std::env::temp_dir();
        let id = uuid::Uuid::new_v4();
        let existing = dir.join(format!("jan_list_{id}.png"));
        std::fs::write(&existing, [1u8, 2, 3, 4]).unwrap();
        let missing = dir.join(format!("jan_missing_{id}.png"));
        let not_image = dir.join(format!("jan_doc_{id}.pdf"));
        std::fs::write(&not_image, [1u8, 2, 3, 4]).unwrap();
        let empty = dir.join(format!("jan_empty_{id}.png"));
        std::fs::write(&empty, []).unwrap();

        // Skips missing, non-image and unloadable entries, keeping the basename.
        let list = [
            missing.clone(),
            not_image.clone(),
            empty.clone(),
            existing.clone(),
        ];
        let img = load_first_file_image(&list).unwrap();
        assert!(img.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(img.name, existing.file_name().unwrap().to_str().unwrap());

        // Nothing loadable in the list yields nothing.
        assert!(load_first_file_image(&[missing, not_image.clone(), empty.clone()]).is_none());

        for p in [existing, not_image, empty] {
            std::fs::remove_file(&p).ok();
        }
    }

    #[test]
    fn image_mime_of_rejects_non_image_extensions() {
        assert_eq!(image_mime_of("a.png"), Some("image/png"));
        assert_eq!(image_mime_of("a.JPG"), Some("image/jpeg"));
        assert!(image_mime_of("a.pdf").is_none());
        assert!(image_mime_of("noext").is_none());
    }

    #[test]
    fn load_image_file_rejects_oversized() {
        let path = std::env::temp_dir().join(format!("jan_big_{}.png", uuid::Uuid::new_v4()));
        let f = std::fs::File::create(&path).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        drop(f);
        let err = load_image_file(path.to_str().unwrap()).err().unwrap();
        assert!(err.contains("too large"), "{err}");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_image_file_rejects_empty() {
        let path = std::env::temp_dir().join(format!("jan_empty_{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&path, []).unwrap();
        assert!(load_image_file(path.to_str().unwrap()).is_err());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn submit_user_attaches_pending_images_and_renders_label() {
        let mut app = test_app();
        app.pending_images.push(PendingImage {
            name: "shot.png".into(),
            data_url: "data:image/png;base64,AAAA".into(),
        });
        app.submit_user("describe this".into());

        let content = app.history.last().unwrap()["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "image_url");
        assert!(app.pending_images.is_empty(), "pending images flushed");

        let rendered: Vec<String> = app.transcript.iter().map(row_text).collect();
        assert!(rendered.iter().any(|l| l.contains("[IMAGE] shot.png")));
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
    fn rewind_to_fills_input_with_target_user_message() {
        let mut app = test_app();
        app.repo_root = Some(std::path::PathBuf::from("/tmp/repo"));
        app.thread_id = Some("t1".into());
        app.history = vec![
            json!({ "role": "user", "content": "first" }),
            json!({ "role": "assistant", "content": "reply" }),
            json!({ "role": "user", "content": "second" }),
        ];
        // Rewind to message #1 (0-indexed target 0): history is cut right
        // before the first user message, and that message's text should be
        // left in the input area for re-submission.
        rewind_to(&mut app, 0, false);
        assert_eq!(app.history.len(), 0);
        assert_eq!(app.input, "first");
        assert_eq!(app.cursor, app.input.len());
        assert_eq!(app.status, Status::Idle);
    }

    #[test]
    fn rewind_trims_recall_to_the_surviving_messages() {
        let mut app = test_app();
        app.thread_id = Some("t1".into());
        app.history = vec![
            json!({ "role": "user", "content": "first" }),
            json!({ "role": "assistant", "content": "reply" }),
            json!({ "role": "user", "content": "second" }),
            json!({ "role": "assistant", "content": "reply two" }),
            json!({ "role": "user", "content": "third" }),
        ];
        for text in ["first", "second", "third"] {
            app.record_submitted(text);
        }

        // Cut just before the second user message: "second" and "third" are
        // gone from the conversation, so they must be gone from recall too.
        rewind_to(&mut app, 1, false);
        assert_eq!(app.input_history, vec!["first"]);
        // Rewind leaves the target message in the composer, and recall only
        // starts from an empty one.
        assert_eq!(app.input, "second");
        app.input_clear();
        assert!(app.recall_prev());
        assert_eq!(app.input, "first");

        // Rewinding to the very first message leaves nothing to recall, so Up
        // falls through to scrollback again.
        rewind_to(&mut app, 0, false);
        assert!(app.input_history.is_empty());
        app.input_clear();
        assert!(!app.recall_prev());
    }

    #[test]
    fn rewind_to_fills_input_with_target_user_message_with_text_parts() {
        let mut app = test_app();
        app.thread_id = Some("t1".into());
        app.history = vec![
            json!({
                "role": "user",
                "content": [
                    { "type": "image_url", "image_url": { "url": "data:...", "detail": "auto" } }
                ]
            }),
            json!({ "role": "assistant", "content": "ok" }),
            json!({ "role": "user", "content": "second" }),
        ];
        rewind_to(&mut app, 0, false);
        // An image-only user message has no text to put in the input area.
        assert_eq!(app.history.len(), 0);
        assert_eq!(app.input, "");
        assert_eq!(app.cursor, 0);
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

    /// The dock's branch indicator must not stick to whatever `HEAD` was at
    /// startup: `spawn_branch_poll`/`await_branch_poll` -- the pair
    /// `chat_loop` drives on `BRANCH_POLL_INTERVAL` -- re-read `HEAD` live, so
    /// a checkout made outside the TUI while it's running is picked up on the
    /// next poll instead of only at the next launch.
    #[tokio::test]
    async fn branch_poll_picks_up_a_checkout_made_after_the_first_poll() {
        use std::process::Command;
        let n = std::process::id();
        let root = std::env::temp_dir().join(format!("jan_tui_branch_poll_{n}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let r = root.to_string_lossy().to_string();
        let git_ok = Command::new("git")
            .args(["-C", &r, "init", "-q"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !git_ok {
            let _ = std::fs::remove_dir_all(&root);
            return;
        }
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        Command::new("git").args(["-C", &r, "add", "-A"]).status().unwrap();
        Command::new("git")
            .args([
                "-C", &r, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m",
                "init", "--no-gpg-sign",
            ])
            .status()
            .unwrap();

        let mut task = Some(spawn_branch_poll(&root));
        let first = await_branch_poll(&mut task).await;
        assert!(first.is_some(), "a fresh commit has a branch");
        assert!(task.is_none(), "the slot clears once the poll lands");

        Command::new("git")
            .args(["-C", &r, "checkout", "-q", "-b", "feature/x"])
            .status()
            .unwrap();

        let mut task = Some(spawn_branch_poll(&root));
        let second = await_branch_poll(&mut task).await;
        assert_eq!(second.as_deref(), Some("feature/x"));
        assert_ne!(first, second, "the poll must see the external checkout");

        let _ = std::fs::remove_dir_all(&root);
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
    fn awaiting_throbber_renders_below_assistant_prose() {
        use ratatui::{backend::TestBackend, Terminal};
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "Let me wait for the subagent.".into(),
        });
        app.apply(StreamEvent::ToolCall {
            id: "a1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "sub-reviewer-1" }),
        });
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
        let prose = rows.iter().position(|r| r.contains("wait for the subagent"));
        let awaiting = rows.iter().position(|r| r.contains("Awaiting subagent: reviewer"));
        let (prose, awaiting) = (prose.expect("prose row"), awaiting.expect("awaiting row"));
        assert!(
            awaiting > prose,
            "awaiting throbber must render below prose:\n{}",
            rows.join("\n")
        );
    }

    #[test]
    fn tool_call_started_throbber_shows_then_clears_on_full_call() {
        use ratatui::{backend::TestBackend, Terminal};
        let render = |app: &mut App| -> Vec<String> {
            let mut terminal = Terminal::new(TestBackend::new(60, 30)).unwrap();
            terminal.draw(|f| super::draw(f, app)).unwrap();
            let buf = terminal.backend().buffer().clone();
            (0..buf.area.height)
                .map(|y| {
                    (0..buf.area.width)
                        .map(|x| buf[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect()
        };

        let mut app = test_app();
        // Arguments still streaming: only the in-progress signal has arrived.
        app.apply(StreamEvent::ToolCallStarted {
            id: "c1".into(),
            name: "write".into(),
        });
        let rows = render(&mut app);
        assert!(
            rows.iter().any(|r| r.contains("│") && r.contains("Preparing write")),
            "throbber must show with the tool-row gutter while args stream:\n{}",
            rows.join("\n")
        );

        // Full call (parsed args) supersedes the throbber and renders its row.
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "write".into(),
            args: json!({ "path": "a.txt", "content": "hi" }),
        });
        let rows = render(&mut app);
        assert!(
            !rows.iter().any(|r| r.contains("Preparing write")),
            "throbber must clear once the full call arrives:\n{}",
            rows.join("\n")
        );
        assert!(app.starting.is_empty());
    }

    async fn press_esc(app: &mut App) {
        let registry: PermissionRegistry = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mcp_servers: crate::core::state::SharedMcpServers =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mut current: Option<CurrentRun> = None;
        let esc = KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE);
        handle_key(app, esc, &registry, &mut current, &mcp_servers).await;
    }

    #[tokio::test]
    async fn esc_stops_the_open_tool_group_throbber() {
        let mut app = test_app();
        app.status = Status::Running;
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "sleep 60" }),
        });
        assert!(app.tool_group.as_ref().is_some_and(|g| g.is_running()));
        press_esc(&mut app).await;
        assert_eq!(app.status, Status::Idle);
        let rows = render_rows(&mut app, 60, 30);
        let spinning: Vec<&String> =
            rows.iter().filter(|r| SPINNER.iter().any(|f| r.contains(f))).collect();
        assert!(spinning.is_empty(), "throbber survived cancel: {spinning:?}");
    }

    #[tokio::test]
    async fn esc_stops_the_awaiting_subagent_throbber() {
        let mut app = test_app();
        app.status = Status::Running;
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "reviewer-1" }),
        });
        assert!(!app.awaiting.is_empty());
        press_esc(&mut app).await;
        let rows = render_rows(&mut app, 60, 30);
        let spinning: Vec<&String> =
            rows.iter().filter(|r| SPINNER.iter().any(|f| r.contains(f))).collect();
        assert!(spinning.is_empty(), "throbber survived cancel: {spinning:?}");
    }

    #[tokio::test]
    async fn esc_cancels_a_run_whose_tool_args_are_still_streaming() {
        let mut app = test_app();
        app.status = Status::Running;
        // Args still streaming: the "Preparing write" throbber owns the tail.
        app.apply(StreamEvent::ToolCallStarted {
            id: "c1".into(),
            name: "write".into(),
        });
        assert!(!app.starting.is_empty(), "throbber must be live before Esc");

        let registry: PermissionRegistry = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mcp_servers: crate::core::state::SharedMcpServers =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mut current: Option<CurrentRun> = None;
        let esc = KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE);
        handle_key(&mut app, esc, &registry, &mut current, &mcp_servers).await;

        assert_eq!(app.status, Status::Idle, "Esc must end the run");
        assert!(app.starting.is_empty(), "Esc must clear the streaming throbber");
        let rows = render_rows(&mut app, 60, 30);
        assert!(
            !rows.iter().any(|r| r.contains("Preparing write")),
            "no throbber may survive the cancel:\n{}",
            rows.join("\n")
        );
    }

    async fn press(app: &mut App, code: KeyCode, mods: KeyModifiers) {
        let registry: PermissionRegistry = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mcp_servers: crate::core::state::SharedMcpServers =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mut current: Option<CurrentRun> = None;
        handle_key(app, KeyEvent::new(code, mods), &registry, &mut current, &mcp_servers).await;
    }

    async fn type_key_chars(app: &mut App, text: &str) {
        for ch in text.chars() {
            press(app, KeyCode::Char(ch), KeyModifiers::NONE).await;
        }
    }

    /// Submit `text` from the composer and drop back to idle, as a finished
    /// turn would, so the next message starts from a fresh input box.
    async fn submit_line(app: &mut App, text: &str) {
        type_key_chars(app, text).await;
        press(app, KeyCode::Enter, KeyModifiers::NONE).await;
        app.status = Status::Idle;
    }

    #[tokio::test]
    async fn up_recalls_submitted_messages_and_down_returns_to_an_empty_one() {
        let mut app = test_app();
        submit_line(&mut app, "first").await;
        submit_line(&mut app, "second").await;

        // With something typed, Up still scrolls the transcript.
        type_key_chars(&mut app, "draft").await;
        press(&mut app, KeyCode::Up, KeyModifiers::NONE).await;
        assert_eq!(app.input, "draft");
        assert_eq!(app.scrollback, 1);

        press(&mut app, KeyCode::Esc, KeyModifiers::NONE).await;
        press(&mut app, KeyCode::Up, KeyModifiers::NONE).await;
        assert_eq!(app.input, "second");
        assert_eq!(app.cursor, "second".len(), "caret sits at the end");
        press(&mut app, KeyCode::Up, KeyModifiers::NONE).await;
        assert_eq!(app.input, "first");
        // The oldest entry is the floor, not a wrap-around.
        press(&mut app, KeyCode::Up, KeyModifiers::NONE).await;
        assert_eq!(app.input, "first");

        press(&mut app, KeyCode::Down, KeyModifiers::NONE).await;
        assert_eq!(app.input, "second");
        press(&mut app, KeyCode::Down, KeyModifiers::NONE).await;
        assert_eq!(app.input, "", "past the newest is a fresh message");
        assert_eq!(app.scrollback, 1, "recall never scrolls the transcript");

        // No longer recalling, so Down scrolls again.
        press(&mut app, KeyCode::Down, KeyModifiers::NONE).await;
        assert_eq!(app.scrollback, 0);
    }

    #[tokio::test]
    async fn page_keys_still_scroll_when_there_is_history_to_recall() {
        let mut app = test_app();
        submit_line(&mut app, "first").await;
        press(&mut app, KeyCode::PageUp, KeyModifiers::NONE).await;
        assert_eq!(app.scrollback, 10);
        assert!(app.input.is_empty(), "PageUp must not recall");
        press(&mut app, KeyCode::PageDown, KeyModifiers::NONE).await;
        assert_eq!(app.scrollback, 0);
    }

    #[tokio::test]
    async fn a_recalled_message_is_editable_and_sends_as_a_new_one() {
        let mut app = test_app();
        submit_line(&mut app, "hello").await;
        press(&mut app, KeyCode::Up, KeyModifiers::NONE).await;
        type_key_chars(&mut app, "!").await;
        assert_eq!(app.input, "hello!");

        press(&mut app, KeyCode::Enter, KeyModifiers::NONE).await;
        assert!(app.input.is_empty());
        assert!(app.recall_pos.is_none(), "sending leaves recall");
        assert_eq!(app.input_history, vec!["hello", "hello!"]);
        assert!(
            transcript_text(&app).contains("hello!"),
            "an edited recall is an ordinary user message"
        );
    }

    /// A resend of the newest entry must not stack duplicates, or Up has to be
    /// pressed once per repeat to get past them.
    #[tokio::test]
    async fn resending_the_same_message_keeps_one_history_entry() {
        let mut app = test_app();
        submit_line(&mut app, "again").await;
        submit_line(&mut app, "again").await;
        assert_eq!(app.input_history, vec!["again"]);
    }

    #[test]
    fn slash_commands_include_login() {
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "/login"));
    }

    #[tokio::test]
    async fn login_prompt_captures_keys_and_never_renders_the_key() {
        let mut app = test_app();
        run_command(&mut app, "login").await;
        assert!(app.login.is_some(), "/login must open the prompt");

        type_key_chars(&mut app, "tk-secret").await;
        // Keystrokes are the key, not chat input.
        assert!(app.input.is_empty(), "the input box must not see the key");
        let prompt = app.login.as_ref().unwrap();
        assert_eq!(prompt.input, "tk-secret");
        assert_eq!(prompt.masked(), "*********");

        let rows = render_rows(&mut app, 80, 24);
        let screen = rows.join("\n");
        assert!(screen.contains("tokamak sign-in"), "{screen}");
        assert!(
            !screen.contains("tk-secret"),
            "the key must never be rendered:\n{screen}"
        );
    }

    #[tokio::test]
    async fn login_enter_hands_a_trimmed_key_to_the_loop() {
        let mut app = test_app();
        run_command(&mut app, "login").await;
        app.login.as_mut().unwrap().paste("  tk-abc\n");
        press(&mut app, KeyCode::Enter, KeyModifiers::NONE).await;

        assert_eq!(app.login_submit.as_deref(), Some("tk-abc"));
        assert!(app.login.as_ref().unwrap().verifying);
    }

    #[tokio::test]
    async fn login_rejects_a_mispasted_key_before_any_request() {
        let mut app = test_app();
        run_command(&mut app, "login").await;
        type_key_chars(&mut app, "tk-abc def").await;
        press(&mut app, KeyCode::Enter, KeyModifiers::NONE).await;

        assert!(app.login_submit.is_none(), "no request for a bad paste");
        let prompt = app.login.as_ref().unwrap();
        assert!(!prompt.verifying);
        assert!(prompt.input.is_empty(), "a rejected key is cleared");
        assert!(prompt.error.is_some());

        // Empty input is likewise not worth a round trip.
        press(&mut app, KeyCode::Enter, KeyModifiers::NONE).await;
        assert!(app.login_submit.is_none());
    }

    #[tokio::test]
    async fn login_backspace_edits_and_esc_cancels() {
        let mut app = test_app();
        run_command(&mut app, "login").await;
        type_key_chars(&mut app, "tk-ab").await;
        press(&mut app, KeyCode::Backspace, KeyModifiers::NONE).await;
        assert_eq!(app.login.as_ref().unwrap().input, "tk-a");

        press(&mut app, KeyCode::Esc, KeyModifiers::NONE).await;
        assert!(app.login.is_none(), "Esc must close the prompt");
        assert!(app.login_submit.is_none());
    }

    #[tokio::test]
    async fn login_stays_cancellable_while_verifying() {
        let mut app = test_app();
        run_command(&mut app, "login").await;
        app.login.as_mut().unwrap().paste("tk-abc");
        press(&mut app, KeyCode::Enter, KeyModifiers::NONE).await;
        app.login_submit.take();

        // Read-only while in flight: no edit may change the key being checked.
        type_key_chars(&mut app, "xyz").await;
        press(&mut app, KeyCode::Backspace, KeyModifiers::NONE).await;
        assert_eq!(app.login.as_ref().unwrap().input, "tk-abc");
        let rows = render_rows(&mut app, 80, 24);
        assert!(rows.iter().any(|r| r.contains("verifying")), "{rows:?}");

        press(&mut app, KeyCode::Char('c'), KeyModifiers::CONTROL).await;
        assert!(app.login.is_none(), "Ctrl-C must not wedge the prompt");
    }

    #[tokio::test]
    async fn failed_verification_keeps_the_prompt_open_with_the_reason() {
        let mut app = test_app();
        run_command(&mut app, "login").await;
        app.login.as_mut().unwrap().paste("tk-abc");
        press(&mut app, KeyCode::Enter, KeyModifiers::NONE).await;
        app.login_submit.take();

        finish_login(&mut app, Err("Tokamak rejected that API key.".to_string()));
        let prompt = app.login.as_ref().expect("prompt stays open to retry");
        assert!(!prompt.verifying);
        assert!(prompt.input.is_empty());
        assert_eq!(prompt.error.as_deref(), Some("Tokamak rejected that API key."));
    }

    #[test]
    fn submit_user_with_no_model_notes_instead_of_starting_a_turn() {
        let mut app = test_app();
        app.model = String::new();
        app.submit_user("hi".into());
        assert!(!app.want_start, "a fresh install must not start a turn with no model");
        assert!(app.history.is_empty());
        let text: String = row_lines(&app.transcript).iter().flat_map(|l| l.spans.clone()).map(|s| s.content.to_string()).collect();
        assert!(text.contains("/login"), "{text}");
    }

    #[test]
    fn init_starts_a_turn_covering_all_three_artifacts() {
        let mut app = test_app();
        super::init_command(&mut app);
        assert!(app.want_start, "/init must start a turn");
        let sent = app.history.last().expect("user message").to_string();
        assert!(sent.contains("JAN.md"), "{sent}");
        assert!(sent.contains("skill_write"), "{sent}");
        assert!(sent.contains("memory_write"), "{sent}");
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    /// The canned prompt is plumbing: the note announces `/init`, and neither
    /// the transcript nor the replayable journal carries the prompt body.
    #[test]
    fn init_keeps_the_prompt_out_of_the_transcript() {
        let mut app = test_app();
        app.pending_images.push(super::PendingImage {
            name: "shot.png".into(),
            data_url: "data:image/png;base64,AA".into(),
        });
        super::init_command(&mut app);
        let text: String = row_lines(&app.transcript)
            .iter()
            .flat_map(|l| l.spans.clone())
            .map(|s| s.content.to_string())
            .collect();
        assert!(!text.contains("Onboard yourself"), "{text}");
        assert!(text.contains("init ·"), "{text}");
        assert!(
            !app.display_log
                .iter()
                .any(|e| matches!(e, DisplayEntry::User { .. })),
            "a hidden turn must not journal a user row"
        );
        assert_eq!(app.pending_images.len(), 1, "staged images stay staged");
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    /// Surveying a project while a turn is mid-change would onboard against a
    /// moving target, so the command declines rather than queueing.
    #[test]
    fn init_declines_while_a_turn_is_running() {
        let mut app = test_app();
        app.status = Status::Running;
        super::init_command(&mut app);
        assert!(app.history.is_empty());
        assert!(app.message_queue.is_empty());
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn successful_login_closes_the_prompt_and_adopts_a_runnable_model() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let mut app = test_app();
            app.login = Some(super::LoginPrompt::new());
            finish_login(
                &mut app,
                Ok(crate::core::cli::tokamak::Login {
                    models: vec!["tokamak-1-preview".into(), "tokamak-1-mini".into()],
                    config_path: std::path::PathBuf::from("/tmp/config.toml"),
                    default_model: Some("tokamak-1-preview".into()),
                }),
            );
            assert!(app.login.is_none());
            // The session's old model ("m") is offered by nobody, so sign-in must
            // move it onto one the new account can serve.
            assert_eq!(app.model, "tokamak-1-preview");
        });
    }

    #[test]
    fn login_keeps_a_still_runnable_model_on_a_key_refresh() {
        crate::core::agent::global_config::with_temp_home(|_| {
            crate::core::agent::global_config::set_provider(
                "tokamak",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("tk".into()),
                    base_url: Some(crate::core::cli::tokamak::BASE_URL.into()),
                    models: Some(vec!["m".into()]),
                    api_type: None,
                },
            )
            .expect("seed provider");

            let mut app = test_app();
            app.login = Some(super::LoginPrompt::new());
            finish_login(
                &mut app,
                Ok(crate::core::cli::tokamak::Login {
                    models: vec!["tokamak-1-preview".into()],
                    config_path: std::path::PathBuf::from("/tmp/config.toml"),
                    default_model: None,
                }),
            );
            assert_eq!(app.model, "m", "a working model must survive a re-login");
        });
    }

    #[test]
    fn masked_key_is_bounded() {
        let mut prompt = super::LoginPrompt::new();
        prompt.paste(&"k".repeat(200));
        assert_eq!(prompt.masked().chars().count(), 32);
        prompt.verifying = true;
        prompt.paste("ignored");
        assert_eq!(prompt.input.chars().count(), 200);
    }

    #[test]
    fn reasoning_folds_before_await_subagent() {
        // A reasoning model that thinks and then awaits a subagent must fold
        // its <think> block to a summary row, not leave it fully expanded in
        // the live tail behind the throbber.
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "<think>collecting the subagent answers</think>".into(),
        });
        assert!(app.reasoning_blocks.is_empty());
        app.apply(StreamEvent::ToolCall {
            id: "a1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "sub-reviewer-1" }),
        });
        assert_eq!(app.reasoning_blocks.len(), 1);
        assert!(app.assistant_buf.is_empty());
        assert_eq!(app.awaiting.len(), 1);
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
        assert_eq!(
            app.awaiting[0],
            ("a1".to_string(), "sub-reviewer-1".to_string(), "reviewer".to_string())
        );
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

    /// Regression test: `SubagentEnd` can arrive before the parent's own
    /// `await_subagent` `ToolResult` (the two race). Previously only the
    /// `ToolResult` cleared `awaiting`, so a finished subagent kept showing
    /// an "Awaiting subagent: X" throbber alongside its own "finished" row.
    #[test]
    fn subagent_end_clears_its_awaiting_throbber_even_without_a_tool_result() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "a1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "sub-reviewer-1" }),
        });
        app.apply(StreamEvent::ToolCall {
            id: "a2".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "sub-explorer-1" }),
        });
        assert_eq!(app.awaiting.len(), 2);

        app.apply(StreamEvent::SubagentEnd {
            run_id: "sub-reviewer-1".into(),
            name: "reviewer".into(),
        });
        assert_eq!(
            app.awaiting.len(),
            1,
            "the finished subagent's throbber must clear even without its ToolResult"
        );
        assert_eq!(app.awaiting[0].2, "explorer");
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
            task: None,
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
        // The live panel renders only the newest call.
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
        // The docked panel has room for the newest call only; the whole list
        // stays reachable through the finished summary row (Ctrl-O).
        let out = render(&mut app);
        assert!(out.contains("cmd6"), "newest call shown: {out}");
        assert!(!out.contains("cmd5") && !out.contains("cmd0"), "older calls elided: {out}");
    }

    #[test]
    fn concurrent_subagents_track_independent_panels() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "alpha".into(),
            task: None,
        });
        app.apply(StreamEvent::SubagentStart {
            run_id: "r2".into(),
            name: "beta".into(),
            task: None,
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
    fn queued_panel_promotes_to_running_without_duplicate() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentQueued {
            run_id: "r1".into(),
            name: "reviewer".into(),
            task: Some("queue up".into()),
            waiting: 2,
        });
        let queued = app.subagents.iter().find(|p| p.run_id == "r1").expect("queued panel");
        assert!(queued.queued, "dispatch beyond the cap opens a queued panel");
        assert_eq!(queued.waiting, 2);

        // The child's later SubagentStart must flip the same panel to running,
        // not push a duplicate.
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
            task: None,
        });
        assert_eq!(app.subagents.len(), 1, "no duplicate panel on promotion");
        let promoted = app.subagents.iter().find(|p| p.run_id == "r1").unwrap();
        assert!(!promoted.queued, "promoted panel is now running");
    }

    #[test]
    fn queued_panel_renders_queue_position() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentQueued {
            run_id: "r1".into(),
            name: "reviewer".into(),
            task: Some("task".into()),
            waiting: 3,
        });
        let rows = render_rows(&mut app, 80, 20);
        assert!(
            rows.iter().any(|r| r.contains("queued (3)")),
            "queued panel shows its position: {rows:?}"
        );
    }

    #[test]
    fn settings_command_bare_opens_picker_and_inline_set_writes_toml() {
        let mut app = test_app();
        // A minimal agent.toml so the picker shows a real current value.
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\ncontext_window = 64000\n").unwrap();

        super::settings_command(&mut app, "max_parallel_subagents 20");
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(
            doc.contains("max_parallel_subagents = 20"),
            "key written: {doc}"
        );
        assert!(
            doc.contains("context_window = 64000"),
            "other keys preserved: {doc}"
        );

        // Zero is invalid: rejected, file unchanged.
        super::settings_command(&mut app, "max_parallel_subagents 0");
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(
            doc.contains("max_parallel_subagents = 20"),
            "rejected write must not clobber: {doc}"
        );
        assert!(transcript_text(&app).contains("must be at least 1"));

        // Bare opens the settings picker with a row per def, hints carrying
        // the on-disk current value (no key prefix; the label is the key).
        super::settings_command(&mut app, "");
        let picker = app.picker.as_ref().expect("bare /settings opens picker");
        assert_eq!(picker.kind, PickerKind::AgentSettings);
        assert_eq!(picker.items.len(), AGENT_SETTINGS.len());
        let row = picker
            .items
            .iter()
            .find(|i| i.value == "context_window")
            .expect("context_window row present");
        assert_eq!(row.hint.as_deref(), Some("= 64000"));
        let row = picker
            .items
            .iter()
            .find(|i| i.value == "max_parallel_subagents")
            .expect("max_parallel_subagents row present");
        assert_eq!(row.hint.as_deref(), Some("= 20"));
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[tokio::test]
    async fn settings_picker_x_unsets_selected_key() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\ncontext_window = 64000\n").unwrap();

        super::settings_command(&mut app, "");
        // Select the context_window row (index 0) and press x: the key must be
        // removed, the row hint flip back to (unset), the note rendered.
        press(&mut app, KeyCode::Char('x'), KeyModifiers::NONE).await;
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(!doc.contains("context_window = 64000"), "key removed: {doc}");
        assert!(transcript_text(&app).contains("context_window unset"));
        let picker = app.picker.as_ref().expect("picker stays open");
        let row = picker
            .items
            .iter()
            .find(|i| i.value == "context_window")
            .expect("context_window row present");
        assert_eq!(row.hint.as_deref(), Some("(unset)"));
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn settings_command_rejects_non_integer_and_unknown_keys() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\n").unwrap();

        super::settings_command(&mut app, "max_parallel_subagents lots");
        assert!(transcript_text(&app).contains("is not an integer"));
        super::settings_command(&mut app, "warp_drive 5");
        assert!(transcript_text(&app).contains("unknown setting"));
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn settings_prompt_enter_writes_and_closes() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\n").unwrap();

        let def = AGENT_SETTINGS
            .iter()
            .find(|d| d.key == "max_parallel_subagents")
            .unwrap();
        app.settings_prompt = Some(super::SettingsPrompt::new(def, None));
        super::handle_settings_key(&mut app, key(KeyCode::Char('3')), false);
        super::handle_settings_key(&mut app, key(KeyCode::Enter), false);
        assert!(app.settings_prompt.is_none(), "Enter closes the dock");
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(doc.contains("max_parallel_subagents = 3"), "{doc}");
        assert!(transcript_text(&app).contains("max_parallel_subagents = 3 written"));
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn settings_prompt_esc_cancels_without_writing() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\nmax_parallel_subagents = 7\n").unwrap();

        let def = AGENT_SETTINGS
            .iter()
            .find(|d| d.key == "max_parallel_subagents")
            .unwrap();
        app.settings_prompt = Some(super::SettingsPrompt::new(def, Some("7")));
        super::handle_settings_key(&mut app, key(KeyCode::Char('9')), false);
        super::handle_settings_key(&mut app, key(KeyCode::Esc), false);
        assert!(app.settings_prompt.is_none());
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(doc.contains("max_parallel_subagents = 7"), "unchanged: {doc}");
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn settings_prompt_cleared_field_unsets_key() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\ncontext_window = 8\n").unwrap();

        let def = AGENT_SETTINGS
            .iter()
            .find(|d| d.key == "context_window")
            .unwrap();
        app.settings_prompt = Some(super::SettingsPrompt::new(def, Some("8")));
        super::handle_settings_key(&mut app, key(KeyCode::Backspace), false);
        super::handle_settings_key(&mut app, key(KeyCode::Enter), false);
        assert!(app.settings_prompt.is_none());
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(!doc.contains("context_window = 8"), "key removed: {doc}");
        assert!(transcript_text(&app).contains("context_window unset"));
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn settings_prompt_rejects_below_min_and_garbage() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\n").unwrap();

        let def = AGENT_SETTINGS
            .iter()
            .find(|d| d.key == "max_parallel_subagents")
            .unwrap();
        app.settings_prompt = Some(super::SettingsPrompt::new(def, None));
        super::handle_settings_key(&mut app, key(KeyCode::Char('0')), false);
        super::handle_settings_key(&mut app, key(KeyCode::Enter), false);
        assert!(app.settings_prompt.is_some(), "dock stays open on error");
        let err = app
            .settings_prompt
            .as_ref()
            .and_then(|p| p.error.clone())
            .expect("error recorded");
        assert!(err.contains("at least 1"), "{err}");
        assert_eq!(std::fs::read_to_string(&toml_path).unwrap(), "[agent]\n");

        app.settings_prompt = Some(super::SettingsPrompt::new(def, None));
        super::handle_settings_key(&mut app, key(KeyCode::Char('x')), false);
        super::handle_settings_key(&mut app, key(KeyCode::Enter), false);
        let err = app
            .settings_prompt
            .as_ref()
            .and_then(|p| p.error.clone())
            .expect("error recorded");
        assert!(err.contains("not an integer"), "{err}");
        assert_eq!(std::fs::read_to_string(&toml_path).unwrap(), "[agent]\n");
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn mcp_prompt_visible_fields_follow_transport() {
        let mut p = McpPrompt {
            editing: None,
            field: McpField::Name,
            name: String::new(),
            transport: "stdio".to_string(),
            command: String::new(),
            args: String::new(),
            env: String::new(),
            url: String::new(),
            headers: String::new(),
            active: false,
            error: None,
        };
        assert!(p.visible_fields().contains(&McpField::Command));
        assert!(!p.visible_fields().contains(&McpField::Url));

        p.transport = "http".to_string();
        assert!(!p.visible_fields().contains(&McpField::Command));
        assert!(p.visible_fields().contains(&McpField::Url));
        assert!(p.visible_fields().contains(&McpField::Headers));
    }

    #[test]
    fn mcp_prompt_next_prev_wrap_and_skip_hidden() {
        let mut p = McpPrompt {
            editing: None,
            field: McpField::Name,
            name: String::new(),
            transport: "stdio".to_string(),
            command: String::new(),
            args: String::new(),
            env: String::new(),
            url: String::new(),
            headers: String::new(),
            active: false,
            error: None,
        };
        // From Name forward skips url/headers (stdio).
        p.next_field();
        assert_eq!(p.field, McpField::Transport);
        p.next_field();
        assert_eq!(p.field, McpField::Command);
        // Prev wraps from the last field back to the first.
        p.field = McpField::Active;
        p.next_field();
        assert_eq!(p.field, McpField::Name);
        p.prev_field();
        assert_eq!(p.field, McpField::Active);
    }

    #[test]
    fn pairs_to_str_roundtrips() {
        let map = crate::core::cli::mcp::parse_pairs("A=1,B=2", "env").unwrap();
        assert_eq!(pairs_to_str(Some(&map)), "A=1,B=2");
        assert_eq!(pairs_to_str(None), "");
    }

    #[test]
    fn settings_prompt_edits_enum_key() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\n[tools]\ndefault = \"read-only\"\n").unwrap();

        let def = AGENT_SETTINGS
            .iter()
            .find(|d| d.key == "tools.default")
            .unwrap();
        app.settings_prompt = Some(super::SettingsPrompt::new(def, None));
        for ch in "deny".chars() {
            super::handle_settings_key(&mut app, key(KeyCode::Char(ch)), false);
        }
        super::handle_settings_key(&mut app, key(KeyCode::Enter), false);
        assert!(app.settings_prompt.is_none());
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(doc.contains("default = \"deny\""), "written under [tools]: {doc}");
        assert!(transcript_text(&app).contains("tools.default = deny written"));
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn settings_prompt_rejects_enum_garbage() {
        let mut app = test_app();
        std::fs::create_dir_all(&app.agent_dir).unwrap();
        let toml_path = app.agent_dir.join("agent.toml");
        std::fs::write(&toml_path, "[agent]\n[tools]\ndefault = \"read-only\"\n").unwrap();

        let def = AGENT_SETTINGS
            .iter()
            .find(|d| d.key == "tools.default")
            .unwrap();
        app.settings_prompt = Some(super::SettingsPrompt::new(def, None));
        for ch in "aggressive".chars() {
            super::handle_settings_key(&mut app, key(KeyCode::Char(ch)), false);
        }
        super::handle_settings_key(&mut app, key(KeyCode::Enter), false);
        assert!(app.settings_prompt.is_some(), "dock stays open on error");
        let err = app
            .settings_prompt
            .as_ref()
            .and_then(|p| p.error.clone())
            .expect("error recorded");
        assert!(err.contains("read-only | deny | allow"), "{err}");
        let doc = std::fs::read_to_string(&toml_path).unwrap();
        assert!(doc.contains("default = \"read-only\""), "unchanged: {doc}");
        let _ = std::fs::remove_dir_all(&app.agent_dir);
    }

    #[test]
    fn finished_subagent_summary_expands_full_call_list_via_ctrl_o() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
            task: None,
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
            task: None,
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
            .any(|r| row_text(r).contains("subagent reviewer finished (1 tool call)")));
    }

    #[test]
    fn parent_tokens_still_render_while_subagent_active() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
            task: None,
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
            task: None,
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
            app.pending().and_then(|p| p.subagent.as_deref()),
            Some("reviewer")
        );
    }

    /// Regression test: two subagents requesting permission concurrently must
    /// both be retained (queued), not have the second overwrite/drop the
    /// first. Previously `pending` was a single `Option<Pending>` that the
    /// second `PermissionRequest` clobbered, leaving the first subagent's
    /// oneshot sender unreachable and its call hung forever.
    #[test]
    fn concurrent_subagent_permission_requests_both_queue() {
        let mut app = test_app();
        app.apply(StreamEvent::SubagentStart {
            run_id: "r1".into(),
            name: "reviewer".into(),
            task: None,
        });
        app.apply(StreamEvent::SubagentStart {
            run_id: "r2".into(),
            name: "explorer".into(),
            task: None,
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
        // Second subagent's request arrives while the first is still pending.
        app.apply(wrap(
            "r2",
            "explorer",
            StreamEvent::PermissionRequest {
                request_id: "p2".into(),
                tool_name: "read".into(),
                capability: "read".into(),
                path: Some("secrets.env".into()),
                command: None,
                diff: None,
                prompt_kind: "read".into(),
                offers_always: false,
            },
        ));

        assert_eq!(app.pending_queue.len(), 2, "both requests must be retained");
        // The first request stays visible/answerable; the second is not lost.
        assert_eq!(
            app.pending().map(|p| p.request_id.as_str()),
            Some("p1"),
            "front of the queue should still be the first subagent's request"
        );
        assert_eq!(
            app.pending().and_then(|p| p.subagent.as_deref()),
            Some("reviewer")
        );

        // Resolving the front (simulating the user answering it) pops it and
        // surfaces the second subagent's request, attributed correctly.
        app.pending_queue.pop_front();
        assert_eq!(app.pending_queue.len(), 1);
        assert_eq!(
            app.pending().map(|p| p.request_id.as_str()),
            Some("p2"),
            "second subagent's request must surface once the first resolves"
        );
        assert_eq!(
            app.pending().and_then(|p| p.subagent.as_deref()),
            Some("explorer")
        );
    }

    #[test]
    fn input_lines_single_line_has_arrow_and_cursor() {
        let lines = input_content_lines("hello", 5);
        assert_eq!(lines.len(), 1);
        assert_eq!(caret_text(&lines[0]), "› hello▏");
    }

    #[test]
    fn input_lines_multiline_hangs_and_cursor_on_last() {
        let lines = input_content_lines("one\ntwo\nthree", "one\ntwo\nthree".len());
        assert_eq!(lines.len(), 3);
        assert_eq!(line_text(&lines[0]), "› one");
        assert_eq!(line_text(&lines[1]), "  two");
        assert_eq!(caret_text(&lines[2]), "  three▏");
    }

    #[test]
    fn input_lines_trailing_newline_gives_empty_cursor_row() {
        let lines = input_content_lines("hi\n", 3);
        assert_eq!(lines.len(), 2);
        assert_eq!(line_text(&lines[0]), "› hi");
        assert_eq!(caret_text(&lines[1]), "  ▏");
    }

    #[test]
    fn input_lines_caret_renders_mid_string() {
        // Caret sits between "he" and "llo" on a single line.
        let lines = input_content_lines("hello", 2);
        assert_eq!(lines.len(), 1);
        assert_eq!(caret_text(&lines[0]), "› he▏llo");
    }

    #[test]
    fn input_lines_caret_on_earlier_line_only() {
        // Cursor inside the first segment: caret there, none on later lines.
        let lines = input_content_lines("one\ntwo", 1);
        assert_eq!(caret_text(&lines[0]), "› o▏ne");
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

    /// Non-frame, non-marker colours in a diff panel: what syntax highlighting
    /// contributes, as distinct from the red/green add-remove markers.
    fn diff_syntax_colours(lines: &[ratatui::text::Line]) -> Vec<ratatui::style::Color> {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .filter_map(|s| s.style.fg)
            .filter(|c| matches!(c, ratatui::style::Color::Rgb(..)))
            .collect()
    }

    /// The row containing `needle`, panicking if there is none.
    fn diff_row(rows: &[Line<'static>], needle: &str) -> Line<'static> {
        rows.iter()
            .find(|l| line_text(l).contains(needle))
            .unwrap_or_else(|| panic!("no row containing {needle:?}"))
            .clone()
    }

    /// Backgrounds of a row's spans, skipping the box frame and the gutter so
    /// only the banded interior is left.
    fn row_backgrounds(rows: &[Line<'static>], needle: &str) -> Vec<Option<ratatui::style::Color>> {
        diff_row(rows, needle)
            .spans
            .iter()
            .filter(|s| !s.content.is_empty() && !s.content.contains('│'))
            .map(|s| s.style.bg)
            .collect()
    }

    /// A changed row is banded by its background, from the left border to the
    /// right one -- including the padding past the end of the text, or the band
    /// would stop mid-row on every short line.
    #[test]
    fn changed_diff_rows_are_banded_by_background() {
        let diff = "     1 | keep\n-    2 | before\n+    2 | a much longer added line";
        let out = diff_lines(diff, 80, DIFF_MAX_ROWS, "│     ", None);
        assert!(
            row_backgrounds(&out, "before")
                .iter()
                .all(|bg| *bg == Some(DIFF_DEL_BG)),
            "removed row not fully banded: {:?}",
            row_backgrounds(&out, "before")
        );
        assert!(
            row_backgrounds(&out, "added line")
                .iter()
                .all(|bg| *bg == Some(DIFF_ADD_BG)),
            "added row not fully banded"
        );
        // Unchanged context is left alone, so the bands stand out against it.
        assert!(
            row_backgrounds(&out, "keep").iter().all(|bg| bg.is_none()),
            "context row was banded"
        );
    }

    /// The band is a background only: the code inside a changed row keeps the
    /// same syntax highlighting it has as context, which is what makes it
    /// readable on top of the tint.
    #[test]
    fn changed_diff_rows_keep_their_syntax_highlighting() {
        use ratatui::style::Color;
        let diff = "     1 | fn main() {\n-    2 |     let x = 1;\n+    2 |     let y = 2;";
        let out = diff_lines(diff, 80, DIFF_MAX_ROWS, "", Some("src/main.rs"));
        for needle in ["let x = 1;", "let y = 2;"] {
            let row = diff_row(&out, needle);
            assert!(
                row.spans
                    .iter()
                    .any(|s| matches!(s.style.fg, Some(Color::Rgb(..)))),
                "changed row {needle:?} lost its highlighting: {row:?}"
            );
        }
        // The marker itself stays red/green, so the sign reads without colour
        // vision doing all the work.
        let marker = diff_row(&out, "let y = 2;").spans[3].clone();
        assert_eq!(marker.content.as_ref(), "+");
        assert_eq!(marker.style.fg, Some(Color::Green));
    }

    #[test]
    fn a_diff_without_a_known_language_stays_plain() {
        let out = diff_lines("+ foo\n- bar", 80, DIFF_MAX_ROWS, "", None);
        assert!(
            diff_syntax_colours(&out).is_empty(),
            "unexpected highlighting without a language"
        );
    }

    #[test]
    fn a_hunk_header_is_not_syntax_highlighted() {
        let out = diff_lines(
            "@@ -1,2 +1,3 @@\n   1 | let x = 1;",
            80,
            DIFF_MAX_ROWS,
            "",
            Some("a.rs"),
        );
        let header = out
            .iter()
            .find(|l| line_text(l).contains("@@"))
            .expect("no hunk header row");
        assert!(
            header.spans.iter().all(|s| !matches!(s.style.fg, Some(ratatui::style::Color::Rgb(..)))),
            "hunk header was highlighted: {:?}",
            line_text(header)
        );
    }

    #[test]
    fn a_cancelled_write_does_not_leak_its_recorded_path() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "write".into(),
            args: json!({"path": "src/main.rs"}),
        });
        assert_eq!(app.diff_paths.len(), 1);
        app.begin_turn();
        assert!(app.diff_paths.is_empty(), "path outlived its turn");
    }

    #[test]
    fn a_completed_write_carries_its_path_into_the_result_diff() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "write".into(),
            args: json!({"path": "src/main.rs"}),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "wrote 3 lines".into(),
            is_error: false,
            diff: Some("     1 | fn main() {\n-    2 | let x = 1;\n+    2 | let x = 2;".into()),
        });
        assert!(
            !diff_syntax_colours(&row_lines(&app.transcript)).is_empty(),
            "result diff not highlighted: {:?}",
            app.transcript.iter().map(row_text).collect::<Vec<_>>()
        );
    }

    #[test]
    fn diff_lines_renders_all_when_under_cap() {
        let out = diff_lines("- foo\n+ bar", 80, DIFF_MAX_ROWS, "│     ", None);
        // 2 content rows framed by a top and bottom border.
        assert_eq!(out.len(), 4);
        assert!(line_text(&out[0]).contains('┌'), "top: {}", line_text(&out[0]));
        assert!(
            line_text(out.last().unwrap()).contains('┘'),
            "bottom: {}",
            line_text(out.last().unwrap())
        );
    }

    /// The panel is sized to the width it is drawn at: gutter, frame and content
    /// together have to fit, or the closing border wraps onto a line of its own
    /// and the box reads as double-spaced with no right edge.
    #[test]
    fn a_boxed_diff_fits_the_draw_width() {
        let long = format!("+    1 | {}", "x".repeat(300));
        for gutter in ["", "│   ", "│     ", "│       "] {
            for width in [40usize, 80, 163] {
                for line in diff_lines(&long, width, DIFF_MAX_ROWS, gutter, None) {
                    assert!(
                        row_width(&line) <= width,
                        "gutter {:?} at width {width}: row is {} wide: {:?}",
                        gutter,
                        row_width(&line),
                        line_text(&line)
                    );
                }
            }
        }
    }

    /// Same, through the row that actually renders in the transcript: the result
    /// row owns both the gutter and the width, so its diff must fit unaided.
    #[test]
    fn a_result_row_diff_fits_the_draw_width() {
        let row: Row = RowKind::Result {
            tag: "✓",
            tag_style: Style::new().green(),
            content: Some("Wrote notes.md".into()),
            diff: Some(format!("@@ created file @@\n+    1 | {}", "y".repeat(300))),
            lang: None,
        }
        .into();
        for width in [40u16, 80, 163] {
            for line in row.lines(width) {
                assert!(
                    row_width(&line) <= width as usize,
                    "width {width}: row is {} wide: {:?}",
                    row_width(&line),
                    line_text(&line)
                );
            }
        }
    }

    fn plus_rows(n: usize) -> String {
        (0..n)
            .map(|i| format!("+ line {i}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn diff_lines_collapses_tail_past_cap() {
        let out = diff_lines(&plus_rows(30), 80, 20, "│     ", None);
        // 20 content rows + a `(+N more)` row, framed by 2 borders.
        assert_eq!(out.len(), 20 + 1 + 2);
        // The tail sits just above the closing border.
        let tail = line_text(&out[out.len() - 2]);
        assert!(tail.contains("(+10 more)"), "tail: {tail}");
    }

    /// The transcript scrolls, so a long edit is shown in full there; the
    /// permission prompt does not, and keeps the tight cap so the decision list
    /// is never crowded out.
    #[test]
    fn the_result_cap_is_generous_and_the_prompt_cap_is_not() {
        assert_eq!(DIFF_MAX_ROWS, 1000);
        let long = plus_rows(400);
        let result = diff_lines(&long, 80, DIFF_MAX_ROWS, "│     ", None);
        assert_eq!(result.len(), 400 + 2, "result diff must not collapse");

        let mut prompt = pending(true);
        prompt.diff = Some(long);
        let preview = prompt.diff_preview(80);
        assert_eq!(preview.len(), DIFF_PREVIEW_MAX_ROWS + 1 + 2);
    }

    #[test]
    fn cancel_clears_pending_run_start() {
        let mut app = test_app();
        // Submit while the run is still gated on model/MCP/snapshot readiness:
        // want_start is armed but no run has spawned yet.
        app.submit_user("do a thing".into());
        app.apply(StreamEvent::SubagentStart {
            run_id: "sub-reviewer-1".into(),
            name: "reviewer".into(),
            task: None,
        });
        app.apply(StreamEvent::ToolCall {
            id: "a1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "sub-reviewer-1" }),
        });
        // A second call whose args are still streaming in (no ToolCall event
        // yet, just the throbber-only ToolCallStarted).
        app.apply(StreamEvent::ToolCallStarted {
            id: "w1".into(),
            name: "write".into(),
        });
        assert!(app.want_start, "submit should arm want_start");
        assert_eq!(app.status, Status::Running);
        assert_eq!(app.subagents.len(), 1);
        assert_eq!(app.awaiting.len(), 1);
        assert_eq!(app.starting.len(), 1);

        app.cancel_run();
        assert!(
            !app.want_start,
            "cancel must drop the pending start or the loop re-spawns it"
        );
        assert_eq!(app.status, Status::Idle);
        assert!(app.subagents.is_empty(), "cancel must clear live subagent rows");
        assert!(app.awaiting.is_empty(), "cancel must clear awaited-subagent state");
        assert!(
            app.starting.is_empty(),
            "cancel must clear a still-streaming call's throbber, or it lingers forever"
        );
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
        let body: Vec<String> = app.transcript.iter().map(row_text).collect();
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
        let running = row_text(app.transcript.last().unwrap());
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
        let row = row_text(app.transcript.last().unwrap());
        assert!(row.contains("✓") && row.contains("Ran: grep"), "row: {row}");
        assert!(!row.contains("lines"), "row: {row}");
        assert!(app.tool_group.is_none());
    }

    #[test]
    fn expanded_bash_group_shows_full_output_not_summary() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "git push" }),
        });
        let content = "To github.com:janhq/jan.git\n   a1b2c3d..e4f5g6h  main -> main\nremote line\n[exit 0]";
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: content.into(),
            is_error: false,
            diff: None,
        });
        app.finalize_tool_group();
        let joined = group_detail_lines(&app.groups[0], 120)
            .iter()
            .map(line_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("main -> main"), "middle line lost: {joined}");
        assert!(joined.contains("remote line"), "line lost: {joined}");
        assert!(joined.contains("[exit 0]"), "exit marker lost: {joined}");
        assert!(!joined.contains("(+"), "must not summarize when expanded: {joined}");
        // Single-call group: the command header must not be repeated inside the
        // expansion (the summary row above already shows it).
        assert!(!joined.contains("▸"), "duplicate command header: {joined}");
        assert!(!joined.contains("git push"), "duplicate command label: {joined}");
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
            .map(row_text)
            .find(|t| t.contains("Ran: grep"))
            .unwrap();
        assert!(row.contains("✓"), "row: {row}");
        // Later tokens must not re-trigger finalize work.
        app.apply(StreamEvent::Token { text: " goes".into() });
        assert!(app.tool_group.is_none());
    }

    #[test]
    fn failed_grouped_call_keeps_its_failure_in_the_expanded_detail() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "foo" }),
        });
        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "read".into(),
            args: json!({ "path": "main.rs" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ERROR: tool 'grep' denied by user".into(),
            is_error: true,
            diff: None,
        });
        app.apply(StreamEvent::ToolResult {
            id: "c2".into(),
            content: "fn main() {}".into(),
            is_error: false,
            diff: None,
        });
        app.finalize_tool_group();
        // The collapsed row carries the latest result, but the earlier failure
        // must still be reachable by expanding the group.
        let row = row_text(&app.transcript[app.groups[0].idx]);
        assert!(row.contains("✓"), "row: {row}");
        let detail: String = group_detail_lines(&app.groups[0], 80)
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            detail.contains("✗") && detail.contains("denied by user"),
            "failure lost from the expanded detail: {detail}"
        );
    }

    #[test]
    fn cancelled_tool_group_is_not_marked_successful() {
        let mut app = test_app();
        app.submit_user("do a thing".into());
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "sleep 300" }),
        });
        let idx = app.tool_group.as_ref().unwrap().idx;
        app.cancel_run();
        let row = row_text(&app.transcript[idx]);
        assert!(
            !row.contains("✓"),
            "a cancelled command must not read as succeeded: {row}"
        );
        assert!(row.contains("○"), "no interrupted marker: {row}");
    }

    #[test]
    fn cancelled_standalone_edit_row_is_marked_interrupted() {
        let mut app = test_app();
        app.submit_user("do a thing".into());
        app.apply(StreamEvent::ToolCall {
            id: "e1".into(),
            name: "edit".into(),
            args: json!({ "path": "foo.rs", "old_string": "a", "new_string": "b" }),
        });
        let idx = app.transcript.len() - 1;
        assert!(row_text(&app.transcript[idx]).contains("▸"));
        app.cancel_run();
        let row = row_text(&app.transcript[idx]);
        assert!(
            !row.contains("▸"),
            "cancelled edit still reads as in flight: {row}"
        );
        assert!(row.contains("○"), "no interrupted marker: {row}");
    }

    #[test]
    fn completed_standalone_edit_survives_a_later_cancel() {
        let mut app = test_app();
        app.submit_user("do a thing".into());
        app.apply(StreamEvent::ToolCall {
            id: "e1".into(),
            name: "edit".into(),
            args: json!({ "path": "foo.rs", "old_string": "a", "new_string": "b" }),
        });
        let idx = app.transcript.len() - 1;
        app.apply(StreamEvent::ToolResult {
            id: "e1".into(),
            content: "edited foo.rs".into(),
            is_error: false,
            diff: None,
        });
        app.cancel_run();
        let row = row_text(&app.transcript[idx]);
        assert!(
            row.contains("✓ Edited foo.rs") && !row.contains("○"),
            "a resolved edit must keep its call row: {row}"
        );
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
        let rows: Vec<String> = app.transcript.iter().map(row_text).collect();
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
            .filter(|r| row_text(r).contains("Reading") || row_text(r).contains("Read "))
            .count();
        assert_eq!(tool_rows, 1);
        // Every call has reported, so the row already reads as a finished
        // breakdown -- not "<latest> (4)", and not still-running until the
        // model speaks.
        let row = row_text(app.transcript.last().unwrap());
        assert!(row.contains("✓ Read 3 memory notes, 1 skill"), "row: {row}");
        // The model speaking closes the group without disturbing the row.
        app.apply(StreamEvent::Token { text: "Done.".into() });
        let row = row_text(app.transcript.last().unwrap());
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
    fn folded_group_expands_and_collapses_via_click() {
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
        let group_idx = app.groups[0].idx;

        // A click on the group's own row toggles it, same as Ctrl-O.
        app.toggle_region(group_idx);
        assert!(app.expanded.contains(&group_idx));
        app.toggle_region(group_idx);
        assert!(app.expanded.is_empty());

        // A row that isn't a region's own summary is a no-op.
        app.toggle_region(9999);
        assert!(app.expanded.is_empty());
    }

    #[test]
    fn running_group_row_shows_spinner_and_elapsed() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "foo" }),
        });
        let group = app.tool_group.as_ref().expect("group open");
        let row = running_group_row(group, 2, 80);
        let text = line_text(&row);
        assert!(text.contains(SPINNER[2]), "{text}");
        assert!(text.contains("(0s)") || text.contains("(1s)"), "{text}");
    }

    /// A lone in-flight call is specific enough to name: the live row shows its
    /// own label (the full command for bash), not the "running 1 command" count.
    #[test]
    fn running_single_call_row_names_the_call() {
        let mut app = test_app();
        let cmd = format!("grep -n foo {}", "src/very/long/path/".repeat(6));
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": cmd }),
        });
        let group = app.tool_group.as_ref().expect("group open");
        let text = line_text(&running_group_row(group, 0, 200));
        assert!(text.contains(&format!("Executing: {cmd}")), "{text}");
        assert!(!text.contains("running 1 command"), "{text}");
    }

    /// Two or more calls in flight still name the tool actively running (the
    /// latest outstanding one), not a counted breakdown -- a summary like
    /// "Running 2 commands" would wrongly imply both are executing at once.
    #[test]
    fn running_multi_call_row_names_the_in_flight_tool() {
        let mut app = test_app();
        for (id, cmd) in [("c1", "cargo test"), ("c2", "cargo clippy")] {
            app.apply(StreamEvent::ToolCall {
                id: id.into(),
                name: "bash".into(),
                args: json!({ "command": cmd }),
            });
        }
        let group = app.tool_group.as_ref().expect("group open");
        let text = line_text(&running_group_row(group, 0, 200));
        assert!(text.contains("Executing: cargo clippy"), "{text}");
        assert!(!text.contains("Running 2 commands"), "{text}");
    }

    #[test]
    fn tool_group_stops_looking_live_once_its_call_resolves() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "foo" }),
        });
        assert!(app.tool_group.as_ref().unwrap().is_running());
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        // Group stays open (folding), but with its only call resolved and no
        // next call yet, it must not render as still executing.
        assert!(app.tool_group.is_some());
        assert!(!app.tool_group.as_ref().unwrap().is_running());

        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "grep".into(),
            args: json!({ "pattern": "bar" }),
        });
        assert!(app.tool_group.as_ref().unwrap().is_running());
    }

    #[test]
    fn grouped_row_resolves_when_its_result_lands_not_when_prose_starts() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "foo" }),
        });
        let idx = app.tool_group.as_ref().unwrap().idx;
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        // No token has streamed yet: the row must already read as done rather
        // than sitting on the present-tense running form until prose arrives.
        let row = row_text(&app.transcript[idx]);
        assert!(row.contains("✓"), "status lagged behind the result: {row}");
        assert!(row.contains("Searched"), "row not past tense: {row}");

        // A later call in the same group reopens it as running.
        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "read".into(),
            args: json!({ "path": "main.rs" }),
        });
        let row = row_text(&app.transcript[idx]);
        assert!(row.contains("▸") && !row.contains("✓"), "row: {row}");
    }

    #[test]
    fn failed_grouped_row_shows_the_failure_before_the_group_closes() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "cargo build" }),
        });
        let idx = app.tool_group.as_ref().unwrap().idx;
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ERROR: command not found".into(),
            is_error: true,
            diff: None,
        });
        let row = row_text(&app.transcript[idx]);
        assert!(
            row.contains("✗") && !row.contains("✓"),
            "failure not shown at result time: {row}"
        );
    }

    #[test]
    fn grouped_row_reports_the_latest_result_not_an_earlier_failure() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "cargo buidl" }),
        });
        let idx = app.tool_group.as_ref().unwrap().idx;
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ERROR: no such subcommand".into(),
            is_error: true,
            diff: None,
        });
        // The retry succeeds, so the collapsed row must stop reading as failed.
        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "bash".into(),
            args: json!({ "command": "cargo build" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c2".into(),
            content: "Finished".into(),
            is_error: false,
            diff: None,
        });
        let row = row_text(&app.transcript[idx]);
        assert!(
            row.contains("✓") && !row.contains("✗"),
            "stale failure on the summary row: {row}"
        );
    }

    #[test]
    fn group_row_stays_running_while_a_sibling_call_is_outstanding() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "bash".into(),
            args: json!({ "command": "sleep 10" }),
        });
        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "read".into(),
            args: json!({ "path": "main.rs" }),
        });
        let idx = app.tool_group.as_ref().unwrap().idx;
        // Results can land out of dispatch order; the row must not claim the
        // batch is done while an earlier call is still outstanding.
        app.apply(StreamEvent::ToolResult {
            id: "c2".into(),
            content: "fn main() {}".into(),
            is_error: false,
            diff: None,
        });
        assert!(app.tool_group.as_ref().unwrap().is_running());
        let row = row_text(&app.transcript[idx]);
        assert!(!row.contains("✓"), "resolved early: {row}");
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "done".into(),
            is_error: false,
            diff: None,
        });
        assert!(!app.tool_group.as_ref().unwrap().is_running());
        assert!(row_text(&app.transcript[idx]).contains("✓"));
    }

    #[test]
    fn handle_mouse_click_maps_row_to_region_toggle() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "memory_read".into(),
            args: json!({ "name": "x" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "result".into(),
            is_error: false,
            diff: None,
        });
        app.apply(StreamEvent::Token { text: "Done.".into() });
        let group_idx = app.groups[0].idx;

        // Simulate what `draw` would have recorded: the group's row is the
        // only transcript row, right under the top border at row 1.
        app.transcript_rect = Rect::new(0, 0, 80, 10);
        app.last_scroll = 0;
        app.row_index = vec![Some(group_idx)];

        click(&mut app, 5, 1);
        assert!(app.expanded.contains(&group_idx));

        // Clicking outside the viewport (past the bottom border) is a no-op.
        click(&mut app, 5, 9);
        assert!(app.expanded.contains(&group_idx));
    }

    #[test]
    fn wheel_scrolls_transcript() {
        let mut app = test_app();
        app.transcript_rect = Rect::new(0, 0, 80, 10);
        let up = |app: &mut App| {
            handle_mouse(
                app,
                MouseEvent {
                    kind: MouseEventKind::ScrollUp,
                    column: 5,
                    row: 5,
                    modifiers: KeyModifiers::NONE,
                },
            )
        };
        up(&mut app);
        up(&mut app);
        assert_eq!(app.scrollback, 2);
        handle_mouse(
            &mut app,
            MouseEvent {
                kind: MouseEventKind::ScrollDown,
                column: 5,
                row: 5,
                modifiers: KeyModifiers::NONE,
            },
        );
        assert_eq!(app.scrollback, 1);
    }

    #[test]
    fn toggle_region_expands_still_running_group() {
        // A tool group is still open (not yet finalized into `app.groups`)
        // while the agent is actively executing -- clicking its row must
        // still toggle it, not just after it finishes.
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "foo" }),
        });
        let idx = app.tool_group.as_ref().expect("group open").idx;
        assert!(app.groups.is_empty(), "not finalized yet");

        app.toggle_region(idx);
        assert!(app.expanded.contains(&idx));
        app.toggle_region(idx);
        assert!(app.expanded.is_empty());
    }

    #[test]
    fn clicking_anywhere_in_expanded_block_collapses_it() {
        // Once a block (e.g. long reasoning) has expanded past the viewport,
        // its header row can scroll out of view. A click on any of its detail
        // rows -- not just the header -- must still collapse it.
        let mut app = test_app();
        app.push_assistant_blocks("<think>line one\nline two\nline three</think>answer");
        assert_eq!(app.reasoning_blocks.len(), 1);
        let idx = app.reasoning_blocks[0].idx;

        app.toggle_region(idx);
        assert!(app.expanded.contains(&idx));

        // Detail rows map back to the same idx as the header (see draw()).
        app.transcript_rect = Rect::new(0, 0, 80, 10);
        app.last_scroll = 0;
        app.row_index = vec![Some(idx), Some(idx), Some(idx)];
        click(&mut app, 5, 2); // a detail row, not the header at row 1
        assert!(app.expanded.is_empty(), "click on a detail row should collapse");
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
            .filter(|l| {
                let t = row_text(l);
                t.contains("Executing") || t.contains("Running") || t.contains("Ran")
            })
            .count();
        assert_eq!(tool_rows, 1);
        app.on_done("stop".into(), None);
        let row = app
            .transcript
            .iter()
            .map(row_text)
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
        let rows: Vec<String> = app.transcript.iter().map(row_text).collect();
        assert!(
            !rows.iter().any(|r| r.contains("let me look")),
            "raw reasoning must be hidden by default: {rows:?}"
        );
        let think_at = rows.iter().position(|r| r.contains("reasoning (1 line)")).unwrap();
        let tool_at = rows
            .iter()
            .position(|r| r.contains("Executing") || r.contains("Running") || r.contains("Ran"))
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
        let rows: Vec<String> = app.transcript.iter().map(row_text).collect();
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

        let rows: Vec<String> = app.transcript.iter().map(row_text).collect();
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
                let t = row_text(l);
                t.contains("Executing") || t.contains("Running") || t.contains("Ran ")
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
            .map(row_text)
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
            .any(|l| row_text(l).contains("finished")));
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
            .map(row_text)
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
            .any(|l| row_text(l).contains("finished with no answer")));
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
            app.pending_queue.clear(); // simulate approval
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
            .filter(|l| {
                let t = row_text(l);
                t.contains("Executing") || t.contains("Running") || t.contains("Ran")
            })
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
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        // The call row resolves to past tense once the result lands.
        assert!(joined.contains("Edited a.txt"), "{joined}");
        assert!(!joined.contains("Editing a.txt"), "{joined}");
        assert!(joined.contains('┌') && joined.contains('┘'), "{joined}");
    }

    #[test]
    fn diff_tool_row_reads_present_tense_until_its_result_lands() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "write".into(),
            args: json!({ "path": "a.txt", "content": "x" }),
        });
        assert!(row_text(app.transcript.last().unwrap()).contains("Writing a.txt"));
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "boom".into(),
            is_error: true,
            diff: None,
        });
        let joined: String = app
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("✗ Wrote a.txt"), "{joined}");
        assert!(app.pending_rows.is_empty());
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

    /// Run one turn that reasons, calls a diff-producing tool, and answers,
    /// leaving it persisted (messages + journal) in `app.agent_dir`.
    fn record_full_turn(app: &mut App) {
        app.submit_user("do it".to_string());
        app.apply(StreamEvent::Token {
            text: "<think>my private reasoning</think>".into(),
        });
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "write".into(),
            args: json!({ "path": "a.txt", "content": "x" }),
        });
        app.apply(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "wrote 1 line".into(),
            is_error: false,
            diff: Some("@@ created file @@\n+    1 | x".into()),
        });
        app.apply(StreamEvent::MessagesUpdated {
            messages: vec![
                json!({ "role": "user", "content": "do it" }),
                json!({ "role": "assistant", "content": "", "tool_calls": [{
                    "id": "c1",
                    "type": "function",
                    "function": { "name": "write", "arguments": "{\"path\":\"a.txt\"}" },
                }]}),
                json!({ "role": "tool", "tool_call_id": "c1", "content": "wrote 1 line" }),
            ],
        });
        app.apply(StreamEvent::Token {
            text: "Answer.".into(),
        });
        app.on_done("stop".into(), None);
        app.join_journal();
    }

    #[tokio::test]
    async fn resume_restores_reasoning_tool_rows_and_diffs() {
        let mut app = test_app();
        record_full_turn(&mut app);
        let live: String = app
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");

        let mut fresh = test_app();
        fresh.agent_dir = app.agent_dir.clone();
        apply_resume(&mut fresh, &ResumeTarget::Latest).await;
        let resumed: String = fresh
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(fresh.reasoning_blocks.len(), 1, "folded reasoning is back");
        assert!(resumed.contains("reasoning (1 line)"), "{resumed}");
        assert!(resumed.contains("✓ Wrote a.txt"), "tool row: {resumed}");
        assert!(
            resumed.contains("@@ created file @@") && resumed.contains("+    1 | x"),
            "diff panel: {resumed}"
        );
        assert!(resumed.contains("Answer."), "{resumed}");
        // Every rendered row returns; the turn receipt (`↑ tokens ⏱ elapsed`) is
        // deliberately transient, like notes and permission prompts.
        assert!(
            live.lines()
                .filter(|l| !l.contains('⏱'))
                .all(|l| resumed.contains(l.trim_end())),
            "every live row must come back\nlive:\n{live}\nresumed:\n{resumed}"
        );
        // Expanding the restored reasoning row reveals its full detail, so the
        // journal carried the text and not just the summary count.
        fresh.toggle_regions();
        let expanded = render_rows(&mut fresh, 60, 30).join("\n");
        assert!(expanded.contains("my private reasoning"), "{expanded}");
    }

    /// The common shape: several grouped calls (bash, not the standalone
    /// edit/write rows), each run separated by the model's prose. Live, the
    /// prose is what closes each group; a replay must close them the same way or
    /// every call folds into one row that is never committed.
    #[tokio::test]
    async fn resume_restores_grouped_tool_calls_between_prose() {
        let mut app = test_app();
        app.submit_user("check it".to_string());
        for (i, cmd) in ["git status", "git log -1"].iter().enumerate() {
            app.apply(StreamEvent::Token {
                text: format!("<think>step {i}</think>"),
            });
            app.apply(StreamEvent::ToolCall {
                id: format!("c{i}"),
                name: "bash".into(),
                args: json!({ "command": cmd }),
            });
            app.apply(StreamEvent::ToolResult {
                id: format!("c{i}"),
                content: "output".into(),
                is_error: false,
                diff: None,
            });
            app.apply(StreamEvent::Token {
                text: format!("Ran {cmd}.\n"),
            });
        }
        app.on_done("stop".into(), None);
        app.join_journal();
        let live: String = app
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(live.contains("git status") && live.contains("git log -1"), "{live}");

        let mut fresh = test_app();
        fresh.agent_dir = app.agent_dir.clone();
        apply_resume(&mut fresh, &ResumeTarget::Latest).await;
        let resumed: String = fresh
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            resumed.contains("git status") && resumed.contains("git log -1"),
            "both grouped calls must come back as their own rows:\n{resumed}"
        );
        assert!(
            fresh.tool_group.is_none(),
            "no group may be left open after a replay"
        );
        assert_eq!(fresh.groups.len(), 2, "one closed group per run of calls");
        // Expanding a restored group row still shows the call and its output.
        fresh.toggle_regions();
        let expanded = render_rows(&mut fresh, 80, 40).join("\n");
        assert!(expanded.contains("output"), "{expanded}");
    }

    #[tokio::test]
    async fn resume_restores_the_model_side_tool_calls() {
        let mut app = test_app();
        record_full_turn(&mut app);
        assert!(
            !serde_json::to_string(&app.history).unwrap().contains("<think>"),
            "reasoning must not be resent to the model: {:?}",
            app.history
        );

        let mut fresh = test_app();
        fresh.agent_dir = app.agent_dir.clone();
        apply_resume(&mut fresh, &ResumeTarget::Latest).await;

        assert_eq!(fresh.history, app.history, "the wire conversation round-trips");
        let called = fresh
            .history
            .iter()
            .find(|m| m.get("tool_calls").is_some())
            .expect("the call the model made is back");
        assert_eq!(called["tool_calls"][0]["id"], "c1");
        let result = fresh
            .history
            .iter()
            .find(|m| m["role"] == "tool")
            .expect("its result is back");
        assert_eq!(result["tool_call_id"], "c1");
        assert_eq!(result["content"], "wrote 1 line");
    }

    #[tokio::test]
    async fn resume_falls_back_to_messages_without_a_journal() {
        let mut app = test_app();
        record_full_turn(&mut app);
        let id = app.thread_id.clone().expect("saved");
        std::fs::remove_file(journal::journal_path(&app.agent_dir, &id)).unwrap();

        let mut fresh = test_app();
        fresh.agent_dir = app.agent_dir.clone();
        apply_resume(&mut fresh, &ResumeTarget::Latest).await;
        let resumed: String = fresh
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(resumed.contains("do it") && resumed.contains("Answer."), "{resumed}");
        assert!(fresh.display_log.is_empty(), "nothing to journal from");
    }

    #[tokio::test]
    async fn rewind_keeps_the_kept_turns_tool_rows() {
        let mut app = test_app();
        record_full_turn(&mut app);
        app.submit_user("and again".to_string());
        app.apply(StreamEvent::Token {
            text: "Second answer.".into(),
        });
        app.on_done("stop".into(), None);

        rewind_to(&mut app, 1, false);
        let after: String = app
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(after.contains("✓ Wrote a.txt"), "first turn keeps its rows: {after}");
        assert!(after.contains("@@ created file @@"), "{after}");
        assert!(!after.contains("Second answer."), "rewound turn is gone: {after}");
        assert!(
            !app.display_log
                .iter()
                .any(|e| matches!(e, DisplayEntry::User { text, .. } if text == "and again")),
            "the journal is truncated with the conversation"
        );
        assert_eq!(app.input, "and again", "the rewound message returns to the input");
    }

    #[tokio::test]
    async fn apply_resume_latest_restores_history_and_model() {
        let mut app = test_app();
        let history = vec![
            json!({ "role": "user", "content": "first" }),
            json!({ "role": "assistant", "content": "reply" }),
        ];
        let id =
            super::super::cli_save_thread(&app.agent_dir, None, "saved-model", &history, None)
                .unwrap();

        let mut fresh = test_app();
        fresh.agent_dir = app.agent_dir.clone();
        apply_resume(&mut fresh, &ResumeTarget::Latest).await;

        assert_eq!(fresh.thread_id.as_deref(), Some(id.as_str()));
        assert_eq!(fresh.history, history);
        assert_eq!(fresh.model, "saved-model");
        let joined: String = fresh
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("first") && joined.contains("reply"), "{joined}");

        // Re-saving the resumed session updates the same thread, not a new one.
        app.agent_dir = fresh.agent_dir.clone();
        let same =
            super::super::cli_save_thread(&app.agent_dir, Some(&id), "saved-model", &fresh.history, None)
                .unwrap();
        assert_eq!(same, id);
        assert_eq!(super::super::list_threads_in(&app.agent_dir).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn resuming_restores_the_recall_history() {
        let app = test_app();
        let history = vec![
            json!({ "role": "user", "content": "first" }),
            json!({ "role": "assistant", "content": "reply" }),
            json!({ "role": "user", "content": "second" }),
        ];
        super::super::cli_save_thread(&app.agent_dir, None, "saved-model", &history, None).unwrap();

        let mut fresh = test_app();
        fresh.agent_dir = app.agent_dir.clone();
        // A line typed before the resume belongs to the session being replaced.
        fresh.record_submitted("stale");
        apply_resume(&mut fresh, &ResumeTarget::Latest).await;

        assert_eq!(fresh.input_history, vec!["first", "second"]);
        assert!(fresh.recall_prev(), "Up recalls instead of scrolling");
        assert_eq!(fresh.input, "second");
        assert!(fresh.recall_prev());
        assert_eq!(fresh.input, "first");
        assert_eq!(fresh.scrollback, 0, "recall must not scroll the transcript");
    }

    #[tokio::test]
    async fn apply_resume_notes_when_nothing_to_resume() {
        let mut app = test_app();
        apply_resume(&mut app, &ResumeTarget::Latest).await;
        let joined: String = app
            .transcript
            .iter()
            .map(row_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains(super::super::NO_SESSION_TO_RESUME), "{joined}");
        assert!(app.thread_id.is_none());
        assert!(app.history.is_empty());
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
    fn parse_command_splits_name_and_arg() {
        assert_eq!(parse_command("resume abc123"), ("resume", "abc123"));
        assert_eq!(parse_command("help"), ("help", ""));
        assert_eq!(parse_command("  resume   abc  "), ("resume", "abc"));
        assert_eq!(parse_command(""), ("", ""));
    }

    #[test]
    fn mouse_tracking_requests_buttons_wheel_and_held_drags() {
        assert!(MOUSE_TRACK_ON.contains("?1000h"), "buttons and wheel");
        assert!(MOUSE_TRACK_ON.contains("?1002h"), "drag while held");
        assert!(MOUSE_TRACK_ON.contains("?1006h"), "SGR coordinates");
        assert!(
            !MOUSE_TRACK_ON.contains("1003"),
            "any-motion would report every idle pointer move: {MOUSE_TRACK_ON:?}"
        );
        assert!(
            ALT_SCROLL_SAVE_OFF.contains("?1007l"),
            "the wheel must never arrive as arrow keys"
        );
        assert!(ALT_SCROLL_RESTORE.contains("?1007r"), "restore on exit");
    }

    #[test]
    fn linear_selection_spans_whole_rows_between_the_ends() {
        let sel = Selection {
            anchor: (5, 1),
            head: (2, 3),
            mode: SelectionMode::Linear,
            dragging: false,
            moved: true,
        };
        assert_eq!(sel.spans(10), vec![(1, 5, 9), (2, 0, 9), (3, 0, 2)]);
    }

    #[test]
    fn selection_spans_are_direction_independent() {
        let forward = Selection {
            anchor: (5, 1),
            head: (2, 3),
            mode: SelectionMode::Linear,
            dragging: false,
            moved: true,
        };
        let backward = Selection {
            anchor: (2, 3),
            head: (5, 1),
            ..forward
        };
        assert_eq!(forward.spans(10), backward.spans(10));
    }

    #[test]
    fn block_selection_spans_a_rectangle() {
        let sel = Selection {
            anchor: (6, 3),
            head: (2, 1),
            mode: SelectionMode::Block,
            dragging: false,
            moved: true,
        };
        assert_eq!(sel.spans(10), vec![(1, 2, 6), (2, 2, 6), (3, 2, 6)]);
    }

    /// A block drag lifts one column out of a table without the neighbours a
    /// linear drag would sweep up.
    #[test]
    fn selection_text_reads_cells_and_trims_row_padding() {
        let area = Rect::new(0, 0, 12, 3);
        let mut buf = Buffer::empty(area);
        buf.set_string(0, 0, "alpha   one", Style::new());
        buf.set_string(0, 1, "beta    two", Style::new());

        let linear = Selection {
            anchor: (0, 0),
            head: (10, 1),
            mode: SelectionMode::Linear,
            dragging: false,
            moved: true,
        };
        assert_eq!(selection_text(&buf, linear, area), "alpha   one\nbeta    two");

        let block = Selection {
            anchor: (8, 0),
            head: (10, 1),
            mode: SelectionMode::Block,
            dragging: false,
            moved: true,
        };
        assert_eq!(selection_text(&buf, block, area), "one\ntwo");

        // A row selected past its text keeps no trailing padding.
        let padded = Selection {
            anchor: (0, 0),
            head: (11, 0),
            mode: SelectionMode::Linear,
            dragging: false,
            moved: true,
        };
        assert_eq!(selection_text(&buf, padded, area), "alpha   one");
    }

    #[test]
    fn a_drag_selects_instead_of_toggling_the_row_under_it() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "foo" }),
        });
        let idx = app.tool_group.as_ref().expect("group open").idx;
        app.transcript_rect = Rect::new(0, 0, 80, 10);
        app.last_scroll = 0;
        app.row_index = vec![Some(idx)];

        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Down(MouseButton::Left), 5, 1),
        );
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Drag(MouseButton::Left), 30, 1),
        );
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Up(MouseButton::Left), 30, 1),
        );

        assert!(app.expanded.is_empty(), "a drag must not expand the row");
        assert!(app.copy_armed, "the release arms the copy");
        let sel = app.selection.expect("selection held after release");
        assert!(!sel.dragging);
        assert_eq!(sel.spans(80), vec![(1, 5, 30)]);
    }

    #[test]
    fn alt_drag_selects_a_block() {
        let mut app = test_app();
        handle_mouse(
            &mut app,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 5,
                row: 1,
                modifiers: KeyModifiers::ALT,
            },
        );
        assert_eq!(
            app.selection.expect("selection").mode,
            SelectionMode::Block
        );
    }

    #[test]
    fn scrolling_drops_a_finished_selection() {
        let mut app = test_app();
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Down(MouseButton::Left), 5, 1),
        );
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Drag(MouseButton::Left), 9, 1),
        );
        handle_mouse(&mut app, mouse_at(MouseEventKind::ScrollUp, 5, 1));
        assert!(app.selection.is_none(), "content moved out from under it");
    }

    #[test]
    fn a_held_drag_past_an_edge_scrolls_the_transcript() {
        let mut app = test_app();
        app.transcript_rect = Rect::new(0, 0, 80, 10);
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Down(MouseButton::Left), 5, 5),
        );

        // Above the top border: scroll back through history.
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Drag(MouseButton::Left), 5, 0),
        );
        autoscroll_selection(&mut app);
        autoscroll_selection(&mut app);
        assert_eq!(app.scrollback, 2);

        // Below the last body row: scroll back toward the newest output.
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Drag(MouseButton::Left), 5, 9),
        );
        autoscroll_selection(&mut app);
        assert_eq!(app.scrollback, 1);

        // Inside the viewport, nothing moves.
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Drag(MouseButton::Left), 5, 4),
        );
        autoscroll_selection(&mut app);
        assert_eq!(app.scrollback, 1);

        // A released drag stops scrolling even parked past the edge.
        handle_mouse(
            &mut app,
            mouse_at(MouseEventKind::Up(MouseButton::Left), 5, 0),
        );
        app.selection.as_mut().expect("selection").head = (5, 0);
        autoscroll_selection(&mut app);
        assert_eq!(app.scrollback, 1);
    }

    #[test]
    fn copy_notice_expires() {
        let mut app = test_app();
        assert_eq!(app.copy_notice(), None);
        app.copied = Some((Instant::now(), 3));
        assert_eq!(app.copy_notice(), Some(3));
        app.copied = Some((Instant::now() - COPY_NOTICE - Duration::from_millis(1), 3));
        assert_eq!(app.copy_notice(), None);
    }

    #[tokio::test]
    async fn mouse_tracking_has_no_toggle_hotkey() {
        assert!(
            !KEY_BINDINGS.iter().any(|(k, _)| k.contains("Ctrl-T")),
            "mouse tracking is a config key now, not a hotkey"
        );
        assert!(
            KEY_BINDINGS.iter().any(|(_, d)| d.contains("Select text")),
            "the selection gesture still needs advertising"
        );

        // Ctrl-T is an ordinary unbound key: it must not type into the input.
        let mut app = test_app();
        let registry: PermissionRegistry = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mcp_servers: crate::core::state::SharedMcpServers =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mut current: Option<CurrentRun> = None;
        let key = KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL);
        handle_key(&mut app, key, &registry, &mut current, &mcp_servers).await;
        assert!(app.input.is_empty(), "got: {:?}", app.input);
    }

    #[tokio::test]
    async fn compact_command_notes_when_unavailable() {
        let mut app = test_app();
        app.history.push(json!({ "role": "user", "content": "hi" }));
        run_command(&mut app, "compact").await;
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("compaction unavailable"), "got: {text}");
        // History untouched when no session is attached.
        assert_eq!(app.history.len(), 1);
        assert!(app.compact_request.is_none());
    }

    #[tokio::test]
    async fn compact_command_is_refused_while_one_is_in_flight() {
        let mut app = test_app();
        app.compacting = Some(CompactKind::Auto);
        run_command(&mut app, "compact").await;
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("already compacting"), "got: {text}");
        assert!(app.compact_request.is_none());
    }

    #[test]
    fn finish_compaction_keeps_messages_added_while_it_ran() {
        let mut app = test_app();
        app.compacting = Some(CompactKind::Manual);
        app.compact_started = Some(Instant::now());
        app.history = (0..5)
            .map(|i| json!({ "role": "user", "content": format!("m{i}") }))
            .collect();
        // A message submitted while the summary was being generated.
        let base_len = 4;
        finish_compaction(
            &mut app,
            Ok(vec![json!({ "role": "user", "content": "summary" })]),
            base_len,
        );
        let contents: Vec<String> = app
            .history
            .iter()
            .map(|m| m["content"].as_str().unwrap_or_default().to_string())
            .collect();
        assert_eq!(contents, vec!["summary", "m4"], "tail must survive");
        assert!(app.compacting.is_none());
        assert!(app.compact_started.is_none());
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("compacted 4 -> 2 messages"), "got: {text}");
    }

    #[test]
    fn finish_compaction_restores_idle_state_on_failure() {
        let mut app = test_app();
        app.compacting = Some(CompactKind::Auto);
        app.history = vec![json!({ "role": "user", "content": "hi" })];
        finish_compaction(&mut app, Err("upstream 500".into()), 1);
        assert_eq!(app.history.len(), 1, "history must be left alone");
        assert!(app.compacting.is_none(), "a failure must allow a retry");
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("auto-compacting failed: upstream 500"), "got: {text}");
    }

    #[test]
    fn a_running_compaction_shows_a_throbber() {
        let mut app = test_app();
        let idle = render_rows(&mut app, 80, 12).join("\n");
        assert!(!idle.contains("compacting"), "got: {idle}");

        app.compacting = Some(CompactKind::Manual);
        app.compact_started = Some(Instant::now());
        let out = render_rows(&mut app, 80, 12).join("\n");
        assert!(
            out.contains("compacting conversation"),
            "the input row must say what is happening: {out}"
        );
        assert!(
            out.contains(SPINNER[app.spinner_frame % SPINNER.len()]),
            "the input row must carry the throbber: {out}"
        );
    }

    fn start_subagent(app: &mut App, run_id: &str, name: &str) {
        start_subagent_with_task(app, run_id, name, None);
    }

    fn start_subagent_with_task(app: &mut App, run_id: &str, name: &str, task: Option<&str>) {
        app.apply(StreamEvent::SubagentStart {
            run_id: run_id.into(),
            name: name.into(),
            task: task.map(str::to_string),
        });
    }

    /// The dispatch prompt rides on the event, so the panel can say what the
    /// fan-out is for. Only its first line: the panel is a pinned dock, and the
    /// brief's later lines are already in the transcript.
    #[test]
    fn subagent_panel_shows_the_dispatch_prompt() {
        let brief = "Build Flappy Space\nRocket dodging asteroids\n400x600 canvas";

        let mut solo = test_app();
        start_subagent_with_task(&mut solo, "r0", "space", Some(brief));
        let out = render_rows(&mut solo, 100, 24).join("\n");
        assert!(out.contains("Build Flappy Space"), "brief missing: {out}");
        assert!(!out.contains("400x600"), "only the summary line: {out}");

        let mut pair = test_app();
        start_subagent_with_task(&mut pair, "r0", "space", Some(brief));
        start_subagent_with_task(&mut pair, "r1", "fish", Some("Build Flappy Fish\nUnderwater"));
        let out = render_rows(&mut pair, 100, 24).join("\n");
        assert!(out.contains("Build Flappy Space"), "{out}");
        assert!(out.contains("Build Flappy Fish"), "{out}");
        assert!(!out.contains("Underwater"), "{out}");
    }

    /// A dispatch with no task (or an older event without the field) still
    /// renders -- it just has nothing to say about the brief.
    #[test]
    fn subagent_block_without_a_task_renders() {
        let mut app = test_app();
        start_subagent(&mut app, "r0", "alpha");
        let out = render_rows(&mut app, 100, 20).join("\n");
        assert!(out.contains("1 agent") && out.contains("alpha"), "{out}");
    }

    fn subagent_event(app: &mut App, run_id: &str, name: &str, event: StreamEvent) {
        app.apply(StreamEvent::Subagent {
            run_id: run_id.into(),
            name: name.into(),
            event: Box::new(event),
        });
    }

    /// Parallel agents collapse into one fixed-height block, each carrying the
    /// numbers that say whether it is progressing or about to blow its context.
    #[test]
    fn parallel_subagents_render_one_block_with_live_stats() {
        let mut app = test_app();
        for (i, name) in ["alpha", "beta"].iter().enumerate() {
            let run = format!("r{i}");
            start_subagent(&mut app, &run, name);
            subagent_event(&mut app, &run, name, StreamEvent::Step { index: 1, max: 8 });
            subagent_event(
                &mut app,
                &run,
                name,
                StreamEvent::TurnUsage {
                    usage: Usage {
                        // 12.8K of a 128K window -> 10.0%.
                        prompt_tokens: Some(12_800 + i as u64 * 12_800),
                        completion_tokens: Some(100),
                        total_tokens: Some(12_900),
                    },
                },
            );
            subagent_event(
                &mut app,
                &run,
                name,
                StreamEvent::ToolCall {
                    id: format!("c{i}"),
                    name: "read".into(),
                    args: json!({ "path": format!("{name}.rs") }),
                },
            );
        }

        let rows = render_rows(&mut app, 100, 24);
        let out = rows.join("\n");
        assert!(out.contains("2 agents"), "no consolidated header: {out}");
        for (name, pct) in [("alpha", "10.0%"), ("beta", "20.0%")] {
            assert!(out.contains(name), "missing {name}: {out}");
            assert!(out.contains(pct), "missing context share {pct}: {out}");
        }
        assert!(out.contains("1t · 1r"), "missing compact call/request counts: {out}");
        // Two agents -> one activity line each, so the block stays scannable.
        assert_eq!(
            rows.iter().filter(|r| r.contains("alpha.rs") || r.contains("beta.rs")).count(),
            2,
            "expected exactly one activity line per agent: {out}"
        );
    }

    /// The fan-out is pinned above the input, not woven into the transcript: it
    /// describes what is running *now*, so it must sit below prose the parent
    /// emitted earlier, no matter when the dispatch happened.
    #[test]
    fn fan_out_is_pinned_below_the_transcript() {
        let mut app = test_app();
        start_subagent(&mut app, "r0", "alpha");
        app.apply(StreamEvent::Token {
            text: "parent keeps talking".into(),
        });
        app.flush_assistant();

        let rows = render_rows(&mut app, 100, 24);
        let prose = rows
            .iter()
            .position(|r| r.contains("parent keeps talking"))
            .expect("prose row");
        let panel = rows.iter().position(|r| r.contains("alpha")).expect("panel row");
        let input = rows
            .iter()
            .position(|r| r.contains("Type here to chat with agent"))
            .expect("input");
        assert!(prose < panel, "the panel is docked, not inline: {rows:?}");
        assert!(panel < input, "and it sits above the input: {rows:?}");
        assert!(
            rows.iter().any(|r| r.contains("2 agents") || r.contains("1 agent")),
            "the fan-out is counted: {rows:?}"
        );
    }

    /// Every dispatch joins the one panel; nothing is committed to the chat.
    #[test]
    fn parallel_dispatches_share_one_pinned_panel() {
        let mut app = test_app();
        start_subagent(&mut app, "r0", "alpha");
        let before = app.transcript.len();
        start_subagent(&mut app, "r1", "beta");
        assert_eq!(app.transcript.len(), before, "no transcript rows committed");
        let rows = render_rows(&mut app, 100, 24);
        assert_eq!(
            rows.iter().filter(|r| r.contains("agents")).count(),
            1,
            "one panel head only: {rows:?}"
        );
        assert!(rows.iter().any(|r| r.contains("2 agents")), "{rows:?}");
    }

    /// The panel is live state: when the last child ends it vanishes, leaving
    /// the committed summary row as the only trace in the conversation.
    #[test]
    fn panel_clears_when_the_last_child_ends() {
        let mut app = test_app();
        start_subagent(&mut app, "r0", "alpha");
        app.apply(StreamEvent::SubagentEnd {
            run_id: "r0".into(),
            name: "alpha".into(),
        });
        assert!(app.subagents.is_empty(), "live panel closed");
        let rows = render_rows(&mut app, 100, 24);
        assert!(
            !rows.iter().any(|r| r.contains("1 agent")),
            "panel must be gone: {rows:?}"
        );
        assert!(
            rows.iter().any(|r| r.contains("subagent alpha finished")),
            "summary row missing: {rows:?}"
        );
    }

    /// `await_subagent` on a child that already has a live panel used to print
    /// a second "Awaiting subagent: X" row directly under the block that was
    /// showing that child's progress. Only an orphaned wait gets a row.
    #[test]
    fn awaiting_row_is_suppressed_while_the_child_has_a_live_panel() {
        let mut app = test_app();
        start_subagent(&mut app, "r0", "alpha");
        app.apply(StreamEvent::ToolCall {
            id: "a1".into(),
            name: "await_subagent".into(),
            args: json!({ "run_id": "r0" }),
        });
        assert_eq!(app.awaiting.len(), 1, "wait state is still tracked");
        let rows = render_rows(&mut app, 100, 24);
        assert!(
            !rows.iter().any(|r| r.contains("Awaiting subagent")),
            "live panel already reports this child: {rows:?}"
        );

        // The child ends while its result is still in flight: with no panel
        // left to report it, the wait gets its own row again.
        app.subagents.clear();
        let rows = render_rows(&mut app, 100, 24);
        assert!(
            rows.iter().any(|r| r.contains("Awaiting subagent")),
            "orphaned wait must stay visible: {rows:?}"
        );
    }

    /// Regression: a child streaming a large `write` completes no tool call
    /// for the whole request, so the panel used to sit frozen on
    /// "0 tools / starting…" for exactly the stretch the user most wants
    /// feedback on. Its in-flight call must report progress like the parent's.
    #[test]
    fn subagent_reports_its_in_flight_call() {
        let mut app = test_app();
        start_subagent(&mut app, "r0", "flappy-2d");
        subagent_event(&mut app, "r0", "flappy-2d", StreamEvent::Step { index: 1, max: 8 });

        // The child announces a write and starts streaming its arguments --
        // no ToolCall yet, which is the whole problem.
        subagent_event(
            &mut app,
            "r0",
            "flappy-2d",
            StreamEvent::ToolCallStarted { id: "c1".into(), name: "write".into() },
        );
        let out = render_rows(&mut app, 100, 20).join("\n");
        assert!(!out.contains("starting…"), "should have moved off the placeholder: {out}");
        assert!(out.contains("write"), "should name the tool being assembled: {out}");

        // Once the path arrives it names the destination, still mid-stream.
        for delta in [r#"{"path":"flappy"#, r#"-2d.html","content":"<!doct"#] {
            subagent_event(
                &mut app,
                "r0",
                "flappy-2d",
                StreamEvent::ToolCallArgsDelta { id: "c1".into(), delta: delta.into() },
            );
        }
        let out = render_rows(&mut app, 100, 20).join("\n");
        assert!(out.contains("flappy-2d.html"), "destination should surface: {out}");
        assert!(out.contains("0t · "), "still no completed call: {out}");

        // The completed call supersedes the in-progress row.
        subagent_event(
            &mut app,
            "r0",
            "flappy-2d",
            StreamEvent::ToolCall {
                id: "c1".into(),
                name: "write".into(),
                args: json!({ "path": "flappy-2d.html" }),
            },
        );
        let out = render_rows(&mut app, 100, 20).join("\n");
        assert!(out.contains("1t · "), "completed call should count: {out}");
        assert!(
            app.subagents[0].active.is_none(),
            "in-flight view should clear once the call lands"
        );
    }

    /// Before a child reports usage there is no honest percentage to show, and
    /// "0.0%" would read as a stalled agent.
    #[test]
    fn subagent_hides_context_share_until_it_reports() {
        let mut app = test_app();
        start_subagent(&mut app, "r1", "alpha");
        let out = render_rows(&mut app, 100, 20).join("\n");
        assert!(out.contains("1 agent"), "{out}");
        assert!(out.contains("starting…"), "{out}");
        assert!(!out.contains('%'), "no share before the first response: {out}");
    }

    /// The running placeholder is the row a user stares at during a long turn.
    /// A static "working…" reads as a hung UI, so it animates on the same
    /// cadence as every other throbber.
    #[test]
    fn working_placeholder_animates() {
        let mut app = test_app();
        app.submit_user("go".into());
        assert_eq!(app.status, Status::Running);

        let frame_of = |app: &mut App| {
            render_rows(app, 80, 12)
                .into_iter()
                .find(|r| r.contains("working…"))
                .expect("running placeholder present")
        };

        app.spinner_frame = 0;
        let first = frame_of(&mut app);
        assert!(first.contains(SPINNER[0]), "expected frame 0 glyph: {first:?}");

        app.spinner_frame = 3;
        let later = frame_of(&mut app);
        assert!(later.contains(SPINNER[3]), "expected frame 3 glyph: {later:?}");
        assert_ne!(first, later, "row must change as the frame advances");

        // The wording itself does not move, only the glyph.
        assert!(later.contains("(Esc to cancel, type to queue next message)"), "{later:?}");
    }

    /// A queued-message row is still a running row, so it animates too.
    #[test]
    fn queued_placeholder_animates() {
        let mut app = test_app();
        app.submit_user("go".into());
        app.message_queue.push_back("next".into());
        app.spinner_frame = 5;
        let row = render_rows(&mut app, 80, 12)
            .into_iter()
            .find(|r| r.contains("Queued"))
            .expect("queued row present");
        assert!(row.contains(SPINNER[5]), "expected frame 5 glyph: {row:?}");
    }

    #[test]
    fn compact_tokens_keeps_a_stable_width() {
        assert_eq!(compact_tokens(0), "0");
        assert_eq!(compact_tokens(840), "840");
        assert_eq!(compact_tokens(1_100), "1.1K");
        assert_eq!(compact_tokens(43_000), "43K");
        assert_eq!(compact_tokens(1_500_000), "1.5M");
    }

    /// The turn receipt reports what the whole turn cost, which for a
    /// tool-using turn is more than the final request's usage.
    #[test]
    fn turn_stats_sum_output_across_requests() {
        let mut app = test_app();
        app.submit_user("go".into());
        for _ in 0..3 {
            app.apply(StreamEvent::TurnUsage {
                usage: Usage {
                    prompt_tokens: Some(40_000),
                    completion_tokens: Some(500),
                    total_tokens: Some(40_500),
                },
            });
        }
        assert_eq!(app.turn_output_tokens, 1_500);
        assert_eq!(app.turn_prompt_tokens, 40_000);

        app.on_done("stop".into(), None);
        let out: String = app.transcript.iter().map(row_text).collect::<Vec<_>>().join("\n");
        assert!(out.contains("40K"), "input tokens missing: {out}");
        assert!(out.contains("1.5K"), "summed output missing: {out}");
        assert!(out.contains("/s"), "rate missing: {out}");

        // A new turn starts the count over rather than accumulating forever.
        app.submit_user("again".into());
        assert_eq!(app.turn_output_tokens, 0);
    }

    fn todo_item(content: &str) -> crate::core::agent::todo::TodoItem {
        crate::core::agent::todo::TodoItem {
            content: content.to_string(),
            status: crate::core::agent::todo::TodoStatus::Pending,
        }
    }

    #[tokio::test]
    async fn finished_todos_clear_after_a_grace_period() {
        let mut app = test_app();
        app.todos
            .init(vec![crate::core::agent::todo::TodoPhase {
                name: String::new(),
                tasks: vec![
                    todo_item("write the parser"),
                ],
            }])
            .unwrap();
        assert!(!app.todos.is_empty());

        // Open work is never aged away, however many turns go by.
        for _ in 0..5 {
            age_closed_todos(&mut app).await;
        }
        assert!(!app.todos.is_empty(), "open work must survive");

        app.todos
            .done(crate::core::agent::todo::Target::All)
            .unwrap();
        assert!(app.todos.open_summary().is_none(), "all work closed out");

        // Survives every turn up to the cutoff.
        for i in 1..=super::TODO_KEEP_CLOSED_TURNS {
            age_closed_todos(&mut app).await;
            assert!(!app.todos.is_empty(), "cleared too eagerly at turn {i}");
        }

        // One turn past the grace period and it goes.
        age_closed_todos(&mut app).await;
        assert!(app.todos.is_empty(), "finished list should have been dropped");
    }

    /// Reopening work resets the grace period, so a list in active use is never
    /// aged out from under the model.
    #[tokio::test]
    async fn reopened_todos_reset_the_grace_period() {
        let mut app = test_app();
        app.todos
            .init(vec![crate::core::agent::todo::TodoPhase {
                name: String::new(),
                tasks: vec![todo_item("a")],
            }])
            .unwrap();
        app.todos
            .done(crate::core::agent::todo::Target::All)
            .unwrap();

        age_closed_todos(&mut app).await;
        assert_eq!(app.turns_since_todos_closed, 1);

        app.todos
            .init(vec![crate::core::agent::todo::TodoPhase {
                name: String::new(),
                tasks: vec![todo_item("b")],
            }])
            .unwrap();
        age_closed_todos(&mut app).await;
        assert_eq!(app.turns_since_todos_closed, 0, "counter must reset");
        assert!(!app.todos.is_empty(), "new work must not be aged out");
    }

    /// An empty list never accumulates grace, so the counter can't drift.
    #[tokio::test]
    async fn empty_todos_do_not_accumulate_grace() {
        let mut app = test_app();
        for _ in 0..5 {
            age_closed_todos(&mut app).await;
        }
        assert_eq!(app.turns_since_todos_closed, 0);
    }

    /// Turn-granular aging: a single run's model roundtrips (`Step` events)
    /// each count toward the grace period, so a finished plan does not outlive
    /// the long tool-call run that produced it.
    #[tokio::test]
    async fn closed_todos_age_per_turn_not_per_run() {
        let mut app = test_app();
        app.todos
            .init(vec![crate::core::agent::todo::TodoPhase {
                name: String::new(),
                tasks: vec![todo_item("a")],
            }])
            .unwrap();
        app.todos
            .done(crate::core::agent::todo::Target::All)
            .unwrap();

        // Three roundtrips inside the run that finished the list: the counter
        // climbs per turn, and once it passes the cutoff the list drops even
        // though no new run kicked off.
        for _ in 1..=super::TODO_KEEP_CLOSED_TURNS {
            app.apply(StreamEvent::Step { index: 1, max: 8 });
            age_closed_todos(&mut app).await;
        }
        assert!(!app.todos.is_empty(), "must survive the full grace period");

        app.apply(StreamEvent::Step { index: 1, max: 8 });
        age_closed_todos(&mut app).await;
        assert!(app.todos.is_empty(), "dropped mid-run after the grace period");
    }

    #[test]
    fn compact_is_a_registered_command() {
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "/compact"));
    }

    #[test]
    fn partial_json_field_reads_a_truncated_value() {
        // Closed value.
        let done = r#"{"path":"a.html","content":"<h1>hi</h1>"}"#;
        assert_eq!(partial_json_field(done, "path"), Some("a.html"));
        assert_eq!(partial_json_field(done, "content"), Some("<h1>hi</h1>"));

        // Cut mid-value: everything that arrived is the value.
        let cut = r#"{"path":"a.html","content":"<!doctype html>\n<html"#;
        assert_eq!(partial_json_field(cut, "content"), Some(r#"<!doctype html>\n<html"#));

        // Cut before the field even opens.
        assert_eq!(partial_json_field(r#"{"path":"a.htm"#, "content"), None);

        // An escaped quote inside the value does not end it.
        let escaped = r#"{"content":"say \"hi\" now"#;
        assert_eq!(partial_json_field(escaped, "content"), Some(r#"say \"hi\" now"#));

        // The field name occurring inside an earlier value is not the field.
        let decoy = r#"{"path":"my\"content\".txt","content":"real"#;
        assert_eq!(partial_json_field(decoy, "content"), Some("real"));
    }

    #[test]
    fn unescape_partial_json_string_survives_a_cut_escape() {
        assert_eq!(unescape_partial_json_string(r#"a\nb"#), "a\nb");
        // Dangling backslash: the escape's payload hasn't arrived.
        assert_eq!(unescape_partial_json_string(r#"a\nb\"#), "a\nb");
        // An even run is a real escaped backslash, keep it.
        assert_eq!(unescape_partial_json_string(r#"a\\"#), r"a\");
        // Partial \u escape.
        assert_eq!(unescape_partial_json_string(r#"hi \u26"#), "hi ");
        assert_eq!(unescape_partial_json_string(r#"hi ☃"#), "hi ☃");
    }

    /// A streaming `write` previews the file as it arrives instead of sitting
    /// on a featureless "Preparing write" spinner.
    #[test]
    fn streaming_write_previews_the_body() {
        let body: String = (1..=20).map(|n| format!("line {n}\\n")).collect();
        let mut call = super::StartingCall::new("c1".into(), "write".into());
        call.args = format!(r#"{{"path":"game.html","content":"{body}"#);
        let text: Vec<String> = starting_call_lines(&mut call, "⠋").iter().map(line_text).collect();
        let joined = text.join("\n");

        assert!(joined.contains("Write: game.html"), "no destination: {joined}");
        assert!(joined.contains("… (streaming)"), "no streaming marker: {joined}");
        // 20 body lines plus the empty one after the final \n = 21; a 12-line
        // window leaves 9 behind.
        assert!(joined.contains("… (9 earlier lines)"), "wrong elision: {joined}");
        assert!(!joined.contains("line 9\n"), "line 9 is outside the window: {joined}");
        assert!(joined.contains("line 20"), "tail should include the newest line: {joined}");
        // Numbers are absolute, not window-relative, and right-aligned.
        assert!(text.iter().any(|l| l.contains(" 10 line 10")), "gutter: {text:?}");
        assert!(text.iter().any(|l| l.contains(" 20 line 20")), "gutter: {text:?}");
    }

    /// The preview is derived from an append-only buffer, so an unchanged
    /// length means unchanged content -- the 50ms render tick must not pay for
    /// a full rescan of a file-sized argument on every frame.
    #[test]
    fn preview_is_only_rederived_when_new_bytes_arrive() {
        let mut call = super::StartingCall::new("c1".into(), "write".into());
        call.args = r#"{"path":"a.html","content":"one\ntwo"#.into();
        call.refresh_preview();
        let first = call.preview_at;
        assert_eq!(tail_text(&call), Some(vec!["one".to_string(), "two".to_string()]));

        // Same bytes: the cache holds and nothing is recomputed.
        call.preview.tail = Some(vec![vec![ratatui::text::Span::raw("sentinel")]]);
        call.refresh_preview();
        assert_eq!(tail_text(&call), Some(vec!["sentinel".to_string()]));
        assert_eq!(call.preview_at, first);

        // New bytes invalidate it.
        call.args.push_str(r#"\nthree"#);
        call.refresh_preview();
        assert_eq!(
            tail_text(&call),
            Some(vec!["one".to_string(), "two".to_string(), "three".to_string()])
        );
    }

    /// Before `content` opens there is nothing to preview, but the path is
    /// already worth showing.
    #[test]
    fn streaming_write_shows_the_path_before_the_body() {
        let mut call = super::StartingCall::new("c1".into(), "write".into());
        call.args = r#"{"path":"game.html","cont"#.into();
        let text: Vec<String> = starting_call_lines(&mut call, "⠋").iter().map(line_text).collect();
        assert_eq!(text.len(), 1);
        assert!(text[0].contains("Preparing write: game.html"), "got {text:?}");
    }

    /// Tools other than `write` keep the plain throbber -- there is no file
    /// body to stream.
    #[test]
    fn other_tools_keep_the_plain_throbber() {
        let mut call = super::StartingCall::new("c1".into(), "bash".into());
        call.args = r#"{"command":"ls -la"#.into();
        let text: Vec<String> = starting_call_lines(&mut call, "⠋").iter().map(line_text).collect();
        assert_eq!(text.len(), 1);
        assert!(text[0].contains("Preparing bash"), "got {text:?}");
    }

    /// A path-carrying tool that isn't `write` must be named as itself.
    #[test]
    fn starting_throbber_names_the_actual_tool() {
        for name in ["read", "edit", "list"] {
            let mut call = super::StartingCall::new("c1".into(), name.into());
            call.args = r#"{"path":"src/main.rs"#.into();
            let text: Vec<String> = starting_call_lines(&mut call, "⠋")
                .iter()
                .map(line_text)
                .collect();
            assert_eq!(text.len(), 1);
            assert!(
                text[0].contains(&format!("Preparing {name}: src/main.rs")),
                "got {text:?}"
            );
            assert!(!text[0].contains("write"), "wrong tool named: {text:?}");
        }
    }

    #[test]
    fn stream_error_clears_the_preparing_throbber() {
        let mut app = test_app();
        app.submit_user("do a thing".into());
        app.apply(StreamEvent::ToolCallStarted {
            id: "c1".into(),
            name: "write".into(),
        });
        assert!(!app.starting.is_empty());
        app.on_error("stream".into(), "connection reset".into());
        assert!(
            app.starting.is_empty(),
            "an aborted run leaves a throbber naming a tool that never ran"
        );
    }

    /// A run can end normally while a tool call was still streaming its
    /// arguments: the upstream stops mid-call and the assembled completion
    /// carries no `tool_calls`, so no `ToolCall` ever supersedes the throbber
    /// and no `ToolResult` ever resolves the pending row.
    #[test]
    fn normal_done_clears_an_unfinished_tool_call() {
        let mut app = test_app();
        app.submit_user("do a thing".into());
        app.apply(StreamEvent::ToolCallStarted {
            id: "c1".into(),
            name: "write".into(),
        });
        app.apply(StreamEvent::ToolCall {
            id: "c2".into(),
            name: "write".into(),
            args: serde_json::json!({ "path": "a.txt", "content": "x" }),
        });
        assert_eq!(app.starting.len(), 1);
        assert_eq!(app.pending_rows.len(), 1);

        app.on_done("stop".into(), None);

        assert!(
            app.starting.is_empty(),
            "a finished run leaves a throbber naming a tool that never ran"
        );
        assert!(
            app.pending_rows.is_empty(),
            "a finished run leaves a call row spinning for a result that never comes"
        );
    }

    /// An `await_subagent` whose result never lands is the same orphan: the
    /// child cannot outlive the run whose stream carried its events.
    #[test]
    fn terminal_events_clear_an_unresolved_await() {
        for terminal in [0, 1] {
            let mut app = test_app();
            app.submit_user("do a thing".into());
            app.awaiting
                .push(("c1".into(), "run-1".into(), "explorer".into()));
            if terminal == 0 {
                app.on_done("stop".into(), None);
            } else {
                app.on_error("stream".into(), "connection reset".into());
            }
            assert!(
                app.awaiting.is_empty(),
                "an awaiting throbber outlived the run that could resolve it"
            );
        }
    }

    /// The deltas have to actually reach the call they belong to.
    #[test]
    fn args_deltas_accumulate_onto_the_starting_call() {
        let mut app = test_app();
        app.apply(StreamEvent::ToolCallStarted {
            id: "c1".into(),
            name: "write".into(),
        });
        for delta in [r#"{"path":"a"#, r#".html","content":"he"#, "llo"] {
            app.apply(StreamEvent::ToolCallArgsDelta {
                id: "c1".into(),
                delta: delta.into(),
            });
        }
        let call = &mut app.starting[0];
        call.refresh_preview();
        assert_eq!(call.preview.path.as_deref(), Some("a.html"));
        assert_eq!(tail_text(call), Some(vec!["hello".to_string()]));

        // A delta for an unknown call is dropped, not panicked on.
        app.apply(StreamEvent::ToolCallArgsDelta {
            id: "nope".into(),
            delta: "x".into(),
        });
        assert_eq!(app.starting.len(), 1);
    }

    /// `/help` is the home for keybindings now that the footer no longer
    /// carries them, so every advertised binding has to reach the listing.
    #[tokio::test]
    async fn help_lists_every_keybinding() {
        let mut app = test_app();
        run_command(&mut app, "help").await;
        let text: String = app.transcript.iter().map(row_text).collect();
        for (keys, description) in KEY_BINDINGS {
            assert!(text.contains(keys), "missing keys {keys:?} in: {text}");
            assert!(
                text.contains(description),
                "missing description {description:?} in: {text}"
            );
        }
    }

    /// The idle footer carries no cheat sheet at all -- not on a fresh
    /// session, not while typing the first message, not after it. Discovery
    /// lives in the opening transcript note and `/help`.
    #[test]
    fn idle_footer_never_shows_a_cheat_sheet() {
        let mut app = test_app();
        type Setup<'a> = (&'a str, &'a dyn Fn(&mut App));
        let states: [Setup; 3] = [
            ("fresh", &|_: &mut App| {}),
            ("typing", &|a: &mut App| {
                for c in "hel".chars() {
                    a.input_insert(c);
                }
            }),
            ("used", &|a: &mut App| {
                a.history.push(json!({ "role": "user", "content": "hi" }));
            }),
        ];
        for (label, setup) in states {
            setup(&mut app);
            let rows = render_rows(&mut app, 80, 12);
            // The dock is the last row: location on the left, hints on the
            // right. Idle contributes no hints, so only the location shows.
            let dock = rows.last().expect("non-empty render").trim();
            assert!(
                dock.starts_with("📂") && !dock.contains("Ctrl-"),
                "{label}: idle dock should carry no cheat sheet, got {dock:?}"
            );
        }
    }

    /// A transient detail (`stop_reason=...`, `cancelled`) still owns the
    /// footer row, and starts at the same column the hints used to.
    #[test]
    fn idle_footer_still_shows_transient_detail() {
        let mut app = test_app();
        app.detail = "stop_reason=stop".into();
        let rows = render_rows(&mut app, 80, 12);
        let dock = rows.last().unwrap();
        assert!(dock.trim_end().ends_with("stop_reason=stop"), "{dock:?}");
        assert!(dock.contains("/tmp/repo"), "location keeps its place: {dock:?}");
    }

    /// Working dir + branch share the single dock row below the input with the
    /// key hints -- not split across the top and bottom of the screen, and not
    /// spending a row of their own.
    #[test]
    fn path_shares_the_dock_row_with_the_hints() {
        let mut app = test_app();
        app.git_branch = Some("goal/general-agent".into());
        app.status = Status::Running;
        let rows = render_rows(&mut app, 100, 12);
        let dock = rows.last().expect("non-empty render");
        assert!(
            dock.contains("/tmp/repo") && dock.contains("goal/general-agent"),
            "expected dir+branch on the dock row, got {dock:?}"
        );
        assert!(
            dock.contains("cancel") && dock.contains("scroll"),
            "hints share the same row: {dock:?}"
        );
        // Nothing but the header above the transcript any more.
        assert!(
            !rows[1].contains("/tmp/repo"),
            "path line should no longer render at the top: {:?}",
            rows[1]
        );
    }

    #[test]
    fn tilde_path_abbreviates_only_the_home_prefix() {
        let home = std::path::PathBuf::from(std::env::var_os("HOME").expect("HOME set in tests"));
        assert_eq!(tilde_path(&home), "~");
        assert_eq!(tilde_path(&home.join("code/jan")), "~/code/jan");
        // A path that merely starts with the same characters is not a child.
        assert_eq!(
            tilde_path(std::path::Path::new("/var/tmp/x")),
            "/var/tmp/x"
        );
    }

    /// A running turn still needs its transient hints -- only the idle cheat
    /// sheet was removed.
    #[test]
    fn running_footer_keeps_its_hints() {
        let mut app = test_app();
        app.history.push(json!({ "role": "user", "content": "hi" }));
        app.status = Status::Running;
        let rows = render_rows(&mut app, 80, 12);
        assert!(
            rows.iter().any(|r| r.contains("cancel")),
            "running footer should still offer cancel: {rows:?}"
        );
    }

    #[test]
    fn goal_is_a_registered_command() {
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "/goal"));
    }

    #[test]
    fn plan_is_a_registered_command() {
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "/plan"));
    }

    #[tokio::test]
    async fn goal_set_stores_condition_and_starts_a_turn() {
        let mut app = test_app();
        run_command(&mut app, "goal all tests in test/auth pass").await;
        let goal = app.goal.as_ref().expect("goal should be set");
        assert_eq!(goal.condition, "all tests in test/auth pass");
        assert!(goal.is_active());
        // Setting a goal starts the first turn with the condition as the prompt.
        assert!(app.want_start, "a turn should be queued");
        assert_eq!(app.status, Status::Running);
        let last = app.history.last().expect("history has the condition prompt");
        assert_eq!(
            last.get("content").and_then(|c| c.as_str()),
            Some("all tests in test/auth pass")
        );
    }

    #[tokio::test]
    async fn goal_clear_removes_active_goal() {
        let mut app = test_app();
        app.goal = Some(crate::core::agent::goal::GoalState::new("x"));
        run_command(&mut app, "goal clear").await;
        assert!(app.goal.is_none());
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("goal cleared"), "missing note: {text}");
    }

    #[tokio::test]
    async fn goal_clear_with_no_goal_notes() {
        let mut app = test_app();
        run_command(&mut app, "goal clear").await;
        assert!(app.goal.is_none());
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("no active goal"), "missing note: {text}");
    }

    #[tokio::test]
    async fn goal_status_reports_active_goal() {
        let mut app = test_app();
        let mut goal = crate::core::agent::goal::GoalState::new("make git status clean");
        goal.turns = 3;
        goal.last_reason = "two files still modified".into();
        app.goal = Some(goal);
        run_command(&mut app, "goal").await;
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("make git status clean"), "condition: {text}");
        assert!(text.contains("turns: 3"), "turn count: {text}");
        assert!(text.contains("two files still modified"), "reason: {text}");
    }

    #[tokio::test]
    async fn goal_status_with_no_goal_notes() {
        let mut app = test_app();
        run_command(&mut app, "goal").await;
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("no active goal"), "missing note: {text}");
    }

    #[test]
    fn on_done_counts_turn_and_queues_eval_under_active_goal() {
        let mut app = test_app();
        app.goal = Some(crate::core::agent::goal::GoalState::new("cond"));
        app.status = Status::Running;
        app.apply(StreamEvent::Token {
            text: "did some work".into(),
        });
        app.on_done("stop".into(), None);
        assert_eq!(app.goal.as_ref().unwrap().turns, 1);
        assert!(app.goal_eval_pending, "evaluation should be queued");
    }

    #[test]
    fn on_done_without_goal_does_not_queue_eval() {
        let mut app = test_app();
        app.status = Status::Running;
        app.apply(StreamEvent::Token { text: "done".into() });
        app.on_done("stop".into(), None);
        assert!(!app.goal_eval_pending);
    }

    #[test]
    fn on_done_early_finish_does_not_queue_goal_eval() {
        // An early/truncated finish under a goal counts the turn but leaves
        // control with the user rather than auto-continuing.
        let mut app = test_app();
        app.goal = Some(crate::core::agent::goal::GoalState::new("cond"));
        app.status = Status::Running;
        app.apply(StreamEvent::Token { text: "partial".into() });
        app.on_done("length".into(), None);
        assert_eq!(app.goal.as_ref().unwrap().turns, 1);
        assert!(!app.goal_eval_pending, "early finish should not auto-continue");
    }

    #[test]
    fn cancel_run_stops_goal_eval_but_keeps_goal() {
        let mut app = test_app();
        app.goal = Some(crate::core::agent::goal::GoalState::new("cond"));
        app.goal_eval_pending = true;
        app.status = Status::Running;
        app.cancel_run();
        assert!(!app.goal_eval_pending, "cancel stops the loop");
        assert!(app.goal.is_some(), "the goal itself is kept for inspection");
    }

    #[test]
    fn goal_persists_and_restores_via_thread_metadata() {
        let mut app = test_app();
        let mut goal = crate::core::agent::goal::GoalState::new("tests pass");
        goal.turns = 2;
        goal.last_reason = "one failing".into();
        app.goal = Some(goal);
        let meta = app.thread_metadata().expect("metadata present with a goal");
        assert!(meta.get("goal").is_some());

        let mut restored = test_app();
        restore_goal(&mut restored, Some(&meta));
        let g = restored.goal.clone().expect("goal restored");
        assert_eq!(g.condition, "tests pass");
        assert_eq!(g.turns, 2);
        assert_eq!(g.last_reason, "one failing");
        assert!(g.is_active());
    }

    fn plan_review_request() -> crate::core::agent::interaction::AskRequest {
        crate::core::agent::interaction::AskRequest::parse(&json!({
            "questions": [{
                "id": crate::core::agent::plan::PLAN_REVIEW_QUESTION_ID,
                "question": "Ready to execute?",
                "options": [
                    {"label": crate::core::agent::plan::EXECUTE_PLAN_LABEL},
                    {"label": crate::core::agent::plan::KEEP_PLANNING_LABEL},
                    {"label": crate::core::agent::plan::EXIT_PLAN_LABEL},
                ]
            }]
        }))
        .unwrap()
    }

    fn staged_todos() -> crate::core::agent::todo::TodoList {
        use crate::core::agent::todo::{TodoItem, TodoList, TodoPhase, TodoStatus};
        TodoList {
            phases: vec![TodoPhase {
                name: "Plan".into(),
                tasks: vec![TodoItem {
                    content: "do the thing".into(),
                    status: TodoStatus::Pending,
                }],
            }],
        }
    }

    #[tokio::test]
    async fn plan_command_enters_and_exits_while_idle() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        run_command(&mut app, "plan").await;
        assert_eq!(app.run_mode, RunMode::Plan);
        run_command(&mut app, "plan exit").await;
        assert_eq!(app.run_mode, RunMode::Normal);
    }

    #[tokio::test]
    async fn plan_command_rejected_while_running() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.status = Status::Running;
        run_command(&mut app, "plan").await;
        assert_eq!(app.run_mode, RunMode::Normal, "must not switch mid-turn");
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("only settable while idle"), "note: {text}");
    }

    #[tokio::test]
    async fn plan_command_with_text_enters_plan_and_submits_it() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        run_command(&mut app, "plan make a html cat slide. use 3 subagents to research").await;
        assert_eq!(app.run_mode, RunMode::Plan, "text arg must also enter plan mode");
        assert_eq!(app.status, Status::Running, "seeded text must start a turn");
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(
            text.contains("make a html cat slide"),
            "seeded text must render as the user's message: {text}"
        );
    }

    #[tokio::test]
    async fn plan_command_with_text_while_already_planning_just_submits() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        run_command(&mut app, "plan investigate the auth module").await;
        assert_eq!(app.run_mode, RunMode::Plan);
        assert_eq!(app.status, Status::Running);
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("investigate the auth module"), "{text}");
    }

    #[test]
    fn run_mode_persists_and_restores_via_thread_metadata() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        let meta = app.thread_metadata().expect("metadata present in plan mode");
        assert_eq!(meta.get("run_mode").and_then(|v| v.as_str()), Some("plan"));

        let mut restored = test_app();
        restore_run_mode(&mut restored, Some(&meta));
        assert_eq!(restored.run_mode, RunMode::Plan);
        // Resume must never auto-execute a saved plan.
        assert_eq!(restored.status, Status::Idle);
        assert!(restored.message_queue.is_empty());
    }

    #[test]
    fn normal_mode_omits_run_mode_from_metadata() {
        // Old threads / normal sessions keep clean, backward-compatible metadata.
        let app = test_app();
        assert!(app.thread_metadata().is_none());
    }

    // ── session todo: reminder policy, editor, persistence ─────────────────

    fn seed_open_todos(app: &mut App) {
        use crate::core::agent::todo::{TodoItem, TodoList, TodoPhase, TodoStatus};
        app.todos = TodoList {
            phases: vec![TodoPhase {
                name: "P".into(),
                tasks: vec![
                    TodoItem { content: "t1".into(), status: TodoStatus::InProgress },
                    TodoItem { content: "t2".into(), status: TodoStatus::Pending },
                ],
            }],
        };
    }

    /// A clean assistant turn that yielded a final answer (the reminder boundary).
    fn finish_clean_turn(app: &mut App) {
        finish_clean_turn_with_answer(app, "all set");
    }

    /// Like `finish_clean_turn`, but with a caller-chosen final answer text.
    fn finish_clean_turn_with_answer(app: &mut App, text: &str) {
        app.status = Status::Running;
        app.apply(StreamEvent::Token { text: text.into() });
        app.on_done("stop".into(), None);
    }

    fn last_history_content(app: &App) -> String {
        app.history
            .last()
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }

    #[test]
    fn todo_reminder_fires_once_at_clean_boundary_with_open_work() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        finish_clean_turn(&mut app);
        assert!(app.want_start, "open work must queue one continuation turn");
        let injected = last_history_content(&app);
        assert!(injected.contains("unfinished todos"), "got: {injected}");
        assert!(injected.contains("t1") && injected.contains("t2"));
        // The reminder is hidden: no user-authored `› ` row in the transcript.
        let rows: String = app.transcript.iter().map(row_text).collect();
        assert!(!rows.contains("› "), "reminder must not render as a user row");
    }

    #[test]
    fn todo_reminder_suppressed_when_agent_updated_todos_this_turn() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        // A successful todo mutation happened this turn: the agent is engaged.
        app.todo_call_this_turn = true;
        app.todo_ok_this_turn = true;
        finish_clean_turn(&mut app);
        assert!(!app.want_start, "an engaged turn must not be nagged");
    }

    #[test]
    fn todo_reminder_suppressed_in_plan_mode() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        seed_open_todos(&mut app);
        finish_clean_turn(&mut app);
        assert!(!app.want_start, "plan mode stages todos, never auto-executes");
    }

    #[test]
    fn todo_reminder_suppressed_when_no_answer() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        // A stop with no answer text is an abnormal finish, not a clean yield.
        app.status = Status::Running;
        app.on_done("stop".into(), None);
        assert!(!app.want_start);
    }

    #[tokio::test]
    async fn todo_reminder_suppressed_while_ask_pending() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, _rx) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: ask_request(false, false),
        });
        finish_clean_turn(&mut app);
        assert!(!app.want_start, "a pending ask blocks the reminder boundary");
    }

    #[test]
    fn todo_reminder_deduplicates_repeats() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        finish_clean_turn(&mut app);
        assert!(app.want_start);
        assert!(last_history_content(&app).contains("unfinished todos"));
        // The loop consumes want_start when it spawns the continuation run.
        app.want_start = false;
        // Model responds without changing todos and yields again: the same open
        // summary must not fire a second identical reminder.
        finish_clean_turn(&mut app);
        assert!(!app.want_start, "identical reminder must not repeat");
        assert!(
            !last_history_content(&app).contains("unfinished todos"),
            "last message should be the assistant answer, not a repeat reminder"
        );
    }

    #[test]
    fn todo_reminder_retries_after_failed_mutation() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        // A todo call this turn with no success snapshot = a failed mutation.
        app.todo_call_this_turn = true;
        app.todo_ok_this_turn = false;
        finish_clean_turn(&mut app);
        assert!(app.want_start, "a failed mutation queues one retry reminder");
        assert!(last_history_content(&app).contains("failed"));
    }

    #[test]
    fn awaiting_user_answer_detects_plain_questions_and_response_cues() {
        assert!(assistant_is_awaiting_user_answer("Which approach do you want?"));
        assert!(assistant_is_awaiting_user_answer("Q: proceed with the migration?"));
        assert!(assistant_is_awaiting_user_answer(
            "I've drafted both options.\nLet me know which one to build."
        ));
        assert!(assistant_is_awaiting_user_answer("Please confirm before I continue."));
        assert!(!assistant_is_awaiting_user_answer("Done, the tests pass."));
        assert!(!assistant_is_awaiting_user_answer(
            "This uses a well-known algorithm, is it fast enough already? It runs in O(n)."
        ));
        assert!(!assistant_is_awaiting_user_answer(""));
    }

    #[test]
    fn todo_reminder_suppressed_when_assistant_is_asking_a_question() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        finish_clean_turn_with_answer(&mut app, "Which database should I use, Postgres or MySQL?");
        assert!(
            !app.want_start,
            "a plain-text question must not be talked over by the todo reminder"
        );
    }

    #[test]
    fn todo_reminder_stops_after_max_reminders_even_as_summary_changes() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        for i in 0..3 {
            app.want_start = false;
            finish_clean_turn(&mut app);
            assert!(app.want_start, "reminder {i} of the 3-reminder budget must fire");
            app.reminder_awaiting_progress = false;
            // Vary the open-work summary each round so the same-summary dedup
            // alone could never explain a stop -- only the hard cap should.
            app.todos.phases[0].tasks[0].content = format!("t1-{i}");
        }
        app.want_start = false;
        finish_clean_turn(&mut app);
        assert!(!app.want_start, "the 4th reminder must be suppressed by the per-cycle cap");
    }

    #[test]
    fn todo_reminder_waits_for_progress_before_firing_again() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        finish_clean_turn(&mut app);
        assert!(app.want_start);
        app.want_start = false;
        // Change the summary so dedup alone wouldn't suppress a second fire,
        // but no tool result has landed since the reminder: still silent.
        app.todos.phases[0].tasks[0].content = "t1-changed".into();
        finish_clean_turn(&mut app);
        assert!(
            !app.want_start,
            "an unanswered reminder must not be followed by another before any progress"
        );
        // A tool result lands (any tool, not just todo) -- progress happened.
        app.apply(StreamEvent::ToolResult {
            id: "x".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        app.todos.phases[0].tasks[0].content = "t1-changed-again".into();
        finish_clean_turn(&mut app);
        assert!(app.want_start, "a reminder may fire again once progress happened");
    }

    fn todos_from(
        phases: Vec<(&str, Vec<(&str, crate::core::agent::todo::TodoStatus)>)>,
    ) -> crate::core::agent::todo::TodoList {
        use crate::core::agent::todo::{TodoItem, TodoList, TodoPhase};
        TodoList {
            phases: phases
                .into_iter()
                .map(|(name, tasks)| TodoPhase {
                    name: name.into(),
                    tasks: tasks
                        .into_iter()
                        .map(|(content, status)| TodoItem {
                            content: content.into(),
                            status,
                        })
                        .collect(),
                })
                .collect(),
        }
    }

    fn crossed_out(line: &ratatui::text::Line) -> bool {
        line.spans
            .iter()
            .any(|s| s.style.add_modifier.contains(Modifier::CROSSED_OUT))
    }

    #[test]
    fn single_phase_plan_column_lists_its_tasks() {
        use crate::core::agent::todo::TodoStatus::*;
        let todos = todos_from(vec![(
            "only",
            vec![
                ("alpha", InProgress),
                ("beta", Pending),
                ("gamma", Completed),
            ],
        )]);
        let lines: Vec<String> = super::todo_column(&todos, 60, 8)
            .iter()
            .map(line_text)
            .collect();
        // Head line: progress plus the hint that opens the editor. A single
        // phase has no idx/count, and its name is not worth a row.
        assert!(lines[0].contains("Todos · 1/3"), "{lines:?}");
        assert!(lines[0].contains("/todo"), "{lines:?}");
        assert!(!lines.iter().any(|l| l.contains("only")), "{lines:?}");
        assert!(lines[1].contains("☐ alpha"), "{lines:?}");
        assert!(lines[2].contains("☐ beta"), "{lines:?}");
        assert!(lines[3].contains("☑ gamma"), "{lines:?}");
    }

    /// The panel belongs to the input dock: it must render ABOVE the horizontal
    /// rule that separates the transcript from the input, not stranded between
    /// that rule and the prompt.
    #[test]
    fn status_panel_sits_above_the_input_separator_rule() {
        use crate::core::agent::todo::TodoStatus::*;
        let mut app = test_app();
        app.todos = todos_from(vec![("only", vec![("alpha", InProgress)])]);
        let rows = render_rows(&mut app, 60, 20);

        let todo_row = rows.iter().position(|r| r.contains("Todos")).expect("todos");
        let input_row = rows
            .iter()
            .position(|r| r.contains("Type here to chat with agent"))
            .expect("input");
        // The rule is the last full-width run of `─` before the input.
        let rule_row = rows[..input_row]
            .iter()
            .rposition(|r| r.trim_end().len() > 40 && r.trim_end().chars().all(|c| c == '─'))
            .expect("separator rule above the input");

        assert!(
            todo_row < rule_row,
            "the panel must be above the rule (todos={todo_row}, rule={rule_row}): {rows:#?}"
        );
        assert!(
            rule_row < input_row,
            "the rule must sit directly above the input: {rows:#?}"
        );
    }

    /// A session with nothing live keeps the original look: one rule directly
    /// above the input, with no leftover blank row where the panel would be.
    #[test]
    fn separator_rule_hugs_the_input_when_there_are_no_todos() {
        let mut app = test_app();
        assert!(app.todos.is_empty());
        let rows = render_rows(&mut app, 60, 20);

        let input_row = rows
            .iter()
            .position(|r| r.contains("Type here to chat with agent"))
            .expect("input");
        let rule_row = rows[..input_row]
            .iter()
            .rposition(|r| r.trim_end().len() > 40 && r.trim_end().chars().all(|c| c == '─'))
            .expect("separator rule above the input");
        assert_eq!(
            rule_row + 1,
            input_row,
            "no gap between rule and input: {rows:#?}"
        );
    }

    /// Only the phase in flight spends rows on its tasks; the head line already
    /// names it and counts the others.
    #[test]
    fn multi_phase_plan_column_expands_only_the_active_phase() {
        use crate::core::agent::todo::TodoStatus::*;
        let todos = todos_from(vec![
            ("backend", vec![("scaffold", Completed), ("routes", InProgress)]),
            ("frontend", vec![("ui", Pending), ("polish", Pending)]),
        ]);
        let lines: Vec<String> = super::todo_column(&todos, 60, 8)
            .iter()
            .map(line_text)
            .collect();
        assert!(
            lines[0].contains("Todos · 1/2") && lines[0].contains("backend 1/2"),
            "head names the phase and both progressions: {lines:?}"
        );
        assert!(lines.iter().any(|l| l.contains("routes")), "active tasks shown: {lines:?}");
        assert!(
            !lines.iter().any(|l| l.contains("ui") || l.contains("polish")),
            "inactive phase costs no rows: {lines:?}"
        );
    }

    #[test]
    fn completed_and_abandoned_todos_render_distinctly() {
        use crate::core::agent::todo::TodoStatus::*;
        let todos = todos_from(vec![(
            "only",
            vec![("shipped", Completed), ("dropped", Abandoned)],
        )]);
        let col = super::todo_column(&todos, 60, 8);
        let done = col.iter().find(|l| line_text(l).contains("shipped")).unwrap();
        let gone = col.iter().find(|l| line_text(l).contains("dropped")).unwrap();
        // Completed: checked glyph + strikethrough.
        assert!(line_text(done).contains("☑"), "{:?}", line_text(done));
        assert!(crossed_out(done), "completed is struck through");
        // Abandoned: distinct glyph, strikethrough, and a red accent.
        assert!(line_text(gone).contains("☒"), "{:?}", line_text(gone));
        assert!(crossed_out(gone), "abandoned is struck through");
        assert!(
            gone.spans.iter().any(|s| s.style.fg == Some(ratatui::style::Color::Red)),
            "abandoned carries a red accent to distinguish it from completed"
        );
    }

    /// Folded reasoning puts nothing on screen, so the badge has to carry the
    /// motion: a crest sweeps the word, one character per spinner frame, and
    /// wraps back to the start after a pause.
    #[test]
    fn thinking_badge_shimmers_across_its_frames() {
        use ratatui::style::{Modifier, Style};
        let palette = [
            Style::new().yellow().bold(),
            Style::new().yellow(),
            Style::new().yellow().dim(),
        ];
        let crest_at = |frame: usize| {
            let spans = super::shimmer_spans("thinking", palette, frame);
            // The text is intact and unmoved at every frame; only style changes.
            let text: String = spans.iter().map(|s| s.content.as_ref()).collect::<String>();
            assert_eq!(text, "thinking", "frame {frame} must not move the label");
            spans
                .iter()
                .position(|s| s.style.add_modifier.contains(Modifier::BOLD))
        };

        assert_eq!(crest_at(0), Some(0));
        assert_eq!(crest_at(3), Some(3), "the crest advances one char per frame");
        // Past the end of the word the crest is off-screen (the pause), then
        // the cycle restarts.
        assert_eq!(crest_at(8), None, "pause between sweeps");
        assert_eq!(crest_at(8 + super::SHIMMER_PAUSE), Some(0), "sweep restarts");
    }

    /// The animation is scoped to the state that needs it: a folded, streaming
    /// reasoning block. Everything else keeps its flat badge.
    #[test]
    fn only_folded_live_reasoning_animates_the_badge() {
        let mut app = test_app();
        assert!(!app.is_thinking(), "idle");
        app.submit_user("hi".into());
        assert!(!app.is_thinking(), "running, but nothing thinking yet");

        app.apply(StreamEvent::Token {
            text: "<think>pondering".into(),
        });
        assert!(app.is_thinking(), "open reasoning block");
        let rows = render_rows(&mut app, 60, 12);
        assert!(rows[0].contains("[thinking]"), "label intact: {:?}", rows[0]);

        app.apply(StreamEvent::Token {
            text: "</think>done".into(),
        });
        assert!(!app.is_thinking(), "the block closed");

        // With reasoning shown inline the transcript itself is moving, so the
        // badge stays flat.
        app.show_reasoning = true;
        app.apply(StreamEvent::Token {
            text: "<think>more".into(),
        });
        assert!(!app.is_thinking(), "unfolded reasoning needs no badge motion");
    }

    /// Folded reasoning summaries and tool rows are one run of activity: a turn
    /// that alternates them used to spend a blank line on every switch.
    #[test]
    fn reasoning_and_tool_rows_share_one_band() {
        let mut app = test_app();
        app.apply(StreamEvent::Token {
            text: "<think>weighing options</think>".into(),
        });
        app.flush_assistant();
        app.apply(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "grep".into(),
            args: json!({ "pattern": "x" }),
        });
        assert!(
            !app.transcript.iter().any(Row::is_blank),
            "no separator between a reasoning summary and a tool row"
        );

        // Prose is a different band and still gets its air.
        app.apply(StreamEvent::Token { text: "an answer".into() });
        app.flush_assistant();
        assert!(
            app.transcript.iter().any(Row::is_blank),
            "prose is still separated from the activity above it"
        );
    }

    /// The borderless input box used to reserve two blank rows for borders it
    /// does not draw. One row of air above the dock is all it needs.
    #[test]
    fn input_box_reserves_one_row_of_air() {
        let mut app = test_app();
        let rows = render_rows(&mut app, 80, 12);
        let input = rows
            .iter()
            .position(|r| r.contains("Type here to chat with agent"))
            .expect("input");
        assert_eq!(input + 3, rows.len(), "input, one blank, then the dock: {rows:?}");
        assert!(rows[input + 1].trim().is_empty());
        assert!(rows.last().unwrap().contains("/tmp/repo"));
    }

    /// The pin answers "where are we now" in one line, and carries the hint
    /// that opens the editor.
    #[test]
    fn todo_pin_reports_phase_and_progress() {
        use crate::core::agent::todo::TodoStatus::*;
        let multi = todos_from(vec![
            ("backend", vec![("scaffold", Completed), ("routes", InProgress)]),
            ("frontend", vec![("ui", Pending)]),
        ]);
        let text = line_text(&super::todo_pin(&multi));
        assert!(text.contains("Todos"), "{text}");
        assert!(text.contains("1/2"), "phase position: {text}");
        assert!(text.contains("backend 1/2"), "active phase progress: {text}");
        assert!(text.contains("/todo"), "editor hint: {text}");

        let single = todos_from(vec![("only", vec![("a", Completed), ("b", Pending)])]);
        let text = line_text(&super::todo_pin(&single));
        assert!(text.contains("Todos · 1/2"), "single phase progress: {text}");
    }

    /// A child's panel normally closes on its own `SubagentEnd`. A run that
    /// ends without one -- an upstream error mid-fan-out, a `Done` that beats
    /// the child's own event -- used to strand the block: it kept spinning in
    /// the dock, on an idle session, until the next `/clear`.
    #[test]
    fn run_end_closes_panels_no_subagent_end_ever_closed() {
        for finish in ["done", "error"] {
            let mut app = test_app();
            app.submit_user("go".into());
            start_subagent(&mut app, "r0", "alpha");
            subagent_event(
                &mut app,
                "r0",
                "alpha",
                StreamEvent::ToolCall {
                    id: "c1".into(),
                    name: "read".into(),
                    args: json!({ "path": "a.rs" }),
                },
            );
            assert_eq!(app.subagents.len(), 1, "{finish}: panel open");

            match finish {
                "done" => app.on_done("stop".into(), None),
                _ => app.on_error("upstream".into(), "boom".into()),
            }

            assert!(app.subagents.is_empty(), "{finish}: live panel must close");
            let rows = render_rows(&mut app, 100, 24);
            assert!(
                !rows.iter().any(|r| r.contains("1 agent")),
                "{finish}: panel must be gone: {rows:?}"
            );
            // Not silently: the child did work, so it gets the same kind of
            // summary row a clean end would leave, marked unfinished.
            assert!(
                rows.iter().any(|r| r.contains("subagent alpha interrupted")),
                "{finish}: unfinished child must be accounted for: {rows:?}"
            );
        }
    }

    /// A plan with every task closed stops being live state: the dock drops it
    /// after `TODO_HIDE_AFTER`, giving the rows back to the conversation. The
    /// list itself survives -- `/todo` still opens it, and the turn-based aging
    /// still owns clearing it.
    #[test]
    fn finished_plan_hides_from_the_dock_after_the_timeout() {
        use crate::core::agent::todo::TodoStatus::*;
        let mut app = test_app();
        app.todos = todos_from(vec![("only", vec![("ship it", Completed)])]);

        // Closed, but only just: still shown, and the deadline is now armed.
        let rows = render_rows(&mut app, 80, 20);
        assert!(rows.iter().any(|r| r.contains("Todos")), "{rows:?}");
        let closed = app.todos_closed_at.expect("deadline armed on a closed plan");

        // Past the timeout: the dock gives the rows back, the list stays.
        app.todos_closed_at = closed.checked_sub(super::TODO_HIDE_AFTER);
        assert!(app.todos_expired());
        let rows = render_rows(&mut app, 80, 20);
        assert!(!rows.iter().any(|r| r.contains("Todos")), "{rows:?}");
        assert!(!app.todos.is_empty(), "the plan itself is untouched");

        // Reopened work brings it straight back, deadline cleared.
        app.todos = todos_from(vec![("only", vec![("ship it", InProgress)])]);
        let rows = render_rows(&mut app, 80, 20);
        assert!(app.todos_closed_at.is_none(), "deadline disarmed");
        assert!(rows.iter().any(|r| r.contains("Todos")), "{rows:?}");
    }

    /// The timeout is wall-clock, not turn-based: an open plan is never hidden
    /// however long the model sits on it.
    #[test]
    fn open_plan_is_never_hidden() {
        use crate::core::agent::todo::TodoStatus::*;
        let mut app = test_app();
        app.todos = todos_from(vec![("only", vec![("done", Completed), ("open", Pending)])]);
        render_rows(&mut app, 80, 20);
        assert!(app.todos_closed_at.is_none(), "open work arms nothing");
        assert!(!app.todos_expired());
    }

    /// A wide terminal sets the plan and the fan-out side by side, each in its
    /// own half, so the panel spends rows once instead of twice.
    #[test]
    fn wide_panel_sets_the_columns_side_by_side() {
        use crate::core::agent::todo::TodoStatus::*;
        let mut app = test_app();
        app.todos = todos_from(vec![("only", vec![("wire routes", InProgress)])]);
        start_subagent(&mut app, "r0", "alpha");
        let rows = render_rows(&mut app, 120, 24);
        let head = rows
            .iter()
            .find(|r| r.contains("Todos"))
            .expect("panel head");
        assert!(
            head.contains("│") && head.contains("1 agent"),
            "both columns share the row: {head:?}"
        );
        assert!(
            head.find("Todos") < head.find("1 agent"),
            "plan on the left, agents on the right: {head:?}"
        );
    }

    /// Too narrow to split: the columns stack rather than being squeezed into
    /// halves too thin to hold a task or an agent name.
    #[test]
    fn narrow_panel_stacks_the_columns() {
        use crate::core::agent::todo::TodoStatus::*;
        let mut app = test_app();
        app.todos = todos_from(vec![("only", vec![("wire routes", InProgress)])]);
        start_subagent(&mut app, "r0", "alpha");
        let rows = render_rows(&mut app, super::PANEL_SPLIT_MIN_WIDTH - 1, 24);
        assert!(
            !rows.iter().any(|r| r.contains("│")),
            "no divider when stacked: {rows:?}"
        );
        let todos = rows.iter().position(|r| r.contains("Todos")).expect("plan");
        let agents = rows.iter().position(|r| r.contains("≡")).expect("agents");
        assert!(todos < agents, "plan first when stacked: {rows:?}");
    }

    /// A short terminal spends its rows on the conversation: the panel shrinks
    /// first, eliding its own tail, and disappears before the transcript does.
    #[test]
    fn short_terminal_shrinks_the_panel_before_the_transcript() {
        use crate::core::agent::todo::TodoStatus::*;
        let mut app = test_app();
        let many: Vec<(&str, _)> = (0..12).map(|_| ("a task", Pending)).collect();
        app.todos = todos_from(vec![("only", many)]);

        // Roomy: capped at the panel ceiling, never more.
        assert_eq!(super::panel_budget(40, 2), super::PANEL_MAX_ROWS);
        // Squeezed: only what is left after the fixed rows and the transcript
        // floor, and nothing at all once even that is gone.
        assert_eq!(super::panel_budget(12, 2), 3);
        assert_eq!(super::panel_budget(9, 2), 0);

        let rows = render_rows(&mut app, 80, 12);
        let panel: Vec<&String> = rows
            .iter()
            .filter(|r| r.contains("Todos") || r.contains("a task") || r.contains("more"))
            .collect();
        assert!(panel.len() <= 3, "panel clamped to its budget: {rows:?}");
        assert!(
            rows.iter().any(|r| r.contains("+11 more")),
            "the tail is elided, not dropped silently: {rows:?}"
        );

        // No room at all: the panel yields entirely and the dock still renders.
        let rows = render_rows(&mut app, 80, 9);
        assert!(!rows.iter().any(|r| r.contains("Todos")), "{rows:?}");
        assert!(rows.last().unwrap().contains("/tmp/repo"), "{rows:?}");
    }

    /// Many parallel agents cannot push the plan off the screen: the column
    /// shows what fits and counts the rest.
    #[test]
    fn crowded_fan_out_elides_with_a_running_count() {
        let mut app = test_app();
        for i in 0..9 {
            start_subagent(&mut app, &format!("r{i}"), &format!("agent-{i}"));
        }
        let rows = render_rows(&mut app, 100, 24);
        let shown = rows.iter().filter(|r| r.contains("agent-")).count();
        assert!(shown < 9, "not every agent fits: {rows:?}");
        assert!(
            rows.iter().any(|r| r.contains("more running")),
            "the rest are counted: {rows:?}"
        );
    }

    #[tokio::test]
    async fn todo_editor_mutations_update_the_canonical_list() {
        let mut app = test_app();
        // Add through the same `append` op the model uses.
        run_command(&mut app, "todo add Build | ship it").await;
        assert_eq!(app.todos.done_total(), (0, 1));
        assert_eq!(app.todos.active().unwrap().1.content, "ship it");
        // Mark it done via the editor helper; the projection reflects it.
        super::apply_todo_mutation(&mut app, |l| {
            l.done(crate::core::agent::todo::Target::Task("ship it"))
        })
        .await
        .unwrap();
        assert_eq!(app.todos.done_total(), (1, 1));
    }

    /// `/todo clear` drops a stale list in one step -- otherwise a finished or
    /// abandoned task set lingers in the HUD until each item is removed by hand.
    #[tokio::test]
    async fn todo_clear_command_empties_the_whole_list() {
        let mut app = test_app();
        run_command(&mut app, "todo add Build | ship it").await;
        run_command(&mut app, "todo add Build | and this").await;
        assert_eq!(app.todos.done_total(), (0, 2));

        run_command(&mut app, "todo clear").await;
        assert!(app.todos.is_empty(), "{:?}", app.todos);

        // Clearing an already-empty list is a no-op note, not an error.
        run_command(&mut app, "todo clear").await;
        assert!(app.todos.is_empty());
    }

    #[tokio::test]
    async fn todo_command_bare_opens_editor_overlay() {
        let mut app = test_app();
        run_command(&mut app, "todo add first").await;
        run_command(&mut app, "todo").await;
        assert!(matches!(
            app.picker.as_ref().map(|p| p.kind),
            Some(PickerKind::Todo)
        ));
    }

    #[test]
    fn todos_persist_and_restore_via_thread_metadata() {
        let mut app = test_app();
        seed_open_todos(&mut app);
        let meta = app.thread_metadata().expect("todos force metadata");
        assert!(meta.get("todos").is_some());

        let mut restored = test_app();
        restore_todos(&mut restored, Some(&meta));
        assert_eq!(restored.todos, app.todos, "resume/branch reconstructs todos");
    }

    #[tokio::test]
    async fn plan_review_execute_switches_normal_and_queues_continuation() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        app.apply(StreamEvent::TodoUpdate { list: staged_todos() });
        app.status = Status::Running; // an in-flight turn owns the ask
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: plan_review_request(),
        });
        // Default selection 0 = "Execute plan"; Enter submits.
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert_eq!(app.run_mode, RunMode::Normal);
        assert!(
            app.message_queue
                .iter()
                .any(|m| m.as_str() == "Proceed with the plan."),
            "execute must queue a continuation turn"
        );
        let answers = receiver.await.unwrap().unwrap();
        assert_eq!(
            answers[0].selected,
            vec![crate::core::agent::plan::EXECUTE_PLAN_LABEL]
        );
    }

    #[tokio::test]
    async fn plan_review_execute_without_todos_stays_in_plan() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan; // no todos staged
        app.status = Status::Running;
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, _receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: plan_review_request(),
        });
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        // Atomic handoff: no staged plan => stay in Plan, no continuation.
        assert_eq!(app.run_mode, RunMode::Plan);
        assert!(app.message_queue.is_empty());
        let text: String = app.transcript.iter().map(row_text).collect();
        assert!(text.contains("no plan staged"), "note: {text}");
    }

    #[tokio::test]
    async fn plan_review_keep_planning_stays_in_plan() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        app.apply(StreamEvent::TodoUpdate { list: staged_todos() });
        app.status = Status::Running;
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, _receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: plan_review_request(),
        });
        press_ask(&mut app, &registry, KeyCode::Down).await; // -> Keep planning
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert_eq!(app.run_mode, RunMode::Plan);
        assert!(app.message_queue.is_empty(), "keep planning must not execute");
    }

    #[tokio::test]
    async fn plan_review_exit_returns_to_normal_without_execution() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        app.apply(StreamEvent::TodoUpdate { list: staged_todos() });
        app.status = Status::Running;
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, _receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: plan_review_request(),
        });
        press_ask(&mut app, &registry, KeyCode::Down).await;
        press_ask(&mut app, &registry, KeyCode::Down).await; // -> Exit plan mode
        press_ask(&mut app, &registry, KeyCode::Enter).await;
        assert_eq!(app.run_mode, RunMode::Normal);
        assert!(app.message_queue.is_empty(), "exit must not auto-execute");
    }

    #[tokio::test]
    async fn cancelling_plan_review_leaves_plan_enabled() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.run_mode = RunMode::Plan;
        app.status = Status::Running;
        let registry = crate::core::agent::interaction::new_registry();
        let (request_id, receiver) = crate::core::agent::interaction::register(&registry).await;
        app.apply(StreamEvent::AskRequest {
            request_id,
            request: plan_review_request(),
        });
        press_ask(&mut app, &registry, KeyCode::Esc).await; // cancel the review
        assert!(app.ask_queue.is_empty(), "review wait must be cleared");
        assert_eq!(app.run_mode, RunMode::Plan, "cancel must not change mode");
        assert!(matches!(
            receiver.await.unwrap(),
            Err(crate::core::agent::interaction::AskError::Cancelled)
        ));
    }

    #[test]
    fn on_done_does_not_queue_goal_eval_while_planning() {
        use crate::core::agent::plan::RunMode;
        let mut app = test_app();
        app.goal = Some(crate::core::agent::goal::GoalState::new("cond"));
        app.run_mode = RunMode::Plan;
        app.status = Status::Running;
        app.apply(StreamEvent::Token {
            text: "planning".into(),
        });
        app.on_done("stop".into(), None);
        assert!(
            !app.goal_eval_pending,
            "plan mode pauses the goal loop; no auto-continue"
        );
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
        let text: String = app.transcript.iter().map(row_text).collect();
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

    fn names(app: &App) -> Vec<String> {
        app.slash_matches().iter().map(|m| m.name().to_string()).collect()
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
        assert_eq!(names(&app), vec!["/resume".to_string()]);
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
        assert_eq!(names(&app), vec!["/resume".to_string()]);
    }

    #[test]
    fn slash_matches_include_installed_skills() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        app.input = "/dep".into();
        assert!(
            names(&app).iter().any(|n| n == "/deploy"),
            "skill offered by prefix: {:?}",
            names(&app)
        );
        // Prefix narrowing works for skills too.
        app.input = "/deplo".into();
        assert_eq!(names(&app), vec!["/deploy".to_string()]);
        // Unmatched prefix hides the skill row.
        app.input = "/zzz".into();
        assert!(!names(&app).iter().any(|n| n == "/deploy"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn slash_matches_hide_disabled_skills() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        // Whitelist a different skill: deploy must vanish from the popup,
        // matching the model-facing skill_list semantics.
        std::fs::write(
            root.join(".jan/agent/agent.toml"),
            "[agent]\n[skills]\nenabled = [\"other\"]\n",
        )
        .unwrap();
        app.input = "/dep".into();
        assert!(
            !names(&app).iter().any(|n| n == "/deploy"),
            "disabled skill must not be offered: {:?}",
            names(&app)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn slash_matches_dedupe_command_collisions() {
        let (mut app, root) = skill_test_app("cancel", "Cancels things.");
        app.input = "/".into();
        let all = names(&app);
        let hits = all.iter().filter(|n| *n == "/cancel").count();
        assert_eq!(hits, 1, "command wins, skill row dropped: {all:?}");
        // The unambiguous form is still completable.
        app.input = "/skill:can".into();
        assert!(names(&app).iter().any(|n| n == "/skill:cancel"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn accept_slash_fills_skill_name() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        app.input = "/dep".into();
        app.cursor = app.input.len();
        app.accept_slash();
        assert_eq!(app.input, "/deploy ");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn slash_hints_render_skill_rows() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        app.input = "/dep".into();
        app.cursor = app.input.len();
        let rows = render_rows(&mut app, 100, 30);
        assert!(
            rows.iter().any(|r| r.contains("/deploy") && r.contains("How to deploy.")),
            "skill row rendered:\n{}",
            rows.join("\n")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn run_command_dispatches_installed_skill() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        run_command(&mut app, "deploy").await;
        assert!(
            transcript_text(&app).contains("[skill:deploy]"),
            "compact row: {}",
            transcript_text(&app)
        );
        // The full skill body is injected into history, not deferred to
        // skill_read, and the folder directory is announced for relative paths.
        let user = app
            .history
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .expect("user message pushed");
        let content = user["content"].as_str().unwrap();
        assert!(content.contains("You have invoked the \"deploy\" skill"), "{content}");
        assert!(content.contains("# deploy"), "body injected: {content}");
        assert!(content.contains("Skill directory:"), "base dir: {content}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn run_command_threads_skill_args() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        run_command(&mut app, "deploy staging --force").await;
        let user = app
            .history
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .expect("user message pushed");
        assert!(
            user["content"].as_str().unwrap().contains("User: staging --force"),
            "{}",
            user["content"]
        );
        assert!(transcript_text(&app).contains("[skill:deploy] staging --force"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn skill_colon_form_dispatches_and_beats_collisions() {
        // A skill named like a builtin command: the short form runs the
        // command; `/skill:cancel` still reaches the skill.
        let (mut app, root) = skill_test_app("cancel", "Cancels things.");
        run_command(&mut app, "cancel").await;
        assert!(
            !transcript_text(&app).contains("[skill:cancel]"),
            "command wins the short form: {}",
            transcript_text(&app)
        );
        run_command(&mut app, "skill:cancel").await;
        assert!(transcript_text(&app).contains("[skill:cancel]"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn submit_user_mid_prompt_skill_invocation() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        app.submit_user("fix the auth flow /skill:deploy focus on security".into());
        let user = app
            .history
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .expect("user message pushed");
        let content = user["content"].as_str().unwrap();
        assert!(
            content.contains("fix the auth flow focus on security"),
            "surrounding prose becomes args: {content}"
        );
        assert!(content.contains("User: fix the auth flow focus on security"), "{content}");
        assert!(transcript_text(&app).contains("[skill:deploy] fix the auth flow focus on security"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn submit_user_unknown_skill_token_passes_through() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        app.submit_user("read /skill:nope for me".into());
        let user = app
            .history
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .expect("user message pushed");
        assert_eq!(
            user["content"].as_str().unwrap(),
            "read /skill:nope for me",
            "unknown skill stays a plain message"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn run_command_unknown_still_notes() {
        let (mut app, root) = skill_test_app("deploy", "How to deploy.");
        run_command(&mut app, "warp_drive").await;
        assert!(transcript_text(&app).contains("unknown command '/warp_drive'"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn tab_is_noop_in_normal_input_mode() {
        // Tab must never insert a literal character, even when the input
        // contains underscores or other characters that might confuse
        // crossterm's key delivery.
        let mut app = test_app();
        app.input = "use credential for api.txt".into();
        app.cursor = app.input.len();
        app.input_insert('\t');
        assert_eq!(app.input, "use credential for api.txt");
        assert_eq!(app.cursor, app.input.len());
    }

    #[test]
    fn accept_quoted_path_hint_replaces_whole_quoted_token() {
        let mut app = test_app();
        app.input = r#"use @"my file.txt""#.into(); // fully typed, closing quote present
        app.cursor = app.input.len();
        app.path_hints = vec![super::PathHintItem {
            path: "notes/report.md".into(),
            name: "report.md".into(),
            is_dir: false,
        }];
        app.accept_path_hint();
        assert_eq!(app.input, r#"use @"notes/report.md""#);
    }

    #[test]
    fn accept_directory_path_hint_keeps_at_and_slash() {
        let mut app = test_app();
        app.input = "use @docs".into();
        app.cursor = app.input.len();
        app.path_hints = vec![super::PathHintItem {
            path: "docs".into(),
            name: "docs".into(),
            is_dir: true,
        }];
        app.accept_path_hint();
        // The reference marker and a trailing slash survive, so the user can
        // keep drilling into the directory. Accepting must not turn the token
        // into a plain, non-reference path.
        assert_eq!(app.input, "use @docs/");
    }

    #[test]
    fn accept_file_path_hint_keeps_at_marker() {
        let mut app = test_app();
        app.input = "use @report".into();
        app.cursor = app.input.len();
        app.path_hints = vec![super::PathHintItem {
            path: "docs/report.md".into(),
            name: "report.md".into(),
            is_dir: false,
        }];
        app.accept_path_hint();
        assert_eq!(app.input, "use @docs/report.md");
    }

    #[test]
    fn path_hint_query_handles_quoted_reference() {
        let mut app = test_app();
        // Cursor inside the opening quote: query is empty.
        app.input = r#"use @"#.into();
        app.cursor = app.input.len();
        assert_eq!(app.path_hint_query(), Some(String::new()));
        // Typing inside quotes: query is the typed text.
        app.input = r#"use @"my file"#.into();
        app.cursor = app.input.len();
        assert_eq!(app.path_hint_query(), Some("my file".to_string()));
        // Closing quote: query is the text between quotes.
        app.input = r#"use @"my file.txt""#.into();
        app.cursor = app.input.len();
        assert_eq!(app.path_hint_query(), Some("my file.txt".to_string()));
    }

    #[test]
    fn should_not_auto_compact_when_below_threshold() {
        let app = test_app();
        // Default context_window = 128K, reserve_tokens = 16K, so limit ~111K.
        // With tokens = 50K and history = 6, no compact.
        assert!(!app.should_auto_compact());
    }

    #[test]
    fn should_auto_compact_when_above_threshold() {
        let mut app = test_app();
        app.tokens = 120_000; // > 128K - 16K = 112K
        // Need more than 4 history messages
        for i in 0..6 {
            app.history.push(serde_json::json!({
                "role": if i % 2 == 0 { "user" } else { "assistant" },
                "content": format!("msg{i}")
            }));
        }
        assert!(app.should_auto_compact());
    }

    #[test]
    fn should_not_auto_compact_when_history_too_short() {
        let mut app = test_app();
        app.tokens = 120_000;
        // Only 3 messages — below the minimum of 5
        for i in 0..3 {
            app.history.push(serde_json::json!({
                "role": if i % 2 == 0 { "user" } else { "assistant" },
                "content": format!("msg{i}")
            }));
        }
        assert!(!app.should_auto_compact());
    }

    #[test]
    fn should_not_auto_compact_with_zero_tokens() {
        let mut app = test_app();
        app.tokens = 0;
        for i in 0..6 {
            app.history.push(serde_json::json!({
                "role": if i % 2 == 0 { "user" } else { "assistant" },
                "content": format!("msg{i}")
            }));
        }
        assert!(!app.should_auto_compact());
    }

    #[test]
    fn should_not_auto_compact_with_context_window_unset() {
        let mut app = test_app();
        app.tokens = 120_000;
        app.context_window = u64::MAX; // effectively unlimited
        for i in 0..6 {
            app.history.push(serde_json::json!({
                "role": if i % 2 == 0 { "user" } else { "assistant" },
                "content": format!("msg{i}")
            }));
        }
        // limit = u64::MAX - 16384 ≈ u64::MAX, so tokens=120K is well below
        assert!(!app.should_auto_compact());
    }

    fn overflow_error() -> String {
        format!(
            "[{}] Upstream returned HTTP 400: context_length_exceeded",
            crate::core::agent::upstream::CONTEXT_OVERFLOW_MARKER
        )
    }

    fn app_with_history(n: usize) -> TestApp {
        let mut app = test_app();
        for i in 0..n {
            app.history.push(serde_json::json!({
                "role": if i % 2 == 0 { "user" } else { "assistant" },
                "content": format!("msg{i}")
            }));
        }
        app
    }

    #[test]
    fn context_overflow_error_queues_a_compaction_and_retry() {
        let mut app = app_with_history(6);
        app.on_error("upstream_error".into(), overflow_error());
        assert_eq!(
            app.compact_request,
            Some(CompactKind::Auto),
            "an overflow must queue a compaction instead of going idle"
        );
        assert!(app.retry_after_compact, "the turn must be retried");
        assert!(!app.want_start, "the retry waits for the compaction to land");
    }

    #[test]
    fn ordinary_error_does_not_queue_a_compaction() {
        let mut app = app_with_history(6);
        app.on_error("upstream_error".into(), "invalid api key".into());
        assert_eq!(app.compact_request, None);
        assert!(!app.retry_after_compact);
    }

    #[test]
    fn overflow_on_a_short_history_does_not_retry() {
        // Nothing to compact: retrying would just re-send the same request.
        let mut app = app_with_history(2);
        app.on_error("upstream_error".into(), overflow_error());
        assert_eq!(app.compact_request, None);
        assert!(!app.retry_after_compact);
    }

    #[test]
    fn compaction_after_an_overflow_restarts_the_turn() {
        let mut app = app_with_history(6);
        app.on_error("upstream_error".into(), overflow_error());
        app.compacting = app.compact_request.take();
        let compacted = vec![serde_json::json!({ "role": "system", "content": "summary" })];
        finish_compaction(&mut app, Ok(compacted), 7);
        assert!(app.want_start, "a landed compaction resumes the errored turn");
        assert!(!app.retry_after_compact);
        assert_eq!(app.status, Status::Running);
    }

    #[test]
    fn a_no_op_compaction_after_an_overflow_does_not_retry() {
        // Compaction could not shrink the history, so a retry would overflow
        // again on exactly the same request.
        let mut app = app_with_history(6);
        app.on_error("upstream_error".into(), overflow_error());
        app.compacting = app.compact_request.take();
        let unchanged = app.history.clone();
        let base = unchanged.len();
        finish_compaction(&mut app, Ok(unchanged), base);
        assert!(!app.want_start);
        assert!(!app.retry_after_compact);
    }

    #[test]
    fn repeated_overflows_stop_retrying_within_one_turn() {
        let mut app = app_with_history(6);
        for _ in 0..MAX_OVERFLOW_RETRIES {
            app.on_error("upstream_error".into(), overflow_error());
            assert!(app.retry_after_compact);
            app.compacting = app.compact_request.take();
            let shorter = app.history[..app.history.len() - 1].to_vec();
            let base = app.history.len();
            finish_compaction(&mut app, Ok(shorter), base);
        }
        app.on_error("upstream_error".into(), overflow_error());
        assert_eq!(
            app.compact_request, None,
            "the retry budget is spent for this turn"
        );
        assert!(!app.retry_after_compact);
    }

    #[test]
    fn a_new_user_turn_rearms_the_overflow_retry_budget() {
        let mut app = app_with_history(6);
        app.overflow_retries = MAX_OVERFLOW_RETRIES;
        app.submit_user("next".into());
        assert_eq!(app.overflow_retries, 0);
    }

    fn usage_of(prompt: u64, completion: u64) -> Usage {
        Usage {
            prompt_tokens: Some(prompt),
            completion_tokens: Some(completion),
            total_tokens: Some(prompt + completion),
        }
    }

    #[test]
    fn estimate_counts_tool_call_arguments() {
        // Arguments live at `function.arguments`; reading `arguments` off the
        // call itself scored every tool-heavy history as empty.
        let args = "x".repeat(4_000);
        let with_calls = vec![serde_json::json!({
            "role": "assistant",
            "content": serde_json::Value::Null,
            "tool_calls": [{
                "id": "c1",
                "function": { "name": "bash", "arguments": args }
            }]
        })];
        assert!(
            estimate_token_count(&with_calls) >= 1_000,
            "tool-call arguments must be counted: {}",
            estimate_token_count(&with_calls)
        );
    }

    #[test]
    fn estimate_counts_multimodal_text_parts() {
        let msgs = vec![serde_json::json!({
            "role": "user",
            "content": [{ "type": "text", "text": "y".repeat(4_000) }]
        })];
        assert!(estimate_token_count(&msgs) >= 1_000);
    }

    #[test]
    fn an_accepted_prompt_above_the_window_stops_trusting_it() {
        let mut app = test_app();
        assert!(app.context_window_trusted);
        app.apply(StreamEvent::TurnUsage {
            usage: usage_of(200_000, 100),
        });
        assert!(
            !app.context_window_trusted,
            "a prompt the provider accepted proves the configured window wrong"
        );
        // The gauge has no denominator it can trust, so it must not divide.
        assert!(!app.should_auto_compact(), "and it must not compact on it");
    }

    #[test]
    fn a_prompt_within_the_window_keeps_it_trusted() {
        let mut app = test_app();
        app.apply(StreamEvent::TurnUsage {
            usage: usage_of(50_000, 100),
        });
        assert!(app.context_window_trusted);
    }

    #[test]
    fn header_drops_the_denominator_once_the_window_is_untrusted() {
        let mut app = test_app();
        app.apply(StreamEvent::TurnUsage {
            usage: usage_of(200_000, 100),
        });
        let text: String = header_spans(&app)
            .iter()
            .map(|s| s.content.as_ref())
            .collect::<String>();
        assert!(text.contains("ctx 200K"), "usage still shown: {text}");
        assert!(
            !text.contains("/128K"),
            "a disproven window must not be a denominator: {text}"
        );
    }

    #[test]
    fn subagent_share_is_suppressed_when_the_window_is_untrusted() {
        let mut app = test_app();
        app.subagents.push(SubagentPanel {
            run_id: "r".into(),
            name: "alpha".into(),
            task: "t".into(),
            calls: Vec::new(),
            requests: 1,
            prompt_tokens: 200_000,
            active: None,
            queued: false,
            waiting: 0,
        });
        app.apply(StreamEvent::TurnUsage {
            usage: usage_of(200_000, 100),
        });
        let rows = status_panel(&mut app, 120, 8);
        let text: String = rows
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.as_ref()))
            .collect::<String>();
        assert!(
            !text.contains('%'),
            "no share against a wrong window: {text}"
        );
    }

    #[test]
    fn body_omits_max_tokens_when_unset() {
        let app = test_app();
        let body = app.body();
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn body_includes_max_tokens_when_set() {
        let mut app = test_app();
        app.max_tokens = Some(4096);
        let body = app.body();
        assert_eq!(body.get("max_tokens").and_then(|v| v.as_u64()), Some(4096));
    }

    /// The session token budget is the only cap: it is always forwarded, and no
    /// turn limit is sent at all.
    #[test]
    fn body_forwards_session_budget_and_no_turn_cap() {
        let mut app = test_app();
        app.max_session_tokens = 64_000;
        let body = app.body();
        assert_eq!(
            body.get("max_session_tokens").and_then(|v| v.as_u64()),
            Some(64_000)
        );
        assert!(body.get("max_turns").is_none());
    }

    #[test]
    fn body_flags_goal_mode_only_while_a_goal_runs() {
        use crate::core::agent::goal::{GoalState, GoalStatus};
        let mut app = test_app();
        assert!(app.body().get("goal_mode").is_none());

        app.goal = Some(GoalState::new("ship the release"));
        assert_eq!(app.body().get("goal_mode").and_then(|v| v.as_bool()), Some(true));

        if let Some(goal) = app.goal.as_mut() {
            goal.status = GoalStatus::Achieved;
        }
        assert!(app.body().get("goal_mode").is_none());
    }

    /// The splash row's rendered text at `width`, one string per line.
    fn banner_text(app: &App, width: u16) -> Vec<String> {
        app.transcript
            .iter()
            .flat_map(|row| row.lines(width))
            .map(|l| l.spans.iter().map(|s| s.content.to_string()).collect())
            .collect()
    }

    #[test]
    fn banner_opens_with_the_wordmark_and_this_sessions_facts() {
        let mut app = test_app();
        app.model = "tokamak-1-preview".into();
        app.git_branch = Some("fix/tui-panel-width".into());
        app.push_banner("auto-approved inside the OS sandbox", true);

        let text = banner_text(&app, 90);
        let joined = text.join("\n");
        assert!(
            text.iter().any(|l| l.contains(brand::LOGO[0].trim())),
            "the wordmark is missing:\n{joined}"
        );
        // The model is the header's job, not the splash's (it would otherwise
        // appear twice on the first screen).
        assert!(!joined.contains("tokamak-1-preview"), "{joined}");
        assert!(joined.contains("/tmp/repo"), "{joined}");
        assert!(joined.contains("fix/tui-panel-width"), "{joined}");
        assert!(joined.contains("auto-approved inside the OS sandbox"), "{joined}");
        assert!(joined.contains("/help"), "{joined}");
        assert!(joined.contains("type a message to start"), "{joined}");
        assert!(
            joined.contains(super::super::updater::build_version()),
            "{joined}"
        );
    }

    /// `/init` is the first thing a new project wants and is invisible unless
    /// promoted, so the splash lists it beside `/help`.
    #[test]
    fn banner_promotes_init() {
        let mut app = test_app();
        app.push_banner("--safe", true);
        let joined = banner_text(&app, 90).join("\n");
        assert!(joined.contains("/init"), "{joined}");
        assert!(joined.contains("onboard this project"), "{joined}");
    }

    /// The invitation is conditional on the same rule the system prompt uses, so
    /// an already-onboarded project (its own JAN.md, or an ancestor's) is quiet.
    #[test]
    fn init_invitation_tracks_whether_the_project_has_instructions() {
        let root = std::env::temp_dir().join(format!("jan_init_invite_{}", std::process::id()));
        let nested = root.join("pkg");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(!crate::core::agent::context::has_context_file(&nested));
        std::fs::write(root.join("JAN.md"), "ROOT_RULES").unwrap();
        assert!(
            crate::core::agent::context::has_context_file(&nested),
            "an ancestor's JAN.md already onboards this project"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_seeded_session_is_not_invited_to_type() {
        let mut app = test_app();
        app.push_banner("--safe", false);
        let joined = banner_text(&app, 90).join("\n");
        assert!(!joined.contains("type a message to start"), "{joined}");
        assert!(joined.contains("--safe"), "{joined}");
    }

    #[test]
    fn a_narrow_terminal_gets_the_name_instead_of_a_clipped_wordmark() {
        let mut app = test_app();
        app.push_banner("--safe", true);

        let wide = banner_text(&app, 90).join("\n");
        assert!(wide.contains('█'), "{wide}");

        // Same row, re-laid out: the source is data, not rendered lines.
        let narrow = banner_text(&app, 24);
        let joined = narrow.join("\n");
        assert!(!joined.contains('█'), "{joined}");
        assert!(joined.contains("jan"), "{joined}");
        for line in &narrow {
            assert!(
                line.chars().count() <= 24,
                "row overflows a 24-column terminal: {line:?}"
            );
        }
    }

    #[test]
    fn header_leads_with_the_model_not_a_name_chip() {
        let mut app = test_app();
        app.model = "tokamak-1-preview".into();
        let top = render_rows(&mut app, 60, 12).remove(0);
        assert!(
            top.starts_with(" tokamak-1-preview"),
            "the name chip is back: {top:?}"
        );
        // The freed columns are what let the status survive a 60-column frame.
        assert!(top.contains("[ready]"), "{top:?}");

        app.model.clear();
        let top = render_rows(&mut app, 60, 12).remove(0);
        assert!(top.starts_with(" no model"), "{top:?}");
    }

    #[test]
    fn hints_wrap_between_pairs_never_mid_pair() {
        let pairs = super::BANNER_HINTS;
        let rows = super::hint_rows(pairs, 30);
        assert!(rows.len() > 1, "narrow width must wrap");
        for row in &rows {
            assert!(row_width(row) <= 30 || row.spans.len() <= 3, "{row:?}");
        }
        let all: String = rows
            .iter()
            .flat_map(|r| r.spans.iter().map(|s| s.content.to_string()))
            .collect();
        for (key, label) in pairs {
            assert!(all.contains(key), "dropped {key}");
            assert!(all.contains(label), "dropped {label}");
        }
        assert_eq!(super::hint_rows(pairs, 200).len(), 1, "one row when it fits");
    }
    /// Spans of the last committed transcript row, as `(text, style)`.
    fn last_row(app: &App) -> Vec<(String, Style)> {
        app.transcript
            .last()
            .expect("a row")
            .lines(80)
            .remove(0)
            .spans
            .iter()
            .map(|s| (s.content.to_string(), s.style))
            .collect()
    }

    #[test]
    fn every_transcript_class_owns_a_distinct_gutter() {
        let mut app = test_app();

        app.note("conversation cleared");
        assert_eq!(last_row(&app)[0].0, "\u{2022} ", "system note");

        app.push_user_line("do it", &[]);
        assert_eq!(last_row(&app)[0].0, "\u{203a} ", "user message");

        app.apply(StreamEvent::ToolCall {
            id: "t1".into(),
            name: "bash".into(),
            args: json!({"command": "ls"}),
        });
        app.apply(StreamEvent::ToolResult {
            id: "t1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        });
        app.finalize_tool_group();
        assert_eq!(last_row(&app)[0].0, "\u{2502} ", "tool row");

        // Model prose is the one class with no gutter, which is what makes the
        // others readable as "not the model".
        app.assistant_buf = "Done.".into();
        app.flush_assistant();
        let prose = last_row(&app);
        assert!(
            !prose[0].0.starts_with('\u{2022}') && !prose[0].0.starts_with('\u{203a}'),
            "prose took a gutter: {prose:?}"
        );
    }

    #[test]
    fn severity_colours_the_gutter_and_the_body() {
        let mut app = test_app();

        app.note("saved");
        let info = last_row(&app);
        assert_eq!(info[0].1.fg, Some(Color::LightBlue), "info gutter");
        assert!(info[1].1.add_modifier.contains(Modifier::DIM), "info body");

        app.system(super::Level::Warn, "finished early");
        assert_eq!(last_row(&app)[0].1.fg, Some(Color::Yellow));

        app.system(super::Level::Error, "denied: rm -rf /");
        let err = last_row(&app);
        assert_eq!(err[0].1.fg, Some(Color::Red));
        assert!(err[1].1.add_modifier.contains(Modifier::BOLD), "{err:?}");

        // A category with its own glyph keeps it, so the column never carries
        // two markers.
        app.system_marked(super::GOAL_GLYPH, super::Level::Good, "goal achieved");
        let goal = last_row(&app);
        assert_eq!(goal[0].0, "\u{25ce} ");
        assert_eq!(goal[0].1.fg, Some(Color::Green));
    }

    #[tokio::test]
    async fn probe_blocks() {
        let mut app = test_app();
        app.note("conversation cleared");
        run_command(&mut app, "help").await;
        for l in render_rows(&mut app, 84, 40) { println!("|{}", l.trim_end()); }
    }

    /// Every rendered line of the last row, as plain text.
    fn last_row_lines(app: &App, width: u16) -> Vec<String> {
        app.transcript
            .last()
            .expect("a row")
            .lines(width)
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.to_string()).collect())
            .collect()
    }

    #[test]
    fn a_wrapped_note_indents_instead_of_repeating_its_marker() {
        let mut app = test_app();
        app.note("not signed in - run /login to sign in to Tokamak, or jan config set to configure a provider manually");

        let lines = last_row_lines(&app, 60);
        assert!(lines.len() > 1, "expected a wrap: {lines:?}");
        assert!(lines[0].starts_with("\u{2022} "), "{lines:?}");
        for line in &lines[1..] {
            assert!(
                line.starts_with("  ") && !line.starts_with('\u{2022}'),
                "a continuation must not read as a second note: {line:?}"
            );
        }
        // Wrapped at a space, not mid-word.
        assert!(
            lines.iter().all(|l| !l.ends_with("Tokam") && !l.ends_with("provi")),
            "{lines:?}"
        );
        assert!(lines.iter().all(|l| l.chars().count() <= 60), "{lines:?}");
    }

    #[test]
    fn a_wrapped_block_body_keeps_its_edge() {
        let mut app = test_app();
        app.note("commands:");
        app.system_detail_text("/plan [exit|text]  Enter read-only plan mode, optionally seeding it with a message");

        let lines = last_row_lines(&app, 50);
        assert!(lines.len() > 1, "expected a wrap: {lines:?}");
        for line in &lines {
            assert!(
                line.starts_with("\u{2506} "),
                "the block's left edge breaks on a wrap: {line:?}"
            );
        }
    }

    #[test]
    fn system_rows_relay_out_on_a_resize() {
        let mut app = test_app();
        app.system_detail_text("a fairly long block body that has to wrap somewhere sensible");
        let (wide, narrow) = (last_row_lines(&app, 90), last_row_lines(&app, 30));
        assert_eq!(wide.len(), 1, "{wide:?}");
        assert!(narrow.len() > 1, "{narrow:?}");
    }



    /// The transcript is laid out on every 50ms tick, so any per-frame work
    /// proportional to history (rather than to the viewport) compounds into an
    /// unusable session. `draw` must materialize only the rows on screen.
    #[test]
    fn draw_materializes_only_the_visible_rows() {
        let mut app = test_app();
        for i in 0..4000 {
            app.transcript.push(
                RowKind::Markdown(format!(
                    "Turn {i}: lorem ipsum dolor sit amet, consectetur adipiscing elit."
                ))
                .into(),
            );
        }
        // Warm every row's cache so the count below reflects steady-state
        // frames, not the first layout at a new width.
        render_rows(&mut app, 100, 40);
        super::ROW_CLONES.with(|n| n.set(0));
        render_rows(&mut app, 100, 40);
        let cloned = super::ROW_CLONES.with(|n| n.get());
        assert!(
            cloned <= 64,
            "a frame cloned {cloned} rows out of 4000; draw is laying out the \
             whole transcript instead of the viewport"
        );
    }

    /// `row_index` is in wrapped screen coordinates, so a click still maps to
    /// the row it landed on even when earlier rows wrapped to several lines.
    #[test]
    fn click_maps_through_wrapped_rows() {
        let mut app = test_app();
        // Wraps to ~4 lines at width 40, so an unwrapped index would drift.
        app.transcript
            .push(RowKind::Line(Line::raw("w".repeat(150))).into());
        for i in 0..5 {
            app.transcript
                .push(RowKind::Line(Line::raw(format!("row {i}"))).into());
        }
        render_rows(&mut app, 40, 20);
        let rect = app.transcript_rect;
        let last = app.transcript.len() - 1;
        // Bottom-pinned, so the final body row is the last transcript row.
        let bottom = rect.y + rect.height - 1;
        super::click_region(&mut app, rect.x + 1, bottom);
        assert_eq!(
            app.row_index.get((bottom - rect.y - 1) as usize),
            Some(&Some(last)),
            "the last body row must map to the last transcript row"
        );
    }
}
