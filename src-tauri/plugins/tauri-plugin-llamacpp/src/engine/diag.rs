//! Types for the ggml op diagnostic: what to run, and the JSON events the
//! upstream `test-backend-ops` wrapper (`shim/jan_llama_diag.cpp`) emits.
//!
//! Deliberately not behind the `engine` feature: the desktop process links
//! this crate without ggml and still has to parse what a worker prints, and
//! these are pure data so `make test-rust` covers them.

use serde::{Deserialize, Serialize};

/// What a run checks. Perf and grad are upstream modes too and are left out on
/// purpose: neither answers "does this op work here".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagMode {
    /// Run each case on the device and on the CPU reference and compare.
    Test,
    /// Only ask the device whether it supports each case's ops.
    Support,
}

/// One device, one slice of the cases. This is the unit a leaf process runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagRunRequest {
    pub mode: DiagMode,
    /// A ggml device name as `Engine::diag_backends_json` lists it ("CPU",
    /// "CUDA0", "Vulkan0").
    pub backend: String,
    /// Upstream's `-o`: comma separated op names, full case strings or regexes.
    pub op_filter: Option<String>,
    /// Upstream's `-p`: a regex searched in each case's parameter string.
    pub params_filter: Option<String>,
    /// Upstream's `-j`. Test mode only; 1 is the sequential default.
    pub workers: u32,
}

/// One slice of the op list: a family, optionally narrowed to the shapes a
/// particular model uses.
///
/// `params` is upstream's `-p`, a regex searched in each case's parameter
/// string. Those strings are not a stable contract, so a filter that matches
/// nothing must never read as a pass; the root reports such a unit as
/// [`crate::engine::diagnose::FamilyStatus::NoCases`] rather than `Ok`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FamilyFilter {
    pub family: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<String>,
}

impl FamilyFilter {
    pub fn new(family: impl Into<String>, params: Option<&str>) -> Self {
        Self {
            family: family.into(),
            params: params.map(str::to_string),
        }
    }
}

/// A case's outcome. `NotSupported` is not a failure: it is the device saying
/// ggml will run that op somewhere else, which explains slowness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagStatus {
    Ok,
    Fail,
    NotSupported,
    Skipped,
}

/// One finished case. Its own struct because the root's `case` event
/// ([`crate::engine::diagnose`]) forwards exactly this, tagged with the device
/// and family it came from, rather than restating the fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagCase {
    pub backend: String,
    pub op: String,
    pub params: String,
    pub mode: String,
    pub status: DiagStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The text upstream printed while the case ran (the offending tensor and
    /// its error), present only on a failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One ggml device, as a `--diagnose-devices` leaf reports it. ggml knows no
/// driver version; the plugin joins that in by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagDevice {
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub kind: DiagDeviceKind,
    pub reg: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_total_mib: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_free_mib: Option<u64>,
}

/// An entry of `Engine::devices_json`, which reports memory but omits the CPU.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DiagDeviceMemory {
    pub id: String,
    #[serde(rename = "mem")]
    pub total_mib: u64,
    #[serde(rename = "free")]
    pub free_mib: u64,
}

/// Joins the two listings ggml offers: `diag_backends_json` knows every device
/// and its kind, `devices_json` knows how much memory the offloadable ones
/// have. Kept apart upstream of here because asking a CUDA device for its
/// memory creates a context the process then holds.
pub fn merge_devices(backends: Vec<DiagBackend>, memory: &[DiagDeviceMemory]) -> Vec<DiagDevice> {
    backends
        .into_iter()
        .map(|b| {
            let mem = memory.iter().find(|m| m.id == b.name);
            DiagDevice {
                name: b.name,
                description: b.description,
                kind: b.kind,
                reg: b.reg,
                memory_total_mib: mem.map(|m| m.total_mib),
                memory_free_mib: mem.map(|m| m.free_mib),
            }
        })
        .collect()
}

