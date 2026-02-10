//! Discord response sender module
//!
//! Sends responses from Jan back to Discord channels.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use ureq;

use super::super::GatewayResponse;

/// Discord response sender configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    /// Bot token for Discord API (if using bot)
    pub bot_token: Option<String>,
    /// Webhook URL for sending messages
    pub webhook_url: Option<String>,
}

impl Default for DiscordConfig {
    fn default() -> Self {
        Self {
            bot_token: None,
            webhook_url: None,
        }
    }
}

/// State for Discord response sender
#[derive(Debug, Default)]
pub struct DiscordSenderState {
    pub config: DiscordConfig,
    pub http_client: Option<ureq::Agent>,
}

impl DiscordSenderState {
    pub fn new() -> Self {
        Self {
            config: DiscordConfig::default(),
            http_client: None,
        }
    }

    /// Configure the sender
    pub fn configure(&mut self, config: DiscordConfig) {
        self.config = config;
        // Create HTTP client with timeout
        self.http_client = Some(ureq::AgentBuilder::new()
            .timeout_read(std::time::Duration::from_secs(30))
            .timeout_write(std::time::Duration::from_secs(30))
            .build());
    }

    /// Check if configured
    pub fn is_configured(&self) -> bool {
        self.config.webhook_url.is_some() || self.config.bot_token.is_some()
    }
}

/// Send a response to Discord
pub async fn send_discord_response(
    state: &Arc<Mutex<DiscordSenderState>>,
    response: &GatewayResponse,
) -> Result<(), String> {
    log::info!("[Discord] 📤 send_discord_response called");
    log::info!("[Discord] 📤 Target channel: {}", response.target_channel_id);
    log::info!("[Discord] 📤 Content length: {} chars", response.content.len());
    log::info!("[Discord] 📤 Content preview: {}", response.content.chars().take(200).collect::<String>());

    let state_guard = state.lock().await;

    log::info!("[Discord] 📤 Checking configuration...");
    log::info!("[Discord] 📤   - webhook_url: {}", state_guard.config.webhook_url.is_some());
    log::info!("[Discord] 📤   - bot_token: {}", state_guard.config.bot_token.is_some());
    log::info!("[Discord] 📤   - is_configured: {}", state_guard.is_configured());

    if !state_guard.is_configured() {
        log::error!("[Discord] ❌ Not configured - cannot send response");
        return Err("Discord not configured".to_string());
    }

    // Prefer webhook over bot token
    if let Some(webhook_url) = &state_guard.config.webhook_url {
        log::info!("[Discord] 📤 Using webhook method");
        // Log the full curl command for debugging
        let escaped_content = response.content
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n");
        log::info!("[Discord] 📤 ============ FULL CURL COMMAND ============");
        log::info!("[Discord] 📤 curl -X POST '{}' \\", webhook_url);
        log::info!("[Discord] 📤   -H 'Content-Type: application/json' \\");
        log::info!("[Discord] 📤   -d '{{\"content\": \"{}\", \"username\": \"Jan AI\"}}'", escaped_content);
        log::info!("[Discord] 📤 =============================================");
        return send_via_webhook(&state_guard, webhook_url, response).await;
    }

    // Fall back to bot token
    if let Some(bot_token) = &state_guard.config.bot_token {
        log::info!("[Discord] 📤 Using bot token method");
        return send_via_bot(&state_guard, bot_token, response).await;
    }

    log::error!("[Discord] ❌ No webhook or bot token configured");
    Err("Discord not configured".to_string())
}

