//! Agent TUI — a split-panel terminal interface for the jan agent.
//!
//! Layout matches the agent_tui.html mockup:
//!   ┌─ titlebar ──────────────────────────────────────────────┐
//!   │  main panel (chat)             │  right panel (tools)   │
//!   │  messages + input bar          │  tool log + resources  │
//!   ├─ statusbar ─────────────────────────────────────────────┤
//!   └─────────────────────────────────────────────────────────┘

use std::io;
use std::sync::Arc;
use std::time::Instant;

use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
    Frame, Terminal,
};

// ── Color palette (matching the HTML mockup) ─────────────────────────────────

const BG: Color = Color::Rgb(0x0d, 0x0f, 0x12);
const BG2: Color = Color::Rgb(0x13, 0x16, 0x1b);
const BORDER: Color = Color::Rgb(0x2a, 0x2f, 0x3d);
const GREEN: Color = Color::Rgb(0x3d, 0xd6, 0x8c);
const AMBER: Color = Color::Rgb(0xf0, 0xa7, 0x32);
const BLUE: Color = Color::Rgb(0x4a, 0x9e, 0xff);
const RED: Color = Color::Rgb(0xe0, 0x52, 0x52);
const MUTED: Color = Color::Rgb(0x6b, 0x72, 0x80);
const TEXT: Color = Color::Rgb(0xd4, 0xd8, 0xe0);
const TEXT2: Color = Color::Rgb(0x9a, 0xa0, 0xad);
const STATUSBAR_BG: Color = Color::Rgb(0x0a, 0x20, 0x10);
const TERMINAL_BG: Color = Color::Rgb(0x0a, 0x0c, 0x0f);
const PURPLE: Color = Color::Rgb(0xa0, 0x70, 0xf0);

// ── Chat message types ───────────────────────────────────────────────────────

#[derive(Clone)]
pub enum ChatItem {
    User(String),
    Agent(String),
    ToolCall { name: String, args_preview: String },
    ToolResult { name: String, ok: bool, elapsed_ms: u64, summary: String },
    Thinking { step: usize },
}

#[derive(Clone)]
pub struct ToolLogEntry {
    pub kind: ToolLogKind,
    pub text: String,
}

#[derive(Clone)]
pub enum ToolLogKind {
    Info,
    Ok,
    Warn,
    Error,
    Dim,
}

pub struct ResourceBar {
    pub label: &'static str,
    pub value: f64,    // 0.0 .. 1.0
    pub display: String,
    pub color: Color,
}

// ── TUI State ────────────────────────────────────────────────────────────────

pub struct AgentTuiState {
    pub model_id: String,
    pub api_url: String,
    pub session_id: String,

    pub messages: Vec<ChatItem>,
    pub messages_scroll: u16,
    pub messages_auto_scroll: bool,

    pub tool_log: Vec<ToolLogEntry>,
    pub tool_log_scroll: u16,
    pub tool_log_auto_scroll: bool,

    /// Which panel has scroll focus: false = chat (left), true = tool output (right).
    /// Toggle with Tab.
    pub focus_tool_panel: bool,

    pub resources: Vec<ResourceBar>,

    /// Robot/vision server URL (if connected).
    pub robot_server_url: Option<String>,
    /// Latest JPEG frame from the robot camera (shared with background poller).
    pub robot_frame: Arc<std::sync::Mutex<Option<Vec<u8>>>>,
    /// Whether the robot server is reachable.
    pub robot_connected: Arc<std::sync::atomic::AtomicBool>,

    pub input: String,
    pub cursor_pos: usize,

    pub is_thinking: bool,
    pub tool_calls_count: u32,
    pub tokens_used: u32,
    pub tokens_total: u32,
    pub steps: usize,

    pub start_time: Instant,
    pub should_quit: bool,
    pub input_ready: bool, // true when user pressed Enter
}

impl AgentTuiState {
    pub fn new(model_id: String, api_url: String) -> Self {
        // Generate a short session id
        let session_id = format!("{:04x}", rand_u16());
        Self {
            model_id,
            api_url,
            session_id,
            messages: Vec::new(),
            messages_scroll: 0,
            messages_auto_scroll: true,
            tool_log: Vec::new(),
            tool_log_scroll: 0,
            tool_log_auto_scroll: true,
            focus_tool_panel: false,
            resources: vec![
                ResourceBar { label: "KV cache",      value: 0.0, display: "—".into(), color: BLUE },
                ResourceBar { label: "model weights",  value: 0.0, display: "—".into(), color: PURPLE },
                ResourceBar { label: "compute buf",    value: 0.0, display: "—".into(), color: AMBER },
                ResourceBar { label: "Total",         value: 0.0, display: "—".into(), color: GREEN },
                ResourceBar { label: "CPU util",       value: 0.0, display: "—".into(), color: RED },
            ],
            robot_server_url: None,
            robot_frame: Arc::new(std::sync::Mutex::new(None)),
            robot_connected: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            input: String::new(),
            cursor_pos: 0,
            is_thinking: false,
            tool_calls_count: 0,
            tokens_used: 0,
            tokens_total: 0,
            steps: 0,
            start_time: Instant::now(),
            should_quit: false,
            input_ready: false,
        }
    }

