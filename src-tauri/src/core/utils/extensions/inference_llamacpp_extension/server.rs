use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State; // Import Manager trait
use thiserror;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant};

use crate::core::state::AppState;
use crate::core::state::LLamaBackendSession;

type HmacSha256 = Hmac<Sha256>;
// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("llamacpp error: {0}")]
    LlamacppError(String),
    #[error("Failed to locate server binary: {0}")]
    BinaryNotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Jan API error: {0}")]
    Tauri(#[from] tauri::Error),
}

// impl serialization for tauri
impl serde::Serialize for ServerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

type ServerResult<T> = Result<T, ServerError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,  // opaque handle for unload/chat
    pub port: i32, // llama-server output port
    pub model_id: String,
    pub model_path: String, // path of the loaded model
    pub api_key: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

// --- Load Command ---
#[tauri::command]
pub async fn load_llama_model(
    state: State<'_, AppState>,
    backend_path: &str,
    library_path: Option<&str>,
    args: Vec<String>,
) -> ServerResult<SessionInfo> {
    let mut process_map = state.llama_server_process.lock().await;

    log::info!("Attempting to launch server at path: {:?}", backend_path);
    log::info!("Using arguments: {:?}", args);

    let server_path_buf = PathBuf::from(backend_path);
    if !server_path_buf.exists() {
        log::error!(
            "Server binary not found at expected path: {:?}",
            backend_path
        );
        return Err(ServerError::BinaryNotFound(format!(
            "Binary not found at {:?}",
            backend_path
        )));
    }

    let port_str = args
        .iter()
        .position(|arg| arg == "--port")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();
    let port: i32 = match port_str.parse() {
        Ok(p) => p,
        Err(_) => {
            eprintln!("Invalid port value: '{}', using default 8080", port_str);
            8080
        }
    };

    let model_path = args
        .iter()
        .position(|arg| arg == "-m")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    let api_key = args
        .iter()
        .position(|arg| arg == "--api-key")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    let model_id = args
        .iter()
        .position(|arg| arg == "-a")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    // Configure the command to run the server
    let mut command = Command::new(backend_path);
    command.args(args);

    if let Some(lib_path) = library_path {
        if cfg!(target_os = "linux") {
            let new_lib_path = match std::env::var("LD_LIBRARY_PATH") {
                Ok(path) => format!("{}:{}", path, lib_path),
                Err(_) => lib_path.to_string(),
            };
            command.env("LD_LIBRARY_PATH", new_lib_path);
        } else if cfg!(target_os = "windows") {
            let new_path = match std::env::var("PATH") {
                Ok(path) => format!("{};{}", path, lib_path),
                Err(_) => lib_path.to_string(),
            };
            command.env("PATH", new_path);
        } else {
            log::warn!("Library path setting is not supported on this OS");
        }
    }

    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    // Spawn the child process
    let mut child = command.spawn().map_err(ServerError::Io)?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout = child.stdout.take().expect("stdout was piped");

    // Create channels for communication between tasks
    let (ready_tx, mut ready_rx) = mpsc::channel::<bool>(1);
    let (error_tx, mut error_rx) = mpsc::channel::<String>(1);

    // Spawn task to monitor stdout for readiness
    let _stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            log::info!("[llamacpp stdout] {}", line);
        }
    });

    // Spawn task to capture stderr and monitor for errors
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut stderr_buffer = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            log::info!("[llamacpp] {}", line); // Using your log format
            stderr_buffer.push_str(&line);
            stderr_buffer.push('\n');
            // Check for critical error indicators that should stop the process
            // TODO: check for different errors
            if line.to_lowercase().contains("error")
                || line.to_lowercase().contains("failed")
                || line.to_lowercase().contains("fatal")
                || line.contains("CUDA error")
                || line.contains("out of memory")
                || line.contains("failed to load")
            {
                let _ = error_tx.send(line.clone()).await;
            }
            // Check for readiness indicator - llama-server outputs this when ready
            else if line.contains("server is listening on")
                || line.contains("starting the main loop")
                || line.contains("server listening on")
            {
                log::info!("Server appears to be ready based on stdout: '{}'", line);
                let _ = ready_tx.send(true).await;
            }
        }
        stderr_buffer
    });

    // Check if process exited early
    if let Some(status) = child.try_wait()? {
        if !status.success() {
            let stderr_output = stderr_task.await.unwrap_or_default();
            log::error!("llama.cpp exited early with code {status:?}");
            log::error!("--- stderr ---\n{}", stderr_output);
            return Err(ServerError::LlamacppError(stderr_output.trim().to_string()));
        }
    }

    // Wait for server to be ready or timeout
    let timeout_duration = Duration::from_secs(300); // 5 minutes timeout
    let start_time = Instant::now();
    log::info!("Waiting for server to be ready...");
    loop {
        tokio::select! {
            // Server is ready
            Some(true) = ready_rx.recv() => {
                log::info!("Server is ready to accept requests!");
                break;
            }
            // Error occurred
            Some(error_msg) = error_rx.recv() => {
                log::error!("Server encountered an error: {}", error_msg);
                let _ = child.kill().await;
                // Get full stderr output
                let stderr_output = stderr_task.await.unwrap_or_default();
                return Err(ServerError::LlamacppError(format!("Error: {}\n\nFull stderr:\n{}", error_msg, stderr_output)));
            }
            // Timeout
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for server to be ready");
                    let _ = child.kill().await;
                    return Err(ServerError::LlamacppError("Server startup timeout".to_string()));
                }
                // Check if process is still alive
                if let Some(status) = child.try_wait()? {
                    if !status.success() {
                        let stderr_output = stderr_task.await.unwrap_or_default();
                        log::error!("llama.cpp exited during startup with code {status:?}");
                        return Err(ServerError::LlamacppError(format!("Process exited with code {status:?}\n\nStderr:\n{}", stderr_output)));
                    }
                }
            }
        }
    }

    // Get the PID to use as session ID
    let pid = child.id().map(|id| id as i32).unwrap_or(-1);

    log::info!("Server process started with PID: {} and is ready", pid);
    let session_info = SessionInfo {
        pid: pid.clone(),
        port: port,
        model_id: model_id,
        model_path: model_path,
        api_key: api_key,
    };

    // Insert session info to process_map
    process_map.insert(
        pid.clone(),
        LLamaBackendSession {
            child,
            info: session_info.clone(),
        },
    );

    Ok(session_info)
}

