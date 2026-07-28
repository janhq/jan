//! Router-mode lifecycle for `llama-server`.
//!
//! Phase 1 of the router refactor: spawn / health-check / shut down a single
//! `llama-server` instance running in router mode (no `-m` / `-hf` flag, models
//! are loaded on demand via the HTTP API). This module is intentionally
//! standalone — it does NOT touch the existing per-model session map.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use sysinfo::{Pid, ProcessesToUpdate, System};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::time::Instant;

pub type ErrorCallback = Arc<dyn Fn(&'static str, String) + Send + Sync + 'static>;

/// Matches the various phrasings llama-server has used for its
/// ready-to-serve log line across versions. `line_lower` must already be
/// lowercased by the caller. Router mode logs `"llama_server: listening on
/// http://<host>:<port>"` - note the colon between "server" and "listening"
/// (`"server: listening on"`), which does NOT match the older
/// `"server listening on"` (no colon) wording still used elsewhere, so both
/// must be checked explicitly rather than relying on one subsuming the
/// other.
fn is_ready_line(line_lower: &str) -> bool {
    line_lower.contains("http server listening")
        || line_lower.contains("server is listening on")
        || line_lower.contains("server listening on")
        || line_lower.contains("server: listening on")
        || line_lower.contains("starting the main loop")
}

fn is_oom_line(line_lower: &str) -> bool {
    if line_lower.contains("erroroutofdevicememory")
        || line_lower.contains("erroroutofhostmemory")
    {
        return true;
    }
    line_lower.contains("failed to allocate") && line_lower.contains("buffer of size")
}

fn is_backend_error_line(line_lower: &str) -> bool {
    if line_lower.contains("cuda error:") {
        return true;
    }
    if line_lower.contains("ggml_assert(") {
        return true;
    }
    if line_lower.contains("ggml_vulkan") && line_lower.contains("error") {
        return true;
    }
    if line_lower.contains("ggml_metal") && line_lower.contains("error") {
        return true;
    }
    // GPU device loss (vk::DeviceLostError / ErrorDeviceLost, CUDA device-lost)
    // and any uncaught C++ exception abort the child mid-request — surface them
    // so a crash during prompt processing still reaches the UI.
    if line_lower.contains("devicelost") || line_lower.contains("device lost") {
        return true;
    }
    if line_lower.contains("terminate called after throwing") {
        return true;
    }
    // glibc heap-corruption / stack-protector aborts (SIGABRT). A native memory
    // bug in the backend (e.g. the mtmd video decode path) prints one of these
    // to stderr just before the process dies — without classifying them the
    // crash is silent and the model load appears to hang/loop forever.
    if line_lower.contains("corrupted size vs. prev_size")
        || line_lower.contains("corrupted double-linked list")
        || line_lower.contains("double free or corruption")
        || line_lower.contains("malloc(): ")
        || line_lower.contains("free(): ")
        || line_lower.contains("munmap_chunk(): invalid pointer")
        || line_lower.contains("stack smashing detected")
        || line_lower.contains("buffer overflow detected")
    {
        return true;
    }
    false
}

use crate::error::{ErrorCode, LlamacppError, ServerError, ServerResult};
use jan_utils::{
    binary_requires_cuda, binary_requires_rocm, find_cuda_paths, find_rocm_paths,
    setup_library_path, setup_windows_process_flags,
};

/// A handle to a running router-mode `llama-server` process.
///
/// `child` is `None` for a router adopted after a UI crash: we inherit the
/// process but not its pipes, so readiness parsing, the OOM/backend-error
/// callback, and log streaming are unavailable until the next restart.
/// Termination falls back to the PID-based path.
pub struct RouterHandle {
    pub child: Option<Child>,
    pub port: u16,
    pub api_key: String,
    pub pid: u32,
    /// Kept so the stop paths can clear the lock file that sits beside it.
    pub preset_path: PathBuf,
}

/// On-disk record of a spawned router, written next to the preset so a
/// relaunched UI can find a process its in-memory state knows nothing about.
///
/// `start_time` is the pid-reuse guard: a recycled PID belongs to a process
/// that started later, so a mismatch means our router is gone. `backend_exe`
/// and `preset_hash` decide adoptability -- a router running a different
/// binary or a stale preset is killed rather than adopted.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct RouterLock {
    pub pid: u32,
    pub port: u16,
    pub start_time: u64,
    pub backend_exe: String,
    pub preset_hash: String,
    /// An argv flag rather than a preset entry, so the preset hash cannot
    /// catch a change to it.
    pub models_max: u32,
}

pub const ROUTER_LOCK_FILENAME: &str = "router.lock.json";
/// Lives in the app's managed `logs/` folder beside `app.log`, not next to the
/// preset: it is a diagnostic a user or bug report will go looking for. It must
/// stay a file of its own -- llama.cpp opens it with mode "w", so sharing
/// `app.log` would truncate Jan's own log on every spawn.
pub const ROUTER_LOG_FILENAME: &str = "llamacpp-router.log";

