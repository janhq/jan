use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tokio::time::Instant;

use crate::error::{ErrorCode, MlxError, ServerError, ServerResult};
use crate::process::{
    find_session_by_model_id, get_all_active_sessions, get_all_loaded_model_ids,
    get_random_available_port, is_process_running_by_pid,
};
use crate::state::{MlxBackendSession, MlxState, SessionInfo};

#[cfg(unix)]
use crate::process::graceful_terminate_process;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

/// MLX server configuration passed from the frontend
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MlxConfig {
    #[serde(default)]
    pub ctx_size: i32,
}

/// Core model-loading logic, decoupled from Tauri AppHandle.
/// `binary_path` must point to the mlx-server executable.
/// `process_map_arc` is the shared session map from MlxState.
pub async fn load_mlx_model_impl(
    process_map_arc: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    binary_path: &Path,
    model_id: String,
    model_path: String,
    port: u16,
    config: MlxConfig,
    envs: HashMap<String, String>,
    is_embedding: bool,
    timeout: u64,
) -> ServerResult<SessionInfo> {
    let mut process_map = process_map_arc.lock().await;

    log::info!("Attempting to launch MLX server at path: {:?}", binary_path);
    log::info!("Using MLX configuration: {:?}", config);

    // Validate binary path
    let bin_path = PathBuf::from(binary_path);
    if !bin_path.exists() {
        return Err(MlxError::new(
            ErrorCode::BinaryNotFound,
            format!("MLX server binary not found at: {}", binary_path.display()),
            None,
        )
        .into());
    }

    // Validate model path
    let model_path_pb = PathBuf::from(&model_path);
    if !model_path_pb.exists() {
        return Err(MlxError::new(
            ErrorCode::ModelFileNotFound,
            format!("Model file not found at: {}", model_path),
            None,
        )
        .into());
    }

    let api_key: String = envs
        .get("MLX_API_KEY")
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            log::warn!("API key not provided for MLX server");
            String::new()
        });

    // Build command arguments
    let mut args: Vec<String> = vec![
        "--model".to_string(),
        model_path.clone(),
        "--port".to_string(),
        port.to_string(),
        "--model-id".to_string(),
        model_id.clone(),
    ];

    if config.ctx_size > 0 {
        args.push("--ctx-size".to_string());
        args.push(config.ctx_size.to_string());
    }

    if !api_key.is_empty() {
        args.push("--api-key".to_string());
        args.push(api_key.clone());
    }

    log::info!("MLX server arguments: {:?}", args);

    // Configure the command
    let mut command = Command::new(&bin_path);
    command.args(&args);
    command.envs(envs);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

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
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        log::info!("[mlx stdout] {}", line);
                    }

                    let line_lower = line.to_lowercase();
                    if line_lower.contains("http server listening")
                        || line_lower.contains("server is listening")
                        || line_lower.contains("server started")
                        || line_lower.contains("ready to accept")
                        || line_lower.contains("server started and listening on")
                    {
                        log::info!(
                            "MLX server appears to be ready based on stdout: '{}'",
                            line
                        );
                        let _ = stdout_ready_tx.send(true).await;
                    }
                }
                Err(e) => {
                    log::error!("Error reading MLX stdout: {}", e);
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
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();

                    if !line.is_empty() {
                        stderr_buffer.push_str(line);
                        stderr_buffer.push('\n');
                        log::info!("[mlx] {}", line);

                        let line_lower = line.to_lowercase();
                        if line_lower.contains("server is listening")
                            || line_lower.contains("server listening on")
                            || line_lower.contains("server started and listening on")
                        {
                            log::info!(
                                "MLX model appears to be ready based on logs: '{}'",
                                line
                            );
                            let _ = ready_tx.send(true).await;
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading MLX logs: {}", e);
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
            log::error!("MLX server failed early with code {:?}", status);
            log::error!("{}", stderr_output);
            return Err(MlxError::from_stderr(&stderr_output).into());
        }
    }

    // Wait for server to be ready or timeout
    let timeout_duration = Duration::from_secs(timeout);
    let start_time = Instant::now();
    log::info!("Waiting for MLX model session to be ready...");

    loop {
        tokio::select! {
            Some(true) = ready_rx.recv() => {
                log::info!("MLX model is ready to accept requests!");
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                if let Some(status) = child.try_wait()? {
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    if !status.success() {
                        log::error!("MLX server exited with error code {:?}", status);
                        return Err(MlxError::from_stderr(&stderr_output).into());
                    } else {
                        log::error!("MLX server exited successfully but without ready signal");
                        return Err(MlxError::from_stderr(&stderr_output).into());
                    }
                }

                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for MLX server to be ready");
                    let _ = child.kill().await;
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    return Err(MlxError::new(
                        ErrorCode::ModelLoadTimedOut,
                        "The MLX model took too long to load and timed out.".into(),
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

    let pid = child.id().map(|id| id as i32).unwrap_or(-1);

    log::info!("MLX server process started with PID: {} and is ready", pid);
    let session_info = SessionInfo {
        pid,
        port: port.into(),
        model_id,
        model_path: model_path_pb.display().to_string(),
        is_embedding,
        api_key,
    };

    process_map.insert(
        pid,
        MlxBackendSession {
            child,
            info: session_info.clone(),
        },
    );

    Ok(session_info)
}

/// Load a model using the MLX server binary (Tauri command wrapper)
#[tauri::command]
pub async fn load_mlx_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
    model_path: String,
    port: u16,
    config: MlxConfig,
    envs: HashMap<String, String>,
    is_embedding: bool,
    timeout: u64,
) -> ServerResult<SessionInfo> {
    let state: State<MlxState> = app_handle.state();
    let binary_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| {
            MlxError::new(
                ErrorCode::BinaryNotFound,
                "Failed to get resource dir".to_string(),
                Some(e.to_string()),
            )
        })?
        .join("resources/bin/mlx-server");
    load_mlx_model_impl(
        state.mlx_server_process.clone(),
        &binary_path,
        model_id,
        model_path,
        port,
        config,
        envs,
        is_embedding,
        timeout,
    )
    .await
}

/// Unload an MLX model by terminating its process
#[tauri::command]
pub async fn unload_mlx_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> ServerResult<UnloadResult> {
    let state: State<MlxState> = app_handle.state();
    let mut map = state.mlx_server_process.lock().await;

    if let Some(session) = map.remove(&pid) {
        let mut child = session.child;

        #[cfg(unix)]
        {
            graceful_terminate_process(&mut child).await;
        }

        Ok(UnloadResult {
            success: true,
            error: None,
        })
    } else {
        log::warn!("No MLX server with PID '{}' found", pid);
        Ok(UnloadResult {
            success: true,
            error: None,
        })
    }
}

/// Check if a process is still running
#[tauri::command]
pub async fn is_mlx_process_running<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    is_process_running_by_pid(app_handle, pid).await
}

/// Get a random available port
#[tauri::command]
pub async fn get_mlx_random_port<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, String> {
    get_random_available_port(app_handle).await
}

/// Find session information by model ID
#[tauri::command]
pub async fn find_mlx_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    find_session_by_model_id(app_handle, &model_id).await
}

/// Get all loaded model IDs
#[tauri::command]
pub async fn get_mlx_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    get_all_loaded_model_ids(app_handle).await
}

/// Get all active sessions
#[tauri::command]
pub async fn get_mlx_all_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    get_all_active_sessions(app_handle).await
}
