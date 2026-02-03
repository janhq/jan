use super::super::types::{GatewayMessage, NormalizedMessage, MessageAttachment};

/// Normalize a gateway message for processing by Jan
pub fn normalize(message: GatewayMessage) -> Result<NormalizedMessage, String> {
    let mut text = message.content.clone();

    // Extract mentions before stripping formatting
    let mentions = extract_mentions(&message.platform, &text, &message.metadata);

    // Strip platform-specific formatting
    match &message.platform {
        super::super::types::Platform::Discord => {
            text = strip_discord_formatting(&text);
        }
        super::super::types::Platform::Slack => {
            text = strip_slack_formatting(&text);
        }
        super::super::types::Platform::Telegram => {
            text = strip_telegram_formatting(&text, &message.metadata);
        }
        _ => {}
    }

    // Clean up extra whitespace
    text = clean_whitespace(&text);

    // Extract attachments
    let attachments = extract_attachments(&message.platform, &message.metadata);

    Ok(NormalizedMessage {
        id: message.id,
        source_platform: message.platform,
        source_user_id: message.user_id,
        source_channel_id: message.channel_id,
        text,
        mentions,
        attachments,
        timestamp: message.timestamp,
    })
}

/// Extract mentions from message based on platform
fn extract_mentions(
    platform: &super::super::types::Platform,
    text: &str,
    metadata: &std::collections::HashMap<String, serde_json::Value>,
) -> Vec<String> {
    let mut mentions = Vec::new();

    match platform {
        super::super::types::Platform::Discord => {
            // Discord mentions: <@user_id>, <@!user_id>, <#channel_id>
            let re = regex::Regex::new(r"<@!?(\d+)>").unwrap();
            for cap in re.captures_iter(text) {
                if let Some(id) = cap.get(1) {
                    mentions.push(format!("@discord:{}", id.as_str()));
                }
            }

            // Check for mention data in metadata
            if let Some(mentions_data) = metadata.get("mentions") {
                if let Some(arr) = mentions_data.as_array() {
                    for item in arr {
                        if let Some(user) = item.as_object() {
                            if let Some(id) = user.get("id").and_then(|v| v.as_str()) {
                                mentions.push(format!("@discord:{}", id));
                            }
                        }
                    }
                }
            }
        }
        super::super::types::Platform::Slack => {
            // Slack mentions: @user_id, <@user_id>
            let re1 = regex::Regex::new(r"<@(\w+)>").unwrap();
            let re2 = regex::Regex::new(r"@(\w+)").unwrap();

            for cap in re1.captures_iter(text).chain(re2.captures_iter(text)) {
                if let Some(id) = cap.get(1) {
                    mentions.push(format!("@slack:{}", id.as_str()));
                }
            }
        }
        super::super::types::Platform::Telegram => {
            // Telegram mentions: @username, user mentions in message entities
            let re = regex::Regex::new(r"@(\w+)").unwrap();
            for cap in re.captures_iter(text) {
                if let Some(username) = cap.get(1) {
                    mentions.push(format!("@telegram:{}", username.as_str()));
                }
            }

            // Check for entities in metadata
            if let Some(entities) = metadata.get("entities") {
                if let Some(arr) = entities.as_array() {
                    for entity in arr {
                        if let Some(obj) = entity.as_object() {
                            if obj.get("type").and_then(|v| v.as_str()) == Some("mention") {
                                if let Some(offset) = obj.get("offset").and_then(|v| v.as_u64()) {
                                    let offset = offset as usize;
                                    if let Some(length) = obj.get("length").and_then(|v| v.as_u64()) {
                                        let length = length as usize;
                                        if offset + length <= text.len() {
                                            mentions.push(format!("@telegram:{}", &text[offset..offset + length]));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }

    mentions
}

/// Strip Discord-specific formatting
fn strip_discord_formatting(text: &str) -> String {
    // Code blocks: ```code```
    let re = regex::Regex::new(r"`{3}[\s\S]*?`{3}").unwrap();
    let text = re.replace_all(text, |caps: &regex::Captures| {
        format!("[code block: {}]", caps[0].len())
    });

    // Inline code: `code`
    let re = regex::Regex::new(r"`([^`]+)`").unwrap();
    let text = re.replace_all(&text, "$1");

    // Bold: **text** or __text__
    let re = regex::Regex::new(r"\*\*(.+?)\*\*").unwrap();
    let text = re.replace_all(&text, "$1");

    let re = regex::Regex::new(r"__(.+?)__").unwrap();
    let text = re.replace_all(&text, "$1");

    // Italic: *text* or _text_
    let re = regex::Regex::new(r"(?<!\*)\*([^\s*]+)\*(?!\*)").unwrap();
    let text = re.replace_all(&text, "$1");

    let re = regex::Regex::new(r"(?<!_)_(.+?)_(?!_)").unwrap();
    let text = re.replace_all(&text, "$1");

    // Strikethrough: ~~text~~
    let re = regex::Regex::new(r"~~(.+?)~~").unwrap();
    let text = re.replace_all(&text, "$1");

    // URLs: [text](url)
    let re = regex::Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap();
    let text = re.replace_all(&text, "$1 ($2)");

    // Spoiler: ||text||
    let re = regex::Regex::new(r"\|\|(.+?)\|\|").unwrap();
    let text = re.replace_all(&text, "[spoiler]$1[/spoiler]");

    text.to_string()
}

/// Strip Slack-specific formatting
fn strip_slack_formatting(text: &str) -> String {
    // Code blocks: ```code```
    let re = regex::Regex::new(r"`{3}[\s\S]*?`{3}").unwrap();
    let text = re.replace_all(text, |caps: &regex::Captures| {
        format!("[code block: {}]", caps[0].len())
    });

    // Inline code: `code`
    let re = regex::Regex::new(r"`([^`]+)`").unwrap();
    let text = re.replace_all(&text, "$1");

    // Bold: *text*
    let re = regex::Regex::new(r"\*([^*]+)\*").unwrap();
    let text = re.replace_all(&text, "$1");

    // Italic: _text_
    let re = regex::Regex::new(r"_([^_]+)_").unwrap();
    let text = re.replace_all(&text, "$1");

    // Strike: ~text~
    let re = regex::Regex::new(r"~([^~]+)~").unwrap();
    let text = re.replace_all(&text, "$1");

    // Links: <url|text>
    let re = regex::Regex::new(r"<([^|]+)\|([^>]+)>").unwrap();
    let text = re.replace_all(&text, "$2 ($1)");

    // Simple links: <url>
    let re = regex::Regex::new(r"<([^>]+)>").unwrap();
    let text = re.replace_all(&text, "$1");

    text.to_string()
}

/// Strip Telegram-specific formatting
fn strip_telegram_formatting(text: &str, metadata: &std::collections::HashMap<String, serde_json::Value>) -> String {
    // Telegram uses Markdown V2, but we also need to handle entities
    let mut result = text.to_string();

    // Handle entities from metadata
    if let Some(entities) = metadata.get("entities") {
        if let Some(arr) = entities.as_array() {
            // Process in reverse order to maintain offsets
            for entity in arr.iter().rev() {
                if let Some(obj) = entity.as_object() {
                    if let (Some(offset), Some(length)) = (
                        obj.get("offset").and_then(|v| v.as_u64()),
                        obj.get("length").and_then(|v| v.as_u64()),
                    ) {
                        let offset = offset as usize;
                        let length = length as usize;
                        if offset + length <= result.len() {
                            let (before, after) = result.split_at(offset + length);
                            let entity_text = &before[offset..];

                            let replacement = match obj.get("type").and_then(|v| v.as_str()) {
                                Some("bold") | Some("strong") => format!("**{}**", entity_text),
                                Some("italic") | Some("emphasize") => format!("__{}__", entity_text),
                                Some("code") | Some("pre") => format!("`{}`", entity_text),
                                Some("underline") | Some("ins") => format!("__{}__", entity_text),
                                Some("strikethrough") | Some("del") => format!("~~{}~~", entity_text),
                                _ => entity_text.to_string(),
                            };

                            result = format!("{}{}", &before[..offset], replacement)
                                + after;
                        }
                    }
                }
            }
        }
    }

    result
}

/// Clean up whitespace
fn clean_whitespace(text: &str) -> String {
    // Replace multiple spaces/newlines with single space
    let re = regex::Regex::new(r"\s+").unwrap();
    re.replace_all(text, " ").trim().to_string()
}

/// Extract attachments from message
fn extract_attachments(
    platform: &super::super::types::Platform,
    metadata: &std::collections::HashMap<String, serde_json::Value>,
) -> Vec<MessageAttachment> {
    let mut attachments = Vec::new();

    match platform {
        super::super::types::Platform::Discord => {
            if let Some(attachments_data) = metadata.get("attachments") {
                if let Some(arr) = attachments_data.as_array() {
                    for item in arr {
                        if let Some(obj) = item.as_object() {
                            let url = obj.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let name = obj.get("filename")
                                .or(obj.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("attachment")
                                .to_string();
                            let file_type = obj.get("content_type")
                                .or(obj.get("content_type"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();

                            attachments.push(MessageAttachment {
                                url,
                                file_type,
                                name,
                                size: 0,
                            });
                        }
                    }
                }
            }
        }
        super::super::types::Platform::Telegram => {
            if let Some(photos) = metadata.get("photo") {
                if let Some(arr) = photos.as_array() {
                    // Use the largest photo
                    if let Some(photo) = arr.last() {
                        if let Some(obj) = photo.as_object() {
                            let file_id = obj.get("file_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            attachments.push(MessageAttachment {
                                url: format!("tg://photo/{}", file_id),
                                file_type: "image/jpeg".to_string(),
                                name: "photo.jpg".to_string(),
                                size: 0,
                            });
                        }
                    }
                }
            }

            if let Some(doc) = metadata.get("document") {
                if let Some(obj) = doc.as_object() {
                    let file_id = obj.get("file_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let file_name = obj.get("file_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("document");
                    let mime_type = obj.get("mime_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    attachments.push(MessageAttachment {
                        url: format!("tg://document/{}", file_id),
                        file_type: mime_type.to_string(),
                        name: file_name.to_string(),
                        size: 0,
                    });
                }
            }
        }
        _ => {}
    }

    attachments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_discord_formatting() {
        let input = "Hello **bold** and *italic* and `code` and ~~strikethrough~~";
        let output = strip_discord_formatting(input);
        assert!(output.contains("Hello"));
        assert!(output.contains("bold"));
        assert!(!output.contains("**"));
    }

    #[test]
    fn test_clean_whitespace() {
        let input = "Hello    world\n\nTest  123";
        let output = clean_whitespace(input);
        assert_eq!(output, "Hello world Test 123");
    }

    #[test]
    fn test_extract_mentions_discord() {
        let text = "Hey <@123456789> check this out";
        let metadata = std::collections::HashMap::new();
        let mentions = extract_mentions(&super::super::types::Platform::Discord, text, &metadata);

        assert!(mentions.contains(&"@discord:123456789".to_string()));
    }

    #[test]
    fn test_normalize_basic_message() {
        let message = GatewayMessage::new(
            super::super::types::Platform::Discord,
            "user123".to_string(),
            "channel456".to_string(),
            "Hello **world**!".to_string(),
        );

        let result = normalize(message);
        assert!(result.is_ok());
        let normalized = result.unwrap();
        assert!(normalized.text.contains("Hello"));
        assert!(!normalized.text.contains("**"));
    }
}