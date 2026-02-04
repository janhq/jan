//! Discord bot configuration

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Discord bot settings that can be persisted
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordBotSettings {
    pub enabled: bool,
    pub bot_token: String,
    pub bot_user_id: String,
    pub channel_id: String,
    pub poll_interval_ms: u64,
}

impl Default for DiscordBotSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            bot_token: String::new(),
            bot_user_id: String::new(),
            channel_id: String::new(),
            poll_interval_ms: 1000, // Poll every 1 second by default
        }
    }
}

/// Save settings to file
pub fn save_settings(settings: &DiscordBotSettings) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .unwrap_or(PathBuf::from("~/.config"))
        .join("jan");

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;

    let config_path = config_dir.join("discord_bot_settings.json");
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    log::info!("[DiscordBot] Settings saved to {:?}", config_path);
    Ok(())
}

/// Load settings from file
pub fn load_settings() -> DiscordBotSettings {
    let config_dir = dirs::config_dir()
        .unwrap_or(PathBuf::from("~/.config"))
        .join("jan");

    let config_path = config_dir.join("discord_bot_settings.json");

    if config_path.exists() {
        match std::fs::read_to_string(&config_path) {
            Ok(json) => {
                serde_json::from_str(&json)
                    .unwrap_or_else(|_| {
                        log::warn!("[DiscordBot] Failed to parse settings, using defaults");
                        DiscordBotSettings::default()
                    })
            }
            Err(e) => {
                log::warn!("[DiscordBot] Failed to read settings: {}, using defaults", e);
                DiscordBotSettings::default()
            }
        }
    } else {
        DiscordBotSettings::default()
    }
}