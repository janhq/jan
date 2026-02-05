//! Plugin Types
//!
//! Core types for the platform plugin system.

use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use async_trait::async_trait;

use crate::core::gateway::types::{Platform, GatewayMessage, GatewayResponse};

/// Platform metadata for display and organization
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMeta {
    /// Unique identifier for the platform
    pub id: Platform,
    /// Human-readable name
    pub name: &'static str,
    /// Description of the platform
    pub description: &'static str,
    /// Icon identifier (for UI)
    pub icon: &'static str,
    /// Whether this platform is in beta
    pub beta: bool,
    /// Order in platform lists (lower = first)
    pub order: u32,
}

/// Configuration for a platform account
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountConfig {
    /// Unique account identifier
    pub id: String,
    /// Display name for the account
    pub name: String,
    /// Platform-specific settings
    pub settings: Value,
    /// Whether the account is enabled
    pub enabled: bool,
}

/// Handle to an active platform connection
#[derive(Debug, Clone)]
pub struct ChannelHandle {
    /// The platform this handle is for
    pub platform: Platform,
    /// Account identifier
    pub account_id: String,
    /// Internal state handle
    pub state: Arc<dyn ChannelState>,
}

/// Internal state for a channel connection (trait)
pub trait ChannelState: Send + Sync + std::fmt::Debug {
    /// Whether the connection is active
    fn is_active(&self) -> bool;
    /// Last successful connection time
    fn connected_at(&self) -> u64;
    /// Last error message
    fn last_error(&self) -> Option<&str>;
    /// Message count
    fn message_count(&self) -> u64;
}

/// Default channel state implementation
#[derive(Debug, Clone)]
pub struct DefaultChannelState {
    pub active: bool,
    pub connected_at: u64,
    pub last_error: Option<String>,
    pub message_count: u64,
}

impl DefaultChannelState {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Default for DefaultChannelState {
    fn default() -> Self {
        Self {
            active: false,
            connected_at: 0,
            last_error: None,
            message_count: 0,
        }
    }
}

impl ChannelState for DefaultChannelState {
    fn is_active(&self) -> bool {
        self.active
    }

    fn connected_at(&self) -> u64 {
        self.connected_at
    }

    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    fn message_count(&self) -> u64 {
        self.message_count
    }
}

/// Health status of a platform connection
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChannelHealth {
    /// Connection is healthy
    Healthy,
    /// Connection has warnings
    Degraded(String),
    /// Connection is down
    Unhealthy(String),
    /// Not connected
    Disconnected,
}

/// Context provided to plugins during start/stop operations.
///
/// Contains references to the gateway manager, message queue, and health callbacks
/// so plugins can interact with the broader system.
pub struct ChannelContext {
    /// Account configuration
    pub account: AccountConfig,
    /// Gateway manager reference for shared state
    pub gateway: std::sync::Arc<tokio::sync::Mutex<crate::core::gateway::GatewayManager>>,
    /// Health change callback
    pub on_health_change: Option<Box<dyn Fn(ChannelHealth) + Send + Sync>>,
}

impl std::fmt::Debug for ChannelContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChannelContext")
            .field("account", &self.account)
            .field("has_health_callback", &self.on_health_change.is_some())
            .finish()
    }
}

impl ChannelContext {
    /// Create a new channel context
    pub fn new(
        account: AccountConfig,
        gateway: std::sync::Arc<tokio::sync::Mutex<crate::core::gateway::GatewayManager>>,
    ) -> Self {
        Self {
            account,
            gateway,
            on_health_change: None,
        }
    }

    /// Set the health change callback
    pub fn with_health_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(ChannelHealth) + Send + Sync + 'static,
    {
        self.on_health_change = Some(Box::new(callback));
        self
    }

    /// Notify health change
    pub fn notify_health_change(&self, health: ChannelHealth) {
        if let Some(ref callback) = self.on_health_change {
            callback(health);
        }
    }
}

/// Parameters for starting an account
#[derive(Debug, Clone)]
pub struct StartAccountParams {
    /// The platform to start
    pub platform: Platform,
    /// Account configuration
    pub account: AccountConfig,
}

