use std::process::Stdio;

use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

pub struct DirectProcessSandbox;

/// Build a command for openclaw. On Unix, uses bun as explicit interpreter
/// to bypass shebang resolution. On Windows, runs openclaw.exe directly.
fn build_openclaw_command(args: &[&str], config_dir: &std::path::Path) -> tokio::process::Command {
    let openclaw_path = super::get_openclaw_bin_path().ok();
    let use_installed_binary = openclaw_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    let bun_path = super::resolve_bundled_bun();
    let use_bun_interpreter = !cfg!(target_os = "windows")
        && use_installed_binary
        && bun_path.is_some();

    let mut cmd = if use_bun_interpreter {
        let mut c = tokio::process::Command::new(bun_path.unwrap());
        c.arg(openclaw_path.unwrap());
        c
    } else if use_installed_binary {
        tokio::process::Command::new(openclaw_path.unwrap())
    } else {
        tokio::process::Command::new("openclaw")
    };

    cmd.args(args)
        .current_dir(config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(new_path) = super::build_augmented_path() {
        cmd.env("PATH", new_path);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    cmd
}

#[async_trait::async_trait]
impl Sandbox for DirectProcessSandbox {
    fn name(&self) -> &str {
        "Direct Process"
    }

    fn isolation_tier(&self) -> IsolationTier {
        IsolationTier::None
    }

    async fn is_available(&self) -> bool {
        true // Always available as fallback
    }

    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String> {
        if let Err(e) = super::ensure_bun_node_shim() {
            log::warn!("Failed to ensure node shim: {}", e);
        }

        // On Windows, schtasks requires admin and may fail.
        let install_args = if super::resolve_bundled_bun().is_some() {
            vec!["gateway", "install", "--runtime", "bun"]
        } else {
            vec!["gateway", "install"]
        };
        let mut install_cmd = build_openclaw_command(&install_args.iter().map(|s| *s).collect::<Vec<_>>(), &config.config_dir);
        let service_installed = match install_cmd.output().await {
            Ok(output) if !output.status.success() => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::error!("gateway install failed: {}", stderr.trim());
                false
            }
            Err(e) => {
                log::error!("Failed to run gateway install: {}", e);
                false
            }
            _ => true,
        };

        if service_installed {
            let mut cmd = build_openclaw_command(&["gateway", "start"], &config.config_dir);
            for (key, value) in &config.env_vars {
                cmd.env(key, value);
            }

            let output = cmd
                .output()
                .await
                .map_err(|e| format!("Failed to run openclaw gateway start: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to start OpenClaw gateway: {}", stderr));
            }

            Ok(SandboxHandle::Named("direct-process".to_string()))
        } else {
            // Service registration failed (e.g. Windows without admin).
            // Fall back to `openclaw gateway` as a child process.
            log::info!("Service install unavailable, starting gateway as child process");
            let mut cmd = build_openclaw_command(&["gateway"], &config.config_dir);
            for (key, value) in &config.env_vars {
                cmd.env(key, value);
            }

            let child = cmd
                .spawn()
                .map_err(|e| format!("Failed to spawn openclaw gateway: {}", e))?;

            Ok(SandboxHandle::Process(child))
        }
    }

    async fn stop(&self, _handle: &mut SandboxHandle) -> Result<(), String> {
        let mut stopped_via_cli = false;
        let config_dir = super::get_openclaw_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let mut stop_cmd = build_openclaw_command(&["gateway", "stop"], &config_dir);
        if let Ok(mut child) = stop_cmd.spawn() {
            if let Ok(status) = child.wait().await {
                stopped_via_cli = status.success();
            }
        }

        if !stopped_via_cli {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let _ = tokio::process::Command::new("pkill")
                    .args(["-f", "openclaw"])
                    .output()
                    .await;
            }

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let kill = |im: &'static str| async move {
                    let mut cmd = tokio::process::Command::new("taskkill");
                    cmd.args(["/F", "/IM", im]);
                    cmd.creation_flags(0x08000000);
                    let _ = cmd.output().await;
                };
                kill("bun.exe").await;
                kill("node.exe").await;
                kill("openclaw.exe").await;
            }
        }

        Ok(())
    }

    async fn status(&self, _handle: &SandboxHandle) -> Result<SandboxStatus, String> {
        match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", super::OPENCLAW_PORT)).await {
            Ok(_) => Ok(SandboxStatus::Running),
            Err(_) => Ok(SandboxStatus::Stopped),
        }
    }

    async fn logs(&self, _handle: &SandboxHandle, _lines: usize) -> Result<Vec<String>, String> {
        Ok(vec!["Check /tmp/openclaw/ for logs.".to_string()])
    }
}
