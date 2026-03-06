//! CLI-specific functions for OpenClaw management
//!
//! These functions are designed to be called from the CLI without
//! requiring Tauri's State management.

use std::process::Stdio;
use tokio::process::Command;

use super::models::OpenClawStatus;
use super::{get_openclaw_config_dir, get_openclaw_config_path, OPENCLAW_PORT};

/// Apply common Windows settings to prevent console window popups.
#[cfg(target_os = "windows")]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

#[cfg(not(target_os = "windows"))]
fn hide_window(_cmd: &mut Command) {}

/// Helper to build a command with resolved openclaw path and PATH injection.
///
/// When bundled Bun is available, uses `bun <openclaw_path> <args>` to avoid
/// shebang resolution issues (old system node, missing node shim, etc.).
fn build_openclaw_command(args: &[&str]) -> Command {
    // Ensure node shim points to bundled Bun (for shebang resolution fallback)
    if let Err(e) = super::ensure_bun_node_shim() {
        log::debug!("Node shim not created (will fall back to system node): {}", e);
    }

    let openclaw_path = super::get_openclaw_bin_path().ok();
    let use_installed_binary = openclaw_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    let bun_path = super::resolve_bundled_bun();

    if use_installed_binary && bun_path.is_some() {
        // Best path: run bun explicitly as the interpreter for the openclaw script
        let mut cmd = Command::new(bun_path.unwrap());
        cmd.arg(openclaw_path.unwrap());
        if let Some(new_path) = super::build_augmented_path() {
            cmd.env("PATH", new_path);
        }
        cmd.args(args);
        hide_window(&mut cmd);
        cmd
    } else if use_installed_binary {
        let mut cmd = Command::new(openclaw_path.unwrap());
        if let Some(new_path) = super::build_augmented_path() {
            cmd.env("PATH", new_path);
        }
        cmd.args(args);
        hide_window(&mut cmd);
        cmd
    } else {
        // Fallback: bare "openclaw" (user installed via npm or has it in PATH)
        let mut cmd = Command::new("openclaw");
        if let Some(new_path) = super::build_augmented_path() {
            cmd.env("PATH", new_path);
        }
        cmd.args(args);
        hide_window(&mut cmd);
        cmd
    }
}

/// Check if OpenClaw is installed (standalone version for CLI)
async fn check_openclaw_installed() -> Result<Option<String>, String> {
    // Try the installed openclaw binary in the runtime directory
    if let Ok(openclaw_path) = super::get_openclaw_bin_path() {
        if openclaw_path.exists() {
            // Use bun as explicit interpreter when available (avoids shebang issues)
            let mut cmd = if let Some(bun_path) = super::resolve_bundled_bun() {
                let mut c = Command::new(bun_path);
                c.arg(&openclaw_path);
                c
            } else {
                Command::new(&openclaw_path)
            };
            cmd.arg("--version");
            if let Some(new_path) = super::build_augmented_path() {
                cmd.env("PATH", new_path);
            }
            hide_window(&mut cmd);
            let output = cmd.output().await;

            if let Ok(output) = output {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    return Ok(Some(version));
                }
            }
        }
    }

    // Fallback: bare "openclaw" (user installed via npm)
    let mut cmd = Command::new("openclaw");
    cmd.arg("--version");
    if let Some(new_path) = super::build_augmented_path() {
        cmd.env("PATH", new_path);
    }
    hide_window(&mut cmd);
    let output = cmd.output().await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok(Some(version))
            } else {
                Ok(None)
            }
        }
        Err(_) => Ok(None),
    }
}

/// Check if a JS runtime (Bun or Node.js) is available
async fn check_runtime_version() -> Option<String> {
    // First try bundled Bun
    if let Some(bun_path) = super::resolve_bundled_bun() {
        let mut cmd = Command::new(&bun_path);
        cmd.arg("--version");
        hide_window(&mut cmd);
        let output = cmd.output().await.ok()?;

        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Some(format!("bun {}", version));
        }
    }

    // Fall back to Node.js
    let mut cmd = Command::new("node");
    cmd.arg("--version");
    hide_window(&mut cmd);
    let output = cmd.output().await.ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Check if a port is available
async fn check_port_available(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    tokio::net::TcpListener::bind(&addr).await.is_ok()
}

/// Check if OpenClaw gateway is running by checking if port is in use
async fn check_gateway_running() -> bool {
    !check_port_available(OPENCLAW_PORT).await
}

/// Get OpenClaw status (standalone version for CLI)
pub async fn get_status() -> Result<OpenClawStatus, String> {
    let openclaw_version = check_openclaw_installed().await?;
    let runtime_version = check_runtime_version().await;
    let port_available = check_port_available(OPENCLAW_PORT).await;
    let running = check_gateway_running().await;

    Ok(OpenClawStatus {
        installed: openclaw_version.is_some(),
        running,
        runtime_version,
        openclaw_version,
        port_available,
        error: None,
        sandbox_type: None,
        isolation_tier: None,
    })
}

/// Start the OpenClaw gateway (standalone version for CLI)
pub async fn start_gateway() -> Result<(), String> {
    // Check if already running
    if check_gateway_running().await {
        return Err("OpenClaw gateway is already running".to_string());
    }

    // Check if config exists
    let config_path = get_openclaw_config_path()?;
    if !config_path.exists() {
        return Err("OpenClaw is not configured. Run 'jan openclaw configure' first.".to_string());
    }

    let config_dir = get_openclaw_config_dir()?;

    // Start OpenClaw gateway as a detached process using resolved path
    let mut child = build_openclaw_command(&["gateway", "start"])
        .current_dir(&config_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start OpenClaw: {}", e))?;

    // Wait a moment for startup
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    // Check if it started successfully
    match child.try_wait() {
        Ok(Some(status)) => {
            if !status.success() {
                return Err("OpenClaw gateway failed to start".to_string());
            }
        }
        Ok(None) => {
            // Process is still running, which is expected
        }
        Err(e) => {
            return Err(format!("Failed to check gateway status: {}", e));
        }
    }

    Ok(())
}

/// Stop the OpenClaw gateway (standalone version for CLI)
pub async fn stop_gateway() -> Result<(), String> {
    // Try to stop using resolved openclaw command
    let output = build_openclaw_command(&["gateway", "stop"])
        .output()
        .await;

    if let Ok(output) = output {
        if output.status.success() {
            return Ok(());
        }
    }

    // Fallback: try to kill the process by name
    #[cfg(unix)]
    {
        let mut cmd = Command::new("pkill");
        cmd.args(["-f", "openclaw"]);
        let _ = cmd.output().await;
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let kill = |im: &'static str| async move {
            let mut cmd = Command::new("taskkill");
            cmd.args(["/F", "/IM", im]);
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let _ = cmd.output().await;
        };
        kill("bun.exe").await;
        kill("node.exe").await;
        kill("openclaw.exe").await;
    }

    // Verify it's stopped
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    if check_gateway_running().await {
        return Err("Failed to stop OpenClaw gateway".to_string());
    }

    Ok(())
}

/// Restart the OpenClaw gateway (standalone version for CLI)
pub async fn restart_gateway() -> Result<(), String> {
    // Stop first (ignore errors if not running)
    let _ = stop_gateway().await;

    // Wait a moment
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Start
    start_gateway().await
}
