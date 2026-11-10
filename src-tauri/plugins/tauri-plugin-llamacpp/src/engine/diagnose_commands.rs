//! Tauri surface for the ggml op diagnostic.
//!
//! The root (`engine::diagnose`) is a process this spawns, read line by line
//! and republished as Tauri events. Keeping the orchestration in the worker
//! rather than here is the point: the desktop links this plugin *without* the
//! `engine` feature, so it has no ggml of its own, and a leaf that aborts must
//! not be able to take the app with it.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use super::diagnose::{DiagPreset, RootEvent};
use super::model_plan::{model_families, ModelPlan, ModelShape};
use super::{commands::resolve_worker_exe, preset, worker};

/// Every event of every run arrives on this one channel, tagged with its job.
pub const DIAGNOSTICS_EVENT: &str = "llamacpp-diagnostics";

/// Ceiling on a whole run, over and above the root's own `--deadline`. This is
/// the backstop for a root that stops answering rather than one that overruns.
const HARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(7200);

/// How long a cancelled root gets to notice its stdin closed before it is
/// killed. It only has to finish the leaf it is reading and print `done`.
const CANCEL_GRACE: std::time::Duration = std::time::Duration::from_secs(10);

/// One line of a run, as the frontend receives it. `RootEvent` is flattened so
/// a listener reads one flat object rather than reaching through a wrapper.
#[derive(Debug, Clone, Serialize)]
struct DiagnosticsEvent {
    job: String,
    #[serde(flatten)]
    event: RootEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsJob {
    pub id: String,
}

/// The run in flight, if any. One at a time on purpose: the check saturates
/// every core, so a second concurrent run would only make both unreliable and
/// the timings meaningless.
#[derive(Default)]
pub struct DiagnosticsState {
    current: Mutex<Option<RunningJob>>,
}

struct RunningJob {
    id: String,
    /// Dropping this closes the root's stdin, which is how it is asked to stop.
    stdin: Option<tokio::process::ChildStdin>,
    /// Kills the root if it does not stop on its own.
    kill: tokio::task::AbortHandle,
}

impl DiagnosticsState {
    /// Claims the single slot, or reports who holds it.
    fn claim(&self, job: RunningJob) -> Result<(), String> {
        let mut current = self.current.lock().map_err(|_| poisoned())?;
        if current.is_some() {
            return Err("a hardware check is already running".to_string());
        }
        *current = Some(job);
        Ok(())
    }

    /// Releases the slot if `id` still holds it. A run that finished after
    /// being superseded must not clear a newer one.
    fn release(&self, id: &str) {
        if let Ok(mut current) = self.current.lock() {
            if current.as_ref().is_some_and(|job| job.id == id) {
                *current = None;
            }
        }
    }

    fn stop(&self, id: &str) -> Result<(), String> {
        let mut current = self.current.lock().map_err(|_| poisoned())?;
        match current.as_mut() {
            Some(job) if job.id == id => {
                // Closing stdin is the documented stop; the kill is the
                // backstop for a root wedged somewhere it cannot read it.
                job.stdin.take();
                Ok(())
            }
            _ => Err(format!("no hardware check with id {id} is running")),
        }
    }

