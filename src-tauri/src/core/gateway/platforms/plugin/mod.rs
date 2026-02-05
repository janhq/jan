//! Platform Plugin System
//!
//! Defines the ChannelPlugin trait and plugin registry for platform integrations.
//! This provides a consistent interface for all messaging platforms.
//!
//! Architecture:
//! - `types.rs` - Core trait and type definitions (ChannelPlugin, ChannelContext, etc.)
//! - `registry.rs` - Plugin registry for discovery and lookup
//! - `adapter_inbound.rs` - Inbound message normalization adapter
//! - `adapter_outbound.rs` - Outbound message formatting/chunking adapter
//! - `adapter_config.rs` - Configuration validation adapter

pub mod types;
pub mod registry;
pub mod adapter_inbound;
pub mod adapter_outbound;
pub mod adapter_config;

// Platform plugin implementations (standalone modules)
pub mod discord_plugin;
pub mod slack_plugin;
pub mod telegram_plugin;

pub use types::{
    ChannelPlugin, ChannelMeta, ChannelConfig, ChannelHandle, ChannelHealth,
    StartAccountParams, StopAccountParams, ChannelContext, AccountConfig,
    PluginError, PluginResult,
};
pub use registry::PluginRegistry;
pub use adapter_inbound::InboundAdapter;
pub use adapter_outbound::OutboundAdapter;
pub use adapter_config::ConfigAdapter;
pub use discord_plugin::DiscordPlugin;
pub use slack_plugin::SlackPlugin;
pub use telegram_plugin::TelegramPlugin;

/// Plugin module re-exports
pub mod prelude {
    pub use super::types::{ChannelPlugin, ChannelMeta, ChannelConfig, ChannelHandle, ChannelHealth, ChannelContext};
    pub use super::registry::PluginRegistry;
    pub use super::adapter_inbound::InboundAdapter;
    pub use super::adapter_outbound::OutboundAdapter;
    pub use super::adapter_config::ConfigAdapter;
}