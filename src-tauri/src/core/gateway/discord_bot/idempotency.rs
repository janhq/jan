//! Idempotency Module
//!
//! This module provides idempotency handling for Discord webhook requests.
//! Discord may retry webhook deliveries, so we need to detect and skip duplicates.

use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::Mutex;
use chrono::{DateTime, Utc};

/// Represents a unique message identifier for idempotency checking
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyKey {
    /// Discord message ID (snowflake)
    message_id: String,
    /// Discord channel ID
    channel_id: String,
    /// Discord guild ID (if available)
    guild_id: Option<String>,
    /// Timestamp window for additional safety
    timestamp_window: i64,
}

impl IdempotencyKey {
    /// Create a new idempotency key from message components
    pub fn new(
        message_id: String,
        channel_id: String,
        guild_id: Option<String>,
        timestamp: i64,
    ) -> Self {
        // Use 1-minute timestamp windows for additional safety
        let timestamp_window = timestamp / 60_000;

        Self {
            message_id,
            channel_id,
            guild_id,
            timestamp_window,
        }
    }
}

/// Implement Hash for IdempotencyKey to use in HashSet
impl Hash for IdempotencyKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.message_id.hash(state);
        self.channel_id.hash(state);
        self.guild_id.hash(state);
        self.timestamp_window.hash(state);
    }
}

/// In-memory cache for idempotency keys with automatic cleanup
#[derive(Debug, Default, Clone)]
pub struct IdempotencyCache {
    /// Set of processed message IDs
    processed_keys: HashSet<IdempotencyKey>,
    /// Creation timestamp for cleanup
    created_at: DateTime<Utc>,
    /// Maximum age for entries (1 hour default)
    max_age_seconds: i64,
}

impl IdempotencyCache {
    /// Create a new idempotency cache
    pub fn new() -> Self {
        Self {
            processed_keys: HashSet::new(),
            created_at: Utc::now(),
            max_age_seconds: 3600, // 1 hour
        }
    }

    /// Create a new shared idempotency cache
    pub fn create_shared() -> SharedIdempotencyCache {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Check if a message has already been processed
    /// Returns true if this is a duplicate (already processed)
    pub fn is_duplicate(&mut self, message_id: &str, channel_id: &str, guild_id: Option<&str>, timestamp: i64) -> bool {
        // Clean up old entries
        self.cleanup();

        let key = IdempotencyKey::new(
            message_id.to_string(),
            channel_id.to_string(),
            guild_id.map(|s| s.to_string()),
            timestamp,
        );

        // Check if already processed (including this key)
        if self.processed_keys.contains(&key) {
            log::debug!(
                "[Idempotency] Duplicate detected: message_id={}, channel_id={}",
                message_id,
                channel_id
            );
            return true;
        }

        // Mark as processed
        self.processed_keys.insert(key);
        log::debug!(
            "[Idempotency] Marked message as processed: message_id={}, channel_id={}",
            message_id,
            channel_id
        );
        false
    }

    /// Atomic check-and-mark operation
    /// Returns true if this is a duplicate (already processed)
    pub fn check_and_mark(&mut self, message_id: &str, channel_id: &str, guild_id: Option<&str>, timestamp: i64) -> bool {
        self.is_duplicate(message_id, channel_id, guild_id, timestamp)
    }

    /// Clean up old entries based on max age
    fn cleanup(&mut self) {
        let now = Utc::now();
        let max_age = chrono::Duration::seconds(self.max_age_seconds);

        // Only clean up if cache is getting old (every 1000 messages or so)
        if self.processed_keys.len() > 1000 || now.signed_duration_since(self.created_at) > max_age {
            // Simple approach: clear old entries based on timestamp window
            // For now, just clear everything if older than max_age
            if now.signed_duration_since(self.created_at) > max_age {
                log::info!(
                    "[Idempotency] Clearing cache after {} seconds",
                    now.signed_duration_since(self.created_at).num_seconds()
                );
                self.processed_keys.clear();
                self.created_at = now;
            }
        }
    }

    /// Get the number of cached entries
    pub fn len(&self) -> usize {
        self.processed_keys.len()
    }

    /// Check if cache is empty
    pub fn is_empty(&self) -> bool {
        self.processed_keys.is_empty()
    }

    /// Clear all entries
    pub fn clear(&mut self) {
        self.processed_keys.clear();
        self.created_at = Utc::now();
        log::info!("[Idempotency] Cache cleared");
    }
}

/// Shared idempotency cache type
pub type SharedIdempotencyCache = Arc<Mutex<IdempotencyCache>>;

/// Extension trait for GatewayManager to easily check idempotency
pub trait IdempotencyChecker {
    /// Check if a message is a duplicate
    fn is_duplicate(&mut self, message_id: &str, channel_id: &str, guild_id: Option<&str>, timestamp: i64) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idempotency_key_equality() {
        let key1 = IdempotencyKey::new(
            "123".to_string(),
            "456".to_string(),
            Some("789".to_string()),
            1234567890000,
        );
        let key2 = IdempotencyKey::new(
            "123".to_string(),
            "456".to_string(),
            Some("789".to_string()),
            1234567890000,
        );
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_idempotency_key_inequality_different_message() {
        let key1 = IdempotencyKey::new(
            "123".to_string(),
            "456".to_string(),
            Some("789".to_string()),
            1234567890000,
        );
        let key2 = IdempotencyKey::new(
            "124".to_string(),
            "456".to_string(),
            Some("789".to_string()),
            1234567890000,
        );
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_idempotency_key_inequality_different_timestamp_window() {
        // Same message, but different timestamp (different minute)
        let key1 = IdempotencyKey::new(
            "123".to_string(),
            "456".to_string(),
            Some("789".to_string()),
            1234567890000, // minute 20576131
        );
        let key2 = IdempotencyKey::new(
            "123".to_string(),
            "456".to_string(),
            Some("789".to_string()),
            1234567950000, // minute 20576132
        );
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_cache_detects_duplicates() {
        let mut cache = IdempotencyCache::new();

        // First message should not be duplicate
        assert!(!cache.check_and_mark("msg_1", "channel_1", Some("guild_1"), 1234567890000));

        // Same message should be detected as duplicate
        assert!(cache.check_and_mark("msg_1", "channel_1", Some("guild_1"), 1234567890000));

        // Different message should not be duplicate
        assert!(!cache.check_and_mark("msg_2", "channel_1", Some("guild_1"), 1234567890000));

        // Different channel should not be duplicate
        assert!(!cache.check_and_mark("msg_1", "channel_2", Some("guild_1"), 1234567890000));

        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn test_cache_clear() {
        let mut cache = IdempotencyCache::new();

        cache.check_and_mark("msg_1", "channel_1", None, 1234567890000);
        cache.check_and_mark("msg_2", "channel_1", None, 1234567890000);

        assert_eq!(cache.len(), 2);

        cache.clear();

        assert!(cache.is_empty());
        assert!((!cache.check_and_mark("msg_1", "channel_1", None, 1234567890000)));
    }

    #[test]
    fn test_cache_is_empty() {
        let cache = IdempotencyCache::new();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_optional_guild_id() {
        let mut cache = IdempotencyCache::new();

        // Message with guild_id
        assert!(!cache.check_and_mark("msg_1", "channel_1", Some("guild_1"), 1234567890000));

        // Same message without guild_id should not be duplicate (different key)
        assert!(!cache.check_and_mark("msg_1", "channel_1", None, 1234567890000));

        // Same message with same guild_id should be duplicate
        assert!(cache.check_and_mark("msg_1", "channel_1", Some("guild_1"), 1234567890000));
    }
}