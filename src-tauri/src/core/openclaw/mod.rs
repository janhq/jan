pub mod cli;
pub mod commands;
pub mod constants;
pub mod health;
pub mod lifecycle;
pub mod models;
pub mod sandbox;
pub mod sandbox_direct;
#[cfg(feature = "docker")]
pub mod sandbox_docker;
pub mod security;
pub mod tailscale;
pub mod tunnels;

#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use sandbox::{Sandbox, SandboxMode};
use tunnels::TunnelState;

static DOCKER_MODE_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn set_docker_mode(active: bool) {
    DOCKER_MODE_ACTIVE.store(active, Ordering::SeqCst);
}

pub fn is_docker_mode() -> bool {
    DOCKER_MODE_ACTIVE.load(Ordering::SeqCst)
}

/// Base directory for all OpenClaw data, rooted under Jan's data folder.
/// Returns `<jan_data_folder>/openclaw/`.
pub fn get_openclaw_base_dir() -> Result<PathBuf, String> {
    let jan_data = crate::core::app::commands::resolve_jan_data_folder();
    let base = jan_data.join("openclaw");
    if !base.exists() {
        std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    }
    Ok(base)
}

/// OpenClaw configuration directory, isolated per sandbox mode.
pub fn get_openclaw_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = if is_docker_mode() {
        home.join(".openclaw").join("sandbox").join("docker")
    } else {
        home.join(".openclaw")
    };
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

/// Minimum Bun version required
pub const MIN_BUN_VERSION: &str = "1.0";

/// OpenClaw runtime directory (where Bun and OpenClaw are installed)
pub fn get_openclaw_runtime_dir() -> Result<std::path::PathBuf, String> {
    let base = get_openclaw_base_dir()?;
    let runtime_dir = base.join("bunx");
    if !runtime_dir.exists() {
        std::fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;
    }
    Ok(runtime_dir)
}

/// Path to the OpenClaw binary in the runtime directory
pub fn get_openclaw_bin_path() -> Result<std::path::PathBuf, String> {
    let runtime_dir = get_openclaw_runtime_dir()?;
    let bin_path = if cfg!(target_os = "windows") {
        runtime_dir.join("bin").join("openclaw.exe")
    } else {
        runtime_dir.join("bin").join("openclaw")
    };
    Ok(bin_path)
}

/// Resolve the bundled Bun path. Returns None if unavailable.
///
/// Looks for bun next to the current executable (same approach as MCP).
pub fn resolve_bundled_bun() -> Option<std::path::PathBuf> {
    let bun_name = if cfg!(target_os = "windows") { "bun.exe" } else { "bun" };

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(bin_path) = exe_path.parent() {
            let candidate = bin_path.join(bun_name);
            if candidate.exists() {
                let s = candidate.to_string_lossy().to_string();
                if jan_utils::system::can_override_npx(s) {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

pub const PATH_SEPARATOR: &str = if cfg!(target_os = "windows") { ";" } else { ":" };

/// Prepend bundled Bun dir and openclaw-runtime/bin to PATH.
pub fn build_augmented_path() -> Option<String> {
    let mut path_entries = Vec::new();
    if let Some(bun_path) = resolve_bundled_bun() {
        if let Some(bun_dir) = bun_path.parent() {
            path_entries.push(bun_dir.to_string_lossy().to_string());
        }
    }
    if let Ok(runtime_dir) = get_openclaw_runtime_dir() {
        path_entries.push(runtime_dir.join("bin").to_string_lossy().to_string());
    }
    if path_entries.is_empty() {
        return None;
    }
    let current_path = std::env::var("PATH").unwrap_or_default();
    Some(format!(
        "{}{}{}",
        path_entries.join(PATH_SEPARATOR),
        PATH_SEPARATOR,
        current_path
    ))
}

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
