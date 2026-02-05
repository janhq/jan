use tauri::{Manager, Runtime};

pub async fn cleanup_processes<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    // Access the global AppState from the main app
    let app_state = match app_handle.try_state::<crate::state::LlamacppState>() {
        Some(state) => state,
        None => {
            log::warn!("LlamacppState not found in app_handle");
            return;
        }
    };
    let mut map = app_state.llama_server_process.lock().await;
    let pids: Vec<i32> = map.keys().cloned().collect();
    for pid in pids {
        if let Some(session) = map.remove(&pid) {
            let mut child = session.child;
            #[cfg(unix)]
            {
                use nix::sys::signal::{kill, Signal};
                use nix::unistd::Pid;
                use tokio::time::{timeout, Duration};

                if let Some(raw_pid) = child.id() {
                    let raw_pid = raw_pid as i32;
                    log::info!("Sending SIGTERM to PID {} during shutdown", raw_pid);
                    let _ = kill(Pid::from_raw(raw_pid), Signal::SIGTERM);

                    match timeout(Duration::from_secs(2), child.wait()).await {
                        Ok(Ok(status)) => {
                            log::info!("Process {} exited gracefully: {}", raw_pid, status)
                        }
                        Ok(Err(e)) => {
                            log::error!("Error waiting after SIGTERM for {}: {}", raw_pid, e)
                        }
                        Err(_) => {
                            log::warn!("SIGTERM timed out for PID {}; sending SIGKILL", raw_pid);
                            let _ = kill(Pid::from_raw(raw_pid), Signal::SIGKILL);
                            let _ = child.wait().await;
                        }
                    }
                }
            }
            #[cfg(all(windows, target_arch = "x86_64"))]
            {
                if let Some(raw_pid) = child.id() {
                    log::warn!(
                        "Gracefully terminating is unsupported on Windows, force-killing PID {}",
                        raw_pid
                    );

                    // Since we know a graceful shutdown doesn't work and there are no child processes
                    // to worry about, we can use `child.kill()` directly. On Windows, this is
                    // a forceful termination via the `TerminateProcess` API.
                    if let Err(e) = child.kill().await {
                        log::error!("Failed to send kill signal to PID {}: {}. It may have already terminated.", raw_pid, e);
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
        }
    }
}

#[tauri::command]
pub async fn cleanup_llama_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    cleanup_processes(&app_handle).await;
    Ok(())
}
