//! Protocol Handler
//!
//! Handles protocol frame processing, method routing, and event dispatching.
//! This is the core of the protocol implementation.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use serde_json::Value;

use super::{frames::{RequestFrame, ResponseFrame, EventFrame, ProtocolFrame, ErrorShape, error_codes}, PROTOCOL_VERSION};

use crate::core::gateway::{SharedGatewayManager, types::{Platform, GatewayMessage}};

/// Context for a protocol handler method
#[derive(Debug)]
pub struct ProtocolContext {
    /// The gateway manager
    pub manager: SharedGatewayManager,
    /// Client ID for this connection
    pub client_id: String,
    /// Connection metadata
    pub metadata: Arc<Mutex<ConnectionMetadata>>,
}

/// Metadata about a connection
#[derive(Debug, Default)]
pub struct ConnectionMetadata {
    pub subscribed_platforms: Vec<Platform>,
    pub connected_at: u64,
    pub last_activity: u64,
    pub user_agent: Option<String>,
}

impl ProtocolContext {
    pub fn new(manager: SharedGatewayManager, client_id: String) -> Self {
        Self {
            manager,
            client_id,
            metadata: Arc::new(Mutex::new(ConnectionMetadata::default())),
        }
    }
}

/// Handler function type
pub type MethodHandler = fn(
    ctx: &ProtocolContext,
    params: Value,
) -> Pin<Box<dyn Future<Output = Result<Value, ErrorShape>> + Send>>;

/// Registry of method handlers
#[derive(Default, Debug)]
pub struct MethodRegistry {
    handlers: Mutex<std::collections::HashMap<String, MethodHandler>>,
}

