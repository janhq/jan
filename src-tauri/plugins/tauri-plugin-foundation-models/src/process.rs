use std::collections::HashSet;
use sysinfo::{Pid, System};
use tauri::{Manager, Runtime, State};

use crate::state::{FoundationModelsState, SessionInfo};
use jan_utils::generate_random_port;

/// Returns true if the process with the given PID is still running.
/// Removes the session from state if the process has exited.
pub async fn is_process_running_by_pid<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let alive = system.process(Pid::from(pid as usize)).is_some();

    if !alive {
        let state: State<FoundationModelsState> = app_handle.state();
        let mut map = state.sessions.lock().await;
        map.remove(&pid);
    }

    Ok(alive)
}

/// Returns a random available port that is not used by any active session.
pub async fn get_random_available_port<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, String> {
    let state: State<FoundationModelsState> = app_handle.state();
    let map = state.sessions.lock().await;

    let used_ports: HashSet<u16> = map
        .values()
        .filter_map(|s| {
            if s.info.port > 0 && s.info.port <= u16::MAX as i32 {
                Some(s.info.port as u16)
            } else {
                None
            }
        })
        .collect();

    drop(map);
    generate_random_port(&used_ports)
}

/// Returns the SessionInfo for the only expected active session (if any).
pub async fn find_active_session<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Option<SessionInfo> {
    let state: State<FoundationModelsState> = app_handle.state();
    let map = state.sessions.lock().await;
    map.values().next().map(|s| s.info.clone())
}

/// Gracefully terminate a process on Unix (macOS).
#[cfg(unix)]
pub async fn graceful_terminate_process(child: &mut tokio::process::Child) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    use std::time::Duration;
    use tokio::time::timeout;

    if let Some(raw_pid) = child.id() {
        let raw_pid = raw_pid as i32;
        log::info!(
            "Sending SIGTERM to Foundation Models PID {}",
            raw_pid
        );
        let _ = kill(Pid::from_raw(raw_pid), Signal::SIGTERM);

        match timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(status)) => log::info!(
                "Foundation Models process {} exited gracefully: {}",
                raw_pid,
                status
            ),
            Ok(Err(e)) => log::error!(
                "Error waiting after SIGTERM for Foundation Models PID {}: {}",
                raw_pid,
                e
            ),
            Err(_) => {
                log::warn!(
                    "SIGTERM timed out for Foundation Models PID {}; sending SIGKILL",
                    raw_pid
                );
                let _ = kill(Pid::from_raw(raw_pid), Signal::SIGKILL);
                match child.wait().await {
                    Ok(s) => log::info!("Force-killed Foundation Models process: {}", s),
                    Err(e) => log::error!(
                        "Error waiting after SIGKILL for Foundation Models PID {}: {}",
                        raw_pid,
                        e
                    ),
                }
            }
        }
    }
}
