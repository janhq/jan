//! Route Configuration
//!
//! Defines agent bindings and route configuration for the routing system.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::session_key::{SessionKey, PeerKind};

/// Agent binding types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BindingType {
    /// Direct peer binding (DM)
    Peer,
    /// Thread/starter message parent binding
    PeerParent,
    /// Guild/server-wide binding (Discord)
    Guild,
    /// Team/workspace binding (Slack)
    Team,
    /// Account-level binding
    Account,
    /// Channel-level binding
    Channel,
    /// Default agent binding
    Default,
}

/// Priority level for bindings (higher = checked first)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Priority(u8);

impl Priority {
    pub const PEER: Priority = Priority(100);
    pub const PEER_PARENT: Priority = Priority(90);
    pub const GUILD: Priority = Priority(80);
    pub const TEAM: Priority = Priority(70);
    pub const ACCOUNT: Priority = Priority(60);
    pub const CHANNEL: Priority = Priority(50);
    pub const DEFAULT: Priority = Priority(10);
    pub const FALLBACK: Priority = Priority(0);

    pub fn new(value: u8) -> Self {
        Priority(value.clamp(0, 100))
    }

    pub fn value(&self) -> u8 {
        self.0
    }
}

/// An agent binding for routing messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBinding {
    /// Unique binding ID
    pub id: String,
    /// Binding type
    pub binding_type: BindingType,
    /// Priority (higher = checked first)
    pub priority: Priority,
    /// Agent ID to route to
    pub agent_id: String,
    /// Platform filter (None = all)
    pub platform: Option<String>,
    /// Account filter (None = all)
    pub account_id: Option<String>,
    /// Peer kind filter (None = all)
    pub peer_kind: Option<PeerKind>,
    /// Peer ID pattern (supports wildcards)
    pub peer_pattern: Option<String>,
    /// Whether this binding is enabled
    pub enabled: bool,
    /// Binding description
    pub description: Option<String>,
    /// Created timestamp
    pub created_at: u64,
    /// Updated timestamp
    pub updated_at: u64,
}

impl Default for AgentBinding {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            binding_type: BindingType::Default,
            priority: Priority::DEFAULT,
            agent_id: "default".to_string(),
            platform: None,
            account_id: None,
            peer_kind: None,
            peer_pattern: None,
            enabled: true,
            description: None,
            created_at: chrono::Utc::now().timestamp_millis() as u64,
            updated_at: chrono::Utc::now().timestamp_millis() as u64,
        }
    }
}

impl AgentBinding {
    /// Create a default binding
    pub fn default_agent(agent_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            binding_type: BindingType::Default,
            priority: Priority::DEFAULT,
            ..Default::default()
        }
    }

    /// Create a peer binding
    pub fn peer(agent_id: impl Into<String>, platform: impl Into<String>, user_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            binding_type: BindingType::Peer,
            priority: Priority::PEER,
            platform: Some(platform.into()),
            account_id: None,
            peer_kind: Some(PeerKind::Dm),
            peer_pattern: Some(user_id.into()),
            ..Default::default()
        }
    }

    /// Create a guild binding
    pub fn guild(agent_id: impl Into<String>, guild_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            binding_type: BindingType::Guild,
            priority: Priority::GUILD,
            platform: Some("discord".to_string()),
            peer_kind: Some(PeerKind::Guild),
            peer_pattern: Some(guild_id.into()),
            ..Default::default()
        }
    }

    /// Create a channel binding
    pub fn channel(agent_id: impl Into<String>, platform: impl Into<String>, channel_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            binding_type: BindingType::Channel,
            priority: Priority::CHANNEL,
            platform: Some(platform.into()),
            peer_kind: Some(PeerKind::Channel),
            peer_pattern: Some(channel_id.into()),
            ..Default::default()
        }
    }

    /// Check if this binding matches a session key
    pub fn matches(&self, key: &SessionKey) -> bool {
        // Check if binding is enabled
        if !self.enabled {
            return false;
        }

        // Platform check
        if let Some(ref platform) = self.platform {
            if &key.platform != platform {
                return false;
            }
        }

        // Account check
        if let Some(ref account) = self.account_id {
            if &key.account_id != account {
                return false;
            }
        }

        // Peer kind check
        if let Some(ref peer_kind) = self.peer_kind {
            if &key.peer_kind != peer_kind {
                return false;
            }
        }

        // Peer pattern check (supports wildcards)
        if let Some(ref pattern) = self.peer_pattern {
            if !pattern_matches(pattern, &key.peer_id) {
                return false;
            }
        }

        true
    }
}

