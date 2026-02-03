use super::super::types::{NormalizedMessage, Platform, ThreadMapping};

/// Routing decision for a message
#[derive(Debug, Clone)]
pub struct RoutingDecision {
    /// Whether to create a new thread
    pub create_new_thread: bool,
    /// The thread ID to use (existing or new)
    pub thread_id: String,
    /// Title for the new thread (if creating)
    pub thread_title: Option<String>,
    /// Assistant ID to use (if specified)
    pub assistant_id: Option<String>,
}

/// Thread router for deciding where messages go
#[derive(Debug, Default)]
pub struct ThreadRouter {
    /// In-memory thread mappings
    mappings: Vec<ThreadMapping>,
}

impl ThreadRouter {
    /// Create a new router
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

    /// Decide where to route a message
    pub fn route(
        &self,
        message: &NormalizedMessage,
        _auto_create_threads: bool,
        default_assistant_id: Option<&str>,
    ) -> RoutingDecision {
        // Check for existing thread mapping
        if let Some(mapping) = self.find_thread(message.source_platform.clone(), &message.source_channel_id) {
            return RoutingDecision {
                create_new_thread: false,
                thread_id: mapping.jan_thread_id.clone(),
                thread_title: None,
                assistant_id: None,
            };
        }

        // Need to create a new thread
        let thread_title = Some(format!(
            "{} - {}",
            message.source_platform.as_str().to_uppercase(),
            message.source_channel_id
        ));

        RoutingDecision {
            create_new_thread: true,
            thread_id: uuid::Uuid::new_v4().to_string(),
            thread_title,
            assistant_id: default_assistant_id.map(|s| s.to_string()),
        }
    }

    /// Add a new thread mapping
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
    fn test_route_existing_thread() {
        let router = ThreadRouter::new();
        let mapping = ThreadMapping::new(
            Platform::Discord,
            "channel_123".to_string(),
            "thread_abc".to_string(),
        );
        router.add_mapping(mapping);

        let message = NormalizedMessage {
            id: "msg_1".to_string(),
            source_platform: Platform::Discord,
            source_user_id: "user_1".to_string(),
            source_channel_id: "channel_123".to_string(),
            text: "Hello".to_string(),
            mentions: vec![],
            attachments: vec![],
            timestamp: 1234567890,
        };

        let decision = router.route(&message, true, None);
        assert!(!decision.create_new_thread);
        assert_eq!(decision.thread_id, "thread_abc");
    }

    #[test]
    fn test_route_new_thread() {
        let router = ThreadRouter::new();

        let message = NormalizedMessage {
            id: "msg_1".to_string(),
            source_platform: Platform::Discord,
            source_user_id: "user_1".to_string(),
            source_channel_id: "new_channel".to_string(),
            text: "Hello".to_string(),
            mentions: vec![],
            attachments: vec![],
            timestamp: 1234567890,
        };

        let decision = router.route(&message, true, None);
        assert!(decision.create_new_thread);
        assert!(decision.thread_title.is_some());
        assert!(decision.thread_id.starts_with(uuid::Uuid::nil().to_string())); // UUID format
    }

    #[test]
    fn test_route_no_auto_create() {
        let router = ThreadRouter::new();

        let message = NormalizedMessage {
            id: "msg_1".to_string(),
            source_platform: Platform::Discord,
            source_user_id: "user_1".to_string(),
            source_channel_id: "new_channel".to_string(),
            text: "Hello".to_string(),
            mentions: vec![],
            attachments: vec![],
            timestamp: 1234567890,
        };

        let decision = router.route(&message, false, None);
        // With auto_create_threads=false, should still route to new thread
        // but caller should handle the rejection
        assert!(decision.create_new_thread);
    }

    #[test]
    fn test_add_and_remove_mapping() {
        let mut router = ThreadRouter::new();

        let mapping = ThreadMapping::new(
            Platform::Slack,
            "channel_x".to_string(),
            "thread_1".to_string(),
        );
        router.add_mapping(mapping.clone());

        assert_eq!(router.thread_count(Some(Platform::Slack)), 1);
        assert!(router.find_thread(Platform::Slack, "channel_x").is_some());

        let removed = router.remove_mapping(Platform::Slack, "channel_x");
        assert!(removed);
        assert_eq!(router.thread_count(Some(Platform::Slack)), 0);
    }

    #[test]
    fn test_thread_count() {
        let mut router = ThreadRouter::new();

        router.add_mapping(ThreadMapping::new(Platform::Discord, "ch1".to_string(), "t1".to_string()));
        router.add_mapping(ThreadMapping::new(Platform::Discord, "ch2".to_string(), "t2".to_string()));
        router.add_mapping(ThreadMapping::new(Platform::Slack, "ch3".to_string(), "t3".to_string()));

        assert_eq!(router.thread_count(None), 3);
        assert_eq!(router.thread_count(Some(Platform::Discord)), 2);
        assert_eq!(router.thread_count(Some(Platform::Slack)), 1);
        assert_eq!(router.thread_count(Some(Platform::Telegram)), 0);
    }
}