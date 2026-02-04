//! Telegram webhook parser
//!
//! Parses Telegram webhook payloads into GatewayMessage format.

use serde::Deserialize;
use std::collections::HashMap;

use super::super::types::{GatewayMessage, Platform, MessageAttachment, GATEWAY_PROTOCOL_VERSION};

/// Telegram update structure
#[derive(Debug, Deserialize)]
pub struct TelegramUpdate {
    /// Update ID
    pub update_id: u64,

    /// Message (if present)
    pub message: Option<TelegramMessage>,

    /// Edited message (if present)
    pub edited_message: Option<TelegramMessage>,

    /// Channel post (if present)
    pub channel_post: Option<TelegramMessage>,

    /// Callback query (for inline keyboards)
    pub callback_query: Option<TelegramCallbackQuery>,
}

/// Telegram message structure
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramMessage {
    /// Message ID
    pub message_id: u64,

    /// User who sent the message
    pub from: Option<TelegramUser>,

    /// Chat where the message was sent
    pub chat: TelegramChat,

    /// Date the message was sent (Unix timestamp)
    pub date: u64,

    /// Text content (if text message)
    pub text: Option<String>,

    /// Entities (mentions, hashtags, etc.)
    pub entities: Option<Vec<TelegramMessageEntity>>,

    /// Attachments
    pub photo: Option<Vec<TelegramPhoto>>,
    pub document: Option<TelegramDocument>,
    pub audio: Option<TelegramAudio>,
    pub video: Option<TelegramVideo>,
    pub voice: Option<TelegramVoice>,

    /// Reply to message
    pub reply_to_message: Option<Box<TelegramMessage>>,

    /// Forward from
    pub forward_from: Option<TelegramUser>,
    pub forward_date: Option<u64>,
}

/// Telegram user structure
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramUser {
    pub id: u64,
    pub is_bot: bool,
    pub first_name: String,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub language_code: Option<String>,
}

/// Telegram chat structure
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub type_field: String,
    pub title: Option<String>,
    pub username: Option<String>,
}

/// Telegram message entity (for parsing mentions)
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramMessageEntity {
    #[serde(rename = "type")]
    pub type_field: String,
    pub offset: u64,
    pub length: u64,
    pub url: Option<String>,
    pub user: Option<TelegramUser>,
}

/// Telegram photo size
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramPhoto {
    pub file_id: String,
    pub file_unique_id: String,
    pub width: u64,
    pub height: u64,
    pub file_size: Option<u64>,
}

/// Telegram document (file)
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramDocument {
    pub file_id: String,
    pub file_unique_id: String,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<u64>,
}

/// Telegram audio
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramAudio {
    pub file_id: String,
    pub file_unique_id: String,
    pub duration: u64,
    pub performer: Option<String>,
    pub title: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<u64>,
}

/// Telegram video
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramVideo {
    pub file_id: String,
    pub file_unique_id: String,
    pub width: u64,
    pub height: u64,
    pub duration: u64,
    pub mime_type: Option<String>,
    pub file_size: Option<u64>,
}

/// Telegram voice
#[derive(Debug, Deserialize, Clone)]
pub struct TelegramVoice {
    pub file_id: String,
    pub file_unique_id: String,
    pub duration: u64,
    pub mime_type: Option<String>,
    pub file_size: Option<u64>,
}

/// Telegram callback query (for inline keyboards)
#[derive(Debug, Deserialize)]
pub struct TelegramCallbackQuery {
    pub id: String,
    pub from: TelegramUser,
    pub message: Option<TelegramMessage>,
    pub data: Option<String>,
}

/// Parse a Telegram webhook payload into a GatewayMessage
pub fn parse_payload(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    // Parse the update
    let update: TelegramUpdate = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Failed to parse Telegram payload: {}", e))?;

    // Get the message (from any of the possible fields)
    let message = update
        .message
        .or(update.edited_message)
        .or(update.channel_post)
        .ok_or("No message found in Telegram update")?;

    parse_message(update.update_id, message)
}

