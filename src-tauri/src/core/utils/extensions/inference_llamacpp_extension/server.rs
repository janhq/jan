use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashSet;
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
pub async fn load_llama_model(
    state: State<'_, AppState>,
    backend_path: &str,
    library_path: Option<&str>,
    mut args: Vec<String>,
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
    // FOR MODEL PATH; TODO: DO SIMILARLY FOR MMPROJ PATH
    let model_path_index = args
        .iter()
        .position(|arg| arg == "-m")
        .ok_or(ServerError::LlamacppError("Missing `-m` flag".into()))?;

    let model_path = args
        .get(model_path_index + 1)
        .ok_or(ServerError::LlamacppError("Missing path after `-m`".into()))?
        .clone();

    let model_path_pb = PathBuf::from(model_path);
    if !model_path_pb.exists() {
        return Err(ServerError::LlamacppError(format!(
            "Invalid or inaccessible model path: {}",
            model_path_pb.display().to_string(),
        )));
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
                            log::info!("Server appears to be ready based on stderr: '{}'", line);
                            let _ = ready_tx.send(true).await;
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading stderr: {}", e);
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
            log::error!("llama.cpp exited early with code {:?}", status);
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
            // Check for process exit more frequently
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                // Check if process exited
                if let Some(status) = child.try_wait()? {
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    if !status.success() {
                        log::error!("llama.cpp exited with error code {:?}", status);
                        return Err(ServerError::LlamacppError(format!("Process exited with code {:?}\n\nStderr:\n{}", status, stderr_output)));
                    } else {
                        log::error!("llama.cpp exited successfully but without ready signal");
                        return Err(ServerError::LlamacppError(format!("Process exited unexpectedly\n\nStderr:\n{}", stderr_output)));
                    }
                }

                // Timeout check
                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for server to be ready");
                    let _ = child.kill().await;
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    return Err(ServerError::LlamacppError(format!("Server startup timeout\n\nStderr:\n{}", stderr_output)));
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
fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[tauri::command]
pub async fn get_random_port(state: State<'_, AppState>) -> Result<u16, String> {
    const MAX_ATTEMPTS: u32 = 20000;
    let mut attempts = 0;
    let mut rng = StdRng::from_entropy();

    // Get all active ports from sessions
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
pub async fn find_session_by_model(
    model_id: String,
    state: State<'_, AppState>,
) -> Result<Option<SessionInfo>, String> {
    let map = state.llama_server_process.lock().await;

    let session_info = map
        .values()
        .find(|backend_session| backend_session.info.model_id == model_id)
        .map(|backend_session| backend_session.info.clone());

    Ok(session_info)
}

// get running models
#[tauri::command]
pub async fn get_loaded_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let map = state.llama_server_process.lock().await;

    let model_ids = map
        .values()
        .map(|backend_session| backend_session.info.model_id.clone())
        .collect();

    Ok(model_ids)
}

// tests
//
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    #[cfg(windows)]
    use tempfile;

    #[test]
    fn test_parse_multiple_devices() {
        let output = r#"ggml_vulkan: Found 2 Vulkan devices:
ggml_vulkan: 0 = NVIDIA GeForce RTX 3090 (NVIDIA) | uma: 0 | fp16: 1 | bf16: 0 | warp size: 32 | shared memory: 49152 | int dot: 0 | matrix cores: KHR_coopmat
ggml_vulkan: 1 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | bf16: 0 | warp size: 64 | shared memory: 65536 | int dot: 0 | matrix cores: KHR_coopmat
Available devices:
Vulkan0: NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)
Vulkan1: AMD Radeon Graphics (RADV GFX1151) (87722 MiB, 87722 MiB free)
"#;

        let devices = parse_device_output(output).unwrap();

        assert_eq!(devices.len(), 2);

        // Check first device
        assert_eq!(devices[0].id, "Vulkan0");
        assert_eq!(devices[0].name, "NVIDIA GeForce RTX 3090");
        assert_eq!(devices[0].mem, 24576);
        assert_eq!(devices[0].free, 24576);

        // Check second device
        assert_eq!(devices[1].id, "Vulkan1");
        assert_eq!(devices[1].name, "AMD Radeon Graphics (RADV GFX1151)");
        assert_eq!(devices[1].mem, 87722);
        assert_eq!(devices[1].free, 87722);
    }

    #[test]
    fn test_parse_single_device() {
        let output = r#"Available devices:
CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)"#;

        let devices = parse_device_output(output).unwrap();

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "CUDA0");
        assert_eq!(devices[0].name, "NVIDIA GeForce RTX 4090");
        assert_eq!(devices[0].mem, 24576);
        assert_eq!(devices[0].free, 24000);
    }

    #[test]
    fn test_parse_with_extra_whitespace_and_empty_lines() {
        let output = r#"
Available devices:

Vulkan0: NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)

Vulkan1: AMD Radeon Graphics (RADV GFX1151) (87722 MiB, 87722 MiB free)

