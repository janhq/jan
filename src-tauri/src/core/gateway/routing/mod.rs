//! Routing Module
//!
//! Provides session key-based routing and agent binding for platform integrations.
//! Implements priority-based route resolution for the gateway system.

pub mod session_key;
pub mod config;
pub mod resolver;
pub mod agent_integration;

pub use session_key::{SessionKey, PeerKind};
pub use config::{RouteConfig, AgentBinding, Priority};
pub use resolver::RouteResolver;
pub use agent_integration::AgentRoutingService;

/// Predefined priority constants
pub mod priorities {
    use super::Priority;

    pub const PEER: Priority = Priority::PEER;
    pub const PEER_PARENT: Priority = Priority::PEER_PARENT;
    pub const GUILD: Priority = Priority::GUILD;
    pub const TEAM: Priority = Priority::TEAM;
    pub const ACCOUNT: Priority = Priority::ACCOUNT;
    pub const CHANNEL: Priority = Priority::CHANNEL;
    pub const DEFAULT: Priority = Priority::DEFAULT;
    pub const FALLBACK: Priority = Priority::FALLBACK;
}

/// Create a default route resolver with common bindings
pub fn create_default_resolver() -> RouteResolver {
    let mut resolver = RouteResolver::new();
    let mut config = RouteConfig::new();

    // Default binding (fallback)
    config.add_binding(AgentBinding::default_agent("default"));

    resolver.update_config(config);
    resolver
}