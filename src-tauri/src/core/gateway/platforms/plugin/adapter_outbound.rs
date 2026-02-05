//! Outbound Message Adapter
//!
//! Normalizes outbound messages by applying platform-specific formatting and chunking
//! before sending via the plugin's send_outbound method.

use std::sync::Arc;
use serde_json::Value;

use crate::core::gateway::types::{Platform, GatewayResponse};
use crate::core::gateway::formatter;
use super::types::{ChannelPlugin, PluginResult, PluginError, ChannelHandle};

/// Outbound message adapter that wraps formatting, chunking, and delivery.
pub struct OutboundAdapter;

impl OutboundAdapter {
    /// Format, chunk, and send a response through the plugin.
    ///
    /// Steps:
    /// 1. Format markdown content for the target platform
    /// 2. Chunk into platform-appropriate sizes
    /// 3. Send each chunk via plugin.send_outbound()
    /// 4. Return delivery results
    pub async fn format_and_send(
        plugin: &Arc<dyn ChannelPlugin>,
        handle: &ChannelHandle,
        response: &GatewayResponse,
    ) -> PluginResult<Vec<DeliveryResult>> {
        let platform = &response.target_platform;

        // Step 1 & 2: Format and chunk using the formatter module
        let chunks = formatter::format_and_chunk(&response.content, platform);

        if chunks.is_empty() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();

        // Step 3: Send each chunk
        for (i, chunk) in chunks.iter().enumerate() {
            let mut chunk_response = response.clone();
            chunk_response.content = chunk.clone();

            // Only the first chunk gets the reply_to (thread context)
            if i > 0 {
                chunk_response.reply_to = None;
            }

            match plugin.send_outbound(handle, &chunk_response).await {
                Ok(()) => {
                    results.push(DeliveryResult {
                        chunk_index: i,
                        success: true,
                        error: None,
                    });
                }
                Err(e) => {
                    log::warn!(
                        "[OutboundAdapter] Failed to send chunk {}/{} to {:?}: {}",
                        i + 1,
                        chunks.len(),
                        platform,
                        e
                    );
                    results.push(DeliveryResult {
                        chunk_index: i,
                        success: false,
                        error: Some(format!("{}", e)),
                    });
                }
            }
        }

        let success_count = results.iter().filter(|r| r.success).count();
        log::info!(
            "[OutboundAdapter] Delivered {}/{} chunks to {:?}",
            success_count,
            chunks.len(),
            platform,
        );

        Ok(results)
    }

    /// Format content for a platform using the plugin's format_outbound method.
    ///
    /// Prefers the plugin's implementation over the central formatter.
    pub fn format_with_plugin(
        plugin: &Arc<dyn ChannelPlugin>,
        markdown: &str,
    ) -> String {
        plugin.format_outbound(markdown)
    }

    /// Get the chunk limit for a platform using the plugin.
    pub fn chunk_limit_for_plugin(plugin: &Arc<dyn ChannelPlugin>) -> usize {
        plugin.chunk_limit()
    }
}

/// Result of delivering a single chunk
#[derive(Debug, Clone)]
pub struct DeliveryResult {
    /// Index of the chunk (0-based)
    pub chunk_index: usize,
    /// Whether delivery succeeded
    pub success: bool,
    /// Error message if delivery failed
    pub error: Option<String>,
}

impl DeliveryResult {
    pub fn ok(index: usize) -> Self {
        Self {
            chunk_index: index,
            success: true,
            error: None,
        }
    }

    pub fn failed(index: usize, error: impl Into<String>) -> Self {
        Self {
            chunk_index: index,
            success: false,
            error: Some(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delivery_result_ok() {
        let result = DeliveryResult::ok(0);
        assert!(result.success);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_delivery_result_failed() {
        let result = DeliveryResult::failed(1, "Connection refused");
        assert!(!result.success);
        assert_eq!(result.error.as_deref(), Some("Connection refused"));
    }
}
