//! Agent Routing Integration
//!
//! Connects the RouteResolver to Jan's agent system, enabling platform-aware
//! agent selection based on session keys and bindings.

use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

use super::resolver::RouteResolver;
use super::session_key::{SessionKey, PeerKind};
use super::config::{RouteConfig, AgentBinding, BindingType, Priority};
use crate::core::gateway::types::{GatewayMessage, Platform};

/// Agent routing configuration for the gateway
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoutingConfig {
    /// Enable agent routing
    pub enabled: bool,
    /// Route resolver configuration
    pub resolver: RouteResolverConfig,
    /// Agent bindings
    pub bindings: Vec<AgentBindingConfig>,
    /// Default agent for unknown routes
    pub default_agent: String,
    /// Fallback agent
    pub fallback_agent: String,
}

/// Route resolver configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouteResolverConfig {
    /// Enable caching
    pub cache_enabled: bool,
    /// Cache TTL in seconds
    pub cache_ttl_seconds: u64,
    /// Enable metrics collection
    pub metrics_enabled: bool,
}

/// Agent binding configuration (frontend-compatible)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBindingConfig {
    /// Binding ID
    pub id: String,
    /// Binding type
    pub binding_type: String,
    /// Agent ID to route to
    pub agent_id: String,
    /// Platform filter
    pub platform: Option<String>,
    /// Account filter
    pub account_id: Option<String>,
    /// Peer kind (dm, channel, guild, etc.)
    pub peer_kind: Option<String>,
    /// Peer pattern (supports wildcards)
    pub peer_pattern: Option<String>,
    /// Whether enabled
    pub enabled: bool,
    /// Description
    pub description: Option<String>,
}

/// Integration result
#[derive(Debug, Clone)]
pub struct AgentRoutingResult {
    /// The resolved agent ID
    pub agent_id: String,
    /// The session key used
    pub session_key: SessionKey,
    /// Confidence of the match
    pub confidence: f32,
    /// Whether this was a fallback
    pub is_fallback: bool,
}

/// Agent routing service
#[derive(Debug, Default)]
pub struct AgentRoutingService {
    /// Route resolver
    resolver: Arc<RouteResolver>,
    /// Configuration
    config: Arc<Mutex<AgentRoutingConfig>>,
    /// Whether routing is enabled
    enabled: Arc<Mutex<bool>>,
}

impl AgentRoutingService {
    /// Create a new agent routing service
    pub fn new() -> Self {
        Self {
            resolver: Arc::new(RouteResolver::new()),
            config: Arc::new(Mutex::new(AgentRoutingConfig::default())),
            enabled: Arc::new(Mutex::new(false)),
        }
    }

    /// Initialize with configuration
    pub async fn initialize(&self, config: AgentRoutingConfig) {
        let mut guard = self.config.lock().await;
        *guard = config.clone();

        // Initialize resolver with bindings
        let mut route_config = RouteConfig::new();
        route_config.set_default_agent(config.default_agent.clone());
        route_config.set_fallback_agent(config.fallback_agent.clone());

        for binding_config in &config.bindings {
            if let Ok(binding) = convert_binding_config(binding_config) {
                if binding.enabled {
                    route_config.add_binding(binding);
                }
            }
        }

        self.resolver.update_config(route_config).await;

        let mut enabled_guard = self.enabled.lock().await;
        *enabled_guard = config.enabled;
    }

    /// Resolve an agent for a message
    pub async fn resolve_agent(&self, message: &GatewayMessage) -> Option<AgentRoutingResult> {
        let enabled = *self.enabled.lock().await;
        if !enabled {
            return None;
        }

        // Determine peer kind from message
        let peer_kind = determine_peer_kind(message);

        // Build session key
        let session_key = SessionKey::new(
            "pending", // Will be resolved from bindings
            message.platform.as_str(),
            "default", // Default account
            peer_kind,
            message.guild_id.clone().unwrap_or_else(|| message.channel_id.clone()),
        );

        // Resolve route
        let decision = self.resolver.resolve(&session_key).await;

        Some(AgentRoutingResult {
            agent_id: decision.agent_id,
            session_key,
            confidence: decision.confidence,
            is_fallback: decision.is_fallback,
        })
    }

    /// Resolve agent from context
    pub async fn resolve_from_context(
        &self,
        platform: Platform,
        channel_id: &str,
        user_id: &str,
        guild_id: Option<&str>,
    ) -> Option<AgentRoutingResult> {
        let enabled = *self.enabled.lock().await;
        if !enabled {
            return None;
        }

        let decision = self.resolver.resolve_from_context(
            platform.as_str(),
            "default",
            channel_id,
            user_id,
            guild_id,
        ).await;

        Some(AgentRoutingResult {
            agent_id: decision.agent_id,
            session_key: decision.session_key,
            confidence: decision.confidence,
            is_fallback: decision.is_fallback,
        })
    }

    /// Add a binding
    pub async fn add_binding(&self, binding: AgentBinding) {
        self.resolver.add_binding(binding).await;
    }

    /// Remove a binding
    pub async fn remove_binding(&self, binding_id: &str) -> bool {
        self.resolver.remove_binding(binding_id).await
    }

    /// Get all bindings
    pub async fn list_bindings(&self) -> Vec<AgentBinding> {
        self.resolver.list_bindings().await
    }

    /// Get routing statistics
    pub async fn get_stats(&self) -> RoutingStats {
        let stats = self.resolver.get_stats().await;
        RoutingStats {
            total_resolutions: stats.total_resolutions,
            cache_size: stats.cache_size,
            binding_count: stats.binding_count,
        }
    }

    /// Enable/disable routing
    pub async fn set_enabled(&self, enabled: bool) {
        let mut guard = self.enabled.lock().await;
        *guard = enabled;
    }