/// Cap for a retained log generation. Disk use across spawns is bounded by
/// roughly twice this: one live file plus one retained.
const MAX_RETAINED_LOG_BYTES: u64 = 16 * 1024 * 1024;

/// llama.cpp opens its log file with mode "w", so a relaunch after a crash
/// would truncate the very log that explains the crash. Move the previous run
/// aside before the child can touch it.
///
/// Only the tail of an oversized log is kept: a crash signature is written
/// just before the process dies, so the end is the part worth retaining, and
/// keeping it bounded is what stops a long-lived router from filling the disk.
///
/// Note this is the only point at which size can be enforced. The live log
/// belongs to a process holding it open -- renaming it out from under llama.cpp
/// keeps writes flowing to the same inode on POSIX and fails outright on
/// Windows -- so a single very long run is bounded only by llama.cpp's own
/// verbosity until the router next restarts.
fn rotate_log(log_path: &Path) {
    let Ok(meta) = std::fs::metadata(log_path) else {
        return; // nothing from a previous run
    };

    let previous = log_path.with_extension("log.1");
    if meta.len() <= MAX_RETAINED_LOG_BYTES {
        if let Err(e) = std::fs::rename(log_path, &previous) {
            log::warn!("Could not rotate router log {:?}: {}", log_path, e);
        }
        return;
    }

    match keep_log_tail(log_path, &previous, MAX_RETAINED_LOG_BYTES) {
        Ok(()) => {
            log::info!(
                "Router log was {} bytes; retained the last {} in {:?}",
                meta.len(),
                MAX_RETAINED_LOG_BYTES,
                previous
            );
            let _ = std::fs::remove_file(log_path);
        }
        Err(e) => {
            // Retaining nothing beats leaving an unbounded file behind.
            log::warn!("Could not truncate oversized router log: {}; discarding", e);
            let _ = std::fs::remove_file(log_path);
        }
    }
}

fn keep_log_tail(src: &Path, dst: &Path, bytes: u64) -> std::io::Result<()> {
    use std::io::{Read, Seek, SeekFrom, Write};

    let mut input = std::fs::File::open(src)?;
    let len = input.metadata()?.len();
    input.seek(SeekFrom::Start(len.saturating_sub(bytes)))?;

    let mut output = std::fs::File::create(dst)?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        output.write_all(&buf[..n])?;
    }
    output.flush()
}

fn lock_path_for(preset_path: &Path) -> PathBuf {
    preset_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(ROUTER_LOCK_FILENAME)
}

pub fn hash_preset(preset_path: &Path) -> String {
    match std::fs::read(preset_path) {
        Ok(bytes) => {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        }
        Err(e) => {
            log::warn!("hash_preset: cannot read {:?}: {}", preset_path, e);
            String::new()
        }
    }
}

fn process_start_time(pid: u32) -> Option<u64> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    sys.process(Pid::from_u32(pid)).map(|p| p.start_time())
}

fn write_lock(preset_path: &Path, lock: &RouterLock) {
    let path = lock_path_for(preset_path);
    match serde_json::to_vec_pretty(lock) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, bytes) {
                log::warn!("Failed to write router lock {:?}: {}", path, e);
            }
        }
        Err(e) => log::warn!("Failed to serialize router lock: {}", e),
    }
}

pub fn remove_lock(preset_path: &Path) {
    let path = lock_path_for(preset_path);
    if let Err(e) = std::fs::remove_file(&path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!("Failed to remove router lock {:?}: {}", path, e);
        }
    }
}

pub fn read_lock(preset_path: &Path) -> Option<RouterLock> {
    let path = lock_path_for(preset_path);
    let bytes = std::fs::read(&path).ok()?;
    match serde_json::from_slice::<RouterLock>(&bytes) {
        Ok(l) => Some(l),
        Err(e) => {
            log::warn!("Discarding unreadable router lock {:?}: {}", path, e);
            let _ = std::fs::remove_file(&path);
            None
        }
    }
}

/// Outcome of inspecting a router that outlived its UI.
pub enum AdoptOutcome {
    /// Same binary, same preset, answering `/health` -- reuse it.
    Adopted(Box<RouterHandle>),
    /// Nothing usable was running (no lock, dead PID, or PID reused).
    NothingToAdopt,
    /// A router was running but could not be reused; it has been killed and
    /// the caller should spawn a fresh one.
    Killed(&'static str),
}

/// Decide what to do with a router recorded in the lock file. Never spawns.
///
/// The health probe is what makes adoption safe: a process that is alive but
/// wedged is killed rather than inherited.
pub async fn try_adopt_router(
    preset_path: &Path,
    backend_exe: &Path,
    models_max: u32,
    api_key: String,
) -> AdoptOutcome {
    let Some(lock) = read_lock(preset_path) else {
        return AdoptOutcome::NothingToAdopt;
    };

    let Some(start_time) = process_start_time(lock.pid) else {
        log::info!("Router lock pid {} is not running; discarding", lock.pid);
        remove_lock(preset_path);
        return AdoptOutcome::NothingToAdopt;
    };
    if start_time != lock.start_time {
        log::info!(
            "Router lock pid {} was reused (start_time {} != {}); discarding",
            lock.pid,
            start_time,
            lock.start_time
        );
        remove_lock(preset_path);
        return AdoptOutcome::NothingToAdopt;
    }

    let kill = |reason: &'static str| {
        log::info!(
            "Killing unadoptable router pid {} ({}); a fresh one will be spawned",
            lock.pid,
            reason
        );
        force_kill_router_tree_by_pid(lock.pid);
        remove_lock(preset_path);
        AdoptOutcome::Killed(reason)
    };

