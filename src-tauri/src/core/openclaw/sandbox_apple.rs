/// Apple Containerization Framework sandbox for macOS 26+ (Tahoe).
///
/// Delegates to a Swift helper binary (`container-helper`) that wraps
/// Apple's Containerization.framework. This follows the same pattern as
/// the `mlx-server` integration: a Swift binary built separately and
/// bundled in `src-tauri/resources/bin/`.
///
/// The helper communicates via a simple JSON protocol over stdout.
///
/// Network model: the helper configures the container with host networking,
/// so `localhost:1337` reaches Jan's API without config patching.
#[cfg(target_os = "macos")]
use std::process::Stdio;

#[cfg(target_os = "macos")]
use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

#[cfg(target_os = "macos")]
const HELPER_BINARY: &str = "container-helper";

#[cfg(target_os = "macos")]
pub struct AppleContainerSandbox;

#[cfg(target_os = "macos")]
impl AppleContainerSandbox {
    /// Check if the macOS version is 26.0 (Tahoe) or later.
    async fn is_macos_26_or_later() -> bool {
        match tokio::process::Command::new("sw_vers")
            .args(["-productVersion"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
        {
            Ok(output) => {
                let version = String::from_utf8_lossy(&output.stdout);
                let trimmed = version.trim();
                let parts: Vec<&str> = trimmed.split('.').collect();
                if let Some(major) = parts.first() {
                    if let Ok(major_num) = major.parse::<u32>() {
                        return major_num >= 26;
                    }
                }
                log::info!(
                    "AppleContainerSandbox: could not parse macOS version: '{}'",
                    trimmed
                );
                false
            }
            Err(e) => {
                log::info!("AppleContainerSandbox: sw_vers failed: {}", e);
                false
            }
        }
    }

    /// Resolve the path to the container-helper binary from Tauri resources.
    fn helper_path() -> Option<std::path::PathBuf> {
        // Try the standard resource locations
        let candidates = [
            std::path::PathBuf::from("resources/bin").join(HELPER_BINARY),
            // In development, the binary might be at the src-tauri level
            std::path::PathBuf::from("src-tauri/resources/bin").join(HELPER_BINARY),
        ];

        for candidate in &candidates {
            if candidate.exists() {
                return Some(candidate.clone());
            }
        }

        // Try resolving relative to the current executable
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let resource_path = exe_dir.join("resources/bin").join(HELPER_BINARY);
                if resource_path.exists() {
                    return Some(resource_path);
                }
                // macOS .app bundle: Contents/MacOS/../Resources/
                let bundle_path = exe_dir
                    .join("../Resources/resources/bin")
                    .join(HELPER_BINARY);
                if bundle_path.exists() {
                    return Some(bundle_path);
                }
            }
        }

        None
    }
}

#[cfg(target_os = "macos")]
#[async_trait::async_trait]
impl Sandbox for AppleContainerSandbox {
    fn name(&self) -> &str {
        "Apple Containerization"
    }

    fn isolation_tier(&self) -> IsolationTier {
        IsolationTier::PlatformSandbox
    }

    async fn is_available(&self) -> bool {
        if !Self::is_macos_26_or_later().await {
            log::info!("AppleContainerSandbox: macOS version < 26");
            return false;
        }

        if Self::helper_path().is_none() {
            log::info!("AppleContainerSandbox: container-helper binary not found");
            return false;
        }

        true
    }

    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String> {
        let helper = Self::helper_path()
            .ok_or("container-helper binary not found in resources")?;

        log::info!(
            "AppleContainerSandbox: starting via {:?}",
            helper
        );

        let output = tokio::process::Command::new(&helper)
            .args([
                "start",
                "--config-dir",
                &config.config_dir.to_string_lossy(),
                "--port",
                &config.port.to_string(),
                "--jan-api-url",
                &config.jan_api_url,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run container-helper: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("container-helper start failed: {}", stderr));
        }

        // Parse JSON output: {"container_id": "..."}
        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse container-helper output: {}", e))?;

        let container_id = parsed
            .get("container_id")
            .and_then(|v| v.as_str())
            .ok_or("container-helper did not return container_id")?
            .to_string();

        log::info!(
            "AppleContainerSandbox: started container '{}'",
            container_id
        );
        Ok(SandboxHandle::Named(container_id))
    }

    async fn stop(&self, handle: &mut SandboxHandle) -> Result<(), String> {
        let container_id = match handle {
            SandboxHandle::Named(id) => id.clone(),
            _ => return Err("Invalid handle for AppleContainerSandbox".to_string()),
        };

        let helper = Self::helper_path()
            .ok_or("container-helper binary not found")?;

        log::info!(
            "AppleContainerSandbox: stopping container '{}'",
            container_id
        );

        let output = tokio::process::Command::new(&helper)
            .args(["stop", "--container-id", &container_id])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run container-helper stop: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("AppleContainerSandbox: stop returned error: {}", stderr);
        }

        Ok(())
    }

    async fn status(&self, handle: &SandboxHandle) -> Result<SandboxStatus, String> {
        // Primary check: port connectivity
        match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", super::OPENCLAW_PORT)).await {
            Ok(_) => return Ok(SandboxStatus::Running),
            Err(_) => {}
        }

        // Secondary check: ask the helper
        let container_id = match handle {
            SandboxHandle::Named(id) => id.clone(),
            _ => return Ok(SandboxStatus::Unknown),
        };

        if let Some(helper) = Self::helper_path() {
            let output = tokio::process::Command::new(&helper)
                .args(["status", "--container-id", &container_id])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await;

            if let Ok(output) = output {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                        if parsed.get("running").and_then(|v| v.as_bool()) == Some(true) {
                            return Ok(SandboxStatus::Running);
                        }
                    }
                }
            }
        }

        Ok(SandboxStatus::Stopped)
    }

    async fn logs(
        &self,
        handle: &SandboxHandle,
        lines: usize,
    ) -> Result<Vec<String>, String> {
        let container_id = match handle {
            SandboxHandle::Named(id) => id.clone(),
            _ => return Ok(vec!["Invalid handle".to_string()]),
        };

        let helper = match Self::helper_path() {
            Some(p) => p,
            None => return Ok(vec!["container-helper not found".to_string()]),
        };

        let output = tokio::process::Command::new(&helper)
            .args([
                "logs",
                "--container-id",
                &container_id,
                "--lines",
                &lines.to_string(),
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to read container logs: {}", e))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Try to parse as JSON array, fall back to raw lines
            if let Ok(log_lines) = serde_json::from_str::<Vec<String>>(stdout.trim()) {
                Ok(log_lines)
            } else {
                Ok(stdout.lines().map(String::from).collect())
            }
        } else {
            Ok(vec![
                "Failed to retrieve logs from Apple Container sandbox.".to_string(),
            ])
        }
    }
}
