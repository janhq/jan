//! CLI-specific functions for OpenClaw management
//!
//! These functions are designed to be called from the CLI without
//! requiring Tauri's State management.

use std::process::Stdio;
use tokio::process::Command;

use super::models::OpenClawStatus;
use super::{get_openclaw_config_dir, get_openclaw_config_path, OPENCLAW_PORT};

/// Check if OpenClaw is installed (standalone version for CLI)
async fn check_openclaw_installed() -> Result<Option<String>, String> {
    let output = Command::new("npx")
        .args(["openclaw", "--version"])
        .output()
        .await;

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

/// Check if Node.js is available
async fn check_node_version() -> Option<String> {
    let output = Command::new("node")
        .arg("--version")
        .output()
        .await
        .ok()?;

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
    let node_version = check_node_version().await;
    let port_available = check_port_available(OPENCLAW_PORT).await;
    let running = check_gateway_running().await;

    Ok(OpenClawStatus {
        installed: openclaw_version.is_some(),
        running,
        node_version,
        openclaw_version,
        port_available,
        error: None,
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

    // Start OpenClaw gateway as a detached process
    let mut child = Command::new("npx")
        .args(["openclaw", "gateway", "start"])
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
    // Try to stop using npx openclaw
    let output = Command::new("npx")
        .args(["openclaw", "gateway", "stop"])
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
        let _ = Command::new("pkill")
            .args(["-f", "openclaw"])
            .output()
            .await;
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "node.exe", "/FI", "WINDOWTITLE eq openclaw*"])
            .output()
            .await;
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