    if lock.backend_exe != backend_exe.to_string_lossy() {
        return kill("backend changed");
    }
    if lock.preset_hash != hash_preset(preset_path) {
        return kill("preset changed");
    }
    if lock.models_max != models_max {
        return kill("models_max changed");
    }

    if !probe_health(lock.port, &api_key).await {
        return kill("failed health check");
    }

    log::info!(
        "Adopted router pid {} on port {} (no stdout/stderr pipes; logs unavailable until restart)",
        lock.pid,
        lock.port
    );
    AdoptOutcome::Adopted(Box::new(RouterHandle {
        child: None,
        port: lock.port,
        api_key,
        pid: lock.pid,
        preset_path: preset_path.to_path_buf(),
    }))
}

async fn probe_health(port: u16, api_key: &str) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    else {
        return false;
    };
    let url = format!("http://127.0.0.1:{}/health", port);
    matches!(
        client.get(&url).bearer_auth(api_key).send().await,
        Ok(r) if r.status().is_success()
    )
}

/// Build the argv for router mode. Pure / unit-testable.
///
/// `models_max == 0` is forwarded as-is; the upstream README documents 0 as
/// "unlimited" — we let the server interpret that.
///
/// The API key is deliberately NOT passed here as `--api-key`: argv is
/// visible to any other process on the machine (`ps`/Task Manager, `/proc`),
/// and we already log the full argv at startup. It's set as the
/// `LLAMA_API_KEY` env var instead (`start_router`, env-only, not inherited
/// by child processes the same way a command-line arg would show up in
/// process listings) - llama-server reads either, preferring the CLI flag
/// when both are present (hence the "will be overwritten" warning it used to
/// print when we set both).
pub fn router_args(
    preset_path: &Path,
    port: u16,
    models_max: u32,
    log_path: Option<&Path>,
    default_args: &[String],
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--models-preset".to_string(),
        preset_path.to_string_lossy().to_string(),
        "--models-max".to_string(),
        models_max.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ];
    // Written in addition to stdout/stderr, not instead of them, so the pipe
    // readers below are unaffected. This is the only diagnostic an adopted
    // router leaves behind, since adoption inherits no pipes.
    if let Some(path) = log_path {
        args.push("--log-file".to_string());
        args.push(path.to_string_lossy().to_string());
    }
    // Web-UI disable flag (`--no-webui` pre-b9222, `--no-ui` from b9222) is
    // appended by the TS caller via `default_args` because the spelling
    // depends on the backend build number.
    args.extend(default_args.iter().cloned());
    args
}

/// Merges `LLAMA_API_KEY` into `envs`, always overwriting any prior value.
/// Pure / unit-testable - authoritative so this invariant holds even if a
/// future call site forgets to set it or sets a stale one.
fn with_api_key_env(mut envs: HashMap<String, String>, api_key: &str) -> HashMap<String, String> {
    envs.insert("LLAMA_API_KEY".to_string(), api_key.to_string());
    envs
}

