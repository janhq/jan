use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use tauri::{AppHandle, State}; // Import Manager trait
use thiserror;
use tokio::process::Command;
use uuid::Uuid;

use crate::core::state::AppState;

type HmacSha256 = Hmac<Sha256>;
// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum serverError {
    #[error("Server is already running")]
    AlreadyRunning,
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
impl serde::Serialize for serverError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

type ServerResult<T> = Result<T, serverError>;

#[derive(Debug, Serialize, Deserialize)]
pub struct sessionInfo {
    pub pid: String, // opaque handle for unload/chat
    pub port: u16,   // llama-server output port
    pub modelId: String,
    pub modelPath: String, // path of the loaded model
    pub apiKey: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct unloadResult {
    success: bool,
    error: Option<String>,
}

// --- Load Command ---
#[tauri::command]
pub async fn load_llama_model(
    _app_handle: AppHandle,     // Get the AppHandle
    state: State<'_, AppState>, // Access the shared state
    backend_path: &str,
    args: Vec<String>, // Arguments from the frontend
) -> ServerResult<sessionInfo> {
    let mut process_lock = state.llama_server_process.lock().await;

    if process_lock.is_some() {
        log::warn!("Attempted to load server, but it's already running.");
        return Err(serverError::AlreadyRunning);
    }

    log::info!("Attempting to launch server at path: {:?}", backend_path);
    log::info!("Using arguments: {:?}", args);

    let server_path_buf = PathBuf::from(backend_path);
    if !server_path_buf.exists() {
        log::error!(
            "Server binary not found at expected path: {:?}",
            backend_path
        );
        return Err(serverError::BinaryNotFound(format!(
            "Binary not found at {:?}",
            backend_path
        )));
    }

    let port = 8080; // Default port
    let modelPath = args
        .iter()
        .position(|arg| arg == "-m")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    let apiKey = args
        .iter()
        .position(|arg| arg == "--api-key")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    let modelId = args
        .iter()
        .position(|arg| arg == "-a")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    // Configure the command to run the server
    let mut command = Command::new(backend_path);
    command.args(args);

    // Optional: Redirect stdio if needed (e.g., for logging within Jan)
    // command.stdout(Stdio::piped());
    // command.stderr(Stdio::piped());

    // Spawn the child process
    let child = command.spawn().map_err(serverError::Io)?;

    // Get the PID to use as session ID
    let pid = child.id().map(|id| id.to_string()).unwrap_or_else(|| {
        // Fallback in case we can't get the PID for some reason
        format!("unknown_pid_{}", Uuid::new_v4())
    });

    log::info!("Server process started with PID: {}", pid);

    // Store the child process handle in the state
    *process_lock = Some(child);

    let session_info = sessionInfo {
        pid,
        port,
        modelId,
        modelPath,
        apiKey,
    };

    Ok(session_info)
}

// --- Unload Command ---
#[tauri::command]
pub async fn unload_llama_model(
    session_id: String,
    state: State<'_, AppState>,
) -> ServerResult<unloadResult> {
    let mut process_lock = state.llama_server_process.lock().await;
    // Take the child process out of the Option, leaving None in its place
    if let Some(mut child) = process_lock.take() {
        // Convert the PID to a string to compare with the session_id
        let process_pid = child.id().map(|pid| pid.to_string()).unwrap_or_default();

        // Check if the session_id matches the PID
        if session_id != process_pid && !session_id.is_empty() && !process_pid.is_empty() {
            // Put the process back in the lock since we're not killing it
            *process_lock = Some(child);

            log::warn!(
                "Session ID mismatch: provided {} vs process {}",
                session_id,
                process_pid
            );

            return Ok(unloadResult {
                success: false,
                error: Some(format!(
                    "Session ID mismatch: provided {} doesn't match process {}",
                    session_id, process_pid
                )),
            });
        }

        log::info!(
            "Attempting to terminate server process with PID: {:?}",
            child.id()
        );

        // Kill the process
        match child.start_kill() {
            Ok(_) => {
                log::info!("Server process termination signal sent successfully");

                Ok(unloadResult {
                    success: true,
                    error: None,
                })
            }
            Err(e) => {
                log::error!("Failed to kill server process: {}", e);

                // Return formatted error
                Ok(unloadResult {
                    success: false,
                    error: Some(format!("Failed to kill server process: {}", e)),
                })
            }
        }
    } else {
        log::warn!("Attempted to unload server, but no process was running");

        // If no process is running but client thinks there is,
        // still report success since the end state is what they wanted
        Ok(unloadResult {
            success: true,
            error: None,
        })
    }
}

// crypto
#[tauri::command]
pub fn generate_api_key(modelId: String, apiSecret: String) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(apiSecret.as_bytes())
        .map_err(|e| format!("Invalid key length: {}", e))?;
    mac.update(modelId.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    let hash = general_purpose::STANDARD.encode(code_bytes);
    Ok(hash)
}
