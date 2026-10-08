//! Snapshot tests for the TUI's most layout- and style-sensitive surfaces: the
//! permission prompt, the diff preview, the header status badges, the todo and
//! subagent panels, `/agents`, and the model picker.
//!
//! Snapshot or substring? The two catch different regressions, so pick by what
//! would break:
//!
//! - Write a **substring test** (`render_rows(..)` + `contains`) for behaviour:
//!   a word appears, a row is dropped, Enter does the right thing. These
//!   survive cosmetic changes and say exactly what they guard.
//! - Write a **snapshot test** here only when the layout or the styling is the
//!   thing under test: alignment, borders, truncation width, colour and
//!   modifier choices. A substring test is blind to all of those.
//!
//! Do not snapshot a surface just because it exists; each snapshot is a file a
//! reviewer has to re-read on every intentional change. One or two
//! representative states (and widths, where the layout reflows) per surface.
//!
//! Every snapshot renders with motion reduced and a pinned
//! theme (dark truecolor unless the test is about another), and avoids
//! anything read from the clock or the machine: no running `run_started`
//! (the header shows the wall clock while a run is timed), no git branch, no
//! timestamps. Each frame is therefore a pure function of the fixture.
//!
//! Accepting an intentional change: run the tests, then `cargo insta review`
//! (or re-run with `INSTA_UPDATE=always`) and commit the updated `.snap`
//! files. See "Snapshot tests" in `src-tauri/CONTRIBUTING.md`.

use super::*;
use crate::core::agent::todo::TodoStatus::{Abandoned, Completed, InProgress, Pending as Open};
use crate::core::cli::tui::motion::{with_mode, MotionMode};
use crate::core::cli::tui::theme::{with_theme, ColorDepth, Theme};
use ratatui::backend::TestBackend;
use ratatui::widgets::Paragraph;
use ratatui::Terminal;
use std::fmt::Write as _;

const DARK: Theme = Theme {
    light: false,
    depth: ColorDepth::Truecolor,
};
const LIGHT: Theme = Theme {
    light: true,
    depth: ColorDepth::Truecolor,
};
const ANSI16: Theme = Theme {
    light: false,
    depth: ColorDepth::Ansi16,
};

/// Run `f` with every process-wide render input pinned: motion reduced and
/// `theme`.
fn pinned<T>(theme: Theme, f: impl FnOnce() -> T) -> T {
    with_mode(MotionMode::Reduced, || with_theme(theme, f))
}

/// A fresh app with the machine-dependent inputs cleared: the branch is read
/// from `git` at construction and the dock prints the project root, and a
/// real model id reads better than `m`.
fn snapshot_app() -> TestApp {
    let mut app = test_app();
    app.git_branch = None;
    // Outside any plausible `$HOME`, so `tilde_path` never abbreviates it.
    app.project_root = std::path::PathBuf::from("/snapshot/repo");
    app.model = "gpt-5-mini".into();
    app
}

/// Start a turn without the wall clock: the header prints `HH:MM` and the
/// elapsed time while `run_started` is set.
fn start_turn(app: &mut App, text: &str) {
    app.submit_user(text.into());
    app.run_started = None;
}

/// Draw the whole frame, as the render loop does.
fn frame(app: &mut App, theme: Theme, w: u16, h: u16) -> Buffer {
    pinned(theme, || {
        let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
        terminal.draw(|f| super::super::draw(f, app)).unwrap();
        terminal.backend().buffer().clone()
    })
}

/// Draw `lines` alone into a buffer `w` wide and exactly as tall as they are,
/// for a surface built as lines rather than drawn into a frame.
fn lines_buffer(lines: Vec<Line<'static>>, w: u16) -> Buffer {
    let area = Rect::new(0, 0, w, lines.len().max(1) as u16);
    let mut buf = Buffer::empty(area);
    ratatui::widgets::Widget::render(Paragraph::new(lines), area, &mut buf);
    buf
}

