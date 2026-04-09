use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tokio::time::Instant;

use crate::args::{ArgumentBuilder, LlamacppConfig};
use crate::device::{get_devices_from_backend, DeviceInfo};
use crate::error::{ErrorCode, LlamacppError, ServerError, ServerResult};
use crate::path::{validate_binary_path, validate_mmproj_path, validate_model_path};
use crate::process::{
    find_session_by_model_id, get_all_active_sessions, get_all_loaded_model_ids,
    get_random_available_port, is_process_running_by_pid,
};
use crate::state::{LLamaBackendSession, LlamacppState, SessionInfo};
use jan_utils::{
    add_cuda_paths, add_hip_paths, binary_requires_cuda, binary_requires_hip,
    setup_library_path, setup_windows_process_flags,
};

#[cfg(unix)]
use crate::process::graceful_terminate_process;

#[cfg(all(windows, target_arch = "x86_64"))]
use crate::process::force_terminate_process;

type HmacSha256 = Hmac<Sha256>;
const AUTO_RESTART_MAX_ATTEMPTS: usize = 3;
const AUTO_RESTART_WINDOW_MS: u64 = 5 * 60 * 1000;

#[derive(Clone, serde::Serialize)]
struct SessionLifecycleEvent {
    model_id: String,
    pid: Option<i32>,
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

/// Core model loading logic usable without an AppHandle (CLI / test support).
pub async fn load_llama_model_impl(
    process_map_arc: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    backend_path: &str,
    model_id: String,
    model_path: String,
    port: u16,
    config: LlamacppConfig,
    envs: HashMap<String, String>,
    mmproj_path: Option<String>,
    is_embedding: bool,
    timeout: u64,
) -> ServerResult<SessionInfo> {
    let mut process_map = process_map_arc.lock().await;
    let launch_config = crate::state::SessionLaunchConfig {
        backend_path: backend_path.to_string(),
        model_id: model_id.clone(),
        model_path: model_path.clone(),
        port,
        config: config.clone(),
        envs: envs.clone(),
        mmproj_path: mmproj_path.clone(),
        is_embedding,
        timeout,
    };

    log::info!("Attempting to launch server at path: {:?}", backend_path);
    log::info!("Using configuration: {:?}", config);

    let bin_path = validate_binary_path(backend_path)?;

    // Build arguments using the ArgumentBuilder
    let builder = ArgumentBuilder::new(config.clone(), is_embedding)
        .map_err(|e| ServerError::InvalidArgument(e))?;

    let mut args = builder.build(&model_id, &model_path, port, mmproj_path.clone());

    log::info!("Generated arguments: {:?}", args);

    // Validate paths
    let model_path_pb = validate_model_path(&mut args)?;
    let mmproj_path_pb = validate_mmproj_path(&mut args)?;

    let mmproj_path_string = if let Some(ref _mmproj_pb) = mmproj_path_pb {
        // Find the actual mmproj path from args after validation/conversion
        if let Some(mmproj_index) = args.iter().position(|arg| arg == "--mmproj") {
            Some(args[mmproj_index + 1].clone())
        } else {
            None
        }
    } else {
        None
    };

    log::info!(
        "MMPROJ Path string: {}",
        &mmproj_path_string.as_ref().unwrap_or(&"None".to_string())
    );

    let api_key: String = envs
        .get("LLAMA_API_KEY")
        .map(|s| s.to_string())
        .unwrap_or_default();

    // Configure the command to run the server
    let mut command = Command::new(&bin_path);

    command.args(args);
    command.envs(envs);

    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    setup_windows_process_flags(&mut command);

    // Try to add CUDA paths (works on both Windows and Linux)
    let cuda_found = add_cuda_paths(&mut command);
    if !cuda_found && binary_requires_cuda(&bin_path) {
        log::warn!(
            "llama.cpp backend appears to require CUDA, but CUDA not found. \
             Process may fail to start. Please install the CUDA runtime and try again!"
        );
    }

    // Try to add ROCm/HIP paths
    let hip_found = add_hip_paths(&mut command);
    if !hip_found && binary_requires_hip(&bin_path) {
        log::warn!(
            "llama.cpp backend appears to require ROCm/HIP, but the ROCm runtime \
             was not found. Process may fail to start. \
             Please install ROCm (https://rocm.docs.amd.com/) and try again!"
        );
    }

    // Add the binary's directory to library path
    setup_library_path(bin_path.parent(), &mut command);

    // Spawn the child process
    let mut child = command.spawn().map_err(ServerError::Io)?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout = child.stdout.take().expect("stdout was piped");

    // Create channels for communication between tasks
    let (ready_tx, mut ready_rx) = mpsc::channel::<bool>(1);

    // Spawn task to monitor stdout for readiness
    let stdout_ready_tx = ready_tx.clone();
    let _stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut byte_buffer = Vec::new();

        loop {
            byte_buffer.clear();
            match reader.read_until(b'\n', &mut byte_buffer).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        log::info!("[llamacpp stdout] {}", line);
                    }

                    // Check for readiness indicators
                    let line_lower = line.to_lowercase();
                    if line_lower.contains("http server listening")
                        || line_lower.contains("all slots are idle")
                        || line_lower.contains("starting the main loop")
                    {
                        log::info!("Server appears to be ready based on stdout: '{}'", line);
                        let _ = stdout_ready_tx.send(true).await;
                    }
                }
                Err(e) => {
                    log::error!("Error reading stdout: {}", e);
                    break;
                }
            }
        }
    });

    // Spawn task to capture stderr and monitor for errors
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut byte_buffer = Vec::new();
        let mut stderr_buffer = String::new();

        loop {
            byte_buffer.clear();
            match reader.read_until(b'\n', &mut byte_buffer).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();

                    if !line.is_empty() {
                        stderr_buffer.push_str(line);
                        stderr_buffer.push('\n');
                        log::info!("[llamacpp] {}", line);

                        // Check for readiness indicator
                        let line_lower = line.to_string().to_lowercase();
                        if line_lower.contains("server is listening on")
                            || line_lower.contains("starting the main loop")
                            || line_lower.contains("server listening on")
                        {
                            log::info!("Model appears to be ready based on logs: '{}'", line);
                            let _ = ready_tx.send(true).await;
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading logs: {}", e);
                    break;
                }
            }
        }

        stderr_buffer
    });

    // Check if process exited early
    if let Some(status) = child.try_wait()? {
        if !status.success() {
            let stderr_output = stderr_task.await.unwrap_or_default();
            log::error!("llama.cpp failed early with code {:?}", status);
            log::error!("{}", stderr_output);
            return Err(LlamacppError::from_stderr(&stderr_output).into());
        }
    }

    // Wait for server to be ready or timeout
    let timeout_duration = Duration::from_secs(timeout);
    let start_time = Instant::now();
    log::info!("Waiting for model session to be ready...");

    loop {
        tokio::select! {
            // Server is ready
            Some(true) = ready_rx.recv() => {
                log::info!("Model is ready to accept requests!");
                break;
            }
            // Check for process exit more frequently
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                // Check if process exited
                if let Some(status) = child.try_wait()? {
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    if !status.success() {
                        log::error!("llama.cpp exited with error code {:?}", status);
                        return Err(LlamacppError::from_stderr(&stderr_output).into());
                    } else {
                        log::error!("llama.cpp exited successfully but without ready signal");
                        return Err(LlamacppError::from_stderr(&stderr_output).into());
                    }
                }

                // Timeout check
                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for server to be ready");
                    let _ = child.kill().await;
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    return Err(LlamacppError::new(
                        ErrorCode::ModelLoadTimedOut,
                        "The model took too long to load and timed out.".into(),
                        Some(format!("Timeout: {}s\n\nStderr:\n{}", timeout_duration.as_secs(), stderr_output)),
                    ).into());
                }
            }
        }
    }

    // Get the PID to use as session ID
    let pid = child.id().map(|id| id as i32).unwrap_or(-1);

    log::info!("Server process started with PID: {} and is ready", pid);
    let session_info = SessionInfo {
        pid: pid.clone(),
        port: port.into(),
        model_id: model_id,
        model_path: model_path_pb.display().to_string(),
        is_embedding: is_embedding,
        api_key: api_key,
        mmproj_path: mmproj_path_string,
    };

    // Insert session info to process_map
    process_map.insert(
        pid.clone(),
        LLamaBackendSession {
            child,
            info: session_info.clone(),
            launch: launch_config,
            restart_attempt_timestamps_ms: Vec::new(),
        },
    );

    Ok(session_info)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn can_attempt_restart(session: &mut LLamaBackendSession) -> bool {
    let cutoff = now_ms().saturating_sub(AUTO_RESTART_WINDOW_MS);
    session
        .restart_attempt_timestamps_ms
        .retain(|ts| *ts >= cutoff);
    session.restart_attempt_timestamps_ms.len() < AUTO_RESTART_MAX_ATTEMPTS
}

