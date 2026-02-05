//! Hook Mapping
//!
//! Individual hook mapping with path matching and routing logic.

use super::{HookMappingConfig, HookMatchResult};
use std::sync::Arc;
use tokio::sync::Mutex;
use regex::Regex;

/// Result of matching a request against a hook mapping
#[derive(Debug, Clone)]
pub struct HookMatchResult {
    /// The matching mapping configuration
    pub mapping: Arc<HookMapping>,
    /// Extracted path parameters (e.g., "interactions" from /webhooks/discord/interactions)
    pub path_params: std::collections::HashMap<String, String>,
}

/// Individual hook mapping
#[derive(Debug, Clone)]
pub struct HookMapping {
    /// Unique identifier
    pub id: String,
    /// URL path pattern
    pub path_pattern: String,
    /// Compiled regex for pattern matching
    pattern_regex: Regex,
    /// Platform source
    pub source: String,
    /// Channel ID (optional)
    pub channel_id: Option<String>,
    /// Input template
    pub input_template: Option<String>,
    /// Output template
    pub output_template: Option<String>,
    /// Auth required
    pub auth_required: bool,
    /// Auth header name
    pub auth_header: Option<String>,
    /// Auth value/prefix
    pub auth_value: Option<String>,
    /// Whether enabled
    pub enabled: bool,
    /// Description
    pub description: Option<String>,
}

impl HookMapping {
    /// Create a hook mapping from config
    pub fn from_config(config: HookMappingConfig) -> Result<Self, String> {
        // Convert wildcard pattern to regex
        let regex_pattern = Self::pattern_to_regex(&config.path_pattern)?;

        Ok(Self {
            id: config.id,
            path_pattern: config.path_pattern,
            pattern_regex: Regex::new(&regex_pattern)?,
            source: config.source,
            channel_id: config.channel_id,
            input_template: config.input_template,
            output_template: config.output_template,
            auth_required: config.auth_required,
            auth_header: config.auth_header,
            auth_value: config.auth_value,
            enabled: config.enabled,
            description: config.description,
        })
    }

    /// Convert wildcard pattern to regex
    fn pattern_to_regex(pattern: &str) -> Result<String, String> {
        // Escape special regex chars except * and ?
        let mut regex = String::new();

        for ch in pattern.chars() {
            match ch {
                '*' => regex.push_str(".*"),      // * matches anything
                '?' => regex.push_str("."),       // ? matches single char
                '.' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '^' | '$' => {
                    regex.push('\\');
                    regex.push(ch);
                }
                '/' => regex.push('/'),
                _ => regex.push(ch),
            }
        }

        // Anchor to match from start
        format!("^{}$", regex)
    }

    /// Check if a path matches this mapping
    pub async fn matches(&self, path: &str, auth_header: Option<&str>) -> Option<HookMatchResult> {
        if !self.enabled {
            return None;
        }

        // Check auth if required
        if self.auth_required {
            if !self.check_auth(auth_header) {
                return None;
            }
        }

        // Match path pattern
        if let Some(caps) = self.pattern_regex.captures(path) {
            // Extract path parameters
            let mut path_params = std::collections::HashMap::new();

            // Add named groups if any
            for name in self.pattern_regex.capture_names().flatten() {
                if let Some(cap) = caps.name(name) {
                    path_params.insert(name.to_string(), cap.as_str().to_string());
                }
            }

            // If no named groups, add wildcard matches
            if path_params.is_empty() {
                for (i, cap) in caps.iter().enumerate().skip(1) {
                    if let Some(c) = cap {
                        path_params.insert(format!("param_{}", i), c.as_str().to_string());
                    }
                }
            }

            return Some(HookMatchResult {
                mapping: Arc::new(self.clone()),
                path_params,
            });
        }

        None
    }

    /// Check authentication
    fn check_auth(&self, auth_header: Option<&str>) -> bool {
        let auth_header = match auth_header {
            Some(h) => h,
            None => return false,
        };

        // Get expected auth value (may include prefix like "Bearer ")
        let expected = match &self.auth_value {
            Some(v) => v.as_str(),
            None => return false,
        };

        // Check if auth header starts with expected value (for Bearer tokens)
        if expected.ends_with(' ') {
            // Prefix like "Bearer "
            auth_header.starts_with(expected)
        } else {
            // Exact match
            auth_header == expected
        }
    }

    /// Convert to frontend-compatible config
    pub fn to_config(&self) -> HookMappingConfig {
        HookMappingConfig {
            id: self.id.clone(),
            path_pattern: self.path_pattern.clone(),
            source: self.source.clone(),
            channel_id: self.channel_id.clone(),
            input_template: self.input_template.clone(),
            output_template: self.output_template.clone(),
            auth_required: self.auth_required,
            auth_header: self.auth_header.clone(),
            auth_value: self.auth_value.clone(),
            enabled: self.enabled,
            description: self.description.clone(),
        }
    }
}

