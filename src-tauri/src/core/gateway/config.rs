use std::path::PathBuf;

use super::types::GatewayConfig;

const DEFAULT_HTTP_PORT: u16 = 4281;
const DEFAULT_WS_PORT: u16 = 4282;
const CONFIG_FILENAME: &str = "gateway.json";

/// Manages gateway configuration persistence
#[derive(Debug, Clone)]
pub struct GatewayConfigManager {
    config_path: PathBuf,
}

impl GatewayConfigManager {
    pub fn new(base_path: PathBuf) -> Self {
        let config_path = base_path.join(CONFIG_FILENAME);
        Self { config_path }
    }

    /// Load configuration from disk, or return defaults
    pub fn load(&self) -> Result<GatewayConfig, String> {
        if !self.config_path.exists() {
            return Ok(GatewayConfig::default());
        }

        let content = std::fs::read_to_string(&self.config_path)
            .map_err(|e| format!("Failed to read gateway config: {}", e))?;

        serde_json::from_str(&content).map_err(|e| format!("Failed to parse gateway config: {}", e))
    }

    /// Save configuration to disk
    pub fn save(&self, config: &GatewayConfig) -> Result<(), String> {
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize gateway config: {}", e))?;

        std::fs::write(&self.config_path, content)
            .map_err(|e| format!("Failed to write gateway config: {}", e))
    }

    /// Get the default configuration
    pub fn default_config() -> GatewayConfig {
        GatewayConfig {
            http_port: DEFAULT_HTTP_PORT,
            ws_port: DEFAULT_WS_PORT,
            enabled: false,
            whitelist: super::types::WhitelistConfig::default(),
            auto_create_threads: true,
            default_assistant_id: None,
            discord_webhook_url: None,
            discord_bot_token: None,
            telegram_bot_token: None,
            slack_bot_token: None,
            accounts: std::collections::HashMap::new(),
            auth_token: None,
        }
    }

    /// Validate configuration
    pub fn validate(&self, config: &GatewayConfig) -> Result<(), String> {
        if config.http_port < 1024 || config.http_port > 65535 {
            return Err(format!(
                "Invalid HTTP port: {}. Must be between 1024 and 65535.",
                config.http_port
            ));
        }

        if config.ws_port < 1024 || config.ws_port > 65535 {
            return Err(format!(
                "Invalid WebSocket port: {}. Must be between 1024 and 65535.",
                config.ws_port
            ));
        }

        if config.http_port == config.ws_port {
            return Err("HTTP and WebSocket ports cannot be the same.".to_string());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_load_default_when_not_exists() {
        let temp_dir = TempDir::new().unwrap();
        let manager = GatewayConfigManager::new(temp_dir.path().join("gateway.json"));

        let config = manager.load().unwrap();
        assert_eq!(config.http_port, DEFAULT_HTTP_PORT);
        assert_eq!(config.ws_port, DEFAULT_WS_PORT);
        assert!(!config.enabled);
    }

    #[test]
    fn test_save_and_load() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("gateway.json");
        let manager = GatewayConfigManager::new(config_path.clone());

        let mut config = GatewayConfig::default();
        config.http_port = 9999;
        config.enabled = true;

        manager.save(&config).unwrap();
        assert!(config_path.exists());

        let loaded = manager.load().unwrap();
        assert_eq!(loaded.http_port, 9999);
        assert!(loaded.enabled);
    }

    #[test]
    fn test_validate_valid_config() {
        let temp_dir = TempDir::new().unwrap();
        let manager = GatewayConfigManager::new(temp_dir.path().join("gateway.json"));

        let config = GatewayConfig {
            http_port: 8080,
            ws_port: 8081,
            ..GatewayConfig::default()
        };

        assert!(manager.validate(&config).is_ok());
    }

    #[test]
    fn test_validate_invalid_ports() {
        let temp_dir = TempDir::new().unwrap();
        let manager = GatewayConfigManager::new(temp_dir.path().join("gateway.json"));

        let invalid_port_config = GatewayConfig {
            http_port: 80,
            ..GatewayConfig::default()
        };
        assert!(manager.validate(&invalid_port_config).is_err());

        let same_port_config = GatewayConfig {
            http_port: 8080,
            ws_port: 8080,
            ..GatewayConfig::default()
        };
        assert!(manager.validate(&same_port_config).is_err());
    }
}
