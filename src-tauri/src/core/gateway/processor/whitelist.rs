use regex::Regex;

use super::super::types::{GatewayMessage, WhitelistConfig};
use super::WhitelistResult;

/// Validate a message against the whitelist configuration
pub fn validate(message: &GatewayMessage, config: &WhitelistConfig) -> WhitelistResult {
    // If whitelist is disabled, allow all messages
    if !config.enabled {
        return WhitelistResult {
            allowed: true,
            reason: None,
        };
    }

    // Check user whitelist
    if !config.user_ids.is_empty() {
        if !config.user_ids.contains(&message.user_id) {
            // Check if user matches any regex pattern
            if !config.user_ids.iter().any(|id| is_regex_match(id, &message.user_id)) {
                return WhitelistResult {
                    allowed: false,
                    reason: Some(format!("User {} not in whitelist", message.user_id)),
                };
            }
        }
    }

    // Check channel whitelist
    if !config.channel_ids.is_empty() {
        if !config.channel_ids.contains(&message.channel_id) {
            if !config.channel_ids.iter().any(|id| is_regex_match(id, &message.channel_id)) {
                return WhitelistResult {
                    allowed: false,
                    reason: Some(format!("Channel {} not in whitelist", message.channel_id)),
                };
            }
        }
    }

    // Check guild whitelist (if applicable)
    if let Some(guild_id) = &message.guild_id {
        if !config.guild_ids.is_empty() {
            if !config.guild_ids.contains(guild_id) {
                if !config.guild_ids.iter().any(|id| is_regex_match(id, guild_id)) {
                    return WhitelistResult {
                        allowed: false,
                        reason: Some(format!("Guild {} not in whitelist", guild_id)),
                    };
                }
            }
        }
    }

    WhitelistResult {
        allowed: true,
        reason: None,
    }
}

/// Check if a value matches a pattern (regex or exact match)
fn is_regex_match(pattern: &str, value: &str) -> bool {
    // If pattern contains regex metacharacters, use regex
    if pattern.chars().any(|c| matches!(c, '.' | '*' | '+' | '?' | '[' | ']' | '(' | ')' | '{' | '}' | '|' | '^' | '$' | '\\')) {
        if let Ok(re) = Regex::new(pattern) {
            return re.is_match(value);
        }
    }
    // Otherwise, exact match
    pattern == value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_whitelist_disabled() {
        let message = create_test_message();
        let config = WhitelistConfig {
            enabled: false,
            user_ids: vec!["wrong_user".to_string()],
            channel_ids: vec![],
            guild_ids: vec![],
            role_ids: vec![],
        };

        let result = validate(&message, &config);
        assert!(result.allowed);
    }

    #[test]
    fn test_user_whitelist_exact_match() {
        let message = create_test_message();
        let config = WhitelistConfig {
            enabled: true,
            user_ids: vec!["test_user".to_string(), "other_user".to_string()],
            channel_ids: vec![],
            guild_ids: vec![],
            role_ids: vec![],
        };

        let result = validate(&message, &config);
        assert!(result.allowed);
    }

    #[test]
    fn test_user_whitelist_reject() {
        let message = create_test_message();
        let config = WhitelistConfig {
            enabled: true,
            user_ids: vec!["other_user".to_string()],
            channel_ids: vec![],
            guild_ids: vec![],
            role_ids: vec![],
        };

        let result = validate(&message, &config);
        assert!(!result.allowed);
        assert!(result.reason.unwrap().contains("not in whitelist"));
    }

    #[test]
    fn test_channel_whitelist() {
        let message = create_test_message();
        let config = WhitelistConfig {
            enabled: true,
            user_ids: vec![],
            channel_ids: vec!["test_channel".to_string()],
            guild_ids: vec![],
            role_ids: vec![],
        };

        let result = validate(&message, &config);
        assert!(result.allowed);
    }

    #[test]
    fn test_regex_pattern() {
        let message = GatewayMessage::new(
            super::super::types::Platform::Discord,
            "user_123".to_string(),
            "channel_456".to_string(),
            "test message".to_string(),
        );

        let config = WhitelistConfig {
            enabled: true,
            user_ids: vec!["user_\\d+".to_string()], // Regex pattern
            channel_ids: vec![],
            guild_ids: vec![],
            role_ids: vec![],
        };

        let result = validate(&message, &config);
        assert!(result.allowed, "Regex pattern should match user_123");
    }

    #[test]
    fn test_guild_whitelist() {
        let mut message = create_test_message();
        message.guild_id = Some("guild_789".to_string());

        let config = WhitelistConfig {
            enabled: true,
            user_ids: vec![],
            channel_ids: vec![],
            guild_ids: vec!["guild_789".to_string()],
            role_ids: vec![],
        };

        let result = validate(&message, &config);
        assert!(result.allowed);
    }

    fn create_test_message() -> GatewayMessage {
        GatewayMessage::new(
            super::super::types::Platform::Discord,
            "test_user".to_string(),
            "test_channel".to_string(),
            "Hello, world!".to_string(),
        )
    }
}