use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpLockFile {
    pub pid: u32,
    pub port: u16,
    pub server_name: String,
    pub created_at: String,
    pub hostname: String,
}

fn get_lock_file_path<R: Runtime>(app: &AppHandle<R>, port: u16) -> PathBuf {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    app_data_dir.join(format!("mcp_lock_{}.json", port))
}

pub fn create_lock_file<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
    server_name: &str,
) -> Result<(), String> {
    let lock_path = get_lock_file_path(app, port);

    // Ensure parent directory exists
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create lock file directory: {}", e))?;
    }

    let lock = McpLockFile {
        pid: std::process::id(),
        port,
        server_name: server_name.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        hostname: hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string()),
    };

    let lock_json =
        serde_json::to_string_pretty(&lock).map_err(|e| format!("Failed to serialize lock: {}", e))?;

    fs::write(&lock_path, lock_json)
        .map_err(|e| format!("Failed to write lock file: {}", e))?;

    log::debug!("Created lock file for port {} at {:?}", port, lock_path);
    Ok(())
}

pub fn read_lock_file<R: Runtime>(app: &AppHandle<R>, port: u16) -> Option<McpLockFile> {
    let lock_path = get_lock_file_path(app, port);

    if !lock_path.exists() {
        return None;
    }

    let lock_json = fs::read_to_string(&lock_path).ok()?;
    serde_json::from_str(&lock_json).ok()
}

pub fn delete_lock_file<R: Runtime>(app: &AppHandle<R>, port: u16) -> Result<(), String> {
    let lock_path = get_lock_file_path(app, port);

    if lock_path.exists() {
        fs::remove_file(&lock_path)
            .map_err(|e| format!("Failed to delete lock file: {}", e))?;
        log::debug!("Deleted lock file for port {}", port);
    }

    Ok(())
}

pub fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;

        let nix_pid = Pid::from_raw(pid as i32);
        kill(nix_pid, None).is_ok()
    }

    #[cfg(windows)]
    {
        use std::process::Command;

        #[cfg(windows)]
        use std::os::windows::process::CommandExt;

        let mut cmd = Command::new("tasklist");
        cmd.args(&["/FI", &format!("PID eq {}", pid), "/NH"]);

        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = cmd.output();

        if let Ok(output) = output {
            let output_str = String::from_utf8_lossy(&output.stdout);
            output_str.contains(&pid.to_string())
        } else {
            false
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

pub async fn check_and_cleanup_stale_lock<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
) -> Result<bool, String> {
    let lock = match read_lock_file(app, port) {
        Some(l) => l,
        None => return Ok(false),
    };

    log::debug!(
        "Found lock file for port {}: PID={}, server={}",
        port,
        lock.pid,
        lock.server_name
    );

    if !is_process_alive(lock.pid) {
        log::info!(
            "Lock file for port {} is stale (PID {} is dead), removing",
            port,
            lock.pid
        );
        delete_lock_file(app, port)?;
        return Ok(true);
    }

    log::debug!("Process {} is still alive for port {}", lock.pid, port);
    Ok(false)
}

pub async fn cleanup_all_stale_locks<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");

    let pattern = app_data_dir.join("mcp_lock_*.json");
    let pattern_str = pattern.to_string_lossy();

    for entry in glob::glob(&pattern_str).map_err(|e| format!("Glob error: {}", e))? {
        if let Ok(path) = entry {
            if let Some(file_name) = path.file_name() {
                let file_name_str = file_name.to_string_lossy();
                if let Some(port_str) = file_name_str
                    .strip_prefix("mcp_lock_")
                    .and_then(|s| s.strip_suffix(".json"))
                {
                    if let Ok(port) = port_str.parse::<u16>() {
                        match check_and_cleanup_stale_lock(app, port).await {
                            Ok(true) => log::info!("Cleaned up stale lock for port {}", port),
                            Err(e) => log::warn!("Failed to cleanup lock for port {}: {}", port, e),
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

pub fn cleanup_own_locks<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");

    let pattern = app_data_dir.join("mcp_lock_*.json");
    let pattern_str = pattern.to_string_lossy();
    let current_pid = std::process::id();

    for entry in glob::glob(&pattern_str).map_err(|e| format!("Glob error: {}", e))? {
        if let Ok(path) = entry {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(lock) = serde_json::from_str::<McpLockFile>(&content) {
                    if lock.pid == current_pid {
                        fs::remove_file(&path).ok();
                        log::debug!("Removed own lock file: {:?}", path);
                    }
                }
            }
        }
    }

    Ok(())
}
