use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use sysinfo::{Pid, System};
use tauri::{Manager, Runtime, State};
use thiserror;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant};

use crate::state::{LLamaBackendSession, LlamacppState, SessionInfo};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BinaryNotFound,
    ModelFileNotFound,
    LibraryPathInvalid,

    // --- Model Loading Errors ---
    ModelLoadFailed,
    DraftModelLoadFailed,
    MultimodalProjectorLoadFailed,
    ModelArchNotSupported,
    ModelLoadTimedOut,
    LlamaCppProcessError,

    // --- Memory Errors ---
    OutOfMemory,

    // --- Internal Application Errors ---
    DeviceListParseFailed,
    IoError,
    InternalError,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("LlamacppError {{ code: {code:?}, message: \"{message}\" }}")]
pub struct LlamacppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl LlamacppError {
    pub fn new(code: ErrorCode, message: String, details: Option<String>) -> Self {
        Self {
            code,
            message,
            details,
        }
    }

    /// Parses stderr from llama.cpp and creates a specific LlamacppError.
    pub fn from_stderr(stderr: &str) -> Self {
        let lower_stderr = stderr.to_lowercase();
        // TODO: add others
        let is_out_of_memory = lower_stderr.contains("out of memory")
            || lower_stderr.contains("insufficient memory")
            || lower_stderr.contains("erroroutofdevicememory") // vulkan specific
            || lower_stderr.contains("kiogpucommandbuffercallbackerroroutofmemory") // Metal-specific error code
            || lower_stderr.contains("cuda_error_out_of_memory"); // CUDA-specific

        if is_out_of_memory {
            return Self::new(
                ErrorCode::OutOfMemory,
                "Out of memory. The model requires more RAM or VRAM than available.".into(),
                Some(stderr.into()),
            );
        }

        if lower_stderr.contains("error loading model architecture") {
            return Self::new(
                ErrorCode::ModelArchNotSupported,
                "The model's architecture is not supported by this version of the backend.".into(),
                Some(stderr.into()),
            );
        }
        Self::new(
            ErrorCode::LlamaCppProcessError,
            "The model process encountered an unexpected error.".into(),
            Some(stderr.into()),
        )
    }
}

// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    Llamacpp(#[from] LlamacppError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
}

// impl serialization for tauri
impl serde::Serialize for ServerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let error_to_serialize: LlamacppError = match self {
            ServerError::Llamacpp(err) => err.clone(),
            ServerError::Io(e) => LlamacppError::new(
                ErrorCode::IoError,
                "An input/output error occurred.".into(),
                Some(e.to_string()),
            ),
            ServerError::Tauri(e) => LlamacppError::new(
                ErrorCode::InternalError,
                "An internal application error occurred.".into(),
                Some(e.to_string()),
            ),
        };
        error_to_serialize.serialize(serializer)
    }
}

type ServerResult<T> = Result<T, ServerError>;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub mem: i32,
    pub free: i32,
}

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use std::ffi::OsStr;

#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

#[cfg(windows)]
pub fn get_short_path<P: AsRef<std::path::Path>>(path: P) -> Option<String> {
    let wide: Vec<u16> = OsStr::new(path.as_ref())
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut buffer = vec![0u16; 260];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };

    if len > 0 {
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    } else {
        None
    }
}

