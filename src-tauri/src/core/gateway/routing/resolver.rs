//! Route Resolver
//!
//! Implements priority-based agent route resolution.
//! Routes are checked in priority order: peer -> peer.parent -> guild -> team -> account -> channel -> default -> fallback

use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

use super::session_key::{SessionKey, PeerKind};
use super::config::{RouteConfig, AgentBinding, BindingType, Priority};

/// Route resolution result
#[derive(Debug, Clone)]
pub struct RouteDecision {
    /// The matched binding (if any)
    pub binding: Option<AgentBinding>,
    /// The agent ID to route to
    pub agent_id: String,
    /// The session key that was matched
    pub session_key: SessionKey,
    /// Whether this was a default/fallback route
    pub is_fallback: bool,
    /// Confidence level (0.0 - 1.0)
    pub confidence: f32,
}

/// Route resolver for priority-based agent selection
#[derive(Debug, Default)]
pub struct RouteResolver {
    /// Route configuration
    config: Arc<Mutex<RouteConfig>>,
    /// Cache for resolved routes
    cache: Arc<Mutex<HashMap<SessionKey, RouteDecision>>>,
    /// Resolution count (for metrics)
    resolution_count: Arc<Mutex<u64>>,
}

impl RouteResolver {
    /// Create a new route resolver
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(RouteConfig::new())),
            cache: Arc::new(Mutex::new(HashMap::new())),
            resolution_count: Arc::new(Mutex::new(0)),
        }
    }

    /// Create with existing config
    pub fn with_config(config: RouteConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            cache: Arc::new(Mutex::new(HashMap::new())),
            resolution_count: Arc::new(Mutex::new(0)),
        }
    }

    /// Resolve an agent route for a session key
    pub async fn resolve(&self, key: &SessionKey) -> RouteDecision {
        // Increment resolution count
        {
            let mut count = self.resolution_count.lock().await;
            *count += 1;
        }

        // Check cache first
        {
            let cache = self.cache.lock().await;
            if let Some(decision) = cache.get(key) {
                return decision.clone();
            }
        }

        // Get config
        let config = self.config.lock().await;
        let bindings = &config.bindings;

        // Sort bindings by priority (higher first)
        let mut sorted_bindings: Vec<&AgentBinding> = bindings.iter()
            .filter(|b| b.enabled)
            .collect();
        sorted_bindings.sort_by_key(|b| std::cmp::Reverse(b.priority));

        // Try to find a matching binding
        for binding in sorted_bindings {
            if binding.matches(key) {
                let decision = RouteDecision {
                    binding: Some(binding.clone()),
                    agent_id: binding.agent_id.clone(),
                    session_key: key.clone(),
                    is_fallback: false,
                    confidence: Self::calculate_confidence(key, binding),
                };

                // Cache the result
                let mut cache = self.cache.lock().await;
                cache.insert(key.clone(), decision.clone());

                return decision;
            }
        }

        // No binding matched, use default
        RouteDecision {
            binding: None,
            agent_id: config.default_agent_id.clone(),
            session_key: key.clone(),
            is_fallback: true,
            confidence: 0.1,
        }
    }

    /// Calculate match confidence based on specificity
    fn calculate_confidence(_key: &SessionKey, binding: &AgentBinding) -> f32 {
        let mut score: f32 = 0.0;

        // Platform match
        if binding.platform.is_some() {
            score += 0.1;
        }
        // Account match
        if binding.account_id.is_some() {
            score += 0.1;
        }
        // Peer kind match
        if binding.peer_kind.is_some() {
            score += 0.2;
        }
        // Specific peer pattern (not wildcard)
        if let Some(ref pattern) = binding.peer_pattern {
            if pattern != "*" {
                score += 0.6;
            }
        }

        if score > 1.0 { 1.0 } else { score }
    }

    /// Update route configuration
    pub async fn update_config(&self, config: RouteConfig) {
        let mut guard = self.config.lock().await;
        *guard = config;

        // Clear cache on config update
        let mut cache = self.cache.lock().await;
        cache.clear();
    }

    /// Get current configuration
    pub async fn get_config(&self) -> RouteConfig {
        self.config.lock().await.clone()
    }

    /// Add a binding
    pub async fn add_binding(&self, binding: AgentBinding) {
        let mut config = self.config.lock().await;
        config.add_binding(binding);

        // Clear cache
        let mut cache = self.cache.lock().await;
        cache.clear();
    }

    /// Remove a binding
    pub async fn remove_binding(&self, binding_id: &str) -> bool {
        let mut config = self.config.lock().await;
        let removed = config.remove_binding(binding_id);

        if removed {
            // Clear cache
            let mut cache = self.cache.lock().await;
            cache.clear();
        }

        removed
    }

    /// Get all bindings
    pub async fn list_bindings(&self) -> Vec<AgentBinding> {
        self.config.lock().await.bindings.clone()
    }

    /// Get resolution statistics
    pub async fn get_stats(&self) -> RouteStats {
        let count = *self.resolution_count.lock().await;
        let cache_size = self.cache.lock().await.len();
        let binding_count = self.config.lock().await.bindings.len();

        RouteStats {
            total_resolutions: count,
            cache_size,
            binding_count,
        }
    }

    /// Clear the cache
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.lock().await;
        cache.clear();
    }

    /// Resolve route from message context
    pub async fn resolve_from_context(
        &self,
        platform: &str,
        account_id: &str,
        channel_id: &str,
        user_id: &str,
        guild_id: Option<&str>,
    ) -> RouteDecision {
        // Determine peer kind from context
        let peer_kind = Self::determine_peer_kind(platform, channel_id, guild_id);

        // Build session key
        let session_key = SessionKey::new(
            "pending", // Agent ID resolved from bindings
            platform,
            account_id,
            peer_kind,
            guild_id.unwrap_or(channel_id),
        );

        self.resolve(&session_key).await
    }

    /// Determine peer kind from message context
    fn determine_peer_kind(platform: &str, channel_id: &str, guild_id: Option<&str>) -> PeerKind {
        // Discord
        if platform == "discord" {
            if guild_id.is_some() {
                // If in a guild, check if it's a thread
                if channel_id.starts_with("thread-") {
                    return PeerKind::Thread;
                }
                // Check if forum channel
                return PeerKind::Forum;
            }
            // DM (no guild)
            return PeerKind::Dm;
        }

        // Slack
        if platform == "slack" {
            if channel_id.starts_with('D') {
                return PeerKind::Dm;
            }
            if channel_id.starts_with('G') {
                return PeerKind::Group;
            }
            return PeerKind::Channel;
        }

        // Telegram
        if channel_id.starts_with('-') {
            // Negative ID = group/supergroup
            return PeerKind::Supergroup;
        }
        if channel_id.starts_with("thread-") {
            return PeerKind::Thread;
        }
        if let Ok(id) = channel_id.parse::<i64>() {
            if id > 0 {
                return PeerKind::Dm;
            }
        }

        PeerKind::Channel
    }
}

