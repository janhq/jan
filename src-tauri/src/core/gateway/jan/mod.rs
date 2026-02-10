//! Jan integration module
//!
//! This module provides integration between the gateway and Jan's chat system.
//! Messages are emitted as events to the frontend for processing via Tauri commands.
#![allow(dead_code)]

pub mod thread_manager;
pub mod message_handler;
pub mod integration_service;

pub use thread_manager::ThreadManager;
pub use message_handler::MessageHandler;
pub use integration_service::{JanIntegrationService, SharedJanIntegration};

use super::types::{NormalizedMessage, GatewayResponse, Platform, ThreadMapping};

/// Main Jan integration coordinator
#[derive(Debug, Default)]
pub struct JanIntegration {
    /// Thread manager for thread operations
    pub thread_manager: ThreadManager,
    /// Message handler for message injection
    pub message_handler: MessageHandler,
}

impl JanIntegration {
    /// Create a new Jan integration
    pub fn new() -> Self {
        Self {
            thread_manager: ThreadManager::new(),
            message_handler: MessageHandler::new(),
        }
    }

    /// Process a normalized message - emit event for frontend to handle
    /// Returns the message that should be emitted
    pub fn prepare_message_for_processing(
        &mut self,
        message: NormalizedMessage,
        auto_create_threads: bool,
        _default_assistant_id: Option<&str>,
    ) -> Result<(String, bool, NormalizedMessage), String> {
        // Check for existing thread
        let thread_id = self.thread_manager.get_thread_id(
            message.source_platform.clone(),
            &message.source_channel_id,
        );

        let (thread_id, is_new) = match thread_id {
            Some(id) => (id, false),
            None if auto_create_threads => {
                // New thread will be created by frontend
                let new_id = uuid::Uuid::new_v4().to_string();
                (new_id, true)
            }
            None => {
                return Err("Auto-create threads is disabled and no existing thread found".to_string());
            }
        };

        Ok((thread_id, is_new, message))
    }

    /// Queue a response to send back to a messaging platform
    pub fn queue_response(&mut self, response: GatewayResponse) {
        self.message_handler.queue_response(response);
    }

    /// Get all pending responses
    pub fn get_pending_responses(&self) -> &[GatewayResponse] {
        self.message_handler.get_all_responses()
    }

    /// Load thread mappings from storage
    pub fn load_mappings(&mut self, mappings: Vec<ThreadMapping>) {
        self.thread_manager.load_mappings(mappings);
    }

    /// Get all thread mappings
    pub fn get_mappings(&self) -> &[ThreadMapping] {
        self.thread_manager.get_mappings()
    }

    /// Add a thread mapping (called by frontend after thread creation)
    pub fn add_thread_mapping(&mut self, platform: Platform, external_id: String, thread_id: String) {
        let mapping = ThreadMapping::new(platform, external_id, thread_id);
        self.thread_manager.add_mapping(mapping);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_prepare_message_existing_thread() {
        let mut integration = JanIntegration::new();

        // Add a thread mapping
        integration.thread_manager.add_mapping(ThreadMapping::new(
            Platform::Discord,
            "channel_123".to_string(),
            "thread_abc".to_string(),
        ));

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

        let result = integration.prepare_message_for_processing(message, true, None);
        assert!(result.is_ok());
        let (thread_id, is_new, _) = result.unwrap();
        assert_eq!(thread_id, "thread_abc");
        assert!(!is_new);
    }

    #[tokio::test]
    async fn test_prepare_message_new_thread() {
        let mut integration = JanIntegration::new();

        let message = NormalizedMessage {
            id: "msg_1".to_string(),
            source_platform: Platform::Slack,
            source_user_id: "user_1".to_string(),
            source_channel_id: "new_channel".to_string(),
            text: "Hello".to_string(),
            mentions: vec![],
            attachments: vec![],
            timestamp: 1234567890,
        };

        let result = integration.prepare_message_for_processing(message, true, None);
        assert!(result.is_ok());
        let (thread_id, is_new, _) = result.unwrap();
        assert!(!thread_id.is_empty());
        assert!(is_new);
    }

    #[test]
    fn test_queue_response() {
        let mut integration = JanIntegration::new();

        let response = GatewayResponse::new(
            Platform::Telegram,
            "chat_456".to_string(),
            "Response text".to_string(),
        );

        integration.queue_response(response);

        let responses = integration.get_pending_responses();
        assert_eq!(responses.len(), 1);
    }
}