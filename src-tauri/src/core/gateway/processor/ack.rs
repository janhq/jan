//! ACK (Acknowledgement) Handler
//!
//! Handles delivery confirmations and typing indicators for platform responses.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

use super::super::types::{GatewayMessage, GatewayResponse, Platform};

/// ACK configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckConfig {
    /// Enable sending ACK reactions
    pub enabled: bool,
    /// Enable typing indicators
    pub show_typing: bool,
    /// Typing indicator duration in seconds
    pub typing_duration_secs: u64,
    /// Enable read receipts
    pub enable_read_receipts: bool,
    /// ACK reaction emoji per platform
    pub ack_emoji: HashMap<String, String>,
}

impl Default for AckConfig {
    fn default() -> Self {
        let mut ack_emoji = HashMap::new();
        ack_emoji.insert("discord".to_string(), "👀".to_string());
        ack_emoji.insert("slack".to_string(), "✅".to_string());
        ack_emoji.insert("telegram".to_string(), "🔄".to_string());

        Self {
            enabled: true,
            show_typing: true,
            typing_duration_secs: 60,
            enable_read_receipts: true,
            ack_emoji,
        }
    }
}

/// ACK state tracking
#[derive(Debug, Clone)]
pub struct AckState {
    /// Message ID being tracked
    pub message_id: String,
    /// Platform
    pub platform: Platform,
    /// Channel ID
    pub channel_id: String,
    /// When the message was sent
    pub sent_at: Instant,
    /// Delivery confirmed
    pub delivered: bool,
    /// Read confirmed
    pub read: bool,
}

/// Pending ACK operation
#[derive(Debug)]
struct PendingAck {
    state: Arc<Mutex<AckState>>,
    /// Expiration time for cleanup
    expires_at: Instant,
}

/// ACK handler for tracking message delivery and displaying feedback
#[derive(Debug, Default)]
pub struct AckHandler {
    /// Configuration
    config: Arc<Mutex<AckConfig>>,
    /// Pending ACKs
    pending_acks: Arc<Mutex<HashMap<String, PendingAck>>>,
    /// Completed ACKs for history
    completed_acks: Arc<Mutex<Vec<AckState>>>,
    /// Typing indicator senders per channel
    typing_senders: Arc<Mutex<HashMap<String, tokio::sync::broadcast::Sender<bool>>>>,
}

impl AckHandler {
    /// Create a new ACK handler
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(AckConfig::default())),
            pending_acks: Arc::new(Mutex::new(HashMap::new())),
            completed_acks: Arc::new(Mutex::new(Vec::new())),
            typing_senders: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Stop typing indicators
    pub async fn stop_all_typing(&self) {
        let mut typing = self.typing_senders.lock().await;
        for (_, sender) in typing.drain() {
            let _ = sender.send(false);
        }
    }

    /// Register a message for ACK tracking
    pub async fn register_message(
        &self,
        message_id: &str,
        platform: Platform,
        channel_id: &str,
    ) -> Arc<Mutex<AckState>> {
        let state = Arc::new(Mutex::new(AckState {
            message_id: message_id.to_string(),
            platform,
            channel_id: channel_id.to_string(),
            sent_at: Instant::now(),
            delivered: false,
            read: false,
        }));

        let mut guard = self.pending_acks.lock().await;
        guard.insert(
            message_id.to_string(),
            PendingAck {
                state: state.clone(),
                expires_at: Instant::now() + Duration::from_secs(300),
            },
        );

        state
    }

    /// Mark a message as delivered
    pub async fn mark_delivered(&self, message_id: &str) {
        let mut guard = self.pending_acks.lock().await;
        if let Some(pending) = guard.remove(message_id) {
            let mut state = pending.state.lock().await;
            state.delivered = true;

            let mut completed = self.completed_acks.lock().await;
            completed.push(state.clone());
        }
    }

    /// Mark a message as read
    pub async fn mark_read(&self, message_id: &str) {
        let mut guard = self.pending_acks.lock().await;
        if let Some(pending) = guard.remove(message_id) {
            let mut state = pending.state.lock().await;
            state.delivered = true;
            state.read = true;

            let mut completed = self.completed_acks.lock().await;
            completed.push(state.clone());
        }
    }

    /// Get ACK state for a message
    pub async fn get_state(&self, message_id: &str) -> Option<AckState> {
        let guard = self.pending_acks.lock().await;
        match guard.get(message_id) {
            Some(pending) => Some(pending.state.lock().await.clone()),
            None => None,
        }
    }

    /// Get the appropriate ACK emoji for a platform
    pub async fn get_ack_emoji(&self, platform: Platform) -> String {
        let config = self.config.lock().await;
        config
            .ack_emoji
            .get(platform.as_str())
            .cloned()
            .unwrap_or_else(|| "✅".to_string())
    }

    /// Create a typing indicator channel for a channel
    pub async fn get_typing_channel(&self, channel_id: &str) -> tokio::sync::broadcast::Receiver<bool> {
        let mut guard = self.typing_senders.lock().await;
        if !guard.contains_key(channel_id) {
            let (tx, _rx) = tokio::sync::broadcast::channel(10);
            guard.insert(channel_id.to_string(), tx);
        }
        guard
            .get(channel_id)
            .unwrap()
            .subscribe()
    }

    /// Send typing start notification
    pub async fn start_typing(&self, channel_id: &str) {
        let guard = self.typing_senders.lock().await;
        if let Some(sender) = guard.get(channel_id) {
            let _ = sender.send(true);
        }
    }

    /// Send typing stop notification
    pub async fn stop_typing(&self, channel_id: &str) {
        let guard = self.typing_senders.lock().await;
        if let Some(sender) = guard.get(channel_id) {
            let _ = sender.send(false);
        }
    }

    /// Update configuration
    pub async fn set_config(&self, config: AckConfig) {
        let mut guard = self.config.lock().await;
        *guard = config;
    }

    /// Get configuration
    pub async fn get_config(&self) -> AckConfig {
        self.config.lock().await.clone()
    }

    /// Get statistics
    pub async fn get_stats(&self) -> AckStats {
        let pending = self.pending_acks.lock().await;
        let completed = self.completed_acks.lock().await;

        let delivered_count = completed.iter().filter(|s| s.delivered).count();
        let read_count = completed.iter().filter(|s| s.read).count();

        AckStats {
            pending_count: pending.len(),
            delivered_count,
            read_count,
            total_completed: completed.len(),
        }
    }
}

