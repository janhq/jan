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

#[cfg(all(windows, target_arch = "x86_64"))]
pub async fn force_terminate_process(child: &mut tokio::process::Child) {
    // Graceful shutdown is not implemented on Windows: llama-server's console
    // handler only reacts to CTRL_C_EVENT (server.cpp), and
    // GenerateConsoleCtrlEvent(CTRL_C_EVENT, pid) is only deliverable with
    // group ID 0 — which would also terminate this process. CTRL_BREAK_EVENT
    // can target a specific group but the server ignores it.
    if let Some(raw_pid) = child.id() {
        log::warn!(
            "gracefully killing is unsupported on Windows, force-killing PID {}",
            raw_pid
        );
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
