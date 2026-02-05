use std::collections::HashSet;
use sysinfo::{Pid, System};
use tauri::{Manager, Runtime, State};

use crate::state::{LlamacppState, SessionInfo};
use jan_utils::generate_random_port;

/// Check if a process is running by PID
pub async fn is_process_running_by_pid<R: Runtime>(
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

/// Get a random available port, avoiding ports used by existing sessions
pub async fn get_random_available_port<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, String> {
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

    generate_random_port(&used_ports)
}

/// Gracefully terminate a process on Unix systems
#[cfg(unix)]
pub async fn graceful_terminate_process(child: &mut tokio::process::Child) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    use std::time::Duration;
    use tokio::time::timeout;

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

/// Force terminate a process on Windows
#[cfg(all(windows, target_arch = "x86_64"))]
pub async fn force_terminate_process(child: &mut tokio::process::Child) {
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

/// Find a session by model ID
pub async fn find_session_by_model_id<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: &str,
) -> Result<Option<SessionInfo>, String> {
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;

    let session_info = map
        .values()
        .find(|backend_session| backend_session.info.model_id == model_id)
        .map(|backend_session| backend_session.info.clone());

    Ok(session_info)
}

/// Get all loaded model IDs
pub async fn get_all_loaded_model_ids<R: Runtime>(
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

/// Get all active sessions
pub async fn get_all_active_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    let state: State<LlamacppState> = app_handle.state();
    let map = state.llama_server_process.lock().await;
    let sessions: Vec<SessionInfo> = map.values().map(|s| s.info.clone()).collect();
    Ok(sessions)
}
