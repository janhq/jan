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
    ANSWER_SCANS, MD_PARSES, PATH_HINT_REFRESHES, THINK_SCANS,
};
use super::*;
use ratatui::backend::TestBackend;
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
