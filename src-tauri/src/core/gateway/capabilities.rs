//! Capabilities Module
//!
//! This module provides protocol versioning and client capability negotiation
//! for the gateway system.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Current gateway protocol version
pub const GATEWAY_PROTOCOL_VERSION: &str = "1.0.0";

/// Client capabilities advertised by a client
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    /// Protocol version the client supports
    pub protocol_version: String,
    /// Platforms the client can handle
    pub platforms: Vec<String>,
    /// Whether client supports async inference
    pub async_inference: bool,
    /// Whether client supports streaming responses
    pub streaming: bool,
    /// Whether client supports agent mode
    pub agent_mode: bool,
    /// Maximum message size in bytes
    pub max_message_size: u64,
}

impl ClientCapabilities {
    /// Create default client capabilities
    pub fn new() -> Self {
        Self {
            protocol_version: GATEWAY_PROTOCOL_VERSION.to_string(),
            platforms: vec!["discord".to_string(), "slack".to_string(), "telegram".to_string()],
            async_inference: true,
            streaming: false,
            agent_mode: false,
            max_message_size: 1024 * 1024, // 1MB default
        }
    }

    /// Check if the client supports a specific platform
    pub fn supports_platform(&self, platform: &str) -> bool {
        self.platforms.iter().any(|p| p.as_str() == platform)
    }

    /// Check if the client supports async inference
    pub fn supports_async_inference(&self) -> bool {
        self.async_inference
    }

    /// Check if the client supports streaming
    pub fn supports_streaming(&self) -> bool {
        self.streaming
    }

    /// Check if the client supports agent mode
    pub fn supports_agent_mode(&self) -> bool {
        self.agent_mode
    }
}

/// Server capabilities advertised by the gateway
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCapabilities {
    /// Protocol version the server implements
    pub protocol_version: String,
    /// Available platforms
    pub available_platforms: Vec<String>,
    /// Supported features
    pub features: HashSet<String>,
    /// Maximum message size in bytes
    pub max_message_size: u64,
    /// Gateway instance ID
    pub instance_id: String,
    /// Server timestamp
    pub server_time: u64,
}

impl Default for ServerCapabilities {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerCapabilities {
    /// Create new server capabilities
    pub fn new() -> Self {
        let mut features = HashSet::new();
        features.insert("webhook".to_string());
        features.insert("websocket".to_string());
        features.insert("thread_management".to_string());
        features.insert("response_queue".to_string());

        Self {
            protocol_version: GATEWAY_PROTOCOL_VERSION.to_string(),
            available_platforms: vec!["discord".to_string(), "slack".to_string(), "telegram".to_string()],
            features,
            max_message_size: 1024 * 1024, // 1MB
            instance_id: uuid::Uuid::new_v4().to_string(),
            server_time: chrono::Utc::now().timestamp_millis() as u64,
        }
    }

    /// Get the protocol version
    pub fn protocol_version(&self) -> &str {
        &self.protocol_version
    }

    /// Get available platforms
    pub fn available_platforms(&self) -> &[String] {
        &self.available_platforms
    }

    /// Check if a feature is supported
    pub fn has_feature(&self, feature: &str) -> bool {
        self.features.contains(feature)
    }

    /// Update server timestamp
    pub fn update_time(&mut self) {
        self.server_time = chrono::Utc::now().timestamp_millis() as u64;
    }
}

/// Negotiation result after comparing client and server capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NegotiationResult {
    /// Whether negotiation succeeded
    pub success: bool,
    /// Negotiated protocol version
    pub negotiated_version: String,
    /// Platforms both sides agree on
    pub negotiated_platforms: Vec<String>,
    /// Features both sides agree on
    pub negotiated_features: Vec<String>,
    /// Whether async inference is available
    pub async_inference_available: bool,
    /// Whether streaming is available
    pub streaming_available: bool,
    /// Whether agent mode is available
    pub agent_mode_available: bool,
    /// Maximum message size for this session
    pub max_message_size: u64,
    /// Error message if negotiation failed
    pub error: Option<String>,
}

impl NegotiationResult {
    /// Create a successful negotiation result
    pub fn success(
        version: String,
        platforms: Vec<String>,
        features: Vec<String>,
        async_inference: bool,
        streaming: bool,
        agent_mode: bool,
        max_message_size: u64,
    ) -> Self {
        Self {
            success: true,
            negotiated_version: version,
            negotiated_platforms: platforms,
            negotiated_features: features,
            async_inference_available: async_inference,
            streaming_available: streaming,
            agent_mode_available: agent_mode,
            max_message_size,
            error: None,
        }
    }

    /// Create a failed negotiation result
    pub fn failure(error: String) -> Self {
        Self {
            success: false,
            negotiated_version: String::new(),
            negotiated_platforms: Vec::new(),
            negotiated_features: Vec::new(),
            async_inference_available: false,
            streaming_available: false,
            agent_mode_available: false,
            max_message_size: 0,
            error: Some(error),
        }
    }
}