/// Check if a pattern matches a value (supports * wildcards)
fn pattern_matches(pattern: &str, value: &str) -> bool {
    if pattern == "*" || pattern == value {
        return true;
    }

    // Handle simple glob patterns
    if pattern.ends_with('*') {
        let prefix = &pattern[..pattern.len() - 1];
        return value.starts_with(prefix);
    }

    if pattern.starts_with('*') {
        let suffix = &pattern[1..];
        return value.ends_with(suffix);
    }

    false
}

/// Route configuration storage
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteConfig {
    /// All agent bindings
    pub bindings: Vec<AgentBinding>,
    /// Binding ID to agent ID map (for quick lookup)
    pub binding_index: HashMap<String, String>,
    /// Default agent ID
    pub default_agent_id: String,
    /// Fallback agent ID
    pub fallback_agent_id: String,
}

impl RouteConfig {
    /// Create a new empty config
    pub fn new() -> Self {
        Self {
            bindings: Vec::new(),
            binding_index: HashMap::new(),
            default_agent_id: "default".to_string(),
            fallback_agent_id: "fallback".to_string(),
        }
    }

    /// Add a binding
    pub fn add_binding(&mut self, binding: AgentBinding) {
        self.bindings.push(binding.clone());
        self.binding_index.insert(binding.id.clone(), binding.agent_id.clone());
    }

    /// Remove a binding
    pub fn remove_binding(&mut self, binding_id: &str) -> bool {
        let initial_len = self.bindings.len();
        self.bindings.retain(|b| b.id != binding_id);
        self.binding_index.remove(binding_id);
        self.bindings.len() < initial_len
    }

    /// Get a binding by ID
    pub fn get_binding(&self, binding_id: &str) -> Option<&AgentBinding> {
        self.bindings.iter().find(|b| &b.id == binding_id)
    }

    /// List all bindings
    pub fn list_bindings(&self) -> Vec<&AgentBinding> {
        self.bindings.iter().collect()
    }

    /// Set the default agent
    pub fn set_default_agent(&mut self, agent_id: impl Into<String>) {
        self.default_agent_id = agent_id.into();
    }

    /// Set the fallback agent
    pub fn set_fallback_agent(&mut self, agent_id: impl Into<String>) {
        self.fallback_agent_id = agent_id.into();
    }

    /// Export config to JSON
    pub fn to_json(&self) -> Result<Value, serde_json::Error> {
        serde_json::to_value(self)
    }

    /// Import config from JSON
    pub fn from_json(json: &Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(json.clone())
    }
}

/// Binding CRUD operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBindingRequest {
    pub binding_type: BindingType,
    pub agent_id: String,
    pub platform: Option<String>,
    pub account_id: Option<String>,
    pub peer_kind: Option<PeerKind>,
    pub peer_pattern: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBindingRequest {
    pub agent_id: Option<String>,
    pub platform: Option<String>,
    pub account_id: Option<String>,
    pub peer_kind: Option<PeerKind>,
    pub peer_pattern: Option<String>,
    pub enabled: Option<bool>,
    pub description: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_binding_match() {
        let binding = AgentBinding::peer("test-agent", "discord", "U123456");
        let key = SessionKey::parse("agent:test-agent:discord:default:dm:U123456").unwrap();

        assert!(binding.matches(&key));
    }

    #[test]
    fn test_binding_no_match_platform() {
        let binding = AgentBinding::peer("test-agent", "discord", "U123456");
        let key = SessionKey::parse("agent:test-agent:slack:default:dm:U123456").unwrap();

        assert!(!binding.matches(&key));
    }

    #[test]
    fn test_pattern_matching() {
        assert!(pattern_matches("*", "anything"));
        assert!(pattern_matches("U*", "U123456"));
        assert!(pattern_matches("*456", "U123456"));
        assert!(pattern_matches("U123456", "U123456"));
        assert!(!pattern_matches("U999", "U123456"));
    }

    #[test]
    fn test_channel_binding() {
        let binding = AgentBinding::channel("my-agent", "discord", "C123456");
        let key = SessionKey::parse("agent:my-agent:discord:default:channel:C123456").unwrap();

        assert!(binding.matches(&key));
    }

    #[test]
    fn test_default_binding() {
        let binding = AgentBinding::default_agent("fallback-agent");
        let key = SessionKey::parse("agent:fallback-agent:slack:default:dm:U999").unwrap();

        // Default binding should match everything
        assert!(binding.matches(&key));
    }
}