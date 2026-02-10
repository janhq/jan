//! Hook Mappings Module
//!
//! Provides path-based routing from webhook URLs to platform sources
//! with optional template rendering for request/response transformation.

pub mod mapping;
pub mod template;

pub use mapping::HookMapping;
pub use mapping::HookMatchResult;

use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

/// Hook mapping configuration (frontend-compatible)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HookMappingConfig {
    /// Unique identifier
    pub id: String,
    /// URL path pattern (supports wildcards like /webhooks/*)
    pub path_pattern: String,
    /// Platform source to route to (discord, slack, telegram)
    pub source: String,
    /// Optional: specific channel/account for this hook
    pub channel_id: Option<String>,
    /// Template for transforming incoming payload
    pub input_template: Option<String>,
    /// Template for transforming outgoing response
    pub output_template: Option<String>,
    /// Authentication requirement
    pub auth_required: bool,
    /// Auth header name
    pub auth_header: Option<String>,
    /// Expected auth value (or prefix like "Bearer ")
    pub auth_value: Option<String>,
    /// Whether this hook is enabled
    pub enabled: bool,
    /// Description
    pub description: Option<String>,
}

/// Hook mapping statistics
#[derive(Debug, Clone, Default)]
pub struct HookStats {
    pub total_requests: u64,
    pub successful_matches: u64,
    pub auth_failures: u64,
    pub template_errors: u64,
}

/// Hook mapping service
#[derive(Debug, Default)]
pub struct HookMappingService {
    /// All configured mappings
    mappings: Arc<Mutex<Vec<HookMapping>>>,
    /// Statistics
    stats: Arc<Mutex<HookStats>>,
}

impl HookMappingService {
    /// Create a new hook mapping service
    pub fn new() -> Self {
        Self {
            mappings: Arc::new(Mutex::new(Vec::new())),
            stats: Arc::new(Mutex::new(HookStats::default())),
        }
    }

    /// Add a hook mapping
    pub async fn add_mapping(&self, config: HookMappingConfig) -> Result<(), String> {
        let mapping = HookMapping::from_config(config)?;
        let mut guard = self.mappings.lock().await;
        guard.push(mapping);
        Ok(())
    }

    /// Remove a hook mapping
    pub async fn remove_mapping(&self, id: &str) -> bool {
        let mut guard = self.mappings.lock().await;
        let original_len = guard.len();
        guard.retain(|m| m.id != id);
        guard.len() < original_len
    }

    /// Get all mappings
    pub async fn list_mappings(&self) -> Vec<HookMappingConfig> {
        let guard = self.mappings.lock().await;
        guard.iter().map(|m| m.to_config()).collect()
    }

    /// Match a request path against configured hooks
    pub async fn match_path(&self, path: &str, auth_header: Option<&str>) -> Option<HookMatchResult> {
        let mut stats = self.stats.lock().await;
        stats.total_requests += 1;

        let guard = self.mappings.lock().await;
        for mapping in guard.iter() {
            if !mapping.enabled {
                continue;
            }

            if let Some(result) = mapping.matches(path, auth_header).await {
                stats.successful_matches += 1;
                return Some(result);
            }
        }

        None
    }

    /// Get statistics
    pub async fn get_stats(&self) -> HookStats {
        self.stats.lock().await.clone()
    }

    /// Reset statistics
    pub async fn reset_stats(&self) {
        let mut stats = self.stats.lock().await;
        *stats = HookStats::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_hook_matching() {
        let service = HookMappingService::new();

        service.add_mapping(HookMappingConfig {
            id: "discord-webhook".to_string(),
            path_pattern: "/webhooks/discord/*".to_string(),
            source: "discord".to_string(),
            channel_id: Some("123456789".to_string()),
            enabled: true,
            ..Default::default()
        }).await.unwrap();

        service.add_mapping(HookMappingConfig {
            id: "slack-events".to_string(),
            path_pattern: "/webhooks/slack/events".to_string(),
            source: "slack".to_string(),
            enabled: true,
            ..Default::default()
        }).await.unwrap();

        // Test Discord webhook matching
        let result = service.match_path("/webhooks/discord/interactions", None).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().mapping.id, "discord-webhook");

        // Test Slack events exact match
        let result = service.match_path("/webhooks/slack/events", None).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().mapping.id, "slack-events");

        // Test non-matching path
        let result = service.match_path("/api/users", None).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_auth_enforcement() {
        let service = HookMappingService::new();

        service.add_mapping(HookMappingConfig {
            id: "protected-hook".to_string(),
            path_pattern: "/protected/*".to_string(),
            source: "test".to_string(),
            auth_required: true,
            auth_header: Some("Authorization".to_string()),
            auth_value: Some("Bearer secret-token".to_string()),
            enabled: true,
            ..Default::default()
        }).await.unwrap();

        // No auth - should fail
        let result = service.match_path("/protected/data", None).await;
        assert!(result.is_none());

        // Wrong auth - should fail
        let result = service.match_path("/protected/data", Some("Bearer wrong-token")).await;
        assert!(result.is_none());

        // Correct auth - should succeed
        let result = service.match_path("/protected/data", Some("Bearer secret-token")).await;
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn test_stats() {
        let service = HookMappingService::new();
        let stats = service.get_stats().await;
        assert_eq!(stats.total_requests, 0);

        service.match_path("/unknown", None).await;
        let stats = service.get_stats().await;
        assert_eq!(stats.total_requests, 1);
    }
}