/// Serialize a buffer as its text, then its styling as runs.
///
/// Text rows are fenced in `|` so trailing blanks (and so the width) survive
/// editors and diff tools. Styling is listed per row as runs of adjacent cells
/// sharing one style, `row x0..x1 fg=.. bg=.. mod=..`, with columns as cell
/// indices (end exclusive) and unset attributes left out. Unstyled runs are
/// omitted entirely, which keeps a mostly plain frame short.
///
/// The cell behind a wide grapheme holds a placeholder the terminal never
/// shows, so it is skipped in the text, as ratatui's own diff skips it.
fn render_snapshot(buf: &Buffer) -> String {
    let area = buf.area;
    let mut text = String::new();
    let mut styles = String::new();
    for y in 0..area.height {
        let mut row = String::new();
        let mut hidden = 0usize;
        // (start, key) of the run in progress.
        let mut run: Option<(u16, String)> = None;
        for x in 0..area.width {
            let cell = &buf[(area.x + x, area.y + y)];
            if hidden == 0 {
                row.push_str(cell.symbol());
                hidden = UnicodeWidthStr::width(cell.symbol()).max(1);
            }
            hidden -= 1;
            let key = style_key(cell);
            if run.as_ref().is_some_and(|(_, k)| *k != key) {
                let (start, k) = run.take().unwrap();
                push_run(&mut styles, y, start, x, &k);
            }
            if run.is_none() {
                run = Some((x, key));
            }
        }
        if let Some((start, k)) = run {
            push_run(&mut styles, y, start, area.width, &k);
        }
        let _ = writeln!(text, "|{row}|");
    }
    format!("{text}\n{styles}")
}

/// The non-default attributes of a cell, `""` when it is plain.
fn style_key(cell: &ratatui::buffer::Cell) -> String {
    let mut key = Vec::new();
    if cell.fg != Color::Reset {
        key.push(format!("fg={}", cell.fg));
    }
    if cell.bg != Color::Reset {
        key.push(format!("bg={}", cell.bg));
    }
    if !cell.modifier.is_empty() {
        key.push(format!("mod={:?}", cell.modifier));
    }
    key.join(" ")
}

fn push_run(out: &mut String, y: u16, x0: u16, x1: u16, key: &str) {
    if !key.is_empty() {
        let _ = writeln!(out, "{y:>2} {x0}..{x1} {key}");
    }
}

/// Assert `buf` against `snapshots/<name>.snap` beside this file.
fn assert_buffer(name: &str, buf: &Buffer) {
    insta::with_settings!({ prepend_module_to_snapshot => false }, {
        insta::assert_snapshot!(name, render_snapshot(buf));
    });
}

// ---- Header / status badge ------------------------------------------------

fn header_buffer(app: &App, theme: Theme) -> Buffer {
    pinned(theme, || lines_buffer(vec![Line::from(header_spans(app))], 100))
}

#[test]
fn header_idle_ready() {
    let app = snapshot_app();
    assert_buffer("header_idle_ready", &header_buffer(&app, DARK));
}

#[test]
fn header_running_working_with_turn_and_cache() {
    let mut app = snapshot_app();
    start_turn(&mut app, "go");
    app.turn = (3, 20);
    app.tokens = 41_200;
    app.session_cache_reported = true;
    app.session_prompt_tokens = 10_000;
    app.session_cached_tokens = 4_200;
    assert_buffer(
        "header_running_working_with_turn_and_cache",
        &header_buffer(&app, DARK),
    );
}

#[test]
fn header_running_thinking_reduced_motion() {
    let mut app = snapshot_app();
    app.stream_reasoning = false;
    start_turn(&mut app, "go");
    app.apply(StreamEvent::Token {
        text: "<think>pondering".into(),
    });
    assert!(app.is_thinking());
    assert_buffer(
        "header_running_thinking_reduced_motion",
        &header_buffer(&app, DARK),
    );
}