fn start_session_exit_monitor<R: Runtime>(app_handle: tauri::AppHandle<R>, model_id: String) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(1000)).await;

            let maybe_exited = {
                let state: State<LlamacppState> = app_handle.state();
                let mut map = state.llama_server_process.lock().await;

                let maybe_session = map
                    .values_mut()
                    .find(|session| session.info.model_id == model_id);

                let Some(session) = maybe_session else {
                    // Session no longer exists (unloaded manually or cleaned up); stop watching.
                    return;
                };

                match session.child.try_wait() {
                    Ok(Some(_status)) => true,
                    Ok(None) => false,
                    Err(err) => {
                        log::warn!(
                            "Failed to inspect process state for model '{}': {}",
                            model_id,
                            err
                        );
                        false
                    }
                }
            };

            if maybe_exited {
                let _ = ensure_session_ready(app_handle.clone(), model_id.clone()).await;
            }
        }
    });
}

/// Load a llama model and start the server
#[tauri::command]
pub async fn load_llama_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    backend_path: &str,
    model_id: String,
    model_path: String,
    port: u16,
    config: LlamacppConfig,
    envs: HashMap<String, String>,
    mmproj_path: Option<String>,
    is_embedding: bool,
    timeout: u64,
) -> ServerResult<SessionInfo> {
    let state: State<LlamacppState> = app_handle.state();
    let session_info = load_llama_model_impl(
        state.llama_server_process.clone(),
        backend_path,
        model_id,
        model_path,
        port,
        config,
        envs,
        mmproj_path,
        is_embedding,
        timeout,
    )
    .await?;

    // Observe process exit from plugin side immediately after load.
    start_session_exit_monitor(app_handle, session_info.model_id.clone());

    Ok(session_info)
}

