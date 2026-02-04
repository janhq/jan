//! Gateway Protocol Module
//!
//! Implements a WebSocket-based protocol with request/response/event frames,
//! similar to clawdbot's JSON frame protocol.
//!
//! Frame Types:
//! - RequestFrame: Client requests to the server
//! - ResponseFrame: Server responses to requests
//! - EventFrame: Server-initiated events to subscribed clients

pub mod frames;
pub mod codec;
pub mod handler;
pub mod dispatcher;

use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::core::gateway::types::Platform;

pub use frames::{RequestFrame, ResponseFrame, EventFrame, ErrorShape, Payload};
pub use codec::{ProtocolCodec, MessageType};
pub use handler::{ProtocolHandler, ProtocolContext, MethodHandler};

/// Generate a new correlation ID for request/response matching
pub fn generate_correlation_id() -> String {
    Uuid::new_v4().to_string()
}

/// Protocol version
pub const PROTOCOL_VERSION: &str = "1.0.0";

/// Subscription to platform events
#[derive(Debug, Clone)]
pub struct PlatformSubscription {
    pub platform: Platform,
    pub event_types: Vec<String>,
}

/// Subscription manager for tracking client subscriptions
#[derive(Debug, Default)]
pub struct SubscriptionManager {
    subscriptions: Arc<Mutex<HashMap<String, Vec<PlatformSubscription>>>>,
}

impl SubscriptionManager {
    pub fn new() -> Self {
        Self {
            subscriptions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Add a subscription for a client
    pub async fn subscribe(&self, client_id: &str, subscription: PlatformSubscription) {
        let mut subscriptions = self.subscriptions.lock().await;
        subscriptions.entry(client_id.to_string())
            .or_insert_with(Vec::new)
            .push(subscription);
    }

    /// Remove a subscription for a client
    pub async fn unsubscribe(&self, client_id: &str, platform: &Platform) {
        let mut subscriptions = self.subscriptions.lock().await;
        if let Some(client_subs) = subscriptions.get_mut(client_id) {
            client_subs.retain(|s| &s.platform != platform);
        }
    }

    /// Get all clients subscribed to a platform
    pub async fn get_subscribers(&self, platform: &Platform) -> Vec<String> {
        let subscriptions = self.subscriptions.lock().await;
        subscriptions.iter()
            .filter(|(_, subs)| subs.iter().any(|s| &s.platform == platform))
            .map(|(client_id, _)| client_id.clone())
            .collect()
    }

    /// Check if a client is subscribed to a platform
    pub async fn is_subscribed(&self, client_id: &str, platform: &Platform) -> bool {
        let subscriptions = self.subscriptions.lock().await;
        if let Some(client_subs) = subscriptions.get(client_id) {
            client_subs.iter().any(|s| &s.platform == platform)
        } else {
            false
        }
    }
}

use std::collections::HashMap;

/// Well-known protocol methods
pub mod methods {
    // Health & Status
    pub const PING: &str = "gateway.ping";
    pub const STATUS: &str = "gateway.status";
    pub const CONFIG: &str = "gateway.config";

    // Platform Methods
    pub const PLATFORM_LIST: &str = "platform.list";
    pub const PLATFORM_START: &str = "platform.start";
    pub const PLATFORM_STOP: &str = "platform.stop";
    pub const PLATFORM_STATUS: &str = "platform.status";

    // Subscription Methods
    pub const SUBSCRIBE: &str = "subscribe";
    pub const UNSUBSCRIBE: &str = "unsubscribe";

    // Message Methods
    pub const SEND_MESSAGE: &str = "message.send";
    pub const GET_MESSAGES: &str = "message.list";

    // Thread Methods
    pub const THREAD_CREATE: &str = "thread.create";
    pub const THREAD_LIST: &str = "thread.list";
    pub const THREAD_GET: &str = "thread.get";

    // Route Methods
    pub const ROUTE_LIST: &str = "route.list";
    pub const ROUTE_CREATE: &str = "route.create";
    pub const ROUTE_DELETE: &str = "route.delete";
}

/// Well-known protocol events
pub mod events {
    // Connection Events
    pub const CONNECTED: &str = "gateway.connected";
    pub const DISCONNECTED: &str = "gateway.disconnected";

    // Message Events
    pub const MESSAGE_RECEIVED: &str = "message.received";
    pub const MESSAGE_SENT: &str = "message.sent";
    pub const MESSAGE_DELIVERED: &str = "message.delivered";
    pub const MESSAGE_FAILED: &str = "message.failed";

    // Platform Events
    pub const PLATFORM_CONNECTED: &str = "platform.connected";
    pub const PLATFORM_DISCONNECTED: &str = "platform.disconnected";
    pub const PLATFORM_ERROR: &str = "platform.error";

    // Thread Events
    pub const THREAD_CREATED: &str = "thread.created";
    pub const THREAD_UPDATED: &str = "thread.updated";

    // Route Events
    pub const ROUTE_CHANGED: &str = "route.changed";
}