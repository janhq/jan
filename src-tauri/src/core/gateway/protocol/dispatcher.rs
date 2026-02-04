//! Event Dispatcher
//!
//! Broadcasts events to subscribed WebSocket clients.
//! Handles event sequencing and delivery guarantees.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::frames::EventFrame;
use super::SubscriptionManager;

/// Event dispatcher configuration
#[derive(Debug, Clone, Default)]
pub struct EventDispatcherConfig {
    /// Maximum events to buffer per client
    pub max_buffer_size: usize,
}

/// Client subscription state
#[derive(Debug, Clone, Default)]
struct ClientSubscription {
    /// Event channels the client is subscribed to
    subscriptions: HashMap<String, bool>,
    /// Buffered events for this client
    event_buffer: Vec<CachedEvent>,
}

/// Cached event for replay
#[derive(Debug, Clone)]
struct CachedEvent {
    seq: u64,
    event: EventFrame,
    cached_at: u64,
}

/// Event dispatcher for broadcasting to subscribers
#[derive(Debug, Default)]
pub struct EventDispatcher {
    /// Subscription manager
    subscriptions: Arc<SubscriptionManager>,
    /// Client subscriptions (per client_id)
    client_subscriptions: Arc<Mutex<HashMap<String, ClientSubscription>>>,
    /// Current event sequence
    sequence: Arc<Mutex<u64>>,
}

impl EventDispatcher {
    /// Create a new event dispatcher
    pub fn new(subscriptions: Arc<SubscriptionManager>, config: Option<EventDispatcherConfig>) -> Self {
        Self {
            subscriptions,
            client_subscriptions: Arc::new(Mutex::new(HashMap::new())),
            sequence: Arc::new(Mutex::new(0)),
        }
    }

    /// Register a new client connection
    pub async fn register_client(&self, client_id: &str) {
        let mut subs = self.client_subscriptions.lock().await;
        subs.insert(client_id.to_string(), ClientSubscription::default());
    }

    /// Unregister a client connection
    pub async fn unregister_client(&self, client_id: &str) {
        let mut subs = self.client_subscriptions.lock().await;
        subs.remove(client_id);
    }

    /// Subscribe a client to an event type
    pub async fn subscribe(&self, client_id: &str, event_type: impl Into<String>) {
        let event = event_type.into();
        let mut subs = self.client_subscriptions.lock().await;

        if let Some(client) = subs.get_mut(client_id) {
            client.subscriptions.insert(event, true);
        }
    }

    /// Unsubscribe a client from an event type
    pub async fn unsubscribe(&self, client_id: &str, event_type: impl Into<String>) {
        let event = event_type.into();
        let mut subs = self.client_subscriptions.lock().await;

        if let Some(client) = subs.get_mut(client_id) {
            client.subscriptions.insert(event, false);
        }
    }

    /// Get buffered events since a sequence number
    pub async fn get_events_since(&self, client_id: &str, since_seq: u64) -> Vec<EventFrame> {
        let subs = self.client_subscriptions.lock().await;

        if let Some(client) = subs.get(client_id) {
            client.event_buffer
                .iter()
                .filter(|e| e.seq > since_seq)
                .map(|e| e.event.clone())
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Get subscription status for a client
    pub async fn get_subscription_status(&self, client_id: &str) -> Option<HashMap<String, bool>> {
        let subs = self.client_subscriptions.lock().await;
        subs.get(client_id).map(|c| c.subscriptions.clone())
    }

    /// Get the number of active subscriptions
    pub async fn get_subscription_count(&self) -> usize {
        self.client_subscriptions.lock().await.len()
    }
}