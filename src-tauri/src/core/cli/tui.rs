//! Interactive chat console over the agent loop (bare `jan`). A thin
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

use super::path_refs;

use ratatui::crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste,
        EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton,
        MouseEvent, MouseEventKind,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::{sort_threads_recent, AgentSession, ResumeTarget};
use crate::core::agent::events::{describe_tool_call, StreamEvent, Usage};
use crate::core::agent::git;
use crate::core::agent::r#loop::{run_orchestration_streamed, OrchestrationArgs, PermissionRegistry};
use crate::core::agent::tools::gate::PermissionDecision;

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
        use crate::core::agent::tools::cmdscan::{scan_command, CommandScan};
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
    /// Read-only view of `~/.jan/config.toml` providers (`/config`). Enter closes.
    ViewConfig,
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
            PickerKind::Todo => " todo ",
        }
    }

    fn action_hint(&self) -> &'static str {
        match self.kind {
            PickerKind::ResumeThread => " ↑/↓ select   Enter resume   Esc cancel",
            PickerKind::SelectModel => " ↑/↓ select   Enter choose   Esc cancel",
            PickerKind::ToggleMcp => " ↑/↓ select   Enter toggle   Esc close",
            PickerKind::RewindMessage => " ↑/↓ select   Enter choose   Esc cancel",
            PickerKind::RewindScope => " ↑/↓ select   Enter restore   Esc cancel",
            PickerKind::ViewConfig => " set via: jan config set --provider <id> ...   Esc close",
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
    /// When the group opened, so the running row can show elapsed time.
    started: Instant,
}

