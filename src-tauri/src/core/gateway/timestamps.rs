//! Timestamp Injection Module
//!
//! Tracks timing at each stage of message processing and injects
//! timestamps into messages for debugging and performance monitoring.

use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Timestamp record for tracking processing stages
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimestampRecord {
    /// When message was received (in milliseconds)
    pub received_at: u64,
    /// When message was queued for processing
    pub queued_at: Option<u64>,
    /// When message was routed to agent
    pub routed_at: Option<u64>,
    /// When agent started processing
    pub agent_started_at: Option<u64>,
    /// When agent finished processing
    pub agent_completed_at: Option<u64>,
    /// When response was sent
    pub response_sent_at: Option<u64>,
    /// Total latency in ms
    pub total_latency_ms: Option<u64>,
    /// Platform-specific processing time
    pub platform_latency_ms: Option<u64>,
    /// Agent processing time
    pub agent_latency_ms: Option<u64>,
}

/// Injectable timestamps field name
pub const TIMESTAMPS_FIELD: &str = "_timestamps";

/// Timestamp injection service
#[derive(Debug, Default)]
pub struct TimestampInjector {
    /// Enable timestamp injection
    enabled: Arc<Mutex<bool>>,
    /// Include detailed breakdown
    detailed: Arc<Mutex<bool>>,
    /// Maximum timestamp fields to keep
    max_history: Arc<Mutex<usize>>,
}

impl TimestampInjector {
    /// Create a new timestamp injector
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(Mutex::new(true)),
            detailed: Arc::new(Mutex::new(true)),
            max_history: Arc::new(Mutex::new(10)),
        }
    }

    /// Create a new timestamp record with received time
    pub fn create_record() -> TimestampRecord {
        TimestampRecord {
            received_at: chrono::Utc::now().timestamp_millis() as u64,
            ..Default::default()
        }
    }

    /// Mark message as queued
    pub async fn mark_queued(&self, record: &mut TimestampRecord) {
        if !*self.enabled.lock().await {
            return;
        }
        record.queued_at = Some(chrono::Utc::now().timestamp_millis() as u64);
    }

    /// Mark message as routed
    pub async fn mark_routed(&self, record: &mut TimestampRecord) {
        if !*self.enabled.lock().await {
            return;
        }
        record.routed_at = Some(chrono::Utc::now().timestamp_millis() as u64);
    }

    /// Mark agent processing started
    pub async fn mark_agent_started(&self, record: &mut TimestampRecord) {
        if !*self.enabled.lock().await {
            return;
        }
        record.agent_started_at = Some(chrono::Utc::now().timestamp_millis() as u64);
    }

    /// Mark agent processing completed
    pub async fn mark_agent_completed(&self, record: &mut TimestampRecord) {
        if !*self.enabled.lock().await {
            return;
        }
        record.agent_completed_at = Some(chrono::Utc::now().timestamp_millis() as u64);
    }

    /// Mark response sent
    pub async fn mark_response_sent(&self, record: &mut TimestampRecord) {
        if !*self.enabled.lock().await {
            return;
        }
        record.response_sent_at = Some(chrono::Utc::now().timestamp_millis() as u64);

        // Calculate latencies
        if record.received_at > 0 {
            record.total_latency_ms = Some(record.response_sent_at.unwrap_or(0) - record.received_at);
        }

        if let (Some(routed), Some(completed)) = (record.routed_at, record.agent_completed_at) {
            record.agent_latency_ms = Some(completed - routed);
        }

        if let (Some(received), Some(routed)) = (record.received_at, record.routed_at) {
            record.platform_latency_ms = Some(routed - received);
        }
    }

    /// Inject timestamps into a message payload
    pub async fn inject(&self, payload: &mut Value, record: &TimestampRecord) {
        if !*self.enabled.lock().await {
            return;
        }

        let timestamps = serde_json::json!(record);

        match payload {
            Value::Object(map) => {
                map.insert(TIMESTAMPS_FIELD.to_string(), timestamps);
            }
            _ => {
                // Wrap in an object with timestamps
                let new_payload = serde_json::json!({
                    "data": payload,
                    TIMESTAMPS_FIELD: timestamps
                });
                *payload = new_payload;
            }
        }
    }

    /// Extract timestamps from a payload
    pub async fn extract(&self, payload: &Value) -> Option<TimestampRecord> {
        if let Value::Object(map) = payload {
            if let Some(ts_field) = map.get(TIMESTAMPS_FIELD) {
                return Some(serde_json::from_value(ts_field.clone()).ok().unwrap_or_default());
            }
        }
        None
    }

    /// Enable/disable timestamp injection
    pub async fn set_enabled(&self, enabled: bool) {
        let mut guard = self.enabled.lock().await;
        *guard = enabled;
    }

    /// Check if enabled
    pub async fn is_enabled(&self) -> bool {
        *self.enabled.lock().await
    }

    /// Enable/disable detailed breakdown
    pub async fn set_detailed(&self, detailed: bool) {
        let mut guard = self.detailed.lock().await;
        *guard = detailed;
    }

    /// Check if detailed mode is enabled
    pub async fn is_detailed(&self) -> bool {
        *self.detailed.lock().await
    }

    /// Get a formatted latency string
    pub fn format_latency(record: &TimestampRecord) -> String {
        let total = record.total_latency_ms.unwrap_or(0);

        if total == 0 {
            return "0ms".to_string();
        }

        if total < 1000 {
            format!("{}ms", total)
        } else if total < 60000 {
            format!("{:.1}s", total as f64 / 1000.0)
        } else {
            format!("{:.1}m", total as f64 / 60000.0)
        }
    }
}

