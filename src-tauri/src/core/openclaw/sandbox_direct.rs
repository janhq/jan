use std::process::Stdio;

use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

/// Tier 0 fallback: runs OpenClaw as a direct process on the host.
/// This preserves the exact current behavior — no isolation.
pub struct DirectProcessSandbox;

/// Helper to build a command with resolved openclaw path and PATH injection.
///
/// When bundled Bun is available, uses `bun <openclaw_path> <args>` to avoid
/// shebang resolution issues (old system node, missing node shim, etc.).
fn build_openclaw_command(args: &[&str], config_dir: &std::path::Path) -> tokio::process::Command {
    let openclaw_path = super::get_openclaw_bin_path().ok();
    let use_installed_binary = openclaw_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    let bun_path = super::resolve_bundled_bun();

    let mut cmd = if use_installed_binary && bun_path.is_some() {
        // Best path: run bun explicitly as the interpreter for the openclaw script.
        // This bypasses shebang resolution entirely — no dependency on `node` in PATH.
        let mut c = tokio::process::Command::new(bun_path.unwrap());
        c.arg(openclaw_path.unwrap());
        c
    } else if use_installed_binary {
        // Bun not available, run openclaw script directly (relies on shebang → system node)
        tokio::process::Command::new(openclaw_path.unwrap())
    } else {
        // Fallback: bare "openclaw" (user installed via npm or has it in PATH)
        tokio::process::Command::new("openclaw")
    };

    cmd.args(args)
        .current_dir(config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Augment PATH with bundled Bun and runtime bin for shebang resolution
    if let Some(new_path) = super::build_augmented_path() {
        cmd.env("PATH", new_path);
    }

    // On Windows, prevent console window popups
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
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
        // Ensure node shim exists so `gateway install` hardcodes the correct runtime path.
        // This is the most critical call site: the service plist/unit file generated here
        // will contain the absolute path to `node` (resolved via #!/usr/bin/env node shebang).
        // Our shim makes that resolve to bundled Bun instead of system Node.js.
        if let Err(e) = super::ensure_bun_node_shim() {
            log::warn!("Failed to ensure node shim before gateway install: {}", e);
        }

        // Ensure the gateway service is installed (registers launchd on macOS).
        // Pass --runtime bun when bundled Bun is available so the service plist/unit
        // hardcodes the bun binary path instead of resolving to system node.
        log::info!("DirectProcessSandbox: ensuring gateway service is installed");
        let install_args = if super::resolve_bundled_bun().is_some() {
            vec!["gateway", "install", "--runtime", "bun"]
        } else {
            vec!["gateway", "install"]
        };
        let mut install_cmd = build_openclaw_command(&install_args.iter().map(|s| *s).collect::<Vec<_>>(), &config.config_dir);
        match install_cmd.output().await {
            Ok(output) => {
                if output.status.success() {
                    log::info!("gateway install succeeded: {}", String::from_utf8_lossy(&output.stdout).trim());
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    log::error!("gateway install failed (exit {}): stdout={}, stderr={}", output.status, stdout.trim(), stderr.trim());
                }
            }
            Err(e) => {
                log::error!("Failed to run gateway install: {}", e);
            }
        }

        // Start OpenClaw gateway via CLI
        // 'openclaw gateway start' starts a daemon and exits immediately
        log::info!("DirectProcessSandbox: starting gateway service");
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
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::error!(
                "openclaw gateway start failed: stdout={}, stderr={}",
                stdout,
                stderr
            );
            return Err(format!("Failed to start OpenClaw gateway: {}", stderr));
        }

        // The gateway runs as a daemon — we track it by port, not by child PID.
        // Return a Named handle so stop() knows which mechanism to use.
        Ok(SandboxHandle::Named("direct-process".to_string()))
    }

    async fn stop(&self, _handle: &mut SandboxHandle) -> Result<(), String> {
        log::info!("DirectProcessSandbox: stopping gateway");

        // Try the clean CLI stop first using resolved path
        let mut stopped_via_cli = false;
        let config_dir = super::get_openclaw_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let mut stop_cmd = build_openclaw_command(&["gateway", "stop"], &config_dir);
        if let Ok(mut child) = stop_cmd.spawn() {
            if let Ok(status) = child.wait().await {
                if status.success() {
                    log::info!("openclaw gateway stop command succeeded");
                    stopped_via_cli = true;
                }
            }
        }

        // Fallback: kill by process name
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
                // Kill both bun.exe and node.exe processes running openclaw
                let kill = |im: &'static str| async move {
                    let mut cmd = tokio::process::Command::new("taskkill");
                    cmd.args(["/F", "/IM", im]);
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
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
        // Check if the gateway is responding on its port
        match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", super::OPENCLAW_PORT)).await {
            Ok(_) => Ok(SandboxStatus::Running),
            Err(_) => Ok(SandboxStatus::Stopped),
        }
    }

    async fn logs(&self, _handle: &SandboxHandle, _lines: usize) -> Result<Vec<String>, String> {
        // Direct process logs go to the system's service manager (launchd, etc.)
        // or /tmp/openclaw/. We don't capture them in-process.
        Ok(vec![
            "Log capture not available in direct process mode. Check /tmp/openclaw/ for logs."
                .to_string(),
        ])
    }
}
