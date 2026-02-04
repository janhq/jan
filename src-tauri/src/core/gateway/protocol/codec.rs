//! Protocol Codec
//!
//! Handles encoding and decoding of protocol frames to/from JSON strings.
//! Also provides utilities for frame validation and message type detection.

use super::frames::{ProtocolFrame, EventFrame, RequestFrame, ResponseFrame};
use crate::core::gateway::types::GatewayMessage;
use serde_json::Value;

/// Message type detected during parsing
#[derive(Debug, Clone, PartialEq)]
pub enum MessageType {
    Request,
    Response,
    Event,
    Unknown,
}

/// Result type for codec operations
pub type CodecResult<T> = Result<T, CodecError>;

/// Codec errors
#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    #[error("JSON parsing error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("Invalid frame: {0}")]
    InvalidFrame(String),
    #[error("Unknown message type")]
    UnknownType,
}

/// ProtocolCodec handles frame serialization/deserialization
#[derive(Debug, Clone, Default)]
pub struct ProtocolCodec;

impl ProtocolCodec {
    /// Detect the message type from raw JSON without full parsing
    pub fn detect_message_type(json: &str) -> MessageType {
        if let Ok(value) = serde_json::from_str::<Value>(json) {
            if let Some(type_field) = value.get("type") {
                match type_field.as_str() {
                    Some("req") => return MessageType::Request,
                    Some("res") => return MessageType::Response,
                    Some("evt") => return MessageType::Event,
                    _ => {}
                }
            }
        }
        MessageType::Unknown
    }

    /// Parse a raw WebSocket message to a ProtocolFrame
    pub fn parse_message(msg: &str) -> CodecResult<ProtocolFrame> {
        let frame: ProtocolFrame = serde_json::from_str(msg)
            .map_err(|e| CodecError::InvalidFrame(e.to_string()))?;
        Ok(frame)
    }

    /// Parse a WebSocket tungstenite Message to a ProtocolFrame
    pub fn parse_tungstenite_message(msg: tungstenite::Message) -> CodecResult<ProtocolFrame> {
        match msg {
            tungstenite::Message::Text(text) => Self::parse_message(&text),
            tungstenite::Message::Binary(_) => Err(CodecError::InvalidFrame(
                "Binary messages not supported".to_string(),
            )),
            _ => Err(CodecError::UnknownType),
        }
    }

    /// Serialize a ProtocolFrame to a JSON string
    pub fn encode(frame: &ProtocolFrame) -> CodecResult<String> {
        serde_json::to_string(frame)
            .map_err(|e| CodecError::InvalidFrame(e.to_string()))
    }

    /// Serialize a ProtocolFrame to a WebSocket Message
    pub fn encode_to_ws_message(frame: &ProtocolFrame) -> Result<tungstenite::Message, CodecError> {
        let text = Self::encode(frame)?;
        Ok(tungstenite::Message::Text(text))
    }

    /// Create a request frame JSON string directly
    pub fn encode_request(id: &str, method: &str, params: Value) -> Result<String, CodecError> {
        let frame = RequestFrame::with_id(
            method.to_string(),
            params,
            id.to_string(),
        );
        Self::encode(&ProtocolFrame::Request(frame))
    }

    /// Create a response frame JSON string directly
    pub fn encode_response(
        id: &str,
        ok: bool,
        payload: Option<Value>,
        error: Option<super::ErrorShape>,
    ) -> Result<String, CodecError> {
        let frame = if ok {
            ResponseFrame::success(id.to_string(), payload.unwrap_or_default())
        } else {
            ResponseFrame::error(id.to_string(), error.unwrap_or_default())
        };
        Self::encode(&ProtocolFrame::Response(frame))
    }

    /// Create an event frame JSON string directly
    pub fn encode_event(event: &str, data: Value, seq: Option<u64>) -> Result<String, CodecError> {
        let frame = if let Some(seq_num) = seq {
            EventFrame::with_seq(event, seq_num, data)
        } else {
            EventFrame::new(event, data)
        };
        Self::encode(&ProtocolFrame::Event(frame))
    }

    /// Validate a request frame has required fields
    pub fn validate_request(frame: &RequestFrame) -> Result<(), CodecError> {
        if frame.id.is_empty() {
            return Err(CodecError::InvalidFrame(
                "Request ID is required".to_string(),
            ));
        }
        if frame.method.is_empty() {
            return Err(CodecError::InvalidFrame(
                "Request method is required".to_string(),
            ));
        }
        Ok(())
    }

    /// Validate a response frame has required fields
    pub fn validate_response(frame: &ResponseFrame) -> Result<(), CodecError> {
        if frame.id.is_empty() {
            return Err(CodecError::InvalidFrame(
                "Response ID is required".to_string(),
            ));
        }
        if !frame.ok && frame.error.is_none() {
            return Err(CodecError::InvalidFrame(
                "Error response must have error details".to_string(),
            ));
        }
        Ok(())
    }
}