/// Message timing context passed through the pipeline
#[derive(Debug, Clone)]
pub struct TimingContext {
    /// Current timestamp record
    pub timestamps: TimestampRecord,
    /// Stage we're currently in
    pub current_stage: TimingStage,
    /// Metadata about the message
    pub metadata: std::collections::HashMap<String, Value>,
}

impl Default for TimingContext {
    fn default() -> Self {
        Self {
            timestamps: TimestampInjector::create_record(),
            current_stage: TimingStage::Received,
            metadata: std::collections::HashMap::new(),
        }
    }
}

impl TimingContext {
    /// Create a new timing context
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark as queued
    pub fn queued(mut self) -> Self {
        self.timestamps.queued_at = Some(chrono::Utc::now().timestamp_millis() as u64);
        self.current_stage = TimingStage::Queued;
        self
    }

    /// Mark as routed
    pub fn routed(mut self) -> Self {
        self.timestamps.routed_at = Some(chrono::Utc::now().timestamp_millis() as u64);
        self.current_stage = TimingStage::Routed;
        self
    }

    /// Mark agent started
    pub fn agent_started(mut self) -> Self {
        self.timestamps.agent_started_at = Some(chrono::Utc::now().timestamp_millis() as u64);
        self.current_stage = TimingStage::AgentProcessing;
        self
    }

    /// Mark agent completed
    pub fn agent_completed(mut self) -> Self {
        self.timestamps.agent_completed_at = Some(chrono::Utc::now().timestamp_millis() as u64);
        self.current_stage = TimingStage::Completed;
        self
    }

    /// Mark response sent
    pub fn response_sent(mut self) -> Self {
        self.timestamps.response_sent_at = Some(chrono::Utc::now().timestamp_millis() as u64);

        // Calculate final latencies
        if self.timestamps.received_at > 0 {
            self.timestamps.total_latency_ms = Some(
                self.timestamps.response_sent_at.unwrap_or(0) - self.timestamps.received_at
            );
        }

        if let (Some(routed), Some(completed)) = (
            self.timestamps.routed_at,
            self.timestamps.agent_completed_at
        ) {
            self.timestamps.agent_latency_ms = Some(completed - routed);
        }

        self.current_stage = TimingStage::Sent;
        self
    }

    /// Get formatted latency string
    pub fn latency_string(&self) -> String {
        TimestampInjector::format_latency(&self.timestamps)
    }

