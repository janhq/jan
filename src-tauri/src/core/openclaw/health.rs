use std::sync::Arc;
use std::time::Duration;

use tauri::Emitter;
use tokio::sync::Mutex;

use super::lifecycle::is_port_in_use;
use super::models::JanGatewayMode;
use super::sandbox::{Sandbox, SandboxMode};
use super::OpenClawState;

const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(15);
const MAX_RESTART_ATTEMPTS: u32 = 3;

/// Spawn a background task that monitors the sandbox health.
/// Returns a JoinHandle that can be used to cancel the monitor.
///
/// In remote mode, still monitors connectivity but skips auto-restart
/// (Jan doesn't manage the remote instance).
pub fn spawn_health_monitor(
    sandbox: Arc<Mutex<Option<Box<dyn Sandbox>>>>,
    state: Arc<OpenClawState>,
    app_handle: tauri::AppHandle,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut was_healthy = true;
        let mut restart_count: u32 = 0;

        loop {
            tokio::time::sleep(HEALTH_CHECK_INTERVAL).await;

            // Check if we're in remote mode
            let is_remote = {
                let settings = state.gateway_settings.lock().await;
                settings.mode == JanGatewayMode::Remote
            };

            if is_remote {
                // In remote mode: monitor connectivity only, no auto-restart
                let is_healthy = if let Some(url) = super::get_remote_url(&state).await {
                    let token = super::get_remote_token(&state).await;
                    super::commands::openclaw_validate_remote_gateway(url, token)
                        .await
                        .unwrap_or(false)
                } else {
                    false
                };

                if is_healthy && !was_healthy {
                    log::info!("Remote OpenClaw gateway connectivity restored");
                    let _ = app_handle.emit("openclaw-health-changed", "healthy");
                } else if !is_healthy && was_healthy {
                    log::warn!("Remote OpenClaw gateway not reachable");
                    let _ = app_handle.emit("openclaw-health-changed", "unhealthy");
                }
                was_healthy = is_healthy;
                continue;
            }

            let mode = state.sandbox_mode.lock().await;
            let is_active = matches!(*mode, SandboxMode::Active { .. });
            drop(mode);

            if !is_active {
                // Sandbox is not active, nothing to monitor
                was_healthy = true;
                restart_count = 0;
                continue;
            }

            // Check health by probing the port
            let is_healthy = is_port_in_use(super::OPENCLAW_PORT).await;

            if is_healthy && !was_healthy {
                // Recovered
                log::info!("OpenClaw health restored");
                restart_count = 0;
                let _ = app_handle.emit("openclaw-health-changed", "healthy");
            } else if !is_healthy && was_healthy {
                // Became unhealthy
                log::warn!("OpenClaw health check failed — gateway not responding");
                let _ = app_handle.emit("openclaw-health-changed", "unhealthy");
            }

            if !is_healthy && restart_count < MAX_RESTART_ATTEMPTS {
                log::info!(
                    "Attempting auto-restart ({}/{})",
                    restart_count + 1,
                    MAX_RESTART_ATTEMPTS
                );

                // Attempt restart through the sandbox
                let sandbox_guard = sandbox.lock().await;
                if let Some(ref sandbox_impl) = *sandbox_guard {
                    let mut mode = state.sandbox_mode.lock().await;
                    if let SandboxMode::Active { ref mut handle, .. } = *mode {
                        // Stop, then restart is handled by the caller re-starting.
                        // For auto-restart, we just stop and let the next cycle detect it.
                        let _ = sandbox_impl.stop(handle).await;
                    }
                    *mode = SandboxMode::Inactive;
                }
                drop(sandbox_guard);

                restart_count += 1;

                if restart_count >= MAX_RESTART_ATTEMPTS {
                    log::error!(
                        "OpenClaw failed after {} restart attempts",
                        MAX_RESTART_ATTEMPTS
                    );
                    let _ = app_handle.emit("openclaw-failed", "max_restarts_exceeded");
                }
            }

            was_healthy = is_healthy;
        }
    })
}
