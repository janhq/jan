//! Telegram Bot Module
//!
//! Handles Telegram Bot API communication for sending messages.
//! Uses direct HTTP calls to Telegram API - no heavy SDK dependency.

use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

use crate::core::gateway::types::GatewayResponse;

/// Telegram bot configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TelegramBotConfig {
    pub bot_token: Option<String>,
    pub api_url: String,
    pub enabled: bool,
}

impl TelegramBotConfig {
    pub fn new(bot_token: String) -> Self {
        Self {
            bot_token: Some(bot_token),
            api_url: "https://api.telegram.org/bot".to_string(),
            enabled: true,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.bot_token.is_some() && !self.bot_token.as_ref().unwrap().is_empty()
    }
}

/// Telegram bot state
#[derive(Debug, Default)]
pub struct TelegramBotState {
    pub config: TelegramBotConfig,
    pub running: bool,
    pub last_error: Option<String>,
}

impl TelegramBotState {
    pub fn new() -> Self {
        Self {
            config: TelegramBotConfig::default(),
            running: false,
            last_error: None,
        }
    }
}

/// Shared Telegram bot state
pub type SharedTelegramBotState = Arc<Mutex<TelegramBotState>>;

/// Create a new shared Telegram bot state
pub fn create_telegram_bot_state() -> SharedTelegramBotState {
    Arc::new(Mutex::new(TelegramBotState::new()))
}

/// Send a message to Telegram via Bot API
pub async fn send_message(
    bot_token: &str,
    chat_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<TelegramSendResult, TelegramError> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);

    let mut body = serde_json::Map::new();
    body.insert("chat_id".to_string(), serde_json::json!(chat_id));
    body.insert("text".to_string(), serde_json::json!(text));
    body.insert("parse_mode".to_string(), serde_json::json!("HTML"));

    if let Some(reply_id) = reply_to_message_id {
        body.insert("reply_to_message_id".to_string(), serde_json::json!(reply_id));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let response_text = response.text().await
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let result: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| TelegramError::Parse(e.to_string()))?;

    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let error_msg = result.get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(TelegramError::Api(error_msg.to_string()));
    }

    // Parse result
    let message = &result["result"];
    let message_id = message.get("message_id")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Ok(TelegramSendResult {
        message_id: message_id.to_string(),
        chat_id: chat_id.to_string(),
        timestamp: chrono::Utc::now().timestamp_millis() as u64,
    })
}

/// Send a reply to a Telegram message
pub async fn send_reply(
    bot_token: &str,
    chat_id: &str,
    text: &str,
    reply_to_message_id: &str,
) -> Result<TelegramSendResult, TelegramError> {
    send_message(bot_token, chat_id, text, Some(reply_to_message_id)).await
}

/// Send text to multiple chats (broadcast)
pub async fn send_to_multiple(
    bot_token: &str,
    chat_ids: &[String],
    text: &str,
) -> Vec<Result<TelegramSendResult, TelegramError>> {
    let mut results = Vec::new();

    for chat_id in chat_ids {
        let result = send_message(bot_token, chat_id, text, None).await;
        results.push(result);
    }

    results
}

/// Telegram send result
#[derive(Debug, Clone)]
pub struct TelegramSendResult {
    pub message_id: String,
    pub chat_id: String,
    pub timestamp: u64,
}

/// Telegram error types
#[derive(Debug, thiserror::Error)]
pub enum TelegramError {
    #[error("Network error: {0}")]
    Network(String),
    #[error("API error: {0}")]
    Api(String),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Configuration error: {0}")]
    Config(String),
}