/// Unload a llama model by terminating its process
#[tauri::command]
pub async fn unload_llama_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> ServerResult<UnloadResult> {
    let state: State<LlamacppState> = app_handle.state();
    let mut map = state.llama_server_process.lock().await;

    if let Some(session) = map.remove(&pid) {
        let mut child = session.child;

        #[cfg(unix)]
        {
            graceful_terminate_process(&mut child).await;
        }

        #[cfg(all(windows, target_arch = "x86_64"))]
        {
            force_terminate_process(&mut child).await;
        }

        Ok(UnloadResult {
            success: true,
            error: None,
        })
    } else {
        log::warn!("No server with PID '{}' found", pid);
        Ok(UnloadResult {
            success: true,
            error: None,
        })
    }
}

/// Get available devices from the llama.cpp backend
#[tauri::command]
pub async fn get_devices(
    backend_path: &str,
    envs: HashMap<String, String>,
) -> ServerResult<Vec<DeviceInfo>> {
    get_devices_from_backend(backend_path, envs).await
}

/// Generate API key using HMAC-SHA256
#[tauri::command]
pub fn generate_api_key(model_id: String, api_secret: String) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(api_secret.as_bytes())
        .map_err(|e| format!("Invalid key length: {}", e))?;
    mac.update(model_id.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    let hash = general_purpose::STANDARD.encode(code_bytes);
    Ok(hash)
}

/// Check if a process is still running
#[tauri::command]
pub async fn is_process_running<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    is_process_running_by_pid(app_handle, pid).await
}