    /// Check if routing is enabled
    pub async fn is_enabled(&self) -> bool {
        *self.enabled.lock().await
    }
}

/// Routing statistics
#[derive(Debug, Clone)]
pub struct RoutingStats {
    pub total_resolutions: u64,
    pub cache_size: usize,
    pub binding_count: usize,
}

/// Convert frontend binding config to internal binding
fn convert_binding_config(config: &AgentBindingConfig) -> Result<AgentBinding, String> {
    let binding_type = match config.binding_type.as_str() {
        "peer" => BindingType::Peer,
        "peer_parent" => BindingType::PeerParent,
        "guild" => BindingType::Guild,
        "team" => BindingType::Team,
        "account" => BindingType::Account,
        "channel" => BindingType::Channel,
        "default" => BindingType::Default,
        _ => return Err(format!("Unknown binding type: {}", config.binding_type)),
    };

    let priority = match binding_type {
        BindingType::Peer => Priority::PEER,
        BindingType::PeerParent => Priority::PEER_PARENT,
        BindingType::Guild => Priority::GUILD,
        BindingType::Team => Priority::TEAM,
        BindingType::Account => Priority::ACCOUNT,
        BindingType::Channel => Priority::CHANNEL,
        BindingType::Default => Priority::DEFAULT,
    };

    let peer_kind = config.peer_kind.as_ref().map(|s| PeerKind::from_str(s));

    Ok(AgentBinding {
        id: config.id.clone(),
        binding_type,
        priority,
        agent_id: config.agent_id.clone(),
        platform: config.platform.clone(),
        account_id: config.account_id.clone(),
        peer_kind,
        peer_pattern: config.peer_pattern.clone(),
        enabled: config.enabled,
        description: config.description.clone(),
        created_at: chrono::Utc::now().timestamp_millis() as u64,
        updated_at: chrono::Utc::now().timestamp_millis() as u64,
    })
}

/// Determine peer kind from message
fn determine_peer_kind(message: &GatewayMessage) -> PeerKind {
    // Check metadata for channel type hints
    if let Some(meta) = message.metadata.get("channel_type") {
        if let Some(channel_type) = meta.as_str() {
            return match channel_type {
                "dm" | "group" => PeerKind::Dm,
                "text" | "voice" => PeerKind::Channel,
                "forum" => PeerKind::Forum,
                _ => PeerKind::Unknown,
            };
        }
    }

    // Check for thread indicators
    if message.channel_id.starts_with("thread-") {
        return PeerKind::Thread;
    }

    // Discord: has guild = guild, no guild = dm
    if message.guild_id.is_some() {
        return PeerKind::Guild;
    }

    // Default to channel
    PeerKind::Channel
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_service() -> AgentRoutingService {
        let service = AgentRoutingService::new();

        let config = AgentRoutingConfig {
            enabled: true,
            bindings: vec![
                AgentBindingConfig {
                    id: "discord-dm".to_string(),
                    binding_type: "peer".to_string(),
                    agent_id: "discord-agent".to_string(),
                    platform: Some("discord".to_string()),
                    account_id: None,
                    peer_kind: Some("dm".to_string()),
                    peer_pattern: Some("*".to_string()),
                    enabled: true,
                    description: Some("Discord DM routing".to_string()),
                },
                AgentBindingConfig {
                    id: "slack-channel".to_string(),
                    binding_type: "channel".to_string(),
                    agent_id: "slack-agent".to_string(),
                    platform: Some("slack".to_string()),
                    account_id: None,
                    peer_kind: Some("channel".to_string()),
                    peer_pattern: Some("C123*".to_string()),
                    enabled: true,
                    description: Some("Slack channel routing".to_string()),
                },
            ],
            default_agent: "default-agent".to_string(),
            fallback_agent: "fallback-agent".to_string(),
            resolver: RouteResolverConfig::default(),
        };

        futures::executor::block_on(service.initialize(config));
        service
    }

    #[tokio::test]
    async fn test_resolve_discord_dm() {
        let service = create_test_service();

        let message = GatewayMessage {
            id: "msg-1".to_string(),
            platform: Platform::Discord,
            user_id: "U123456".to_string(),
            channel_id: "D123456789".to_string(),
            guild_id: None,
            content: "Hello".to_string(),
            timestamp: 0,
            metadata: std::collections::HashMap::new(),
            protocol_version: "1.0".to_string(),
        };

        let result = service.resolve_agent(&message).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().agent_id, "discord-agent");
    }

    #[tokio::test]
    async fn test_fallback_to_default() {
        let service = create_test_service();

        let message = GatewayMessage {
            id: "msg-2".to_string(),
            platform: Platform::Telegram,
            user_id: "U999999".to_string(),
            channel_id: "123456789".to_string(),
            guild_id: None,
            content: "Hello".to_string(),
            timestamp: 0,
            metadata: std::collections::HashMap::new(),
            protocol_version: "1.0".to_string(),
        };

        let result = service.resolve_agent(&message).await;
        assert!(result.is_some());
        // Should fall back to default
        assert_eq!(result.unwrap().agent_id, "default-agent");
    }

    #[tokio::test]
    async fn test_disabled_routing() {
        let service = create_test_service();
        service.set_enabled(false).await;

        let message = GatewayMessage {
            id: "msg-3".to_string(),
            platform: Platform::Discord,
            user_id: "U123456".to_string(),
            channel_id: "D123456789".to_string(),
            guild_id: None,
            content: "Hello".to_string(),
            timestamp: 0,
            metadata: std::collections::HashMap::new(),
            protocol_version: "1.0".to_string(),
        };

        let result = service.resolve_agent(&message).await;
        assert!(result.is_none());
    }
}