/// Route resolver statistics
#[derive(Debug, Clone)]
pub struct RouteStats {
    pub total_resolutions: u64,
    pub cache_size: usize,
    pub binding_count: usize,
}

/// Route resolver configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouteResolverConfig {
    /// Enable caching
    pub cache_enabled: bool,
    /// Cache TTL in seconds
    pub cache_ttl_seconds: u64,
    /// Enable fallback to default agent
    pub fallback_enabled: bool,
    /// Enable metrics collection
    pub metrics_enabled: bool,
}

impl RouteResolverConfig {
    /// Create a new config with defaults
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_resolver() -> RouteResolver {
        let mut resolver = RouteResolver::new();
        let mut config = RouteConfig::new();

        // Add some test bindings
        config.add_binding(AgentBinding::peer("dm-agent", "discord", "U123456"));
        config.add_binding(AgentBinding::guild("server-agent", "G789012"));
        config.add_binding(AgentBinding::channel("general-agent", "slack", "C111222"));
        config.add_binding(AgentBinding::default_agent("fallback-agent"));

        resolver.update_config(config);
        resolver
    }

    #[tokio::test]
    async fn test_peer_binding_resolution() {
        let resolver = create_test_resolver();

        let key = SessionKey::parse("agent:pending:discord:default:dm:U123456").unwrap();
        let decision = resolver.resolve(&key).await;

        assert_eq!(decision.agent_id, "dm-agent");
        assert!(!decision.is_fallback);
        assert!(decision.confidence > 0.5);
    }

    #[tokio::test]
    async fn test_guild_binding_resolution() {
        let resolver = create_test_resolver();

        let key = SessionKey::parse("agent:pending:discord:default:guild:G789012").unwrap();
        let decision = resolver.resolve(&key).await;

        assert_eq!(decision.agent_id, "server-agent");
    }

    #[tokio::test]
    async fn test_fallback_resolution() {
        let resolver = create_test_resolver();

        // Unknown user in Discord
        let key = SessionKey::parse("agent:pending:discord:default:dm:U999999").unwrap();
        let decision = resolver.resolve(&key).await;

        assert_eq!(decision.agent_id, "fallback-agent");
        assert!(decision.is_fallback);
    }

    #[tokio::test]
    async fn test_cache_hit() {
        let resolver = create_test_resolver();

        let key = SessionKey::parse("agent:pending:discord:default:dm:U123456").unwrap();

        // First resolution
        let _ = resolver.resolve(&key).await;

        // Second resolution should hit cache
        let stats = resolver.get_stats().await;
        assert_eq!(stats.cache_size, 1);
    }
}