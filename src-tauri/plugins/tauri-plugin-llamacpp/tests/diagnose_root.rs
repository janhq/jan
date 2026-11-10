//! The root `--diagnose` orchestration against stand-in leaf processes.
//!
//! Real processes, not a mocked runner: CRASHED and HUNG are things an OS does
//! to a child, and the point of the root is that it survives them. The leaves
//! are generated scripts so the test needs no second binary.
//!
//! Needs no `engine` feature: the root loads no ggml, which is the property
//! that makes it the crash boundary in the first place.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri_plugin_llamacpp::diagnostics::EngineBuild;
use tauri_plugin_llamacpp::engine::diag::{
    DiagDevice, DiagDeviceKind, DiagStatus, FamilyFilter,
};
use tauri_plugin_llamacpp::engine::diagnose::{
    run, DiagPreset, DiagnosePlan, FamilyStatus, LeafSpec, RootEvent,
};

/// What a stand-in leaf does when it is run.
#[derive(Default)]
struct FakeLeaf {
    stdout: Vec<String>,
    stderr: Vec<String>,
    /// Seconds to sleep after printing, before exiting.
    sleep: u32,
    exit: i32,
}

impl FakeLeaf {
    fn write(&self, dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(format!("{name}{}", if cfg!(windows) { ".cmd" } else { ".sh" }));
        let mut script = String::new();
        if cfg!(windows) {
            script.push_str("@echo off\r\n");
            for line in &self.stdout {
                script.push_str(&format!("echo {line}\r\n"));
            }
            for line in &self.stderr {
                script.push_str(&format!("echo {line} 1>&2\r\n"));
            }
            if self.sleep > 0 {
                script.push_str(&format!("timeout /t {} /nobreak > nul\r\n", self.sleep));
            }
            script.push_str(&format!("exit /b {}\r\n", self.exit));
        } else {
            script.push_str("#!/bin/sh\n");
            for line in &self.stdout {
                script.push_str(&format!("echo '{line}'\n"));
            }
            for line in &self.stderr {
                script.push_str(&format!("echo '{line}' >&2\n"));
            }
            if self.sleep > 0 {
                script.push_str(&format!("sleep {}\n", self.sleep));
            }
            script.push_str(&format!("exit {}\n", self.exit));
        }
        std::fs::write(&path, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }
}

fn result_line(op: &str, status: &str) -> String {
    format!(
        r#"{{"event":"result","backend":"CPU","op":"{op}","params":"type=f32","mode":"test","status":"{status}"}}"#
    )
}

fn done_line(ok: bool) -> String {
    format!(r#"{{"event":"done","ok":{ok}}}"#)
}

fn device(name: &str) -> DiagDevice {
    DiagDevice {
        name: name.into(),
        description: "stand-in".into(),
        kind: DiagDeviceKind::Cpu,
        reg: "CPU".into(),
        memory_total_mib: None,
        memory_free_mib: None,
    }
}

fn plan(families: &[&str]) -> DiagnosePlan {
    DiagnosePlan {
        preset: DiagPreset::Quick,
        engine: EngineBuild {
            version: "0.0.0".into(),
            tag: "b12110".into(),
            commit: "deadbeef".into(),
        },
        devices: vec![device("CPU")],
        families: families
            .iter()
            .map(|f| FamilyFilter::new(*f, None))
            .collect(),
        model: None,
        support_probe: false,
        workers: 1,
        backend_modules: vec!["libggml-cpu.so".into()],
        family_timeout: Duration::from_millis(600),
        deadline: Duration::from_secs(30),
    }
}

async fn collect(plan: &DiagnosePlan, leaf: PathBuf) -> Vec<RootEvent> {
    collect_with(plan, leaf, std::future::pending()).await
}

async fn collect_with(
    plan: &DiagnosePlan,
    leaf: PathBuf,
    cancel: impl std::future::Future<Output = ()>,
) -> Vec<RootEvent> {
    let mut events = Vec::new();
    run(plan, &LeafSpec::new(leaf), cancel, &mut |e| events.push(e)).await;
    events
}

fn families(events: &[RootEvent]) -> Vec<(&str, FamilyStatus)> {
    events
        .iter()
        .filter_map(|e| match e {
            RootEvent::FamilyEnd { family, status, .. } => Some((family.as_str(), *status)),
            _ => None,
        })
        .collect()
}

fn done(events: &[RootEvent]) -> (bool, bool) {
    events
        .iter()
        .find_map(|e| match e {
            RootEvent::Done { ok, cancelled, .. } => Some((*ok, *cancelled)),
            _ => None,
        })
        .expect("a run always ends with done")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_clean_leaf_reports_ok_and_forwards_every_case() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![
            result_line("ADD", "ok"),
            result_line("ADD", "not_supported"),
            done_line(true),
        ],
        ..Default::default()
    }
    .write(dir.path(), "clean");

    let events = collect(&plan(&["ADD"]), leaf).await;

    assert_eq!(families(&events), vec![("ADD", FamilyStatus::Ok)]);
    assert_eq!(done(&events), (true, false));

    let cases: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            RootEvent::Case { case, family, .. } => Some((family.clone(), case.status)),
            _ => None,
        })
        .collect();
    assert_eq!(
        cases,
        vec![
            ("ADD".to_string(), DiagStatus::Ok),
            ("ADD".to_string(), DiagStatus::NotSupported)
        ],
        "every case the leaf reported must reach the stream, tagged with its family"
    );

    let summary = events
        .iter()
        .find_map(|e| match e {
            RootEvent::Summary {
                ok, not_supported, ..
            } => Some((*ok, *not_supported)),
            _ => None,
        })
        .unwrap();
    assert_eq!(summary, (1, 1), "a not-supported case is not a pass");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_run_opens_with_the_schema_and_one_event_per_device() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![done_line(true)],
        ..Default::default()
    }
    .write(dir.path(), "empty");

    let mut p = plan(&["ADD"]);
    p.devices = vec![device("CPU"), device("Vulkan0")];
    let events = collect(&p, leaf).await;

    match &events[0] {
        RootEvent::Start { schema, units, .. } => {
            assert_eq!(*schema, 2);
            assert_eq!(*units, 2, "one family on each of two devices");
        }
        other => panic!("a run must open with start, got {other:?}"),
    }
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e, RootEvent::Device(_)))
            .count(),
        2
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failing_case_is_a_failure_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![result_line("ADD", "fail"), done_line(false)],
        ..Default::default()
    }
    .write(dir.path(), "failing");

    let events = collect(&plan(&["ADD"]), leaf).await;

    assert_eq!(families(&events), vec![("ADD", FamilyStatus::Fail)]);
    assert_eq!(done(&events), (false, false));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_leaf_that_dies_is_crashed_and_the_next_family_still_runs() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![result_line("ADD", "ok")],
        stderr: vec!["ggml_vulkan: device lost".into()],
        exit: 1,
        ..Default::default()
    }
    .write(dir.path(), "crasher");

    let events = collect(&plan(&["ADD", "MUL"]), leaf).await;

    assert_eq!(
        families(&events),
        vec![
            ("ADD", FamilyStatus::Crashed),
            ("MUL", FamilyStatus::Crashed)
        ],
        "a crash ends its own family only; the root keeps going"
    );

    let end = events
        .iter()
        .find_map(|e| match e {
            RootEvent::FamilyEnd {
                exit, last_lines, ok, ..
            } => Some((exit.clone(), last_lines.clone(), *ok)),
            _ => None,
        })
        .unwrap();
    assert_eq!(end.0.as_deref(), Some("exit code 1"));
    assert!(
        end.1.iter().any(|l| l.contains("device lost")),
        "the leaf's last words are what explain a crash: {:?}",
        end.1
    );
    assert_eq!(end.2, 1, "cases reported before the crash are kept");
    assert_eq!(done(&events), (false, false));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_leaf_that_stops_without_saying_done_is_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    // Exit 0, but the stream never terminated: the leaf went away mid-family.
    let leaf = FakeLeaf {
        stdout: vec![result_line("ADD", "ok")],
        ..Default::default()
    }
    .write(dir.path(), "truncated");

    let events = collect(&plan(&["ADD"]), leaf).await;
    assert_eq!(families(&events), vec![("ADD", FamilyStatus::Crashed)]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_leaf_that_hangs_is_killed_and_marked_hung() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![result_line("ADD", "ok")],
        sleep: 60,
        ..Default::default()
    }
    .write(dir.path(), "hung");

    let started = std::time::Instant::now();
    let events = collect(&plan(&["ADD"]), leaf).await;

    assert_eq!(families(&events), vec![("ADD", FamilyStatus::Hung)]);
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "the family timeout, not the leaf, decides when a hang ends"
    );
    let exit = events.iter().find_map(|e| match e {
        RootEvent::FamilyEnd { exit, .. } => exit.clone(),
        _ => None,
    });
    assert_eq!(exit, None, "a killed leaf has no exit status of its own");
}

