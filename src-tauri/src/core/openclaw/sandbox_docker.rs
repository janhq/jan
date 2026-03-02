/// Docker/Podman sandbox using Bollard (pure Rust Docker API client).
///
/// This is an optional Tier 3 sandbox — only used if Docker is already installed.
/// Jan never prompts users to install Docker. Bollard also works with Podman's
/// Docker-compatible socket, so this implementation covers both.
///
/// Security hardening (Phase 3):
/// - cap_drop: ALL — drop all Linux capabilities
/// - cap_add: NET_BIND_SERVICE only — minimum needed for port binding
/// - readonly_rootfs: true — container filesystem is read-only
/// - tmpfs at /tmp — writable scratch space (noexec, nosuid)
/// - no-new-privileges — prevent privilege escalation via setuid binaries
/// - pids_limit: 256 — prevent fork bombs
/// - memory: 512MB — prevent memory exhaustion
/// - nano_cpus: 1 CPU — prevent CPU starvation of host
/// - seccomp profile — custom syscall allowlist loaded from resources
///
/// Network model: Docker uses network isolation. The config patching in
/// `lifecycle.rs` replaces `localhost:1337` with `host.docker.internal:1337`
/// for `IsolationTier::FullContainer`.
#[cfg(feature = "docker")]
use std::collections::HashMap;

#[cfg(feature = "docker")]
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, LogsOptions, RemoveContainerOptions,
    StartContainerOptions, StopContainerOptions,
};
#[cfg(feature = "docker")]
use bollard::image::CreateImageOptions;
#[cfg(feature = "docker")]
use bollard::models::{HostConfig, PortBinding, PortMap};
#[cfg(feature = "docker")]
use futures::StreamExt;

#[cfg(feature = "docker")]
use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

#[cfg(feature = "docker")]
const CONTAINER_NAME: &str = "jan-openclaw";

#[cfg(feature = "docker")]
const IMAGE_NAME: &str = "ghcr.io/janhq/openclaw:latest";

#[cfg(feature = "docker")]
pub struct DockerSandbox;

#[cfg(feature = "docker")]
impl DockerSandbox {
    pub fn new() -> Self {
        Self
    }

    async fn get_client() -> Result<bollard::Docker, String> {
        bollard::Docker::connect_with_local_defaults()
            .map_err(|e| format!("Failed to connect to Docker: {}", e))
    }

    /// Check if the jan-openclaw container already exists (running or stopped).
    async fn container_exists(client: &bollard::Docker) -> bool {
        let mut filters = HashMap::new();
        filters.insert("name", vec![CONTAINER_NAME]);

        let options = ListContainersOptions {
            all: true,
            filters,
            ..Default::default()
        };

        match client.list_containers(Some(options)).await {
            Ok(containers) => !containers.is_empty(),
            Err(_) => false,
        }
    }

    /// Check if the image exists locally.
    async fn image_exists(client: &bollard::Docker) -> bool {
        client.inspect_image(IMAGE_NAME).await.is_ok()
    }

    /// Load the custom seccomp profile from the resources directory.
    /// Returns the JSON string if found, None otherwise.
    /// The Docker daemon will use its default seccomp profile as fallback.
    fn load_seccomp_profile() -> Option<String> {
        // Try resource locations
        let candidates = [
            std::path::PathBuf::from("resources/openclaw-seccomp.json"),
            std::path::PathBuf::from("src-tauri/resources/openclaw-seccomp.json"),
        ];

        for candidate in &candidates {
            if let Ok(content) = std::fs::read_to_string(candidate) {
                return Some(content);
            }
        }

        // Try relative to current executable (production builds)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let resource_path = exe_dir.join("resources/openclaw-seccomp.json");
                if let Ok(content) = std::fs::read_to_string(&resource_path) {
                    return Some(content);
                }
                // macOS .app bundle
                let bundle_path = exe_dir.join("../Resources/resources/openclaw-seccomp.json");
                if let Ok(content) = std::fs::read_to_string(&bundle_path) {
                    return Some(content);
                }
            }
        }

        log::info!("DockerSandbox: seccomp profile not found, using Docker default");
        None
    }

    /// Pull the OpenClaw image.
    async fn pull_image(client: &bollard::Docker) -> Result<(), String> {
        log::info!("DockerSandbox: pulling image {}", IMAGE_NAME);

        let options = CreateImageOptions {
            from_image: IMAGE_NAME,
            ..Default::default()
        };

        let mut stream = client.create_image(Some(options), None, None);

        while let Some(result) = stream.next().await {
            match result {
                Ok(info) => {
                    if let Some(status) = info.status {
                        log::debug!("DockerSandbox: pull: {}", status);
                    }
                }
                Err(e) => {
                    return Err(format!("Failed to pull image {}: {}", IMAGE_NAME, e));
                }
            }
        }

        log::info!("DockerSandbox: image pulled successfully");
        Ok(())
    }
}

#[cfg(feature = "docker")]
#[async_trait::async_trait]
impl Sandbox for DockerSandbox {
    fn name(&self) -> &str {
        "Docker"
    }

    fn isolation_tier(&self) -> IsolationTier {
        IsolationTier::FullContainer
    }

