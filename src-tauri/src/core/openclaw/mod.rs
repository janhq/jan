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

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use sandbox::{Sandbox, SandboxMode};
use tunnels::TunnelState;

/// When true, config dir resolves to `~/.openclaw/sandbox/docker/` instead of `~/.openclaw/`.
static DOCKER_MODE_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn set_docker_mode(active: bool) {
    DOCKER_MODE_ACTIVE.store(active, Ordering::SeqCst);
}

pub fn is_docker_mode() -> bool {
    DOCKER_MODE_ACTIVE.load(Ordering::SeqCst)
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
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let runtime_dir = home.join(".jan").join("openclaw-runtime");
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

pub fn ensure_bun_node_shim() -> Result<(), String> {
    let bun_path = resolve_bundled_bun().ok_or("Bundled Bun not found")?;
    let runtime_dir = get_openclaw_runtime_dir()?;
    let runtime_bin = runtime_dir.join("bin");
    std::fs::create_dir_all(&runtime_bin).map_err(|e| e.to_string())?;

    let node_shim = if cfg!(target_os = "windows") {
        runtime_bin.join("node.exe")
    } else {
        runtime_bin.join("node")
    };

    #[cfg(unix)]
    {
        if node_shim.exists() || node_shim.symlink_metadata().is_ok() {
            if let Ok(target) = std::fs::read_link(&node_shim) {
                if target == bun_path {
                    return Ok(());
                }
            }
            let _ = std::fs::remove_file(&node_shim);
        }

        // AppImage: copy instead of symlink (mount path is ephemeral)
        #[cfg(target_os = "linux")]
        {
            if std::env::var("APPIMAGE").is_ok() {
                std::fs::copy(&bun_path, &node_shim)
                    .map_err(|e| format!("Failed to copy bun as node: {}", e))?;
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &node_shim,
                    std::fs::Permissions::from_mode(0o755),
                );
                return Ok(());
            }
        }

        std::os::unix::fs::symlink(&bun_path, &node_shim)
            .map_err(|e| format!("Failed to create node->bun symlink: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        let bun_modified = std::fs::metadata(&bun_path)
            .and_then(|m| m.modified())
            .ok();

        for shim in &[node_shim, runtime_bin.join("bun.exe")] {
            let needs_copy = if shim.exists() {
                let shim_modified = std::fs::metadata(shim)
                    .and_then(|m| m.modified())
                    .ok();
                match (bun_modified, shim_modified) {
                    (Some(b), Some(s)) => b > s,
                    _ => true,
                }
            } else {
                true
            };

            if needs_copy {
                std::fs::copy(&bun_path, shim)
                    .map_err(|e| format!("Failed to copy bun to {}: {}", shim.display(), e))?;
            }
        }
    }

    Ok(())
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
