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
    #[serde(default)]
    pub draft_model_path: String,
    #[serde(default)]
    pub block_size: i32,
    /// Drafter family — "dflash" (default) or "mtp" (Gemma 4 assistant).
    /// Empty string is treated as "dflash" so pre-update callers keep
    /// working without churn.
    #[serde(default)]
    pub draft_kind: String,
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

    // mlx-vlm expects `--model` to point at a *directory* containing
    // `config.json`, `tokenizer.json`, and the safetensors shards
    // (cf. `mlx_vlm/utils.load_config`). The legacy dflash server
    // accepted the safetensors file path directly and walked up to its
    // parent on its own, so historic `model.yml` entries persist as
    // e.g. `mlx/models/<id>/model.safetensors`. Normalize to the
    // containing directory here, on the boundary, instead of touching
    // every TS caller and breaking imported-model metadata.
    let model_dir_path = if model_path_pb.is_file() {
        model_path_pb
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| model_path_pb.clone())
    } else {
        model_path_pb.clone()
    };
    let model_dir_arg = model_dir_path.to_string_lossy().to_string();
    if model_dir_arg != model_path {
        log::info!(
            "Resolving MLX model directory: {} -> {}",
            model_path,
            model_dir_arg
        );
    }

    // Build command arguments for `mlx_vlm.server` (Atomic-Chat fork at
    // AtomicBot-ai/mlx-vlm). The server binds to loopback only and runs
    // without any auth layer — there is no equivalent of `MLX_API_KEY`
    // upstream, so we drop it entirely and rely on the host filter.
    //
    // Config-key translation (TS-side names → mlx-vlm CLI flags):
    //   * `ctx_size`   → `--max-kv-size`
    //   * `block_size` → `--draft-block-size`
    //   * `draft_model_path` non-empty → `--draft-model ... --draft-kind <kind>`
    //   * `draft_kind` selects between mlx-vlm's two drafter families
    //     ("dflash" or "mtp"); empty string falls back to "dflash" so
    //     legacy callers (and stale persisted configs) keep working.
    // Keeping the TS-side names stable avoids churning the extension /
    // settings.json schema and the autoIncreaseCtx test suite.
    let mut args: Vec<String> = vec![
        "--model".to_string(),
        model_dir_arg,
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ];

    if config.ctx_size > 0 {
        args.push("--max-kv-size".to_string());
        args.push(config.ctx_size.to_string());
    }

    if !config.draft_model_path.is_empty() {
        // Same file-vs-directory normalization as the target model: if the
        // drafter path points at a safetensors shard, hand mlx-vlm the
        // containing directory. HF repo IDs (e.g. `z-lab/Qwen3.5-4B-DFlash`)
        // are not local paths and pass through untouched.
        let draft_pb = PathBuf::from(&config.draft_model_path);
        let draft_arg = if draft_pb.is_file() {
            draft_pb
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| config.draft_model_path.clone())
        } else {
            config.draft_model_path.clone()
        };
        args.push("--draft-model".to_string());
        args.push(draft_arg);
        // Drafter family is selected by the frontend; default to "dflash"
        // for empty/legacy configs so behavior is unchanged for callers
        // that don't yet set `draft_kind`.
        let kind = if config.draft_kind.is_empty() {
            "dflash"
        } else {
            config.draft_kind.as_str()
        };
        args.push("--draft-kind".to_string());
        args.push(kind.to_string());
    }

    if config.block_size > 0 {
        args.push("--draft-block-size".to_string());
        args.push(config.block_size.to_string());
    }

    log::info!("MLX server arguments: {:?}", args);

    // Configure the command
    let mut command = Command::new(&bin_path);
    command.args(&args);
    command.envs(envs);
    // Tell our mlx-vlm fork to lock onto the preloaded model and ignore
    // arbitrary `model` labels in incoming chat-completion bodies. Without
    // this the server would unload + try to fetch the requested label from
    // HF (e.g. `gemma-4-e4b-it-4bit`), which 401s for non-existent repos.
    // See `mlx_vlm/server.py::get_cached_model` (Atomic-Chat fork patch).
    command.env("MLX_VLM_SINGLE_MODEL", "1");
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
                    // Recognise readiness logs from both the legacy dflash
                    // server (Starlette) and the new mlx-vlm server (FastAPI
                    // + uvicorn). Uvicorn writes "Uvicorn running on ..."
                    // once the lifespan startup has completed.
                    if line_lower.contains("uvicorn running on")
                        || line_lower.contains("application startup complete")
                        || line_lower.contains("http server listening")
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
                        // Same dual-format recognition as on stdout — uvicorn
                        // prints its readiness message on stderr by default.
                        if line_lower.contains("uvicorn running on")
                            || line_lower.contains("application startup complete")
                            || line_lower.contains("server is listening")
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
    // `api_key` is retained on `SessionInfo` for ABI compatibility with TS
    // consumers (always empty — mlx-vlm has no auth layer).
    //
    // `model_path` is exposed as the *directory* that was passed to
    // `--model`. Clients use this string as the OpenAI `model` field in
    // outgoing chat-completion requests so mlx-vlm's path-based cache
    // (`get_cached_model`) matches and skips the unload+reload+HF fetch
    // dance for legacy `model_id`-style request bodies.
    let session_info = SessionInfo {
        pid,
        port: port.into(),
        model_id,
        model_path: model_dir_path.display().to_string(),
        is_embedding,
        api_key: String::new(),
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

#[derive(serde::Serialize)]
pub struct MlxServerVersion {
    pub version: String,
    pub backend: String,
}

#[tauri::command]
pub fn get_mlx_server_version<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<MlxServerVersion, String> {
    let res_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    let bin_dir = res_dir.join("resources/bin");

    let version = std::fs::read_to_string(bin_dir.join("mlx-server-version.txt"))
        .unwrap_or_default()
        .trim()
        .to_string();

    let backend = std::fs::read_to_string(bin_dir.join("mlx-server-backend.txt"))
        .unwrap_or_else(|_| "macos-arm64".to_string())
        .trim()
        .to_string();

    Ok(MlxServerVersion { version, backend })
}
