pub mod cli;
pub mod commands;
pub mod constants;
pub mod health;
pub mod lifecycle;
pub mod models;
pub mod sandbox;
pub mod sandbox_direct;
#[cfg(target_os = "linux")]
pub mod sandbox_native;
#[cfg(target_os = "windows")]
pub mod sandbox_wsl2;
#[cfg(target_os = "macos")]
pub mod sandbox_apple;
#[cfg(feature = "docker")]
pub mod sandbox_docker;
pub mod security;
pub mod tailscale;
pub mod tunnels;

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use sandbox::{Sandbox, SandboxMode};
use tunnels::TunnelState;

/// OpenClaw configuration directory
pub fn get_openclaw_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = home.join(".openclaw");
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir)
}

/// OpenClaw configuration file path
pub fn get_openclaw_config_path() -> Result<PathBuf, String> {
    Ok(get_openclaw_config_dir()?.join("openclaw.json"))
}

/// OpenClaw gateway port
pub const OPENCLAW_PORT: u16 = 18789;

/// Minimum Node.js version required (22+)
pub const MIN_NODE_VERSION: u32 = 22;

/// OpenClaw Manager state
pub struct OpenClawState {
    /// Tunnel state for managing tunnel processes
    pub tunnel_state: TunnelState,
    /// Current sandbox mode (inactive or active with handle)
    pub sandbox_mode: Arc<Mutex<SandboxMode>>,
    /// Detected sandbox implementation (set once on first use via detect_sandbox())
    pub sandbox: Arc<Mutex<Option<Box<dyn Sandbox>>>>,
}

impl Default for OpenClawState {
    fn default() -> Self {
        Self {
            tunnel_state: TunnelState::default(),
            sandbox_mode: Arc::new(Mutex::new(SandboxMode::Inactive)),
            sandbox: Arc::new(Mutex::new(None)),
        }
    }
}
