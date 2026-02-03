use std::sync::Arc;
use tokio::sync::Mutex;

use crate::core::gateway::types::{NormalizedMessage, Platform, ThreadMapping};

/// Thread manager for gateway-related thread operations
#[derive(Debug, Default)]
pub struct ThreadManager {
    /// In-memory thread mappings
    mappings: Vec<ThreadMapping>,
}

impl ThreadManager {
    /// Create a new thread manager
    pub fn new() -> Self {
        Self {
            mappings: Vec::new(),
        }
    }

    /// Load mappings from storage
    pub fn load_mappings(&mut self, mappings: Vec<ThreadMapping>) {
        self.mappings = mappings;
    }

    /// Get all mappings
    pub fn get_mappings(&self) -> &[ThreadMapping] {
        &self.mappings
    }

    /// Find existing thread for a platform channel
    pub fn find_thread(&self, platform: Platform, channel_id: &str) -> Option<&ThreadMapping> {
        self.mappings.iter().find(|m| {
            m.platform == platform && m.external_id == channel_id
        })
    }

    /// Get thread ID for a platform channel
    pub fn get_thread_id(&self, platform: Platform, channel_id: &str) -> Option<String> {
        self.find_thread(platform, channel_id)
            .map(|m| m.jan_thread_id.clone())
    }

    /// Add a new thread mapping (called after frontend creates thread)
    pub fn add_mapping(&mut self, mapping: ThreadMapping) {
        // Remove existing mapping for same platform/channel
        self.mappings.retain(|m| {
            !(m.platform == mapping.platform && m.external_id == mapping.external_id)
        });
        self.mappings.push(mapping);
    }

    /// Remove a thread mapping
    pub fn remove_mapping(&mut self, platform: Platform, channel_id: &str) -> bool {
        let initial_len = self.mappings.len();
        self.mappings.retain(|m| {
            !(m.platform == platform && m.external_id == channel_id)
        });
        self.mappings.len() != initial_len
    }

    /// Get thread count for a platform
    pub fn thread_count(&self, platform: Option<Platform>) -> usize {
        match platform {
            Some(p) => self.mappings.iter().filter(|m| m.platform == p).count(),
            None => self.mappings.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_existing_thread() {
        let mut manager = ThreadManager::new();
        let mapping = ThreadMapping::new(
            Platform::Discord,
            "channel_123".to_string(),
            "thread_abc".to_string(),
        );
        manager.add_mapping(mapping);

        let found = manager.find_thread(Platform::Discord, "channel_123");
        assert!(found.is_some());
        assert_eq!(found.unwrap().jan_thread_id, "thread_abc");
    }

    #[test]
    fn test_get_thread_id() {
        let mut manager = ThreadManager::new();
        manager.add_mapping(ThreadMapping::new(
            Platform::Slack,
            "channel_x".to_string(),
            "thread_1".to_string(),
        ));

        let thread_id = manager.get_thread_id(Platform::Slack, "channel_x");
        assert!(thread_id.is_some());
        assert_eq!(thread_id.unwrap(), "thread_1");
    }

    #[test]
    fn test_add_mapping_replaces_existing() {
        let mut manager = ThreadManager::new();
        manager.add_mapping(ThreadMapping::new(
            Platform::Telegram,
            "chat_123".to_string(),
            "thread_1".to_string(),
        ));
        manager.add_mapping(ThreadMapping::new(
            Platform::Telegram,
            "chat_123".to_string(),
            "thread_2".to_string(),
        ));

        assert_eq!(manager.thread_count(None), 1);
        assert_eq!(manager.get_thread_id(Platform::Telegram, "chat_123").unwrap(), "thread_2");
    }
}