/// Parse a Telegram message into a GatewayMessage
fn parse_message(update_id: u64, message: TelegramMessage) -> Result<GatewayMessage, String> {
    // Get user info
    let (user_id, username) = match &message.from {
        Some(user) => (user.id.to_string(), user.username.clone()),
        None => ("unknown".to_string(), None),
    };

    // Get channel/chat ID
    let channel_id = message.chat.id.to_string();

    // Get text content
    let content = message.text.clone().unwrap_or_else(|| {
        // Try to extract text from other attachment types
        if let Some(ref photo) = message.photo {
            if let Some(photo_size) = photo.last() {
                return format!("[Photo: {}x{}]", photo_size.width, photo_size.height);
            }
        }
        if let Some(ref doc) = message.document {
            return format!("[Document: {}]", doc.file_name.clone().unwrap_or_else(|| "file".to_string()));
        }
        if let Some(ref audio) = message.audio {
            return format!("[Audio: {}s]", audio.duration);
        }
        if let Some(ref video) = message.video {
            return format!("[Video: {}s]", video.duration);
        }
        "[Unknown attachment type]".to_string()
    });

    // Extract mentions from entities
    let mentions = extract_mentions(&content, &message.entities);

    // Extract attachments
    let attachments = extract_attachments(&message);

    // Build metadata
    let mut metadata = HashMap::new();
    metadata.insert("update_id".to_string(), serde_json::json!(update_id));
    metadata.insert("message_id".to_string(), serde_json::json!(message.message_id));
    metadata.insert("chat_id".to_string(), serde_json::json!(message.chat.id));
    metadata.insert("chat_type".to_string(), serde_json::json!(message.chat.type_field));
    metadata.insert("chat_title".to_string(), serde_json::json!(message.chat.title));
    metadata.insert("date".to_string(), serde_json::json!(message.date));

    if let Some(ref user) = message.from {
        metadata.insert("user".to_string(), serde_json::json!({
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "is_bot": user.is_bot,
        }));
    }

    // Add reply info
    if let Some(ref reply) = message.reply_to_message {
        metadata.insert("reply_to_message_id".to_string(), serde_json::json!(reply.message_id));
    }

    // Add forward info
    if let (Some(_forward), Some(_date)) = (&message.forward_from, message.forward_date) {
        metadata.insert("forward_date".to_string(), serde_json::json!(message.forward_date));
    }

    Ok(GatewayMessage {
        id: format!("{}-{}", update_id, message.message_id),
        platform: Platform::Telegram,
        user_id,
        channel_id,
        guild_id: None,
        content,
        timestamp: (message.date as u64) * 1000,
        metadata,
        protocol_version: GATEWAY_PROTOCOL_VERSION.to_string(),
    })
}

/// Extract mentions from Telegram message
fn extract_mentions(text: &str, entities: &Option<Vec<TelegramMessageEntity>>) -> Vec<String> {
    let mut mentions = Vec::new();

    if let Some(ents) = entities {
        for entity in ents {
            if entity.type_field == "mention" {
                // Extract the mention from the text
                let start = entity.offset as usize;
                let end = start + entity.length as usize;
                if start < text.len() && end <= text.len() {
                    let mention_text = &text[start..end];
                    mentions.push(format!("@telegram:{}", mention_text));
                }
            } else if entity.type_field == "text_mention" {
                if let Some(ref user) = entity.user {
                    mentions.push(format!("@telegram:{}", user.username.clone().unwrap_or_else(|| user.id.to_string())));
                }
            }
        }
    }

    mentions
}