    /// Take the current input and reset it. Returns the trimmed input.
    pub fn take_input(&mut self) -> String {
        let s = std::mem::take(&mut self.input).trim().to_string();
        self.cursor_pos = 0;
        self.input_ready = false;
        s
    }

    pub fn push_message(&mut self, item: ChatItem) {
        self.messages.push(item);
        self.messages_auto_scroll = true;
    }

    pub fn push_tool_log(&mut self, kind: ToolLogKind, text: String) {
        self.tool_log.push(ToolLogEntry { kind, text });
        self.tool_log_auto_scroll = true;
    }

    pub fn push_tool_log_dim(&mut self, text: String) {
        self.tool_log.push(ToolLogEntry { kind: ToolLogKind::Dim, text });
        self.tool_log_auto_scroll = true;
    }
}

// ── llamacpp log capture ─────────────────────────────────────────────────────

use std::sync::Mutex;

/// A global buffer that captures `[llamacpp]` log lines during model loading.
/// Enabled by calling `enable_log_capture()` and retrieved with `take_captured_logs()`.
static LOG_CAPTURE: Mutex<String> = Mutex::new(String::new());
static LOG_CAPTURE_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Start capturing `[llamacpp]` log lines.
pub fn enable_log_capture() {
    LOG_CAPTURE_ENABLED.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Stop capturing and return all captured log lines.
pub fn take_captured_logs() -> String {
    LOG_CAPTURE_ENABLED.store(false, std::sync::atomic::Ordering::Relaxed);
    LOG_CAPTURE.lock().map(|mut b| std::mem::take(&mut *b)).unwrap_or_default()
}

/// Called by our custom logger for each log record.
pub fn maybe_capture_log(msg: &str) {
    if LOG_CAPTURE_ENABLED.load(std::sync::atomic::Ordering::Relaxed) && msg.contains("[llamacpp]") {
        if let Ok(mut buf) = LOG_CAPTURE.lock() {
            buf.push_str(msg);
            buf.push('\n');
        }
    }
}

/// A logger that wraps env_logger and also captures llamacpp lines.
pub struct CapturingLogger {
    inner: env_logger::Logger,
}

impl CapturingLogger {
    pub fn init(verbose: bool) {
        let inner = env_logger::Builder::from_env(
            env_logger::Env::default().default_filter_or(if verbose { "info" } else { "warn" }),
        )
        .build();

        let logger = Self { inner };
        log::set_boxed_logger(Box::new(logger)).ok();
        // Must be Info so the logger sees llamacpp lines even when env_logger filter is warn
        log::set_max_level(log::LevelFilter::Info);
    }
}

impl log::Log for CapturingLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        // Always accept info-level logs from llamacpp when capture is active
        if LOG_CAPTURE_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
            && metadata.level() <= log::Level::Info
        {
            return true;
        }
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &log::Record) {
        // Always capture llamacpp lines at info level, even if env_logger filter is warn
        let msg = format!("{}", record.args());
        if LOG_CAPTURE_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
            && record.level() <= log::Level::Info
        {
            maybe_capture_log(&msg);
        }
        // Only forward to env_logger if it would normally accept this record
        if self.inner.enabled(record.metadata()) {
            self.inner.log(record);
        }
    }

    fn flush(&self) {
        self.inner.flush();
    }
}

// ── llamacpp log parser ──────────────────────────────────────────────────────

/// Parsed RAM usage breakdown from llama.cpp startup logs.
#[derive(Default, Debug)]
pub struct LlamacppMemInfo {
    pub model_weights_mib: f64,   // sum of all "model buffer size" lines
    pub kv_cache_mib: f64,        // "llama_kv_cache: size = X MiB"
    pub compute_buf_mib: f64,     // sum of all "compute buffer size" lines
    pub vram_total_mib: f64,      // "recommendedMaxWorkingSetSize = X MB"
}

