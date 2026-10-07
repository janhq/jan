//! Render-loop performance: an ignored timing report plus deterministic work
//! counters.
//!
//! Timings are machine-dependent, so they are never asserted; the report only
//! prints them (`cargo test --release ... -- tui_perf_report --ignored
//! --nocapture`). What CI does pin is the *amount* of work a frame or a
//! keystroke does, through the test-only counters next to `ROW_CLONES`: a
//! regression that makes a frame scan the whole reply once per row, or a paste
//! refresh the hints once per character, shows up as a count, not as a flaky
//! timing.

use super::super::{
    AGENT_TOML_READS, ANSWER_SCANS, MD_PARSES, PATH_HINT_REFRESHES, ROW_CLONES, THINK_SCANS,
    TRACE_RUN_SCANS,
};
use super::*;
use ratatui::backend::TestBackend;
use ratatui::text::Span;
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Terminal;

/// Read and zero one of the work counters.
fn take(counter: &'static std::thread::LocalKey<std::cell::Cell<usize>>) -> usize {
    counter.with(|n| n.replace(0))
}

/// One display journal of `messages` entries: user turns, reasoning, an edit
/// with its diff panel and a markdown answer with a fenced code block, so a
/// frame exercises every row kind a long real session holds.
fn session_entries(messages: usize) -> Vec<DisplayEntry> {
    let mut entries = Vec::with_capacity(messages + 5);
    let mut i = 0;
    while entries.len() < messages {
        let id = format!("e{i}");
        entries.push(DisplayEntry::User {
            text: format!("question {i}: how does the parser handle case {i}?"),
            images: Vec::new(),
        });
        entries.push(DisplayEntry::Assistant {
            text: format!("<think>Considering case {i}, lorem reasoning.</think>Checking."),
            reasoning: Vec::new(),
            reasoning_ms: Some(1200),
        });
        entries.push(DisplayEntry::ToolCall {
            id: id.clone(),
            name: "edit".into(),
            args: json!({ "path": format!("src/m{i}.rs") }),
        });
        entries.push(DisplayEntry::ToolResult {
            id,
            content: "edited".into(),
            is_error: false,
            diff: Some(format!("@@ edit 1/1 @@\n-    let v = old({i});\n+    let v = new({i}, lorem);")),
        });
        entries.push(DisplayEntry::Assistant {
            text: format!(
                "## Result {i}\n\nThe fix for **case {i}** lorem ipsum dolor sit amet, \
                 consectetur adipiscing elit, sed do eiusmod tempor.\n\n```rust\nfn \
                 case_{i}() -> u32 {{\n    {i}\n}}\n```\n\n- first point\n- second point\n"
            ),
            reasoning: Vec::new(),
            reasoning_ms: None,
        });
        i += 1;
    }
    entries.truncate(messages);
    entries
}

fn long_session(messages: usize) -> TestApp {
    let mut app = test_app();
    replay_display_log(&mut app, session_entries(messages));
    app
}

/// A reply of about `bytes` bytes, markdown with code fences, that opens with
/// a short reasoning block the way a reasoning model's answer does.
fn streamed_reply(bytes: usize) -> String {
    let mut reply = String::from("<think>Planning the answer step by step.</think>");
    let mut n = 0;
    while reply.len() < bytes {
        reply.push_str(&format!(
            "Paragraph {n}: lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n\
             ```rust\nlet x{n} = compute({n});\n```\n\n- item {n}\n- item {n}b\n\n"
        ));
        n += 1;
    }
    reply
}

