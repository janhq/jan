//! The supervisor driving the real `jan-llama-worker` binary: spawn, read the
//! handshake, serve over HTTP, stop. This is the crash-boundary path that
//! replaces spawning a downloaded `llama-server` in router mode.
//!
//! Opt-in on JAN_TEST_GGUF.
#![cfg(feature = "engine")]

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use tauri_plugin_llamacpp::engine::worker::{self, WorkerError};

const MODEL_ID: &str = "smoke-model";

fn model_path() -> Option<String> {
    std::env::var("JAN_TEST_GGUF").ok().filter(|p| !p.is_empty())
}

/// Cargo builds the bin for us and hands over its path.
fn worker_exe() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_jan-llama-worker"))
}

/// A preset in exactly the shape Jan's preset.ts already emits.
fn write_preset(dir: &tempfile::TempDir, model: &str) -> PathBuf {
    let path = dir.path().join("router.preset.ini");
    let mut f = std::fs::File::create(&path).unwrap();
    writeln!(
        f,
        "[*]\nfit = off\nparallel = 1\nthreads = 2\nctx-size = 2048\nn-gpu-layers = 0\n\n[{MODEL_ID}]\nmodel = {model}\nload-on-startup = false"
    )
    .unwrap();
    path
}

#[tokio::test(flavor = "multi_thread")]
async fn spawns_the_worker_reads_its_handshake_and_serves() {
    let Some(model) = model_path() else { return };
    let dir = tempfile::tempdir().unwrap();
    let preset = write_preset(&dir, &model);

    let handle = worker::spawn(
        &worker_exe(),
        &preset,
        0, // let the OS pick, then learn it from the handshake
        "supervised-key",
        1,
        0,
        HashMap::new(),
    )
    .await
    .expect("the worker should come up");

    assert!(handle.port > 0, "handshake must report a real port");
    assert!(handle.pid > 0, "handshake must report a pid");
    assert_eq!(
        handle.models,
        vec![MODEL_ID],
        "the worker should have registered the preset's sections"
    );

    // The supervisor knows the port without scraping a log, and the model is
    // reachable over the same contract proxy.rs uses.
    let base = format!("http://127.0.0.1:{}", handle.port);
    let res = reqwest::Client::new()
        .post(format!("{base}/v1/chat/completions"))
        .bearer_auth("supervised-key")
        .header("content-type", "application/json")
        .body(format!(
            r#"{{"model":"{MODEL_ID}","messages":[{{"role":"user","content":"Say only: SUPERVISED"}}],"max_tokens":200,"temperature":0}}"#
        ))
        .send()
        .await
        .expect("the supervised worker should answer");
    assert_eq!(res.status(), 200);
    let v: serde_json::Value = res.json().await.unwrap();
    assert!(
        v["choices"][0]["message"]["role"].is_string(),
        "no assistant message: {v}"
    );

    // The key came from the environment, so it must not be visible in argv.
    #[cfg(target_os = "linux")]
    {
        let cmdline = std::fs::read(format!("/proc/{}/cmdline", handle.pid)).unwrap_or_default();
        let cmdline = String::from_utf8_lossy(&cmdline);
        assert!(
            !cmdline.contains("supervised-key"),
            "the bearer token leaked into argv: {cmdline}"
        );
    }

    handle.stop().await;

    // After stop the port must be dead, not merely idle.
    let after = reqwest::Client::new()
        .get(format!("{base}/v1/models"))
        .bearer_auth("supervised-key")
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;
    assert!(after.is_err(), "the worker should be gone after stop()");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_preset_that_does_not_exist_still_starts_and_serves_no_models() {
    // The worker only reads the preset for section names, so a missing file is
    // a startup error rather than a silent empty registry.
    let err = worker::spawn(
        &worker_exe(),
        &PathBuf::from("/definitely/not/a/preset.ini"),
        0,
        "k",
        1,
        0,
        HashMap::new(),
    )
    .await
    .expect_err("a missing preset must be reported");
    assert!(matches!(err, WorkerError::Handshake(_)), "got {err:?}");
}

/// The app's exit path calls `try_graceful_stop_engine`. Before that existed the
/// exit path stopped the *router*, so a migrated app left its worker running --
/// holding the model and its VRAM after the window closed.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_worker_is_actually_gone() {
    let Some(model) = model_path() else { return };
    let dir = tempfile::tempdir().unwrap();
    let preset = write_preset(&dir, &model);

    let handle = worker::spawn(
        &worker_exe(),
        &preset,
        0,
        "stop-key",
        1,
        0,
        HashMap::new(),
    )
    .await
    .expect("the worker should come up");

    let pid = handle.pid;
    assert!(pid_alive(pid), "worker should be running before stop");
    handle.stop().await;

    // The kernel reaps asynchronously, so allow a moment before asserting.
    for _ in 0..50 {
        if !pid_alive(pid) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("worker pid {pid} still alive after stop()");
}

/// Running, i.e. not exited. A zombie counts as *not* alive: a test that drops
/// stdin without reaping the child would otherwise see `/proc/<pid>` forever and
/// conclude the worker ignored the signal.
#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    // `state` is the field after the parenthesised comm, which may itself
    // contain spaces -- so split on the last ')' rather than by whitespace.
    let Some((_, rest)) = stat.rsplit_once(')') else {
        return false;
    };
    !matches!(rest.split_whitespace().next(), Some("Z") | None)
}

#[cfg(not(unix))]
fn pid_alive(_pid: u32) -> bool {
    // No cheap /proc equivalent; the assertion is Unix-only.
    false
}

/// Shutdown is signalled by closing the worker's stdin, so it must behave the
/// same everywhere -- the router had to be force-killed on Windows because a
/// third-party binary could only be signalled.
#[tokio::test(flavor = "multi_thread")]
async fn closing_stdin_stops_the_worker_without_a_signal() {
    // Needs no model: the shutdown path is about the process, not inference.
    let dir = tempfile::tempdir().unwrap();
    let preset = dir.path().join("empty.preset.ini");
    std::fs::write(&preset, "[*]\nparallel = 1\n").unwrap();

    let mut handle = worker::spawn(
        &worker_exe(),
        &preset,
        0,
        "eof-key",
        1,
        0,
        HashMap::new(),
    )
    .await
    .expect("the worker should come up");

    let pid = handle.pid;
    // Exactly what stop() does first, in isolation: no signal is sent.
    let stdin = handle.take_stdin().expect("stdin should be piped");
    drop(stdin);

    for _ in 0..100 {
        if !pid_alive(pid) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("worker pid {pid} ignored stdin EOF");
}