impl LlamacppMemInfo {
    /// Parse llama.cpp log output and extract memory breakdown.
    /// Pass the full stderr/log output as a single string.
    pub fn from_logs(logs: &str) -> Self {
        let mut info = Self::default();

        for line in logs.lines() {
            // model buffer size  (CPU_Mapped + MTL0_Mapped etc.)
            // "load_tensors:   CPU_Mapped model buffer size =   208.65 MiB"
            // "load_tensors:  MTL0_Mapped model buffer size =  2584.56 MiB"
            if line.contains("model buffer size") {
                if let Some(val) = parse_mib_value(line) {
                    info.model_weights_mib += val;
                }
            }
            // KV cache
            // "llama_kv_cache: size = 2448.00 MiB"
            else if line.contains("llama_kv_cache:") && line.contains("size =") {
                // Extract the first "size = X MiB" from the line
                if let Some(val) = parse_mib_value(line) {
                    info.kv_cache_mib = val;
                }
            }
            // compute buffer size
            // "sched_reserve:       MTL0 compute buffer size =   301.75 MiB"
            // "sched_reserve:        CPU compute buffer size =    74.01 MiB"
            else if line.contains("compute buffer size") {
                if let Some(val) = parse_mib_value(line) {
                    info.compute_buf_mib += val;
                }
            }
            // Total VRAM (macOS unified memory)
            // "recommendedMaxWorkingSetSize  = 26800.60 MB"
            else if line.contains("recommendedMaxWorkingSetSize") {
                if let Some(val) = parse_mb_value(line) {
                    info.vram_total_mib = val;
                }
            }
        }

        info
    }

    /// Total VRAM used by model weights + KV cache + compute buffers.
    pub fn vram_used_mib(&self) -> f64 {
        self.model_weights_mib + self.kv_cache_mib + self.compute_buf_mib
    }
}

/// Extract a "= X MiB" value from a log line.
fn parse_mib_value(line: &str) -> Option<f64> {
    // Look for pattern: "= <number> MiB"
    let idx = line.find("= ")?;
    let after = line[idx + 2..].trim_start();
    let end = after.find(|c: char| !c.is_ascii_digit() && c != '.')?;
    let num_str = &after[..end];
    // Check it's followed by "MiB" or "MB"
    num_str.parse::<f64>().ok()
}

/// Extract a "= X MB" value from a log line.
fn parse_mb_value(line: &str) -> Option<f64> {
    parse_mib_value(line) // Same numeric format
}

fn format_mib(mib: f64) -> String {
    if mib >= 1024.0 {
        format!("{:.1} GB", mib / 1024.0)
    } else {
        format!("{:.0} MB", mib)
    }
}

impl AgentTuiState {
    /// Update resource bars from parsed llama.cpp memory info.
    pub fn set_resources_from_llamacpp(&mut self, mem: &LlamacppMemInfo) {
        let vram_total = if mem.vram_total_mib > 0.0 {
            mem.vram_total_mib
        } else {
            // Fallback: assume 16GB if we don't know
            16384.0
        };

        let vram_used = mem.vram_used_mib();

        // Index 0: KV cache
        self.resources[0].value = mem.kv_cache_mib / vram_total;
        self.resources[0].display = format_mib(mem.kv_cache_mib);

        // Index 1: model weights
        self.resources[1].value = mem.model_weights_mib / vram_total;
        self.resources[1].display = format_mib(mem.model_weights_mib);

        // Index 2: compute buf
        self.resources[2].value = mem.compute_buf_mib / vram_total;
        self.resources[2].display = format_mib(mem.compute_buf_mib);

        // Index 3: VRAM used (total)
        self.resources[3].value = vram_used / vram_total;
        self.resources[3].display = format!("{} / {}", format_mib(vram_used), format_mib(vram_total));

        // Index 4: keep as CPU util (can be updated later)
    }
}

fn rand_u16() -> u16 {
    // Quick non-crypto random from time
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (t & 0xFFFF) as u16
}

// ── Terminal setup / teardown ────────────────────────────────────────────────

pub fn setup_terminal() -> io::Result<Terminal<ratatui::backend::CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    io::stdout().execute(EnterAlternateScreen)?;
    io::stdout().execute(crossterm::event::EnableMouseCapture)?;
    let backend = ratatui::backend::CrosstermBackend::new(io::stdout());
    Terminal::new(backend)
}

pub fn restore_terminal() {
    let _ = io::stdout().execute(crossterm::event::DisableMouseCapture);
    let _ = disable_raw_mode();
    let _ = io::stdout().execute(LeaveAlternateScreen);
}

// ── Input handling ───────────────────────────────────────────────────────────