/// Send message via Discord webhook
async fn send_via_webhook(
    state: &DiscordSenderState,
    webhook_url: &str,
    response: &GatewayResponse,
) -> Result<(), String> {
    let content = &response.content;

    log::info!("[Discord] 🌐 send_via_webhook called");
    log::info!("[Discord] 🌐 Content: '{}...' ({} chars)",
        content.chars().take(200).collect::<String>(),
        content.len());

    // Discord webhook payload
    #[derive(Serialize)]
    struct WebhookPayload<'a> {
        content: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        avatar_url: Option<&'a str>,
    }

    let _payload = WebhookPayload {
        content,
        username: Some("Jan AI"),
        avatar_url: None,
    };

    let client = match state.http_client.as_ref() {
        Some(c) => c,
        None => {
            log::error!("[Discord] ❌ HTTP client not initialized");
            return Err("HTTP client not initialized".to_string());
        }
    };

    let json_payload = ureq::json!({
        "content": content,
        "username": "Jan AI"
    });

    log::info!("[Discord] 🌐 Sending POST to webhook...");
    log::info!("[Discord] 🌐 JSON payload: {}", json_payload.to_string());

    let http_response = client
        .post(webhook_url)
        .set("Content-Type", "application/json")
        .send_json(json_payload);

    match http_response {
        Ok(resp) => {
            let status = resp.status();
            log::info!("[Discord] 🌐 Response status: {}", status);
            if status == 204 || status == 200 {
                log::info!("[Discord] ✅ Webhook response sent successfully!");
                Ok(())
            } else {
                let err = format!("Webhook returned status {}", status);
                log::error!("[Discord] ❌ Webhook error: {}", err);
                Err(err)
            }
        }
        Err(e) => {
            let err = format!("Webhook request failed: {}", e);
            log::error!("[Discord] ❌ Webhook error: {}", err);
            Err(err)
        }
    }
}

/// Send message via Discord Bot API
async fn send_via_bot(
    state: &DiscordSenderState,
    bot_token: &str,
    response: &GatewayResponse,
) -> Result<(), String> {
    let channel_id = &response.target_channel_id;

    // Build content with mentions
    let mut content = String::new();

    // Add user mentions at the beginning
    for mention in &response.mentions {
        content.push_str(mention);
        content.push(' ');
    }

    // Add the main content
    content.push_str(&response.content);

    log::info!("[Discord] Sending via bot to channel {}: content='{}...' ({} chars)",
        channel_id,
        content.chars().take(100).collect::<String>(),
        content.len());

    let client = state.http_client.as_ref().ok_or("HTTP client not initialized")?;

    // Discord API endpoint for creating messages
    let url = format!(
        "https://discord.com/api/v10/channels/{}/messages",
        channel_id
    );

    // Build request body
    let mut request_body = ureq::json!({
        "content": content
    });

    // Add reply reference if available
    if let Some(ref reply_to) = response.reply_to {
        if let Some(obj) = request_body.as_object_mut() {
            obj.insert("message_reference".to_string(), ureq::json!({
                "message_id": reply_to
            }));
        }
    }

    let response = client
        .post(&url)
        .set("Authorization", &format!("Bot {}", bot_token))
        .set("Content-Type", "application/json")
        .send_json(request_body);

    match response {
        Ok(resp) => {
            if resp.status() == 200 || resp.status() == 201 {
                log::info!("[Discord] Bot response sent successfully");
                Ok(())
            } else {
                let err = format!("Bot API returned status {}", resp.status());
                log::error!("[Discord] Bot API error: {}", err);
                Err(err)
            }
        }
        Err(e) => {
            let err = format!("Bot API request failed: {}", e);
            log::error!("[Discord] Bot API error: {}", err);
            Err(err)
        }
    }
}

/// Create a shared Discord sender state
pub fn create_discord_sender() -> Arc<Mutex<DiscordSenderState>> {
    Arc::new(Mutex::new(DiscordSenderState::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discord_config_default() {
        let config = DiscordConfig::default();
        assert!(config.bot_token.is_none());
        assert!(config.webhook_url.is_none());
    }

    #[test]
    fn test_discord_state_default() {
        let state = DiscordSenderState::default();
        assert!(!state.is_configured());
    }
}