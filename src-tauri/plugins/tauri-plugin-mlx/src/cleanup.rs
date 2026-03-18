use tauri::{Manager, Runtime};

pub async fn cleanup_processes<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    let app_state = match app_handle.try_state::<crate::state::MlxState>() {
        Some(state) => state,
        None => {
            log::warn!("MlxState not found in app_handle");
            return;
        }
    };
    let mut map = app_state.mlx_server_process.lock().await;
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
                    log::info!("Sending SIGTERM to MLX PID {} during shutdown", raw_pid);
                    let _ = kill(Pid::from_raw(raw_pid), Signal::SIGTERM);

                    match timeout(Duration::from_secs(2), child.wait()).await {
                        Ok(Ok(status)) => {
                            log::info!("MLX process {} exited gracefully: {}", raw_pid, status)
                        }
                        Ok(Err(e)) => {
                            log::error!(
                                "Error waiting after SIGTERM for MLX process {}: {}",
                                raw_pid,
                                e
                            )
                        }
                        Err(_) => {
                            log::warn!(
                                "SIGTERM timed out for MLX PID {}; sending SIGKILL",
                                raw_pid
                            );
                            let _ = kill(Pid::from_raw(raw_pid), Signal::SIGKILL);
                            let _ = child.wait().await;
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn cleanup_mlx_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    cleanup_processes(&app_handle).await;
    Ok(())
}