/// One line of the wrapper's JSON stream, discriminated by its `event` key.
///
/// The field names are upstream's `printer` structs, snake_cased. An event the
/// parser does not know deserializes to `Unknown`, so a llama.cpp bump that adds
/// one cannot break a reader that only wants results.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum DiagEvent {
    TestingStart {
        devices: usize,
    },
    BackendInit {
        index: usize,
        total: usize,
        name: String,
        skipped: bool,
        #[serde(default)]
        skip_reason: Option<String>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        memory_total_mb: Option<u64>,
        #[serde(default)]
        memory_free_mb: Option<u64>,
    },
    Result(DiagCase),
    /// Upstream's per-operation report, which only its grad mode and a few
    /// error paths use; kept so nothing the printer interface says is dropped.
    Operation {
        op: String,
        params: String,
        backend: String,
        status: DiagStatus,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        component: Option<String>,
        #[serde(default)]
        details: Option<String>,
    },
    /// The per-device case tally. Not-supported and skipped cases are not in it.
    Summary {
        passed: usize,
        total: usize,
    },
    /// `op(params)` of every failed case, as upstream spells them, so a case
    /// can be re-run through `op_filter`.
    FailedTests {
        tests: Vec<String>,
    },
    BackendStatus {
        backend: String,
        status: DiagStatus,
    },
    OverallSummary {
        passed: usize,
        total: usize,
        all_passed: bool,
    },
    /// Text upstream printed outside a case's result.
    Log {
        text: String,
    },
    /// Always the last event of a run. `error` is set when nothing could run.
    Done {
        ok: bool,
        #[serde(default)]
        error: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

impl DiagEvent {
    pub fn parse(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line)
    }
}

/// Running totals over the `Result` events of one stream.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DiagTally {
    pub ok: usize,
    pub failed: usize,
    pub not_supported: usize,
}

impl DiagTally {
    pub fn record(&mut self, event: &DiagEvent) {
        if let DiagEvent::Result(case) = event {
            match case.status {
                DiagStatus::Ok => self.ok += 1,
                DiagStatus::Fail => self.failed += 1,
                DiagStatus::NotSupported => self.not_supported += 1,
                DiagStatus::Skipped => {}
            }
        }
    }
}

/// An entry of `Engine::diag_ops_json`: how many cases test mode runs for an
/// op family. Zero means upstream has no test for it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DiagOp {
    pub op: String,
    pub cases: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagDeviceKind {
    Cpu,
    Gpu,
    Igpu,
    Accel,
    Meta,
    #[serde(other)]
    Unknown,
}

