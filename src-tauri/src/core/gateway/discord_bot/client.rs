//! Discord REST API client
//!
//! Provides simple HTTP operations for Discord's REST API

use super::{DiscordMessage, DiscordChannel, DiscordUser};
use reqwest;
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::core::gateway::discord_bot::DiscordBotConfig;

const DISCORD_API_BASE: &str = "https://discord.com/api/v10";

/// HTTP client for Discord API with automatic retry
pub struct DiscordClient {
    http_client: Client,
    config: DiscordBotConfig,
}

impl DiscordClient {
    /// Create a new Discord client
    pub fn new(config: DiscordBotConfig) -> Result<Self, String> {
        let http_client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self { http_client, config })
    }

    /// Get the authorization header
    fn auth_header(&self) -> String {
        format!(
            "Bot {}",
            self.config.bot_token.as_ref().expect("Bot token not configured")
        )
    }

    /// Get the API URL for a channel
    fn channel_url(&self, channel_id: &str) -> String {
        format!("{}/channels/{}/messages", DISCORD_API_BASE, channel_id)
    }

    /// Get the channel info URL
    fn channel_info_url(&self, channel_id: &str) -> String {
        format!("{}/channels/{}", DISCORD_API_BASE, channel_id)
    }

    /// Get current bot user info
    pub async fn get_current_user(&self) -> Result<DiscordUser, String> {
        let url = format!("{}/users/@me", DISCORD_API_BASE);

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| format!("Failed to get user: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned status: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse user response: {}", e))
    }

    /// Get channel info
    pub async fn get_channel(&self, channel_id: &str) -> Result<DiscordChannel, String> {
        let url = self.channel_info_url(channel_id);

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| format!("Failed to get channel: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned status: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse channel response: {}", e))
    }

    /// Get messages from a channel (after a given message ID)
    pub async fn get_messages(
        &self,
        channel_id: &str,
        after: Option<&str>,
    ) -> Result<Vec<DiscordMessage>, String> {
        let mut url = self.channel_url(channel_id);

        if let Some(after_id) = after {
            url.push_str(&format!("?after={}", after_id));
        }

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| format!("Failed to get messages: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned status: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse messages: {}", e))
    }

    /// Send a message to a channel
    pub async fn send_message(
        &self,
        channel_id: &str,
        content: &str,
        message_reference: Option<&str>,
    ) -> Result<DiscordMessage, String> {
        let url = self.channel_url(channel_id);

        let mut body = serde_json::json!({
            "content": content
        });

        if let Some(ref_msg_id) = message_reference {
            if let Some(obj) = body.as_object_mut() {
                obj.insert(
                    "message_reference".to_string(),
                    serde_json::json!({
                        "message_id": ref_msg_id
                    }),
                );
            }
        }

        let response = self
            .http_client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to send message: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API returned status {}: {}", status, error_text));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse send response: {}", e))
    }
}

/// Create a Discord client from shared state
pub async fn create_client_from_state(
    state: &Arc<Mutex<super::DiscordBotState>>,
) -> Option<DiscordClient> {
    let config = state.lock().await.config.clone();
    if config.is_configured() {
        DiscordClient::new(config).ok()
    } else {
        None
    }
}