/// ACK statistics
#[derive(Debug, Default)]
pub struct AckStats {
    pub pending_count: usize,
    pub delivered_count: usize,
    pub read_count: usize,
    pub total_completed: usize,
}

/// Build ACK response for sending to platform
pub async fn build_ack_response(
    handler: &AckHandler,
    original_message: &GatewayMessage,
) -> Option<GatewayResponse> {
    if !handler.get_config().await.enable_read_receipts {
        return None;
    }

    let platform = original_message.platform.clone();
    let emoji = handler.get_ack_emoji(platform.clone()).await;

    Some(GatewayResponse {
        target_platform: platform,
        target_channel_id: original_message.channel_id.clone(),
        content: emoji,
        reply_to: Some(original_message.id.clone()),
        mentions: Vec::new(),
        protocol_version: super::super::types::GATEWAY_PROTOCOL_VERSION.to_string(),
    })
}

/// Send a processing ACK to the platform (reaction/typing indicator).
///
/// - Discord: Add reaction emoji to the original message
/// - Telegram: Send typing indicator (sendChatAction)
/// - Slack: Add reaction emoji to the original message
pub async fn send_processing_ack(
    handler: &AckHandler,
    message: &GatewayMessage,
    config: &super::super::types::GatewayConfig,
) -> Result<(), String> {
    let ack_config = handler.get_config().await;
    if !ack_config.enabled {
        return Ok(());
    }

    let emoji = handler.get_ack_emoji(message.platform.clone()).await;

    match message.platform {
        Platform::Discord => {
            // Discord: Add reaction to the message
            if let Some(ref token) = config.discord_bot_token {
                let url = format!(
                    "https://discord.com/api/v10/channels/{}/messages/{}/reactions/{}/@me",
                    message.channel_id,
                    message.id,
                    urlencoding_emoji(&emoji),
                );
                let client = reqwest::Client::new();
                let resp = client
                    .put(&url)
                    .header("Authorization", format!("Bot {}", token))
                    .send()
                    .await
                    .map_err(|e| format!("Discord ACK failed: {}", e))?;

                if !resp.status().is_success() {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    log::warn!("[ACK] Discord reaction failed: {} - {}", status, body);
                } else {
                    log::info!("[ACK] Discord reaction {} added to message {}", emoji, message.id);
                }
            }
        }
        Platform::Telegram => {
            // Telegram: Send typing indicator
            if ack_config.show_typing {
                if let Some(ref token) = config.telegram_bot_token {
                    let url = format!("https://api.telegram.org/bot{}/sendChatAction", token);
                    let client = reqwest::Client::new();
                    let _ = client
                        .post(&url)
                        .json(&serde_json::json!({
                            "chat_id": message.channel_id,
                            "action": "typing",
                        }))
                        .send()
                        .await;
                    log::info!("[ACK] Telegram typing indicator sent for chat {}", message.channel_id);
                }
            }
        }
        Platform::Slack => {
            // Slack: Add reaction to the message
            if let Some(ref token) = config.slack_bot_token {
                // Slack reaction names don't include colons, strip them
                let reaction_name = emoji.trim_matches(':');
                match super::super::platforms::slack_sender::add_reaction(
                    token,
                    &message.channel_id,
                    &message.id,
                    reaction_name,
                ).await {
                    Ok(()) => {
                        log::info!("[ACK] Slack reaction {} added to message {}", reaction_name, message.id);
                    }
                    Err(e) => {
                        log::warn!("[ACK] Slack reaction failed: {}", e);
                    }
                }
            }
        }
        Platform::Unknown => {}
    }

    // Register the ACK tracking
    handler.register_message(&message.id, message.platform.clone(), &message.channel_id).await;

    Ok(())
}

