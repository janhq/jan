use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for the gateway
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfig {
    pub http_port: u16,
    pub ws_port: u16,
    pub enabled: bool,
    pub whitelist: WhitelistConfig,
    pub auto_create_threads: bool,
    pub default_assistant_id: Option<String>,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            http_port: 4281,
            ws_port: 4282,
            enabled: false,
            whitelist: WhitelistConfig::default(),
            auto_create_threads: true,
            default_assistant_id: None,
        }
    }
}

/// Whitelist configuration for filtering messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhitelistConfig {
    pub enabled: bool,
    pub user_ids: Vec<String>,
    pub channel_ids: Vec<String>,
    pub guild_ids: Vec<String>,
    pub role_ids: Vec<String>,
}

impl Default for WhitelistConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            user_ids: Vec::new(),
            channel_ids: Vec::new(),
            guild_ids: Vec::new(),
            role_ids: Vec::new(),
        }
    }
}

/// Source platform types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Discord,
    Slack,
    Telegram,
    #[serde(other)]
    Unknown,
}

impl Default for Platform {
    fn default() -> Self {
        Platform::Unknown
    }
}

impl Platform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::Discord => "discord",
            Platform::Slack => "slack",
            Platform::Telegram => "telegram",
            Platform::Unknown => "unknown",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "discord" => Platform::Discord,
            "slack" => Platform::Slack,
            "telegram" => Platform::Telegram,
            _ => Platform::Unknown,
        }
    }
}

/// Incoming message from messaging platform
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMessage {
    pub id: String,
    pub platform: Platform,
    pub user_id: String,
    pub channel_id: String,
    pub guild_id: Option<String>,
    pub content: String,
    pub timestamp: u64,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl GatewayMessage {
    pub fn new(
        platform: Platform,
        user_id: String,
        channel_id: String,
        content: String,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            platform,
            user_id,
            channel_id,
            guild_id: None,
            content,
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
            metadata: HashMap::new(),
        }
    }
}

/// Normalized message for processing
#[derive(Debug, Clone)]
pub struct NormalizedMessage {
    pub id: String,
    pub source_platform: Platform,
    pub source_user_id: String,
    pub source_channel_id: String,
    pub text: String,
    pub mentions: Vec<String>,
    pub attachments: Vec<MessageAttachment>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAttachment {
    pub url: String,
    #[serde(default)]
    pub file_type: String,
    pub name: String,
    #[serde(default)]
    pub size: u64,
}

/// Thread mapping between platform and Jan thread
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMapping {
    pub platform: Platform,
    pub external_id: String, // e.g., Discord channel ID
    pub jan_thread_id: String,
    pub created_at: u64,
    pub last_message_at: u64,
}

impl ThreadMapping {
    pub fn new(platform: Platform, external_id: String, jan_thread_id: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        Self {
            platform,
            external_id,
            jan_thread_id,
            created_at: now,
            last_message_at: now,
        }
    }
}

/// Response to send back to messaging platform
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayResponse {
    pub target_platform: Platform,
    pub target_channel_id: String,
    pub content: String,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub mentions: Vec<String>,
}

impl GatewayResponse {
    pub fn new(platform: Platform, channel_id: String, content: String) -> Self {
        Self {
            target_platform: platform,
            target_channel_id: channel_id,
            content,
            reply_to: None,
            mentions: Vec::new(),
        }
    }
}

/// Connection state for a messaging platform
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub platform: Platform,
    pub connected: bool,
    pub last_heartbeat: u64,
    pub message_count: u64,
}

/// Server status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub running: bool,
    pub http_port: u16,
    pub ws_port: u16,
    pub active_connections: usize,
    pub queued_messages: usize,
}

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WebSocketMessage {
    #[serde(rename = "subscribe")]
    Subscribe { platform: Platform },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { platform: Platform },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "message")]
    Message(GatewayMessage),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WebSocketOutgoing {
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "message")]
    Message(GatewayMessage),
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "status")]
    Status(ConnectionState),
}