#[tokio::test(flavor = "multi_thread")]
async fn garbage_on_stdout_is_reported_rather_than_parsed() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![
            "Testing 2 devices".into(),
            "not json at all".into(),
            result_line("ADD", "ok"),
            done_line(true),
        ],
        ..Default::default()
    }
    .write(dir.path(), "noisy");

    let events = collect(&plan(&["ADD"]), leaf).await;

    let (status, unparsed, ok) = events
        .iter()
        .find_map(|e| match e {
            RootEvent::FamilyEnd {
                status,
                unparsed,
                ok,
                ..
            } => Some((*status, unparsed.clone(), *ok)),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        status,
        FamilyStatus::Ok,
        "noise is not a reason to fail a family that otherwise passed"
    );
    assert_eq!(unparsed, vec!["Testing 2 devices", "not json at all"]);
    assert_eq!(ok, 1, "the real events around the noise are still read");
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_ends_the_run_and_marks_what_never_ran() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![result_line("ADD", "ok")],
        sleep: 60,
        ..Default::default()
    }
    .write(dir.path(), "slow");

    let mut p = plan(&["ADD", "MUL", "SUB"]);
    p.family_timeout = Duration::from_secs(60);

    let started = std::time::Instant::now();
    let events = collect_with(&p, leaf, tokio::time::sleep(Duration::from_millis(300))).await;

    assert_eq!(
        families(&events),
        vec![
            ("ADD", FamilyStatus::Cancelled),
            ("MUL", FamilyStatus::Cancelled),
            ("SUB", FamilyStatus::Cancelled)
        ],
        "the family in flight and every family after it are cancelled"
    );
    assert_eq!(done(&events), (false, true));
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "cancel must not wait out the family timeout"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_deadline_stops_the_run_and_says_why() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![done_line(true)],
        sleep: 60,
        ..Default::default()
    }
    .write(dir.path(), "overrun");

    let mut p = plan(&["ADD", "MUL"]);
    p.family_timeout = Duration::from_secs(60);
    p.deadline = Duration::from_millis(300);

    let events = collect(&p, leaf).await;

    let (ok, cancelled) = done(&events);
    assert!(!ok);
    assert!(!cancelled, "a deadline is not the user cancelling");
    let error = events.iter().find_map(|e| match e {
        RootEvent::Done { error, .. } => error.clone(),
        _ => None,
    });
    assert!(
        error.unwrap_or_default().contains("deadline"),
        "the run has to say why it stopped short"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_leaf_that_cannot_be_started_is_a_crash_not_a_panic() {
    let events = collect(&plan(&["ADD"]), PathBuf::from("no-such-jan-llama-worker")).await;
    assert_eq!(families(&events), vec![("ADD", FamilyStatus::Crashed)]);
    let exit = events
        .iter()
        .find_map(|e| match e {
            RootEvent::FamilyEnd { exit, .. } => exit.clone(),
            _ => None,
        })
        .unwrap();
    assert!(exit.contains("could not start"), "{exit}");
}

// The failure mode this whole phase has to avoid: a shape filter that matches
// no case makes the leaf exit 0 having tested nothing. Reported as a pass, the
// user is told their hardware is fine on the strength of zero evidence.
#[tokio::test(flavor = "multi_thread")]
async fn a_filter_that_matches_nothing_is_inconclusive_not_a_pass() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![done_line(true)],
        ..Default::default()
    }
    .write(dir.path(), "vacuous");

    let mut p = plan(&["MUL_MAT"]);
    p.families = vec![FamilyFilter::new("MUL_MAT", Some("type_a=nonesuch,"))];
    let events = collect(&p, leaf).await;

    assert_eq!(families(&events), vec![("MUL_MAT", FamilyStatus::NoCases)]);

    let summary = events
        .iter()
        .find_map(|e| match e {
            RootEvent::Summary {
                ok,
                failed,
                families_no_cases,
                ..
            } => Some((*ok, *failed, *families_no_cases)),
            _ => None,
        })
        .expect("a device summary");
    assert_eq!(summary, (0, 0, 1), "nothing ran, so nothing passed");

    let (ok, cancelled, inconclusive) = events
        .iter()
        .find_map(|e| match e {
            RootEvent::Done {
                ok,
                cancelled,
                inconclusive,
                ..
            } => Some((*ok, *cancelled, *inconclusive)),
            _ => None,
        })
        .expect("a run always ends with done");
    assert!(!cancelled);
    assert!(
        inconclusive,
        "the run must say it did not cover what it was asked to"
    );
    assert!(
        !ok,
        "a reader that checks only `ok` must not be told a run that tested \
         nothing was a clean bill of health; `inconclusive` is what separates \
         this from a real failure"
    );
}

