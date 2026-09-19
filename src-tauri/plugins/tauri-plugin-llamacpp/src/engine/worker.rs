//! Supervises the `jan-llama-worker` process.
//!
//! This is the crash boundary. The worker links llama.cpp statically, but in
//! its own process, because `GGML_ASSERT` calls `abort()` unconditionally and
//! no amount of `catch_unwind` contains that -- a VRAM OOM or a Vulkan device
//! loss must cost the model, not the app.
//!
//! Deliberately free of the `engine` feature: supervision is just process
//! management, so a build that did not compile llama.cpp can still drive a
//! worker shipped alongside it as a sidecar.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// The worker prints this and nothing else on stdout, then serves. Reading a
/// structured line beats the router path's stderr scraping: there is no
/// version-dependent log phrasing to match, and no race against a log file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Handshake {
    pub port: u16,
    pub pid: u32,
    pub models: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkerError {
    Spawn(String),
    /// The worker exited or said nothing intelligible before serving.
    Handshake(String),
    Timeout(Duration),
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(m) => write!(f, "could not start jan-llama-worker: {m}"),
            Self::Handshake(m) => write!(f, "jan-llama-worker did not come up: {m}"),
            Self::Timeout(d) => {
                write!(f, "jan-llama-worker did not report a port within {d:?}")
            }
        }
    }
}

/// A runtime failure worth telling the user about, classified from one worker
/// log line. `GGML_ASSERT` calls `abort()`, so for these the line on stderr is
/// often the only evidence left of what happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeFault {
    /// Ran out of device or host memory mid-request.
    Oom,
    /// A backend crash: a CUDA/Vulkan/Metal error, a failed assert, device
    /// loss, or a heap-corruption abort.
    Backend,
}

impl RuntimeFault {
    /// The event name the frontend listens on. Still `router` because that is
    /// what `LlamacppOomListener` subscribes to; renaming it would be a
    /// two-sided change for no gain.
    pub const fn event_name(self) -> &'static str {
        match self {
            Self::Oom => "llamacpp-router-oom",
            Self::Backend => "llamacpp-router-backend-error",
        }
    }
}

/// Classifies a log line. The caller lowercases once and passes that in.
pub fn classify_fault(line_lower: &str) -> Option<RuntimeFault> {
    if is_oom_line(line_lower) {
        return Some(RuntimeFault::Oom);
    }
    if is_backend_error_line(line_lower) {
        return Some(RuntimeFault::Backend);
    }
    None
}

fn is_oom_line(line_lower: &str) -> bool {
    if line_lower.contains("erroroutofdevicememory") || line_lower.contains("erroroutofhostmemory")
    {
        return true;
    }
    line_lower.contains("failed to allocate") && line_lower.contains("buffer of size")
}

fn is_backend_error_line(line_lower: &str) -> bool {
    if line_lower.contains("cuda error:") || line_lower.contains("ggml_assert(") {
        return true;
    }
    if (line_lower.contains("ggml_vulkan") || line_lower.contains("ggml_metal"))
        && line_lower.contains("error")
    {
        return true;
    }
    // GPU device loss (vk::DeviceLostError / ErrorDeviceLost, CUDA device-lost)
    // and any uncaught C++ exception abort mid-request -- surface them so a
    // crash during prompt processing still reaches the UI.
    if line_lower.contains("devicelost")
        || line_lower.contains("device lost")
        || line_lower.contains("terminate called after throwing")
    {
        return true;
    }
    // glibc heap-corruption / stack-protector aborts (SIGABRT). A native memory
    // bug in the backend (e.g. the mtmd video decode path) prints one of these
    // just before the process dies -- unclassified, the crash is silent and the
    // load appears to hang forever.
    [
        "corrupted size vs. prev_size",
        "corrupted double-linked list",
        "double free or corruption",
        "malloc(): ",
        "free(): ",
        "munmap_chunk(): invalid pointer",
        "stack smashing detected",
        "buffer overflow detected",
    ]
    .iter()
    .any(|m| line_lower.contains(m))
}

/// Called once per classified line, with the line itself. Boxed rather than
/// generic so `WorkerHandle` does not have to carry a type parameter.
pub type FaultCallback = std::sync::Arc<dyn Fn(RuntimeFault, String) + Send + Sync + 'static>;

