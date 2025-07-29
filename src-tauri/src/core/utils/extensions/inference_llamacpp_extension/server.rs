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
    #[error("Parse error: {0}")]
    ParseError(String),
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub mem: i32,
    pub free: i32,
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
        return Err(ServerError::BinaryNotFound(format!(
            "Binary not found at {:?}",
            backend_path
        )));
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
        .map_err(|_| ServerError::LlamacppError("Timeout waiting for device list".to_string()))?
        .map_err(ServerError::Io)?;

    // Check if command executed successfully
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("llama-server --list-devices failed: {}", stderr);
        return Err(ServerError::LlamacppError(format!(
            "Command failed with exit code {:?}: {}",
            output.status.code(),
            stderr
        )));
    }

    // Parse the output
    let stdout = String::from_utf8_lossy(&output.stdout);
    log::info!("Device list output:\n{}", stdout);

    parse_device_output(&stdout)
}

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
        return Err(ServerError::ParseError(
            "Could not find 'Available devices:' section in output".to_string(),
        ));
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
        return Err(ServerError::ParseError(format!(
            "Empty memory value: '{}'",
            mem_str
        )));
    }

    // Take the first part which should be the number
    let number_str = parts[0];
    number_str.parse::<i32>().map_err(|_| {
        ServerError::ParseError(format!("Could not parse memory value: '{}'", number_str))
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

// check port availability
#[tauri::command]
pub fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}
