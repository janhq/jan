/// WSL2-based sandbox for Windows.
///
/// Uses the `wsl` CLI to manage a dedicated "Jan.OpenClaw" WSL2 distribution.
/// The distribution runs a minimal Linux environment with OpenClaw installed.
/// WSL2 provides VM-level isolation (separate Linux kernel in Hyper-V).
///
/// Security hardening (Phase 3):
/// - Non-root user: OpenClaw runs as `openclaw` user (UID 1001) inside the distro
/// - Resource limits: ulimit -v (memory), ulimit -n (files), ulimit -u (procs)
/// - WSL2 already provides VM-level isolation (Hyper-V lightweight VM)
/// - Users can further limit resources via .wslconfig (memory, processors)
///
/// Network model: WSL2 default NAT mode — the guest can reach the Windows host
/// via `localhost`, so Jan's API at `localhost:1337` is accessible without
/// config patching.
#[cfg(target_os = "windows")]
use std::process::Stdio;

#[cfg(target_os = "windows")]
use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

#[cfg(target_os = "windows")]
const DISTRO_NAME: &str = "Jan.OpenClaw";

#[cfg(target_os = "windows")]
pub struct Wsl2Sandbox {
    distro_name: String,
}

#[cfg(target_os = "windows")]
impl Wsl2Sandbox {
    pub fn new() -> Self {
        Self {
            distro_name: DISTRO_NAME.to_string(),
        }
    }

    /// Check if WSL2 is available by probing wslapi.dll and running wsl --status.
    async fn check_wsl2_available() -> bool {
        // Step 1: Verify wslapi.dll exists (means WSL feature is installed)
        if unsafe { libloading::Library::new("wslapi.dll") }.is_err() {
            log::info!("Wsl2Sandbox: wslapi.dll not available");
            return false;
        }

        // Step 2: Verify WSL2 is functional by running wsl --status
        match tokio::process::Command::new("wsl")
            .args(["--status"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
        {
            Ok(output) => {
                if !output.status.success() {
                    log::info!("Wsl2Sandbox: wsl --status failed");
                    return false;
                }
                true
            }
            Err(e) => {
                log::info!("Wsl2Sandbox: failed to run wsl --status: {}", e);
                false
            }
        }
    }

    /// Check if the Jan.OpenClaw distribution is registered.
    async fn is_distro_registered(&self) -> bool {
        match tokio::process::Command::new("wsl")
            .args(["--list", "--quiet"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout
                    .lines()
                    .any(|line| line.trim() == self.distro_name)
            }
            Err(_) => false,
        }
    }

    /// Get the installation directory for the WSL2 distro.
    fn install_dir(&self) -> std::path::PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("C:\\"))
            .join("Jan")
            .join("wsl")
            .join(&self.distro_name)
    }

    /// Get the expected rootfs path from Tauri resources.
    fn rootfs_path(&self) -> std::path::PathBuf {
        // The rootfs tar.gz is expected in the resources/wsl/ directory.
        // This is a build-time artifact — if not present, start() fails gracefully.
        std::path::PathBuf::from("resources")
            .join("wsl")
            .join("jan-openclaw-rootfs.tar.gz")
    }

    /// Register the distro from a rootfs tar.gz.
    async fn register_distro(&self, rootfs_path: &std::path::Path) -> Result<(), String> {
        let install_dir = self.install_dir();
        std::fs::create_dir_all(&install_dir)
            .map_err(|e| format!("Failed to create WSL install dir: {}", e))?;

        let output = tokio::process::Command::new("wsl")
            .args([
                "--import",
                &self.distro_name,
                &install_dir.to_string_lossy(),
                &rootfs_path.to_string_lossy(),
                "--version",
                "2",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to register WSL2 distro: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("WSL2 distro registration failed: {}", stderr));
        }

        log::info!(
            "Wsl2Sandbox: registered distro '{}' from {:?}",
            self.distro_name,
            rootfs_path
        );
        Ok(())
    }

