//! Jan Integration Service
//!
//! This service bridges Discord bot events directly to Jan's thread/message system.
//! It handles thread creation, message injection, and response queuing.

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use serde_json::json;

use super::super::types::{GatewayMessage, GatewayResponse, Platform, ThreadMapping, NormalizedMessage};
use super::thread_manager::ThreadManager;
use super::message_handler::MessageHandler;

/// Shared Jan integration service type
pub type SharedJanIntegration = Arc<Mutex<JanIntegrationService>>;

/// Jan integration service for bridging messaging platforms to Jan
#[derive(Debug)]
pub struct JanIntegrationService {
    /// Thread manager for thread operations
    pub thread_manager: ThreadManager,
    /// Message handler for message injection
    pub message_handler: MessageHandler,
    /// Pending responses for async processing
    pub pending_responses: Vec<GatewayResponse>,
}

impl Default for JanIntegrationService {
    fn default() -> Self {
        Self::new()
    }
}

impl JanIntegrationService {
    /// Create a new Jan integration service
    pub fn new() -> Self {
        Self {
            thread_manager: ThreadManager::new(),
            message_handler: MessageHandler::new(),
            pending_responses: Vec::new(),
        }
    }

    /// Create a shared Jan integration service
    pub fn create_shared() -> SharedJanIntegration {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Process a gateway message - creates thread if needed and injects message
    /// Returns the Jan thread ID and whether it was newly created
    pub async fn process_message(
        &mut self,
        message: &GatewayMessage,
        auto_create_threads: bool,
        default_assistant_id: Option<&str>,
        app: &AppHandle,
    ) -> Result<(String, bool), String> {
        log::info!(
            "[JanIntegration] Processing message {} from {} channel {}",
            message.id,
            message.platform.as_str(),
            message.channel_id
        );

        // Check for existing thread mapping
        let existing_thread_id = self.thread_manager.get_thread_id(
            message.platform.clone(),
            &message.channel_id,
        );

        let (thread_id, is_new) = match existing_thread_id {
            Some(id) => {
                log::info!("[JanIntegration] Found existing thread {} for channel {}", id, message.channel_id);
                (id, false)
            }
            None if auto_create_threads => {
                // Generate new thread ID (frontend will create the actual thread)
                let new_thread_id = uuid::Uuid::new_v4().to_string();
                log::info!(
                    "[JanIntegration] Auto-creating thread {} for channel {}",
                    new_thread_id,
                    message.channel_id
                );
                (new_thread_id, true)
            }
            None => {
                return Err("Auto-create threads is disabled and no existing thread found".to_string());
            }
        };

        // Create normalized message for Jan
        let normalized = NormalizedMessage {
            id: message.id.clone(),
            source_platform: message.platform.clone(),
            source_user_id: message.user_id.clone(),
            source_channel_id: message.channel_id.clone(),
            text: message.content.clone(),
            mentions: Vec::new(), // TODO: Extract mentions from message
            attachments: Vec::new(), // TODO: Extract attachments from message metadata
            timestamp: message.timestamp,
        };

        // Create Jan message format
        let jan_message = self.message_handler.create_jan_message(
            thread_id.clone(),
            normalized,
        );

        // Emit event for frontend to inject message into Jan thread
        let event_name = format!("gateway:jan:inject");
        let event_payload = json!({
            "thread_id": thread_id,
            "is_new_thread": is_new,
            "message": jan_message,
            "platform": message.platform.as_str(),
            "channel_id": message.channel_id,
            "user_id": message.user_id,
            "message_id": message.id,
            "default_assistant_id": default_assistant_id,
        });

        log::info!("[JanIntegration] Emitting {} event for thread {}", event_name, thread_id);
        let emit_result = app.emit(&event_name, &event_payload);

        if let Err(e) = emit_result {
            log::error!("[JanIntegration] Failed to emit {} event: {}", event_name, e);
            return Err(format!("Failed to emit message injection event: {}", e));
        }

        log::info!(
            "[JanIntegration] ✅ Message {} processed for thread {} (new: {})",
            message.id,
            thread_id,
            is_new
        );

        Ok((thread_id, is_new))
    }

    /// Queue a response to send back to a messaging platform
    pub fn queue_response(&mut self, response: GatewayResponse) {
        let platform_str = response.target_platform.as_str().to_string();
        let channel_id = response.target_channel_id.clone();
        self.pending_responses.push(response);
        log::info!(
            "[JanIntegration] Queued response for {} channel {}, total pending: {}",
            platform_str,
            channel_id,
            self.pending_responses.len()
        );
    }

    /// Get all pending responses
    pub fn get_pending_responses(&self) -> &[GatewayResponse] {
        &self.pending_responses
    }

    /// Clear a specific response (after sending)
    pub fn clear_response(&mut self, message_id: &str) {
        self.pending_responses.retain(|r| {
            r.reply_to.as_ref().map_or(true, |reply_to| reply_to != message_id)
        });
    }

    /// Clear all responses for a channel
    pub fn clear_responses_for_channel(&mut self, channel_id: &str) {
        self.pending_responses.retain(|r| r.target_channel_id != channel_id);
        log::info!("[JanIntegration] Cleared responses for channel {}", channel_id);
    }

    /// Load thread mappings from stored config
    pub fn load_mappings(&mut self, mappings: Vec<ThreadMapping>) {
        self.thread_manager.load_mappings(mappings);
        log::info!("[JanIntegration] Loaded {} thread mappings", self.thread_manager.get_mappings().len());
    }

    /// Get all thread mappings
    pub fn get_mappings(&self) -> &[ThreadMapping] {
        self.thread_manager.get_mappings()
    }

    /// Add a thread mapping (called by frontend after thread creation)
    pub fn add_thread_mapping(&mut self, platform: Platform, external_id: String, thread_id: String) {
        let mapping = ThreadMapping::new(platform, external_id.clone(), thread_id.clone());
        self.thread_manager.add_mapping(mapping);
        log::info!("[JanIntegration] Added thread mapping: {} -> {}", external_id, thread_id);
    }

    /// Find thread for a platform channel
    pub fn find_thread(&self, platform: Platform, channel_id: &str) -> Option<String> {
        self.thread_manager.get_thread_id(platform, channel_id)
    }

    /// Get thread count
    pub fn thread_count(&self, platform: Option<Platform>) -> usize {
        self.thread_manager.thread_count(platform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn test_process_message_existing_thread() {
        let mut service = JanIntegrationService::new();

        // Add a thread mapping
        service.add_thread_mapping(
            Platform::Discord,
            "channel_123".to_string(),
            "thread_abc".to_string(),
        );

        let message = GatewayMessage::new(
            Platform::Discord,
            "user_1".to_string(),
            "channel_123".to_string(),
            "Hello".to_string(),
        );

        // We can't emit without AppHandle, but we can test the logic
        let thread_id = service.thread_manager.get_thread_id(
            Platform::Discord,
            "channel_123",
        );

        assert!(thread_id.is_some());
        assert_eq!(thread_id.unwrap(), "thread_abc");
    }

    #[test]
    fn test_queue_response() {
        let mut service = JanIntegrationService::new();

        let response = GatewayResponse::new(
            Platform::Discord,
            "channel_456".to_string(),
            "Response text".to_string(),
        );

        service.queue_response(response.clone());

        let responses = service.get_pending_responses();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].content, "Response text");
    }

    #[test]
    fn test_clear_responses_for_channel() {
        let mut service = JanIntegrationService::new();

        service.queue_response(GatewayResponse::new(
            Platform::Discord,
            "channel_1".to_string(),
            "Response 1".to_string(),
        ));
        service.queue_response(GatewayResponse::new(
            Platform::Discord,
            "channel_2".to_string(),
            "Response 2".to_string(),
        ));

        assert_eq!(service.get_pending_responses().len(), 2);

        service.clear_responses_for_channel("channel_1");

        assert_eq!(service.get_pending_responses().len(), 1);
        assert_eq!(service.get_pending_responses()[0].target_channel_id, "channel_2");
    }

    #[test]
    fn test_add_thread_mapping() {
        let mut service = JanIntegrationService::new();

        service.add_thread_mapping(
            Platform::Telegram,
            "chat_123".to_string(),
            "thread_xyz".to_string(),
        );

        let thread_id = service.find_thread(Platform::Telegram, "chat_123");
        assert!(thread_id.is_some());
        assert_eq!(thread_id.unwrap(), "thread_xyz");
    }
}