// --- Load Command ---
#[tauri::command]
pub async fn load_llama_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    backend_path: &str,
    library_path: Option<&str>,
    mut args: Vec<String>,
) -> ServerResult<SessionInfo> {
    let state: State<LlamacppState> = app_handle.state();
    let mut process_map = state.llama_server_process.lock().await;

    log::info!("Attempting to launch server at path: {:?}", backend_path);
    log::info!("Using arguments: {:?}", args);

    let server_path_buf = PathBuf::from(backend_path);
    if !server_path_buf.exists() {
        let err_msg = format!("Binary not found at {:?}", backend_path);
        log::error!(
            "Server binary not found at expected path: {:?}",
            backend_path
        );
        return Err(LlamacppError::new(
            ErrorCode::BinaryNotFound,
            "The llama.cpp server binary could not be found.".into(),
            Some(err_msg),
        )
        .into());
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
    // FOR MODEL PATH; TODO: DO SIMILARLY FOR MMPROJ PATH
    let model_path_index = args.iter().position(|arg| arg == "-m").ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            "Model path argument '-m' is missing.".into(),
            None,
        )
    })?;

    let model_path = args.get(model_path_index + 1).cloned().ok_or_else(|| {
        LlamacppError::new(
            ErrorCode::ModelLoadFailed,
            "Model path was not provided after '-m' flag.".into(),
            None,
        )
    })?;

    let model_path_pb = PathBuf::from(&model_path);
    if !model_path_pb.exists() {
        let err_msg = format!(
            "Invalid or inaccessible model path: {}",
            model_path_pb.display()
        );
        log::error!("{}", &err_msg);
        return Err(LlamacppError::new(
            ErrorCode::ModelFileNotFound,
            "The specified model file does not exist or is not accessible.".into(),
            Some(err_msg),
        )
        .into());
    }
    #[cfg(windows)]
    {
        // use short path on Windows
        if let Some(short) = get_short_path(&model_path_pb) {
            args[model_path_index + 1] = short;
        } else {
            args[model_path_index + 1] = model_path_pb.display().to_string();
        }
    }
    #[cfg(not(windows))]
    {
        args[model_path_index + 1] = model_path_pb.display().to_string();
    }
    // -----------------------------------------------------------------

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

            // Normalize the path by removing UNC prefix if present
            let normalized_path = lib_path.trim_start_matches(r"\\?\").to_string();
            log::info!("Library path:\n{}", &normalized_path);

            // Only set current_dir if the normalized path exists and is a directory
            let path = std::path::Path::new(&normalized_path);
            if path.exists() && path.is_dir() {
                command.current_dir(&normalized_path);
            } else {
                log::warn!(
                    "Library path '{}' does not exist or is not a directory",
                    normalized_path
                );
            }
        } else {
            log::warn!("Library path setting is not supported on this OS");
        }
    }
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    // Spawn the child process
    let mut child = command.spawn().map_err(ServerError::Io)?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout = child.stdout.take().expect("stdout was piped");

    // Create channels for communication between tasks
    let (ready_tx, mut ready_rx) = mpsc::channel::<bool>(1);

    // Spawn task to monitor stdout for readiness
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

                        // Check for critical error indicators that should stop the process
                        let line_lower = line.to_string().to_lowercase();
                        // Check for readiness indicator - llama-server outputs this when ready
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
    let timeout_duration = Duration::from_secs(180); // 3 minutes timeout
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
        port: port,
        model_id: model_id,
        model_path: model_path_pb.display().to_string(),
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
            if let Some(raw_pid) = child.id() {
                log::warn!(
                    "gracefully killing is unsupported on Windows, force-killing PID {}",
                    raw_pid
                );

                // Since we know a graceful shutdown doesn't work and there are no child processes
                // to worry about, we can use `child.kill()` directly. On Windows, this is
                // a forceful termination via the `TerminateProcess` API.
                if let Err(e) = child.kill().await {
                    log::error!(
                        "Failed to send kill signal to PID {}: {}. It may have already terminated.",
                        raw_pid,
                        e
                    );
                }

                match child.wait().await {
                    Ok(status) => log::info!(
                        "process {} has been terminated. Final exit status: {}",
                        raw_pid,
                        status
                    ),
                    Err(e) => log::error!(
                        "Error waiting on child process {} after kill: {}",
                        raw_pid,
                        e
                    ),
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

#[tauri::command]
pub async fn get_devices(
    backend_path: &str,
    library_path: Option<&str>,
) -> ServerResult<Vec<DeviceInfo>> {
    log::info!("Getting devices from server at path: {:?}", backend_path);

    let server_path_buf = PathBuf::from(backend_path);
    if !server_path_buf.exists() {
        log::error!(
            "Server binary not found at expected path: {:?}",
            backend_path
        );
        return Err(LlamacppError::new(
            ErrorCode::BinaryNotFound,
            "The llama.cpp server binary could not be found.".into(),
            Some(format!("Path: {}", backend_path)),
        )
        .into());
    }

    // Configure the command to run the server with --list-devices
    let mut command = Command::new(backend_path);
    command.arg("--list-devices");

    // Set up library path similar to load function
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

            // Normalize the path by removing UNC prefix if present
            let normalized_path = lib_path.trim_start_matches(r"\\?\").to_string();
            log::info!("Library path:\n{}", &normalized_path);

            // Only set current_dir if the normalized path exists and is a directory
            let path = std::path::Path::new(&normalized_path);
            if path.exists() && path.is_dir() {
                command.current_dir(&normalized_path);
            } else {
                log::warn!(
                    "Library path '{}' does not exist or is not a directory",
                    normalized_path
                );
            }
        } else {
            log::warn!("Library path setting is not supported on this OS");
        }
    }

    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    // Execute the command and wait for completion
    let output = timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| {
            LlamacppError::new(
                ErrorCode::InternalError,
                "Timeout waiting for device list".into(),
                None,
            )
        })?
        .map_err(ServerError::Io)?;

    // Check if command executed successfully
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("llama-server --list-devices failed: {}", stderr);
        return Err(LlamacppError::from_stderr(&stderr).into());
    }
    // Parse the output
    let stdout = String::from_utf8_lossy(&output.stdout);
    log::info!("Device list output:\n{}", stdout);

    parse_device_output(&stdout)
}