/// Poll for input events. Returns true if an event was handled.
/// Non-blocking: returns false immediately if no event is pending.
/// Poll for input events with a timeout. Returns true if any event was handled.
/// Use `Duration::ZERO` for non-blocking, or a longer duration to block and save CPU.
pub fn handle_input(state: &mut AgentTuiState, timeout: std::time::Duration) -> bool {
    // Wait up to `timeout` for the first event
    if !event::poll(timeout).unwrap_or(false) {
        return false;
    }
    // Drain all pending events
    let mut handled = false;
    while event::poll(std::time::Duration::ZERO).unwrap_or(false) {
        let Ok(ev) = event::read() else { break };
        handle_single_event(state, ev);
        handled = true;
    }
    handled
}

fn handle_single_event(state: &mut AgentTuiState, ev: Event) {

    match ev {
        Event::Key(KeyEvent { code, modifiers, .. }) => {
            match (code, modifiers) {
                (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                    state.should_quit = true;
                }
                (KeyCode::Char('d'), KeyModifiers::CONTROL) => {
                    state.should_quit = true;
                }
                (KeyCode::Enter, _) if !state.is_thinking => {
                    if !state.input.trim().is_empty() {
                        state.input_ready = true;
                    }
                }
                (KeyCode::Backspace, _) if !state.is_thinking => {
                    if state.cursor_pos > 0 {
                        state.cursor_pos -= 1;
                        state.input.remove(state.cursor_pos);
                    }
                }
                (KeyCode::Delete, _) if !state.is_thinking => {
                    if state.cursor_pos < state.input.len() {
                        state.input.remove(state.cursor_pos);
                    }
                }
                (KeyCode::Left, _) => {
                    if state.cursor_pos > 0 {
                        state.cursor_pos -= 1;
                    }
                }
                (KeyCode::Right, _) => {
                    if state.cursor_pos < state.input.len() {
                        state.cursor_pos += 1;
                    }
                }
                (KeyCode::Home, _) => {
                    state.cursor_pos = 0;
                }
                (KeyCode::End, _) => {
                    state.cursor_pos = state.input.len();
                }
                (KeyCode::Tab, _) => {
                    state.focus_tool_panel = !state.focus_tool_panel;
                }
                (KeyCode::Up, _) => {
                    scroll_focused(state, -1);
                }
                (KeyCode::Down, _) => {
                    scroll_focused(state, 1);
                }
                (KeyCode::PageUp, _) => {
                    scroll_focused(state, -20);
                }
                (KeyCode::PageDown, _) => {
                    scroll_focused(state, 20);
                }
                (KeyCode::Char(c), _) if !state.is_thinking => {
                    state.input.insert(state.cursor_pos, c);
                    state.cursor_pos += 1;
                }
                _ => {}
            }
        }
        Event::Mouse(me) => {
            use crossterm::event::MouseEventKind;
            match me.kind {
                MouseEventKind::ScrollUp => scroll_focused(state, -1),
                MouseEventKind::ScrollDown => scroll_focused(state, 1),
                _ => {}
            }
        }
        _ => {}
    }
}

fn scroll_focused(state: &mut AgentTuiState, delta: i32) {
    if state.focus_tool_panel {
        state.tool_log_auto_scroll = false;
        let new_pos = (state.tool_log_scroll as i32 + delta).max(0) as u16;
        state.tool_log_scroll = new_pos;
    } else {
        state.messages_auto_scroll = false;
        let new_pos = (state.messages_scroll as i32 + delta).max(0) as u16;
        state.messages_scroll = new_pos;
    }
}

// ── Rendering ────────────────────────────────────────────────────────────────

pub fn draw(frame: &mut Frame, state: &mut AgentTuiState) {
    let size = frame.area();

    // Skip drawing if terminal is too small to avoid panics
    if size.width < 20 || size.height < 5 {
        let msg = Paragraph::new("Terminal too small")
            .style(Style::default().fg(MUTED).bg(BG));
        frame.render_widget(msg, size);
        return;
    }

    // Overall layout: titlebar (1) | body | statusbar (1)
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),  // titlebar
            Constraint::Min(10),   // body
            Constraint::Length(1),  // statusbar
        ])
        .split(size);

    draw_titlebar(frame, outer[0], state);
    draw_body(frame, outer[1], state);
    draw_statusbar(frame, outer[2], state);
}

