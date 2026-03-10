use std::process::Stdio;
use tokio::process::Command;

use super::models::OpenClawStatus;
use super::{get_openclaw_config_dir, get_openclaw_config_path, OPENCLAW_PORT};

#[cfg(target_os = "windows")]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}

#[cfg(not(target_os = "windows"))]
fn hide_window(_cmd: &mut Command) {}

/// Build a command for openclaw. On Unix, uses bun as explicit interpreter
/// to bypass shebang resolution. On Windows, runs openclaw.exe directly.
fn build_openclaw_command(args: &[&str]) -> Command {
    let _ = super::ensure_bun_node_shim();

    let openclaw_path = super::get_openclaw_bin_path().ok();
    let use_installed_binary = openclaw_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    let bun_path = super::resolve_bundled_bun();
    let use_bun_interpreter = !cfg!(target_os = "windows")
        && use_installed_binary
        && bun_path.is_some();

    if use_bun_interpreter {
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
        let mut cmd = Command::new("openclaw");
        if let Some(new_path) = super::build_augmented_path() {
            cmd.env("PATH", new_path);
        }
        cmd.args(args);
        hide_window(&mut cmd);
        cmd
    }
}

async fn check_openclaw_installed() -> Result<Option<String>, String> {
    if let Ok(openclaw_path) = super::get_openclaw_bin_path() {
        if openclaw_path.exists() {
            let bun_path = super::resolve_bundled_bun();
            let mut cmd = if !cfg!(target_os = "windows") && bun_path.is_some() {
                let mut c = Command::new(bun_path.unwrap());
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

async fn check_runtime_version() -> Option<String> {
    let bun_path = super::resolve_bundled_bun()?;
    let mut cmd = Command::new(&bun_path);
    cmd.arg("--version");
    hide_window(&mut cmd);
    let output = cmd.output().await.ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Some(format!("bun {}", version))
    } else {
        None
    }
}

async fn check_port_available(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    tokio::net::TcpListener::bind(&addr).await.is_ok()
}

async fn check_gateway_running() -> bool {
    !check_port_available(OPENCLAW_PORT).await
}

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

pub async fn start_gateway() -> Result<(), String> {
    if check_gateway_running().await {
        return Err("OpenClaw gateway is already running".to_string());
    }

    let config_path = get_openclaw_config_path()?;
    if !config_path.exists() {
        return Err("OpenClaw is not configured. Run 'jan openclaw configure' first.".to_string());
    }

    let config_dir = get_openclaw_config_dir()?;

    let mut child = build_openclaw_command(&["gateway", "start"])
        .current_dir(&config_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start OpenClaw: {}", e))?;

    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    match child.try_wait() {
        Ok(Some(status)) => {
            if !status.success() {
                return Err("OpenClaw gateway failed to start".to_string());
            }
        }
        Ok(None) => {}
        Err(e) => {
            return Err(format!("Failed to check gateway status: {}", e));
        }
    }

    Ok(())
}

pub async fn stop_gateway() -> Result<(), String> {
    let output = build_openclaw_command(&["gateway", "stop"])
        .output()
        .await;

    if let Ok(output) = output {
        if output.status.success() {
            return Ok(());
        }
    }

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
            cmd.creation_flags(0x08000000);
            let _ = cmd.output().await;
        };
        kill("bun.exe").await;
        kill("openclaw.exe").await;
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    if check_gateway_running().await {
        return Err("Failed to stop OpenClaw gateway".to_string());
    }

    Ok(())
}

pub async fn restart_gateway() -> Result<(), String> {
    let _ = stop_gateway().await;
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    start_gateway().await
}