/// Send a completion ACK to the platform (change reaction from processing to done).
///
/// - Discord: Remove processing reaction, add completion reaction
/// - Telegram: No specific action (typing stops automatically)
/// - Slack: Remove processing reaction, add completion reaction
pub async fn send_completion_ack(
    handler: &AckHandler,
    message: &GatewayMessage,
    config: &super::super::types::GatewayConfig,
) -> Result<(), String> {
    let ack_config = handler.get_config().await;
    if !ack_config.enabled {
        return Ok(());
    }

    match message.platform {
        Platform::Discord => {
            if let Some(ref token) = config.discord_bot_token {
                // Remove processing reaction (👀)
                let processing_emoji = urlencoding_emoji("👀");
                let remove_url = format!(
                    "https://discord.com/api/v10/channels/{}/messages/{}/reactions/{}/@me",
                    message.channel_id, message.id, processing_emoji,
                );
                let client = reqwest::Client::new();
                let _ = client.delete(&remove_url)
                    .header("Authorization", format!("Bot {}", token))
                    .send().await;

                // Add completion reaction (✅)
                let done_emoji = urlencoding_emoji("✅");
                let add_url = format!(
                    "https://discord.com/api/v10/channels/{}/messages/{}/reactions/{}/@me",
                    message.channel_id, message.id, done_emoji,
                );
                let _ = client.put(&add_url)
                    .header("Authorization", format!("Bot {}", token))
                    .send().await;

                log::info!("[ACK] Discord completion reaction added to message {}", message.id);
            }
        }
        Platform::Slack => {
            if let Some(ref token) = config.slack_bot_token {
                // Slack: just add the done reaction (✅), leave processing reaction
                match super::super::platforms::slack_sender::add_reaction(
                    token,
                    &message.channel_id,
                    &message.id,
                    "white_check_mark",
                ).await {
                    Ok(()) => {
                        log::info!("[ACK] Slack completion reaction added to message {}", message.id);
                    }
                    Err(e) => {
                        log::warn!("[ACK] Slack completion reaction failed: {}", e);
                    }
                }
            }
        }
        _ => {}
    }

    // Mark as delivered
    handler.mark_delivered(&message.id).await;

    Ok(())
}

/// URL-encode an emoji for Discord API reactions endpoint
fn urlencoding_emoji(emoji: &str) -> String {
    // For Unicode emojis, percent-encode them
    let bytes = emoji.as_bytes();
    let mut result = String::new();
    for byte in bytes {
        result.push_str(&format!("%{:02X}", byte));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_message() -> GatewayMessage {
        GatewayMessage {
            id: "msg-123".to_string(),
            platform: super::super::types::Platform::Discord,
            user_id: "U123".to_string(),
            channel_id: "C456".to_string(),
            guild_id: None,
            content: "Hello".to_string(),
            timestamp: 0,
            metadata: std::collections::HashMap::new(),
            protocol_version: "1.0".to_string(),
        }
    }

    #[tokio::test]
    async fn test_register_message() {
        let handler = AckHandler::new();
        let message = create_test_message();

        let state = handler.register_message(&message.id, message.platform.clone(), &message.channel_id).await;
        assert_eq!(state.lock().await.message_id, "msg-123");
        assert!(!state.lock().await.delivered);
    }

    #[tokio::test]
    async fn test_mark_delivered() {
        let handler = AckHandler::new();
        let message = create_test_message();

        handler.register_message(&message.id, message.platform.clone(), &message.channel_id).await;
        handler.mark_delivered(&message.id).await;

        let state = handler.get_state(&message.id).await;
        assert!(state.unwrap().delivered);
    }

    #[tokio::test]
    async fn test_mark_read() {
        let handler = AckHandler::new();
        let message = create_test_message();

        handler.register_message(&message.id, message.platform.clone(), &message.channel_id).await;
        handler.mark_read(&message.id).await;

        let state = handler.get_state(&message.id).await;
        let state = state.unwrap();
        assert!(state.delivered);
        assert!(state.read);
    }

    #[tokio::test]
    async fn test_ack_emoji() {
        let handler = AckHandler::new();
        let emoji = handler.get_ack_emoji(super::super::types::Platform::Discord).await;
        assert_eq!(emoji, "👀");
    }

    #[tokio::test]
    async fn test_get_stats() {
        let handler = AckHandler::new();
        let stats = handler.get_stats().await;
        assert_eq!(stats.pending_count, 0);
        assert_eq!(stats.total_completed, 0);
    }
}