impl MethodRegistry {
    pub fn new() -> Self {
        Self {
            handlers: Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// Register a handler for a method
    pub async fn register(&self, method: impl Into<String>, handler: MethodHandler) {
        self.handlers.lock().await.insert(method.into(), handler);
    }

    /// Get a handler for a method
    pub async fn get(&self, method: &str) -> Option<MethodHandler> {
        self.handlers.lock().await.get(method).copied()
    }

    /// List all registered methods
    pub async fn list(&self) -> Vec<String> {
        self.handlers.lock().await.keys().cloned().collect()
    }
}

/// Default protocol handler that processes frames and routes methods
#[derive(Debug)]
pub struct ProtocolHandler {
    /// The protocol context
    ctx: ProtocolContext,
    /// Method registry
    registry: Arc<MethodRegistry>,
    /// Event sender for broadcasting
    event_sender: Option<mpsc::Sender<EventFrame>>,
    /// Sequence counter for events
    event_seq: Mutex<u64>,
}

impl ProtocolHandler {
    /// Create a new protocol handler
    pub fn new(manager: SharedGatewayManager, client_id: String) -> Self {
        let ctx = ProtocolContext::new(manager.clone(), client_id.clone());
        let registry = Arc::new(MethodRegistry::new());

        let mut handler = Self {
            ctx,
            registry,
            event_sender: None,
            event_seq: Mutex::new(0),
        };

        // Register default handlers
        handler.register_default_handlers(manager);

        handler
    }

    /// Set the event sender for broadcasting
    pub fn set_event_sender(&mut self, sender: mpsc::Sender<EventFrame>) {
        self.event_sender = Some(sender);
    }

    /// Register the default set of protocol handlers
    fn register_default_handlers(&mut self, _manager: SharedGatewayManager) {
        let rt = self.registry.clone();

        // Register ping handler
        let _ = rt.register(super::methods::PING, |_, _| {
            Box::pin(async move {
                let now = chrono::Utc::now().timestamp_millis() as u64;
                Ok(serde_json::json!({
                    "pong": now,
                    "serverTime": now
                }))
            })
        });

        // Register status handler
        let _ = rt.register(super::methods::STATUS, move |ctx, _| {
            let manager = ctx.manager.clone();
            Box::pin(async move {
                let guard = manager.lock().await;
                let status = guard.get_status();
                Ok(serde_json::json!({
                    "running": status.running,
                    "httpPort": status.http_port,
                    "wsPort": status.ws_port,
                    "activeConnections": status.active_connections,
                    "queuedMessages": status.queued_messages,
                    "protocolVersion": PROTOCOL_VERSION
                }))
            })
        });

        // Register config handler
        let _ = rt.register(super::methods::CONFIG, move |ctx, _| {
            let manager = ctx.manager.clone();
            Box::pin(async move {
                let guard = manager.lock().await;
                Ok(serde_json::json!({
                    "enabled": guard.running,
                    "httpPort": guard.config.as_ref().map(|c| c.http_port).unwrap_or(0),
                    "wsPort": guard.config.as_ref().map(|c| c.ws_port).unwrap_or(0),
                    "whitelist": guard.config.as_ref().map(|c| &c.whitelist).cloned(),
                    "autoCreateThreads": guard.config.as_ref().map(|c| c.auto_create_threads).unwrap_or(false),
                    "defaultAssistantId": guard.config.as_ref().and_then(|c| c.default_assistant_id.clone()),
                }))
            })
        });

        // Register platform list handler
        let _ = rt.register(super::methods::PLATFORM_LIST, |_, _| {
            Box::pin(async move {
                Ok(serde_json::json!({
                    "platforms": ["discord", "slack", "telegram"]
                }))
            })
        });
    }

    /// Process an incoming request frame
    pub async fn handle_request(&self, request: RequestFrame) -> ResponseFrame {
        log::debug!("[Protocol] Handling request: {} {}", request.id, request.method);

        // Validate request
        if request.id.is_empty() {
            return ResponseFrame::with_error(request.id, "INVALID_REQUEST", "Request ID is required");
        }

        if request.method.is_empty() {
            return ResponseFrame::with_error(request.id, "INVALID_REQUEST", "Request method is required");
        }

        // Get handler
        let handler = self.registry.get(&request.method).await;

        match handler {
            Some(handler_fn) => {
                // Call handler
                let result = (handler_fn)(&self.ctx, request.params.clone()).await;
                match result {
                    Ok(payload) => ResponseFrame::success(request.id, payload),
                    Err(e) => ResponseFrame::error(request.id, e),
                }
            }
            None => ResponseFrame::with_error(
                request.id,
                error_codes::METHOD_NOT_FOUND,
                &format!("Unknown method: {}", request.method),
            ),
        }
    }

    /// Broadcast an event to subscribers
    pub async fn broadcast_event(&self, event: EventFrame) {
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(event).await;
        }
    }

    /// Send a message received event
    pub async fn emit_message_event(&self, message: GatewayMessage) {
        let payload = serde_json::json!({
            "message": message,
            "receivedAt": chrono::Utc::now().timestamp_millis()
        });
        let mut seq_guard = self.event_seq.lock().await;
        let seq = *seq_guard;
        *seq_guard += 1;

        let event = EventFrame::with_seq(super::events::MESSAGE_RECEIVED, seq, payload);
        self.broadcast_event(event).await;
    }

    /// Send a platform connected event
    pub async fn emit_platform_connected(&self, platform: Platform) {
        let payload = serde_json::json!({
            "platform": platform.as_str(),
            "connectedAt": chrono::Utc::now().timestamp_millis()
        });
        let event = EventFrame::new(super::events::PLATFORM_CONNECTED, payload);
        self.broadcast_event(event).await;
    }

    /// Send a platform disconnected event
    pub async fn emit_platform_disconnected(&self, platform: Platform) {
        let payload = serde_json::json!({
            "platform": platform.as_str(),
            "disconnectedAt": chrono::Utc::now().timestamp_millis()
        });
        let event = EventFrame::new(super::events::PLATFORM_DISCONNECTED, payload);
        self.broadcast_event(event).await;
    }
}

/// Process a frame and return the appropriate response
pub async fn process_frame(
    frame: ProtocolFrame,
    handler: &ProtocolHandler,
) -> Option<ProtocolFrame> {
    match frame {
        ProtocolFrame::Request(request) => {
            let response = handler.handle_request(request).await;
            Some(ProtocolFrame::Response(response))
        }
        ProtocolFrame::Event(_) => {
            // Events are server-initiated, should not be received from client
            None
        }
        ProtocolFrame::Response(_) => {
            // Responses should not be received from client in this protocol
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::gateway::{GatewayManager, queue::MessageQueue};

    fn create_test_handler() -> ProtocolHandler {
        let manager = std::sync::Arc::new(tokio::sync::Mutex::new(
            GatewayManager::new(),
        ));
        ProtocolHandler::new(manager, "test-client".to_string())
    }

    #[tokio::test]
    async fn test_ping_request() {
        let handler = create_test_handler();
        let request = RequestFrame::new("gateway.ping".to_string(), Value::Null);
        let response = handler.handle_request(request).await;

        assert!(response.ok);
        assert!(response.payload.is_some());
    }

    #[tokio::test]
    async fn test_status_request() {
        let handler = create_test_handler();
        let request = RequestFrame::new("gateway.status".to_string(), Value::Null);
        let response = handler.handle_request(request).await;

        assert!(response.ok);
        if let Some(payload) = response.payload {
            assert!(payload.get("running").is_some());
        }
    }

    #[tokio::test]
    async fn test_unknown_method() {
        let handler = create_test_handler();
        let request = RequestFrame::new("unknown.method".to_string(), Value::Null);
        let response = handler.handle_request(request).await;

        assert!(!response.ok);
        assert!(response.error.is_some());
        if let Some(error) = &response.error {
            assert_eq!(error.code, error_codes::METHOD_NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn test_process_request_frame() {
        let handler = create_test_handler();
        let frame = ProtocolFrame::Request(RequestFrame::new(
            "gateway.ping".to_string(),
            Value::Null,
        ));

        let result = process_frame(frame, &handler).await;
        assert!(result.is_some());

        if let Some(ProtocolFrame::Response(response)) = result {
            assert!(response.ok);
        } else {
            panic!("Expected response frame");
        }
    }
}