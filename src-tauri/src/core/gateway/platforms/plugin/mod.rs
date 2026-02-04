//! Platform Plugin System
//!
//! Defines the ChannelPlugin trait and plugin registry for platform integrations.
//! This provides a consistent interface for all messaging platforms.

pub mod types;
pub mod registry;

pub use types::{ChannelPlugin, ChannelMeta, ChannelConfig, ChannelHandle, ChannelHealth, StartAccountParams, StopAccountParams};
pub use registry::{PluginRegistry, list_plugins};

/// Plugin module re-exports
pub mod prelude {
    pub use super::types::{ChannelPlugin, ChannelMeta, ChannelConfig, ChannelHandle, ChannelHealth};
    pub use super::registry::{PluginRegistry, list_plugins};
}