use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State}; // Import Manager trait
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::state::AppState;

// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("Server is already running")]
    AlreadyRunning,
    #[error("Server is not running")]
    NotRunning,
    #[error("Failed to locate server binary: {0}")]
    BinaryNotFound(String),
    #[error("Failed to determine resource path: {0}")]
    ResourcePathError(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Jan API error: {0}")]
    Tauri(#[from] tauri::Error),
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
        .resolve_resource(relative_path)
        .map_err(|e| ServerError::ResourcePathError(e.to_string()))?
        .ok_or_else(|| {
            ServerError::BinaryNotFound(format!(
                "Could not resolve resource path for '{}'",
                if cfg!(windows) {
                    "engines/llama-server.exe"
                } else {
                    "engines/llama-server"
                } // TODO: ADJUST THIS PATH
            ))
        })
}

// --- Load Command ---
#[tauri::command]
pub async fn load(
    app_handle: AppHandle,            // Get the AppHandle
    state: State<'_, AppState>,       // Access the shared state
    args: Vec<String>,                // Arguments from the frontend
) -> ServerResult<()> {
    let mut process_lock = state.llama_server_process.lock().await;

    if process_lock.is_some() {
        log::warn!("Attempted to load server, but it's already running.");
        return Err(ServerError::AlreadyRunning);
    }

    let server_path = get_server_path(&app_handle)?;
    log::info!("Attempting to launch server at path: {:?}", server_path);
    log::info!("Using arguments: {:?}", args);

    if !server_path.exists() {
         log::error!("Server binary not found at expected path: {:?}", server_path);
         return Err(ServerError::BinaryNotFound(format!("Binary not found at {:?}", server_path)));
    }

    // Configure the command to run the server
    let mut command = Command::new(server_path);
    command.args(args);

    // Optional: Redirect stdio if needed (e.g., for logging within Jan)
    // command.stdout(Stdio::piped());
    // command.stderr(Stdio::piped());

    // Spawn the child process
    let child = command.spawn().map_err(ServerError::Io)?;

    log::info!("Server process started with PID: {:?}", child.id());

    // Store the child process handle in the state
    *process_lock = Some(child);

    Ok(())
}

// --- Unload Command ---
#[tauri::command]
pub async fn unload(state: State<'_, AppState>) -> ServerResult<()> {
    let mut process_lock = state.llama_server_process.lock().await;

    // Take the child process out of the Option, leaving None in its place
    if let Some(mut child) = process_lock.take() {
        log::info!(
            "Attempting to terminate server process with PID: {:?}",
            child.id()
        );
        // Kill the process
        // `start_kill` is preferred in async contexts
        match child.start_kill() {
            Ok(_) => {
                log::info!("Server process termination signal sent.");
                Ok(())
            }
            Err(e) => {
                // For simplicity, we log and return error.
                log::error!("Failed to kill server process: {}", e);
                // Put it back? Maybe not useful if kill failed.
                // *process_lock = Some(child);
                Err(ServerError::Io(e))
            }
        }
    } else {
        log::warn!("Attempted to unload server, but it was not running.");
        Ok(())
    }
}