fn draw_titlebar(frame: &mut Frame, area: Rect, state: &AgentTuiState) {
    let status_text = if state.is_thinking { "RUNNING" } else { "READY" };
    let status_color = if state.is_thinking { GREEN } else { MUTED };

    let spans = vec![
        Span::styled("agent", Style::default().fg(TEXT2)),
        Span::styled(" — ", Style::default().fg(MUTED)),
        Span::styled(&state.model_id, Style::default().fg(TEXT2)),
        Span::styled(" — session #", Style::default().fg(MUTED)),
        Span::styled(&state.session_id, Style::default().fg(TEXT2)),
        Span::raw("  "),
        Span::styled(
            format!(" {status_text} "),
            Style::default().fg(status_color).add_modifier(Modifier::BOLD),
        ),
    ];

    let titlebar = Paragraph::new(Line::from(spans))
        .style(Style::default().bg(BG2));
    frame.render_widget(titlebar, area);
}

fn draw_body(frame: &mut Frame, area: Rect, state: &mut AgentTuiState) {
    // Split: main panel (left) | right panel
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(65),
            Constraint::Percentage(35),
        ])
        .split(area);

    draw_main_panel(frame, cols[0], state);
    draw_right_panel(frame, cols[1], state);
}

fn draw_main_panel(frame: &mut Frame, area: Rect, state: &mut AgentTuiState) {
    // Split: messages area | input bar (3 lines)
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(4),
            Constraint::Length(3),
        ])
        .split(area);

    draw_messages(frame, rows[0], state);
    draw_input_bar(frame, rows[1], state);
}

fn draw_messages(frame: &mut Frame, area: Rect, state: &mut AgentTuiState) {
    let border_color = if !state.focus_tool_panel { GREEN } else { BORDER };
    let block = Block::default()
        .borders(Borders::RIGHT)
        .border_style(Style::default().fg(border_color))
        .style(Style::default().bg(BG));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines: Vec<Line> = Vec::new();

    for item in &state.messages {
        match item {
            ChatItem::User(text) => {
                lines.push(Line::from(vec![
                    Span::styled("  > ", Style::default().fg(BLUE)),
                    Span::styled("you", Style::default().fg(BLUE).add_modifier(Modifier::BOLD)),
                ]));
                for l in wrap_text(text, inner.width.saturating_sub(6) as usize) {
                    lines.push(Line::from(vec![
                        Span::styled("  | ", Style::default().fg(BORDER)),
                        Span::styled(l, Style::default().fg(TEXT)),
                    ]));
                }
                lines.push(Line::from(""));
            }
            ChatItem::Agent(text) => {
                lines.push(Line::from(vec![
                    Span::styled("  > ", Style::default().fg(GREEN)),
                    Span::styled("agent", Style::default().fg(GREEN).add_modifier(Modifier::BOLD)),
                ]));
                for l in wrap_text(text, inner.width.saturating_sub(6) as usize) {
                    lines.push(Line::from(vec![
                        Span::styled("  | ", Style::default().fg(BORDER)),
                        Span::styled(l, Style::default().fg(TEXT2)),
                    ]));
                }
                lines.push(Line::from(""));
            }
            ChatItem::ToolCall { name, args_preview } => {
                let preview = if args_preview.is_empty() || args_preview == "{}" || args_preview == "null" {
                    String::new()
                } else {
                    let max = inner.width.saturating_sub(10) as usize;
                    if args_preview.chars().count() > max {
                        let truncated: String = args_preview.chars().take(max.saturating_sub(4)).collect();
                        format!(" {truncated}...")
                    } else {
                        format!(" {args_preview}")
                    }
                };
                lines.push(Line::from(vec![
                    Span::styled("    * ", Style::default().fg(AMBER)),
                    Span::styled(name, Style::default().fg(GREEN)),
                    Span::styled(preview, Style::default().fg(MUTED)),
                ]));
            }
            ChatItem::ToolResult { name, ok, elapsed_ms, summary } => {
                let icon = if *ok { "+" } else { "x" };
                let icon_color = if *ok { GREEN } else { RED };
                let time_str = if *elapsed_ms >= 1000 {
                    format!("{:.1}s", *elapsed_ms as f64 / 1000.0)
                } else {
                    format!("{elapsed_ms}ms")
                };
                let summ = if summary.chars().count() > 60 {
                    let truncated: String = summary.chars().take(57).collect();
                    format!("{truncated}...")
                } else {
                    summary.clone()
                };
                lines.push(Line::from(vec![
                    Span::raw("  "),
                    Span::styled(icon, Style::default().fg(icon_color)),
                    Span::raw(" "),
                    Span::styled(name, Style::default().fg(MUTED)),
                    Span::raw(" "),
                    Span::styled(summ, Style::default().fg(TEXT2)),
                    Span::raw(" "),
                    Span::styled(format!("({time_str})"), Style::default().fg(MUTED)),
                ]));
            }
            ChatItem::Thinking { step } => {
                let dots = match (state.start_time.elapsed().as_millis() / 400) % 4 {
                    0 => "",
                    1 => ".",
                    2 => "..",
                    _ => "...",
                };
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled("*", Style::default().fg(AMBER)),
                    Span::styled(
                        format!(" step {step} thinking{dots}"),
                        Style::default().fg(MUTED),
                    ),
                ]));
            }
        }
    }

    // Calculate scroll
    let content_height = lines.len() as u16;
    let visible_height = inner.height;
    let max_scroll = content_height.saturating_sub(visible_height);

    if state.messages_auto_scroll {
        state.messages_scroll = max_scroll;
    } else {
        state.messages_scroll = state.messages_scroll.min(max_scroll);
    }
    let scroll = state.messages_scroll;

    let paragraph = Paragraph::new(lines)
        .style(Style::default().bg(BG).fg(TEXT))
        .scroll((scroll, 0));
    frame.render_widget(paragraph, inner);

    // Scrollbar
    if max_scroll > 0 {
        let mut scrollbar_state = ScrollbarState::new(max_scroll as usize)
            .position(scroll as usize);
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .thumb_style(Style::default().fg(MUTED))
            .track_style(Style::default().fg(BORDER))
            .begin_symbol(None)
            .end_symbol(None);
        frame.render_stateful_widget(scrollbar, inner, &mut scrollbar_state);
    }
}

