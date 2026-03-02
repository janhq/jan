use std::process::Stdio;

use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

/// Tier 0 fallback: runs OpenClaw as a direct process on the host.
/// This preserves the exact current behavior — no isolation.
pub struct DirectProcessSandbox;

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
        // Ensure the gateway service is installed (registers launchd on macOS)
        log::info!("DirectProcessSandbox: ensuring gateway service is installed");
        if let Ok(mut install_child) = tokio::process::Command::new("openclaw")
            .args(["gateway", "install"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            let _ = install_child.wait().await;
        }

        // Start OpenClaw gateway via CLI
        // 'openclaw gateway start' starts a daemon and exits immediately
        log::info!("DirectProcessSandbox: starting gateway service");
        let mut cmd = tokio::process::Command::new("openclaw");
        cmd.args(["gateway", "start"])
            .current_dir(&config.config_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

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

        // Try the clean CLI stop first
        let mut stopped_via_cli = false;
        if let Ok(mut child) = tokio::process::Command::new("openclaw")
            .args(["gateway", "stop"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
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
                let _ = tokio::process::Command::new("taskkill")
                    .args(["/F", "/IM", "openclaw.exe"])
                    .output()
                    .await;
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
