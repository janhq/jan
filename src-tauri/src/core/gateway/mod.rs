//! Gateway module for connecting messaging platforms to Jan's chat system.
//! Note: This module contains work-in-progress features that are not yet fully integrated.
#![allow(dead_code)]

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
pub mod protocol;  // WebSocket protocol with frame types
pub mod routing;   // Agent routing system
pub mod channel;   // Channel lifecycle management
pub mod formatter; // Outbound markdown formatting + chunking
pub mod hooks;     // Hook mappings for webhook routing
pub mod timestamps;// Timestamp injection for performance tracking

// Re-export commonly used types
pub use types::{GatewayConfig, GatewayResponse};

/// Shared gateway manager type
pub type SharedGatewayManager = std::sync::Arc<tokio::sync::Mutex<GatewayManager>>;

use std::sync::Arc;
use tokio::sync::Mutex;
use platforms::discord_sender::DiscordSenderState;
use platforms::telegram::{SharedTelegramBotState, create_telegram_bot_state};
use discord_bot::{SharedDiscordBotState, create_discord_bot_state};
use jan::SharedJanIntegration;
use channel::ChannelManager;
use processor::debounce::MessageDebouncer;
use processor::ack::AckHandler;
use routing::agent_integration::AgentRoutingService;
use hooks::HookMappingService;
use timestamps::TimestampInjector;
use platforms::plugin::PluginRegistry;

/// Main gateway manager that coordinates all gateway components
#[derive(Debug)]
#[allow(dead_code)]
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

    /// Hook mapping service
    pub hook_mapping_service: HookMappingService,

    /// Timestamp injector for performance tracking
    pub timestamp_injector: TimestampInjector,

    /// Platform plugin registry
    pub plugin_registry: PluginRegistry,
}

impl Default for GatewayManager {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
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
            hook_mapping_service: HookMappingService::new(),
            timestamp_injector: TimestampInjector::new(),
            plugin_registry: PluginRegistry::new(),
        }
    }

    /// Initialize the plugin registry with all built-in platform plugins.
    /// Call this after creating the gateway manager.
    ///
    /// Uses standalone plugin modules from `platforms/plugin/`:
    /// - `discord_plugin.rs` → DiscordPlugin
    /// - `slack_plugin.rs` → SlackPlugin
    /// - `telegram_plugin.rs` → TelegramPlugin
    pub fn init_plugins(&mut self) {
        use platforms::plugin::{DiscordPlugin, SlackPlugin, TelegramPlugin};

        self.plugin_registry.register(Arc::new(DiscordPlugin));
        self.plugin_registry.register(Arc::new(SlackPlugin));
        self.plugin_registry.register(Arc::new(TelegramPlugin));

        log::info!("[Gateway] Registered {} platform plugins: {:?}",
            self.plugin_registry.ids().len(),
            self.plugin_registry.ids());
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

    // ==================== Hook Mapping Methods ====================

    /// Add a hook mapping
    pub async fn add_hook_mapping(&self, config: hooks::HookMappingConfig) -> Result<(), String> {
        self.hook_mapping_service.add_mapping(config).await
    }

    /// Remove a hook mapping
    pub async fn remove_hook_mapping(&self, id: &str) -> bool {
        self.hook_mapping_service.remove_mapping(id).await
    }

    /// List all hook mappings
    pub async fn list_hook_mappings(&self) -> Vec<hooks::HookMappingConfig> {
        self.hook_mapping_service.list_mappings().await
    }

    /// Match a request path to a hook
    pub async fn match_hook(&self, path: &str, auth_header: Option<&str>) -> Option<hooks::HookMatchResult> {
        self.hook_mapping_service.match_path(path, auth_header).await
    }

    /// Get hook mapping statistics
    pub async fn get_hook_stats(&self) -> hooks::HookStats {
        self.hook_mapping_service.get_stats().await
    }

    // ==================== Timestamp Injection Methods ====================

    /// Create a new timing context
    pub fn create_timing_context(&self) -> timestamps::TimingContext {
        timestamps::TimingContext::new()
    }

    /// Get timestamp injector reference
    pub fn get_timestamp_injector(&self) -> &timestamps::TimestampInjector {
        &self.timestamp_injector
    }

    /// Enable/disable timestamp injection
    pub async fn set_timestamps_enabled(&self, enabled: bool) {
        self.timestamp_injector.set_enabled(enabled).await;
    }

    /// Check if timestamps are enabled
    pub async fn are_timestamps_enabled(&self) -> bool {
        self.timestamp_injector.is_enabled().await
    }
}