//! Inbound Message Adapter
//!
//! Normalizes inbound messages from any platform into a canonical GatewayMessage format.
//! Handles mention extraction, metadata enrichment, and protocol version stamping.

use std::sync::Arc;
use serde_json::Value;

use crate::core::gateway::types::{Platform, GatewayMessage, GATEWAY_PROTOCOL_VERSION};
use super::types::{ChannelPlugin, PluginResult};

/// Inbound message adapter that wraps a ChannelPlugin and normalizes messages.
pub struct InboundAdapter;

impl InboundAdapter {
    /// Parse an inbound payload using the plugin, then normalize the resulting message.
    ///
    /// Steps:
    /// 1. Delegate to plugin.parse_inbound() for platform-specific parsing
    /// 2. Stamp protocol version
    /// 3. Extract and normalize mentions
    /// 4. Ensure required fields are populated
    pub async fn parse_and_normalize(
        plugin: &Arc<dyn ChannelPlugin>,
        payload: &Value,
    ) -> PluginResult<GatewayMessage> {
        let mut message = plugin.parse_inbound(payload).await?;

        // Stamp protocol version if not set
        if message.protocol_version.is_empty() {
            message.protocol_version = GATEWAY_PROTOCOL_VERSION.to_string();
        }

        // Ensure timestamp is set
        if message.timestamp == 0 {
            message.timestamp = chrono::Utc::now().timestamp_millis() as u64;
        }

        // Ensure message ID is set
        if message.id.is_empty() {
            message.id = uuid::Uuid::new_v4().to_string();
        }

        // Extract platform-specific metadata
        Self::enrich_metadata(&mut message);

        Ok(message)
    }

    /// Enrich a message with platform-specific metadata.
    fn enrich_metadata(message: &mut GatewayMessage) {
        // Add platform name to metadata if not present
        if !message.metadata.contains_key("platform_name") {
            message.metadata.insert(
                "platform_name".to_string(),
                serde_json::Value::String(message.platform.as_str().to_string()),
            );
        }

        // Extract mentions from content
        let mentions = Self::extract_mentions(&message.content, &message.platform);
        if !mentions.is_empty() {
            if let Ok(mentions_value) = serde_json::to_value(&mentions) {
                message.metadata.insert("mentions".to_string(), mentions_value);
            }
        }
    }

    /// Extract mentions from message content based on platform format.
    ///
    /// - Discord: `<@USER_ID>`, `<@!USER_ID>`, `<@&ROLE_ID>`, `<#CHANNEL_ID>`
    /// - Telegram: `@username`
    /// - Slack: `<@USER_ID>`, `<@USER_ID|display_name>`
    fn extract_mentions(content: &str, platform: &Platform) -> Vec<Mention> {
        match platform {
            Platform::Discord => Self::extract_discord_mentions(content),
            Platform::Telegram => Self::extract_telegram_mentions(content),
            Platform::Slack => Self::extract_slack_mentions(content),
            Platform::Unknown => Vec::new(),
        }
    }

    fn extract_discord_mentions(content: &str) -> Vec<Mention> {
        let mut mentions = Vec::new();

        // User mentions: <@USER_ID> or <@!USER_ID>
        let mut i = 0;
        let chars: Vec<char> = content.chars().collect();
        while i < chars.len() {
            if i + 2 < chars.len() && chars[i] == '<' && chars[i + 1] == '@' {
                let start = i;
                let skip_bang = if i + 2 < chars.len() && chars[i + 2] == '!' { 1 } else { 0 };
                let id_start = i + 2 + skip_bang;
                let mut id_end = id_start;
                while id_end < chars.len() && chars[id_end] != '>' {
                    id_end += 1;
                }
                if id_end < chars.len() {
                    let id: String = chars[id_start..id_end].iter().collect();
                    mentions.push(Mention {
                        kind: MentionKind::User,
                        id,
                        display: None,
                    });
                    i = id_end + 1;
                    continue;
                }
            }

            // Channel mentions: <#CHANNEL_ID>
            if i + 1 < chars.len() && chars[i] == '<' && chars[i + 1] == '#' {
                let id_start = i + 2;
                let mut id_end = id_start;
                while id_end < chars.len() && chars[id_end] != '>' {
                    id_end += 1;
                }
                if id_end < chars.len() {
                    let id: String = chars[id_start..id_end].iter().collect();
                    mentions.push(Mention {
                        kind: MentionKind::Channel,
                        id,
                        display: None,
                    });
                    i = id_end + 1;
                    continue;
                }
            }

            i += 1;
        }

        mentions
    }

    fn extract_telegram_mentions(content: &str) -> Vec<Mention> {
        let mut mentions = Vec::new();
        for word in content.split_whitespace() {
            if word.starts_with('@') && word.len() > 1 {
                let username = &word[1..];
                // Telegram usernames: 5-32 chars, alphanumeric + underscore
                if username.len() >= 2 && username.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    mentions.push(Mention {
                        kind: MentionKind::User,
                        id: username.to_string(),
                        display: Some(word.to_string()),
                    });
                }
            }
        }
        mentions
    }

    fn extract_slack_mentions(content: &str) -> Vec<Mention> {
        let mut mentions = Vec::new();
        let mut i = 0;
        let chars: Vec<char> = content.chars().collect();

        while i < chars.len() {
            if i + 1 < chars.len() && chars[i] == '<' && chars[i + 1] == '@' {
                let id_start = i + 2;
                let mut id_end = id_start;
                let mut display = None;

                while id_end < chars.len() && chars[id_end] != '>' && chars[id_end] != '|' {
                    id_end += 1;
                }

                if id_end < chars.len() {
                    let id: String = chars[id_start..id_end].iter().collect();

                    // Check for display name after |
                    if chars[id_end] == '|' {
                        let display_start = id_end + 1;
                        let mut display_end = display_start;
                        while display_end < chars.len() && chars[display_end] != '>' {
                            display_end += 1;
                        }
                        if display_end < chars.len() {
                            display = Some(chars[display_start..display_end].iter().collect());
                            id_end = display_end;
                        }
                    }

                    mentions.push(Mention {
                        kind: MentionKind::User,
                        id,
                        display,
                    });
                    i = id_end + 1;
                    continue;
                }
            }
            i += 1;
        }

        mentions
    }
}

/// A mention extracted from message content
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Mention {
    pub kind: MentionKind,
    pub id: String,
    pub display: Option<String>,
}

/// Kind of mention
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MentionKind {
    User,
    Channel,
    Role,
    Everyone,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discord_user_mention() {
        let mentions = InboundAdapter::extract_discord_mentions("Hello <@123456789>");
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "123456789");
    }

    #[test]
    fn test_discord_nickname_mention() {
        let mentions = InboundAdapter::extract_discord_mentions("Hello <@!987654321>");
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "987654321");
    }

    #[test]
    fn test_discord_channel_mention() {
        let mentions = InboundAdapter::extract_discord_mentions("See <#111222333>");
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "111222333");
        matches!(mentions[0].kind, MentionKind::Channel);
    }

    #[test]
    fn test_telegram_mention() {
        let mentions = InboundAdapter::extract_telegram_mentions("Hello @username_bot");
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "username_bot");
    }

    #[test]
    fn test_slack_mention() {
        let mentions = InboundAdapter::extract_slack_mentions("Hello <@U12345|john>");
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "U12345");
        assert_eq!(mentions[0].display.as_deref(), Some("john"));
    }

    #[test]
    fn test_slack_mention_no_display() {
        let mentions = InboundAdapter::extract_slack_mentions("Hello <@U99999>");
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "U99999");
        assert!(mentions[0].display.is_none());
    }
}