    /// Add metadata
    pub fn with_metadata(mut self, key: &str, value: Value) -> Self {
        self.metadata.insert(key.to_string(), value);
        self
    }
}

/// Processing stages for timing
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimingStage {
    /// Message received
    Received,
    /// Message queued for processing
    Queued,
    /// Message routed to agent
    Routed,
    /// Agent processing
    AgentProcessing,
    /// Agent completed, response pending
    Completed,
    /// Response sent
    Sent,
}

impl std::fmt::Display for TimingStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimingStage::Received => write!(f, "received"),
            TimingStage::Queued => write!(f, "queued"),
            TimingStage::Routed => write!(f, "routed"),
            TimingStage::AgentProcessing => write!(f, "agent_processing"),
            TimingStage::Completed => write!(f, "completed"),
            TimingStage::Sent => write!(f, "sent"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_timestamp_recording() {
        let injector = TimestampInjector::new();
        let mut record = TimestampInjector::create_record();

        assert_eq!(record.received_at, 0); // Will be set by create_record

        // Mark different stages
        injector.mark_queued(&mut record).await;
        injector.mark_routed(&mut record).await;
        injector.mark_agent_started(&mut record).await;
        injector.mark_agent_completed(&mut record).await;
        injector.mark_response_sent(&mut record).await;

        assert!(record.queued_at.is_some());
        assert!(record.routed_at.is_some());
        assert!(record.agent_started_at.is_some());
        assert!(record.agent_completed_at.is_some());
        assert!(record.response_sent_at.is_some());
        assert!(record.total_latency_ms.is_some());
    }

    #[tokio::test]
    async fn test_inject_timestamps() {
        let injector = TimestampInjector::new();
        let mut payload = serde_json::json!({
            "message": "Hello"
        });

        let record = TimestampRecord {
            received_at: 1000,
            response_sent_at: 2500,
            total_latency_ms: Some(1500),
            ..Default::default()
        };

        injector.inject(&mut payload, &record).await;

        if let Value::Object(map) = &payload {
            assert!(map.contains_key("_timestamps"));
            let timestamps = map.get("_timestamps").unwrap();
            assert_eq!(timestamps.get("received_at").unwrap(), 1000);
        }
    }

    #[test]
    fn test_format_latency() {
        let tests = vec![
            (0, "0ms"),
            (500, "500ms"),
            (999, "999ms"),
            (1000, "1.0s"),
            (2500, "2.5s"),
            (60000, "1.0m"),
            (90000, "1.5m"),
        ];

        for (ms, expected) in tests {
            let record = TimestampRecord {
                total_latency_ms: Some(ms),
                ..Default::default()
            };
            assert_eq!(TimestampInjector::format_latency(&record), expected);
        }
    }

    #[tokio::test]
    async fn test_disable_injection() {
        let injector = TimestampInjector::new();

        // Disable injection
        injector.set_enabled(false).await;

        let mut payload = serde_json::json!({"test": "value"});
        let record = TimestampRecord::default();

        injector.inject(&mut payload, &record).await;

        // Payload should not have been modified
        assert!(!payload.as_object().unwrap().contains_key("_timestamps"));
    }

    #[tokio::test]
    async fn test_timing_context() {
        let ctx = TimingContext::new()
            .queued()
            .routed()
            .agent_started()
            .agent_completed()
            .response_sent();

        assert!(ctx.timestamps.total_latency_ms.is_some());
        assert!(ctx.timestamps.agent_latency_ms.is_some());
        assert!(ctx.timestamps.platform_latency_ms.is_some());
    }

    #[tokio::test]
    async fn test_extract_timestamps() {
        let injector = TimestampInjector::new();

        let payload = serde_json::json!({
            "data": "test",
            "_timestamps": {
                "receivedAt": 1000,
                "responseSentAt": 2500,
                "totalLatencyMs": 1500
            }
        });

        let record = injector.extract(&payload).await.unwrap();
        assert_eq!(record.received_at, 1000);
        assert_eq!(record.response_sent_at.unwrap_or(0), 2500);
        assert_eq!(record.total_latency_ms.unwrap_or(0), 1500);
    }
}