/// Parameters for stopping an account
#[derive(Debug, Clone)]
pub struct StopAccountParams {
    /// The platform to stop
    pub platform: Platform,
    /// Account identifier
    pub account_id: String,
}

/// Common channel configuration options
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConfig {
    /// Auto-reconnect on disconnection
    pub auto_reconnect: bool,
    /// Reconnect delay in seconds
    pub reconnect_delay: u64,
    /// Message batching enabled
    pub batch_messages: bool,
    /// Batch window in milliseconds
    pub batch_window_ms: u64,
    /// Typing indicators enabled
    pub typing_indicators: bool,
}

/// Result type for plugin operations
pub type PluginResult<T> = Result<T, PluginError>;

/// Plugin operation errors
#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Authentication error: {0}")]
    Authentication(String),

    #[error("Message error: {0}")]
    Message(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Platform not available: {0}")]
    NotAvailable(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

/// Trait for all platform plugins.
///
/// This trait defines the interface that all platform implementations must satisfy.
/// Each platform (Discord, Slack, Telegram) will implement this trait.
#[async_trait]
pub trait ChannelPlugin: Send + Sync {
    /// Get the platform metadata
    fn meta(&self) -> &ChannelMeta;

    /// Get the default channel configuration
    fn default_config(&self) -> ChannelConfig;

    /// Validate account configuration
    async fn validate_config(&self, account: &AccountConfig) -> PluginResult<()>;

    /// List available account IDs from global configuration
    fn list_account_ids(&self, global_config: &Value) -> Vec<String>;

    /// Resolve an account ID to full configuration
    async fn resolve_account(&self, global_config: &Value, id: &str) -> PluginResult<AccountConfig>;

    /// Check if an account is enabled
    fn is_enabled(&self, account: &AccountConfig, _global_config: &Value) -> bool {
        account.enabled
    }

    /// Check if an account is configured (credentials present)
    async fn is_configured(&self, account: &AccountConfig, global_config: &Value) -> bool;

    /// Start an account connection
    async fn start_account(&self, params: StartAccountParams) -> PluginResult<ChannelHandle>;

    /// Stop an account connection
    async fn stop_account(&self, handle: &ChannelHandle) -> PluginResult<()>;

    /// Check the health of a connection
    async fn health_check(&self, handle: &ChannelHandle) -> ChannelHealth;

    /// Parse an inbound message payload
    async fn parse_inbound(&self, payload: &Value) -> PluginResult<GatewayMessage>;

    /// Send an outbound message
    async fn send_outbound(&self, handle: &ChannelHandle, response: &GatewayResponse) -> PluginResult<()>;

    /// Format markdown content for this platform's native format.
    /// Default implementation returns the markdown as-is.
    fn format_outbound(&self, markdown: &str) -> String {
        markdown.to_string()
    }

    /// Get the maximum message length for this platform.
    /// Used by the chunker to split long messages.
    fn chunk_limit(&self) -> usize {
        4000
    }

    /// Get the platform-specific event types this plugin can emit
    fn supported_events(&self) -> Vec<&'static str> {
        vec!["message.received", "message.sent", "platform.connected", "platform.disconnected"]
    }
}

/// Extension trait for optional plugin capabilities
#[async_trait]
pub trait ChannelPluginExt: ChannelPlugin {
    /// Handle a callback query (for platforms that support it)
    async fn handle_callback(&self, _query_id: &str, _data: &str) -> PluginResult<()> {
        Err(PluginError::NotAvailable("Callbacks not supported".to_string()))
    }

    /// Handle a reaction event
    async fn handle_reaction(&self, _message_id: &str, _emoji: &str, _added: bool) -> PluginResult<()> {
        Err(PluginError::NotAvailable("Reactions not supported".to_string()))
    }

    /// Handle a thread event
    async fn handle_thread(&self, _parent_id: &str, _thread_id: &str) -> PluginResult<()> {
        Err(PluginError::NotAvailable("Threads not supported".to_string()))
    }
}

impl<T: ChannelPlugin> ChannelPluginExt for T {}

/// Utility function to create a default account config
pub fn default_account_config(id: impl Into<String>, name: impl Into<String>) -> AccountConfig {
    AccountConfig {
        id: id.into(),
        name: name.into(),
        settings: Value::Null,
        enabled: false,
    }
}