//! Discord Platform Plugin
//!
//! Implements ChannelPlugin for Discord integration.
//! Supports both webhook and bot token modes.

use std::sync::Arc;
use async_trait::async_trait;
use serde_json::Value;

use crate::core::gateway::types::{GatewayMessage, GatewayResponse, Platform};
use super::types::{
    ChannelPlugin, ChannelMeta, AccountConfig, ChannelConfig, ChannelHandle, ChannelHealth,
    StartAccountParams, PluginResult, PluginError, ChannelState, DefaultChannelState,
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
        if account.settings.get("webhook_url").is_none()
            && account.settings.get("bot_token").is_none()
        {
            Err(PluginError::Configuration(
                "Discord requires either webhook_url or bot_token".to_string(),
            ))
        } else {
            Ok(())
        }
    }

    fn list_account_ids(&self, global_config: &Value) -> Vec<String> {
        if let Some(discord_config) = global_config.get("discord") {
            if let Some(accounts) = discord_config.get("accounts") {
                if let Some(arr) = accounts.as_array() {
                    return arr
                        .iter()
                        .filter_map(|a| a.get("id").and_then(|i| i.as_str().map(|s| s.to_string())))
                        .collect();
                }
            }
        }
        vec!["default".to_string()]
    }

    async fn resolve_account(&self, global_config: &Value, id: &str) -> PluginResult<AccountConfig> {
        if let Some(discord_config) = global_config.get("discord") {
            if let Some(accounts) = discord_config.get("accounts") {
                if let Some(arr) = accounts.as_array() {
                    for account in arr {
                        if account.get("id").and_then(|i| i.as_str()) == Some(id) {
                            return Ok(AccountConfig {
                                id: id.to_string(),
                                name: account
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or(id)
                                    .to_string(),
                                settings: account.clone(),
                                enabled: account
                                    .get("enabled")
                                    .and_then(|e| e.as_bool())
                                    .unwrap_or(true),
                            });
                        }
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

    async fn is_configured(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.settings.get("webhook_url").is_some()
            || account.settings.get("bot_token").is_some()
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
            platform: Platform::Discord,
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
        crate::core::gateway::platforms::parse_discord_payload(payload)
            .map_err(|e| PluginError::Message(e))
    }

    async fn send_outbound(
        &self,
        _handle: &ChannelHandle,
        response: &GatewayResponse,
    ) -> PluginResult<()> {
        log::debug!(
            "[Discord Plugin] send_outbound to channel {}: {}",
            response.target_channel_id,
            &response.content[..response.content.len().min(100)]
        );
        Ok(())
    }

    fn format_outbound(&self, markdown: &str) -> String {
        crate::core::gateway::formatter::discord::format_markdown(markdown)
    }

    fn chunk_limit(&self) -> usize {
        2000
    }
}
