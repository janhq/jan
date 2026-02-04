//! Message Debouncing
//!
//! Groups rapid messages from the same user within a time window to prevent
//! spam and reduce unnecessary agent invocations. Similar to clawdbot's inbound-debounce.ts.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

use super::super::types::GatewayMessage;

/// Debounce configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebounceConfig {
    /// Enable message debouncing
    pub enabled: bool,
    /// Time window in milliseconds to group messages
    pub window_ms: u64,
    /// Maximum messages per window before forcing flush
    pub max_messages: usize,
    /// Whether to flush on @mentions (always process immediately)
    pub flush_on_mention: bool,
    /// Whether to flush on command patterns
    pub flush_on_command: bool,
}

impl Default for DebounceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            window_ms: 500,
            max_messages: 5,
            flush_on_mention: true,
            flush_on_command: true,
        }
    }
}

/// A debounced message batch
#[derive(Debug, Clone)]
pub struct DebouncedBatch {
    /// Key identifying this batch
    pub key: DebounceKey,
    /// Messages in the batch
    pub messages: Vec<GatewayMessage>,
    /// When the batch was created
    pub created_at: Instant,
    /// When the batch expires
    pub expires_at: Instant,
}

impl DebouncedBatch {
    /// Check if batch has expired
    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }

    /// Get message count
    pub fn len(&self) -> usize {
        self.messages.len()
    }

    /// Check if batch is empty
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
}

/// Key for grouping messages (who sent them and where)
#[derive(Debug, Clone)]
pub struct DebounceKey {
    pub platform: String,
    pub channel_id: String,
    pub user_id: String,
}

impl DebounceKey {
    /// Create a new debounce key from a message
    pub fn from_message(message: &GatewayMessage) -> Self {
        Self {
            platform: message.platform.as_str().to_string(),
            channel_id: message.channel_id.clone(),
            user_id: message.user_id.clone(),
        }
    }
}

impl PartialEq for DebounceKey {
    fn eq(&self, other: &Self) -> bool {
        self.platform == other.platform &&
        self.channel_id == other.channel_id &&
        self.user_id == other.user_id
    }
}

impl Eq for DebounceKey {}

impl Hash for DebounceKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.platform.hash(state);
        self.channel_id.hash(state);
        self.user_id.hash(state);
    }
}

/// Debounce statistics
#[derive(Debug, Default, Clone)]
pub struct DebounceStats {
    pub total_received: u64,
    pub total_flushed: u64,
    pub batches_created: u64,
    pub batches_expired: u64,
    pub messages_merged: u64,
}

/// Message debouncer service
#[derive(Debug)]
pub struct MessageDebouncer {
    /// Configuration
    config: Arc<Mutex<DebounceConfig>>,
    /// Active batches grouped by user/channel
    batches: Arc<Mutex<HashMap<DebounceKey, DebouncedBatch>>>,
    /// Statistics
    stats: Arc<Mutex<DebounceStats>>,
    /// Cleanup interval handle
    cleanup_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl Default for MessageDebouncer {
    fn default() -> Self {
        Self::new(DebounceConfig::default())
    }
}

impl MessageDebouncer {
    /// Create a new message debouncer
    pub fn new(config: DebounceConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            batches: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(Mutex::new(DebounceStats::default())),
            cleanup_task: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the cleanup task
    pub async fn start(&self) {
        let batches = self.batches.clone();
        let stats = self.stats.clone();
        let config = self.config.clone();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                let expired: Vec<DebounceKey> = {
                    let guard = batches.lock().await;
                    guard.iter()
                        .filter(|(_, batch)| batch.is_expired())
                        .map(|(key, _)| key.clone())
                        .collect()
                };

                for key in expired {
                    let mut guard = batches.lock().await;
                    if guard.remove(&key).is_some() {
                        let mut stats = stats.lock().await;
                        stats.batches_expired += 1;
                    }
                }
            }
        });

