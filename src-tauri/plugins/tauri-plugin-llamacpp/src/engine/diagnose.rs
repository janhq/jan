//! The root of the ggml op diagnostic: it picks the work, runs each slice in a
//! leaf process, and prints one JSON event per line.
//!
//! The root never loads ggml and never registers a backend, so no kernel can
//! take it down; a `GGML_ASSERT` costs the leaf that ran it. That is also why
//! this module is outside the `engine` feature gate: it is process supervision
//! plus bookkeeping, so `cargo test` covers it with no C++ toolchain, exactly
//! as [`super::diag`] and [`super::worker`] are.
//!
//! Nothing here touches the serving engine. The root holds no registry, opens
//! no preset and speaks to no worker port, so a leaf crash cannot unload a
//! model the user has resident.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::diagnostics::EngineBuild;

use super::diag::{
    DiagCase, DiagDevice, DiagEvent, DiagMode, DiagRunRequest, DiagTally, FamilyFilter,
};
use super::worker::describe_exit;

/// Version of the event stream below. Bumped when an existing event changes
/// shape; a *new* event does not need it, since readers treat an unknown
/// `event` as `Unknown` (see [`super::diag::DiagEvent`]).
///
/// 2 added [`FamilyStatus::NoCases`], `summary.families_no_cases`,
/// `done.inconclusive` and `start.model`.
pub const SCHEMA_VERSION: u32 = 2;

/// The family name standing for "every op", used by the support probe.
pub const ALL_FAMILIES: &str = "*";

/// Narrows `wanted` to the families upstream actually has cases for.
///
/// The guard that keeps a preset honest in its *family* dimension: a name
/// upstream has dropped runs no cases and would report a clean pass, which is
/// the one wrong answer a diagnostic must not give. The shape dimension cannot
/// be checked ahead of time and is caught at the other end, by
/// [`FamilyStatus::NoCases`].
pub fn tested_families(wanted: Vec<FamilyFilter>, tested: &[String]) -> Vec<FamilyFilter> {
    wanted
        .into_iter()
        .filter(|f| tested.contains(&f.family))
        .collect()
}

/// Per-family ceiling. The slowest measured family is MUL_MAT_ID at 121 s on a
/// warm GPU, so this is generous enough that a leaf hitting it is wedged rather
/// than slow.
pub const DEFAULT_FAMILY_TIMEOUT: Duration = Duration::from_secs(600);

/// Ceiling on the whole run. A Full run measured 15 min on one device, so this
/// covers a few devices and still bounds a machine that is thrashing.
pub const DEFAULT_DEADLINE: Duration = Duration::from_secs(5400);

/// How much of a leaf's stderr, and how many of its unreadable stdout lines,
/// are kept for the family that produced them.
const LEAF_TAIL_LINES: usize = 20;

/// Longest leaf line kept, so a runaway print cannot grow the root's memory.
const LEAF_LINE_CHARS: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagPreset {
    /// The support probe plus the common-shape list
    /// ([`super::model_plan::quick_families`]) in test mode.
    Quick,
    /// Every family upstream has a test for.
    Full,
    /// Only the families one gguf's graph contains, at its own shapes
    /// ([`super::model_plan::model_families`]).
    Model,
}

/// How a family ended. Only `Fail` means a kernel computed the wrong answer;
/// the rest are the leaf itself going wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyStatus {
    Ok,
    Fail,
    /// The leaf ran cleanly and tested nothing, because the shape filter
    /// matched no case. Inconclusive, never a pass: reporting it green is
    /// exactly the wrong answer, and upstream's parameter strings are not a
    /// stable contract, so this is a thing that will happen.
    NoCases,
    /// The leaf died, which is what a `GGML_ASSERT` or a device loss looks like.
    Crashed,
    /// The leaf outlived its timeout and was killed.
    Hung,
    /// Cancelled, or the run's deadline passed, before the leaf finished.
    Cancelled,
}

