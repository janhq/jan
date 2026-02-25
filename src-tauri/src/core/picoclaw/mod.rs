pub mod commands;
pub mod constants;
pub mod models;

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

/// PicoClaw configuration directory
pub fn get_picoclaw_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = home.join(".picoclaw");
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir)
}

/// PicoClaw configuration file path
pub fn get_picoclaw_config_path() -> Result<PathBuf, String> {
    Ok(get_picoclaw_config_dir()?.join("config.json"))
}

/// PicoClaw binary path (stored in config directory)
pub fn get_picoclaw_binary_path() -> Result<PathBuf, String> {
    Ok(get_picoclaw_config_dir()?.join(constants::PICOCLAW_BINARY_NAME))
}

/// PicoClaw gateway port
pub const DEFAULT_PICOCLAW_PORT: u16 = constants::DEFAULT_PICOCLAW_PORT;

/// PicoClaw Manager state
pub struct PicoClawState {
    /// Process handle for the PicoClaw gateway
    pub process_handle: Arc<Mutex<Option<tokio::process::Child>>>,
}

impl Default for PicoClawState {
    fn default() -> Self {
        Self {
            process_handle: Arc::new(Mutex::new(None)),
        }
    }
}