/// Spawn `llama-server` in router mode and wait for it to become ready.
///
/// On readiness-detection failure or spawn failure, the child is killed before
/// returning the error.
#[allow(clippy::too_many_arguments)]
pub async fn start_router(
    backend_exe: PathBuf,
    preset_path: PathBuf,
    log_path: PathBuf,
    port: u16,
    api_key: String,
    models_max: u32,
    default_args: Vec<String>,
    envs: HashMap<String, String>,
    on_error: Option<ErrorCallback>,
) -> Result<RouterHandle, ServerError> {
    log::info!(
        "Starting llama-server in router mode: exe={:?} preset={:?} port={} models_max={}",
        backend_exe,
        preset_path,
        port,
        models_max
    );

    // Authoritative: always carry the key via env, never argv (see
    // `router_args`'s doc comment).
    let envs = with_api_key_env(envs, &api_key);

    if let Some(dir) = log_path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            log::warn!("Could not create router log directory {:?}: {}", dir, e);
        }
    }
    rotate_log(&log_path);
    let args = router_args(&preset_path, port, models_max, Some(&log_path), &default_args);
    log::info!("Router argv: {:?}", args);

    // Resolve readiness timeout (seconds). Match existing convention by
    // honoring LLAMA_ARG_TIMEOUT if set in the env map; otherwise default 60s.
    let timeout_secs: u64 = envs
        .get("LLAMA_ARG_TIMEOUT")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(60);

    let mut command = Command::new(&backend_exe);
    command.args(&args);
    command.envs(&envs);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    setup_windows_process_flags(&mut command);

    let cuda = find_cuda_paths();
    if cuda.lib_paths.is_empty()
        && cuda.bin_paths.is_empty()
        && binary_requires_cuda(&backend_exe)
    {
        log::warn!(
            "llama.cpp router backend appears to require CUDA, but CUDA not found. \
             Process may fail to start."
        );
    }
    let rocm = find_rocm_paths();
    if rocm.lib_paths.is_empty()
        && rocm.bin_paths.is_empty()
        && binary_requires_rocm(&backend_exe)
    {
        log::warn!(
            "llama.cpp router backend appears to require ROCm/HIP, but ROCm not found. \
             Process may fail to start."
        );
    }
    setup_library_path(backend_exe.parent(), &cuda.merged(rocm), &mut command);

    let mut child = command.spawn().map_err(ServerError::Io)?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout = child.stdout.take().expect("stdout was piped");

    let (ready_tx, mut ready_rx) = mpsc::channel::<bool>(1);

    let stdout_ready_tx = ready_tx.clone();
    let stdout_on_error = on_error.clone();
    let _stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut byte_buffer = Vec::new();
        let mut last_error_at: Option<Instant> = None;
        loop {
            byte_buffer.clear();
            match reader.read_until(b'\n', &mut byte_buffer).await {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        log::info!("[llamacpp-router stdout] {}", line);
                    }
                    let line_lower = line.to_lowercase();
                    if is_ready_line(&line_lower) {
                        let _ = stdout_ready_tx.send(true).await;
                    }
                    if let Some(cb) = &stdout_on_error {
                        let kind = if is_oom_line(&line_lower) {
                            Some("oom")
                        } else if is_backend_error_line(&line_lower) {
                            Some("backend")
                        } else {
                            None
                        };
                        if let Some(k) = kind {
                            let now = Instant::now();
                            let fire = last_error_at
                                .map(|t| now.duration_since(t) > Duration::from_secs(3))
                                .unwrap_or(true);
                            if fire {
                                last_error_at = Some(now);
                                cb(k, line.to_string());
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading router stdout: {}", e);
                    break;
                }
            }
        }
    });

    let stderr_on_error = on_error.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut byte_buffer = Vec::new();
        let mut stderr_buffer = String::new();
        let mut last_error_at: Option<Instant> = None;
        loop {
            byte_buffer.clear();
            match reader.read_until(b'\n', &mut byte_buffer).await {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        stderr_buffer.push_str(line);
                        stderr_buffer.push('\n');
                        log::info!("[llamacpp-router] {}", line);
                        let line_lower = line.to_lowercase();
                        if is_ready_line(&line_lower) {
                            let _ = ready_tx.send(true).await;
                        }
                        if let Some(cb) = &stderr_on_error {
                            let kind = if is_oom_line(&line_lower) {
                                Some("oom")
                            } else if is_backend_error_line(&line_lower) {
                                Some("backend")
                            } else {
                                None
                            };
                            if let Some(k) = kind {
                                let now = Instant::now();
                                let fire = last_error_at
                                    .map(|t| now.duration_since(t) > Duration::from_secs(3))
                                    .unwrap_or(true);
                                if fire {
                                    last_error_at = Some(now);
                                    cb(k, line.to_string());
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading router stderr: {}", e);
                    break;
                }
            }
        }
        stderr_buffer
    });

    // Early-exit check.
    if let Some(status) = child.try_wait()? {
        let stderr_output = stderr_task.await.unwrap_or_else(|e| {
                        log::warn!("Router stderr task join failed: {e}");
                        String::new()
                    });
        log::error!("llama-server router exited early with status {:?}", status);
        return Err(LlamacppError::from_stderr(&stderr_output).into());
    }

    let timeout_duration = Duration::from_secs(timeout_secs);
    let start_time = Instant::now();
    log::info!("Waiting for router to be ready (timeout={}s)...", timeout_secs);

    loop {
        tokio::select! {
            Some(true) = ready_rx.recv() => {
                log::info!("llama-server router is ready.");
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                if let Some(status) = child.try_wait()? {
                    let stderr_output = stderr_task.await.unwrap_or_else(|e| {
                        log::warn!("Router stderr task join failed: {e}");
                        String::new()
                    });
                    log::error!("llama-server router exited before readiness: {:?}", status);
                    return Err(LlamacppError::from_stderr(&stderr_output).into());
                }
                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for router to be ready");
                    let _ = child.kill().await;
                    let stderr_output = stderr_task.await.unwrap_or_else(|e| {
                        log::warn!("Router stderr task join failed: {e}");
                        String::new()
                    });
                    return Err(LlamacppError::new(
                        ErrorCode::ModelLoadTimedOut,
                        "Router took too long to start and timed out.".into(),
                        Some(format!(
                            "Timeout: {}s\n\nStderr:\n{}",
                            timeout_duration.as_secs(),
                            stderr_output
                        )),
                    )
                    .into());
                }
            }
        }
    }

    let pid = child.id().unwrap_or(0);
    write_lock(
        &preset_path,
        &RouterLock {
            pid,
            port,
            // A PID we just spawned but cannot find is not worth recording:
            // without a start_time the reuse guard cannot fire.
            start_time: process_start_time(pid).unwrap_or(0),
            backend_exe: backend_exe.to_string_lossy().to_string(),
            preset_hash: hash_preset(&preset_path),
            models_max,
        },
    );
    Ok(RouterHandle {
        child: Some(child),
        port,
        api_key,
        pid,
        preset_path,
    })
}

