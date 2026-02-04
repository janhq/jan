//! Discord Platform Plugin
//!
//! Implements ChannelPlugin for Discord integration.

use std::sync::Arc;
use async_trait::async_trait;
use serde_json::Value;

use super::super::types::{GatewayMessage, GatewayResponse, Platform};
use super::super::platforms::plugin::{
    ChannelPlugin, ChannelMeta, AccountConfig, ChannelConfig, ChannelHandle, ChannelHealth,
    StartAccountParams, PluginResult, PluginError, DefaultChannelState,
};

/// Discord plugin metadata
const DISCORD_META: ChannelMeta = ChannelMeta {
    id: Platform::Discord,
    name: "Discord",
    description: "Connect to Discord servers and channels",
    icon: "discord",
    beta: false,
    order: 10,
};

/// Discord platform plugin
pub struct DiscordPlugin;

#[async_trait]
impl ChannelPlugin for DiscordPlugin {
    fn meta(&self) -> &ChannelMeta {
        &DISCORD_META
    }

    fn default_config(&self) -> ChannelConfig {
        ChannelConfig {
            auto_reconnect: true,
            reconnect_delay: 5,
            batch_messages: false,
            batch_window_ms: 100,
            typing_indicators: true,
        }
    }

    async fn validate_config(&self, account: &AccountConfig) -> PluginResult<()> {
        // Discord requires either webhook URL or bot token
        if account.settings.get("webhook_url").is_none() &&
           account.settings.get("bot_token").is_none() {
            Err(PluginError::Configuration(
                "Discord requires either webhook_url or bot_token".to_string()
            ))
        } else {
            Ok(())
        }
    }

    fn list_account_ids(&self, global_config: &Value) -> Vec<String> {
        // Get Discord accounts from global config
        if let Some(discord_config) = global_config.get("discord") {
            if let Some(accounts) = discord_config.get("accounts") {
                if let Some(arr) = accounts.as_array() {
                    return arr.iter()
                        .filter_map(|a| a.get("id").and_then(|i| i.as_str().map(|s| s.to_string())))
                        .collect();
                }
            }
        }
        vec!["default".to_string()] // Fallback
    }

    async fn resolve_account(&self, global_config: &Value, id: &str) -> PluginResult<AccountConfig> {
        let discord_config = global_config.get("discord")
            .ok_or_else(|| PluginError::Configuration("Discord config not found".to_string()))?;

        if let Some(accounts) = discord_config.get("accounts") {
            if let Some(arr) = accounts.as_array() {
                for account in arr {
                    if account.get("id").and_then(|i| i.as_str()) == Some(id) {
                        return Ok(AccountConfig {
                            id: id.to_string(),
                            name: account.get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or(id)
                                .to_string(),
                            settings: account.clone(),
                            enabled: account.get("enabled")
                                .and_then(|e| e.as_bool())
                                .unwrap_or(true),
                        });
                    }
                }
            }
        }

        // Return default account if not found
        Ok(AccountConfig {
            id: id.to_string(),
            name: id.to_string(),
            settings: Value::Null,
            enabled: false,
        })
    }

    fn is_enabled(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.enabled ||
            account.settings.get("webhook_url").is_some() ||
            account.settings.get("bot_token").is_some()
    }

    async fn is_configured(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.settings.get("webhook_url").is_some() ||
            account.settings.get("bot_token").is_some()
    }

    async fn start_account(&self, params: StartAccountParams) -> PluginResult<ChannelHandle> {
        // Validate configuration
        self.validate_config(&params.account).await?;

        // Create channel state
        let state = Arc::new(DefaultChannelState {
            active: true,
            connected_at: chrono::Utc::now().timestamp_millis() as u64,
            last_error: None,
            message_count: 0,
        }) as Arc<dyn ChannelState>;

        Ok(ChannelHandle {
            platform: Platform::Discord,
            account_id: params.account.id.clone(),
            state,
        })
    }

    async fn stop_account(&self, _handle: &ChannelHandle) -> PluginResult<()> {
        // Discord doesn't maintain persistent connections for webhook-only mode
        Ok(())
    }

    async fn health_check(&self, handle: &ChannelHandle) -> ChannelHealth {
        if handle.state.is_active() {
            ChannelHealth::Healthy
        } else {
            ChannelHealth::Disconnected
        }
    }

    async fn parse_inbound(&self, payload: &Value) -> PluginResult<GatewayMessage> {
        // Use the existing parser
        let message = super::discord::parse_payload(payload)
            .map_err(|e| PluginError::Message(e))?;
        Ok(message)
    }

    async fn send_outbound(&self, handle: &ChannelHandle, response: &GatewayResponse) -> PluginResult<()> {
        let settings = &handle.state.as_ref(); // Get the concrete state

        // Try webhook first
        if let Some(webhook_url) = settings.last_error() {
            // This is a workaround - in real implementation, store webhook URL in state
        }

        // For now, delegate to the existing discord sender
        // The actual sending is handled by discord_sender module
        log::debug!("[Discord] Would send message to channel {}: {}",
            response.target_channel_id, response.content);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discord_meta() {
        let plugin = DiscordPlugin;
        let meta = plugin.meta();
        assert_eq!(meta.id, Platform::Discord);
        assert_eq!(meta.name, "Discord");
    }

    #[test]
    fn test_default_config() {
        let plugin = DiscordPlugin;
        let config = plugin.default_config();
        assert!(config.auto_reconnect);
        assert!(config.typing_indicators);
    }

    #[tokio::test]
    async fn test_parse_inbound() {
        let plugin = DiscordPlugin;
        let payload = serde_json::json!({
            "id": "1234567890",
            "channel_id": "9876543210",
            "guild_id": "111222333444",
            "author": {
                "id": "555666777888",
                "username": "testuser",
                "bot": false
            },
            "content": "Hello world",
            "timestamp": "2024-01-15T10:30:00.000Z",
            "attachments": [],
            "mentions": []
        });

        let result = plugin.parse_inbound(&payload).await;
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.platform, Platform::Discord);
        assert_eq!(message.content, "Hello world");
    }
}