/// One device and one slice of the op list: the unit a leaf process runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagUnit {
    pub device: String,
    /// Display name of the slice; [`ALL_FAMILIES`] for the support probe.
    pub family: String,
    pub request: DiagRunRequest,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DiagnosePlan {
    pub preset: DiagPreset,
    pub engine: EngineBuild,
    pub devices: Vec<DiagDevice>,
    /// Families to run in test mode, in order, each optionally narrowed to
    /// the shapes a model uses.
    pub families: Vec<FamilyFilter>,
    /// The model this plan was built for, for the `start` event. Only the
    /// [`DiagPreset::Model`] preset has one.
    pub model: Option<String>,
    /// Run the whole-op-list support probe on each device first. It costs under
    /// a second and is the only thing that answers "what falls back to CPU".
    pub support_probe: bool,
    pub workers: u32,
    /// Backend modules the probe process loaded, e.g. `libggml-cuda.so`.
    pub backend_modules: Vec<String>,
    pub family_timeout: Duration,
    pub deadline: Duration,
}

impl DiagnosePlan {
    pub fn units(&self) -> Vec<DiagUnit> {
        let mut out = Vec::new();
        for device in &self.devices {
            if self.support_probe {
                out.push(DiagUnit {
                    device: device.name.clone(),
                    family: ALL_FAMILIES.to_string(),
                    request: DiagRunRequest {
                        mode: DiagMode::Support,
                        backend: device.name.clone(),
                        op_filter: None,
                        params_filter: None,
                        workers: 1,
                    },
                });
            }
            for family in &self.families {
                out.push(DiagUnit {
                    device: device.name.clone(),
                    family: family.family.clone(),
                    request: DiagRunRequest {
                        mode: DiagMode::Test,
                        backend: device.name.clone(),
                        op_filter: Some(family.family.clone()),
                        params_filter: family.params.clone(),
                        workers: self.workers,
                    },
                });
            }
        }
        out
    }
}

/// One line of the root's stdout. Readers must tolerate an unknown `event`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum RootEvent {
    Start {
        schema: u32,
        preset: DiagPreset,
        engine: EngineBuild,
        /// Family names, in the order they run. The filters themselves stay
        /// out: a user reading the result has no use for a ggml regex, and a
        /// narrowed family that tests nothing reports itself as `no_cases`.
        families: Vec<String>,
        /// The model file this run was built for, on the model preset.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        support_probe: bool,
        backend_modules: Vec<String>,
        /// How many leaf processes the run will spawn if nothing cancels it.
        units: usize,
        family_timeout_secs: u64,
        deadline_secs: u64,
    },
    Device(DiagDevice),
    FamilyStart {
        device: String,
        family: String,
        mode: DiagMode,
    },
    /// One case, as the leaf reported it, tagged with where it came from.
    Case {
        device: String,
        family: String,
        #[serde(flatten)]
        case: DiagCase,
    },
    FamilyEnd {
        device: String,
        family: String,
        status: FamilyStatus,
        ok: usize,
        failed: usize,
        not_supported: usize,
        millis: u64,
        /// How the leaf ended, from [`describe_exit`]. Absent when it was still
        /// running (hung, cancelled).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit: Option<String>,
        /// The leaf's last stderr lines, oldest first.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        last_lines: Vec<String>,
        /// Stdout lines that were not events. A leaf writing these is a bug on
        /// our side, not the machine's, so they are reported rather than hidden.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        unparsed: Vec<String>,
    },
    Summary {
        device: String,
        ok: usize,
        failed: usize,
        not_supported: usize,
        families_crashed: usize,
        families_hung: usize,
        /// Families whose filter matched no case, so they tested nothing.
        #[serde(default)]
        families_no_cases: usize,
        /// Families the run never reached, because it was cancelled or passed
        /// its deadline. Reported so a device whose remaining families were
        /// dropped is not read as a clean pass on the ones that did run.
        #[serde(default)]
        families_cancelled: usize,
    },
    /// Always last. `ok` is false if any case failed or any family did not
    /// complete.
    Done {
        ok: bool,
        cancelled: bool,
        /// At least one family tested nothing, so `ok` is not the whole
        /// answer. Separate from `ok` on purpose: nothing failed, but the run
        /// did not cover what it was asked to.
        #[serde(default)]
        inconclusive: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

/// How to start a leaf. Tests point `program` at a stand-in that exits, hangs
/// or prints garbage; in the app it is the worker binary itself.
#[derive(Debug, Clone)]
pub struct LeafSpec {
    pub program: PathBuf,
}

impl LeafSpec {
    pub fn new(program: PathBuf) -> Self {
        Self { program }
    }

    /// The argv a leaf is started with, which is also what
    /// `jan-llama-worker` parses.
    pub fn args(&self, unit: &DiagUnit, family_timeout: Duration) -> Vec<String> {
        let mut args = vec!["--diagnose-run".to_string()];
        args.push(unit.device.clone());
        args.push("--mode".into());
        args.push(
            match unit.request.mode {
                DiagMode::Test => "test",
                DiagMode::Support => "support",
            }
            .into(),
        );
        if let Some(ops) = &unit.request.op_filter {
            args.push("--op".into());
            args.push(ops.clone());
        }
        if let Some(params) = &unit.request.params_filter {
            args.push("--params".into());
            args.push(params.clone());
        }
        args.push("--workers".into());
        args.push(unit.request.workers.max(1).to_string());
        // Passed so the leaf can end itself if this root dies without
        // killing it. Enforced here too, which is what normally stops it.
        args.push("--family-timeout".into());
        args.push(family_timeout.as_secs().to_string());
        args
    }

    fn command(&self, unit: &DiagUnit, family_timeout: Duration) -> Command {
        self.base_command(&self.args(unit, family_timeout))
    }

    fn base_command(&self, args: &[String]) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW: a leaf must not flash a console on the
            // desktop. `creation_flags` is tokio's own, so std's `CommandExt`
            // is not imported for it.
            cmd.creation_flags(0x0800_0000);
        }
        cmd.kill_on_drop(true);
        cmd
    }
}