// --- Unload Command ---
#[tauri::command]
pub async fn unload_llama_model(
    pid: i32,
    state: State<'_, AppState>,
) -> ServerResult<UnloadResult> {
    let mut map = state.llama_server_process.lock().await;
    if let Some(session) = map.remove(&pid) {
        let mut child = session.child;
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;

            if let Some(raw_pid) = child.id() {
                let raw_pid = raw_pid as i32;
                log::info!("Sending SIGTERM to PID {}", raw_pid);
                let _ = kill(Pid::from_raw(raw_pid), Signal::SIGTERM);

                match timeout(Duration::from_secs(5), child.wait()).await {
                    Ok(Ok(status)) => log::info!("Process exited gracefully: {}", status),
                    Ok(Err(e)) => log::error!("Error waiting after SIGTERM: {}", e),
                    Err(_) => {
                        log::warn!("SIGTERM timed out; sending SIGKILL to PID {}", raw_pid);
                        let _ = kill(Pid::from_raw(raw_pid), Signal::SIGKILL);
                        match child.wait().await {
                            Ok(s) => log::info!("Force-killed process exited: {}", s),
                            Err(e) => log::error!("Error waiting after SIGKILL: {}", e),
                        }
                    }
                }
            }
        }

        #[cfg(all(windows, target_arch = "x86_64"))]
        {
            use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_C_EVENT};

            if let Some(raw_pid) = child.id() {
                log::info!("Sending Ctrl-C to PID {}", raw_pid);
                let ok: i32 = unsafe { GenerateConsoleCtrlEvent(CTRL_C_EVENT, raw_pid as u32) };
                if ok == 0 {
                    log::error!("Failed to send Ctrl-C to PID {}", raw_pid);
                }

                match timeout(Duration::from_secs(5), child.wait()).await {
                    Ok(Ok(status)) => log::info!("Process exited after Ctrl-C: {}", status),
                    Ok(Err(e)) => log::error!("Error waiting after Ctrl-C: {}", e),
                    Err(_) => {
                        log::warn!("Timed out; force-killing PID {}", raw_pid);
                        if let Err(e) = child.kill().await {
                            log::error!("Failed to kill process {}: {}", raw_pid, e);
                            return Ok(UnloadResult {
                                success: false,
                                error: Some(format!("kill failed: {}", e)),
                            });
                        }
                        if let Ok(s) = child.wait().await {
                            log::info!("Process finally exited: {}", s);
                        }
                    }
                }
            }
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

// crypto
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

// process aliveness check
#[tauri::command]
pub async fn is_process_running(pid: i32, state: State<'_, AppState>) -> Result<bool, String> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let process_pid = Pid::from(pid as usize);
    let alive = system.process(process_pid).is_some();

    if !alive {
        let mut map = state.llama_server_process.lock().await;
        map.remove(&pid);
    }

    Ok(alive)
}