    /// Set up security inside the distro after import.
    /// Creates a non-root `openclaw` user (UID 1001) and sets it as the default user.
    async fn setup_distro_security(&self) -> Result<(), String> {
        // Create the openclaw user if it doesn't exist
        let setup_script = concat!(
            "id -u openclaw >/dev/null 2>&1 || ",
            "(addgroup -g 1001 openclaw 2>/dev/null || true; ",
            "adduser -u 1001 -G openclaw -s /bin/sh -D openclaw 2>/dev/null || true; ",
            "mkdir -p /home/openclaw/.openclaw; ",
            "chown -R openclaw:openclaw /home/openclaw)"
        );

        let output = tokio::process::Command::new("wsl")
            .args([
                "-d",
                &self.distro_name,
                "--user",
                "root",
                "--",
                "sh",
                "-c",
                setup_script,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to setup distro security: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!(
                "Wsl2Sandbox: security setup had warnings (non-fatal): {}",
                stderr
            );
        }

        log::info!(
            "Wsl2Sandbox: security setup complete for distro '{}'",
            self.distro_name
        );
        Ok(())
    }

    /// Convert a Windows path to a WSL-compatible path.
    /// e.g., C:\Users\foo\.openclaw -> /mnt/c/Users/foo/.openclaw
    fn windows_to_wsl_path(win_path: &std::path::Path) -> String {
        let path_str = win_path.to_string_lossy();
        // Replace backslashes with forward slashes
        let unix_path = path_str.replace('\\', "/");
        // Convert drive letter: C:/... -> /mnt/c/...
        if unix_path.len() >= 2 && unix_path.as_bytes()[1] == b':' {
            let drive = unix_path.as_bytes()[0].to_ascii_lowercase() as char;
            format!("/mnt/{}/{}", drive, &unix_path[3..])
        } else {
            unix_path
        }
    }
}

#[cfg(target_os = "windows")]
#[async_trait::async_trait]
impl Sandbox for Wsl2Sandbox {
    fn name(&self) -> &str {
        "WSL2"
    }

    fn isolation_tier(&self) -> IsolationTier {
        IsolationTier::PlatformSandbox
    }

    async fn is_available(&self) -> bool {
        Self::check_wsl2_available().await
    }

    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String> {
        log::info!(
            "Wsl2Sandbox: starting OpenClaw in WSL2 distro '{}' (hardened)",
            self.distro_name
        );

        // Register distro if not already present
        if !self.is_distro_registered().await {
            let rootfs = self.rootfs_path();
            if !rootfs.exists() {
                return Err(format!(
                    "WSL2 rootfs not found at {:?}. \
                     The WSL2 sandbox requires a bundled rootfs which is not yet available. \
                     Falling back to direct process mode.",
                    rootfs
                ));
            }
            self.register_distro(&rootfs).await?;
        }

        // Security: set up non-root user inside the distro
        if let Err(e) = self.setup_distro_security().await {
            log::warn!("Wsl2Sandbox: security setup failed (non-fatal): {}", e);
        }

        // Convert the host config dir to a WSL-compatible path
        let wsl_config_dir = Self::windows_to_wsl_path(&config.config_dir);

        // Start OpenClaw inside the WSL2 distro as non-root user with resource limits.
        // The sh -c wrapper applies ulimit constraints before launching openclaw:
        //   ulimit -v 524288  : virtual memory limit (512 MB in KB)
        //   ulimit -n 4096    : max open file descriptors
        //   ulimit -u 256     : max user processes
        //   ulimit -c 0       : disable core dumps
        let start_script = format!(
            "ulimit -v 524288; ulimit -n 4096; ulimit -u 256; ulimit -c 0; \
             export OPENCLAW_CONFIG='{}/openclaw.json'; \
             exec openclaw gateway start",
            wsl_config_dir
        );

        let mut cmd = tokio::process::Command::new("wsl");
        cmd.args([
            "-d",
            &self.distro_name,
            "--user",
            "openclaw",
            "--",
            "sh",
            "-c",
            &start_script,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        // Pass environment variables
        for (key, value) in &config.env_vars {
            cmd.env(key, value);
        }

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("Failed to start OpenClaw in WSL2: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("OpenClaw start in WSL2 failed: {}", stderr));
        }

        log::info!(
            "Wsl2Sandbox: OpenClaw started in distro '{}' as user 'openclaw'",
            self.distro_name
        );
        Ok(SandboxHandle::Named(self.distro_name.clone()))
    }

    async fn stop(&self, _handle: &mut SandboxHandle) -> Result<(), String> {
        log::info!("Wsl2Sandbox: terminating distro '{}'", self.distro_name);

        // First try to gracefully stop OpenClaw inside the distro
        let _ = tokio::process::Command::new("wsl")
            .args([
                "-d",
                &self.distro_name,
                "--",
                "openclaw",
                "gateway",
                "stop",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        // Then terminate the entire distro
        let output = tokio::process::Command::new("wsl")
            .args(["--terminate", &self.distro_name])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to terminate WSL2 distro: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("Wsl2Sandbox: terminate returned error: {}", stderr);
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

    async fn logs(
        &self,
        _handle: &SandboxHandle,
        lines: usize,
    ) -> Result<Vec<String>, String> {
        let output = tokio::process::Command::new("wsl")
            .args([
                "-d",
                &self.distro_name,
                "--",
                "tail",
                "-n",
                &lines.to_string(),
                "/tmp/openclaw/gateway.log",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to read WSL2 logs: {}", e))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(stdout.lines().map(String::from).collect())
        } else {
            Ok(vec![
                "Log retrieval from WSL2 distro failed. Check /tmp/openclaw/ inside the distro."
                    .to_string(),
            ])
        }
    }
}