#[test]
fn header_parked_waiting_and_watching() {
    let mut app = snapshot_app();
    start_turn(&mut app, "go");
    app.apply(StreamEvent::Parked);
    let waiting = header_buffer(&app, DARK);
    app.apply(StreamEvent::Monitors {
        monitors: vec![monitor("mon-1", "ok", "grep OK build.log", 1)],
    });
    app.apply(StreamEvent::Parked);
    let watching = header_buffer(&app, DARK);
    assert_buffer("header_parked_waiting", &waiting);
    assert_buffer("header_parked_watching", &watching);
}

#[test]
fn header_zero_cache_hit_on_ansi16() {
    let mut app = snapshot_app();
    app.session_cache_reported = true;
    app.session_prompt_tokens = 8_000;
    app.session_cached_tokens = 0;
    assert_buffer("header_zero_cache_hit_ansi16", &header_buffer(&app, ANSI16));
}

// ---- Permission prompt ----------------------------------------------------

fn permission(app: &mut App, id: &str, command: &str) {
    app.apply(StreamEvent::PermissionRequest {
        request_id: id.into(),
        tool_name: "bash".into(),
        capability: "execute".into(),
        path: None,
        command: Some(command.into()),
        diff: None,
        prompt_kind: "exec".into(),
        offers_always: true,
    });
}

#[test]
fn permission_prompt_for_a_command() {
    let mut app = snapshot_app();
    start_turn(&mut app, "check the tree");
    permission(&mut app, "p1", "git status && cargo test --lib");
    assert_buffer(
        "permission_prompt_exec",
        &frame(&mut app, DARK, 80, 20),
    );
}

#[test]
fn permission_prompt_from_a_subagent_with_a_queue() {
    let mut app = snapshot_app();
    start_turn(&mut app, "fan out");
    app.apply(StreamEvent::Subagent {
        run_id: "sub-scout-1".into(),
        name: "scout".into(),
        event: Box::new(StreamEvent::PermissionRequest {
            request_id: "p1".into(),
            tool_name: "write".into(),
            capability: "write".into(),
            path: Some("notes.md".into()),
            command: None,
            diff: None,
            prompt_kind: "write".into(),
            offers_always: false,
        }),
    });
    permission(&mut app, "p2", "ls");
    assert_eq!(app.pending_queue.len(), 2);
    assert_buffer(
        "permission_prompt_subagent_queued",
        &frame(&mut app, DARK, 72, 18),
    );
}

#[test]
fn permission_prompt_with_a_diff_on_ansi16() {
    let mut app = snapshot_app();
    start_turn(&mut app, "rename it");
    app.apply(StreamEvent::PermissionRequest {
        request_id: "w1".into(),
        tool_name: "edit".into(),
        capability: "write".into(),
        path: Some("src/greet.rs".into()),
        command: None,
        diff: Some(
            concat!(
                "@@ -1,3 +1,3 @@\n",
                " fn greet() {\n",
                "-    println!(\"hi ansi16\");\n",
                "+    println!(\"hello ansi16\");\n",
                " }",
            )
            .into(),
        ),
        prompt_kind: "write".into(),
        offers_always: true,
    });
    assert_buffer(
        "permission_prompt_diff_ansi16",
        &frame(&mut app, ANSI16, 70, 22),
    );
}

// ---- Diff preview ---------------------------------------------------------
//
// The highlighter caches by text, not by theme (the theme is fixed for a
// process outside tests), so each themed variant uses its own source text.

fn diff_buffer(theme: Theme, diff: &str, width: u16, lang: Option<&str>) -> Buffer {
    pinned(theme, || {
        lines_buffer(
            super::super::diff_lines_in(
                theme,
                diff,
                width as usize,
                DIFF_PREVIEW_MAX_ROWS,
                "",
                lang,
            ),
            width,
        )
    })
}