/// Negotiate capabilities between client and server
pub fn negotiate_capabilities(
    client: &ClientCapabilities,
    server: &ServerCapabilities,
) -> NegotiationResult {
    // Check protocol version compatibility
    if !is_version_compatible(&client.protocol_version, &server.protocol_version) {
        return NegotiationResult::failure(format!(
            "Protocol version mismatch: client={}, server={}",
            client.protocol_version, server.protocol_version
        ));
    }

    // Find common platforms
    let negotiated_platforms: Vec<String> = client
        .platforms
        .iter()
        .filter(|p| server.available_platforms.contains(p))
        .cloned()
        .collect();

    if negotiated_platforms.is_empty() {
        return NegotiationResult::failure(
            "No common platforms available".to_string(),
        );
    }

    // Find common features (client doesn't advertise features yet, so use server features)
    let negotiated_features: Vec<String> = server
        .features
        .iter()
        .cloned()
        .collect();

    // Negotiate capabilities
    let async_inference = client.async_inference && server.has_feature("async_inference");
    let streaming = client.streaming && server.has_feature("streaming");
    let agent_mode = client.agent_mode && server.has_feature("agent_mode");

    // Use the minimum of both max message sizes
    let max_message_size = std::cmp::min(client.max_message_size, server.max_message_size);

    log::info!(
        "[Capabilities] Negotiation successful: {} platforms, {} features, async={}, streaming={}, agent={}",
        negotiated_platforms.len(),
        negotiated_features.len(),
        async_inference,
        streaming,
        agent_mode
    );

    NegotiationResult::success(
        server.protocol_version.clone(),
        negotiated_platforms,
        negotiated_features,
        async_inference,
        streaming,
        agent_mode,
        max_message_size,
    )
}

/// Check if two protocol versions are compatible
/// Returns true if the major version matches
pub fn is_version_compatible(client_version: &str, server_version: &str) -> bool {
    let client_major = extract_major_version(client_version);
    let server_major = extract_major_version(server_version);

    client_major == server_major
}

/// Extract major version from a semantic version string
fn extract_major_version(version: &str) -> u32 {
    version
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_major_version() {
        assert_eq!(extract_major_version("1.0.0"), 1);
        assert_eq!(extract_major_version("2.1.3"), 2);
        assert_eq!(extract_major_version("0.9.0"), 0);
        assert_eq!(extract_major_version("invalid"), 0);
    }

    #[test]
    fn test_is_version_compatible_same_major() {
        assert!(is_version_compatible("1.0.0", "1.0.0"));
        assert!(is_version_compatible("1.2.3", "1.9.9"));
        assert!(is_version_compatible("2.0.0", "2.3.1"));
    }

    #[test]
    fn test_is_version_compatible_different_major() {
        assert!(!is_version_compatible("1.0.0", "2.0.0"));
        assert!(!is_version_compatible("2.0.0", "1.0.0"));
    }

    #[test]
    fn test_client_capabilities() {
        let caps = ClientCapabilities::new();
        assert!(caps.supports_platform("discord"));
        assert!(!caps.supports_platform("unknown"));
    }

    #[test]
    fn test_server_capabilities() {
        let caps = ServerCapabilities::new();
        assert!(caps.has_feature("webhook"));
        assert!(caps.has_feature("websocket"));
    }

    #[test]
    fn test_negotiate_capabilities_success() {
        let client = ClientCapabilities::new();
        let server = ServerCapabilities::new();

        let result = negotiate_capabilities(&client, &server);

        assert!(result.success);
        assert_eq!(result.negotiated_version, "1.0.0");
        assert!(!result.negotiated_platforms.is_empty());
    }

    #[test]
    fn test_negotiate_capabilities_version_mismatch() {
        let mut client = ClientCapabilities::new();
        client.protocol_version = "2.0.0".to_string();

        let server = ServerCapabilities::new();

        let result = negotiate_capabilities(&client, &server);

        assert!(!result.success);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("Protocol version mismatch"));
    }

    #[test]
    fn test_negotiate_capabilities_no_common_platforms() {
        let mut client = ClientCapabilities::new();
        client.platforms = vec!["matrix".to_string()]; // Not in server

        let server = ServerCapabilities::new();

        let result = negotiate_capabilities(&client, &server);

        assert!(!result.success);
        assert!(result.error.unwrap().contains("No common platforms"));
    }

    #[test]
    fn test_server_capabilities_default() {
        let caps = ServerCapabilities::default();
        assert_eq!(caps.protocol_version, GATEWAY_PROTOCOL_VERSION);
        assert!(!caps.instance_id.is_empty());
        assert!(caps.server_time > 0);
    }
}