//! Protocol Frames
//!
//! Defines the frame types for the gateway protocol:
//! - RequestFrame: Client requests with correlation ID
//! - ResponseFrame: Server responses matching request IDs
//! - EventFrame: Server-initiated events

use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::core::gateway::types::{Platform, GatewayMessage, GatewayResponse};

/// Client request frame
///
/// # Example
/// ```json
/// {
///   "type": "req",
///   "id": "uuid-1234-5678",
///   "method": "gateway.ping",
///   "params": {}
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename = "req")]
pub struct RequestFrame {
    /// Unique correlation ID for matching requests to responses
    pub id: String,
    /// The method to invoke
    pub method: String,
    /// Method parameters
    #[serde(default)]
    pub params: Value,
}

impl RequestFrame {
    /// Create a new request frame with auto-generated ID
    pub fn new(method: String, params: Value) -> Self {
        use super::generate_correlation_id;
        Self {
            id: generate_correlation_id(),
            method,
            params,
        }
    }

    /// Create a request frame with a specific ID
    pub fn with_id(method: String, params: Value, id: String) -> Self {
        Self { id, method, params }
    }
}

/// Server response frame
///
/// Success response:
/// ```json
/// {
///   "type": "res",
///   "id": "uuid-1234-5678",
///   "ok": true,
///   "payload": { "status": "running" }
/// }
/// ```
///
/// Error response:
/// ```json
/// {
///   "type": "res",
///   "id": "uuid-1234-5678",
///   "ok": false,
///   "error": {
///     "code": "METHOD_NOT_FOUND",
///     "message": "Unknown method: gateway.invalid"
///   }
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename = "res")]
pub struct ResponseFrame {
    /// Correlation ID matching the request
    pub id: String,
    /// Whether the request was successful
    pub ok: bool,
    /// Response payload on success
    #[serde(default)]
    pub payload: Option<Value>,
    /// Error details on failure
    #[serde(default)]
    pub error: Option<ErrorShape>,
}

impl ResponseFrame {
    /// Create a successful response
    pub fn success(id: String, payload: Value) -> Self {
        Self {
            id,
            ok: true,
            payload: Some(payload),
            error: None,
        }
    }

    /// Create an error response
    pub fn error(id: String, error: ErrorShape) -> Self {
        Self {
            id,
            ok: false,
            payload: None,
            error: Some(error),
        }
    }

    /// Create an error response with code and message
    pub fn with_error(id: String, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::error(id, ErrorShape {
            code: code.into(),
            message: message.into(),
            details: None,
        })
    }
}

/// Error details for failed responses
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ErrorShape {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: Option<Value>,
}

impl ErrorShape {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(code: impl Into<String>, message: impl Into<String>, details: Value) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }
}

/// Common error codes
pub mod error_codes {
    pub const METHOD_NOT_FOUND: &str = "METHOD_NOT_FOUND";
    pub const INVALID_PARAMS: &str = "INVALID_PARAMS";
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const CONFLICT: &str = "CONFLICT";
    pub const RATE_LIMITED: &str = "RATE_LIMITED";
    pub const PLATFORM_ERROR: &str = "PLATFORM_ERROR";
    pub const TIMEOUT: &str = "TIMEOUT";
    pub const UNSUPPORTED: &str = "UNSUPPORTED";
}

/// Server-initiated event frame
///
/// # Example
/// ```json
/// {
///   "type": "evt",
///   "event": "message.received",
///   "seq": 42,
///   "data": { "message": { "id": "msg-123", "content": "Hello" } }
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename = "evt")]
pub struct EventFrame {
    /// The event name
    pub event: String,
    /// Sequence number for ordering events (optional)
    #[serde(default)]
    pub seq: Option<u64>,
    /// Event data payload
    pub data: Value,
}

impl EventFrame {
    /// Create a new event frame
    pub fn new(event: impl Into<String>, data: Value) -> Self {
        Self {
            event: event.into(),
            seq: None,
            data,
        }
    }

    /// Create an event frame with a sequence number
    pub fn with_seq(event: impl Into<String>, seq: u64, data: Value) -> Self {
        Self {
            event: event.into(),
            seq: Some(seq),
            data,
        }
    }

    /// Serialize to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// Union type for all protocol frames
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ProtocolFrame {
    /// Request from client
    Request(RequestFrame),
    /// Response from server
    Response(ResponseFrame),
    /// Event from server
    Event(EventFrame),
}

impl ProtocolFrame {
    /// Serialize to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from JSON string
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    /// Get the correlation ID if this is a request or response
    pub fn correlation_id(&self) -> Option<&str> {
        match self {
            ProtocolFrame::Request(req) => Some(&req.id),
            ProtocolFrame::Response(res) => Some(&res.id),
            ProtocolFrame::Event(_) => None,
        }
    }
}

/// Common payload types for protocol operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingParams {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub pong: u64,
    pub server_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusParams {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub running: bool,
    pub http_port: u16,
    pub ws_port: u16,
    pub active_connections: usize,
    pub queued_messages: usize,
    pub protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeParams {
    pub platform: Platform,
    #[serde(default)]
    pub events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeResponse {
    pub platform: Platform,
    pub subscribed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeParams {
    pub platform: Platform,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReceivedEvent {
    pub message: GatewayMessage,
    pub thread_id: Option<String>,
}

/// Payload wrapper for method parameters and responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Payload<T = Value> {
    /// Simple value payload
    Value(T),
    /// With metadata
    WithMeta {
        value: T,
        #[serde(default)]
        meta: Value,
    },
}

impl<T> Payload<T> {
    /// Extract the inner value
    pub fn into_value(self) -> T {
        match self {
            Payload::Value(v) => v,
            Payload::WithMeta { value, .. } => value,
        }
    }
}

impl<T: Serialize> From<T> for Payload<T> {
    fn from(value: T) -> Self {
        Payload::Value(value)
    }
}

/// Convert GatewayMessage to event payload
impl From<GatewayMessage> for EventFrame {
    fn from(message: GatewayMessage) -> Self {
        EventFrame::new(
            "message.received",
            serde_json::to_value(message).unwrap_or_default(),
        )
    }
}

/// Convert GatewayResponse to event payload
impl From<GatewayResponse> for EventFrame {
    fn from(response: GatewayResponse) -> Self {
        EventFrame::new(
            "message.sent",
            serde_json::to_value(response).unwrap_or_default(),
        )
    }
}