/// Ceiling on a one-shot probe. Generous because enumerating CUDA devices
/// creates a context, which is seconds on a cold driver.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(120);

/// The flag the leaf answering [`probe_devices`] is started with.
pub const DEVICES_FLAG: &str = "--diagnose-devices";
/// The flag the leaf answering [`probe_families`] is started with.
pub const OPS_FLAG: &str = "--diagnose-ops";

async fn probe(spec: &LeafSpec, flag: &str) -> Result<(String, Vec<String>), String> {
    let args = [flag.to_string()];
    let out = tokio::time::timeout(PROBE_TIMEOUT, spec.base_command(&args).output())
        .await
        .map_err(|_| format!("{flag} did not answer within {}s", PROBE_TIMEOUT.as_secs()))?
        .map_err(|e| format!("could not start {}: {e}", spec.program.display()))?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        let tail: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
        let tail = tail[tail.len().saturating_sub(3)..].join("; ");
        return Err(format!("{flag} failed: {} {tail}", describe_exit(&out.status)));
    }
    let backends = stderr
        .lines()
        .filter_map(super::worker::parse_backend_line)
        .collect();
    Ok((String::from_utf8_lossy(&out.stdout).into_owned(), backends))
}

/// Asks a leaf what ggml devices exist, and which backend modules it loaded to
/// find them. The root cannot answer this itself: it holds no ggml on purpose.
pub async fn probe_devices(spec: &LeafSpec) -> Result<(Vec<DiagDevice>, Vec<String>), String> {
    let (stdout, backends) = probe(spec, DEVICES_FLAG).await?;
    let devices = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("{DEVICES_FLAG} printed something unreadable: {e}"))?;
    Ok((devices, backends))
}

/// The op families upstream has at least one test case for, which is the Full
/// preset. Families with no case are dropped: a leaf for one would spawn,
/// init a backend and report nothing.
pub async fn probe_families(spec: &LeafSpec) -> Result<Vec<String>, String> {
    let (stdout, _) = probe(spec, OPS_FLAG).await?;
    let ops: Vec<super::diag::DiagOp> = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("{OPS_FLAG} printed something unreadable: {e}"))?;
    Ok(ops
        .into_iter()
        .filter(|o| o.cases > 0)
        .map(|o| o.op)
        .collect())
}

/// What one leaf produced.
#[derive(Debug, Clone, PartialEq)]
struct UnitOutcome {
    status: FamilyStatus,
    tally: DiagTally,
    exit: Option<String>,
    last_lines: Vec<String>,
    unparsed: Vec<String>,
}

fn push_tail(tail: &mut VecDeque<String>, line: &str) {
    let line = line.trim_end();
    if line.is_empty() {
        return;
    }
    let line: String = line.chars().take(LEAF_LINE_CHARS).collect();
    if tail.len() == LEAF_TAIL_LINES {
        tail.pop_front();
    }
    tail.push_back(line);
}