/// Split at char boundaries into `size`-byte pieces, the shape a provider
/// streams tokens in.
fn chunks(text: &str, size: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in text.chars() {
        cur.push(c);
        if cur.len() >= size {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn terminal(w: u16, h: u16) -> Terminal<TestBackend> {
    Terminal::new(TestBackend::new(w, h)).unwrap()
}

fn draw_on(term: &mut Terminal<TestBackend>, app: &mut App) -> Duration {
    let t = Instant::now();
    term.draw(|f| super::super::draw(f, app)).unwrap();
    t.elapsed()
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn p99(samples: &mut [Duration]) -> Duration {
    samples.sort();
    samples[(samples.len() * 99 / 100).min(samples.len() - 1)]
}

/// Prints the timing table used to judge render-loop changes. Ignored: it is
/// a measurement, not a check, and takes seconds in a debug build.
#[test]
#[ignore]
fn tui_perf_report() {
    // (a) Warm idle frame over a long session.
    let mut app = long_session(2000);
    let mut term = terminal(120, 40);
    draw_on(&mut term, &mut app);
    let mut idle: Vec<Duration> = (0..200).map(|_| draw_on(&mut term, &mut app)).collect();
    let idle_mean = idle.iter().sum::<Duration>() / idle.len() as u32;
    let idle_p99 = p99(&mut idle);

    // (b) A 30KB reply streamed in 60-byte tokens, one draw per token, while
    // the run is live.
    app.status = Status::Running;
    let tokens = chunks(&streamed_reply(30 * 1024), 60);
    take(&ANSWER_SCANS);
    take(&THINK_SCANS);
    take(&MD_PARSES);
    let mut stream_total = Duration::ZERO;
    let mut stream_worst = Duration::ZERO;
    for token in &tokens {
        let t = Instant::now();
        app.apply(StreamEvent::Token {
            text: token.clone(),
        });
        draw_on(&mut term, &mut app);
        let d = t.elapsed();
        stream_total += d;
        stream_worst = stream_worst.max(d);
    }
    let frames = tokens.len();
    let answer_scans = take(&ANSWER_SCANS);
    let think_scans = take(&THINK_SCANS);
    let md_parses = take(&MD_PARSES);
    // Unchanged buffer, redrawn: what a spinner-only frame costs mid-reply.
    draw_on(&mut term, &mut app);
    let parses_on_redraw = take(&MD_PARSES);
    app.flush_assistant();
    app.status = Status::Idle;

    // (c) A 100KB paste into the composer.
    let paste: String = "lorem ipsum dolor sit amet\n".repeat(100 * 1024 / 27);
    take(&PATH_HINT_REFRESHES);
    let t = Instant::now();
    route_paste_event(&mut app, Event::Paste(paste.clone()));
    let paste_time = t.elapsed();
    let paste_refreshes = take(&PATH_HINT_REFRESHES);
    assert_eq!(app.input.len(), paste.len());
    app.input.clear();
    app.cursor = 0;
    draw_on(&mut term, &mut app);

    // (d) `/find` and twenty `n` steps, each followed by its jump frame.
    let t = Instant::now();
    app.start_find("lorem");
    draw_on(&mut term, &mut app);
    for _ in 0..20 {
        app.find_step(true);
        draw_on(&mut term, &mut app);
    }
    let find_time = t.elapsed();
    let hits = app.find.as_ref().map_or(0, |f| f.hits.len());
    app.find = None;
    draw_on(&mut term, &mut app);

    // (e) The first frame after a resize from 120 to 100 columns.
    term.resize(Rect::new(0, 0, 100, 40)).unwrap();
    let resize = draw_on(&mut term, &mut app);

    println!("tui_perf_report ({} transcript rows)", app.transcript.len());
    println!("  idle frame        mean {:.3} ms  p99 {:.3} ms", ms(idle_mean), ms(idle_p99));
    println!(
        "  30KB stream       {frames} frames  total {:.1} ms  worst {:.3} ms",
        ms(stream_total),
        ms(stream_worst)
    );
    println!(
        "    per frame       answer scans {:.1}  think scans {:.1}  md parses {:.1}",
        answer_scans as f64 / frames as f64,
        think_scans as f64 / frames as f64,
        md_parses as f64 / frames as f64
    );
    println!("    redraw, same buffer: md parses {parses_on_redraw}");
    println!(
        "  100KB paste       {:.1} ms  path-hint refreshes {paste_refreshes}",
        ms(paste_time)
    );
    println!("  /find + 20 n      {:.1} ms  ({hits} hits)", ms(find_time));
    println!("  resize 120->100   {:.1} ms", ms(resize));
}

/// The active-reasoning check in `draw` runs per transcript row; the answer
/// scan it needs is the same for every row, so a frame must do it at most
/// once rather than once per row of history.
#[test]
fn a_streaming_frame_scans_the_reply_at_most_once() {
    let mut app = long_session(200);
    app.status = Status::Running;
    app.apply(StreamEvent::Token {
        text: "<think>weighing it</think>The answer so far".into(),
    });
    let mut term = terminal(100, 30);
    draw_on(&mut term, &mut app);
    take(&ANSWER_SCANS);
    draw_on(&mut term, &mut app);
    let scans = take(&ANSWER_SCANS);
    assert!(scans <= 1, "one frame scanned the reply {scans} times");
}

/// A paste is one edit: one insert and one path-hint refresh, however long.
#[test]
fn a_paste_refreshes_path_hints_once() {
    let mut app = test_app();
    app.input = "ab".into();
    app.cursor = 1;
    take(&PATH_HINT_REFRESHES);
    route_paste_event(&mut app, Event::Paste("x\ty @src".repeat(500)));
    assert_eq!(take(&PATH_HINT_REFRESHES), 1);
    assert_eq!(app.input, format!("a{}b", "xy @src".repeat(500)));
    assert_eq!(app.cursor, 1 + "xy @src".len() * 500);
}

/// A paste of nothing but tabs is no edit at all, as it was char by char.
#[test]
fn a_tab_only_paste_leaves_the_input_untouched() {
    let mut app = test_app();
    app.slash_dismissed = true;
    route_paste_event(&mut app, Event::Paste("\t\t".into()));
    assert!(app.input.is_empty());
    assert!(app.slash_dismissed, "no edit, so the popup stays dismissed");
}

/// Streaming a reply token by token must not rescan the whole buffer per
/// token: the answer/think state is folded in as text appends.
#[test]
fn streaming_tokens_does_not_rescan_the_reply() {
    let mut app = test_app();
    app.status = Status::Running;
    app.apply(StreamEvent::ToolCall {
        id: "c1".into(),
        name: "grep".into(),
        args: json!({ "pattern": "x" }),
    });
    take(&ANSWER_SCANS);
    take(&THINK_SCANS);
    for token in chunks(&streamed_reply(8 * 1024), 40) {
        app.apply(StreamEvent::Token { text: token });
    }
    assert_eq!(take(&ANSWER_SCANS), 0);
    assert_eq!(take(&THINK_SCANS), 0);
}

/// The incremental state agrees with the full-buffer scans at every prefix of
/// awkward inputs: tags split across tokens, a `<` that never becomes a tag,
/// namespaced tags, whitespace-only answers, and the gate off.
#[test]
fn incremental_buffer_scan_matches_the_full_scan() {
    let cases = [
        "<think>a</think>  \n answer <b> and <thinking more",
        "<mm:think>x</mm:think>\n\n<think>y",
        "pre <th<think>in</think> post </think> <",
        "   \n<think></think>   <think>open",
        "a < b and c<d> <:think>q</:think>z",
    ];
    for gate in [true, false] {
        for case in cases {
            for size in [1, 2, 3, 7] {
                let mut scan = super::super::BufScan::default();
                let mut buf = String::new();
                for piece in chunks(case, size) {
                    buf.push_str(&piece);
                    let mut check = || {
                        scan.sync(&buf);
                        (scan.answer, scan.think_open)
                    };
                    let want = || {
                        (
                            super::super::has_answer_text(&buf),
                            super::super::thinking_open(&buf),
                        )
                    };
                    let (got, want) = if gate {
                        (check(), want())
                    } else {
                        without_think_tags(|| (check(), want()))
                    };
                    assert_eq!(got, want, "gate {gate}, prefix {buf:?}");
                }
            }
        }
    }
}

/// A buffer replaced in place (not appended to) is noticed and rescanned.
#[test]
fn a_replaced_buffer_is_rescanned() {
    let mut app = test_app();
    app.assistant_buf = "<think>weighing options".into();
    assert!(!app.answer_started());
    assert!(app.reasoning_open());
    app.assistant_buf = "<think>weighing options</think>yes, ok".into();
    assert!(app.answer_started());
    app.assistant_buf = "here is the answer, and it is long".into();
    assert!(app.answer_started());
    assert!(!app.reasoning_open());
}

/// A redraw with the reply unchanged (a spinner tick mid-stream) reuses the
/// rendered tail instead of re-parsing its markdown; new text re-renders it.
#[test]
fn an_unchanged_live_tail_is_not_reparsed() {
    let mut app = test_app();
    app.status = Status::Running;
    app.apply(StreamEvent::Token {
        text: "# Title\n\nSome **bold** answer text.\n".into(),
    });
    let mut term = terminal(80, 24);
    draw_on(&mut term, &mut app);
    take(&MD_PARSES);
    draw_on(&mut term, &mut app);
    assert_eq!(take(&MD_PARSES), 0, "an unchanged tail was re-parsed");
    app.apply(StreamEvent::Token {
        text: "More.".into(),
    });
    let shown = render_rows(&mut app, 80, 24).join("\n");
    assert!(shown.contains("answer text. More."), "{shown}");
    assert!(take(&MD_PARSES) > 0, "new text must re-render the tail");
    // A new width is a new layout.
    render_rows(&mut app, 60, 24);
    assert!(take(&MD_PARSES) > 0, "a resize must re-render the tail");
}

/// The wrapped-height fast path agrees with ratatui's own count on lines at,
/// under and over the width, with wide, zero-width and control graphemes.
#[test]
fn wrapped_height_fast_path_matches_line_count() {
    let samples = [
        "",
        " ",
        "plain words that may or may not wrap here",
        "exactly-ten",
        "abcdefghij",
        "abcdefghi\u{301}",
        "abcdefghij\u{301}",
        "\u{4e2d}\u{6587}\u{5b57}\u{7b26}\u{4e32}",
        "a\u{4e2d}\u{6587}\u{5b57}\u{7b26}\u{4e32}",
        "tab\there\r\nand\u{1b} esc",
        "trailing spaces          ",
        "\u{200b}\u{200b}abcdefghij",
        "nbsp\u{a0}\u{a0}\u{a0}\u{a0}\u{a0}\u{a0}x",
        "\u{1f600}\u{1f600}\u{1f600}\u{1f600}\u{1f600}",
        "\u{ff9e}\u{ff9e}\u{ff9e}abcdefg",
    ];
    for width in [1u16, 2, 5, 9, 10, 11, 40] {
        for text in samples {
            for split in [false, true] {
                let line = if split && text.len() > 3 {
                    let at = text.char_indices().nth(2).map_or(0, |(i, _)| i);
                    Line::from(vec![
                        Span::raw(text[..at].to_string()),
                        Span::styled(text[at..].to_string(), Style::new().bold()),
                    ])
                } else {
                    Line::raw(text.to_string())
                };
                let want = Paragraph::new(vec![line.clone()])
                    .wrap(Wrap { trim: false })
                    .line_count(width) as u16;
                let got = super::super::wrapped_height_of(&[line], width);
                assert_eq!(got, want, "width {width}, {text:?}, split {split}");
            }
        }
    }
}

/// A frame builds the trace runs once, and checking whether the body ends on
/// a blank copies no row out of the cache beyond the visible ones.
#[test]
fn a_frame_builds_trace_runs_once() {
    let mut app = long_session(200);
    let mut term = terminal(100, 30);
    draw_on(&mut term, &mut app);
    take(&TRACE_RUN_SCANS);
    draw_on(&mut term, &mut app);
    assert_eq!(take(&TRACE_RUN_SCANS), 1);
}

/// The blank-separator check above a streaming tail reads the last row in
/// place: with the last row on screen anyway, a frame copies the same rows
/// whether or not a tail is streaming.
#[test]
fn the_tail_separator_check_copies_no_row() {
    let mut app = long_session(200);
    let mut term = terminal(100, 30);
    draw_on(&mut term, &mut app);
    take(&ROW_CLONES);
    draw_on(&mut term, &mut app);
    let idle = take(&ROW_CLONES);
    app.status = Status::Running;
    app.apply(StreamEvent::ToolCall {
        id: "z".into(),
        name: "grep".into(),
        args: json!({ "pattern": "x" }),
    });
    app.finalize_tool_group();
    app.apply(StreamEvent::Token {
        text: "<think>still".into(),
    });
    draw_on(&mut term, &mut app);
    take(&ROW_CLONES);
    draw_on(&mut term, &mut app);
    let streaming = take(&ROW_CLONES);
    assert!(streaming <= idle, "streaming frame copied {streaming} rows, idle {idle}");
}

/// A search reads every row in place: no row is copied out of its cache.
#[test]
fn find_scans_rows_without_copying_them() {
    let mut app = long_session(200);
    render_rows(&mut app, 100, 30);
    take(&ROW_CLONES);
    app.start_find("lorem");
    app.find_step(true);
    assert_eq!(take(&ROW_CLONES), 0);
    assert!(app.find.as_ref().is_some_and(|f| f.hits.len() > 40));
}

/// The indexed lookup returns what the linear one did for every row,
/// including rows that own no region and the still-running group.
#[test]
fn region_index_lookup_matches_a_linear_search() {
    let mut app = long_session(60);
    app.apply(StreamEvent::ToolCall {
        id: "live".into(),
        name: "grep".into(),
        args: json!({ "pattern": "x" }),
    });
    let index = app.region_index();
    for i in 0..app.transcript.len() + 2 {
        let linear = app
            .groups
            .iter()
            .find(|g| g.idx == i)
            .or(app.tool_group.as_ref().filter(|g| g.idx == i))
            .map(|g| super::super::group_detail_lines(g, 80))
            .or_else(|| {
                app.reasoning_blocks
                    .iter()
                    .find(|r| r.idx == i)
                    .map(|b| b.detail.clone())
            })
            .or_else(|| {
                app.subagent_blocks
                    .iter()
                    .find(|b| b.idx == i)
                    .map(|b| b.detail_lines(80))
            });
        assert_eq!(app.region_detail_in(&index, i, 80), linear, "row {i}");
    }
}

/// Typing a slash command reads agent.toml once, not once per keystroke, and
/// an edit to the file is still picked up on the next keystroke.
#[test]
fn slash_typing_reads_agent_toml_only_when_it_changes() {
    let (mut app, root) = skill_test_app("deploy", "How to deploy.");
    let toml = crate::core::agent::project::store_root(&root).join("agent.toml");
    std::fs::write(&toml, "[agent]\n").unwrap();
    take(&AGENT_TOML_READS);
    for typed in ["/d", "/de", "/dep", "/depl"] {
        app.input = typed.into();
        assert!(app.slash_matches().iter().any(|m| m.name() == "/deploy"));
    }
    assert_eq!(take(&AGENT_TOML_READS), 1);
    std::fs::write(&toml, "[agent]\n[skills]\nenabled = [\"other\"]\n").unwrap();
    app.input = "/dep".into();
    assert!(!app.slash_matches().iter().any(|m| m.name() == "/deploy"));
    assert_eq!(take(&AGENT_TOML_READS), 1);
    let _ = std::fs::remove_dir_all(&root);
}

fn gate(dirty: bool, urgent: bool, animating: bool, since_ms: u64) -> super::super::FrameGate {
    super::super::FrameGate {
        dirty,
        urgent,
        animating,
        animated_last: false,
        since_last: Some(Duration::from_millis(since_ms)),
    }
}

/// An idle, unchanged session draws nothing between safety redraws, and the
/// first frame always draws.
#[test]
fn a_still_frame_is_skipped_until_the_safety_redraw() {
    assert!(super::super::FrameGate::default().due(), "first frame");
    assert!(!gate(false, false, false, 50).due());
    assert!(!gate(false, false, false, 999).due());
    assert!(gate(false, false, false, 1000).due(), "safety redraw");
}

/// Output alone is capped at one frame per 16ms; input and resizes are not,
/// and anything animating keeps drawing on the tick.
#[test]
fn output_frames_are_capped_and_input_is_not() {
    assert!(!gate(true, false, false, 5).due(), "output inside the cap");
    assert!(gate(true, false, false, 16).due(), "output after the cap");
    assert!(gate(true, true, false, 1).due(), "input draws at once");
    assert!(gate(false, false, true, 50).due(), "an animation draws on its tick");
    let mut ending = gate(false, false, false, 50);
    ending.animated_last = true;
    assert!(ending.due(), "the frame after an animation stops still draws");
}

/// The session is still only when nothing on screen moves with time; each
/// time-driven state the draw path reads keeps frames coming.
#[test]
fn animating_lists_every_time_driven_state() {
    let mut app = test_app();
    assert!(!app.animating(), "a fresh idle session is still");
    fn toggles(app: &mut App, name: &str, set: &dyn Fn(&mut App), clear: &dyn Fn(&mut App)) {
        set(app);
        assert!(app.animating(), "{name} must keep frames coming");
        clear(app);
        assert!(!app.animating(), "{name} cleared, yet still animating");
    }
    let mut check = |name: &str, set: &dyn Fn(&mut App), clear: &dyn Fn(&mut App)| {
        toggles(&mut app, name, set, clear)
    };
    check(
        "a running turn",
        &|a| a.status = Status::Running,
        &|a| a.status = Status::Idle,
    );
    check(
        "a parked run",
        &|a| a.status = Status::Parked,
        &|a| a.status = Status::Idle,
    );
    check(
        "the run clock",
        &|a| a.run_started = Some(Instant::now()),
        &|a| a.run_started = None,
    );
    check(
        "compaction",
        &|a| a.compacting = Some(super::super::CompactKind::Manual),
        &|a| a.compacting = None,
    );
    check(
        "mid-run compaction",
        &|a| a.run_compacting = Some(Instant::now()),
        &|a| a.run_compacting = None,
    );
    check(
        "a copy notice",
        &|a| a.copied = Some((Instant::now(), 2)),
        &|a| a.copied = None,
    );
    check(
        "a streaming tool call",
        &|a| {
            a.apply(StreamEvent::ToolCallStarted {
                id: "s".into(),
                name: "write".into(),
            })
        },
        &|a| a.starting.clear(),
    );
    check(
        "an awaited child",
        &|a| a.awaiting.push(("c".into(), "r".into(), "child".into())),
        &|a| a.awaiting.clear(),
    );
    check(
        "a drag-select",
        &|a| a.selection = Some(Selection::new((0, 0), SelectionMode::Linear)),
        &|a| a.selection = None,
    );
    // An expired notice shows nothing and so needs no frames.
    app.copied = Some((Instant::now() - Duration::from_secs(5), 2));
    assert!(!app.animating(), "an expired copy notice");
}
