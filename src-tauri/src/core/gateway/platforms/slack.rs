//! Slack webhook parser
//!
//! Parses Slack webhook payloads into GatewayMessage format.

use serde::Deserialize;
use std::collections::HashMap;

use super::super::types::{GatewayMessage, Platform, MessageAttachment, GATEWAY_PROTOCOL_VERSION};

/// Slack webhook payload structure (URL verification challenge)
#[derive(Debug, Deserialize)]
pub struct SlackUrlVerification {
    pub token: String,
    pub challenge: String,
    #[serde(rename = "type")]
    pub type_field: String,
}

/// Slack event callback payload
#[derive(Debug, Deserialize)]
pub struct SlackEventCallback {
    pub token: String,
    pub team_id: String,
    pub api_app_id: String,
    pub event: SlackEvent,
    #[serde(rename = "type")]
    pub type_field: String,
    pub event_id: String,
    pub event_time: u64,
}

/// Slack event structure
#[derive(Debug, Deserialize)]
pub struct SlackEvent {
    pub id: String,
    pub channel: String,
    pub user: String,
    pub text: String,
    pub ts: String,
    #[serde(rename = "thread_ts")]
    pub thread_ts: Option<String>,
    pub event_type: String,
    pub bot_id: Option<String>,
    pub channel_type: Option<String>,
    pub files: Option<Vec<SlackFile>>,
}

/// Slack file attachment
#[derive(Debug, Deserialize)]
pub struct SlackFile {
    pub id: String,
    pub name: Option<String>,
    pub title: Option<String>,
    pub filetype: Option<String>,
    pub size: u64,
    pub url: Option<String>,
    pub permalink: Option<String>,
}

/// Slack message action (for interactive messages)
#[derive(Debug, Deserialize)]
pub struct SlackMessageAction {
    pub type_field: String,
    pub action_ts: String,
    pub block_id: Option<String>,
    pub action_id: Option<String>,
    pub value: Option<String>,
}

/// Parse a Slack webhook payload into a GatewayMessage
pub fn parse_payload(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    // Check for URL verification challenge
    if let Some(type_field) = payload.get("type").and_then(|v| v.as_str()) {
        if type_field == "url_verification" {
            return Err("URL verification challenge - not a message".to_string());
        }
    }

    // Check for event callback
    if let Some(type_field) = payload.get("type").and_then(|v| v.as_str()) {
        if type_field == "event_callback" {
            return parse_event_callback(payload);
        }
    }

    // Try direct message format
    if let Ok(event) = serde_json::from_value(payload.clone()) {
        return parse_event(event);
    }

    Err("Unknown Slack payload format".to_string())
}

/// Parse an event callback payload
fn parse_event_callback(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    let event: SlackEvent = serde_json::from_value(
        payload
            .get("event")
            .ok_or("Missing 'event' field in Slack payload")?
            .clone()
    )
    .map_err(|e| format!("Failed to parse Slack event: {}", e))?;

    parse_event(event)
}

/// Parse a Slack event into a GatewayMessage
fn parse_event(event: SlackEvent) -> Result<GatewayMessage, String> {
    // Skip bot messages
    if event.bot_id.is_some() {
        return Err("Bot messages are not processed".to_string());
    }

    // Skip non-message events
    if event.event_type != "message" {
        return Err(format!("Skipping non-message event: {}", event.event_type));
    }

    // Extract mentions from text
    let _mentions = extract_mentions(&event.text);

    // Extract attachments
    let _attachments = extract_files(&event.files);

    // Build metadata
    let mut metadata = HashMap::new();
    metadata.insert("team_id".to_string(), serde_json::json!(event.id.chars().take(10).collect::<String>()));
    metadata.insert("thread_ts".to_string(), serde_json::json!(event.thread_ts));
    metadata.insert("event_type".to_string(), serde_json::json!(event.event_type));

    if let Some(ref files) = event.files {
        metadata.insert("files".to_string(), serde_json::json!(
            files.iter().map(|f| {
                serde_json::json!({
                    "id": f.id,
                    "name": f.name,
                    "title": f.title,
                    "filetype": f.filetype,
                    "size": f.size,
                    "url": f.url,
                })
            }).collect::<Vec<_>>()
        ));
    }

    Ok(GatewayMessage {
        id: event.id,
        platform: Platform::Slack,
        user_id: event.user,
        channel_id: event.channel,
        guild_id: None, // Slack doesn't have guilds, use team_id from parent
        content: event.text,
        timestamp: parse_slack_timestamp(&event.ts),
        metadata,
        protocol_version: GATEWAY_PROTOCOL_VERSION.to_string(),
    })
}