/// Always terminates; force-kills on busy-deadline. For user-prompt flows
/// use [`try_graceful_stop_router`] directly.
pub async fn stop_router(handle: RouterHandle) -> ServerResult<()> {
    match try_graceful_stop_router(handle, Duration::from_secs(10)).await {
        Ok(()) => Ok(()),
        Err((h, busy)) => {
            log::warn!(
                "stop_router: deadline hit with {} busy model(s) {:?}; force-killing tree",
                busy.len(),
                busy
            );
            force_kill_router_tree(h).await;
            Ok(())
        }
    }
}

/// `Err((handle, busy))` on deadline — caller decides next step.
pub async fn try_graceful_stop_router(
    mut handle: RouterHandle,
    deadline: Duration,
) -> Result<(), (RouterHandle, Vec<String>)> {
    let start = Instant::now();

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("try_graceful_stop_router: failed to build http client: {}; terminating directly", e);
            terminate_router_process(&mut handle).await;
            return Ok(());
        }
    };

    let initial = match list_busy_models(&client, handle.port, &handle.api_key).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "try_graceful_stop_router: GET /models failed ({}); router likely already down, terminating",
                e
            );
            terminate_router_process(&mut handle).await;
            return Ok(());
        }
    };

    let loaded_only: Vec<String> = match list_models_filtered(&client, handle.port, &handle.api_key, &["loaded"]).await {
        Ok(v) => v,
        Err(_) => initial.clone(),
    };
    let processing =
        list_processing_models(&client, handle.port, &handle.api_key, &loaded_only).await;
    if !processing.is_empty() {
        log::warn!(
            "try_graceful_stop_router: {} model(s) actively processing: {:?}",
            processing.len(),
            processing
        );
        return Err((handle, processing));
    }

    if !initial.is_empty() {
        log::info!(
            "try_graceful_stop_router: requesting unload for {} model(s)",
            initial.len()
        );
        let unload_url = format!("http://127.0.0.1:{}/models/unload", handle.port);
        for id in &initial {
            let body = serde_json::json!({ "model": id });
            match client
                .post(&unload_url)
                .bearer_auth(&handle.api_key)
                .json(&body)
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => {}
                Ok(r) => log::warn!("try_graceful_stop_router: unload {} returned {}", id, r.status()),
                Err(e) => log::warn!("try_graceful_stop_router: unload {} failed: {}", id, e),
            }
        }
    }

    loop {
        let still = list_busy_models(&client, handle.port, &handle.api_key)
            .await
            .unwrap_or_default();
        if still.is_empty() {
            break;
        }
        let elapsed = start.elapsed();
        if elapsed >= deadline {
            log::warn!(
                "try_graceful_stop_router: deadline ({:?}) hit with {} busy model(s)",
                deadline,
                still.len()
            );
            return Err((handle, still));
        }
        let remaining = deadline - elapsed;
        tokio::time::sleep(Duration::from_millis(150).min(remaining)).await;
    }

    terminate_router_process(&mut handle).await;
    Ok(())
}

async fn list_busy_models(
    client: &reqwest::Client,
    port: u16,
    api_key: &str,
) -> Result<Vec<String>, String> {
    list_models_filtered(client, port, api_key, &["loaded", "loading"]).await
}

async fn list_models_filtered(
    client: &reqwest::Client,
    port: u16,
    api_key: &str,
    allowed_status: &[&str],
) -> Result<Vec<String>, String> {
    let url = format!("http://127.0.0.1:{}/models", port);
    let resp = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|m| {
                    m.get("status")
                        .and_then(|s| s.get("value"))
                        .and_then(|v| v.as_str())
                        .map(|s| allowed_status.contains(&s))
                        .unwrap_or(false)
                })
                .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