#[test]
fn diff_preview_highlighted_dark() {
    let diff = concat!(
        "@@ -2,4 +2,5 @@\n",
        " use std::fmt;\n",
        "-fn area(w: u32, h: u32) -> u32 {\n",
        "+/// Area in cells.\n",
        "+fn area(w: u64, h: u64) -> u64 {\n",
        "     w * h\n",
        " }",
    );
    assert_buffer(
        "diff_preview_highlighted_dark",
        &diff_buffer(DARK, diff, 64, Some("src/geometry.rs")),
    );
}

#[test]
fn diff_preview_plain_light() {
    let diff = "@@ -1,2 +1,2 @@\n-colour = grey\n+colour = gray\n unchanged = true";
    assert_buffer(
        "diff_preview_plain_light",
        &diff_buffer(LIGHT, diff, 48, None),
    );
}

#[test]
fn diff_preview_truncates_long_rows_and_counts_the_rest() {
    let mut diff = String::from("@@ -1,0 +1,30 @@\n");
    for i in 0..30 {
        let _ = writeln!(diff, "+line {i:02} of a long generated block that overflows the box");
    }
    assert_buffer(
        "diff_preview_truncated_narrow",
        &diff_buffer(DARK, diff.trim_end(), 40, None),
    );
}

// ---- Todo panel -----------------------------------------------------------

#[test]
fn todo_panel_single_phase() {
    let mut app = snapshot_app();
    start_turn(&mut app, "plan it");
    app.todos = todos_from(vec![(
        "",
        vec![
            ("scaffold the crate", Completed),
            ("wire the routes", InProgress),
            ("write the docs", Open),
            ("support windows xp", Abandoned),
        ],
    )]);
    assert_buffer("todo_panel_single_phase", &frame(&mut app, DARK, 80, 16));
}

#[test]
fn todo_panel_multi_phase_beside_the_agents() {
    let mut app = snapshot_app();
    start_turn(&mut app, "build it");
    app.todos = todos_from(vec![
        (
            "backend",
            vec![("scaffold", Completed), ("routes", InProgress), ("auth", Open)],
        ),
        ("frontend", vec![("ui", Open)]),
    ]);
    app.subagents = vec![cached_panel("api-review", 6, 12_000, 9_000, true)];
    assert_buffer(
        "todo_panel_split_with_agents",
        &frame(&mut app, DARK, 100, 18),
    );
}

#[test]
fn todo_panel_stacks_above_the_agents_when_narrow() {
    let mut app = snapshot_app();
    start_turn(&mut app, "build it");
    app.todos = todos_from(vec![(
        "",
        vec![("routes", InProgress), ("auth", Open)],
    )]);
    app.subagents = vec![cached_panel("api-review", 2, 0, 0, false)];
    assert_buffer(
        "todo_panel_stacked_narrow",
        &frame(&mut app, DARK, 60, 18),
    );
}

// ---- Subagent panel and /agents --------------------------------------------

/// The reduced-motion throbber, as `motion::spinner` returns it.
const THROBBER: &str = "\u{2022}";

/// A running child with `calls` calls and, when `reported`, a prompt-cache
/// history of `cached` out of `prompt` tokens.
fn cached_panel(
    name: &str,
    calls: usize,
    prompt: u64,
    cached: u64,
    reported: bool,
) -> SubagentPanel {
    let mut panel = panel_with_calls(name, Vec::new());
    panel.calls = (0..calls).map(|i| format!("read src/mod_{i}.rs")).collect();
    panel.requests = calls as u32;
    panel.prompt_tokens = prompt;
    panel.total_prompt_tokens = prompt;
    panel.total_cached_tokens = cached;
    panel.cache_reported = reported;
    panel
}