/// Minimum gap between reports. One fault produces a burst of lines (a CUDA
/// error, then the assert, then the abort message), and the user needs the
/// first one, not all of them.
const FAULT_DEBOUNCE: Duration = Duration::from_secs(3);

/// Env var the worker reads its bearer token from. Never an argv flag: argv is
/// world-readable via `ps` / `/proc/<pid>/cmdline`, and the supervisor logs it.
pub const API_KEY_ENV: &str = "JAN_LLAMA_API_KEY";

/// How long to wait for the worker to unwind after it accepts `/shutdown`.
/// Generous because unwinding runs `jan_llama_engine_stop` per resident model,
/// which terminates each `server_queue` loop and frees the model.
const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);



/// How long to wait for the handshake. Generous because a cold page-cache read
/// of the preset plus binding a port can be slow on a loaded machine, but far
/// short of a model load -- the worker answers before loading anything.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// Pure so the flag set is testable without spawning anything. Port 0 asks the
/// OS to choose, which the handshake then reports back -- unlike the router
/// path's `49152 + random` guess, this cannot collide.
pub fn worker_args(
    preset_path: &Path,
    port: u16,
    models_max: u32,
    slot_cache_mib: u64,
) -> Vec<String> {
    vec![
        "--preset".to_string(),
        preset_path.to_string_lossy().to_string(),
        "--port".to_string(),
        port.to_string(),
        "--models-max".to_string(),
        models_max.to_string(),
        "--slot-cache-mib".to_string(),
        slot_cache_mib.to_string(),
    ]
}

pub fn parse_handshake(line: &str) -> Result<Handshake, WorkerError> {
    let v: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| WorkerError::Handshake(format!("unparseable line {line:?}: {e}")))?;
    let port = v
        .get("port")
        .and_then(serde_json::Value::as_u64)
        .filter(|p| *p > 0 && *p <= u16::MAX as u64)
        .ok_or_else(|| WorkerError::Handshake(format!("no usable port in {line:?}")))?
        as u16;
    let pid = v
        .get("pid")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default() as u32;
    let models = v
        .get("models")
        .and_then(serde_json::Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|m| m.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(Handshake { port, pid, models })
}

impl std::fmt::Debug for WorkerHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // No api_key: this ends up in logs and error messages.
        f.debug_struct("WorkerHandle")
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("models", &self.models)
            .finish()
    }
}

/// Ties the worker's lifetime to ours on Windows, which has no process group.
///
/// `kill_on_drop` is a tokio destructor, and `TerminateProcess` runs no
/// destructors, so a force-quit Jan -- Task Manager, or the NSIS installer's own
/// kill of the running app -- leaves the worker alive. It exits eventually,
/// because losing our end of its stdin pipe is its stop signal, but only after
/// draining requests, saving slots and freeing every model, and until then it
/// holds VRAM and keeps `ggml*.dll` mapped -- which is precisely what makes the
/// next install fail to overwrite them.
///
/// A job object whose last handle dies with this process is the one reaping the
/// OS will do on our behalf. Unix gets this from `process_group(0)`.
#[cfg(windows)]
mod reap {
    use std::os::windows::io::RawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Closing this kills every process still in the job.
    pub struct Job(HANDLE);

    // The handle is opaque to everything but `Drop`, which owns it exclusively.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Best effort: a Jan already confined to a job that forbids nesting should
    /// lose the reaping guarantee, not the engine.
    pub fn confine(child: RawHandle) -> Option<Job> {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            log::warn!("could not create a job object for the worker");
            return None;
        }
        let job = Job(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if set == 0 {
            log::warn!("could not set kill-on-close on the worker's job object");
            return None;
        }
        if unsafe { AssignProcessToJobObject(job.0, child as HANDLE) } == 0 {
            log::warn!("could not put the worker in its job object");
            return None;
        }
        Some(job)
    }
}

pub struct WorkerHandle {
    pub port: u16,
    pub pid: u32,
    pub api_key: String,
    pub models: Vec<String>,
    child: Child,
    /// Declared after `child` so it is dropped after it: the graceful stop must
    /// get its turn before closing the job would kill the worker outright.
    #[cfg(windows)]
    _job: Option<reap::Job>,
}