#[tauri::command]
pub async fn ensure_session_ready<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<SessionInfo, String> {
    let state: State<LlamacppState> = app_handle.state();
    let process_map_arc = state.llama_server_process.clone();

    // Step 1: resolve session by model_id and check if alive from source-of-truth child handle.
    let (dead_pid, maybe_restart_launch) = {
        let mut map = process_map_arc.lock().await;
        let maybe_entry = map
            .iter_mut()
            .find(|(_, session)| session.info.model_id == model_id);

        let Some((pid, session)) = maybe_entry else {
            return Err(format!("No active session found for model: {}", model_id));
        };

        match session.child.try_wait() {
            Ok(None) => {
                return Ok(session.info.clone());
            }
            Ok(Some(status)) => {
                let _ = app_handle.emit(
                    "llamacpp://session-exited",
                    SessionLifecycleEvent {
                        model_id: model_id.clone(),
                        pid: Some(*pid),
                        message: format!("Process exited with status: {}", status),
                    },
                );
                if !session.launch.config.auto_restart_on_crash {
                    return Err("Model appears to have crashed! Please reload!".to_string());
                }
                if !can_attempt_restart(session) {
                    let _ = app_handle.emit(
                        "llamacpp://session-restart-failed",
                        SessionLifecycleEvent {
                            model_id: model_id.clone(),
                            pid: Some(*pid),
                            message: "Auto-restart attempt limit reached".to_string(),
                        },
                    );
                    return Err(format!(
                        "Model \"{}\" crashed repeatedly. Auto-restart limit reached ({} attempts in {} minutes). Please reload manually.",
                        model_id,
                        AUTO_RESTART_MAX_ATTEMPTS,
                        AUTO_RESTART_WINDOW_MS / 60000
                    ));
                }

                log::warn!(
                    "Model '{}' exited with status {:?}. Attempting automatic restart.",
                    model_id,
                    status
                );
                let _ = app_handle.emit(
                    "llamacpp://session-restarting",
                    SessionLifecycleEvent {
                        model_id: model_id.clone(),
                        pid: Some(*pid),
                        message: "Attempting automatic restart".to_string(),
                    },
                );

                session.restart_attempt_timestamps_ms.push(now_ms());
                (Some(*pid), Some(session.launch.clone()))
            }
            Err(err) => {
                return Err(format!("Failed to inspect session process state: {}", err));
            }
        }
    };

    // Step 2: remove dead session before restart.
    if let Some(pid) = dead_pid {
        let mut map = process_map_arc.lock().await;
        map.remove(&pid);
    }

    // Step 3: restart using original launch config.
    let launch = maybe_restart_launch
        .ok_or_else(|| "Unable to restart model session: launch configuration missing".to_string())?;

    let restarted = load_llama_model_impl(
        process_map_arc,
        &launch.backend_path,
        launch.model_id,
        launch.model_path,
        launch.port,
        launch.config,
        launch.envs,
        launch.mmproj_path,
        launch.is_embedding,
        launch.timeout,
    )
    .await
    .map_err(|e| {
        let _ = app_handle.emit(
            "llamacpp://session-restart-failed",
            SessionLifecycleEvent {
                model_id: model_id.clone(),
                pid: dead_pid,
                message: format!("Automatic restart failed: {}", e),
            },
        );
        format!("Model crashed and automatic restart failed: {}", e)
    })?;

    let _ = app_handle.emit(
        "llamacpp://session-restarted",
        SessionLifecycleEvent {
            model_id: model_id.clone(),
            pid: Some(restarted.pid),
            message: "Automatic restart successful".to_string(),
        },
    );

    Ok(restarted)
}

/// Get a random available port
#[tauri::command]
pub async fn get_random_port<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<u16, String> {
    get_random_available_port(app_handle).await
}

/// Find session information by model ID
#[tauri::command]
pub async fn find_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    find_session_by_model_id(app_handle, &model_id).await
}

/// Get all loaded model IDs
#[tauri::command]
pub async fn get_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    get_all_loaded_model_ids(app_handle).await
}

/// Get all active sessions
#[tauri::command]
pub async fn get_all_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    get_all_active_sessions(app_handle).await
}

/// Get session information by model ID
#[tauri::command]
pub async fn get_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    find_session_by_model_id(app_handle, &model_id).await
}