/// Per-device counts of families that did not produce a usable result.
#[derive(Debug, Clone, Copy, Default)]
struct DeviceFaults {
    crashed: usize,
    hung: usize,
    no_cases: usize,
    cancelled: usize,
}

/// One device's running totals.
///
/// The test units and the support probe are kept apart because they answer
/// different questions and a single tally conflates them. The probe asks
/// `ggml_backend_supports_op` over the whole op list and reports every
/// supported case as `ok` without computing anything, so folding it into the
/// pass count inflates "Passed X of Y" with cases that were never run, and
/// adding both `not_supported` counts bills every probed case twice.
#[derive(Default)]
struct DeviceRollup {
    test: DiagTally,
    probe: DiagTally,
    probed: bool,
    faults: DeviceFaults,
}

impl DeviceRollup {
    fn add(&mut self, mode: DiagMode, tally: &DiagTally) {
        let into = if mode == DiagMode::Support {
            self.probed = true;
            &mut self.probe
        } else {
            &mut self.test
        };
        into.ok += tally.ok;
        into.failed += tally.failed;
        into.not_supported += tally.not_supported;
    }

    /// What the device does not implement. The probe is authoritative when it
    /// ran -- it covers the whole op list rather than the families this run
    /// happened to test -- and the test units are the only source when it did
    /// not.
    fn not_supported(&self) -> usize {
        if self.probed {
            self.probe.not_supported
        } else {
            self.test.not_supported
        }
    }
}

/// Why a run stopped early, if it did.
enum Interrupt {
    Cancelled,
    Deadline,
}

/// Runs `plan`, emitting every event through `emit` as it happens. Resolves
/// when the plan is done, `cancel` resolves, or the deadline passes; a leaf
/// still running at that point is killed.
pub async fn run<F>(
    plan: &DiagnosePlan,
    spec: &LeafSpec,
    cancel: F,
    emit: &mut impl FnMut(RootEvent),
) where
    F: std::future::Future<Output = ()>,
{
    let units = plan.units();
    emit(RootEvent::Start {
        schema: SCHEMA_VERSION,
        preset: plan.preset,
        engine: plan.engine.clone(),
        families: plan.families.iter().map(|f| f.family.clone()).collect(),
        model: plan.model.clone(),
        support_probe: plan.support_probe,
        backend_modules: plan.backend_modules.clone(),
        units: units.len(),
        family_timeout_secs: plan.family_timeout.as_secs(),
        deadline_secs: plan.deadline.as_secs(),
    });
    for device in &plan.devices {
        emit(RootEvent::Device(device.clone()));
    }

    let mut cancel = std::pin::pin!(cancel);
    let deadline = tokio::time::Instant::now() + plan.deadline;
    let mut interrupt = None;
    let mut any_failure = false;
    let mut any_inconclusive = false;
    // One entry per device, in the order the units visit them, which
    // `DiagnosePlan::units` keeps device-major.
    let mut per_device: Vec<(String, DeviceRollup)> = Vec::new();

    for unit in &units {
        if per_device.last().map(|d| d.0.as_str()) != Some(unit.device.as_str()) {
            per_device.push((unit.device.clone(), DeviceRollup::default()));
        }
        emit(RootEvent::FamilyStart {
            device: unit.device.clone(),
            family: unit.family.clone(),
            mode: unit.request.mode,
        });

        let started = std::time::Instant::now();
        let outcome = if interrupt.is_some() {
            UnitOutcome {
                status: FamilyStatus::Cancelled,
                tally: DiagTally::default(),
                exit: None,
                last_lines: Vec::new(),
                unparsed: Vec::new(),
            }
        } else {
            tokio::select! {
                biased;
                _ = &mut cancel => {
                    interrupt = Some(Interrupt::Cancelled);
                    cancelled_outcome()
                }
                _ = tokio::time::sleep_until(deadline) => {
                    interrupt = Some(Interrupt::Deadline);
                    cancelled_outcome()
                }
                o = run_unit(spec, unit, plan.family_timeout, emit) => o,
            }
        };

        let device = per_device.last_mut().expect("pushed above");
        device.1.add(unit.request.mode, &outcome.tally);
        match outcome.status {
            FamilyStatus::Crashed => device.1.faults.crashed += 1,
            FamilyStatus::Hung => device.1.faults.hung += 1,
            FamilyStatus::NoCases => device.1.faults.no_cases += 1,
            FamilyStatus::Cancelled => device.1.faults.cancelled += 1,
            _ => {}
        }
        // A family that tested nothing has not failed, so it must not read as
        // "problems found"; it is reported on its own channel instead.
        if outcome.status == FamilyStatus::NoCases {
            any_inconclusive = true;
        } else if outcome.status != FamilyStatus::Ok {
            any_failure = true;
        }

        emit(RootEvent::FamilyEnd {
            device: unit.device.clone(),
            family: unit.family.clone(),
            status: outcome.status,
            ok: outcome.tally.ok,
            failed: outcome.tally.failed,
            not_supported: outcome.tally.not_supported,
            millis: started.elapsed().as_millis() as u64,
            exit: outcome.exit,
            last_lines: outcome.last_lines,
            unparsed: outcome.unparsed,
        });
    }

    for (device, rollup) in per_device {
        emit(RootEvent::Summary {
            device,
            // The test units alone: these are the cases that were computed and
            // compared, which is what a pass count has to mean.
            ok: rollup.test.ok,
            failed: rollup.test.failed,
            not_supported: rollup.not_supported(),
            families_crashed: rollup.faults.crashed,
            families_hung: rollup.faults.hung,
            families_no_cases: rollup.faults.no_cases,
            families_cancelled: rollup.faults.cancelled,
        });
    }

    emit(RootEvent::Done {
        // `ok` is "this run is a clean bill of health", not "nothing failed":
        // a reader that checks only this field must never be told a run that
        // tested nothing went fine, which is the whole hazard a narrowed
        // filter introduces. `inconclusive` says which of the two it was.
        ok: !any_failure && !any_inconclusive && interrupt.is_none(),
        cancelled: matches!(interrupt, Some(Interrupt::Cancelled)),
        inconclusive: any_inconclusive,
        error: match interrupt {
            Some(Interrupt::Deadline) => Some(format!(
                "the run passed its {}s deadline",
                plan.deadline.as_secs()
            )),
            _ => None,
        },
    });
}