/// The fan-out every agent snapshot shares: a cache hit, a cache miss (red), a
/// route that reports no cache, a queued child and a later-phase one.
fn fan_out() -> Vec<SubagentPanel> {
    let mut queued = cached_panel("docs-writer", 0, 0, 0, false);
    queued.queued = true;
    queued.waiting = 1;
    let mut waiting = cached_panel("collector", 0, 0, 0, false);
    waiting.pending = true;
    waiting.phase = Some(2);
    vec![
        cached_panel("kv-review", 4, 64_000, 48_000, true),
        cached_panel("perf-scan", 3, 20_000, 0, true),
        cached_panel("lint-fix", 1, 5_000, 0, false),
        queued,
        waiting,
    ]
}

#[test]
fn subagent_dock_shows_stats_and_cache_rates() {
    let mut panels = fan_out();
    let buf = pinned(DARK, || {
        lines_buffer(agents_column(&mut panels, 128_000, 72, 12, THROBBER), 72)
    });
    assert_buffer("subagent_dock_cache_rates", &buf);
}

#[test]
fn subagent_dock_overflow_points_at_agents() {
    let mut panels = fan_out();
    let buf = pinned(DARK, || {
        lines_buffer(agents_column(&mut panels, 128_000, 72, 4, THROBBER), 72)
    });
    assert_buffer("subagent_dock_overflow", &buf);
}

#[test]
fn agents_inspector_lists_the_fan_out() {
    let mut app = snapshot_app();
    start_turn(&mut app, "fan out");
    app.subagents = fan_out();
    open_agents_picker(&mut app);
    assert_buffer("agents_inspector_list", &frame(&mut app, DARK, 90, 16));
}

#[test]
fn agents_inspector_detail_for_one_child() {
    let mut app = snapshot_app();
    start_turn(&mut app, "fan out");
    let mut panel = cached_panel("kv-review", 2, 64_000, 48_000, true);
    panel.task = "Review the key-value store for races.\nThen report.".into();
    panel.log = vec![
        super::super::ChildLogEntry::Prose("Reading the store first.".into()),
        super::super::ChildLogEntry::Call {
            id: "c1".into(),
            label: "Read src/kv.rs".into(),
            result: Some(("120 lines".into(), false)),
        },
        super::super::ChildLogEntry::Steer("check the lock order too".into()),
        super::super::ChildLogEntry::Call {
            id: "c2".into(),
            label: "Ran cargo test kv".into(),
            result: Some(("error: 1 test failed".into(), true)),
        },
    ];
    app.subagents = vec![panel];
    open_agents_picker(&mut app);
    if let Some(picker) = app.picker.as_mut() {
        picker.kind = PickerKind::AgentDetail;
    }
    app.agent_detail = Some("sub-kv-review-1".into());
    assert_buffer("agents_inspector_detail", &frame(&mut app, DARK, 80, 20));
}

// ---- Model picker -----------------------------------------------------------

fn picker_app() -> TestApp {
    let mut app = snapshot_app();
    app.model_picker = super::super::ModelPicker::from_pairs(
        vec![
            ("anthropic".into(), "claude-sonnet-4-5".into()),
            ("anthropic".into(), "claude-haiku-4-5".into()),
            ("openai".into(), "gpt-5-mini".into()),
            ("openai".into(), "gpt-5.1".into()),
            ("tokamak".into(), "tokamak-1-preview".into()),
        ],
        "gpt-5-mini",
    );
    assert!(app.model_picker.is_some());
    app
}

#[test]
fn model_picker_narrow() {
    let mut app = picker_app();
    assert_buffer("model_picker_w48", &frame(&mut app, DARK, 48, 14));
}

#[test]
fn model_picker_medium() {
    let mut app = picker_app();
    assert_buffer("model_picker_w80", &frame(&mut app, DARK, 80, 14));
}

#[test]
fn model_picker_wide_with_a_query() {
    let mut app = picker_app();
    if let Some(picker) = app.model_picker.as_mut() {
        picker.query = "claude".into();
        picker.refresh_items();
    }
    assert_buffer("model_picker_w120_query", &frame(&mut app, DARK, 120, 14));
}