/// Format markdown to Telegram HTML
pub fn format_to_telegram_html(text: &str) -> String {
    // Simple markdown to Telegram HTML conversion
    let mut result = text.to_string();

    // Bold: **text** or __text__ → <b>text</b>
    result = regex::Regex::new(r"\*\*([^*]+)\*\*")
        .unwrap()
        .replace_all(&result, "<b>$1</b>")
        .to_string();

    result = regex::Regex::new(r"__([^_]+)__")
        .unwrap()
        .replace_all(&result, "<b>$1</b>")
        .to_string();

    // Italic: *text* or _text_ → <i>text</i>
    result = regex::Regex::new(r"\*([^*]+)\*")
        .unwrap()
        .replace_all(&result, "<i>$1</i>")
        .to_string();

    result = regex::Regex::new(r"_([^_]+)_")
        .unwrap()
        .replace_all(&result, "<i>$1</i>")
        .to_string();

    // Strikethrough: ~~text~~ → <s>text</s>
    result = regex::Regex::new(r"~~(.+)~~")
        .unwrap()
        .replace_all(&result, "<s>$1</s>")
        .to_string();

    // Code: `code` → <code>code</code>
    result = regex::Regex::new(r"`([^`]+)`")
        .unwrap()
        .replace_all(&result, "<code>$1</code>")
        .to_string();

    // Pre: ```text``` → <pre>text</pre>
    result = regex::Regex::new(r"```(\w*)\n([\s\S]+?)```")
        .unwrap()
        .replace_all(&result, "<pre language=\"$1\">$2</pre>")
        .to_string();

    // Links: [text](url) → <a href="url">text</a>
    result = regex::Regex::new(r"\[([^\]]+)\]\(([^)]+)\)")
        .unwrap()
        .replace_all(&result, "<a href=\"$2\">$1</a>")
        .to_string();

    // Escape special HTML characters
    result = result
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;");

    result
}

/// Send GatewayResponse to Telegram
pub async fn send_gateway_response(
    config: &TelegramBotConfig,
    response: &GatewayResponse,
) -> Result<TelegramSendResult, TelegramError> {
    if !config.is_configured() {
        return Err(TelegramError::Config("Bot token not configured".to_string()));
    }

    let bot_token = config.bot_token.as_ref().unwrap();

    // Format content to Telegram HTML
    let formatted = format_to_telegram_html(&response.content);

    send_message(
        bot_token,
        &response.target_channel_id,
        &formatted,
        response.reply_to.as_deref(),
    ).await
}

/// Verify webhook with Telegram (check if bot is valid)
pub async fn get_me(bot_token: &str) -> Result<TelegramUser, TelegramError> {
    let url = format!("https://api.telegram.org/bot{}/getMe", bot_token);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let response_text = response.text().await
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let result: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| TelegramError::Parse(e.to_string()))?;

    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let error_msg = result.get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(TelegramError::Api(error_msg.to_string()));
    }

    let user = &result["result"];

    Ok(TelegramUser {
        id: user.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
        is_bot: user.get("is_bot").and_then(|v| v.as_bool()).unwrap_or(false),
        first_name: user.get("first_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        username: user.get("username").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}

/// Telegram user from getMe response
#[derive(Debug, Clone)]
pub struct TelegramUser {
    pub id: u64,
    pub is_bot: bool,
    pub first_name: String,
    pub username: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_to_telegram_html_bold() {
        let input = "Hello **world**!";
        let result = format_to_telegram_html(input);
        assert!(result.contains("<b>world</b>"));
    }

    #[test]
    fn test_format_to_telegram_html_italic() {
        let input = "Hello *italic* world";
        let result = format_to_telegram_html(input);
        assert!(result.contains("<i>italic</i>"));
    }

    #[test]
    fn test_format_to_telegram_html_code() {
        let input = "Use `console.log()` please";
        let result = format_to_telegram_html(input);
        assert!(result.contains("<code>console.log()</code>"));
    }

    #[test]
    fn test_format_to_telegram_html_link() {
        let input = "Click [here](https://example.com)";
        let result = format_to_telegram_html(input);
        assert!(result.contains("<a href=\"https://example.com\">here</a>"));
    }

    #[test]
    fn test_format_to_telegram_html_escape() {
        let input = "3 < 5 && 5 > 2";
        let result = format_to_telegram_html(input);
        assert!(result.contains("&lt;"));
        assert!(result.contains("&gt;"));
        assert!(!result.contains("<"));
        assert!(!result.contains(">"));
    }

    #[test]
    fn test_telegram_bot_config() {
        let config = TelegramBotConfig::new("test_token".to_string());
        assert!(config.is_configured());
        assert_eq!(config.bot_token, Some("test_token".to_string()));
    }

    #[test]
    fn test_telegram_bot_config_empty() {
        let config = TelegramBotConfig::default();
        assert!(!config.is_configured());
    }
}