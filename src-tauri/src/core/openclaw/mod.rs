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

/// Resolve the bundled Bun path.
///
/// Platform-specific resolution:
/// - **macOS / Windows**: Tauri `externalBin` places `bun` (or `bun.exe`) next to the
///   main executable — same directory as `std::env::current_exe().parent()`.
/// - **Linux (deb)**: Bun is installed to `/usr/bin/bun` via the deb package's `files`
///   mapping, not as an `externalBin`. So we also check `/usr/bin/bun`.
/// - **Linux (AppImage)**: The binary may be next to the executable inside the
///   AppImage mount, so the `exe_path.parent()` check covers it.
///
/// Returns None if bun doesn't exist or can't run on this machine.
pub fn resolve_bundled_bun() -> Option<std::path::PathBuf> {
    let bun_name = if cfg!(target_os = "windows") { "bun.exe" } else { "bun" };

    // 1. Check next to the executable (macOS, Windows, Linux AppImage, dev mode)
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

    // 2. Linux deb: bun is installed to /usr/bin/bun via package files mapping
    #[cfg(target_os = "linux")]
    {
        let system_bun = std::path::PathBuf::from("/usr/bin/bun");
        if system_bun.exists() {
            let s = system_bun.to_string_lossy().to_string();
            if jan_utils::system::can_override_npx(s) {
                return Some(system_bun);
            }
        }
    }

    None
}

/// Ensure a `node` symlink (or copy on Windows) exists in the runtime bin directory
/// pointing to the bundled Bun binary. This is critical because:
/// - `openclaw gateway install` registers a launchd/systemd service
/// - The service plist hardcodes the absolute path to `node` (resolved via shebang)
/// - If bun's directory is first in PATH and contains a `node` symlink, the service
///   will use bun as its runtime instead of requiring a separate Node.js installation
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
        // Check if shim already exists and points to the correct bun binary
        if node_shim.exists() || node_shim.symlink_metadata().is_ok() {
            if let Ok(target) = std::fs::read_link(&node_shim) {
                if target == bun_path {
                    return Ok(());
                }
            }
            // Stale or non-symlink — remove and recreate
            let _ = std::fs::remove_file(&node_shim);
        }

        // Linux AppImage: mount path is ephemeral (/tmp/.mount_JanXXX/), so copy
        // instead of symlinking to ensure the shim survives after AppImage unmounts.
        #[cfg(target_os = "linux")]
        {
            if std::env::var("APPIMAGE").is_ok() {
                std::fs::copy(&bun_path, &node_shim)
                    .map_err(|e| format!("Failed to copy bun as node (AppImage): {}", e))?;
                // Ensure executable permission on the copy
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
        // Windows symlinks require elevated privileges; copy instead.
        // Re-copy if bun.exe is newer than our node.exe copy.
        let needs_copy = if node_shim.exists() {
            let bun_modified = std::fs::metadata(&bun_path)
                .and_then(|m| m.modified())
                .ok();
            let shim_modified = std::fs::metadata(&node_shim)
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
            std::fs::copy(&bun_path, &node_shim)
                .map_err(|e| format!("Failed to copy bun as node: {}", e))?;
        }
    }

    Ok(())
}

/// Platform-aware PATH separator (";" on Windows, ":" elsewhere).
pub const PATH_SEPARATOR: &str = if cfg!(target_os = "windows") { ";" } else { ":" };

/// Build a new PATH string by prepending the bundled Bun directory and the
/// openclaw-runtime/bin directory to the current PATH. Returns None if no
/// extra entries are available.
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
