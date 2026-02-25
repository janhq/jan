pub mod cli;
pub mod commands;
pub mod constants;
pub mod models;
pub mod security;
pub mod tailscale;
pub mod tunnels;

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

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
    /// Process handle for the OpenClaw gateway
    pub process_handle: Arc<Mutex<Option<tokio::process::Child>>>,
    /// Tunnel state for managing tunnel processes
    pub tunnel_state: TunnelState,
}

impl Default for OpenClawState {
    fn default() -> Self {
        Self {
            process_handle: Arc::new(Mutex::new(None)),
            tunnel_state: TunnelState::default(),
        }
    }
}