impl WorkerHandle {
    /// SIGTERM, then SIGKILL after a grace period, reusing the same helper the
    /// router path uses so there is one kill policy in the crate.
    /// Stops the worker, gracefully on every platform.
    ///
    /// Closes the worker's stdin first; the worker treats EOF there as "stop".
    /// That works identically on Linux, macOS and Windows, which is the whole
    /// reason the worker is our own binary rather than a downloaded
    /// `llama-server`: the router could only be signalled, and Windows has no
    /// deliverable SIGTERM equivalent (`GenerateConsoleCtrlEvent(CTRL_C_EVENT)`
    /// needs process group 0, which would kill Jan too), so it had to be
    /// force-killed there. A force kill skips `jan_llama_engine_stop`, leaving
    /// `server_queue` loops unterminated and the model unfreed.
    ///
    /// Signals remain the fallback for a worker too wedged to answer.
    pub async fn stop(mut self) {
        if self.request_shutdown() {
            match tokio::time::timeout(SHUTDOWN_TIMEOUT, self.child.wait()).await {
                Ok(Ok(status)) => {
                    log::info!("jan-llama-worker exited gracefully: {status}");
                    return;
                }
                Ok(Err(e)) => log::warn!("waiting on the worker failed: {e}"),
                Err(_) => log::warn!(
                    "jan-llama-worker did not exit within {}s of /shutdown; falling back",
                    SHUTDOWN_TIMEOUT.as_secs()
                ),
            }
        }

        #[cfg(unix)]
        crate::process::graceful_terminate_process(&mut self.child).await;
        #[cfg(all(windows, target_arch = "x86_64"))]
        crate::process::force_terminate_process(&mut self.child).await;
        #[cfg(not(any(unix, all(windows, target_arch = "x86_64"))))]
        {
            let _ = self.child.kill().await;
        }
    }

    /// Kills the worker immediately, skipping the graceful path.
    ///
    /// The engine's own teardown does not run, so this is only for a user who
    /// has asked to abandon work in flight.
    pub async fn kill(mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }

    /// Closes the worker's stdin, which is its shutdown signal.
    ///
    /// Returns false only if there was no pipe to close, in which case the
    /// caller goes straight to the signal fallback.
    fn request_shutdown(&mut self) -> bool {
        self.take_stdin().is_some()
    }

    /// The write end of the worker's stdin. Dropping it signals shutdown;
    /// exposed so a test can exercise that path without the signal fallback.
    pub fn take_stdin(&mut self) -> Option<tokio::process::ChildStdin> {
        self.child.stdin.take()
    }

    /// None while still running, otherwise the exit status.
    pub fn exited(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().ok().flatten()
    }
}