    fn kill_handle(&self, id: &str) -> Option<tokio::task::AbortHandle> {
        let current = self.current.lock().ok()?;
        let job = current.as_ref()?;
        (job.id == id).then(|| job.kill.clone())
    }
}

fn poisoned() -> String {
    "the hardware check state is unusable".to_string()
}

/// Distinguishes this run's events from a previous run's that are still in
/// flight. Not a secret and never persisted, so OS randomness is overkill but
/// `rand` is already a dependency.
fn new_job_id() -> String {
    use rand::Rng;
    let bytes: [u8; 8] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The gguf a model id is loaded from, out of the running engine's preset.
///
/// The preset is the only place that mapping exists outside the extension, and
/// the model check is offered after a failed *load*, so the engine is up by
/// definition on the path that matters. A stopped engine reports rather than
/// guessing at a path.
async fn model_gguf_path<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    model_id: &str,
) -> Result<String, String> {
    let preset_path = {
        let state = app_handle.state::<Arc<crate::state::LlamacppState>>();
        let guard = state.engine.lock().await;
        guard
            .as_ref()
            .map(|h| h.preset_path.clone())
            .ok_or_else(|| "the llama.cpp engine is not running".to_string())?
    };
    let ini = tokio::fs::read_to_string(&preset_path)
        .await
        .map_err(|e| format!("could not read {}: {e}", preset_path.display()))?;
    preset::value(&ini, model_id, "model")
        .ok_or_else(|| format!("no model named {model_id} is configured"))
}

/// Reads a gguf and turns it into the family list its graph needs.
async fn plan_for_model(path: &str) -> Result<ModelPlan, String> {
    let metadata = crate::gguf::utils::read_gguf_metadata_internal(path.to_string()).await?;
    let tensor_types =
        crate::gguf::utils::read_gguf_tensor_types_internal(path.to_string()).await?;
    let shape = ModelShape::from_gguf(&metadata.metadata, &tensor_types);
    Ok(ModelPlan {
        model: crate::diagnostics::file_name(path),
        families: model_families(&shape),
    })
}

/// Starts a run and returns its id. Events arrive on [`DIAGNOSTICS_EVENT`]
/// until one carries `event: "done"`, which is emitted on every path including
/// a root that could not start.
///
/// `model` is required by the `model` preset and ignored by the others: it is
/// a model id, resolved to its gguf here so the worker still reads no model.
#[tauri::command]
pub async fn start_diagnostics<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    preset: String,
    devices: Vec<String>,
    envs: std::collections::HashMap<String, String>,
    model: Option<String>,
) -> Result<DiagnosticsJob, String> {
    let preset = match preset.as_str() {
        "quick" => DiagPreset::Quick,
        "full" => DiagPreset::Full,
        "model" => DiagPreset::Model,
        other => return Err(format!("unknown preset: {other}")),
    };
    let model_plan = match preset {
        DiagPreset::Model => {
            let model_id = model
                .as_deref()
                .filter(|m| !m.is_empty())
                .ok_or_else(|| "the model check needs a model".to_string())?;
            let path = model_gguf_path(&app_handle, model_id).await?;
            Some(plan_for_model(&path).await?)
        }
        _ => None,
    };
    let state = app_handle.state::<Arc<DiagnosticsState>>().inner().clone();
    let exe = resolve_worker_exe(&app_handle)?;

    let mut cmd = tokio::process::Command::new(&exe);
    // Same pinned cwd as a serving worker: the leaves load their backend
    // modules by scanning the directory they were started from.
    if let Some(dir) = worker::worker_cwd(&exe) {
        cmd.current_dir(dir);
    }
    cmd.arg("--diagnose")
        .arg("--diagnose-preset")
        .arg(match preset {
            DiagPreset::Quick => "quick",
            DiagPreset::Full => "full",
            DiagPreset::Model => "model",
        });
    if let Some(plan) = &model_plan {
        let json = serde_json::to_string(plan)
            .map_err(|e| format!("could not encode the model plan: {e}"))?;
        cmd.arg("--diagnose-plan").arg(json);
    }
    for device in &devices {
        cmd.arg("--device").arg(device);
    }
    cmd.envs(envs)
        // Held open for the whole run: closing it is the cancel signal, so it
        // must not be inherited or dropped early.
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    jan_utils::system::setup_windows_process_flags(&mut cmd);
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", exe.display()))?;

    let id = new_job_id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let pump = tokio::spawn(run_to_completion(
        app_handle.clone(),
        Arc::clone(&state),
        id.clone(),
        child,
        stdout,
        stderr,
    ));

    state.claim(RunningJob {
        id: id.clone(),
        stdin,
        kill: pump.abort_handle(),
    })?;

    Ok(DiagnosticsJob { id })
}

