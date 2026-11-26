//! The upstream `test-backend-ops` wrapper, driven through the safe API.
//!
//! Needs the `engine` feature and no model: it runs ggml's own CPU backend on
//! a tiny op filter, so it is cheap enough to be a regular check.
#![cfg(feature = "engine")]

use std::sync::Mutex;

use tauri_plugin_llamacpp::engine::diag::{
    DiagBackend, DiagEvent, DiagMode, DiagOp, DiagRunRequest, DiagTally,
};
use tauri_plugin_llamacpp::engine::Engine;

fn run(req: &DiagRunRequest) -> (Result<bool, tauri_plugin_llamacpp::engine::EngineError>, Vec<String>) {
    tauri_plugin_llamacpp::engine::load_backend_modules();
    let lines = Mutex::new(Vec::new());
    let outcome = Engine::diag_run(req, &|line: &str| lines.lock().unwrap().push(line.to_string()));
    (outcome, lines.into_inner().unwrap())
}

fn cpu_add() -> DiagRunRequest {
    DiagRunRequest {
        mode: DiagMode::Test,
        backend: "CPU".to_string(),
        op_filter: Some("ADD".to_string()),
        // One shape family keeps this to a handful of cases.
        params_filter: Some("type=f32,ne=\\[16,5,4,3\\],nr=\\[1,1,1,1\\]".to_string()),
        workers: 1,
    }
}

#[test]
fn the_cpu_backend_passes_a_tiny_add_run_and_every_event_parses() {
    let (outcome, lines) = run(&cpu_add());
    assert_eq!(outcome, Ok(true), "events: {lines:#?}");

    let events: Vec<DiagEvent> = lines
        .iter()
        .map(|l| DiagEvent::parse(l).unwrap_or_else(|e| panic!("unparsable event {l}: {e}")))
        .collect();

    let mut tally = DiagTally::default();
    for e in &events {
        tally.record(e);
    }
    assert!(tally.ok > 0, "no case ran: {lines:#?}");
    assert_eq!(tally.failed, 0, "{lines:#?}");
    assert!(
        matches!(events.last(), Some(DiagEvent::Done { ok: true, error: None })),
        "the stream must end with done: {lines:#?}"
    );
    assert!(events
        .iter()
        .any(|e| matches!(e, DiagEvent::OverallSummary { all_passed: true, .. })));
}

#[test]
fn an_unknown_backend_is_reported_not_run() {
    let mut req = cpu_add();
    req.backend = "NoSuchDevice0".to_string();
    let (outcome, lines) = run(&req);
    assert!(outcome.is_err(), "{outcome:?}");
    let last = DiagEvent::parse(lines.last().expect("a done event")).unwrap();
    assert!(matches!(last, DiagEvent::Done { ok: false, error: Some(_) }), "{last:?}");
}

#[test]
fn a_bad_params_regex_is_reported_not_thrown() {
    let mut req = cpu_add();
    req.params_filter = Some("(".to_string());
    let (outcome, _) = run(&req);
    assert!(outcome.is_err(), "{outcome:?}");
}

#[test]
fn the_op_listing_counts_real_cases_per_family() {
    tauri_plugin_llamacpp::engine::load_backend_modules();
    let json = Engine::diag_ops_json().expect("ops listing");
    let ops: Vec<DiagOp> = serde_json::from_str(&json).expect("ops json parses");
    let add = ops.iter().find(|o| o.op == "ADD").expect("ADD is listed");
    assert!(add.cases > 0, "ADD has no cases");
    assert!(ops.iter().any(|o| o.cases == 0), "untested ops are listed with 0");
}

#[test]
fn the_backend_listing_includes_the_cpu_device() {
    tauri_plugin_llamacpp::engine::load_backend_modules();
    let json = Engine::diag_backends_json().expect("backend listing");
    let backends: Vec<DiagBackend> = serde_json::from_str(&json).expect("backends json parses");
    assert!(backends.iter().any(|b| b.name == "CPU"), "{backends:?}");
}