/// Spawns the worker and waits for its handshake line.
#[allow(clippy::too_many_arguments)]
pub async fn spawn(
    exe: &Path,
    preset_path: &Path,
    port: u16,
    api_key: &str,
    models_max: u32,
    slot_cache_mib: u64,
    envs: HashMap<String, String>,
    on_fault: Option<FaultCallback>,
) -> Result<WorkerHandle, WorkerError> {
    let args = worker_args(preset_path, port, models_max, slot_cache_mib);
    log::info!("starting {} {}", exe.display(), args.join(" "));

    let mut cmd = Command::new(exe);
    // Without this the worker flashes a console window on Windows, the way
    // every other spawn in this plugin already avoids.
    jan_utils::system::setup_windows_process_flags(&mut cmd);
    // ggml's backend scan puts `fs::current_path()` in its search paths and
    // calls dl_load_library on every `ggml-*` filename match *before* reading
    // its score, so a planted module in an inherited cwd runs its DllMain /
    // constructor even if it is never selected -- and `best_score` is one
    // accumulator across all search paths, so a higher-scoring plant wins
    // outright rather than losing to path order. Pinning the cwd to the
    // worker's own directory, which is where the bundled modules already live,
    // removes the attacker-writable entry from that list.
    //
    // Absolute only: `current_dir` also changes how the OS resolves a *relative*
    // program path, so doing this unconditionally would make a dev's
    // `--bin build/jan-llama-worker` be looked up inside `build/`. Every shipped
    // path is absolute (`resource_dir()`, or `sidecar_path` off
    // `current_exe`), so the hardening lands exactly where it matters.
    if exe.is_absolute() {
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir);
        }
    }
    cmd.args(&args)
        .envs(envs)
        .env(API_KEY_ENV, api_key)
        // Piped, not null: dropping our end closes the pipe, which is the
        // shutdown signal the worker waits on. `Stdio::null()` would be an
        // immediate EOF and the worker would exit at once.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| WorkerError::Spawn(e.to_string()))?;
    // Before the handshake, so every error path below drops the job too and
    // cannot leak a worker that never reported for duty.
    #[cfg(windows)]
    let job = child.raw_handle().and_then(reap::confine);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| WorkerError::Spawn("no stdout pipe".into()))?;
    // Drained on its own task: a full stderr pipe would otherwise block the
    // worker mid-generation, which is a hang with no error message.
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            let mut last_fault_at: Option<tokio::time::Instant> = None;
            while let Ok(Some(line)) = lines.next_line().await {
                log::debug!("jan-llama-worker: {line}");
                let Some(cb) = on_fault.as_ref() else { continue };
                let Some(fault) = classify_fault(&line.to_lowercase()) else {
                    continue;
                };
                let now = tokio::time::Instant::now();
                if last_fault_at.is_some_and(|t| now.duration_since(t) <= FAULT_DEBOUNCE) {
                    continue;
                }
                last_fault_at = Some(now);
                cb(fault, line);
            }
        });
    }

    let mut lines = BufReader::new(stdout).lines();
    let first = tokio::time::timeout(HANDSHAKE_TIMEOUT, lines.next_line()).await;

    let line = match first {
        Err(_) => {
            let _ = child.start_kill();
            return Err(WorkerError::Timeout(HANDSHAKE_TIMEOUT));
        }
        Ok(Err(e)) => {
            let _ = child.start_kill();
            return Err(WorkerError::Handshake(e.to_string()));
        }
        Ok(Ok(None)) => {
            // Closed stdout without a line: it died. The exit status is the
            // most useful thing we can report.
            let status = child.wait().await.ok();
            return Err(WorkerError::Handshake(format!(
                "exited before serving (status {status:?})"
            )));
        }
        Ok(Ok(Some(line))) => line,
    };

    let hs = match parse_handshake(&line) {
        Ok(hs) => hs,
        Err(e) => {
            let _ = child.start_kill();
            return Err(e);
        }
    };

    // Keep draining stdout so the worker never blocks on a full pipe.
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("jan-llama-worker: {line}");
        }
    });

    Ok(WorkerHandle {
        port: hs.port,
        pid: hs.pid,
        api_key: api_key.to_string(),
        models: hs.models,
        child,
        #[cfg(windows)]
        _job: job,
    })
}

/// Where the worker lives next to the running executable, which is how Tauri
/// lays out a bundled sidecar.
pub fn worker_file_name() -> &'static str {
    if cfg!(windows) {
        "jan-llama-worker.exe"
    } else {
        "jan-llama-worker"
    }
}