async fn list_processing_models(
    client: &reqwest::Client,
    port: u16,
    api_key: &str,
    candidates: &[String],
) -> Vec<String> {
    let url = format!("http://127.0.0.1:{}/slots", port);
    let mut busy = Vec::new();
    for id in candidates {
        let resp = match client
            .get(&url)
            .query(&[("model", id.as_str())])
            .bearer_auth(api_key)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::warn!("list_processing_models: GET /slots?model={} failed: {}", id, e);
                continue;
            }
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(json) = resp.json::<serde_json::Value>().await else {
            continue;
        };
        let is_busy = json
            .as_array()
            .map(|arr| {
                arr.iter().any(|s| {
                    s.get("is_processing")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        if is_busy {
            busy.push(id.clone());
        }
    }
    busy
}

/// Terminate the router, using the owned `Child` when we have one and falling
/// back to a PID-based tree kill for an adopted process.
async fn terminate_router_process(handle: &mut RouterHandle) {
    remove_lock(&handle.preset_path);
    let Some(child) = handle.child.as_mut() else {
        force_kill_router_tree_by_pid(handle.pid);
        return;
    };
    #[cfg(unix)]
    {
        crate::process::graceful_terminate_process(child).await;
    }
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        crate::process::force_terminate_process(child).await;
    }
    #[cfg(not(any(unix, all(windows, target_arch = "x86_64"))))]
    {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

/// Force-kill by PID only; used when the handle is owned elsewhere
/// (e.g. the watcher loop). Does not reap — the holder of the `Child`
/// will reap on its next operation or on drop.
pub fn force_kill_router_tree_by_pid(router_pid: u32) {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let rpid = Pid::from_u32(router_pid);
    let children: Vec<Pid> = sys
        .processes()
        .values()
        .filter(|p| p.parent() == Some(rpid))
        .map(|p| p.pid())
        .collect();
    log::info!(
        "force_kill_router_tree_by_pid: router pid {} + {} direct child(ren)",
        router_pid,
        children.len()
    );
    if let Some(p) = sys.process(rpid) {
        let _ = p.kill();
    }
    for cpid in &children {
        if let Some(p) = sys.process(*cpid) {
            let _ = p.kill();
        }
    }
}

/// Router is killed before children so it can't spawn new ones mid-sweep.
pub async fn force_kill_router_tree(mut handle: RouterHandle) {
    remove_lock(&handle.preset_path);
    let router_pid = handle.pid;
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let rpid = Pid::from_u32(router_pid);
    let children: Vec<Pid> = sys
        .processes()
        .values()
        .filter(|p| p.parent() == Some(rpid))
        .map(|p| p.pid())
        .collect();

    log::info!(
        "force_kill_router_tree: router pid {} + {} direct child(ren)",
        router_pid,
        children.len()
    );

    if let Some(p) = sys.process(rpid) {
        if !p.kill() {
            log::debug!("force_kill_router_tree: router pid {} kill() false (likely already dying)", router_pid);
        }
    }
    // Failures are expected: router's own exit handler reaps these in parallel.
    for cpid in &children {
        if let Some(p) = sys.process(*cpid) {
            let _ = p.kill();
        }
    }

    if let Some(child) = handle.child.as_mut() {
        let _ = child.wait().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn preset_in(dir: &Path, body: &str) -> PathBuf {
        let p = dir.join("router.preset.ini");
        std::fs::write(&p, body).unwrap();
        p
    }

    fn lock_for(preset: &Path, pid: u32, models_max: u32) -> RouterLock {
        RouterLock {
            pid,
            port: 1337,
            start_time: process_start_time(pid).unwrap_or(0),
            backend_exe: "/backends/llama-server".to_string(),
            preset_hash: hash_preset(preset),
            models_max,
        }
    }

    #[test]
    fn lock_roundtrips_next_to_the_preset() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\n");
        let lock = lock_for(&preset, 4242, 2);

        write_lock(&preset, &lock);
        assert!(dir.path().join(ROUTER_LOCK_FILENAME).exists());

        let read = read_lock(&preset).expect("lock should be readable");
        assert_eq!(read.pid, 4242);
        assert_eq!(read.port, 1337);
        assert_eq!(read.models_max, 2);

        remove_lock(&preset);
        assert!(read_lock(&preset).is_none());
    }

    #[test]
    fn corrupt_lock_is_discarded_not_returned() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\n");
        std::fs::write(dir.path().join(ROUTER_LOCK_FILENAME), b"{not json").unwrap();

        assert!(read_lock(&preset).is_none());
        // A lock we cannot parse must not survive to be retried forever.
        assert!(!dir.path().join(ROUTER_LOCK_FILENAME).exists());
    }

    #[test]
    fn removing_an_absent_lock_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\n");
        remove_lock(&preset);
        remove_lock(&preset);
    }

    #[test]
    fn preset_hash_tracks_content() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\nctx_size=4096\n");
        let before = hash_preset(&preset);

        std::fs::write(&preset, "[*]\nctx_size=8192\n").unwrap();
        assert_ne!(before, hash_preset(&preset));

        std::fs::write(&preset, "[*]\nctx_size=4096\n").unwrap();
        assert_eq!(before, hash_preset(&preset));
    }

    #[test]
    fn missing_preset_hashes_empty_rather_than_panicking() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(hash_preset(&dir.path().join("absent.ini")), "");
    }

    #[tokio::test]
    async fn no_lock_means_nothing_to_adopt() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\n");
        let outcome = try_adopt_router(
            &preset,
            Path::new("/backends/llama-server"),
            1,
            "k".into(),
        )
        .await;
        assert!(matches!(outcome, AdoptOutcome::NothingToAdopt));
    }

    #[tokio::test]
    async fn dead_pid_discards_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\n");
        // Never-valid PID: no process can match, so this exercises the
        // liveness check without depending on a real one.
        let mut lock = lock_for(&preset, u32::MAX, 1);
        lock.start_time = 1;
        write_lock(&preset, &lock);

        let outcome = try_adopt_router(
            &preset,
            Path::new("/backends/llama-server"),
            1,
            "k".into(),
        )
        .await;
        assert!(matches!(outcome, AdoptOutcome::NothingToAdopt));
        assert!(read_lock(&preset).is_none());
    }

    #[tokio::test]
    async fn pid_reuse_is_caught_by_start_time() {
        let dir = tempfile::tempdir().unwrap();
        let preset = preset_in(dir.path(), "[*]\n");
        let mut lock = lock_for(&preset, std::process::id(), 1);
        // Our own PID is alive, but this start_time cannot be ours.
        lock.start_time = lock.start_time.wrapping_add(9999);
        write_lock(&preset, &lock);

        let outcome = try_adopt_router(
            &preset,
            Path::new("/backends/llama-server"),
            1,
            "k".into(),
        )
        .await;
        assert!(matches!(outcome, AdoptOutcome::NothingToAdopt));
        assert!(read_lock(&preset).is_none());
    }

    #[test]
    fn router_args_adds_log_file_only_when_asked() {
        let preset = PathBuf::from("/tmp/router.preset.ini");
        assert!(!router_args(&preset, 1337, 1, None, &[])
            .iter()
            .any(|a| a == "--log-file"));

        let args = router_args(&preset, 1337, 1, Some(Path::new("/tmp/r.log")), &[]);
        let i = args.iter().position(|a| a == "--log-file").unwrap();
        assert_eq!(args[i + 1], "/tmp/r.log");
    }

    #[test]
    fn router_log_never_shares_the_app_log_file() {
        // llama.cpp opens the log with mode "w"; sharing app.log would
        // truncate Jan's own log on every spawn.
        assert_ne!(ROUTER_LOG_FILENAME, "app.log");
    }

    #[test]
    fn rotating_keeps_one_previous_generation() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join(ROUTER_LOG_FILENAME);

        // Nothing to rotate yet.
        rotate_log(&log);
        assert!(!log.exists());

        std::fs::write(&log, b"first run").unwrap();
        rotate_log(&log);
        assert!(!log.exists());
        let previous = log.with_extension("log.1");
        assert_eq!(std::fs::read(&previous).unwrap(), b"first run");

        // A second rotation overwrites the older generation, never the newer.
        std::fs::write(&log, b"second run").unwrap();
        rotate_log(&log);
        assert_eq!(std::fs::read(&previous).unwrap(), b"second run");
    }

    #[test]
    fn rotating_an_oversized_log_keeps_only_its_tail() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join(ROUTER_LOG_FILENAME);
        let previous = log.with_extension("log.1");

        // Head is filler; the crash signature lands at the very end, which is
        // the part that has to survive.
        let mut body = vec![b'x'; (MAX_RETAINED_LOG_BYTES + 4096) as usize];
        body.extend_from_slice(b"CUDA error: out of memory");
        std::fs::write(&log, &body).unwrap();

        rotate_log(&log);

        assert!(!log.exists());
        let kept = std::fs::read(&previous).unwrap();
        assert_eq!(kept.len() as u64, MAX_RETAINED_LOG_BYTES);
        assert!(kept.ends_with(b"CUDA error: out of memory"));
    }

    #[test]
    fn keep_log_tail_copies_the_whole_file_when_under_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.log");
        let dst = dir.path().join("b.log");
        std::fs::write(&src, b"short").unwrap();

        keep_log_tail(&src, &dst, MAX_RETAINED_LOG_BYTES).unwrap();

        assert_eq!(std::fs::read(&dst).unwrap(), b"short");
    }

    #[test]
    fn router_args_contains_required_flags() {
        let preset = PathBuf::from("/tmp/preset.ini");
        let args = router_args(&preset, 1337, 4, None, &[]);

        // Required flags present
        let joined = args.join(" ");
        assert!(joined.contains("--models-preset /tmp/preset.ini"));
        assert!(!args.iter().any(|a| a == "--no-models-autoload"));
        assert!(joined.contains("--models-max 4"));
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--port 1337"));
        // Web-UI disable flag is now appended by the caller (it's
        // build-number-dependent: --no-webui vs --no-ui), so it must NOT be
        // baked into the base argv.
        assert!(!args.iter().any(|a| a == "--no-webui"));
        assert!(!args.iter().any(|a| a == "--no-ui"));
    }

    #[test]
    fn with_api_key_env_sets_the_key() {
        let envs = with_api_key_env(HashMap::new(), "secret-key");
        assert_eq!(envs.get("LLAMA_API_KEY"), Some(&"secret-key".to_string()));
    }

    #[test]
    fn with_api_key_env_overwrites_a_stale_value() {
        let mut initial = HashMap::new();
        initial.insert("LLAMA_API_KEY".to_string(), "stale-key".to_string());
        let envs = with_api_key_env(initial, "fresh-key");
        assert_eq!(envs.get("LLAMA_API_KEY"), Some(&"fresh-key".to_string()));
    }

    #[test]
    fn with_api_key_env_preserves_other_vars() {
        let mut initial = HashMap::new();
        initial.insert("LLAMA_ARG_TIMEOUT".to_string(), "60".to_string());
        let envs = with_api_key_env(initial, "secret-key");
        assert_eq!(envs.get("LLAMA_ARG_TIMEOUT"), Some(&"60".to_string()));
        assert_eq!(envs.get("LLAMA_API_KEY"), Some(&"secret-key".to_string()));
    }

    #[test]
    fn is_ready_line_matches_router_mode_wording() {
        // Regression: router mode logs "llama_server: listening on
        // http://host:port" (colon before "listening"), which the older
        // "server listening on" (no colon) pattern does not match -
        // readiness was never detected and start_router hung for the full
        // 600s timeout despite the server already serving requests.
        let line = "0.00.021.026 i srv  llama_server: listening on http://127.0.0.1:55707";
        assert!(is_ready_line(line));
    }

    #[test]
    fn is_ready_line_still_matches_older_wordings() {
        assert!(is_ready_line("http server listening on 127.0.0.1:8080"));
        assert!(is_ready_line("server is listening on http://127.0.0.1:8080"));
        assert!(is_ready_line("server listening on 127.0.0.1:8080"));
        assert!(is_ready_line("starting the main loop"));
    }

    #[test]
    fn is_ready_line_rejects_unrelated_lines() {
        assert!(!is_ready_line("srv log_server_r: request: post /v1/chat/completions"));
        assert!(!is_ready_line("loaded 5 custom model presets"));
    }

    #[test]
    fn router_args_never_carries_the_api_key() {
        // The key must travel via the LLAMA_API_KEY env var only - argv is
        // visible to any other process on the machine (ps/Task Manager) and
        // gets logged verbatim at startup.
        let preset = PathBuf::from("/tmp/preset.ini");
        let args = router_args(&preset, 1337, 4, None, &[]);
        assert!(!args.iter().any(|a| a == "--api-key"));
        assert!(!args.join(" ").to_lowercase().contains("api-key"));
    }

    #[test]
    fn router_args_appends_default_args_in_order() {
        let preset = PathBuf::from("/tmp/p.ini");
        let extras = vec!["--threads".to_string(), "8".to_string(), "--metrics".to_string()];
        let args = router_args(&preset, 8080, 2, None, &extras);

        // The defaults must appear after our base flags, preserving order.
        let last_three: Vec<&String> = args.iter().rev().take(3).collect::<Vec<_>>().into_iter().rev().collect();
        assert_eq!(last_three, vec![&extras[0], &extras[1], &extras[2]]);
    }

    #[test]
    fn router_args_passes_through_models_max_zero() {
        // README: 0 means unlimited; we forward as-is.
        let preset = PathBuf::from("/tmp/p.ini");
        let args = router_args(&preset, 8080, 0, None, &[]);
        let joined = args.join(" ");
        assert!(joined.contains("--models-max 0"));
    }

    #[test]
    fn classifies_backend_crash_lines() {
        // Inputs arrive already lowercased from the caller.
        assert!(is_backend_error_line(
            "what():  vk::device::waitforfences: errordevicelost"
        ));
        assert!(is_backend_error_line(
            "terminate called after throwing an instance of 'vk::devicelosterror'"
        ));
        assert!(is_backend_error_line("cuda error: out of memory"));
        assert!(is_backend_error_line("ggml_assert(cond) failed"));
        // glibc heap-corruption aborts (e.g. mtmd video decode crash).
        assert!(is_backend_error_line("corrupted size vs. prev_size"));
        assert!(is_backend_error_line(
            "malloc(): corrupted top size"
        ));
        assert!(is_backend_error_line("stack smashing detected"));
        assert!(!is_backend_error_line(
            "srv log_server_r: request: post /v1/chat/completions"
        ));
        // OOM is classified on its own path.
        assert!(is_oom_line("erroroutofdevicememory"));
    }
}