/// An entry of `Engine::diag_backends_json`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DiagBackend {
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub kind: DiagDeviceKind,
    /// The backend registry the device belongs to ("CPU", "CUDA", "Vulkan").
    pub reg: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_passing_result_parses() {
        let e = DiagEvent::parse(
            r#"{"event":"result","backend":"CPU","op":"ADD","params":"type=f32","mode":"test","status":"ok"}"#,
        )
        .unwrap();
        assert_eq!(
            e,
            DiagEvent::Result(DiagCase {
                backend: "CPU".into(),
                op: "ADD".into(),
                params: "type=f32".into(),
                mode: "test".into(),
                status: DiagStatus::Ok,
                error: None,
                detail: None,
            })
        );
    }

    #[test]
    fn a_failure_keeps_the_text_upstream_printed() {
        let e = DiagEvent::parse(
            r#"{"event":"result","backend":"Vulkan0","op":"MUL_MAT","params":"k=3","mode":"test","status":"fail","error":"compare failed","detail":"[MUL_MAT] ERR = 0.5 > 0.0001"}"#,
        )
        .unwrap();
        let DiagEvent::Result(case) = e else {
            panic!("not a result");
        };
        assert_eq!(case.status, DiagStatus::Fail);
        assert_eq!(case.error.as_deref(), Some("compare failed"));
        assert!(case.detail.unwrap().contains("ERR"));
    }

    #[test]
    fn the_device_events_parse_with_and_without_memory() {
        let skipped =
            DiagEvent::parse(r#"{"event":"backend_init","index":0,"total":2,"name":"CPU","skipped":true,"skip_reason":"Skipping"}"#)
                .unwrap();
        assert!(matches!(skipped, DiagEvent::BackendInit { skipped: true, memory_free_mb: None, .. }));

        let live = DiagEvent::parse(
            r#"{"event":"backend_init","index":1,"total":2,"name":"CUDA0","skipped":false,"description":"RTX","memory_total_mb":24576,"memory_free_mb":20000}"#,
        )
        .unwrap();
        assert!(matches!(live, DiagEvent::BackendInit { memory_total_mb: Some(24576), .. }));
    }

    #[test]
    fn the_stream_terminators_parse() {
        assert_eq!(
            DiagEvent::parse(r#"{"event":"done","ok":false,"error":"no ggml device named X"}"#).unwrap(),
            DiagEvent::Done { ok: false, error: Some("no ggml device named X".into()) }
        );
        assert_eq!(
            DiagEvent::parse(r#"{"event":"overall_summary","passed":1,"total":1,"all_passed":true}"#).unwrap(),
            DiagEvent::OverallSummary { passed: 1, total: 1, all_passed: true }
        );
    }

    #[test]
    fn an_event_from_a_newer_wrapper_is_unknown_not_an_error() {
        assert_eq!(
            DiagEvent::parse(r#"{"event":"something_new","x":1}"#).unwrap(),
            DiagEvent::Unknown
        );
    }

    #[test]
    fn a_line_that_is_not_an_event_is_an_error() {
        assert!(DiagEvent::parse("Testing 1 devices").is_err());
        assert!(DiagEvent::parse(r#"{"no_event_key":1}"#).is_err());
    }

    #[test]
    fn the_tally_counts_results_and_ignores_everything_else() {
        let line = |status: &str| {
            DiagEvent::parse(&format!(
                r#"{{"event":"result","backend":"CPU","op":"ADD","params":"","mode":"test","status":"{status}"}}"#
            ))
            .unwrap()
        };
        let mut t = DiagTally::default();
        for e in [
            line("ok"),
            line("ok"),
            line("fail"),
            line("not_supported"),
            line("skipped"),
            DiagEvent::Summary { passed: 2, total: 3 },
        ] {
            t.record(&e);
        }
        assert_eq!(t, DiagTally { ok: 2, failed: 1, not_supported: 1 });
    }

    #[test]
    fn a_device_keeps_its_kind_and_gains_memory_only_if_ggml_reports_it() {
        let backends = vec![
            DiagBackend {
                name: "CPU".into(),
                description: "12th Gen Intel".into(),
                kind: DiagDeviceKind::Cpu,
                reg: "CPU".into(),
            },
            DiagBackend {
                name: "CUDA0".into(),
                description: "RTX 3090".into(),
                kind: DiagDeviceKind::Gpu,
                reg: "CUDA".into(),
            },
        ];
        let memory = vec![DiagDeviceMemory {
            id: "CUDA0".into(),
            total_mib: 24576,
            free_mib: 20000,
        }];
        let merged = merge_devices(backends, &memory);
        assert_eq!(merged[0].memory_total_mib, None, "the CPU is not listed");
        assert_eq!(merged[0].kind, DiagDeviceKind::Cpu);
        assert_eq!(merged[1].memory_free_mib, Some(20000));
    }

    #[test]
    fn the_op_and_backend_listings_parse() {
        let ops: Vec<DiagOp> = serde_json::from_str(r#"[{"op":"ADD","cases":120},{"op":"FOO","cases":0}]"#).unwrap();
        assert_eq!(ops[0], DiagOp { op: "ADD".into(), cases: 120 });

        let b: Vec<DiagBackend> = serde_json::from_str(
            r#"[{"name":"CUDA0","description":"RTX 3090","type":"gpu","reg":"CUDA"},{"name":"X","description":"","type":"npu","reg":"X"}]"#,
        )
        .unwrap();
        assert_eq!(b[0].kind, DiagDeviceKind::Gpu);
        assert_eq!(b[1].kind, DiagDeviceKind::Unknown);
    }
}
