//! Slack Platform Plugin
//!
//! Implements ChannelPlugin for Slack integration.

use std::sync::Arc;
use async_trait::async_trait;
use serde_json::Value;

use super::super::types::{GatewayMessage, GatewayResponse, Platform};
use super::super::platforms::plugin::{
    ChannelPlugin, ChannelMeta, AccountConfig, ChannelConfig, ChannelHandle, ChannelHealth,
    StartAccountParams, PluginResult, PluginError, DefaultChannelState,
};

/// Slack plugin metadata
const SLACK_META: ChannelMeta = ChannelMeta {
    id: Platform::Slack,
    name: "Slack",
    description: "Connect to Slack workspaces and channels",
    icon: "slack",
    beta: false,
    order: 20,
};

/// Slack platform plugin
pub struct SlackPlugin;

#[async_trait]
impl ChannelPlugin for SlackPlugin {
    fn meta(&self) -> &ChannelMeta {
        &SLACK_META
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
        // Slack requires signing secret and bot token
        if account.settings.get("signing_secret").is_none() &&
           account.settings.get("bot_token").is_none() &&
           account.settings.get("webhook_url").is_none() {
            Err(PluginError::Configuration(
                "Slack requires signing_secret, bot_token, or webhook_url".to_string()
            ))
        } else {
            Ok(())
        }
    }

    fn list_account_ids(&self, global_config: &Value) -> Vec<String> {
        // Get Slack accounts from global config
        if let Some(slack_config) = global_config.get("slack") {
            if let Some(accounts) = slack_config.get("accounts") {
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
        let slack_config = global_config.get("slack")
            .ok_or_else(|| PluginError::Configuration("Slack config not found".to_string()))?;

        if let Some(accounts) = slack_config.get("accounts") {
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
        account.enabled ||
            account.settings.get("signing_secret").is_some() ||
            account.settings.get("bot_token").is_some()
    }

    async fn is_configured(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.settings.get("signing_secret").is_some() ||
            account.settings.get("bot_token").is_some() ||
            account.settings.get("webhook_url").is_some()
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
            platform: Platform::Slack,
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
        let message = super::slack::parse_payload(payload)
            .map_err(|e| PluginError::Message(e))?;
        Ok(message)
    }

    async fn send_outbound(&self, _handle: &ChannelHandle, response: &GatewayResponse) -> PluginResult<()> {
        log::debug!("[Slack] Would send message to channel {}: {}",
            response.target_channel_id, response.content);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slack_meta() {
        let plugin = SlackPlugin;
        let meta = plugin.meta();
        assert_eq!(meta.id, Platform::Slack);
        assert_eq!(meta.name, "Slack");
    }

    #[test]
    fn test_default_config() {
        let plugin = SlackPlugin;
        let config = plugin.default_config();
        assert!(config.auto_reconnect);
    }

    #[tokio::test]
    async fn test_parse_inbound() {
        let plugin = SlackPlugin;
        let payload = serde_json::json!({
            "token": "test-token",
            "team_id": "T123456",
            "event": {
                "id": "evt123",
                "channel": "C987654",
                "user": "U555666",
                "text": "Hello world",
                "ts": "1705315200.000000",
                "event_type": "message",
                "bot_id": null
            },
            "type": "event_callback"
        });

        let result = plugin.parse_inbound(&payload).await;
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.platform, Platform::Slack);
        assert_eq!(message.content, "Hello world");
    }
}