impl ToolGroup {
    /// Whether the most recent call is still awaiting its `ToolResult`.
    /// A group can stay open with no in-flight call so future calls keep
    /// folding into it; the throbber must not show while that's the case.
    fn is_running(&self) -> bool {
        self.calls.last().is_some_and(|c| c.content.is_none())
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
    max_turns: u32,
    /// Context window limit for the current model (default 128K).
    context_window: u64,
    /// Tokens to reserve for the model's response (compaction triggers at limit - reserve).
    reserve_tokens: u64,
    /// Per-request output cap forwarded to the model as OpenAI `max_tokens`.
    /// `None` omits the field (model default).
    max_tokens: Option<u64>,
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
    /// In-flight `await_subagent` calls, `(tool_call_id, run_id, subagent_name)`.
    /// Cleared on the matching `ToolResult` or `SubagentEnd`, whichever comes
    /// first (the two can race).
    awaiting: Vec<(String, String, String)>,
    /// Tool calls whose arguments are still streaming, `(tool_call_id, name)`.
    /// Rendered as a live throbber and cleared on the matching `ToolCall` (full
    /// args) or on the next `Step`, whichever comes first.
    starting: Vec<(String, String)>,
    /// Monotonic frame counter advanced each render tick; drives the throbber.
    spinner_frame: usize,
    /// Transcript viewport rect from the last draw, for mapping mouse clicks
    /// to rows.
    transcript_rect: Rect,
    /// Wrapped-line scroll offset from the last draw (`0` = top), in the same
    /// coordinate space as `row_index`.
    last_scroll: u16,
    /// Rendered-row -> source transcript index from the last draw (`None` for
    /// synthetic rows: awaiting throbbers, live subagent panels, streaming
    /// prose). Assumes summary rows never wrap (they're pre-truncated to the
    /// viewport width), so a click's rendered row maps directly here without
    /// needing wrap-aware layout math.
    row_index: Vec<Option<usize>>,
    /// When the current run started, so the header can show elapsed time.
    /// `None` while idle.
    run_started: Option<Instant>,
    /// Whether the terminal's mouse capture should be on (click-to-expand) or
    /// off (native text selection/copy). Toggled by Ctrl-T; `chat_loop` diffs
    /// this against its previous value each tick to (de)activate it, since
    /// crossterm's enable/disable calls need the real terminal handle.
    mouse_capture: bool,
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
    #[allow(clippy::too_many_arguments)]
    fn new(
        model: String,
        max_turns: u32,
        context_window: u64,
        reserve_tokens: u64,
        max_tokens: Option<u64>,
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
            max_turns,
            context_window,
            reserve_tokens,
            max_tokens,
            repo_root,
            git_branch: git::current_branch(&project_root),
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
            pending_images: Vec::new(),
            cursor: 0,
            slash_selected: 0,
            slash_dismissed: false,
            path_hints: Vec::new(),
            path_hint_selected: 0,
            path_hint_dismissed: false,
            status: Status::Idle,
            turn: (0, 0),
            tokens: 0,
            detail: String::new(),
            pending_queue: std::collections::VecDeque::new(),
            ask_queue: std::collections::VecDeque::new(),
            picker: None,
            scrollback: 0,
            want_start: false,
            view_width: 0,
            last_kind: Kind::None,
            should_quit: false,
            subagents: Vec::new(),
            subagent_blocks: Vec::new(),
            awaiting: Vec::new(),
            starting: Vec::new(),
            spinner_frame: 0,
            transcript_rect: Rect::default(),
            last_scroll: 0,
            row_index: Vec::new(),
            run_started: None,
            mouse_capture: true,
            message_queue: std::collections::VecDeque::new(),
            todos: crate::core::agent::todo::TodoList::default(),
            todo_call_this_turn: false,
            todo_ok_this_turn: false,
            last_todo_reminder: None,
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
        self.tool_group = None;
        self.grouped_ids.clear();
        self.starting.clear();
        self.groups.clear();
        self.reasoning_blocks.clear();
        self.subagent_blocks.clear();
        self.expanded.clear();
        self.reveal = None;
        self.assistant_buf.clear();
        self.message_queue.clear();
        self.pending_queue.clear();
        self.ask_queue.clear();
        self.pending_images.clear();
        self.tokens = 0;
        self.turn = (0, 0);
        self.detail.clear();
        self.scrollback = 0;
        self.last_kind = Kind::None;
        // A fresh session drops the todo projection and reminder state; the
        // model re-declares work with a new `todo init`.
        self.todos = crate::core::agent::todo::TodoList::default();
        self.todo_call_this_turn = false;
        self.todo_ok_this_turn = false;
        self.last_todo_reminder = None;
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
                    started: Instant::now(),
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
    }

    fn input_insert(&mut self, c: char) {
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

    /// Extract the current `@query` from the input buffer, if any.
    /// Returns `None` when the cursor is not inside or immediately after
    /// a `@`-prefixed token (no space since the `@`).
    fn path_hint_query(&self) -> Option<String> {
        let before = &self.input[..self.cursor];
        let at_idx = before.rfind('@')?;
        let after_at = &before[at_idx + 1..];
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
    /// selected path.
    fn accept_path_hint(&mut self) {
        if self.path_hints.is_empty() {
            return;
        }
        let sel = self.path_hint_selected.min(self.path_hints.len() - 1);
        let selected = &self.path_hints[sel];
        let before = &self.input[..self.cursor];
        let at_idx = match before.rfind('@') {
            Some(i) => i,
            None => return,
        };
        let after = &self.input[self.cursor..];
        let replacement = &selected.path;
        let new_input = format!("{}{}{}", &self.input[..at_idx], replacement, after);
        self.input = new_input;
        self.cursor = at_idx + replacement.len();
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
    fn submit_user(&mut self, text: String) {
        // If a turn is already in progress, enqueue the message instead
        if self.status == Status::Running {
            self.message_queue.push_back(text.clone());
            self.note(&format!("⏳ message queued ({} in queue)", self.message_queue.len()));
            return;
        }
        self.ensure_base_snapshot();
        let images = std::mem::take(&mut self.pending_images);
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
        self.push_user_line(&text, &names);
        self.status = Status::Running;
        self.run_started = Some(Instant::now());
        self.turn = (0, 0);
        self.scrollback = 0;
        self.todo_call_this_turn = false;
        self.todo_ok_this_turn = false;
        // A fresh user turn is new context: allow the next boundary to remind
        // again even if the open work is unchanged (dedup is "twice in a row").
        self.last_todo_reminder = None;
        self.want_start = true;
        self.persist();
    }

    /// Inject a hidden todo reminder and continue with one more model turn. The
    /// reminder text enters the conversation (so the model sees it) but renders
    /// as a dim system note, never a user-authored transcript row.
    fn submit_reminder(&mut self, text: String) {
        self.history
            .push(serde_json::json!({ "role": "user", "content": text }));
        self.gap(Kind::Meta);
        self.push(Line::styled(
            "◈ todo reminder — unfinished work, continuing".to_string(),
            Style::new().dim(),
        ));
        self.status = Status::Running;
        self.run_started = Some(Instant::now());
        self.turn = (0, 0);
        self.scrollback = 0;
        self.todo_call_this_turn = false;
        self.todo_ok_this_turn = false;
        self.want_start = true;
        self.persist();
    }

    /// Reminder policy (spec: one bounded reminder at a clean turn boundary).
    /// Fires at most one hidden reminder when open work remains and the assistant
    /// yielded as if finished. Suppressed while an ask/permission is pending, a
    /// goal/plan transition already queued the next turn, another message is
    /// armed, or the agent already updated todos this turn. A todo mutation that
    /// failed this turn queues one retry reminder instead.
    fn maybe_inject_todo_reminder(&mut self, normal: bool, no_answer: bool) {
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
            "max_turns": self.max_turns,
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
                self.starting.clear();
                self.turn = (index, max);
            }
            StreamEvent::ToolCallStarted { id, name } => {
                // Commit buffered prose/reasoning so it renders above the
                // in-progress throbber, matching the grouped-call ordering.
                self.flush_assistant();
                if !self.starting.iter().any(|(sid, _)| sid == &id) {
                    self.starting.push((id, name));
                }
            }
            StreamEvent::ToolCall { id, name, args } => {
                // The full call (with parsed args) supersedes its in-progress
                // throbber.
                self.starting.retain(|(sid, _)| sid != &id);
                // Track todo activity this turn so the reminder policy can tell
                // an engaged turn (mutated todos) from a stalled one.
                if name == "todo" {
                    self.todo_call_this_turn = true;
                }
                // Awaiting a subagent is a long block: show a live throbber row
                // (advanced each render tick) instead of a static grouped row,
                // cleared when its result arrives.
                if name == "await_subagent" {
                    // Commit any buffered reasoning/prose the model emitted
                    // before awaiting so it folds to its summary row instead of
                    // lingering fully expanded in the live tail behind the
                    // throbber (matches the grouped-call path below).
                    self.flush_assistant();
                    let run_id = args.get("run_id").and_then(|v| v.as_str()).unwrap_or("");
                    let sub = subagent_name_from_run_id(run_id).to_string();
                    self.awaiting.push((id, run_id.to_string(), sub));
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
                self.awaiting.retain(|(await_id, ..)| await_id != &id);
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
                self.awaiting.retain(|(_, r, _)| r != &run_id);
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
            self.gap(Kind::Meta);
            self.push(Line::styled(msg, Style::new().yellow().bold()));
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
        self.maybe_inject_todo_reminder(normal, no_answer);
        self.persist();
    }

    /// Whether auto-compaction should trigger after a turn completes.
    fn should_auto_compact(&self) -> bool {
        let limit = self.context_window.saturating_sub(self.reserve_tokens);
        self.tokens > limit && self.tokens > 0 && self.history.len() > 4
    }

    fn on_error(&mut self, code: String, message: String) {
        self.finalize_tool_group();
        self.flush_assistant();
        self.status = Status::Idle;
        self.run_started = None;
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
                    self.gap(Kind::Meta);
                    self.push(Line::styled(
                        format!(
                            "◎ goal achieved in {turns} turn(s), {}",
                            fmt_duration(elapsed)
                        ),
                        Style::new().green().bold(),
                    ));
                    self.push(Line::styled(format!("  {}", v.reason), Style::new().dim()));
                    self.persist();
                } else {
                    // Goal unmet: surface the reason as guidance and start the
                    // next turn automatically, no user prompt needed.
                    self.note(&format!("◎ goal not met: {} — continuing", v.reason));
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
        self.finalize_tool_group();
        let answer = self.take_answer();
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
        self.detail = "cancelled".to_string();
        self.scrollback = 0;
        self.gap(Kind::Meta);
        self.push(Line::styled("cancelled", Style::new().yellow()));
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

/// Summarize tool output to one transcript line: first non-empty line with its
/// internal whitespace collapsed, truncated to `max`, plus a `(+N lines)`
/// suffix when more follow.
/// Rough token count from message content characters (~4 chars ≈ 1 token).
fn estimate_token_count(messages: &[serde_json::Value]) -> u64 {
    let mut total_chars: usize = 0;
    for msg in messages {
        if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
            total_chars += content.len();
        }
        if let Some(calls) = msg.get("tool_calls") {
            if let Some(arr) = calls.as_array() {
                for call in arr {
                    if let Some(args) = call.get("arguments") {
                        total_chars += args.to_string().len();
                    }
                }
            }
        }
    }
    (total_chars / 4).max(1) as u64
}

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
                Span::styled(call.done.clone(), Style::new().dim()),
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
                for line in diff_lines(diff, max, cont_gutter) {
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

/// Live row for the still-open tool group: a braille throbber in place of the
/// static `▸` tag, plus elapsed time, so the user can see it's actively
/// working and how long it's taken. Rebuilt fresh every draw (not stored in
/// `transcript`) since the group's row there is only overwritten on the next
/// tool call, not every tick.
fn running_group_row(group: &ToolGroup, spinner_frame: usize, width: u16) -> Line<'static> {
    let frame = SPINNER[spinner_frame % SPINNER.len()];
    let elapsed = group.started.elapsed().as_secs();
    let text = format!("{} ({elapsed}s)", group_activity(&group.nouns));
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

/// Await the background MCP-connect task once, returning the connected server
/// names (empty if none / on task failure).
///
/// The handle is borrowed, not taken: this future is rebuilt (and dropped) every
/// select iteration, so taking it would discard the still-running task the first
/// time another branch wins the race. The slot is cleared only on completion.
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
        max_turns,
        context_window,
        reserve_tokens,
        max_tokens,
        mcp_servers,
        mcp_task,
    } = session;
    let ask_requests = crate::core::agent::interaction::new_registry();
    args.ask_requests = Some(ask_requests.clone());
    let todo_registry = crate::core::agent::todo::new_registry();
    args.todo_registry = Some(todo_registry.clone());
    let args = Arc::new(args);

    enable_raw_mode().map_err(|e| e.to_string())?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableBracketedPaste, EnableMouseCapture)
        .map_err(|e| e.to_string())?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|e| e.to_string())?;

    // A git repo enables workspace snapshots (rewind can restore files); a
    // non-repo runs exactly as before with conversation-only rewind.
    let repo_root = git::repo_root(&project_root);
    let mut app = App::new(model, max_turns, context_window, reserve_tokens, max_tokens, agent_dir, project_root, repo_root);
    app.smol_model = smol_model;
    app.args = Some(args.clone());
    // Adopt the session's startup run mode (e.g. `--plan`) so the header badge
    // shows immediately; a resumed thread overrides this via restore_run_mode.
    app.run_mode = args.run_mode;
    if args.yolo {
        app.note("--yolo: sandbox disabled, all tool calls auto-approved without prompting");
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

    let _ = disable_raw_mode();
    let _ = execute!(
        terminal.backend_mut(),
        DisableBracketedPaste,
        DisableMouseCapture,
        LeaveAlternateScreen,
    );
    let _ = terminal.show_cursor();
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
    mut mcp_task: Option<tokio::task::JoinHandle<Vec<String>>>,
    mcp_servers: &crate::core::state::SharedMcpServers,
) -> Result<(), String> {
    let mut current: Option<CurrentRun> = None;
    let mut ticker = tokio::time::interval(Duration::from_millis(50));
    // Mirrors app.mouse_capture; `run` enables capture on the real terminal
    // before this loop starts, so both start in sync.
    let mut mouse_capture_active = true;

    // Active MCP servers connect in the background; gate the first run on them
    // so the model's tools (collected once per run) are ready.
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
        if app.want_start && current.is_none() {
            let base_ready = app.repo_root.is_none() || app.base_snapshot.is_some();
            if mcp_ready && base_ready {
                app.want_start = false;
                current = Some(spawn_run(args, app.body()));
            } else if !loading_noted && !mcp_ready {
                // The base snapshot gates silently; only the MCP connect notes.
                loading_noted = true;
                app.note("connecting MCP servers...");
            }
        }

        terminal
            .draw(|f| draw(f, app))
            .map_err(|e| e.to_string())?;

        tokio::select! {
            _ = ticker.tick() => {
                // Advance the frame counter always so the cursor blinks even when idle.
                app.spinner_frame = app.spinner_frame.wrapping_add(1);
                while event::poll(Duration::ZERO).unwrap_or(false) {
                    match event::read() {
                        Ok(Event::Key(key)) => {
                            if !handle_ask_key(app, key, ask_requests).await {
                                handle_key(app, key, registry, &mut current, mcp_servers).await;
                            }
                            if app.mouse_capture != mouse_capture_active {
                                mouse_capture_active = app.mouse_capture;
                                // Written straight to stdout (not through the generic
                                // `Backend`) since chat_loop is generic over B for
                                // testability with TestBackend, which isn't io::Write.
                                let mut stdout = io::stdout();
                                let _ = if mouse_capture_active {
                                    execute!(stdout, EnableMouseCapture)
                                } else {
                                    execute!(stdout, DisableMouseCapture)
                                };
                            }
                        }
                        Ok(Event::Paste(text)) => {
                            for c in text.chars() {
                                app.input_insert(c);
                            }
                        }
                        Ok(Event::Mouse(mouse)) => {
                            if !handle_ask_mouse(app, mouse, ask_requests).await {
                                handle_mouse(app, mouse);
                            }
                        }
                        _ => {}
                    }
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
                    // Auto-compact when approaching the context limit.
                    if app.should_auto_compact() {
                        let model = app.model.clone();
                        let mut history = std::mem::take(&mut app.history);
                        let before = history.len();
                        // Show feedback immediately before the blocking model call.
                        app.note("auto-compacting...");
                        let compacted = crate::core::agent::r#loop::compact_history(
                            args, &model, &history,
                            crate::core::agent::compaction::DEFAULT_KEEP_RECENT,
                        )
                        .await;
                        // Remove the "auto-compacting..." note.
                        app.transcript.retain(|l| {
                            let text: String = l.spans.iter().map(|s| s.content.as_ref()).collect();
                            !text.contains("auto-compacting")
                        });
                        match compacted {
                            Ok(c) if c.len() < before => {
                                history = c;
                                app.history = history;
                                // Update token estimate from compacted content.
                                app.tokens = estimate_token_count(&app.history);
                                app.persist();
                                app.note(&format!(
                                    "auto-compacted {} -> {} messages (ctx {}K/{}K)",
                                    before,
                                    app.history.len(),
                                    app.tokens / 1000,
                                    app.context_window / 1000,
                                ));
                            }
                            Ok(_) => {
                                app.history = history;
                            }
                            Err(e) => {
                                app.history = history;
                                app.note(&format!("auto-compaction failed: {e}"));
                            }
                        }
                    }
                }
                Some(StreamEvent::Error { code, message }) => {
                    app.on_error(code, message);
                    current = None;
                }
                Some(other) => app.apply(other),
                None => {
                    // Stream closed without a terminal event (aborted task).
                    // Keep any partial prose/tool calls already streamed.
                    app.pending_queue.clear();
                    if app.status == Status::Running {
                        app.flush_assistant();
                        app.finalize_tool_group();
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

/// A left click on a folded row (tool group / reasoning block / subagent
/// summary) toggles its detail, the same as Ctrl-O but for a single region.
/// Ignores clicks outside the transcript viewport or on rows that aren't a
/// region's own summary row (detail lines, blank padding, etc).
fn handle_mouse(app: &mut App, mouse: MouseEvent) {
    // Wheel scrolls the transcript (clamped to `max_back` on the next draw);
    // one notch matches a single arrow-key step.
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            app.scrollback = app.scrollback.saturating_add(1);
            return;
        }
        MouseEventKind::ScrollDown => {
            app.scrollback = app.scrollback.saturating_sub(1);
            return;
        }
        _ => {}
    }
    if !matches!(mouse.kind, MouseEventKind::Down(MouseButton::Left)) {
        return;
    }
    let rect = app.transcript_rect;
    if mouse.column < rect.x
        || mouse.column >= rect.x + rect.width
        || mouse.row <= rect.y
        || mouse.row >= rect.y + rect.height.saturating_sub(1)
    {
        return;
    }
    // Top border consumes one row; the rest maps 1:1 onto `row_index` since
    // summary rows are pre-truncated to the viewport width and never wrap.
    let body_row = (mouse.row - rect.y - 1) as usize;
    let absolute = app.last_scroll as usize + body_row;
    if let Some(Some(idx)) = app.row_index.get(absolute) {
        app.toggle_region(*idx);
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
    if key.kind != KeyEventKind::Press {
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

    // Global: toggle mouse capture so the terminal's native text selection
    // works (crossterm's mouse capture otherwise claims all mouse input).
    if ctrl && key.code == KeyCode::Char('t') {
        app.mouse_capture = !app.mouse_capture;
        app.note(if app.mouse_capture {
            "mouse capture on: click to expand"
        } else {
            "mouse capture off: drag to select/copy text (Ctrl-T to re-enable)"
        });
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
                app.push(Line::styled(
                    format!("• denied: {}", pending.summary()),
                    Style::new().red(),
                ));
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
                if app.input.trim() != matches[sel].name {
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
        KeyCode::Char(c) if !ctrl => {
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
        hint: "[exit]",
        description: "Enter read-only plan mode (bare) or /plan exit to leave",
    },
    SlashCommand {
        name: "/todo",
        hint: "[add [phase|] text]",
        description: "Open the todo editor (bare) or /todo add ... to append a task",
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
        name: "/cancel",
        hint: "[N]",
        description: "Cancel queued messages (bare: all, or index)",
    },
    SlashCommand {
        name: "/config",
        hint: "",
        description: "View provider config (~/.jan/config.toml)",
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
            app.push(Line::styled(
                "  Ctrl-T toggles mouse capture off to select/copy text".to_string(),
                Style::new().dim(),
            ));
        }
        "clear" => {
            app.reset_session();
            app.note("conversation cleared");
        }
        "new" => {
            app.reset_session();
            app.note("started a new session");
        }
        "compact" => compact_command(app).await,
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
        "config" => open_config_screen(app),
        "goal" => goal_command(app, arg),
        "plan" => plan_command(app, arg),
        "todo" => todo_command(app, arg).await,
        "cancel" => cancel_command(app, arg),
        "quit" | "exit" => app.should_quit = true,
        other => app.note(&format!("unknown command '/{other}' (try /help)")),
    }
}

/// Manually compact the conversation: summarize older turns, keeping the recent
/// tail, then persist. Blocks the event loop for one model call; runs only while
/// idle (the caller gates on `Status::Idle`).
async fn compact_command(app: &mut App) {
    let Some(args) = app.args.clone() else {
        app.note("compaction unavailable (no active session)");
        return;
    };
    let before = app.history.len();
    match crate::core::agent::r#loop::compact_history(
        &args,
        &app.model,
        &app.history,
        crate::core::agent::compaction::MANUAL_KEEP_RECENT,
    )
    .await
    {
        Ok(compacted) if compacted.len() < before => {
            app.history = compacted;
            app.persist();
            // Estimate tokens from compacted message content (~4 chars ≈ 1 token).
            app.tokens = estimate_token_count(&app.history);
            app.note(&format!(
                "compacted {before} -> {} messages (ctx {}K/{}K)",
                app.history.len(),
                app.tokens / 1000,
                app.context_window / 1000,
            ));
        }
        Ok(_) => app.note("nothing to compact yet"),
        Err(e) => app.note(&format!("compaction failed: {e}")),
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

/// `/plan` dispatcher: bare enters read-only plan mode, `/plan exit` leaves it.
/// Only settable while idle so it never races the live tool set of a running
/// turn (spec). Enforcement is at the core dispatcher; this just flips the
/// per-turn flag forwarded in `App::body()` and persists it.
fn plan_command(app: &mut App, arg: &str) {
    use crate::core::agent::plan::RunMode;
    if app.status != Status::Idle {
        app.note("plan mode is only settable while idle");
        return;
    }
    match arg.trim() {
        "exit" => {
            if app.run_mode == RunMode::Plan {
                app.run_mode = RunMode::Normal;
                app.persist();
                app.note("exited plan mode (normal execution)");
            } else {
                app.note("not in plan mode");
            }
        }
        "" => {
            if app.run_mode == RunMode::Plan {
                app.note("already in plan mode (/plan exit to leave)");
                return;
            }
            app.run_mode = RunMode::Plan;
            app.persist();
            app.note("◈ PLAN · read only — investigate, then propose a plan for review");
            if app.goal.is_some() {
                app.note("active goal paused while planning; it resumes on exit");
            }
        }
        other => app.note(&format!("usage: /plan [exit]  (got '{other}')")),
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
    let Some(rest) = arg.strip_prefix("add") else {
        app.note("usage: /todo   (open editor)   |   /todo add [PHASE |] TEXT");
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
    app.gap(Kind::Meta);
    app.push(Line::styled(
        format!("◎ goal [{state}]"),
        Style::new().cyan().bold(),
    ));
    app.push(Line::styled(
        format!("  condition: {}", goal.condition),
        Style::new().dim(),
    ));
    app.push(Line::styled(
        format!(
            "  turns: {}   duration: {}",
            goal.turns,
            fmt_duration(goal.elapsed_secs())
        ),
        Style::new().dim(),
    ));
    let reason = if goal.last_reason.is_empty() {
        "(not evaluated yet)"
    } else {
        &goal.last_reason
    };
    app.push(Line::styled(
        format!("  evaluator: {reason}"),
        Style::new().dim(),
    ));
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

    app.history.truncate(cut);
    app.checkpoints.retain(|c| c.user_index < target);
    rebuild_transcript(app);
    app.status = Status::Idle;
    app.run_started = None;
    app.scrollback = 0;
    app.note(&format!("rewound to message #{}", target + 1));
    app.persist();
}

/// Re-render the transcript from the current `history` after a rewind.
fn rebuild_transcript(app: &mut App) {
    app.transcript.clear();
    app.tool_group = None;
    app.grouped_ids.clear();
    app.starting.clear();
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
            app.push_user_line(&text, &[]);
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
    if skipped > 0 {
        app.note(&format!("{skipped} unreadable message(s) were skipped"));
    }
}

/// Infer an image MIME type from a file extension, defaulting to PNG.
fn image_mime(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

/// Read an image file into a `PendingImage` (base64 data URL + basename).
fn load_image_file(path: &str) -> Result<PendingImage, String> {
    use base64::Engine;
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

fn draw(f: &mut Frame, app: &mut App) {
    let input_h = input_box_height(app, f.area().width);
    // A one-line compact todo strip sits just below the header when todos exist
    // and no overlay is open. Kept out of the layout otherwise so a todo-free
    // session (or an open picker) renders exactly as before.
    let show_todo = app.picker.is_none() && !app.todos.is_empty();
    let raw = if show_todo {
        Layout::vertical([
            Constraint::Length(1), // header
            Constraint::Length(1), // todo strip
            Constraint::Min(1),
            Constraint::Length(input_h),
            Constraint::Length(1), // path line
            Constraint::Length(1), // footer
        ])
        .split(f.area())
    } else {
        Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(input_h),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(f.area())
    };
    let todo_area = show_todo.then(|| raw[1]);
    // Remap to a stable [header, body, input, path, footer] so the rest of draw
    // is indifferent to whether the strip is present.
    let base = if show_todo { 1 } else { 0 };
    let chunks = [raw[0], raw[base + 1], raw[base + 2], raw[base + 3], raw[base + 4]];

    f.render_widget(header(app), chunks[0]);
    if let Some(area) = todo_area {
        f.render_widget(todo_strip(app), area);
    }

    // Top/bottom borders only, so wrapping uses the full width; the two border
    // rows reduce the vertical viewport. Cache the width so flushed tables wrap.
    let width = chunks[1].width.max(1);
    app.view_width = width;

    if let Some(picker) = &app.picker {
        app.row_index.clear();
        draw_picker(f, chunks[1], picker);
        f.render_widget(input_box(app), chunks[2]);
        f.render_widget(path_line(app), chunks[3]);
        f.render_widget(footer(app), chunks[4]);
        return;
    }

    let mut lines: Vec<Line<'static>> = Vec::with_capacity(app.transcript.len());
    // Parallel to `lines`: which transcript index (if any) owns each rendered
    // row, so a mouse click can be mapped back to a region to toggle.
    let mut row_index: Vec<Option<usize>> = Vec::with_capacity(app.transcript.len());
    let mut reveal_at: Option<usize> = None;
    for (i, line) in app.transcript.iter().enumerate() {
        if app.reveal == Some(i) {
            reveal_at = Some(lines.len());
        }
        if let Some(row) = app
            .tool_group
            .as_ref()
            .filter(|g| g.idx == i && g.is_running())
            .map(|g| running_group_row(g, app.spinner_frame, width))
        {
            lines.push(row);
        } else {
            lines.push(line.clone());
        }
        row_index.push(Some(i));
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
                        .map(|block| block.detail.clone())
                });
            if let Some(detail) = detail {
                row_index.extend(std::iter::repeat(Some(i)).take(detail.len()));
                lines.extend(detail);
            }
        }
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
    // Awaiting throbbers render last: below the assistant's reasoning/message
    // so the "still waiting" state trails the prose that led up to the wait.
    if !app.awaiting.is_empty() || !app.starting.is_empty() {
        let last_blank = lines
            .last()
            .map(|l| l.spans.iter().all(|s| s.content.trim().is_empty()))
            .unwrap_or(true);
        if !last_blank {
            lines.push(Line::raw(""));
        }
    }
    for (_, _, name) in &app.awaiting {
        let frame = SPINNER[app.spinner_frame % SPINNER.len()];
        lines.push(tool_row(
            frame,
            Style::new().cyan(),
            &format!("Awaiting subagent: {name}"),
            Style::new().cyan().dim(),
        ));
    }
    // In-progress tool calls whose arguments are still streaming: a throbber
    // trails the prose until the full call (with args) arrives and renders its
    // own row.
    for (_, name) in &app.starting {
        let frame = SPINNER[app.spinner_frame % SPINNER.len()];
        lines.push(tool_row(
            frame,
            Style::new().cyan(),
            &format!("Preparing {name}"),
            Style::new().cyan().dim(),
        ));
    }
    // Live subagent panels, streaming prose, and awaiting throbbers above have
    // no transcript index; they're all appended after the transcript loop.
    row_index.resize(lines.len(), None);

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
        let mut padded_idx = vec![None; pad as usize];
        padded_idx.append(&mut row_index);
        row_index = padded_idx;
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
    app.transcript_rect = chunks[1];
    app.last_scroll = scroll;
    app.row_index = row_index;

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
    f.render_widget(path_line(app), chunks[3]);
    f.render_widget(footer(app), chunks[4]);

    // An interactive question owns the dock while active. Permission prompts
    // remain queued behind it and surface as soon as the question resolves.
    if !app.ask_queue.is_empty() {
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

/// Render a duration as a compact `"12s"` / `"3m12s"` / `"1h04m"` label.
fn format_elapsed(secs: u64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m{:02}s", secs / 60, secs % 60)
    } else {
        format!("{}h{:02}m", secs / 3600, (secs % 3600) / 60)
    }
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
    let elapsed = app
        .run_started
        .map(|t| format!("  {}", format_elapsed(t.elapsed().as_secs())))
        .unwrap_or_default();
    let mut spans = vec![
        Span::styled(" jan agent ", Style::new().on_blue().white().bold()),
        Span::raw(format!("  {}  ", app.model)),
    ];
    spans.push(Span::raw(format!("  {turn}")));
    if app.tokens > 0 {
        spans.push(Span::raw(format!(
            "ctx {}K/{}K  ",
            // Round to nearest K for display clarity.
            (app.tokens + 500) / 1000,
            app.context_window / 1000
        )));
    } else {
        spans.push(Span::raw(format!("ctx 0/{}K  ", app.context_window / 1000)));
    }
    spans.push(Span::styled(elapsed, Style::new().dim()));
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
    spans.push(Span::styled(format!("[{status}]"), style));
    Paragraph::new(Line::from(spans))
}

/// Compact one-line todo widget: `☑ done/total · ▸ [phase] active · next: a, b, c`.
/// Reads only the data-access helpers on `TodoList`; rendering never mutates.
fn todo_strip(app: &App) -> Paragraph<'static> {
    let (done, total) = app.todos.done_total();
    let mut spans = vec![
        Span::styled(format!(" ☑ {done}/{total}"), Style::new().cyan().bold()),
    ];
    if let Some((phase, task)) = app.todos.active() {
        let active = if phase.name.is_empty() {
            format!("  ▸ {}", task.content)
        } else {
            format!("  ▸ [{}] {}", phase.name, task.content)
        };
        spans.push(Span::styled(active, Style::new().white()));
    }
    let next = app.todos.next_pending(3);
    if !next.is_empty() {
        let preview = next
            .iter()
            .map(|(_, t)| *t)
            .collect::<Vec<_>>()
            .join(", ");
        spans.push(Span::styled(
            format!("  next: {preview}"),
            Style::new().dim(),
        ));
    }
    spans.push(Span::styled("   /todo".to_string(), Style::new().dark_gray()));
    Paragraph::new(Line::from(spans))
}

/// Max content rows the input box grows to before it scrolls internally.
const MAX_INPUT_ROWS: u16 = 8;

/// Height (incl. borders) the message box should occupy: 1 content row for the
/// idle/working placeholder, or the wrapped input height clamped to
/// `MAX_INPUT_ROWS` while editing.
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
    content + 2
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
    if app.picker.is_some() {
        Paragraph::new(Line::styled("selecting…", Style::new().dim().italic())).block(block)
    } else if app.status == Status::Running && app.input.is_empty() {
        // Show queue status when running with empty input
        if app.message_queue.is_empty() {
            Paragraph::new(Line::styled(
                "working… (Esc to cancel, type to queue next message)",
                Style::new().dim().italic(),
            ))
            .block(block)
        } else {
            let n = app.message_queue.len();
            let msg = format!("⏳ Queued ({n}) — Esc to cancel, type to add more");
            Paragraph::new(Line::styled(msg, Style::new().yellow())).block(block)
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

/// One-line path display shown below the input box.
fn path_line(app: &App) -> Paragraph<'static> {
    let path = app.project_root.to_string_lossy();
    let mut spans = vec![
        Span::styled("📂 ", Style::new().dark_gray()),
        Span::styled(path.to_string(), Style::new().dark_gray()),
    ];
    if let Some(branch) = app.git_branch.as_ref() {
        spans.push(Span::styled(
            format!(" ⎇ {}", branch),
            Style::new().dark_gray(),
        ));
    }
    Paragraph::new(Line::from(spans))
}

fn footer(app: &App) -> Paragraph<'static> {
    if !app.pending_queue.is_empty() {
        return Paragraph::new(Line::from(hint_spans(
            Style::new().yellow().bold(),
            &[
                ("↑/↓", "select"),
                ("Enter", "confirm"),
                ("Esc", "deny"),
                ("Ctrl-C", "cancel"),
            ],
        )));
    }
    if let Some(picker) = &app.picker {
        return Paragraph::new(Line::styled(picker.action_hint(), Style::new().dim()));
    }
    let key_style = Style::new().cyan().bold();
    let queue_count = app.message_queue.len();
    let mut spans = match app.status {
        Status::Running => {
            let mut s = hint_spans(
                key_style,
                &[
                    ("Esc/Ctrl-C", "cancel"),
                    ("↑/↓", "scroll"),
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
            let mut s = hint_spans(
                key_style,
                &[
                    ("Enter", "send"),
                    ("Alt+Enter", "newline"),
                    ("/help", ""),
                    ("↑/↓", "scroll"),
                    ("Ctrl-O", "expand all"),
                    ("Ctrl-D", "quit"),
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
    };
    if !app.detail.is_empty() {
        spans.push(Span::styled(
            format!("   {}", app.detail),
            Style::new().dim(),
        ));
    }
    Paragraph::new(Line::from(spans))
}

#[cfg(test)]
mod tests {
    use super::{
        build_user_message, clipboard_path, diff_lines, group_activity, group_detail_lines,
        apply_resume, build_user_message, clipboard_path, diff_lines, group_activity, group_detail_lines,
        group_summary, handle_ask_key, handle_ask_mouse, handle_key, handle_mouse, image_mime,
        input_content_lines, is_table_separator, load_image_file, message_text,
        open_config_screen, parse_command, render_table, restore_goal, restore_run_mode,
        restore_todos, run_command,
        running_group_row, split_reasoning, subagent_activity, subagent_name_from_run_id,
        summarize_result, tool_activity, tool_finished, transcript_top_padding,
        user_content_parts, App, CurrentRun, Pending, PendingImage, PickerKind, ResumeTarget,
        SnapshotJob, Status, DIFF_MAX_ROWS, SLASH_COMMANDS, SPINNER,
    };
    use ratatui::crossterm::event::{
        KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
    };
    use ratatui::layout::Rect;
    use ratatui::{style::Modifier, text::Line};
    use crate::core::agent::events::StreamEvent;
    use crate::core::agent::r#loop::PermissionRegistry;
    use crate::core::agent::tools::gate::PermissionDecision;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn test_app() -> App {
        // Persist into a unique temp dir so tests that save threads never
        // dirty the working tree (src-tauri/threads/).
        let agent_dir = std::env::temp_dir().join(format!(
            "jan_tui_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        App::new("m".into(), 8, 128_000, 16_384, None, agent_dir, std::path::PathBuf::from("/tmp/repo"), None)
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

        let rendered: Vec<String> = app.transcript.iter().map(line_text).collect();
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
        });
        app.apply(StreamEvent::SubagentStart {
            run_id: "r2".into(),
            name: "explorer".into(),
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
    fn cancel_clears_pending_run_start() {
        let mut app = test_app();
        // Submit while the run is still gated on model/MCP/snapshot readiness:
        // want_start is armed but no run has spawned yet.
        app.submit_user("do a thing".into());
        assert!(app.want_start, "submit should arm want_start");
        assert_eq!(app.status, Status::Running);
        app.cancel_run();
        assert!(
            !app.want_start,
            "cancel must drop the pending start or the loop re-spawns it"
        );
        assert_eq!(app.status, Status::Idle);
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

        handle_mouse(
            &mut app,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 5,
                row: 1,
                modifiers: KeyModifiers::NONE,
            },
        );
        assert!(app.expanded.contains(&group_idx));

        // Clicking outside the viewport (past the bottom border) is a no-op.
        handle_mouse(
            &mut app,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 5,
                row: 9,
                modifiers: KeyModifiers::NONE,
            },
        );
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
        handle_mouse(
            &mut app,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 5,
                row: 2, // a detail row, not the header at row 1
                modifiers: KeyModifiers::NONE,
            },
        );
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
    fn apply_resume_latest_restores_history_and_model() {
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
        apply_resume(&mut fresh, &ResumeTarget::Latest);

        assert_eq!(fresh.thread_id.as_deref(), Some(id.as_str()));
        assert_eq!(fresh.history, history);
        assert_eq!(fresh.model, "saved-model");
        let joined: String = fresh
            .transcript
            .iter()
            .map(|l| line_text(l))
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

    #[test]
    fn apply_resume_notes_when_nothing_to_resume() {
        let mut app = test_app();
        apply_resume(&mut app, &ResumeTarget::Latest);
        let joined: String = app
            .transcript
            .iter()
            .map(|l| line_text(l))
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
    async fn ctrl_t_toggles_mouse_capture() {
        let mut app = test_app();
        assert!(app.mouse_capture, "capture starts on");
        let registry: PermissionRegistry = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mcp_servers: crate::core::state::SharedMcpServers =
            Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let mut current: Option<CurrentRun> = None;
        let key = KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL);

        handle_key(&mut app, key, &registry, &mut current, &mcp_servers).await;
        assert!(!app.mouse_capture);
        handle_key(&mut app, key, &registry, &mut current, &mcp_servers).await;
        assert!(app.mouse_capture);
    }

    #[tokio::test]
    async fn compact_command_notes_when_unavailable() {
        let mut app = test_app();
        app.history.push(json!({ "role": "user", "content": "hi" }));
        run_command(&mut app, "compact").await;
        let text: String = app.transcript.iter().map(line_text).collect();
        assert!(text.contains("compaction unavailable"), "got: {text}");
        // History untouched when no session is attached.
        assert_eq!(app.history.len(), 1);
    }

    #[test]
    fn compact_is_a_registered_command() {
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "/compact"));
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
        let text: String = app.transcript.iter().map(line_text).collect();
        assert!(text.contains("goal cleared"), "missing note: {text}");
    }

    #[tokio::test]
    async fn goal_clear_with_no_goal_notes() {
        let mut app = test_app();
        run_command(&mut app, "goal clear").await;
        assert!(app.goal.is_none());
        let text: String = app.transcript.iter().map(line_text).collect();
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
        let text: String = app.transcript.iter().map(line_text).collect();
        assert!(text.contains("make git status clean"), "condition: {text}");
        assert!(text.contains("turns: 3"), "turn count: {text}");
        assert!(text.contains("two files still modified"), "reason: {text}");
    }

    #[tokio::test]
    async fn goal_status_with_no_goal_notes() {
        let mut app = test_app();
        run_command(&mut app, "goal").await;
        let text: String = app.transcript.iter().map(line_text).collect();
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
        let g = restored.goal.expect("goal restored");
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
        let text: String = app.transcript.iter().map(line_text).collect();
        assert!(text.contains("only settable while idle"), "note: {text}");
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
        app.status = Status::Running;
        app.apply(StreamEvent::Token { text: "all set".into() });
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
        let rows: String = app.transcript.iter().map(line_text).collect();
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
        let text: String = app.transcript.iter().map(line_text).collect();
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
}
