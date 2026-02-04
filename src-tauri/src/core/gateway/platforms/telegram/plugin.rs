//! Telegram Platform Plugin
//!
//! Implements ChannelPlugin for Telegram integration.

use std::sync::Arc;
use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::Mutex;

use super::super::types::{GatewayMessage, GatewayResponse, Platform};
use super::super::platforms::plugin::{
    ChannelPlugin, ChannelMeta, AccountConfig, ChannelConfig, ChannelHandle, ChannelHealth,
    StartAccountParams, PluginResult, PluginError, DefaultChannelState,
};
use super::bot::{self, TelegramBotConfig, SharedTelegramBotState, create_telegram_bot_state};

/// Telegram plugin metadata
const TELEGRAM_META: ChannelMeta = ChannelMeta {
    id: Platform::Telegram,
    name: "Telegram",
    description: "Connect to Telegram chats and channels",
    icon: "telegram",
    beta: false,
    order: 30,
};

/// Telegram platform plugin
pub struct TelegramPlugin;

#[async_trait]
impl ChannelPlugin for TelegramPlugin {
    fn meta(&self) -> &ChannelMeta {
        &TELEGRAM_META
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
        // Telegram requires bot token
        if account.settings.get("bot_token").is_none() {
            Err(PluginError::Configuration(
                "Telegram requires bot_token".to_string()
            ))
        } else {
            Ok(())
        }
    }

    fn list_account_ids(&self, global_config: &Value) -> Vec<String> {
        if let Some(tg_config) = global_config.get("telegram") {
            if let Some(accounts) = tg_config.get("accounts") {
                if let Some(arr) = accounts.as_array() {
                    return arr.iter()
                        .filter_map(|a| a.get("id").and_then(|i| i.as_str().map(|s| s.to_string())))
                        .collect();
                }
            }
        }
        vec!["default".to_string()]
    }

    async fn resolve_account(&self, global_config: &Value, id: &str) -> PluginResult<AccountConfig> {
        let tg_config = global_config.get("telegram")
            .ok_or_else(|| PluginError::Configuration("Telegram config not found".to_string()))?;

        if let Some(accounts) = tg_config.get("accounts") {
            if let Some(arr) = accounts.as_array() {
                for account in arr {
                    if account.get("id").and_then(|i| i.as_str()) == Some(id) {
                        return Ok(AccountConfig {
                            id: id.to_string(),
                            name: account.get("name")
                                .and_then(|n| n.as_str().map(|s| s.to_string()))
                                .unwrap_or_else(|| id.to_string()),
                            settings: account.clone(),
                            enabled: account.get("enabled")
                                .and_then(|e| e.as_bool())
                                .unwrap_or(true),
                        });
                    }
                }
            }
        }

        Ok(AccountConfig {
            id: id.to_string(),
            name: id.to_string(),
            settings: Value::Null,
            enabled: false,
        })
    }

    fn is_enabled(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.enabled || account.settings.get("bot_token").is_some()
    }

    async fn is_configured(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.settings.get("bot_token").is_some()
    }

    async fn start_account(&self, params: StartAccountParams) -> PluginResult<ChannelHandle> {
        self.validate_config(&params.account).await?;

        let state = Arc::new(DefaultChannelState {
            active: true,
            connected_at: chrono::Utc::now().timestamp_millis() as u64,
            last_error: None,
            message_count: 0,
        }) as Arc<dyn ChannelState>;

        Ok(ChannelHandle {
            platform: Platform::Telegram,
            account_id: params.account.id.clone(),
            state,
        })
    }

    async fn stop_account(&self, _handle: &ChannelHandle) -> PluginResult<()> {
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
        let message = super::telegram_parser::parse_payload(payload)
            .map_err(|e| PluginError::Message(e))?;
        Ok(message)
    }

    async fn send_outbound(&self, _handle: &ChannelHandle, response: &GatewayResponse) -> PluginResult<()> {
        // Get bot token from account settings
        let bot_token = _handle.state.get("bot_token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| PluginError::Send("Telegram bot token not configured".to_string()))?;

        let config = TelegramBotConfig::new(bot_token.to_string());

        // Use the bot module to send the message
        match bot::send_gateway_response(&config, response).await {
            Ok(result) => {
                log::info!("[Telegram] Message sent: {} to chat {}",
                    result.message_id, result.chat_id);
                Ok(())
            }
            Err(e) => {
                log::error!("[Telegram] Failed to send message: {:?}", e);
                Err(PluginError::Send(e.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telegram_meta() {
        let plugin = TelegramPlugin;
        let meta = plugin.meta();
        assert_eq!(meta.id, Platform::Telegram);
        assert_eq!(meta.name, "Telegram");
    }

    #[test]
    fn test_default_config() {
        let plugin = TelegramPlugin;
        let config = plugin.default_config();
        assert!(config.auto_reconnect);
    }

    #[tokio::test]
    async fn test_parse_inbound() {
        let plugin = TelegramPlugin;
        let payload = serde_json::json!({
            "update_id": 123456789,
            "message": {
                "message_id": 100,
                "from": {
                    "id": 123456789,
                    "is_bot": false,
                    "first_name": "TestUser"
                },
                "chat": {
                    "id": -1001234567890,
                    "type": "supergroup",
                    "title": "Test Chat"
                },
                "date": 1705315200,
                "text": "Hello from Telegram"
            }
        });

        let result = plugin.parse_inbound(&payload).await;
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.platform, Platform::Telegram);
        assert!(message.content.contains("Hello"));
    }
}