/// Asks a run to stop. Returns once the request is made, not once it lands:
/// the terminal `done` event is what says the run is over.
#[tauri::command]
pub async fn cancel_diagnostics(
    state: State<'_, Arc<DiagnosticsState>>,
    job: String,
) -> Result<(), String> {
    state.stop(&job)?;
    let state = state.inner().clone();
    tokio::spawn(async move {
        tokio::time::sleep(CANCEL_GRACE).await;
        if let Some(kill) = state.kill_handle(&job) {
            log::warn!("hardware check {job} ignored its stop request; killing it");
            kill.abort();
            state.release(&job);
        }
    });
    Ok(())
}

/// Reads the root to the end, republishing each line. Always emits a terminal
/// `done`, so a listener never waits forever on a root that died silently.
async fn run_to_completion<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: Arc<DiagnosticsState>,
    id: String,
    mut child: tokio::process::Child,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
) {
    // The root's own stderr is for the log, not the UI: every user-facing
    // failure reaches the stream as an event.
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::debug!("llamacpp diagnose: {line}");
            }
        });
    }

    let emit = |event: RootEvent| {
        let payload = DiagnosticsEvent {
            job: id.clone(),
            event,
        };
        if let Err(e) = app_handle.emit(DIAGNOSTICS_EVENT, payload) {
            log::warn!("emit {DIAGNOSTICS_EVENT} failed: {e}");
        }
    };

    let mut saw_done = false;
    let read = async {
        let Some(stdout) = stdout else { return };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<RootEvent>(&line) {
                Ok(event) => {
                    saw_done |= matches!(event, RootEvent::Done { .. });
                    emit(event);
                }
                // A line the desktop cannot parse is a version skew between
                // the app and the worker beside it, which is worth a log but
                // is not something to show or to stop the run for.
                Err(e) => log::warn!("unreadable diagnose event ({e}): {line}"),
            }
        }
    };

    let outcome = tokio::time::timeout(HARD_TIMEOUT, async {
        read.await;
        child.wait().await
    })
    .await;

    let timed_out = outcome.is_err();
    if !saw_done {
        emit(RootEvent::Done {
            ok: false,
            cancelled: false,
            inconclusive: false,
            error: Some(match outcome {
                Err(_) => format!(
                    "the hardware check stopped answering after {} minutes",
                    HARD_TIMEOUT.as_secs() / 60
                ),
                Ok(Ok(status)) => format!(
                    "the hardware check ended early: {}",
                    worker::describe_exit(&status)
                ),
                Ok(Err(e)) => format!("the hardware check could not be watched: {e}"),
            }),
        });
    }
    if timed_out {
        let _ = child.kill().await;
    }
    state.release(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str) -> RunningJob {
        RunningJob {
            id: id.to_string(),
            stdin: None,
            kill: tokio::spawn(std::future::pending::<()>()).abort_handle(),
        }
    }

    #[tokio::test]
    async fn a_second_run_is_refused_while_one_is_in_flight() {
        let state = DiagnosticsState::default();
        state.claim(job("a")).unwrap();
        let err = state.claim(job("b")).unwrap_err();
        assert!(err.contains("already running"), "{err}");
    }

    #[tokio::test]
    async fn the_slot_reopens_once_the_run_releases_it() {
        let state = DiagnosticsState::default();
        state.claim(job("a")).unwrap();
        state.release("a");
        state.claim(job("b")).expect("the slot should be free again");
    }

    #[tokio::test]
    async fn a_finished_run_cannot_release_the_one_that_replaced_it() {
        let state = DiagnosticsState::default();
        state.claim(job("a")).unwrap();
        state.release("a");
        state.claim(job("b")).unwrap();
        // "a" finishing late must not clear "b".
        state.release("a");
        assert!(state.claim(job("c")).is_err(), "b still holds the slot");
    }

    #[tokio::test]
    async fn only_the_running_job_can_be_stopped() {
        let state = DiagnosticsState::default();
        state.claim(job("a")).unwrap();
        let err = state.stop("b").unwrap_err();
        assert!(err.contains("no hardware check"), "{err}");
        state.stop("a").expect("the running job stops");
    }

    #[test]
    fn a_job_id_is_unique_per_run() {
        assert_ne!(new_job_id(), new_job_id());
        assert_eq!(new_job_id().len(), 16);
    }
}