/// The worker beside the app executable.
///
/// This is the dev layout (`target/<profile>/`). A bundled app puts it under the
/// resource directory instead, which only the Tauri side can resolve, so
/// `commands::resolve_worker_exe` checks that first and falls back here.
pub fn sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let candidate = exe.parent()?.join(worker_file_name());
    candidate.is_file().then_some(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Restored with the marker lists intact: each entry came from a real crash
    // report, and a fault the classifier misses is a silent hang for the user.
    #[test]
    fn classifies_backend_crash_lines() {
        // Inputs arrive already lowercased from the caller.
        for line in [
            "what():  vk::device::waitforfences: errordevicelost",
            "terminate called after throwing an instance of 'vk::devicelosterror'",
            "cuda error: out of memory",
            "ggml_assert(cond) failed",
            "corrupted size vs. prev_size",
            "malloc(): corrupted top size",
            "stack smashing detected",
        ] {
            assert_eq!(
                classify_fault(line),
                Some(RuntimeFault::Backend),
                "{line:?}"
            );
        }
    }

    #[test]
    fn classifies_allocation_failures_as_oom() {
        for line in [
            "erroroutofdevicememory",
            "erroroutofhostmemory",
            "alloc_tensor_range: failed to allocate cuda0 buffer of size 2491323904",
        ] {
            assert_eq!(classify_fault(line), Some(RuntimeFault::Oom), "{line:?}");
        }
    }

    // OOM is checked first: "cuda error: out of memory" is both, and the OOM
    // dialog is the one with advice the user can act on.
    #[test]
    fn ordinary_log_lines_are_not_faults() {
        for line in [
            "srv log_server_r: request: post /v1/chat/completions",
            "load: control-looking token: 128247 was not control-type",
            "main: server is listening on http://127.0.0.1:39271",
            "",
        ] {
            assert_eq!(classify_fault(line), None, "{line:?}");
        }
    }

    // A partial phrase must not fire: "failed to allocate" alone shows up in
    // benign fit-params chatter.
    #[test]
    fn a_partial_allocation_phrase_is_not_an_oom() {
        assert_eq!(
            classify_fault("common_fit_params: failed to allocate a plan"),
            None
        );
    }

    #[test]
    fn each_fault_maps_to_the_event_the_frontend_listens_on() {
        assert_eq!(RuntimeFault::Oom.event_name(), "llamacpp-router-oom");
        assert_eq!(
            RuntimeFault::Backend.event_name(),
            "llamacpp-router-backend-error"
        );
    }

    #[test]
    fn worker_args_are_the_documented_flags() {
        let args = worker_args(Path::new("/tmp/router.preset.ini"), 0, 4, 8192);
        assert_eq!(
            args,
            vec![
                "--preset",
                "/tmp/router.preset.ini",
                "--port",
                "0",
                "--models-max",
                "4",
                "--slot-cache-mib",
                "8192"
            ]
        );
    }

    #[test]
    fn the_api_key_never_appears_in_argv() {
        // The router path documents this invariant; keep it here too.
        let args = worker_args(Path::new("/p.ini"), 1234, 1, 0);
        assert!(
            !args.iter().any(|a| a.contains("api") || a.contains("key")),
            "argv is world-readable via /proc; the token must go through {API_KEY_ENV}"
        );
    }

    #[test]
    fn models_max_zero_is_forwarded_verbatim_as_unlimited() {
        let args = worker_args(Path::new("/p.ini"), 1, 0, 0);
        assert_eq!(args[5], "0");
    }

    // 0 is the off switch, and it has to survive as 0 rather than being
    // dropped: an absent flag would fall back to the worker's own default.
    #[test]
    fn the_slot_cache_budget_is_forwarded_including_zero() {
        let off = worker_args(Path::new("/p.ini"), 1, 1, 0);
        assert_eq!(off[7], "0");
        let on = worker_args(Path::new("/p.ini"), 1, 1, 4096);
        assert_eq!(on[7], "4096");
    }

    #[test]
    fn parse_handshake_reads_the_worker_line() {
        let hs = parse_handshake(r#"{"port":39271,"pid":1234,"models":["a","b"]}"#).unwrap();
        assert_eq!(
            hs,
            Handshake {
                port: 39271,
                pid: 1234,
                models: vec!["a".into(), "b".into()],
            }
        );
    }

    #[test]
    fn parse_handshake_tolerates_trailing_newline_and_missing_optionals() {
        let hs = parse_handshake("{\"port\":8080}\n").unwrap();
        assert_eq!(hs.port, 8080);
        assert_eq!(hs.pid, 0);
        assert!(hs.models.is_empty());
    }

    #[test]
    fn parse_handshake_rejects_a_missing_or_impossible_port() {
        // Port 0 would mean "the OS did not assign one", which is never a
        // usable upstream -- accepting it would produce a session that every
        // later request silently fails against.
        for bad in [
            r#"{"pid":1}"#,
            r#"{"port":0}"#,
            r#"{"port":70000}"#,
            r#"{"port":"8080"}"#,
            "not json",
            "",
        ] {
            assert!(
                parse_handshake(bad).is_err(),
                "should have rejected {bad:?}"
            );
        }
    }

    #[tokio::test]
    async fn spawning_a_missing_binary_is_a_spawn_error_not_a_hang() {
        let err = spawn(
            Path::new("/definitely/not/a/binary"),
            Path::new("/tmp/x.ini"),
            0,
            "k",
            1,
            0,
            HashMap::new(),
            None,
        )
        .await
        .expect_err("a missing exe must fail");
        assert!(matches!(err, WorkerError::Spawn(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn a_process_that_says_nothing_is_reported_not_awaited_forever() {
        // `true` exits immediately with no output, standing in for a worker
        // that dies during startup.
        let exe = ["/bin/true", "/usr/bin/true"]
            .iter()
            .map(Path::new)
            .find(|p| p.is_file());
        let Some(exe) = exe else { return };
        let err = spawn(exe, Path::new("/tmp/x.ini"), 0, "k", 1, 0, HashMap::new(), None)
            .await
            .expect_err("a silent exit must fail");
        assert!(matches!(err, WorkerError::Handshake(_)), "got {err:?}");
    }
}