// Include all the parsing functions from the original...
fn parse_device_output(output: &str) -> ServerResult<Vec<DeviceInfo>> {
    let mut devices = Vec::new();
    let mut found_devices_section = false;

    for raw in output.lines() {
        // detect header (ignoring whitespace)
        if raw.trim() == "Available devices:" {
            found_devices_section = true;
            continue;
        }

        if !found_devices_section {
            continue;
        }

        // skip blank lines
        if raw.trim().is_empty() {
            continue;
        }

        // now parse any non-blank line after the header
        let line = raw.trim();
        if let Some(device) = parse_device_line(line)? {
            devices.push(device);
        }
    }

    if devices.is_empty() && found_devices_section {
        log::warn!("No devices found in output");
    } else if !found_devices_section {
        return Err(LlamacppError::new(
            ErrorCode::DeviceListParseFailed,
            "Could not find 'Available devices:' section in the backend output.".into(),
            Some(output.to_string()),
        )
        .into());
    }

    Ok(devices)
}

fn parse_device_line(line: &str) -> ServerResult<Option<DeviceInfo>> {
    let line = line.trim();

    log::info!("Parsing device line: '{}'", line);

    // Expected formats:
    // "Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)"
    // "CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)"
    // "SYCL0: Intel(R) Arc(TM) A750 Graphics (8000 MiB, 7721 MiB free)"

    // Split by colon to get ID and rest
    let parts: Vec<&str> = line.splitn(2, ':').collect();
    if parts.len() != 2 {
        log::warn!("Skipping malformed device line: {}", line);
        return Ok(None);
    }

    let id = parts[0].trim().to_string();
    let rest = parts[1].trim();

    // Use regex-like approach to find the memory pattern at the end
    // Look for pattern: (number MiB, number MiB free) at the end
    if let Some(memory_match) = find_memory_pattern(rest) {
        let (memory_start, memory_content) = memory_match;
        let name = rest[..memory_start].trim().to_string();

        // Parse memory info: "8128 MiB, 8128 MiB free"
        let memory_parts: Vec<&str> = memory_content.split(',').collect();
        if memory_parts.len() >= 2 {
            if let (Ok(total_mem), Ok(free_mem)) = (
                parse_memory_value(memory_parts[0].trim()),
                parse_memory_value(memory_parts[1].trim()),
            ) {
                log::info!(
                    "Parsed device - ID: '{}', Name: '{}', Mem: {}, Free: {}",
                    id,
                    name,
                    total_mem,
                    free_mem
                );

                return Ok(Some(DeviceInfo {
                    id,
                    name,
                    mem: total_mem,
                    free: free_mem,
                }));
            }
        }
    }

    log::warn!("Could not parse device line: {}", line);
    Ok(None)
}

