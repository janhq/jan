use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Configuration passed to any sandbox implementation.
/// Platform-agnostic — no Docker-specific, WSL-specific, or namespace-specific fields.
pub struct SandboxConfig {
    /// Path to the OpenClaw config directory on the host (~/.openclaw/)
    pub config_dir: PathBuf,
    /// The port OpenClaw should listen on
    pub port: u16,
    /// The Jan API base URL that OpenClaw should connect to
    pub jan_api_url: String,
    /// Environment variables to pass to the OpenClaw process
    pub env_vars: Vec<(String, String)>,
}

/// Opaque handle returned by `start()`. Each implementation stores what it needs.
pub enum SandboxHandle {
    /// PID-based handle (Linux namespaces, macOS)
    Pid(u32),
    /// Named handle (WSL2 distro name, Docker container name)
    Named(String),
    /// Process handle for direct process fallback
    Process(tokio::process::Child),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SandboxStatus {
    Running,
    Stopped,
    Failed { error: String },
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IsolationTier {
    /// Tier 0: No isolation (direct process)
    None,
    /// Tier 2: Namespace/VM isolation (bubblewrap, WSL2, Apple Containerization)
    PlatformSandbox,
    /// Tier 3: Full OCI container (Docker/Podman)
    FullContainer,
}

impl std::fmt::Display for IsolationTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IsolationTier::None => write!(f, "none"),
            IsolationTier::PlatformSandbox => write!(f, "platform_sandbox"),
            IsolationTier::FullContainer => write!(f, "full_container"),
        }
    }
}

#[async_trait::async_trait]
pub trait Sandbox: Send + Sync {
    /// Human-readable name for this sandbox type
    fn name(&self) -> &str;

    /// The isolation tier this sandbox provides
    fn isolation_tier(&self) -> IsolationTier;

    /// Returns true if this sandbox mechanism is available on the current system
    async fn is_available(&self) -> bool;

    /// Start OpenClaw in the sandbox. Returns a handle for subsequent operations.
    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String>;

    /// Stop the sandboxed OpenClaw process.
    async fn stop(&self, handle: &mut SandboxHandle) -> Result<(), String>;

    /// Check current status of the sandboxed process.
    async fn status(&self, handle: &SandboxHandle) -> Result<SandboxStatus, String>;

    /// Retrieve recent log lines from the sandboxed process.
    async fn logs(&self, handle: &SandboxHandle, lines: usize) -> Result<Vec<String>, String>;
}

/// Active sandbox mode — stored in OpenClawState.
pub enum SandboxMode {
    /// No sandbox active
    Inactive,
    /// Sandbox is running
    Active {
        sandbox_name: String,
        isolation_tier: IsolationTier,
        handle: SandboxHandle,
    },
}

/// Auto-detect the best available sandbox for the current platform.
/// Returns implementations in priority order: best isolation first.
///
/// Priority chain:
///   1. Docker/Podman (Tier 3) — best isolation, optional
///   2. Platform-native (Tier 2) — Linux namespaces / WSL2 / Apple Containerization
///   3. Direct process (Tier 0) — always-available fallback
pub async fn detect_sandbox() -> Box<dyn Sandbox> {
    // Tier 3: Docker/Podman (if available — best isolation, optional)
    #[cfg(feature = "docker")]
    {
        let docker = super::sandbox_docker::DockerSandbox::new();
        if docker.is_available().await {
            log::info!("Sandbox: Docker detected");
            return Box::new(docker);
        }
    }

    // Tier 2: Platform-native lightweight sandbox
    #[cfg(target_os = "linux")]
    {
        let native = super::sandbox_native::NativeSandbox;
        if native.is_available().await {
            log::info!("Sandbox: Linux namespaces (bubblewrap-style)");
            return Box::new(native);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let wsl2 = super::sandbox_wsl2::Wsl2Sandbox::new();
        if wsl2.is_available().await {
            log::info!("Sandbox: WSL2");
            return Box::new(wsl2);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let apple = super::sandbox_apple::AppleContainerSandbox;
        if apple.is_available().await {
            log::info!("Sandbox: Apple Containerization");
            return Box::new(apple);
        }
    }

    // Tier 0: No isolation (direct process fallback)
    log::info!("Sandbox: none available, using direct process");
    Box::new(super::sandbox_direct::DirectProcessSandbox)
}