    async fn is_available(&self) -> bool {
        match Self::get_client().await {
            Ok(client) => {
                match client.ping().await {
                    Ok(_) => {
                        log::info!("DockerSandbox: Docker daemon is responsive");
                        true
                    }
                    Err(e) => {
                        log::info!("DockerSandbox: Docker ping failed: {}", e);
                        false
                    }
                }
            }
            Err(e) => {
                log::info!("DockerSandbox: {}", e);
                false
            }
        }
    }

    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String> {
        let client = Self::get_client().await?;

        // Pull image if not present
        if !Self::image_exists(&client).await {
            Self::pull_image(&client).await?;
        }

        // Remove existing container if it exists (stopped from a previous run)
        if Self::container_exists(&client).await {
            log::info!("DockerSandbox: removing existing container '{}'", CONTAINER_NAME);
            let _ = client
                .remove_container(
                    CONTAINER_NAME,
                    Some(RemoveContainerOptions {
                        force: true,
                        ..Default::default()
                    }),
                )
                .await;
        }

        // Build port bindings: 127.0.0.1:18789 -> 18789/tcp
        let port_key = format!("{}/tcp", config.port);
        let mut port_bindings: PortMap = HashMap::new();
        port_bindings.insert(
            port_key.clone(),
            Some(vec![PortBinding {
                host_ip: Some("127.0.0.1".to_string()),
                host_port: Some(config.port.to_string()),
            }]),
        );

        // Build environment variables
        let mut env_vars: Vec<String> = config
            .env_vars
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        // Override config path for inside the container
        env_vars.push("OPENCLAW_CONFIG=/root/.openclaw/openclaw.json".to_string());

        // Build volume bind: ~/.openclaw -> /root/.openclaw
        let host_config_dir = config.config_dir.to_string_lossy();
        let binds = vec![format!("{}:/root/.openclaw", host_config_dir)];

        // Build extra hosts for Docker-to-host networking
        let extra_hosts = vec!["host.docker.internal:host-gateway".to_string()];

        // Security: tmpfs mount at /tmp (writable scratch, noexec)
        let mut tmpfs = HashMap::new();
        tmpfs.insert(
            "/tmp".to_string(),
            "rw,noexec,nosuid,size=65536k".to_string(),
        );

        // Security: load custom seccomp profile if available
        let seccomp_profile = Self::load_seccomp_profile();
        let mut security_opt = vec!["no-new-privileges".to_string()];
        if let Some(profile_json) = seccomp_profile {
            security_opt.push(format!("seccomp={}", profile_json));
            log::info!("DockerSandbox: custom seccomp profile loaded");
        }

        let host_config = HostConfig {
            port_bindings: Some(port_bindings),
            binds: Some(binds),
            extra_hosts: Some(extra_hosts),
            // Security hardening
            cap_drop: Some(vec!["ALL".to_string()]),
            cap_add: Some(vec!["NET_BIND_SERVICE".to_string()]),
            readonly_rootfs: Some(true),
            tmpfs: Some(tmpfs),
            security_opt: Some(security_opt),
            pids_limit: Some(256),
            memory: Some(512 * 1024 * 1024), // 512 MB in bytes
            nano_cpus: Some(1_000_000_000),   // 1 CPU
            ..Default::default()
        };

        let mut exposed_ports = HashMap::new();
        exposed_ports.insert(port_key, HashMap::new());

        let container_config = Config {
            image: Some(IMAGE_NAME.to_string()),
            env: Some(env_vars),
            exposed_ports: Some(exposed_ports),
            host_config: Some(host_config),
            ..Default::default()
        };

        let options = CreateContainerOptions {
            name: CONTAINER_NAME,
            platform: None,
        };

        log::info!("DockerSandbox: creating container '{}'", CONTAINER_NAME);
        client
            .create_container(Some(options), container_config)
            .await
            .map_err(|e| format!("Failed to create Docker container: {}", e))?;

        log::info!("DockerSandbox: starting container '{}'", CONTAINER_NAME);
        client
            .start_container(CONTAINER_NAME, None::<StartContainerOptions<String>>)
            .await
            .map_err(|e| format!("Failed to start Docker container: {}", e))?;

        Ok(SandboxHandle::Named(CONTAINER_NAME.to_string()))
    }

    async fn stop(&self, _handle: &mut SandboxHandle) -> Result<(), String> {
        let client = Self::get_client().await?;

        log::info!("DockerSandbox: stopping container '{}'", CONTAINER_NAME);

        // Stop with a 10-second grace period
        let _ = client
            .stop_container(
                CONTAINER_NAME,
                Some(StopContainerOptions { t: 10 }),
            )
            .await;

        // Remove the container
        let _ = client
            .remove_container(
                CONTAINER_NAME,
                Some(RemoveContainerOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await;

        log::info!("DockerSandbox: container '{}' stopped and removed", CONTAINER_NAME);
        Ok(())
    }

    async fn status(&self, _handle: &SandboxHandle) -> Result<SandboxStatus, String> {
        let client = match Self::get_client().await {
            Ok(c) => c,
            Err(_) => return Ok(SandboxStatus::Unknown),
        };

        match client.inspect_container(CONTAINER_NAME, None).await {
            Ok(info) => {
                if let Some(state) = info.state {
                    if state.running == Some(true) {
                        return Ok(SandboxStatus::Running);
                    }
                    if let Some(error) = state.error {
                        if !error.is_empty() {
                            return Ok(SandboxStatus::Failed { error });
                        }
                    }
                }
                Ok(SandboxStatus::Stopped)
            }
            Err(_) => Ok(SandboxStatus::Stopped),
        }
    }

    async fn logs(
        &self,
        _handle: &SandboxHandle,
        lines: usize,
    ) -> Result<Vec<String>, String> {
        let client = Self::get_client().await?;

        let options = LogsOptions::<String> {
            stdout: true,
            stderr: true,
            tail: lines.to_string(),
            ..Default::default()
        };

        let mut stream = client.logs(CONTAINER_NAME, Some(options));
        let mut log_lines = Vec::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(output) => {
                    log_lines.push(output.to_string());
                }
                Err(e) => {
                    log::warn!("DockerSandbox: error reading logs: {}", e);
                    break;
                }
            }
        }

        Ok(log_lines)
    }
}
