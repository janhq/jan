/// Gateway module for connecting messaging platforms to Jan's chat system.
pub mod types;
pub mod config;
pub mod server;
pub mod processor;
pub mod jan;
pub mod queue;
pub mod commands;
pub mod platforms;

// Re-export commonly used types
pub use types::{
    GatewayConfig, GatewayMessage, GatewayResponse, GatewayStatus,
    Platform, ThreadMapping, WhitelistConfig,
};

/// Shared gateway manager type
pub type SharedGatewayManager = std::sync::Arc<tokio::sync::Mutex<GatewayManager>>;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use platforms::discord_sender::DiscordSenderState;

/// Main gateway manager that coordinates all gateway components
#[derive(Debug)]
pub struct GatewayManager {
    /// Server handles
    pub http_server: Option<server::HttpServerHandle>,
    pub ws_server: Option<server::WsServerHandle>,

    /// Connection states by platform
    pub connections: std::collections::HashMap<types::Platform, types::ConnectionState>,

    /// Thread mappings (platform + channel_id -> ThreadMapping)
    pub thread_mappings: std::collections::HashMap<(types::Platform, String), types::ThreadMapping>,

    /// Message queue for async processing
    pub message_queue: queue::MessageQueue,

    /// Configuration
    pub config: Option<types::GatewayConfig>,

    /// Whether the gateway is running
    pub running: bool,

    /// Message consumer task handle
    pub consumer_task: Option<tokio::task::JoinHandle<()>>,

    /// Discord response sender
    pub discord_sender: Arc<Mutex<DiscordSenderState>>,
}

impl Default for GatewayManager {
    fn default() -> Self {
        Self::new()
    }
}

impl GatewayManager {
    /// Create a new gateway manager
    pub fn new() -> Self {
        Self {
            http_server: None,
            ws_server: None,
            connections: std::collections::HashMap::new(),
            thread_mappings: std::collections::HashMap::new(),
            message_queue: queue::MessageQueue::new(1000),
            config: None,
            running: false,
            consumer_task: None,
            discord_sender: platforms::discord_sender::create_discord_sender(),
        }
    }

    /// Check if the gateway is running
    pub fn is_running(&self) -> bool {
        self.running
    }

    /// Get the current status
    pub fn get_status(&self) -> types::GatewayStatus {
        types::GatewayStatus {
            running: self.running,
            http_port: self.config.as_ref().map(|c| c.http_port).unwrap_or(0),
            ws_port: self.config.as_ref().map(|c| c.ws_port).unwrap_or(0),
            active_connections: self.connections.values().filter(|c| c.connected).count(),
            queued_messages: self.message_queue.len(),
        }
    }

    /// Get thread ID for a platform channel, or None if not mapped
    pub fn get_thread_id(&self, platform: types::Platform, channel_id: &str) -> Option<&String> {
        self.thread_mappings.get(&(platform, channel_id.to_string()))
            .map(|m| &m.jan_thread_id)
    }

    /// Set thread mapping
    pub fn set_thread_mapping(&mut self, platform: types::Platform, channel_id: String, thread_id: String) {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let mapping = types::ThreadMapping {
            platform: platform.clone(),
            external_id: channel_id.clone(),
            jan_thread_id: thread_id,
            created_at: now,
            last_message_at: now,
        };
        self.thread_mappings.insert((platform, channel_id), mapping);
    }
}