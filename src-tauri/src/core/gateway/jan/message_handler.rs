use std::sync::Arc;
use tokio::sync::Mutex;

use super::super::types::{NormalizedMessage, GatewayResponse};

/// Message handler for formatting messages for Jan's chat system
/// Message injection is handled by the frontend via Tauri commands
#[derive(Debug, Default)]
pub struct MessageHandler {
    /// Pending responses to send back
    pending_responses: Vec<GatewayResponse>,
}

impl MessageHandler {
    /// Create a new message handler
    pub fn new() -> Self {
        Self {
            pending_responses: Vec::new(),
        }
    }

    /// Convert a normalized message to Jan message format for frontend use
    pub fn create_jan_message(
        &self,
        thread_id: String,
        message: NormalizedMessage,
    ) -> serde_json::Value {
        serde_json::json!({
            "thread_id": thread_id,
            "role": "user",
            "content": [{
                "type": "text",
                "text": {
                    "value": message.text,
                    "annotations": self.create_annotations(&message)
                }
            }],
            "metadata": {
                "gateway_source": {
                    "platform": message.source_platform.as_str(),
                    "user_id": message.source_user_id,
                    "channel_id": message.source_channel_id,
                    "message_id": message.id,
                }
            }
        })
    }

    /// Create annotations for the message
    fn create_annotations(&self, message: &NormalizedMessage) -> Vec<serde_json::Value> {
        let mut annotations = Vec::new();

        // Add source user annotation
        annotations.push(serde_json::json!({
            "type": "source_user_id",
            "source_user_id": message.source_user_id,
        }));

        // Add mention annotations
        for mention in &message.mentions {
            annotations.push(serde_json::json!({
                "type": "mention",
                "mention": mention,
            }));
        }

        // Add attachment annotations
        for attachment in &message.attachments {
            annotations.push(serde_json::json!({
                "type": "attachment",
                "url": attachment.url,
                "name": attachment.name,
                "file_type": attachment.file_type,
            }));
        }

        annotations
    }

    /// Queue a response to send back to a messaging platform
    pub fn queue_response(&mut self, response: GatewayResponse) {
        self.pending_responses.push(response);
    }

    /// Get pending responses for a specific channel
    pub fn get_responses_for_channel(
        &self,
        channel_id: &str,
    ) -> Vec<GatewayResponse> {
        self.pending_responses
            .iter()
            .filter(|r| r.target_channel_id == channel_id)
            .cloned()
            .collect()
    }

    /// Clear responses for a channel
    pub fn clear_responses_for_channel(&mut self, channel_id: &str) {
        self.pending_responses.retain(|r| r.target_channel_id != channel_id);
    }

    /// Get all pending responses
    pub fn get_all_responses(&self) -> &[GatewayResponse] {
        &self.pending_responses
    }

    /// Pop a response (for delivery)
    pub fn pop_response(&mut self, channel_id: &str) -> Option<GatewayResponse> {
        if let Some(idx) = self.pending_responses
            .iter()
            .position(|r| r.target_channel_id == channel_id)
        {
            Some(self.pending_responses.remove(idx))
        } else {
            None
        }
    }

    /// Format a response for a specific platform
    pub fn format_for_platform(
        &self,
        response_text: &str,
        platform: super::super::types::Platform,
        mentions: &[String],
    ) -> String {
        match platform {
            super::super::types::Platform::Discord => {
                let mut formatted = response_text.to_string();
                // Convert @mentions to Discord format
                for mention in mentions {
                    if let Some(user_id) = mention.strip_prefix("@discord:") {
                        formatted = formatted.replace(
                            mention,
                            &format!("<@{}>", user_id),
                        );
                    }
                }
                formatted
            }
            super::super::types::Platform::Slack => {
                let mut formatted = response_text.to_string();
                // Convert @mentions to Slack format
                for mention in mentions {
                    if let Some(user_id) = mention.strip_prefix("@slack:") {
                        formatted = formatted.replace(
                            mention,
                            &format!("<@{}>", user_id),
                        );
                    }
                }
                formatted
            }
            super::super::types::Platform::Telegram => {
                // Telegram uses Markdown V2
                let mut formatted = response_text.to_string();

                // Escape special characters for Markdown V2
                let specials = ['_', '*', '`', '[', ']', '(', ')', '~', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
                for special in specials {
                    formatted = formatted.replace(special, &format!("\\{}", special));
                }

                // Convert mentions
                for mention in mentions {
                    if let Some(username) = mention.strip_prefix("@telegram:") {
                        formatted = formatted.replace(
                            mention,
                            &format!("@{}", username),
                        );
                    }
                }

                formatted
            }
            _ => response_text.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_for_discord() {
        let handler = MessageHandler::new();
        let formatted = handler.format_for_platform(
            "Hello @discord:123456",
            super::super::types::Platform::Discord,
            &[],
        );
        assert!(formatted.contains("<@123456>"));
    }

    #[test]
    fn test_format_for_slack() {
        let handler = MessageHandler::new();
        let formatted = handler.format_for_platform(
            "Hello @slack:U12345",
            super::super::types::Platform::Slack,
            &[],
        );
        assert!(formatted.contains("<@U12345>"));
    }

    #[test]
    fn test_queue_and_get_response() {
        let mut handler = MessageHandler::new();
        let response = GatewayResponse::new(
            super::super::types::Platform::Discord,
            "channel_123".to_string(),
            "Test response".to_string(),
        );

        handler.queue_response(response.clone());

        let responses = handler.get_responses_for_channel("channel_123");
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].content, "Test response");
    }

    #[test]
    fn test_pop_response() {
        let mut handler = MessageHandler::new();
        let response = GatewayResponse::new(
            super::super::types::Platform::Discord,
            "channel_456".to_string(),
            "Another response".to_string(),
        );

        handler.queue_response(response);
        let popped = handler.pop_response("channel_456");
        assert!(popped.is_some());
        assert_eq!(handler.get_all_responses().len(), 0);
    }
}