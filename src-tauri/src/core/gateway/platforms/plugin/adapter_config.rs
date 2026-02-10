//! Configuration Adapter
//!
//! Shared configuration validation and resolution for platform plugins.
//! Provides a uniform interface for validating account configs before starting plugins.

use std::sync::Arc;
use serde_json::Value;

use crate::core::gateway::types::{Platform, GatewayConfig};
use super::types::{ChannelPlugin, AccountConfig, PluginResult, PluginError};

/// Configuration adapter for validating and resolving plugin configs.
pub struct ConfigAdapter;

impl ConfigAdapter {
    /// Validate an account configuration through the plugin.
    ///
    /// Checks:
    /// 1. Plugin exists for the platform
    /// 2. Required fields are present
    /// 3. Plugin-specific validation passes
    pub async fn validate(
        plugin: &Arc<dyn ChannelPlugin>,
        account: &AccountConfig,
    ) -> PluginResult<Vec<ConfigWarning>> {
        let mut warnings = Vec::new();

        // Basic field validation
        if account.id.is_empty() {
            return Err(PluginError::Configuration("Account ID is required".to_string()));
        }

        if account.name.is_empty() {
            warnings.push(ConfigWarning {
                field: "name".to_string(),
                message: "Account name is empty, will use ID as display name".to_string(),
                severity: WarningSeverity::Info,
            });
        }

        // Delegate to plugin-specific validation
        plugin.validate_config(account).await?;

        Ok(warnings)
    }

    /// Resolve account configuration from global gateway config.
    ///
    /// Resolution order:
    /// 1. Named accounts from config.accounts map
    /// 2. Legacy single-token fields (discord_bot_token, etc.)
    /// 3. Environment variables (DISCORD_BOT_TOKEN, etc.)
    pub fn resolve_account(
        platform: &Platform,
        account_id: &str,
        config: &GatewayConfig,
    ) -> Option<AccountConfig> {
        // 1. Try named accounts
        if let Some(account) = config.get_account(platform.as_str(), account_id) {
            return Some(AccountConfig {
                id: account.id.clone(),
                name: account.name.clone(),
                settings: account.settings.clone(),
                enabled: account.enabled,
            });
        }

        // 2. Fall back to legacy single-token
        if account_id == "default" {
            let token = match platform {
                Platform::Discord => config.discord_bot_token.clone(),
                Platform::Telegram => config.telegram_bot_token.clone(),
                Platform::Slack => config.slack_bot_token.clone(),
                Platform::Unknown => None,
            };

            if token.is_some() {
                let mut settings = serde_json::Map::new();
                if let Some(t) = token {
                    settings.insert("token".to_string(), Value::String(t));
                }
                if let Some(ref wh) = config.discord_webhook_url {
                    if matches!(platform, Platform::Discord) {
                        settings.insert("webhook_url".to_string(), Value::String(wh.clone()));
                    }
                }

                return Some(AccountConfig {
                    id: "default".to_string(),
                    name: format!("{} (default)", platform.as_str()),
                    settings: Value::Object(settings),
                    enabled: true,
                });
            }
        }

        // 3. Try environment variables
        let env_var = match platform {
            Platform::Discord => "DISCORD_BOT_TOKEN",
            Platform::Telegram => "TELEGRAM_BOT_TOKEN",
            Platform::Slack => "SLACK_BOT_TOKEN",
            Platform::Unknown => return None,
        };

        if let Ok(token) = std::env::var(env_var) {
            if !token.is_empty() {
                let mut settings = serde_json::Map::new();
                settings.insert("token".to_string(), Value::String(token));
                settings.insert("source".to_string(), Value::String("env".to_string()));

                return Some(AccountConfig {
                    id: account_id.to_string(),
                    name: format!("{} (env)", platform.as_str()),
                    settings: Value::Object(settings),
                    enabled: true,
                });
            }
        }

        None
    }

    /// List all available account IDs for a platform.
    ///
    /// Merges:
    /// - Named accounts from config
    /// - Legacy "default" account if token exists
    /// - Environment variable accounts
    pub fn list_account_ids(platform: &Platform, config: &GatewayConfig) -> Vec<String> {
        let mut ids = Vec::new();

        // Named accounts
        let platform_str = platform.as_str();
        if let Some(accounts) = config.accounts.get(platform_str) {
            for account in accounts {
                if !ids.contains(&account.id) {
                    ids.push(account.id.clone());
                }
            }
        }

        // Legacy default
        let has_legacy = match platform {
            Platform::Discord => config.discord_bot_token.is_some() || config.discord_webhook_url.is_some(),
            Platform::Telegram => config.telegram_bot_token.is_some(),
            Platform::Slack => config.slack_bot_token.is_some(),
            Platform::Unknown => false,
        };
        if has_legacy && !ids.contains(&"default".to_string()) {
            ids.push("default".to_string());
        }

        // Environment variables
        let env_var = match platform {
            Platform::Discord => Some("DISCORD_BOT_TOKEN"),
            Platform::Telegram => Some("TELEGRAM_BOT_TOKEN"),
            Platform::Slack => Some("SLACK_BOT_TOKEN"),
            Platform::Unknown => None,
        };
        if let Some(var) = env_var {
            if std::env::var(var).map(|v| !v.is_empty()).unwrap_or(false) {
                if !ids.contains(&"env".to_string()) && !ids.contains(&"default".to_string()) {
                    ids.push("env".to_string());
                }
            }
        }

        ids
    }
}

/// Warning generated during config validation
#[derive(Debug, Clone)]
pub struct ConfigWarning {
    /// Field that triggered the warning
    pub field: String,
    /// Warning message
    pub message: String,
    /// Severity level
    pub severity: WarningSeverity,
}

/// Severity level for configuration warnings
#[derive(Debug, Clone, PartialEq)]
pub enum WarningSeverity {
    /// Informational only
    Info,
    /// Potential issue
    Warning,
    /// Deprecated configuration
    Deprecated,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_account_ids_empty() {
        let config = GatewayConfig::default();
        let ids = ConfigAdapter::list_account_ids(&Platform::Discord, &config);
        assert!(ids.is_empty());
    }

    #[test]
    fn test_list_account_ids_with_legacy() {
        let mut config = GatewayConfig::default();
        config.discord_bot_token = Some("test-token".to_string());
        let ids = ConfigAdapter::list_account_ids(&Platform::Discord, &config);
        assert_eq!(ids, vec!["default"]);
    }

    #[test]
    fn test_resolve_legacy_discord() {
        let mut config = GatewayConfig::default();
        config.discord_bot_token = Some("test-token".to_string());
        let account = ConfigAdapter::resolve_account(&Platform::Discord, "default", &config);
        assert!(account.is_some());
        let account = account.unwrap();
        assert_eq!(account.id, "default");
        assert!(account.enabled);
    }

    #[test]
    fn test_resolve_unknown_account() {
        let config = GatewayConfig::default();
        let account = ConfigAdapter::resolve_account(&Platform::Discord, "nonexistent", &config);
        assert!(account.is_none());
    }
}
