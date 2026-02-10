//! Message processing pipeline module
//!
//! This module contains the processing stages for incoming messages:
//! - Whitelist validation
//! - Message debouncing
//! - Message normalization
//! - Thread routing
//! - ACK handling
#![allow(dead_code)]

pub mod whitelist;
pub mod debounce;
pub mod normalizer;
pub mod router;
pub mod ack;

use super::types::{GatewayMessage, NormalizedMessage, WhitelistConfig};

/// Result of whitelist validation
#[derive(Debug, Clone)]
pub struct WhitelistResult {
    pub allowed: bool,
    pub reason: Option<String>,
}

/// Result of message processing
#[derive(Debug, Clone)]
pub struct ProcessingResult {
    pub message: Option<NormalizedMessage>,
    pub whitelisted: bool,
    pub normalized: bool,
    pub routed: bool,
    pub thread_id: Option<String>,
    pub error: Option<String>,
}

impl ProcessingResult {
    pub fn success(message: NormalizedMessage, thread_id: Option<String>) -> Self {
        Self {
            message: Some(message),
            whitelisted: true,
            normalized: true,
            routed: thread_id.is_some(),
            thread_id,
            error: None,
        }
    }

    pub fn rejected(reason: String) -> Self {
        Self {
            message: None,
            whitelisted: false,
            normalized: false,
            routed: false,
            thread_id: None,
            error: Some(reason),
        }
    }

    pub fn error(e: String) -> Self {
        Self {
            message: None,
            whitelisted: false,
            normalized: false,
            routed: false,
            thread_id: None,
            error: Some(e),
        }
    }
}

/// Process a message through the full pipeline
pub async fn process_message(
    message: GatewayMessage,
    whitelist_config: &WhitelistConfig,
    _auto_create_threads: bool,
) -> ProcessingResult {
    // Stage 1: Whitelist validation
    let whitelist_result = whitelist::validate(&message, whitelist_config);
    if !whitelist_result.allowed {
        return ProcessingResult::rejected(
            whitelist_result.reason.unwrap_or_else(|| "Rejected by whitelist".to_string())
        );
    }

    // Stage 2: Normalization
    let normalized = match normalizer::normalize(message) {
        Ok(msg) => msg,
        Err(e) => return ProcessingResult::error(e),
    };

    // Stage 3: Routing (handled by caller with thread manager)
    ProcessingResult::success(normalized, None)
}