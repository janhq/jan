//! Session Key System
//!
//! Defines structured session keys for routing messages to agents based on
//! platform, account, and conversation context.
//!
//! Session Key Format:
//! `agent:{agentId}:{platform}:{accountId}:{peerKind}:{peerId}`
//!
//! Examples:
//! - `agent:main:discord:default:dm:U123456789`
//! - `agent:main:slack:my-workspace:channel:C001`
//! - `agent:main:telegram:bot1:supergroup:-100123456789`

use std::fmt;
use serde::{Deserialize, Serialize};
use regex::Regex;
use once_cell::sync::Lazy;

/// Regex pattern for validating session keys
static SESSION_KEY_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9]+:[a-zA-Z0-9_-]+:[a-zA-Z]+:[a-zA-Z0-9_-]+$").unwrap()
});

/// Peer kinds for session keys
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PeerKind {
    /// Direct message (DM)
    Dm,
    /// Channel
    Channel,
    /// Group chat
    Group,
    /// Thread
    Thread,
    /// Supergroup (Telegram)
    Supergroup,
    /// Guild (Discord server)
    Guild,
    /// Team (Slack workspace)
    Team,
    /// Forum thread
    Forum,
    /// Unknown
    Unknown,
}

impl Default for PeerKind {
    fn default() -> Self {
        PeerKind::Unknown
    }
}

impl PeerKind {
    /// Parse from string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "dm" | "direct" => PeerKind::Dm,
            "channel" | "chan" => PeerKind::Channel,
            "group" => PeerKind::Group,
            "thread" => PeerKind::Thread,
            "supergroup" | "super_group" => PeerKind::Supergroup,
            "guild" | "server" => PeerKind::Guild,
            "team" | "workspace" => PeerKind::Team,
            "forum" => PeerKind::Forum,
            _ => PeerKind::Unknown,
        }
    }

    /// Convert to string
    pub fn as_str(&self) -> &'static str {
        match self {
            PeerKind::Dm => "dm",
            PeerKind::Channel => "channel",
            PeerKind::Group => "group",
            PeerKind::Thread => "thread",
            PeerKind::Supergroup => "supergroup",
            PeerKind::Guild => "guild",
            PeerKind::Team => "team",
            PeerKind::Forum => "forum",
            PeerKind::Unknown => "unknown",
        }
    }
}

/// Session key for routing messages to agents
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SessionKey {
    /// Agent identifier
    pub agent_id: String,
    /// Platform identifier
    pub platform: String,
    /// Account identifier
    pub account_id: String,
    /// Peer kind (dm, channel, guild, etc.)
    pub peer_kind: PeerKind,
    /// Peer identifier (user ID, channel ID, etc.)
    pub peer_id: String,
}

impl SessionKey {
    /// Create a new session key
    pub fn new(
        agent_id: impl Into<String>,
        platform: impl Into<String>,
        account_id: impl Into<String>,
        peer_kind: PeerKind,
        peer_id: impl Into<String>,
    ) -> Self {
        Self {
            agent_id: agent_id.into(),
            platform: platform.into(),
            account_id: account_id.into(),
            peer_kind,
            peer_id: peer_id.into(),
        }
    }

    /// Parse a session key from string
    pub fn parse(s: &str) -> Result<Self, SessionKeyError> {
        // Remove prefix if present
        let s = s.strip_prefix("agent:").unwrap_or(s);

        let parts: Vec<&str> = s.split(':').collect();

        if parts.len() != 5 {
            return Err(SessionKeyError::InvalidFormat(
                "Expected 5 colon-separated parts".to_string()
            ));
        }

        Ok(Self {
            agent_id: parts[0].to_string(),
            platform: parts[1].to_string(),
            account_id: parts[2].to_string(),
            peer_kind: PeerKind::from_str(parts[3]),
            peer_id: parts[4].to_string(),
        })
    }

    /// Serialize to string
    pub fn to_string(&self) -> String {
        format!(
            "agent:{}:{}:{}:{}:{}",
            self.agent_id, self.platform, self.account_id,
            self.peer_kind.as_str(), self.peer_id
        )
    }

    /// Validate the session key format
    pub fn is_valid(&self) -> bool {
        !self.agent_id.is_empty() &&
            !self.platform.is_empty() &&
            !self.account_id.is_empty() &&
            !self.peer_id.is_empty() &&
            self.peer_kind != PeerKind::Unknown
    }

    /// Create a wildcard match pattern for this key
    pub fn to_pattern(&self) -> SessionKeyPattern {
        SessionKeyPattern {
            agent_id: Some(self.agent_id.clone()),
            platform: Some(self.platform.clone()),
            account_id: Some(self.account_id.clone()),
            peer_kind: Some(self.peer_kind.clone()),
            peer_id: Some(self.peer_id.clone()),
        }
    }

}

impl fmt::Display for SessionKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}:{:?}:{}",
            self.agent_id, self.platform, self.account_id, self.peer_kind, self.peer_id
        )
    }
}

