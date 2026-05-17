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
    false
}

use crate::error::{ErrorCode, LlamacppError, ServerError, ServerResult};
use jan_utils::{binary_requires_cuda, find_cuda_paths, setup_library_path, setup_windows_process_flags};

/// A handle to a running router-mode `llama-server` process.
pub struct RouterHandle {
    pub child: Child,
    pub port: u16,
    pub api_key: String,
    pub pid: u32,
}

/// Build the argv for router mode. Pure / unit-testable.
///
/// `models_max == 0` is forwarded as-is; the upstream README documents 0 as
/// "unlimited" — we let the server interpret that.
pub fn router_args(
    preset_path: &Path,
    port: u16,
    api_key: &str,
    models_max: u32,
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
        "--api-key".to_string(),
        api_key.to_string(),
        "--no-webui".to_string(),
    ];
    args.extend(default_args.iter().cloned());
    args
}

/// Spawn `llama-server` in router mode and wait for it to become ready.
///
/// On readiness-detection failure or spawn failure, the child is killed before
/// returning the error.
pub async fn start_router(
    backend_exe: PathBuf,
    preset_path: PathBuf,
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

    let args = router_args(&preset_path, port, &api_key, models_max, &default_args);
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
    setup_library_path(backend_exe.parent(), &cuda, &mut command);

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
                    if line_lower.contains("http server listening")
                        || line_lower.contains("server is listening on")
                        || line_lower.contains("server listening on")
                        || line_lower.contains("starting the main loop")
                    {
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
                        if line_lower.contains("server is listening on")
                            || line_lower.contains("server listening on")
                            || line_lower.contains("starting the main loop")
                            || line_lower.contains("http server listening")
                        {
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
        let stderr_output = stderr_task.await.unwrap_or_default();
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
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    log::error!("llama-server router exited before readiness: {:?}", status);
                    return Err(LlamacppError::from_stderr(&stderr_output).into());
                }
                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for router to be ready");
                    let _ = child.kill().await;
                    let stderr_output = stderr_task.await.unwrap_or_default();
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
    Ok(RouterHandle {
        child,
        port,
        api_key,
        pid,
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
            terminate_router_process(&mut handle.child).await;
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
            terminate_router_process(&mut handle.child).await;
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

    terminate_router_process(&mut handle.child).await;
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

async fn terminate_router_process(child: &mut Child) {
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

    let _ = handle.child.wait().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn router_args_contains_required_flags() {
        let preset = PathBuf::from("/tmp/preset.ini");
        let args = router_args(&preset, 1337, "secret-key", 4, &[]);

        // Required flags present
        let joined = args.join(" ");
        assert!(joined.contains("--models-preset /tmp/preset.ini"));
        assert!(!args.iter().any(|a| a == "--no-models-autoload"));
        assert!(joined.contains("--models-max 4"));
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--port 1337"));
        assert!(joined.contains("--api-key secret-key"));
        assert!(args.iter().any(|a| a == "--no-webui"));
    }

    #[test]
    fn router_args_appends_default_args_in_order() {
        let preset = PathBuf::from("/tmp/p.ini");
        let extras = vec!["--threads".to_string(), "8".to_string(), "--metrics".to_string()];
        let args = router_args(&preset, 8080, "k", 2, &extras);

        // The defaults must appear after our base flags, preserving order.
        let last_three: Vec<&String> = args.iter().rev().take(3).collect::<Vec<_>>().into_iter().rev().collect();
        assert_eq!(last_three, vec![&extras[0], &extras[1], &extras[2]]);
    }

    #[test]
    fn router_args_passes_through_models_max_zero() {
        // README: 0 means unlimited; we forward as-is.
        let preset = PathBuf::from("/tmp/p.ini");
        let args = router_args(&preset, 8080, "k", 0, &[]);
        let joined = args.join(" ");
        assert!(joined.contains("--models-max 0"));
    }
}
