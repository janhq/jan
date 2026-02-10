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

pub use registry::PluginRegistry;
pub use discord_plugin::DiscordPlugin;
pub use slack_plugin::SlackPlugin;
pub use telegram_plugin::TelegramPlugin;