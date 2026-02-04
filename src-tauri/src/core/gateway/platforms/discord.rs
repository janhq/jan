//! Discord webhook parser
//!
//! Parses Discord webhook payloads into GatewayMessage format.

use serde::Deserialize;
use std::collections::HashMap;

use super::super::types::{GatewayMessage, MessageAttachment, Platform, GATEWAY_PROTOCOL_VERSION};

/// Discord webhook payload structure
#[derive(Debug, Deserialize)]
pub struct DiscordWebhookPayload {
    /// Message ID
    pub id: String,

    /// Channel ID where the message was sent
    pub channel_id: String,

    /// Guild ID (server) where the message was sent
    pub guild_id: Option<String>,

    /// Message author
    pub author: DiscordUser,

    /// Message content
    pub content: String,

    /// Message timestamp (ISO 8601)
    pub timestamp: Option<String>,

    /// Attachments
    #[serde(default)]
    pub attachments: Vec<DiscordAttachment>,

    /// Message mentions
    #[serde(default)]
    pub mentions: Vec<DiscordMention>,

    /// Message type
    #[serde(default)]
    pub t: Option<String>,
}

/// Discord user structure
#[derive(Debug, Deserialize)]
pub struct DiscordUser {
    pub id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub discriminator: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub bot: Option<bool>,
}

/// Discord attachment structure
#[derive(Debug, Deserialize)]
pub struct DiscordAttachment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub width: Option<u64>,
    #[serde(default)]
    pub height: Option<u64>,
}

/// Discord mention structure
#[derive(Debug, Deserialize)]
pub struct DiscordMention {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub discriminator: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub bot: Option<bool>,
}

/// Parse a Discord webhook payload into a GatewayMessage
pub fn parse_payload(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    // Parse the Discord payload
    let discord_payload: DiscordWebhookPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Failed to parse Discord payload: {}", e))?;

    // Extract mentions from metadata
    let mentions = extract_mentions(&discord_payload);

    // Extract attachments
    let attachments = extract_attachments(&discord_payload);

    // Build metadata
    let mut metadata = HashMap::new();

    // Add guild_id if present
    if let Some(guild_id) = &discord_payload.guild_id {
        metadata.insert("guild_id".to_string(), serde_json::json!(guild_id));
    }

    // Add author info
    metadata.insert(
        "author".to_string(),
        serde_json::json!({
            "id": discord_payload.author.id,
            "username": discord_payload.author.username,
            "bot": discord_payload.author.bot.unwrap_or(false),
        }),
    );

    // Add mentions
    metadata.insert("mentions".to_string(), serde_json::json!(mentions));

    // Add attachments
    metadata.insert(
        "attachments".to_string(),
        serde_json::json!(discord_payload
            .attachments
            .iter()
            .map(|a| {
                serde_json::json!({
                    "id": a.id,
                    "filename": a.filename,
                    "content_type": a.content_type,
                    "size": a.size,
                    "url": a.url,
                    "proxy_url": a.proxy_url,
                })
            })
            .collect::<Vec<_>>()),
    );

    // Add timestamp
    if let Some(timestamp) = &discord_payload.timestamp {
        metadata.insert("timestamp".to_string(), serde_json::json!(timestamp));
    }

    Ok(GatewayMessage {
        id: discord_payload.id,
        platform: Platform::Discord,
        user_id: discord_payload.author.id,
        channel_id: discord_payload.channel_id,
        guild_id: discord_payload.guild_id,
        content: discord_payload.content,
        timestamp: parse_discord_timestamp(&discord_payload.timestamp),
        metadata,
        protocol_version: GATEWAY_PROTOCOL_VERSION.to_string(),
    })
}

/// Extract mentions from Discord payload
fn extract_mentions(payload: &DiscordWebhookPayload) -> Vec<String> {
    let mut mentions = Vec::new();

    // Parse mentions from content (Discord format: <@user_id>, <@!user_id>, <#channel_id>)
    let re = regex::Regex::new(r"<@!?(\d+)>").unwrap();
    for cap in re.captures_iter(&payload.content) {
        if let Some(id) = cap.get(1) {
            mentions.push(format!("@discord:{}", id.as_str()));
        }
    }

    // Also add mentions from the mentions array
    for mention in &payload.mentions {
        mentions.push(format!("@discord:{}", mention.id));
    }

    mentions
}

/// Extract attachments from Discord payload
fn extract_attachments(payload: &DiscordWebhookPayload) -> Vec<MessageAttachment> {
    payload
        .attachments
        .iter()
        .map(|a| MessageAttachment {
            url: a.url.clone().unwrap_or_default(),
            file_type: a.content_type.clone().unwrap_or_default(),
            name: a.filename.clone().unwrap_or_else(|| a.id.clone()),
            size: a.size,
        })
        .collect()
}

/// Parse Discord timestamp to milliseconds
fn parse_discord_timestamp(timestamp: &Option<String>) -> u64 {
    if let Some(ts) = timestamp {
        // Discord uses ISO 8601 format: 2024-01-15T10:30:00.000Z
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
            return dt.timestamp_millis() as u64;
        }
    }
    chrono::Utc::now().timestamp_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_discord_payload() {
        let payload = serde_json::json!({
            "id": "1234567890",
            "channel_id": "9876543210",
            "guild_id": "111222333444",
            "author": {
                "id": "555666777888",
                "username": "testuser",
                "discriminator": "1234",
                "bot": false
            },
            "content": "Hello <@555666777888>!",
            "timestamp": "2024-01-15T10:30:00.000Z",
            "attachments": [
                {
                    "id": "aaa",
                    "filename": "image.png",
                    "content_type": "image/png",
                    "size": 1024,
                    "url": "https://cdn.example.com/image.png"
                }
            ],
            "mentions": []
        });

        let result = parse_payload(&payload);
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.platform, Platform::Discord);
        assert_eq!(message.user_id, "555666777888");
        assert_eq!(message.channel_id, "9876543210");
        assert_eq!(message.guild_id, Some("111222333444".to_string()));
        assert!(message.content.contains("Hello"));
    }

    #[test]
    fn test_extract_mentions() {
        let payload = DiscordWebhookPayload {
            id: "test".to_string(),
            channel_id: "test".to_string(),
            guild_id: None,
            author: DiscordUser {
                id: "user123".to_string(),
                username: "test".to_string(),
                discriminator: None,
                avatar: None,
                bot: None,
            },
            content: "Hey <@123456789> and <@!987654321>!".to_string(),
            timestamp: None,
            attachments: vec![],
            mentions: vec![],
            t: None,
        };

        let mentions = extract_mentions(&payload);
        assert!(mentions.contains(&"@discord:123456789".to_string()));
        assert!(mentions.contains(&"@discord:987654321".to_string()));
    }
}