fn draw_input_bar(frame: &mut Frame, area: Rect, state: &AgentTuiState) {
    let block = Block::default()
        .borders(Borders::TOP | Borders::RIGHT)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(BG2));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let prompt_style = if state.is_thinking {
        Style::default().fg(MUTED)
    } else {
        Style::default().fg(GREEN)
    };

    let display_input = if state.is_thinking {
        "waiting for agent..."
    } else {
        &state.input
    };

    let input_style = if state.is_thinking {
        Style::default().fg(MUTED).add_modifier(Modifier::ITALIC)
    } else {
        Style::default().fg(TEXT)
    };

    let line = Line::from(vec![
        Span::styled(" > ", prompt_style.add_modifier(Modifier::BOLD)),
        Span::styled(display_input, input_style),
    ]);

    let paragraph = Paragraph::new(line);
    frame.render_widget(paragraph, inner);

    // Show cursor (clamped to inner area to avoid panic on small terminals)
    if !state.is_thinking && inner.width > 3 && inner.height > 0 {
        let cursor_x = (inner.x + 3 + state.cursor_pos as u16).min(inner.x + inner.width - 1);
        frame.set_cursor_position((
            cursor_x,
            inner.y,
        ));
    }
}

fn draw_right_panel(frame: &mut Frame, area: Rect, state: &mut AgentTuiState) {
    if state.robot_server_url.is_some() {
        // Robot mode: tool output (top) + camera frame (bottom, replaces resources)
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(6),        // tool output
                Constraint::Percentage(50), // camera frame
            ])
            .split(area);

        draw_tool_output(frame, rows[0], state);
        draw_camera_frame(frame, rows[1], state);
    } else {
        // Default: tool output + resources
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(6),      // tool output
                Constraint::Length(9),    // resources (5 bars + header + padding)
            ])
            .split(area);

        draw_tool_output(frame, rows[0], state);
        draw_resources(frame, rows[1], state);
    }
}

fn draw_camera_frame(frame: &mut Frame, area: Rect, state: &AgentTuiState) {
    let connected = state.robot_connected.load(std::sync::atomic::Ordering::Relaxed);
    let status_color = if connected { GREEN } else { RED };
    let status_label = if connected { "LIVE" } else { "OFFLINE" };

    let block = Block::default()
        .title(Line::from(vec![
            Span::styled(" * ", Style::default().fg(AMBER)),
            Span::styled("camera ", Style::default().fg(MUTED)),
            Span::styled(
                format!("[{status_label}] "),
                Style::default().fg(status_color).add_modifier(Modifier::BOLD),
            ),
        ]))
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(BG));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if inner.width < 4 || inner.height < 2 {
        return;
    }

    // Try to decode the latest JPEG frame into half-block terminal art
    let jpeg_data = state.robot_frame.lock().ok().and_then(|g| g.clone());

    if let Some(data) = jpeg_data {
        if let Some(lines) = jpeg_to_halfblocks(&data, inner.width as usize, inner.height as usize) {
            let paragraph = Paragraph::new(lines).style(Style::default().bg(BG));
            frame.render_widget(paragraph, inner);
            return;
        }
    }

    // Fallback: no frame or decode failed
    let msg = if connected { "Waiting for frame..." } else { "Robot server not connected" };
    let url_hint = state.robot_server_url.as_deref().unwrap_or("—");
    let lines = vec![
        Line::from(""),
        Line::from(Span::styled(msg, Style::default().fg(MUTED))),
        Line::from(Span::styled(format!("  {url_hint}/frame"), Style::default().fg(MUTED))),
    ];
    let paragraph = Paragraph::new(lines)
        .style(Style::default().bg(BG))
        .alignment(ratatui::layout::Alignment::Center);
    frame.render_widget(paragraph, inner);
}

