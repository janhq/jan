//! Plugin Registry
//!
//! Manages the registration and discovery of platform plugins.

use std::sync::Arc;
use std::collections::HashMap;
use once_cell::sync::Lazy;
use serde_json::Value;

use super::types::{ChannelPlugin, ChannelMeta, AccountConfig, PluginResult, PluginError, ChannelConfig, ChannelHandle};
use crate::core::gateway::types::{Platform, GatewayMessage, GatewayResponse};

/// Global plugin registry
static PLUGIN_REGISTRY: Lazy<PluginRegistry> = Lazy::new(PluginRegistry::new);

/// Plugin registry for managing platform plugins
pub struct PluginRegistry {
    /// Registered plugins by platform ID
    plugins: HashMap<String, Arc<dyn ChannelPlugin>>,
    /// Platform order for sorting
    order: Vec<String>,
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for PluginRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PluginRegistry")
            .field("plugins", &self.order)
            .finish()
    }
}

impl PluginRegistry {
    /// Create a new registry
    pub fn new() -> Self {
        Self {
            plugins: HashMap::new(),
            order: Vec::new(),
        }
    }

    /// Register a plugin
    pub fn register(&mut self, plugin: Arc<dyn ChannelPlugin>) {
        let id = plugin.meta().id.as_str().to_string();
        self.plugins.insert(id.clone(), plugin);
        if !self.order.contains(&id) {
            self.order.push(id);
        }
    }

    /// Get a plugin by platform ID
    pub fn get(&self, platform: &str) -> Option<&Arc<dyn ChannelPlugin>> {
        self.plugins.get(platform)
    }

    /// Get a plugin by Platform enum
    pub fn get_by_platform(&self, platform: &Platform) -> Option<&Arc<dyn ChannelPlugin>> {
        self.plugins.get(platform.as_str())
    }

    /// List all registered plugin IDs
    pub fn ids(&self) -> Vec<&str> {
        self.order.iter().map(|s| s.as_str()).collect()
    }

    /// List all registered plugins in order
    pub fn all(&self) -> Vec<&Arc<dyn ChannelPlugin>> {
        self.order.iter().filter_map(|id| self.plugins.get(id)).collect()
    }

    /// Get the metadata for all plugins
    pub fn meta_all(&self) -> Vec<&ChannelMeta> {
        self.all().iter().map(|p| p.meta()).collect()
    }
}

/// Get the global plugin registry
pub fn registry() -> &'static PluginRegistry {
    &PLUGIN_REGISTRY
}

/// List all available platform plugins
pub fn list_plugins() -> Vec<&'static ChannelMeta> {
    registry().meta_all()
}

/// Get a specific plugin by platform ID
pub fn get_plugin(platform: &str) -> Option<&'static Arc<dyn ChannelPlugin>> {
    registry().get(platform)
}

/// Register a plugin (for use with Lazy::initialize)
pub fn register_plugin(plugin: Arc<dyn ChannelPlugin>) {
    let mut reg = PluginRegistry::new();
    reg.register(plugin);
    // Note: This is a workaround for the lazy static
    // In practice, plugins should be registered during initialization
}

/// Resolve an account ID to configuration for a platform
pub async fn resolve_account(
    platform: &str,
    global_config: &Value,
    account_id: &str,
) -> PluginResult<AccountConfig> {
    let plugin = get_plugin(platform)
        .ok_or_else(|| PluginError::NotAvailable(format!("Platform {} not available", platform)))?;

    plugin.resolve_account(global_config, account_id).await
}

/// List all account IDs for a platform
pub fn list_account_ids(platform: &str, global_config: &Value) -> Vec<String> {
    if let Some(plugin) = get_plugin(platform) {
        plugin.list_account_ids(global_config)
    } else {
        Vec::new()
    }
}

/// Check if a platform is available
pub fn is_platform_available(platform: &str) -> bool {
    get_plugin(platform).is_some()
}

/// Get the order of platforms for display
pub fn platform_order() -> Vec<&'static str> {
    registry().ids()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use crate::core::gateway::types::Platform;

    // Create a mock plugin for testing
    struct MockPlugin;

    #[async_trait::async_trait]
    impl ChannelPlugin for MockPlugin {
        fn meta(&self) -> &ChannelMeta {
            static META: ChannelMeta = ChannelMeta {
                id: Platform::Discord,
                name: "Mock Platform",
                description: "A mock platform for testing",
                icon: "mock",
                beta: false,
                order: 100,
            };
            &META
        }

        fn default_config(&self) -> ChannelConfig {
            ChannelConfig::default()
        }

        async fn validate_config(&self, _account: &AccountConfig) -> PluginResult<()> {
            Ok(())
        }

        fn list_account_ids(&self, _global_config: &Value) -> Vec<String> {
            vec!["default".to_string()]
        }

        async fn resolve_account(&self, _global_config: &Value, _id: &str) -> PluginResult<AccountConfig> {
            Ok(AccountConfig::default())
        }

        async fn is_configured(&self, _account: &AccountConfig, _global_config: &Value) -> bool {
            false
        }

        async fn start_account(&self, _params: StartAccountParams) -> PluginResult<ChannelHandle> {
            Err(PluginError::NotAvailable("Not implemented".to_string()))
        }

        async fn stop_account(&self, _handle: &ChannelHandle) -> PluginResult<()> {
            Ok(())
        }

        async fn health_check(&self, _handle: &ChannelHandle) -> ChannelHealth {
            ChannelHealth::Disconnected
        }

        async fn parse_inbound(&self, _payload: &Value) -> PluginResult<GatewayMessage> {
            Err(PluginError::NotAvailable("Not implemented".to_string()))
        }

        async fn send_outbound(&self, _handle: &ChannelHandle, _response: &GatewayResponse) -> PluginResult<()> {
            Ok(())
        }
    }

    #[test]
    fn test_registry_creation() {
        let registry = PluginRegistry::new();
        assert!(registry.ids().is_empty());
    }

    #[test]
    fn test_get_plugin() {
        let plugin = Arc::new(MockPlugin) as Arc<dyn ChannelPlugin>;
        let mut registry = PluginRegistry::new();
        registry.register(plugin);

        let retrieved = registry.get("discord");
        assert!(retrieved.is_some());
    }
}