/// Extract attachments from Telegram message
fn extract_attachments(message: &TelegramMessage) -> Vec<MessageAttachment> {
    let mut attachments = Vec::new();

    // Photos
    if let Some(ref photos) = message.photo {
        if let Some(photo) = photos.last() {
            attachments.push(MessageAttachment {
                url: format!("tg://photo/{}", photo.file_id),
                file_type: "image".to_string(),
                name: format!("photo_{}.jpg", photo.file_id),
                size: photo.file_size.unwrap_or(0),
            });
        }
    }

    // Document
    if let Some(ref doc) = message.document {
        attachments.push(MessageAttachment {
            url: format!("tg://document/{}", doc.file_id),
            file_type: doc.mime_type.clone().unwrap_or_else(|| "application/octet-stream".to_string()),
            name: doc.file_name.clone().unwrap_or_else(|| format!("document_{}", doc.file_id)),
            size: doc.file_size.unwrap_or(0),
        });
    }

    // Audio
    if let Some(ref audio) = message.audio {
        attachments.push(MessageAttachment {
            url: format!("tg://audio/{}", audio.file_id),
            file_type: audio.mime_type.clone().unwrap_or_else(|| "audio".to_string()),
            name: format!("audio_{}.mp3", audio.file_id),
            size: audio.file_size.unwrap_or(0),
        });
    }

    // Video
    if let Some(ref video) = message.video {
        attachments.push(MessageAttachment {
            url: format!("tg://video/{}", video.file_id),
            file_type: video.mime_type.clone().unwrap_or_else(|| "video".to_string()),
            name: format!("video_{}.mp4", video.file_id),
            size: video.file_size.unwrap_or(0),
        });
    }

    // Voice
    if let Some(ref voice) = message.voice {
        attachments.push(MessageAttachment {
            url: format!("tg://voice/{}", voice.file_id),
            file_type: voice.mime_type.clone().unwrap_or_else(|| "audio/ogg".to_string()),
            name: format!("voice_{}.ogg", voice.file_id),
            size: voice.file_size.unwrap_or(0),
        });
    }

    attachments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_telegram_message() {
        let payload = serde_json::json!({
            "update_id": 123456789,
            "message": {
                "message_id": 1234,
                "from": {
                    "id": 987654321,
                    "is_bot": false,
                    "first_name": "John",
                    "last_name": "Doe",
                    "username": "johndoe",
                    "language_code": "en"
                },
                "chat": {
                    "id": -1001234567890,
                    "type_field": "supergroup",
                    "title": "Test Group"
                },
                "date": 1705315200,
                "text": "Hello <@johndoe>!"
            }
        });

        let result = parse_payload(&payload);
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.platform, Platform::Telegram);
        assert_eq!(message.user_id, "987654321");
        assert_eq!(message.channel_id, "-1001234567890");
        assert!(message.content.contains("Hello"));
    }

    #[test]
    fn test_extract_mentions() {
        let text = "Hey @username how are you?";
        let entities = Some(vec![
            TelegramMessageEntity {
                type_field: "mention".to_string(),
                offset: 4,
                length: 9,
                url: None,
                user: None,
            }
        ]);

        let mentions = extract_mentions(&text, &entities);
        assert!(mentions.contains(&"@telegram:@username".to_string()));
    }

    #[test]
    fn test_parse_telegram_photo() {
        let payload = serde_json::json!({
            "update_id": 123456789,
            "message": {
                "message_id": 1234,
                "from": {
                    "id": 987654321,
                    "is_bot": false,
                    "first_name": "Test"
                },
                "chat": {
                    "id": 987654321,
                    "type_field": "private"
                },
                "date": 1705315200,
                "photo": [
                    {
                        "file_id": "abc123",
                        "file_unique_id": "abc123_unique",
                        "width": 100,
                        "height": 100,
                        "file_size": 1024
                    },
                    {
                        "file_id": "def456",
                        "file_unique_id": "def456_unique",
                        "width": 400,
                        "height": 400,
                        "file_size": 4096
                    }
                ]
            }
        });

        let result = parse_payload(&payload);
        assert!(result.is_ok());
        let message = result.unwrap();
        // Should show photo dimensions instead of text
        assert!(message.content.contains("400x400"));
    }

    #[test]
    fn test_handle_callback_query() {
        // Callback queries don't contain text, should be handled specially
        let payload = serde_json::json!({
            "update_id": 123456789,
            "callback_query": {
                "id": "callback123",
                "from": {
                    "id": 987654321,
                    "is_bot": false,
                    "first_name": "Test"
                },
                "message": {
                    "message_id": 1234,
                    "from": {
                        "id": 111,
                        "is_bot": true,
                        "first_name": "Bot"
                    },
                    "chat": {
                        "id": 987654321,
                        "type_field": "private"
                    },
                    "date": 1705315200,
                    "text": "Button pressed"
                },
                "data": "button_pressed"
            }
        });

        // Should parse the message from callback_query
        let result = parse_payload(&payload);
        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.user_id, "987654321");
    }
}