/// Session key pattern for flexible matching
#[derive(Debug, Clone)]
pub struct SessionKeyPattern {
    agent_id: Option<String>,
    platform: Option<String>,
    account_id: Option<String>,
    peer_kind: Option<PeerKind>,
    peer_id: Option<String>,
}

impl SessionKeyPattern {
    /// Create a wildcard pattern
    pub fn wildcard() -> Self {
        Self {
            agent_id: None,
            platform: None,
            account_id: None,
            peer_kind: None,
            peer_id: None,
        }
    }

    /// Check if a key matches this pattern
    pub fn matches(&self, key: &SessionKey) -> bool {
        if let Some(agent) = &self.agent_id {
            if &key.agent_id != agent { return false; }
        }
        if let Some(platform) = &self.platform {
            if &key.platform != platform { return false; }
        }
        if let Some(account) = &self.account_id {
            if &key.account_id != account { return false; }
        }
        if let Some(kind) = &self.peer_kind {
            if key.peer_kind != *kind { return false; }
        }
        if let Some(peer) = &self.peer_id {
            if &key.peer_id != peer { return false; }
        }
        true
    }
}

/// Session key errors
#[derive(Debug, thiserror::Error)]
pub enum SessionKeyError {
    #[error("Invalid session key format: {0}")]
    InvalidFormat(String),

    #[error("Empty agent ID")]
    EmptyAgentId,

    #[error("Empty platform")]
    EmptyPlatform,

    #[error("Empty peer ID")]
    EmptyPeerId,
}

/// Session key builder for ergonomic construction
#[derive(Debug, Default)]
pub struct SessionKeyBuilder {
    agent_id: Option<String>,
    platform: Option<String>,
    account_id: Option<String>,
    peer_kind: Option<PeerKind>,
    peer_id: Option<String>,
}

impl SessionKeyBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn agent(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    pub fn platform(mut self, platform: impl Into<String>) -> Self {
        self.platform = Some(platform.into());
        self
    }

    pub fn account(mut self, account_id: impl Into<String>) -> Self {
        self.account_id = Some(account_id.into());
        self
    }

    pub fn peer_kind(mut self, peer_kind: PeerKind) -> Self {
        self.peer_kind = Some(peer_kind);
        self
    }

    pub fn peer_id(mut self, peer_id: impl Into<String>) -> Self {
        self.peer_id = Some(peer_id.into());
        self
    }

    pub fn dm(self, peer_id: impl Into<String>) -> Self {
        self.peer_kind(PeerKind::Dm).peer_id(peer_id)
    }

    pub fn channel(self, peer_id: impl Into<String>) -> Self {
        self.peer_kind(PeerKind::Channel).peer_id(peer_id)
    }

    pub fn guild(self, peer_id: impl Into<String>) -> Self {
        self.peer_kind(PeerKind::Guild).peer_id(peer_id)
    }

    pub fn build(self) -> Result<SessionKey, SessionKeyError> {
        let agent_id = self.agent_id.ok_or(SessionKeyError::EmptyAgentId)?;
        let platform = self.platform.ok_or(SessionKeyError::EmptyPlatform)?;
        let account_id = self.account_id.unwrap_or_else(|| "default".to_string());
        let peer_kind = self.peer_kind.unwrap_or_default();
        let peer_id = self.peer_id.ok_or(SessionKeyError::EmptyPeerId)?;

        let key = SessionKey::new(agent_id, platform, account_id, peer_kind, peer_id);
        if !key.is_valid() {
            return Err(SessionKeyError::InvalidFormat(
                "Invalid session key components".to_string()
            ));
        }
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_session_key() {
        let key = SessionKey::parse("agent:main:discord:default:dm:U123456789").unwrap();
        assert_eq!(key.agent_id, "main");
        assert_eq!(key.platform, "discord");
        assert_eq!(key.account_id, "default");
        assert_eq!(key.peer_kind, PeerKind::Dm);
        assert_eq!(key.peer_id, "U123456789");
    }

    #[test]
    fn test_to_string() {
        let key = SessionKey::parse("agent:main:slack:my-workspace:channel:C001").unwrap();
        assert_eq!(key.to_string(), "agent:main:slack:my-workspace:channel:C001");
    }

    #[test]
    fn test_builder() {
        let key = SessionKeyBuilder::new()
            .agent("assistant")
            .platform("telegram")
            .account("bot1")
            .peer_kind(PeerKind::Supergroup)
            .peer_id("-100123456789")
            .build()
            .unwrap();

        assert_eq!(key.agent_id, "assistant");
        assert_eq!(key.peer_kind, PeerKind::Supergroup);
    }

    #[test]
    fn test_builder_dm() {
        let key = SessionKeyBuilder::new()
            .agent("test")
            .platform("discord")
            .dm("U123456")
            .build()
            .unwrap();

        assert_eq!(key.peer_kind, PeerKind::Dm);
    }

    #[test]
    fn test_pattern_matching() {
        let key = SessionKey::parse("agent:main:discord:default:dm:U123456789").unwrap();
        let pattern = SessionKeyPattern {
            agent_id: Some("main"),
            platform: Some("discord"),
            account_id: None,
            peer_kind: None,
            peer_id: None,
        };

        assert!(pattern.matches(&key));
    }
}