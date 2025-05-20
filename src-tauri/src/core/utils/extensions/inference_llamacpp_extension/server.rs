use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State}; // Import Manager trait
use tokio::process::Command;
use uuid::Uuid;
use thiserror;

use crate::core::state::AppState;

// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("Server is already running")]
    AlreadyRunning,
  //  #[error("Server is not running")]
  //  NotRunning,
    #[error("Failed to locate server binary: {0}")]
    BinaryNotFound(String),
    #[error("Failed to determine resource path: {0}")]
    ResourcePathError(String),
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

// --- Helper function to find the server binary ---
// -- TODO: Adjust extension engine paths
// engine: static llama-server build (CUDA, VULKAN, SYCL, etc)
fn get_server_path(app_handle: &AppHandle) -> ServerResult<PathBuf> {
    let binary_name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let relative_path = PathBuf::from("engines").join(binary_name); // TODO: ADJUST THIS PATH

    app_handle
        .path()
        .resolve(relative_path, BaseDirectory::Resource)
        .map_err(|e| ServerError::ResourcePathError(e.to_string()))
    // .ok_or_else(|| {
    //     ServerError::BinaryNotFound(format!(
    //         "Could not resolve resource path for '{}'",
    //         if cfg!(windows) {
    //             "engines/llama-server.exe"
    //         } else {
    //             "engines/llama-server"
    //         } // TODO: ADJUST THIS PATH
    //     ))
    // })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,       // opaque handle for unload/chat
    pub port: u16,                // llama-server output port
    pub model_path: String,       // path of the loaded model
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

// --- Load Command ---
#[tauri::command]
pub async fn load_llama_model(
    app_handle: AppHandle,      // Get the AppHandle
    state: State<'_, AppState>, // Access the shared state
    args: Vec<String>,          // Arguments from the frontend
) -> ServerResult<SessionInfo> {
    let mut process_lock = state.llama_server_process.lock().await;

    if process_lock.is_some() {
        log::warn!("Attempted to load server, but it's already running.");
        return Err(ServerError::AlreadyRunning);
    }

    let server_path = get_server_path(&app_handle)?;
    log::info!("Attempting to launch server at path: {:?}", server_path);
    log::info!("Using arguments: {:?}", args);

    if !server_path.exists() {
        log::error!(
            "Server binary not found at expected path: {:?}",
            server_path
        );
        return Err(ServerError::BinaryNotFound(format!(
            "Binary not found at {:?}",
            server_path
        )));
    }

    let port = 8080; // Default port

    // Configure the command to run the server
    let mut command = Command::new(server_path);

    let model_path = args[0].replace("-m", "");
    command.args(args);

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
    *process_lock = Some(child);

    let session_info = SessionInfo {
        session_id: pid,  // Use PID as session ID
        port,
        model_path,
    };

    Ok(session_info)
}

// --- Unload Command ---
#[tauri::command]
pub async fn unload_llama_model(session_id: String, state: State<'_, AppState>) -> ServerResult<UnloadResult> {
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

            return Ok(UnloadResult {
                success: false,
                error: Some(format!("Session ID mismatch: provided {} doesn't match process {}", 
                    session_id, process_pid)),
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

                Ok(UnloadResult {
                    success: true,
                    error: None,
                })
            }
            Err(e) => {
                log::error!("Failed to kill server process: {}", e);

                // Return formatted error
                Ok(UnloadResult {
                    success: false,
                    error: Some(format!("Failed to kill server process: {}", e)),
                })
            }
        }
    } else {
        log::warn!("Attempted to unload server, but no process was running");

        // If no process is running but client thinks there is, 
        // still report success since the end state is what they wanted
        Ok(UnloadResult {
            success: true,
            error: None,
        })
    }
}