// A filter narrow enough to keep one case is a real result, not a vacuous one.
#[tokio::test(flavor = "multi_thread")]
async fn a_filter_that_keeps_one_case_still_reports_a_pass() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![result_line("MUL_MAT", "ok"), done_line(true)],
        ..Default::default()
    }
    .write(dir.path(), "narrow");

    let mut p = plan(&["MUL_MAT"]);
    p.families = vec![FamilyFilter::new("MUL_MAT", Some("type_a=q4_K,"))];
    let events = collect(&p, leaf).await;

    assert_eq!(families(&events), vec![("MUL_MAT", FamilyStatus::Ok)]);
}

// Only-not-supported is a real answer: the device told us it runs the op
// elsewhere, which is information, unlike a filter that selected no case.
#[tokio::test(flavor = "multi_thread")]
async fn a_family_the_device_does_not_implement_is_not_inconclusive() {
    let dir = tempfile::tempdir().unwrap();
    let leaf = FakeLeaf {
        stdout: vec![result_line("SWIGLU", "not_supported"), done_line(true)],
        ..Default::default()
    }
    .write(dir.path(), "unsupported");

    let events = collect(&plan(&["SWIGLU"]), leaf).await;
    assert_eq!(families(&events), vec![("SWIGLU", FamilyStatus::Ok)]);
}

// The filter rides the argv, or the leaf would run the whole family.
#[tokio::test(flavor = "multi_thread")]
async fn the_shape_filter_reaches_the_leaf_argv() {
    let unit = DiagnosePlan {
        families: vec![FamilyFilter::new("MUL_MAT", Some("type_a=(q4_K|f16),"))],
        ..plan(&[])
    }
    .units()
    .remove(0);
    let args = LeafSpec::new(PathBuf::from("worker")).args(&unit);
    let at = args.iter().position(|a| a == "--params").expect("--params");
    assert_eq!(args[at + 1], "type_a=(q4_K|f16),");
}
