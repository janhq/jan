//! Slack Platform Plugin
//!
//! Implements ChannelPlugin for Slack integration.

use std::sync::Arc;
use async_trait::async_trait;
use serde_json::Value;

use crate::core::gateway::types::{GatewayMessage, GatewayResponse, Platform};
use super::types::{
    ChannelPlugin, ChannelMeta, AccountConfig, ChannelConfig, ChannelHandle, ChannelHealth,
    StartAccountParams, PluginResult, PluginError, ChannelState, DefaultChannelState,
};

const SLACK_META: ChannelMeta = ChannelMeta {
    id: Platform::Slack,
    name: "Slack",
    description: "Connect to Slack workspaces and channels",
    icon: "slack",
    beta: false,
    order: 20,
};

pub struct SlackPlugin;

#[async_trait]
impl ChannelPlugin for SlackPlugin {
    fn meta(&self) -> &ChannelMeta { &SLACK_META }

    fn default_config(&self) -> ChannelConfig {
        ChannelConfig {
            auto_reconnect: true, reconnect_delay: 5,
            batch_messages: false, batch_window_ms: 100, typing_indicators: true,
        }
    }

    async fn validate_config(&self, account: &AccountConfig) -> PluginResult<()> {
        if account.settings.get("signing_secret").is_none()
            && account.settings.get("bot_token").is_none()
            && account.settings.get("webhook_url").is_none()
        {
            Err(PluginError::Configuration("Slack requires signing_secret, bot_token, or webhook_url".into()))
        } else { Ok(()) }
    }

    fn list_account_ids(&self, global_config: &Value) -> Vec<String> {
        global_config.get("slack")
            .and_then(|c| c.get("accounts"))
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().filter_map(|a| a.get("id").and_then(|i| i.as_str().map(|s| s.to_string()))).collect())
            .unwrap_or_else(|| vec!["default".to_string()])
    }

    async fn resolve_account(&self, global_config: &Value, id: &str) -> PluginResult<AccountConfig> {
        if let Some(arr) = global_config.get("slack").and_then(|c| c.get("accounts")).and_then(|a| a.as_array()) {
            for account in arr {
                if account.get("id").and_then(|i| i.as_str()) == Some(id) {
                    return Ok(AccountConfig {
                        id: id.to_string(),
                        name: account.get("name").and_then(|n| n.as_str().map(|s| s.to_string())).unwrap_or_else(|| id.to_string()),
                        settings: account.clone(),
                        enabled: account.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true),
                    });
                }
            }
        }
        Ok(AccountConfig { id: id.to_string(), name: id.to_string(), settings: Value::Null, enabled: false })
    }

    async fn is_configured(&self, account: &AccountConfig, _: &Value) -> bool {
        account.settings.get("signing_secret").is_some() || account.settings.get("bot_token").is_some() || account.settings.get("webhook_url").is_some()
    }

    async fn start_account(&self, params: StartAccountParams) -> PluginResult<ChannelHandle> {
        self.validate_config(&params.account).await?;
        let state = Arc::new(DefaultChannelState { active: true, connected_at: chrono::Utc::now().timestamp_millis() as u64, last_error: None, message_count: 0 }) as Arc<dyn ChannelState>;
        Ok(ChannelHandle { platform: Platform::Slack, account_id: params.account.id.clone(), state })
    }

    async fn stop_account(&self, _: &ChannelHandle) -> PluginResult<()> { Ok(()) }

    async fn health_check(&self, handle: &ChannelHandle) -> ChannelHealth {
        if handle.state.is_active() { ChannelHealth::Healthy } else { ChannelHealth::Disconnected }
    }

    async fn parse_inbound(&self, payload: &Value) -> PluginResult<GatewayMessage> {
        crate::core::gateway::platforms::parse_slack_payload(payload).map_err(|e| PluginError::Message(e))
    }

    async fn send_outbound(&self, _: &ChannelHandle, response: &GatewayResponse) -> PluginResult<()> {
        log::debug!("[Slack Plugin] send_outbound to {}: {}", response.target_channel_id, &response.content[..response.content.len().min(100)]);
        Ok(())
    }

    fn format_outbound(&self, markdown: &str) -> String {
        crate::core::gateway::formatter::slack::format_markdown(markdown)
    }

    fn chunk_limit(&self) -> usize { 4000 }
}