/// Decode JPEG bytes and render as Unicode half-block characters.
///
/// Each terminal cell shows two vertical pixels using the `▀` character:
/// foreground = top pixel color, background = bottom pixel color.
#[cfg(feature = "cli")]
fn jpeg_to_halfblocks(jpeg_bytes: &[u8], term_w: usize, term_h: usize) -> Option<Vec<Line<'static>>> {
    use std::io::Cursor;

    let img = image::ImageReader::new(Cursor::new(jpeg_bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let rgb = img.to_rgb8();
    let (iw, ih) = (rgb.width() as usize, rgb.height() as usize);

    // Each terminal row represents 2 pixel rows (half-block)
    let pixel_rows = term_h * 2;
    let pixel_cols = term_w;

    let mut lines: Vec<Line<'static>> = Vec::with_capacity(term_h);

    for ty in 0..term_h {
        let mut spans: Vec<Span<'static>> = Vec::with_capacity(pixel_cols);
        for tx in 0..pixel_cols {
            // Map terminal coords to image coords
            let src_x = (tx * iw / pixel_cols).min(iw - 1);
            let src_y_top = (ty * 2 * ih / pixel_rows).min(ih - 1);
            let src_y_bot = ((ty * 2 + 1) * ih / pixel_rows).min(ih - 1);

            let top = rgb.get_pixel(src_x as u32, src_y_top as u32);
            let bot = rgb.get_pixel(src_x as u32, src_y_bot as u32);

            spans.push(Span::styled(
                "▀",
                Style::default()
                    .fg(Color::Rgb(top[0], top[1], top[2]))
                    .bg(Color::Rgb(bot[0], bot[1], bot[2])),
            ));
        }
        lines.push(Line::from(spans));
    }

    Some(lines)
}

#[cfg(not(feature = "cli"))]
fn jpeg_to_halfblocks(_: &[u8], _: usize, _: usize) -> Option<Vec<Line<'static>>> {
    None
}

fn draw_tool_output(frame: &mut Frame, area: Rect, state: &mut AgentTuiState) {
    let title_color = if state.focus_tool_panel { GREEN } else { MUTED };
    let block = Block::default()
        .title(Line::from(vec![
            Span::styled(" > ", Style::default().fg(AMBER)),
            Span::styled("tool output ", Style::default().fg(title_color)),
            if state.focus_tool_panel {
                Span::styled("[focused] ", Style::default().fg(GREEN).add_modifier(Modifier::DIM))
            } else {
                Span::styled("[tab] ", Style::default().fg(MUTED).add_modifier(Modifier::DIM))
            },
        ]))
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(TERMINAL_BG));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines: Vec<Line> = Vec::new();
    // " X " prefix = 3 chars
    let text_width = inner.width.saturating_sub(3) as usize;

    for entry in &state.tool_log {
        let (text_style, prefix) = match entry.kind {
            ToolLogKind::Info => (Style::default().fg(BLUE), " > "),
            ToolLogKind::Ok   => (Style::default().fg(GREEN), " + "),
            ToolLogKind::Warn => (Style::default().fg(AMBER), " ! "),
            ToolLogKind::Error => (Style::default().fg(RED), " x "),
            ToolLogKind::Dim  => (Style::default().fg(MUTED), "   "),
        };

        let wrapped = wrap_text(&entry.text, text_width);
        for (i, wline) in wrapped.into_iter().enumerate() {
            let pfx = if i == 0 { prefix } else { "   " };
            lines.push(Line::from(vec![
                Span::styled(pfx, text_style),
                Span::styled(wline, text_style),
            ]));
        }
    }

    let content_height = lines.len() as u16;
    let visible_height = inner.height;
    let max_scroll = content_height.saturating_sub(visible_height);

    if state.tool_log_auto_scroll {
        state.tool_log_scroll = max_scroll;
    } else {
        state.tool_log_scroll = state.tool_log_scroll.min(max_scroll);
    }
    let scroll = state.tool_log_scroll;

    let paragraph = Paragraph::new(lines)
        .style(Style::default().bg(TERMINAL_BG))
        .scroll((scroll, 0));
    frame.render_widget(paragraph, inner);

    // Scrollbar
    if max_scroll > 0 {
        let mut scrollbar_state = ScrollbarState::new(max_scroll as usize)
            .position(scroll as usize);
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .thumb_style(Style::default().fg(MUTED))
            .track_style(Style::default().fg(BORDER))
            .begin_symbol(None)
            .end_symbol(None);
        frame.render_stateful_widget(scrollbar, inner, &mut scrollbar_state);
    }
}