        let mut task = self.cleanup_task.lock().await;
        *task = Some(handle);
    }

    /// Stop the cleanup task
    pub async fn stop(&self) {
        let mut task = self.cleanup_task.lock().await;
        if let Some(handle) = task.take() {
            handle.abort();
        }
    }

    /// Process a message through the debouncer
    /// Returns Some(batch) if the message should be processed now, None if batched
    pub async fn process(&self, message: &GatewayMessage) -> Option<DebouncedBatch> {
        let config = self.config.lock().await;
        if !config.enabled {
            return Some(DebouncedBatch {
                key: DebounceKey::from_message(message),
                messages: vec![message.clone()],
                created_at: Instant::now(),
                expires_at: Instant::now() + Duration::from_millis(config.window_ms),
            });
        }

        // Check if we should flush immediately
        if self.should_flush_immediately(message, &config).await {
            // Return the batch with just this message
            return Some(DebouncedBatch {
                key: DebounceKey::from_message(message),
                messages: vec![message.clone()],
                created_at: Instant::now(),
                expires_at: Instant::now() + Duration::from_millis(config.window_ms),
            });
        }

        let key = DebounceKey::from_message(message);
        let window = Duration::from_millis(config.window_ms);
        let now = Instant::now();

        // Get or create batch and get mutable access
        let batch_messages_len: usize = {
            let mut guard = self.batches.lock().await;
            let batch = guard
                .entry(key.clone())
                .or_insert_with_key(|_| DebouncedBatch {
                    key: key.clone(),
                    messages: Vec::new(),
                    created_at: now,
                    expires_at: now + window,
                });

            // Add message to batch
            batch.messages.push(message.clone());
            batch.messages.len()
        };

        {
            let mut stats = self.stats.lock().await;
            stats.total_received += 1;
        }

        // Check if we should flush (need to reacquire lock)
        if batch_messages_len >= config.max_messages {
            let messages: Vec<GatewayMessage> = {
                let mut guard = self.batches.lock().await;
                if let Some(batch) = guard.remove(&key) {
                    let msgs = batch.messages.clone();
                    {
                        let mut stats = self.stats.lock().await;
                        stats.total_flushed += 1;
                        stats.messages_merged += (msgs.len().saturating_sub(1)) as u64;
                    }
                    msgs
                } else {
                    Vec::new()
                }
            };

            if !messages.is_empty() {
                return Some(DebouncedBatch {
                    key,
                    messages,
                    created_at: now,
                    expires_at: now + window,
                });
            }
        }

        None
    }

    /// Check if message should trigger immediate flush
    async fn should_flush_immediately(&self, message: &GatewayMessage, config: &DebounceConfig) -> bool {
        let text = &message.content;

        // Flush on @mentions
        if config.flush_on_mention {
            if let Some(mentions) = message.metadata.get("mentions") {
                if mentions.is_array() && !mentions.as_array().unwrap().is_empty() {
                    return true;
                }
            }
            // Check for mention patterns in text
            if text.contains("<@") || text.contains("@") {
                return true;
            }
        }

        // Flush on command patterns
        if config.flush_on_command {
            let trimmed = text.trim();
            if trimmed.starts_with('/') || trimmed.starts_with('!') || trimmed.starts_with('.') {
                return true;
            }
        }

        false
    }

    /// Force flush all pending batches
    pub async fn flush_all(&self) -> Vec<DebouncedBatch> {
        let mut guard = self.batches.lock().await;
        let mut batches = Vec::new();
        let mut stats = self.stats.lock().await;

        for (_, batch) in guard.drain() {
            if !batch.is_empty() {
                batches.push(batch);
                stats.total_flushed += 1;
            }
        }

        batches
    }

    /// Get statistics
    pub async fn get_stats(&self) -> DebounceStats {
        self.stats.lock().await.clone()
    }

    /// Update configuration
    pub async fn set_config(&self, config: DebounceConfig) {
        let mut guard = self.config.lock().await;
        *guard = config;
    }

    /// Get current configuration
    pub async fn get_config(&self) -> DebounceConfig {
        self.config.lock().await.clone()
    }
}

/// Combine multiple messages into a single text
pub fn combine_messages(messages: &[GatewayMessage]) -> String {
    if messages.is_empty() {
        return String::new();
    }

    if messages.len() == 1 {
        return messages[0].content.clone();
    }

    // Take first message, append "and X more" indicator
    let first = &messages[0].content;
    let count = messages.len() - 1;

    if count == 1 {
        format!("{} {}", first, messages[1].content.trim())
    } else {
        format!("{} (and {} more messages)", first.trim(), count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_message(content: &str) -> GatewayMessage {
        GatewayMessage {
            id: uuid::Uuid::new_v4().to_string(),
            platform: super::super::super::types::Platform::Discord,
            user_id: "U123456".to_string(),
            channel_id: "C789012".to_string(),
            guild_id: Some("G345678".to_string()),
            content: content.to_string(),
            timestamp: 0,
            metadata: std::collections::HashMap::new(),
            protocol_version: "1.0".to_string(),
        }
    }

    #[tokio::test]
    async fn test_single_message() {
        let debouncer = MessageDebouncer::new(DebounceConfig::default());
        let message = create_test_message("Hello");

        let result = debouncer.process(&message).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().messages.len(), 1);
    }

    #[tokio::test]
    async fn test_debounce_multiple() {
        let config = DebounceConfig {
            enabled: true,
            window_ms: 1000,
            max_messages: 10,
            flush_on_mention: true,
            flush_on_command: true,
        };
        let debouncer = MessageDebouncer::new(config);

        let messages: Vec<GatewayMessage> = (0..3)
            .map(|i| create_test_message(&format!("Message {}", i)))
            .collect();

        // First message should not return immediately (batched)
        let result1 = debouncer.process(&messages[0]).await;
        assert!(result1.is_none());

        // Second message also batched
        let result2 = debouncer.process(&messages[1]).await;
        assert!(result2.is_none());

        // Third message triggers batch
        let result3 = debouncer.process(&messages[2]).await;
        assert!(result3.is_some());
        assert_eq!(result3.unwrap().messages.len(), 3);
    }

    #[tokio::test]
    async fn test_flush_on_mention() {
        let config = DebounceConfig {
            enabled: true,
            window_ms: 1000,
            max_messages: 10,
            flush_on_mention: true,
            flush_on_command: false,
        };
        let debouncer = MessageDebouncer::new(config);

        let mut message = create_test_message("Hey <@123456>");
        message.metadata.insert("mentions".to_string(), serde_json::json!([{"id": "123456"}]));

        let result = debouncer.process(&message).await;
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn test_combine_messages() {
        let messages: Vec<GatewayMessage> = (0..3)
            .map(|i| create_test_message(&format!("Message {}", i)))
            .collect();

        let combined = combine_messages(&messages);
        assert!(combined.contains("Message 0"));
        assert!(combined.contains("2 more messages"));
    }

    #[tokio::test]
    async fn test_flush_all() {
        let debouncer = MessageDebouncer::new(DebounceConfig::default());
        let message = create_test_message("Test");

        let _ = debouncer.process(&message).await;
        let batches = debouncer.flush_all().await;

        assert_eq!(batches.len(), 1);
    }
}