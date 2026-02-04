/// Gateway module for connecting messaging platforms to Jan's chat system.
pub mod types;
pub mod config;
pub mod server;
pub mod processor;
pub mod jan;
pub mod queue;
pub mod commands;
pub mod platforms;
pub mod discord_bot;
pub mod capabilities;
pub mod protocol; // NEW: WebSocket protocol with frame types
pub mod routing;  // NEW: Agent routing system
pub mod channel;  // NEW: Channel lifecycle management

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
use platforms::telegram::{TelegramBotConfig, TelegramBotState, SharedTelegramBotState, create_telegram_bot_state};
use discord_bot::{DiscordBotConfig, DiscordBotState, SharedDiscordBotState, create_discord_bot_state};
use jan::{JanIntegrationService, SharedJanIntegration};
use channel::ChannelManager;
use processor::debounce::MessageDebouncer;
use processor::ack::AckHandler;
use routing::agent_integration::AgentRoutingService;

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

    /// Discord response sender (webhook/bot token)
    pub discord_sender: Arc<Mutex<DiscordSenderState>>,

    /// Discord bot for mention detection
    pub discord_bot_state: SharedDiscordBotState,

    /// Discord bot task handle
    pub discord_bot_task: Option<tokio::task::JoinHandle<()>>,

    /// Jan integration service for thread/message handling
    pub jan_integration: Option<SharedJanIntegration>,

    /// Telegram bot state
    pub telegram_bot_state: SharedTelegramBotState,

    /// Channel manager for lifecycle management
    pub channel_manager: ChannelManager,

    /// Message debouncer
    pub debouncer: MessageDebouncer,

    /// ACK handler
    pub ack_handler: AckHandler,

    /// Agent routing service
    pub agent_routing: AgentRoutingService,
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
            discord_bot_state: create_discord_bot_state(),
            discord_bot_task: None,
            jan_integration: None,
            telegram_bot_state: create_telegram_bot_state(),
            channel_manager: ChannelManager::new(),
            debouncer: MessageDebouncer::default(),
            ack_handler: AckHandler::new(),
            agent_routing: AgentRoutingService::new(),
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

    // ==================== Channel Manager Methods ====================

    /// Add a channel to the manager
    pub async fn add_channel(&self, config: channel::ChannelConfig) {
        self.channel_manager.add_channel(config).await;
    }

    /// Get channel state
    pub async fn get_channel_state(&self, platform: &types::Platform, account_id: &str) -> Option<channel::ConnectionState> {
        self.channel_manager.get_state(platform, account_id).await
    }

    /// Set channel state
    pub async fn set_channel_state(
        &self,
        platform: &types::Platform,
        account_id: &str,
        state: channel::ConnectionState,
        error: Option<String>,
    ) -> bool {
        self.channel_manager.set_state(platform, account_id, state, error).await
    }

    /// Get channel statistics
    pub async fn get_channel_stats(&self) -> channel::ChannelStats {
        self.channel_manager.get_stats().await
    }

    // ==================== Debouncer Methods ====================

    /// Process a message through the debouncer
    pub async fn debounce_message(
        &self,
        message: &types::GatewayMessage,
    ) -> Option<processor::debounce::DebouncedBatch> {
        self.debouncer.process(message).await
    }

    // ==================== ACK Handler Methods ====================

    /// Register a message for ACK tracking
    pub async fn register_ack(&self, message_id: &str, platform: types::Platform, channel_id: &str) {
        self.ack_handler.register_message(message_id, platform, channel_id).await;
    }

    /// Mark a message as delivered
    pub async fn mark_delivered(&self, message_id: &str) {
        self.ack_handler.mark_delivered(message_id).await;
    }

    /// Get ACK statistics
    pub async fn get_ack_stats(&self) -> processor::ack::AckStats {
        self.ack_handler.get_stats().await
    }

    // ==================== Agent Routing Methods ====================

    /// Resolve agent for a message
    pub async fn resolve_agent(&self, message: &types::GatewayMessage) -> Option<routing::agent_integration::AgentRoutingResult> {
        self.agent_routing.resolve_agent(message).await
    }

    /// Get routing statistics
    pub async fn get_routing_stats(&self) -> Option<routing::agent_integration::RoutingStats> {
        if self.agent_routing.is_enabled().await {
            Some(self.agent_routing.get_stats().await)
        } else {
            None
        }
    }
}