fn draw_resources(frame: &mut Frame, area: Rect, state: &AgentTuiState) {
    let block = Block::default()
        .title(Line::from(Span::styled(
            " * resources ",
            Style::default().fg(MUTED),
        )))
        .borders(Borders::TOP)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(BG2));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines: Vec<Line> = Vec::new();
    for res in &state.resources {
        if res.display == "—" { continue; }
        lines.push(Line::from(vec![
            Span::styled(format!(" {:<14}", res.label), Style::default().fg(MUTED)),
            Span::styled(&res.display, Style::default().fg(res.color)),
        ]));
    }

    let paragraph = Paragraph::new(lines).style(Style::default().bg(BG2));
    frame.render_widget(paragraph, inner);
}

fn draw_statusbar(frame: &mut Frame, area: Rect, state: &AgentTuiState) {
    let status_dot = if state.is_thinking { "* " } else { "- " };
    let status_text = if state.is_thinking { "agent active" } else { "agent idle" };
    let status_color = if state.is_thinking { GREEN } else { MUTED };

    let mut spans = vec![
        Span::styled(" ", Style::default()),
        // Span::styled(status_dot, Style::default().fg(status_color)),
        // Span::styled(status_text, Style::default().fg(MUTED)),
        // Span::styled("   ", Style::default()),
        // Span::styled(&ctx_text, Style::default().fg(GREEN)),
        // Span::styled("   ", Style::default()),
        // Span::styled(
        //     format!("tools: {} calls", state.tool_calls_count),
        //     Style::default().fg(MUTED),
        // ),
        // Span::styled("   ", Style::default()),
        // Span::styled(&state.model_id, Style::default().fg(MUTED)),
        // Span::styled(" · ", Style::default().fg(MUTED)),
        Span::styled(&state.api_url, Style::default().fg(MUTED)),
    ];

    // Show robot server + resources info in statusbar
    if let Some(ref rurl) = state.robot_server_url {
        spans.push(Span::styled("   ", Style::default()));
        let connected = state.robot_connected.load(std::sync::atomic::Ordering::Relaxed);
        let dot = if connected { "*" } else { "x" };
        let dot_color = if connected { GREEN } else { RED };
        spans.push(Span::styled(dot, Style::default().fg(dot_color)));
        spans.push(Span::styled(" robot: ", Style::default().fg(MUTED)));
        spans.push(Span::styled(rurl.as_str(), Style::default().fg(MUTED)));

        // Compact resource info
        for res in &state.resources {
            if res.display != "—" {
                spans.push(Span::styled("  ", Style::default()));
                spans.push(Span::styled(res.label, Style::default().fg(MUTED)));
                spans.push(Span::styled(": ", Style::default().fg(MUTED)));
                spans.push(Span::styled(&res.display, Style::default().fg(res.color)));
            }
        }
    }

    let statusbar = Paragraph::new(Line::from(spans))
        .style(Style::default().bg(STATUSBAR_BG));
    frame.render_widget(statusbar, area);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut lines = Vec::new();
    for line in text.lines() {
        // Use char count for display width, not byte length
        if line.chars().count() <= width {
            lines.push(line.to_string());
        } else {
            let mut remaining = line;
            while remaining.chars().count() > width {
                // Find the byte offset of the `width`-th char
                let byte_end = remaining
                    .char_indices()
                    .nth(width)
                    .map(|(i, _)| i)
                    .unwrap_or(remaining.len());
                // Try to break at a space within that range
                let break_at = remaining[..byte_end]
                    .rfind(' ')
                    .unwrap_or(byte_end);
                let break_at = if break_at == 0 { byte_end } else { break_at };
                lines.push(remaining[..break_at].to_string());
                remaining = remaining[break_at..].trim_start();
            }
            if !remaining.is_empty() {
                lines.push(remaining.to_string());
            }
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn format_number(n: u32) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}