/// Helper to convert between tungstenite and protocol messages
pub struct MessageConverter;

impl MessageConverter {
    /// Convert ProtocolFrame to tungstenite Message
    pub fn to_tungstenite(frame: &ProtocolFrame) -> Result<tungstenite::Message, CodecError> {
        ProtocolCodec::encode_to_ws_message(frame)
    }

    /// Convert tungstenite Message to ProtocolFrame
    pub fn from_tungstenite(msg: tungstenite::Message) -> CodecResult<ProtocolFrame> {
        ProtocolCodec::parse_tungstenite_message(msg)
    }

    /// Check if a tungstenite message is a text frame we can parse
    pub fn is_parseable(msg: &tungstenite::Message) -> bool {
        matches!(msg, tungstenite::Message::Text(_))
    }
}

/// Utility for creating common frame patterns
#[derive(Debug, Clone)]
pub struct FrameBuilder;

impl FrameBuilder {
    /// Build a ping request
    pub fn ping() -> ProtocolFrame {
        ProtocolFrame::Request(RequestFrame::new(
            super::methods::PING.to_string(),
            Value::Null,
        ))
    }

    /// Build a pong response
    pub fn pong(id: String) -> ProtocolFrame {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let payload = serde_json::json!({
            "pong": now,
            "serverTime": now
        });
        ProtocolFrame::Response(ResponseFrame::success(id, payload))
    }

    /// Build an error response
    pub fn error(id: String, code: &str, message: &str) -> ProtocolFrame {
        ProtocolFrame::Response(ResponseFrame::with_error(
            id,
            code.to_string(),
            message.to_string(),
        ))
    }

    /// Build a subscription response
    pub fn subscribe_response(id: String, platform: &str, success: bool) -> ProtocolFrame {
        let payload = serde_json::json!({
            "platform": platform,
            "subscribed": success
        });
        ProtocolFrame::Response(ResponseFrame::success(id, payload))
    }

    /// Build a message received event
    pub fn message_received(message: &GatewayMessage) -> ProtocolFrame {
        let payload = serde_json::json!({
            "message": message,
            "receivedAt": chrono::Utc::now().timestamp_millis()
        });
        ProtocolFrame::Event(EventFrame::new("message.received", payload))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_detect_message_type() {
        let req = r#"{"type": "req", "id": "1", "method": "ping", "params": {}}"#;
        let res = r#"{"type": "res", "id": "1", "ok": true, "payload": {}}"#;
        let evt = r#"{"type": "evt", "event": "test", "data": {}}"#;
        let unknown = r#"{"foo": "bar"}"#;

        assert_eq!(MessageType::Request, ProtocolCodec::detect_message_type(req));
        assert_eq!(MessageType::Response, ProtocolCodec::detect_message_type(res));
        assert_eq!(MessageType::Event, ProtocolCodec::detect_message_type(evt));
        assert_eq!(MessageType::Unknown, ProtocolCodec::detect_message_type(unknown));
    }

    #[test]
    fn test_request_frame_serialization() {
        let frame = RequestFrame::new("test.method".to_string(), json!({"key": "value"}));
        let json = ProtocolCodec::encode(&ProtocolFrame::Request(frame)).unwrap();
        assert!(json.contains(r#""type":"req""#));
        assert!(json.contains(r#""method":"test.method""#));
    }

    #[test]
    fn test_response_frame_serialization() {
        let frame = ResponseFrame::success("req-123".to_string(), json!({"result": "ok"}));
        let json = ProtocolCodec::encode(&ProtocolFrame::Response(frame)).unwrap();
        assert!(json.contains(r#""type":"res""#));
        assert!(json.contains(r#""ok":true"#));
        assert!(json.contains(r#""id":"req-123""#));
    }

    #[test]
    fn test_event_frame_serialization() {
        let frame = EventFrame::new("message.received", json!({"id": "msg-1"}));
        let json = ProtocolCodec::encode(&ProtocolFrame::Event(frame)).unwrap();
        assert!(json.contains(r#""type":"evt""#));
        assert!(json.contains(r#""event":"message.received""#));
    }

    #[test]
    fn test_frame_roundtrip() {
        let original = ProtocolFrame::Request(RequestFrame::new(
            "test.method".to_string(),
            json!({"foo": "bar"}),
        ));
        let json = ProtocolCodec::encode(&original).unwrap();
        let parsed = ProtocolCodec::parse_message(&json).unwrap();

        match (original, parsed) {
            (ProtocolFrame::Request(orig), ProtocolFrame::Request(pars)) => {
                assert_eq!(orig.id, pars.id);
                assert_eq!(orig.method, pars.method);
            }
            _ => panic!("Frame types don't match"),
        }
    }
}