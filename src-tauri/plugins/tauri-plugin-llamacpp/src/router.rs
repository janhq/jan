//! Router-mode lifecycle for `llama-server`.
//!
//! Phase 1 of the router refactor: spawn / health-check / shut down a single
//! `llama-server` instance running in router mode (no `-m` / `-hf` flag, models
//! are loaded on demand via the HTTP API). This module is intentionally
//! standalone — it does NOT touch the existing per-model session map.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::time::Instant;

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
        "--no-models-autoload".to_string(),
        "--models-max".to_string(),
        models_max.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--api-key".to_string(),
        api_key.to_string(),
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

    // stdout reader (replicates the marker-detection patterns in commands.rs)
    let stdout_ready_tx = ready_tx.clone();
    let _stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut byte_buffer = Vec::new();
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
                }
                Err(e) => {
                    log::error!("Error reading router stdout: {}", e);
                    break;
                }
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut byte_buffer = Vec::new();
        let mut stderr_buffer = String::new();
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

/// Gracefully shut down a router process.
///
/// On Unix: SIGTERM, wait up to 5s, then SIGKILL (matches
/// `process::graceful_terminate_process`). On Windows: forced kill (matches
/// `process::force_terminate_process`).
pub async fn stop_router(mut handle: RouterHandle) -> ServerResult<()> {
    #[cfg(unix)]
    {
        crate::process::graceful_terminate_process(&mut handle.child).await;
    }
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        crate::process::force_terminate_process(&mut handle.child).await;
    }
    #[cfg(not(any(unix, all(windows, target_arch = "x86_64"))))]
    {
        let _ = handle.child.kill().await;
        let _ = handle.child.wait().await;
    }
    Ok(())
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
        assert!(args.iter().any(|a| a == "--no-models-autoload"));
        assert!(joined.contains("--models-max 4"));
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--port 1337"));
        assert!(joined.contains("--api-key secret-key"));
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