fn cancelled_outcome() -> UnitOutcome {
    UnitOutcome {
        status: FamilyStatus::Cancelled,
        tally: DiagTally::default(),
        exit: None,
        last_lines: Vec::new(),
        unparsed: Vec::new(),
    }
}

/// Spawns one leaf and reads it to the end, or kills it at `timeout`.
async fn run_unit(
    spec: &LeafSpec,
    unit: &DiagUnit,
    timeout: Duration,
    emit: &mut impl FnMut(RootEvent),
) -> UnitOutcome {
    let mut child = match spec.command(unit, timeout).spawn() {
        Ok(c) => c,
        Err(e) => {
            return UnitOutcome {
                status: FamilyStatus::Crashed,
                tally: DiagTally::default(),
                exit: Some(format!("could not start {}: {e}", spec.program.display())),
                last_lines: Vec::new(),
                unparsed: Vec::new(),
            }
        }
    };

    // Drained on its own task: a leaf that fills the stderr pipe while we read
    // stdout would deadlock against us.
    let stderr_tail = std::sync::Arc::new(std::sync::Mutex::new(VecDeque::new()));
    let stderr_drain = child.stderr.take().map(|stderr| {
        let tail = std::sync::Arc::clone(&stderr_tail);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // ggml's startup announcements carry the module's full local
                // path and say nothing about a crash; the plan already reports
                // the modules, stripped, under `backend_modules`.
                if super::worker::is_tail_noise(&line) {
                    continue;
                }
                if let Ok(mut tail) = tail.lock() {
                    push_tail(&mut tail, &line);
                }
            }
        })
    });

    let mut tally = DiagTally::default();
    let mut unparsed = VecDeque::new();
    let mut saw_done = false;
    let mut leaf_error = None;

    let stdout = child.stdout.take();
    let read = async {
        let Some(stdout) = stdout else {
            return;
        };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(event) = DiagEvent::parse(&line) else {
                push_tail(&mut unparsed, &line);
                continue;
            };
            tally.record(&event);
            match event {
                DiagEvent::Result(case) => emit(RootEvent::Case {
                    device: unit.device.clone(),
                    family: unit.family.clone(),
                    case,
                }),
                DiagEvent::Done { ok, error } => {
                    saw_done = true;
                    if !ok {
                        leaf_error = error;
                    }
                }
                _ => {}
            }
        }
    };

    let status = match tokio::time::timeout(timeout, async {
        read.await;
        child.wait().await
    })
    .await
    {
        Ok(status) => Some(status),
        Err(_) => {
            let _ = child.kill().await;
            None
        }
    };

    if let Some(drain) = stderr_drain {
        // The leaf is gone by now either way, so this is already resolved or
        // about to be; bounded so a stuck pipe cannot park the whole run.
        let _ = tokio::time::timeout(Duration::from_secs(2), drain).await;
    }
    let mut last_lines: Vec<String> = stderr_tail
        .lock()
        .map(|t| t.iter().cloned().collect())
        .unwrap_or_default();

    let (status, exit) = match status {
        None => (FamilyStatus::Hung, None),
        Some(Err(e)) => (FamilyStatus::Crashed, Some(e.to_string())),
        Some(Ok(code)) => {
            let described = describe_exit(&code);
            if !code.success() || !saw_done {
                (FamilyStatus::Crashed, Some(described))
            } else if tally.failed > 0 || leaf_error.is_some() {
                (FamilyStatus::Fail, Some(described))
            } else if tally.ok + tally.not_supported == 0 {
                // A clean exit having tested nothing: the shape filter matched
                // no case. The run must say so rather than count it as a pass.
                (FamilyStatus::NoCases, Some(described))
            } else {
                (FamilyStatus::Ok, Some(described))
            }
        }
    };
    // The leaf's own reason for giving up reads better than its exit code, so
    // it is kept rather than dropped for want of a field. It goes last
    // because `last_lines` is oldest-first and this is the final thing the
    // leaf said.
    if let Some(error) = leaf_error {
        last_lines.push(error);
    }

    UnitOutcome {
        status,
        tally,
        exit,
        last_lines,
        unparsed: unparsed.into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::diag::{DiagDeviceKind, DiagStatus};

    fn device(name: &str) -> DiagDevice {
        DiagDevice {
            name: name.into(),
            description: "test device".into(),
            kind: DiagDeviceKind::Gpu,
            reg: "Test".into(),
            memory_total_mib: Some(1024),
            memory_free_mib: Some(512),
        }
    }

    fn plan(devices: Vec<DiagDevice>, families: Vec<&str>, support: bool) -> DiagnosePlan {
        DiagnosePlan {
            preset: DiagPreset::Quick,
            engine: EngineBuild {
                version: "0".into(),
                tag: "b1".into(),
                commit: "abc".into(),
            },
            devices,
            families: families.into_iter().map(|f| FamilyFilter::new(f, None)).collect(),
            model: None,
            support_probe: support,
            workers: 4,
            backend_modules: vec!["libggml-cpu.so".into()],
            family_timeout: DEFAULT_FAMILY_TIMEOUT,
            deadline: DEFAULT_DEADLINE,
        }
    }

    #[test]
    fn the_probe_leads_each_device_and_families_follow_in_order() {
        let p = plan(vec![device("CPU"), device("CUDA0")], vec!["ADD", "MUL"], true);
        let units = p.units();
        assert_eq!(units.len(), 6);
        assert_eq!(units[0].family, ALL_FAMILIES);
        assert_eq!(units[0].request.mode, DiagMode::Support);
        assert_eq!(units[0].request.op_filter, None);
        assert_eq!(units[1].family, "ADD");
        assert_eq!(units[1].request.op_filter.as_deref(), Some("ADD"));
        assert_eq!(units[1].request.workers, 4);
        assert_eq!(units[3].device, "CUDA0");
    }

    #[test]
    fn the_probe_is_the_only_unit_when_no_family_is_asked_for() {
        let units = plan(vec![device("CPU")], vec![], true).units();
        assert_eq!(units.len(), 1);
        assert!(plan(vec![device("CPU")], vec![], false).units().is_empty());
    }

    #[test]
    fn the_support_probe_never_runs_cases_in_parallel() {
        // Support mode builds graphs and asks; workers would buy nothing and
        // upstream only threads test mode.
        let units = plan(vec![device("CPU")], vec!["ADD"], true).units();
        assert_eq!(units[0].request.workers, 1);
    }

    #[test]
    fn the_leaf_argv_carries_the_whole_request() {
        let spec = LeafSpec::new(PathBuf::from("worker"));
        let unit = DiagUnit {
            device: "Vulkan0".into(),
            family: "MUL_MAT".into(),
            request: DiagRunRequest {
                mode: DiagMode::Test,
                backend: "Vulkan0".into(),
                op_filter: Some("MUL_MAT".into()),
                params_filter: Some("m=4096".into()),
                workers: 8,
            },
        };
        assert_eq!(
            spec.args(&unit, DEFAULT_FAMILY_TIMEOUT),
            vec![
                "--diagnose-run",
                "Vulkan0",
                "--mode",
                "test",
                "--op",
                "MUL_MAT",
                "--params",
                "m=4096",
                "--workers",
                "8",
                "--family-timeout",
                "600",
            ]
        );
    }

    #[test]
    fn a_probe_argv_omits_the_filters_it_has_none_of() {
        let spec = LeafSpec::new(PathBuf::from("worker"));
        let units = plan(vec![device("CPU")], vec![], true).units();
        let args = spec.args(&units[0], DEFAULT_FAMILY_TIMEOUT);
        assert!(!args.iter().any(|a| a == "--op" || a == "--params"));
        assert_eq!(args[3], "support");
    }

    #[test]
    fn the_tail_keeps_the_newest_lines_and_drops_blanks() {
        let mut tail = VecDeque::new();
        for i in 0..LEAF_TAIL_LINES + 5 {
            push_tail(&mut tail, &format!("line {i}"));
            push_tail(&mut tail, "   ");
        }
        assert_eq!(tail.len(), LEAF_TAIL_LINES);
        assert_eq!(tail.back().unwrap(), &format!("line {}", LEAF_TAIL_LINES + 4));

        push_tail(&mut tail, &"x".repeat(LEAF_LINE_CHARS * 2));
        assert_eq!(tail.back().unwrap().chars().count(), LEAF_LINE_CHARS);
    }

    #[test]
    fn a_family_upstream_no_longer_has_is_dropped_rather_than_passing_vacuously() {
        let wanted = vec![
            FamilyFilter::new("ADD", None),
            FamilyFilter::new("UNARY", None),
            FamilyFilter::new("MUL_MAT", Some("type_a=q4_K,")),
        ];
        let kept = tested_families(wanted, &["ADD".to_string(), "MUL_MAT".to_string()]);
        assert_eq!(
            kept,
            vec![
                FamilyFilter::new("ADD", None),
                FamilyFilter::new("MUL_MAT", Some("type_a=q4_K,")),
            ],
            "the filter must survive the intersection, and UNARY must not"
        );
    }

    #[test]
    fn a_narrowed_family_carries_its_filter_into_its_unit() {
        let mut p = plan(vec![device("CPU")], vec![], false);
        p.families = vec![FamilyFilter::new("MUL_MAT", Some("type_a=q4_K,"))];
        let units = p.units();
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].request.op_filter.as_deref(), Some("MUL_MAT"));
        assert_eq!(units[0].request.params_filter.as_deref(), Some("type_a=q4_K,"));
    }

    #[test]
    fn the_start_event_round_trips_through_json() {
        let p = plan(vec![device("CPU")], vec!["ADD"], true);
        let event = RootEvent::Start {
            schema: SCHEMA_VERSION,
            preset: p.preset,
            engine: p.engine.clone(),
            families: p.families.iter().map(|f| f.family.clone()).collect(),
            model: Some("qwen3.gguf".into()),
            support_probe: true,
            backend_modules: p.backend_modules.clone(),
            units: 2,
            family_timeout_secs: 600,
            deadline_secs: 5400,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""event":"start""#));
        assert_eq!(serde_json::from_str::<RootEvent>(&json).unwrap(), event);
    }

    #[test]
    fn a_case_event_is_flat_so_a_reader_sees_one_object() {
        let json = serde_json::to_string(&RootEvent::Case {
            device: "CPU".into(),
            family: "ADD".into(),
            case: DiagCase {
                backend: "CPU".into(),
                op: "ADD".into(),
                params: "type=f32".into(),
                mode: "test".into(),
                status: DiagStatus::Ok,
                error: None,
                detail: None,
            },
        })
        .unwrap();
        assert!(json.contains(r#""family":"ADD""#), "{json}");
        assert!(json.contains(r#""params":"type=f32""#), "{json}");
        assert!(
            !json.contains(r#""case":{"#),
            "the case must not be nested: {json}"
        );
    }
}