fn find_memory_pattern(text: &str) -> Option<(usize, &str)> {
    // Find the last parenthesis that contains the memory pattern
    let mut last_match = None;
    let mut chars = text.char_indices().peekable();

    while let Some((start_idx, ch)) = chars.next() {
        if ch == '(' {
            // Find the closing parenthesis
            let remaining = &text[start_idx + 1..];
            if let Some(close_pos) = remaining.find(')') {
                let content = &remaining[..close_pos];

                // Check if this looks like memory info
                if is_memory_pattern(content) {
                    last_match = Some((start_idx, content));
                }
            }
        }
    }

    last_match
}

fn is_memory_pattern(content: &str) -> bool {
    // Check if content matches pattern like "8128 MiB, 8128 MiB free"
    // Must contain: numbers, "MiB", comma, "free"
    if !(content.contains("MiB") && content.contains("free") && content.contains(',')) {
        return false;
    }

    let parts: Vec<&str> = content.split(',').collect();
    if parts.len() != 2 {
        return false;
    }

    parts.iter().all(|part| {
        let part = part.trim();
        // Each part should start with a number and contain "MiB"
        part.split_whitespace()
            .next()
            .map_or(false, |first_word| first_word.parse::<i32>().is_ok())
            && part.contains("MiB")
    })
}

fn parse_memory_value(mem_str: &str) -> ServerResult<i32> {
    // Handle formats like "8000 MiB" or "7721 MiB free"
    let parts: Vec<&str> = mem_str.split_whitespace().collect();
    if parts.is_empty() {
        return Err(LlamacppError::new(
            ErrorCode::DeviceListParseFailed,
            format!("empty memory value: {}", mem_str),
            None,
        )
        .into());
    }

    // Take the first part which should be the number
    let number_str = parts[0];
    number_str.parse::<i32>().map_err(|_| {
        LlamacppError::new(
            ErrorCode::DeviceListParseFailed,
            format!("Could not parse memory value: '{}'", number_str),
            None,
        )
        .into()
    })
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
pub async fn is_process_running<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let process_pid = Pid::from(pid as usize);
    let alive = system.process(process_pid).is_some();

    if !alive {
        let state: State<LlamacppState> = app_handle.state();
        let mut map = state.llama_server_process.lock().await;
        map.remove(&pid);
    }

    Ok(alive)
}

// check port availability
fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[tauri::command]
pub async fn get_random_port<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<u16, String> {
    const MAX_ATTEMPTS: u32 = 20000;
    let mut attempts = 0;
    let mut rng = StdRng::from_entropy();

    // Get all active ports from sessions
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;

    let used_ports: HashSet<u16> = map
        .values()
        .filter_map(|session| {
            // Convert valid ports to u16 (filter out placeholder ports like -1)
            if session.info.port > 0 && session.info.port <= u16::MAX as i32 {
                Some(session.info.port as u16)
            } else {
                None
            }
        })
        .collect();

    drop(map); // unlock early

    while attempts < MAX_ATTEMPTS {
        let port = rng.gen_range(3000..4000);

        if used_ports.contains(&port) {
            attempts += 1;
            continue;
        }

        if is_port_available(port) {
            return Ok(port);
        }

        attempts += 1;
    }

    Err("Failed to find an available port for the model to load".into())
}

// find session
#[tauri::command]
pub async fn find_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;

    let session_info = map
        .values()
        .find(|backend_session| backend_session.info.model_id == model_id)
        .map(|backend_session| backend_session.info.clone());

    Ok(session_info)
}

// get running models
#[tauri::command]
pub async fn get_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;

    let model_ids = map
        .values()
        .map(|backend_session| backend_session.info.model_id.clone())
        .collect();

    Ok(model_ids)
}

#[tauri::command]
pub async fn get_all_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;
    let sessions: Vec<SessionInfo> = map.values().map(|s| s.info.clone()).collect();
    Ok(sessions)
}

#[tauri::command]
pub async fn get_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;
    let session = map
        .values()
        .find(|s| s.info.model_id == model_id)
        .map(|s| s.info.clone());
    Ok(session)
}