/// Hook mapper for matching requests
#[derive(Debug, Clone, Default)]
pub struct HookMapper {
    /// Registered hook mappings
    mappings: Arc<Mutex<Vec<Arc<HookMapping>>>>,
}

impl HookMapper {
    /// Create a new hook mapper
    pub fn new() -> Self {
        Self {
            mappings: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Register a hook mapping
    pub async fn register(&self, mapping: HookMapping) {
        let mut guard = self.mappings.lock().await;
        guard.push(Arc::new(mapping));
    }

    /// Unregister a hook mapping
    pub async fn unregister(&self, id: &str) -> bool {
        let mut guard = self.mappings.lock().await;
        let original_len = guard.len();
        guard.retain(|m| m.id != id);
        guard.len() < original_len
    }

    /// Find matching hook for a path
    pub async fn find_match(&self, path: &str, auth_header: Option<&str>) -> Option<HookMatchResult> {
        let guard = self.mappings.lock().await;
        for mapping in guard.iter() {
            if let Some(result) = mapping.matches(path, auth_header).await {
                return Some(result);
            }
        }
        None
    }

    /// Get all registered mappings
    pub async fn list(&self) -> Vec<Arc<HookMapping>>> {
        let guard = self.mappings.lock().await;
        guard.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_wildcard_matching() {
        let mapping = HookMapping::from_config(HookMappingConfig {
            id: "test".to_string(),
            path_pattern: "/webhooks/*".to_string(),
            source: "test".to_string(),
            enabled: true,
            ..Default::default()
        }).unwrap();

        // Should match any path under /webhooks/
        assert!(mapping.matches("/webhooks/discord", None).await.is_some());
        assert!(mapping.matches("/webhooks/slack/events", None).await.is_some());
        assert!(mapping.matches("/webhooks/", None).await.is_some());
        assert!(mapping.matches("/webhooks", None).is_none()); // No trailing slash match
        assert!(mapping.matches("/api/webhooks", None).is_none()); // Different prefix
    }

    #[tokio::test]
    async fn test_exact_matching() {
        let mapping = HookMapping::from_config(HookMappingConfig {
            id: "exact".to_string(),
            path_pattern: "/api/status".to_string(),
            source: "test".to_string(),
            enabled: true,
            ..Default::default()
        }).unwrap();

        assert!(mapping.matches("/api/status", None).await.is_some());
        assert!(mapping.matches("/api/status/", None).await.is_none());
        assert!(mapping.matches("/api/status/extra", None).await.is_none());
    }

    #[tokio::test]
    async fn test_auth_check() {
        let mapping = HookMapping::from_config(HookMappingConfig {
            id: "auth-required".to_string(),
            path_pattern: "/protected/*".to_string(),
            source: "test".to_string(),
            auth_required: true,
            auth_header: Some("X-API-Key".to_string()),
            auth_value: Some("secret123".to_string()),
            enabled: true,
            ..Default::default()
        }).unwrap();

        // No auth header
        assert!(mapping.matches("/protected/data", None).await.is_none());

        // Wrong auth
        assert!(mapping.matches("/protected/data", Some("wrong-key")).await.is_none());

        // Correct auth
        assert!(mapping.matches("/protected/data", Some("secret123")).await.is_some());
    }

    #[tokio::test]
    async fn test_bearer_auth() {
        let mapping = HookMapping::from_config(HookMappingConfig {
            id: "bearer".to_string(),
            path_pattern: "/api/*".to_string(),
            source: "test".to_string(),
            auth_required: true,
            auth_header: Some("Authorization".to_string()),
            auth_value: Some("Bearer ".to_string()),
            enabled: true,
            ..Default::default()
        }).unwrap();

        assert!(mapping.matches("/api/data", Some("Bearer abc123")).await.is_some());
        assert!(mapping.matches("/api/data", Some("Token abc123")).await.is_none());
    }

    #[test]
    fn test_pattern_to_regex() {
        assert_eq!(
            HookMapping::pattern_to_regex("/webhooks/*").unwrap(),
            r"^/webhooks/.*$"
        );

        assert_eq!(
            HookMapping::pattern_to_regex("/api/?/data").unwrap(),
            r"^/api/./data$"
        );

        assert_eq!(
            HookMapping::pattern_to_regex("/users/{id}/posts").unwrap(),
            r"^/users/\{id\}/posts$"
        );
    }

    #[tokio::test]
    async fn test_path_params() {
        let mapping = HookMapping::from_config(HookMappingConfig {
            id: "params".to_string(),
            path_pattern: "/webhooks/*/*".to_string(),
            source: "test".to_string(),
            enabled: true,
            ..Default::default()
        }).unwrap();

        let result = mapping.matches("/webhooks/discord/12345", None).await.unwrap();
        assert_eq!(result.path_params.get("param_1").unwrap(), "discord");
        assert_eq!(result.path_params.get("param_2").unwrap(), "12345");
    }
}