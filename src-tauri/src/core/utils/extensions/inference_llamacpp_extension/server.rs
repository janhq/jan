use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State; // Import Manager trait
use thiserror;
use tokio::process::Command;
use tokio::time::timeout;

use crate::core::state::AppState;
use crate::core::state::LLamaBackendSession;

type HmacSha256 = Hmac<Sha256>;
// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    // #[error("Server is already running")]
    // AlreadyRunning,
    //  #[error("Server is not running")]
    //  NotRunning,
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
    state: State<'_, AppState>, // Access the shared state
    backend_path: &str,
    library_path: Option<&str>,
    args: Vec<String>, // Arguments from the frontend
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

    // Optional: Redirect stdio if needed (e.g., for logging within Jan)
    // command.stdout(Stdio::piped());
    // command.stderr(Stdio::piped());
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    // Spawn the child process
    let child = command.spawn().map_err(ServerError::Io)?;

    // Get the PID to use as session ID
    let pid = child.id().map(|id| id as i32).unwrap_or(-1);

    log::info!("Server process started with PID: {}", pid);
    let session_info = SessionInfo {
        pid: pid.clone(),
        port: port,
        model_id: model_id,
        model_path: model_path,
        api_key: api_key,
    };

    // insert sesinfo to process_map
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

