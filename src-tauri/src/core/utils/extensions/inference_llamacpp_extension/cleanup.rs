use tauri::State;
use crate::core::state::AppState;

pub async fn cleanup_processes(state: State<'_, AppState>) {
    let mut map = state.llama_server_process.lock().await;
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
                        Ok(Ok(status)) => log::info!("Process {} exited gracefully: {}", raw_pid, status),
                        Ok(Err(e)) => log::error!("Error waiting after SIGTERM for {}: {}", raw_pid, e),
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
                use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_C_EVENT};
                use tokio::time::{timeout, Duration};

                if let Some(raw_pid) = child.id() {
                    log::info!("Sending Ctrl-C to PID {} during shutdown", raw_pid);
                    let ok: i32 = unsafe { GenerateConsoleCtrlEvent(CTRL_C_EVENT, raw_pid) };
                    if ok == 0 {
                        log::error!("Failed to send Ctrl-C to PID {}", raw_pid);
                    }

                    match timeout(Duration::from_secs(2), child.wait()).await {
                        Ok(Ok(status)) => log::info!("Process {} exited after Ctrl-C: {}", raw_pid, status),
                        Ok(Err(e)) => log::error!("Error waiting after Ctrl-C for {}: {}", raw_pid, e),
                        Err(_) => {
                            log::warn!("Timed out for PID {}; force-killing", raw_pid);
                            let _ = child.kill().await;
                            let _ = child.wait().await;
                        }
                    }
                }
            }
        }
    }
}