/// Extract Slack mentions from text
fn extract_mentions(text: &str) -> Vec<String> {
    let mut mentions = Vec::new();

    // Slack mention formats:
    // <@U12345678> - user mention
    // <@U12345678|username> - user mention with display
    // <!channel> - channel mention
    // <!everyone> - everyone mention

    // User mentions
    let re = regex::Regex::new(r"<@([UW]\w+)(?:\|[^>]+)?>").unwrap();
    for cap in re.captures_iter(text) {
        if let Some(id) = cap.get(1) {
            mentions.push(format!("@slack:{}", id.as_str()));
        }
    }

    mentions
}

/// Extract files from Slack event
fn extract_files(files: &Option<Vec<SlackFile>>) -> Vec<MessageAttachment> {
    match files {
        Some(files) => files
            .iter()
            .map(|f| MessageAttachment {
                url: f.url.clone().unwrap_or_default(),
                file_type: f.filetype.clone().unwrap_or_default(),
                name: f.name.clone().or(f.title.clone()).unwrap_or_else(|| f.id.clone()),
                size: f.size,
            })
            .collect(),
        None => Vec::new(),
    }
}

/// Parse Slack timestamp (Unix epoch seconds as string)
fn parse_slack_timestamp(ts: &str) -> u64 {
    ts.parse::<f64>()
        .map(|t| (t * 1000.0) as u64)
        .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_slack_message() {
        let payload = serde_json::json!({
            "token": "test-token",
            "team_id": "T123456",
            "api_app_id": "A123456",
            "event": {
                "id": "evt123",
                "channel": "C987654",
                "user": "U555666",
                "text": "Hello <@U111222>!",
                "ts": "1705315200.000000",
                "thread_ts": "1705315210.000000",
                "event_type": "message",
                "bot_id": null
            },
            "type": "event_callback",
            "event_id": "Ev123456",
            "event_time": 1705315200
        });

        let result = parse_payload(&payload);
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.platform, Platform::Slack);
        assert_eq!(message.user_id, "U555666");
        assert_eq!(message.channel_id, "C987654");
        assert!(message.content.contains("Hello"));
    }

    #[test]
    fn test_extract_mentions() {
        let text = "Hey <@U123456> and <@U789012|john>!";
        let mentions = extract_mentions(text);
        assert_eq!(mentions.len(), 2);
        assert!(mentions.contains(&"@slack:U123456".to_string()));
        assert!(mentions.contains(&"@slack:U789012".to_string()));
    }

    #[test]
    fn test_skip_bot_message() {
        let event = SlackEvent {
            id: "evt123".to_string(),
            channel: "C123".to_string(),
            user: "U123".to_string(),
            text: "Bot message".to_string(),
            ts: "1705315200.000000".to_string(),
            thread_ts: None,
            event_type: "message".to_string(),
            bot_id: Some("B123".to_string()),
            channel_type: Some("channel".to_string()),
            files: None,
        };

        let result = parse_event(event);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Bot"));
    }

    #[test]
    fn test_url_verification() {
        let payload = serde_json::json!({
            "token": "test-token",
            "challenge": "challenge-string",
            "type": "url_verification"
        });

        let result = parse_payload(&payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("verification"));
    }
}