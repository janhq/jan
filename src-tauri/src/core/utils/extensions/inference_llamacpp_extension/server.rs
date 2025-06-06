use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use tauri::State; // Import Manager trait
use thiserror;
use tokio::process::Command;
use uuid::Uuid;

use crate::core::state::AppState;

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

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: String,  // opaque handle for unload/chat
    pub port: String, // llama-server output port
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

    let port = args
        .iter()
        .position(|arg| arg == "--port")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

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

    // Spawn the child process
    let child = command.spawn().map_err(ServerError::Io)?;

    // Get the PID to use as session ID
    let pid = child.id().map(|id| id.to_string()).unwrap_or_else(|| {
        // Fallback in case we can't get the PID for some reason
        format!("unknown_pid_{}", Uuid::new_v4())
    });

    log::info!("Server process started with PID: {}", pid);

    // Store the child process handle in the state
    process_map.insert(pid.clone(), child);

    let session_info = SessionInfo {
        pid: pid,
        port: port,
        model_id: model_id,
        model_path: model_path,
        api_key: api_key,
    };

    Ok(session_info)
}

// --- Unload Command ---
#[tauri::command]
pub async fn unload_llama_model(
    pid: String,
    state: State<'_, AppState>,
) -> ServerResult<UnloadResult> {
    let mut process_map = state.llama_server_process.lock().await;
     match process_map.remove(&pid) {
        Some(mut child) => {
            log::info!("Attempting to terminate server process with PID: {}", pid);

            match child.start_kill() {
                Ok(_) => {
                    log::info!("Server process termination signal sent successfully");

                    Ok(UnloadResult {
                        success: true,
                        error: None,
                    })
                }
                Err(e) => {
                    log::error!("Failed to kill server process: {}", e);

                    Ok(UnloadResult {
                        success: false,
                        error: Some(format!("Failed to kill server process: {}", e)),
                    })
                }
            }
        }
        None => {
            log::warn!(
                "Attempted to unload server with PID '{}', but no such process exists",
                pid
            );

            Ok(UnloadResult {
                success: true,
                error: None,
            })
        }
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