"#;

        let devices = parse_device_output(output).unwrap();

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].id, "Vulkan0");
        assert_eq!(devices[1].id, "Vulkan1");
    }

    #[test]
    fn test_parse_different_backends() {
        let output = r#"Available devices:
CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 24000 MiB free)
Vulkan0: NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)
SYCL0: Intel(R) Arc(TM) A750 Graphics (8000 MiB, 7721 MiB free)"#;

        let devices = parse_device_output(output).unwrap();

        assert_eq!(devices.len(), 3);

        assert_eq!(devices[0].id, "CUDA0");
        assert_eq!(devices[0].name, "NVIDIA GeForce RTX 4090");

        assert_eq!(devices[1].id, "Vulkan0");
        assert_eq!(devices[1].name, "NVIDIA GeForce RTX 3090");

        assert_eq!(devices[2].id, "SYCL0");
        assert_eq!(devices[2].name, "Intel(R) Arc(TM) A750 Graphics");
        assert_eq!(devices[2].mem, 8000);
        assert_eq!(devices[2].free, 7721);
    }

    #[test]
    fn test_parse_complex_gpu_names() {
        let output = r#"Available devices:
Vulkan0: Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)
Vulkan1: AMD Radeon RX 7900 XTX (Navi 31) [RDNA 3] (24576 MiB, 24000 MiB free)"#;

        let devices = parse_device_output(output).unwrap();

        assert_eq!(devices.len(), 2);

        assert_eq!(devices[0].id, "Vulkan0");
        assert_eq!(devices[0].name, "Intel(R) Arc(tm) A750 Graphics (DG2)");
        assert_eq!(devices[0].mem, 8128);
        assert_eq!(devices[0].free, 8128);

        assert_eq!(devices[1].id, "Vulkan1");
        assert_eq!(devices[1].name, "AMD Radeon RX 7900 XTX (Navi 31) [RDNA 3]");
        assert_eq!(devices[1].mem, 24576);
        assert_eq!(devices[1].free, 24000);
    }

    #[test]
    fn test_parse_no_devices() {
        let output = r#"Available devices:"#;

        let devices = parse_device_output(output).unwrap();
        assert_eq!(devices.len(), 0);
    }

    #[test]
    fn test_parse_missing_header() {
        let output = r#"Vulkan0: NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)"#;

        let result = parse_device_output(output);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Could not find 'Available devices:' section"));
    }

    #[test]
    fn test_parse_malformed_device_line() {
        let output = r#"Available devices:
Vulkan0: NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)
Invalid line without colon
Vulkan1: AMD Radeon Graphics (RADV GFX1151) (87722 MiB, 87722 MiB free)"#;

        let devices = parse_device_output(output).unwrap();

        // Should skip the malformed line and parse the valid ones
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].id, "Vulkan0");
        assert_eq!(devices[1].id, "Vulkan1");
    }

    #[test]
    fn test_parse_device_line_individual() {
        // Test the individual line parser
        let line = "Vulkan0: NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)";
        let device = parse_device_line(line).unwrap().unwrap();

        assert_eq!(device.id, "Vulkan0");
        assert_eq!(device.name, "NVIDIA GeForce RTX 3090");
        assert_eq!(device.mem, 24576);
        assert_eq!(device.free, 24576);
    }

    #[test]
    fn test_memory_pattern_detection() {
        assert!(is_memory_pattern("24576 MiB, 24576 MiB free"));
        assert!(is_memory_pattern("8000 MiB, 7721 MiB free"));
        assert!(!is_memory_pattern("just some text"));
        assert!(!is_memory_pattern("24576 MiB"));
        assert!(!is_memory_pattern("24576, 24576"));
    }

    #[test]
    fn test_parse_memory_value() {
        assert_eq!(parse_memory_value("24576 MiB").unwrap(), 24576);
        assert_eq!(parse_memory_value("7721 MiB free").unwrap(), 7721);
        assert_eq!(parse_memory_value("8000").unwrap(), 8000);

        assert!(parse_memory_value("").is_err());
        assert!(parse_memory_value("not_a_number MiB").is_err());
    }

    #[test]
    fn test_find_memory_pattern() {
        let text = "NVIDIA GeForce RTX 3090 (24576 MiB, 24576 MiB free)";
        let result = find_memory_pattern(text);
        assert!(result.is_some());
        let (_start, content) = result.unwrap();
        assert_eq!(content, "24576 MiB, 24576 MiB free");

        // Test with multiple parentheses
        let text = "Intel(R) Arc(tm) A750 Graphics (DG2) (8128 MiB, 8128 MiB free)";
        let result = find_memory_pattern(text);
        assert!(result.is_some());
        let (_start, content) = result.unwrap();
        assert_eq!(content, "8128 MiB, 8128 MiB free");
    }
    #[test]
    fn test_path_with_uncommon_dir_names() {
        const UNCOMMON_DIR_NAME: &str = "тест-你好-éàç-🚀";
        #[cfg(windows)]
        {
            let dir = tempdir().expect("Failed to create temp dir");
            let long_path = dir.path().join(UNCOMMON_DIR_NAME);

            std::fs::create_dir(&long_path)
                .expect("Failed to create directory with uncommon characters");

            let short_path = get_short_path(&long_path);

            match short_path {
                Some(sp) => {
                    // Ensure the path exists
                    assert!(
                        PathBuf::from(&sp).exists(),
                        "Returned short path should exist on filesystem: {}",
                        sp
                    );

                    // It may or may not be ASCII; just ensure it differs
                    let long_path_str = long_path.to_string_lossy();
                    assert_ne!(
                        sp, long_path_str,
                        "Short path should differ from original path"
                    );
                }
                None => {
                    // On some systems, short path generation may be disabled
                    eprintln!("Short path generation failed. This might be expected depending on system settings.");
                }
            }
        }
        #[cfg(not(windows))]
        {
            // On Unix, paths are typically UTF-8 and there's no "short path" concept.
            let long_path_str = format!("/tmp/{}", UNCOMMON_DIR_NAME);
            let path_buf = PathBuf::from(&long_path_str);
            let displayed_path = path_buf.display().to_string();
            assert_eq!(
                displayed_path, long_path_str,
                "Path with non-ASCII characters should be preserved exactly on non-Windows platforms"
            );
        }
    }
}
