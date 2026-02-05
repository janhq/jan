//! Outbound message formatting and chunking
//!
//! Converts markdown from agent responses to platform-specific formats,
//! and splits messages that exceed platform character limits.
//!
//! Architecture mirrors clawdbot's shared markdown IR:
//! markdown -> format_for_platform() -> chunk_message() -> send

pub mod discord;
pub mod telegram;
pub mod slack;
pub mod chunker;

use super::types::Platform;

/// Format markdown content for a specific platform.
///
/// Each platform has different formatting rules:
/// - Discord: Standard markdown (mostly pass-through)
/// - Telegram: HTML tags (<b>, <i>, <code>, <pre>, <a>)
/// - Slack: mrkdwn (*bold*, _italic_, ~strike~, `code`)
pub fn format_for_platform(markdown: &str, platform: &Platform) -> String {
    match platform {
        Platform::Discord => discord::format_markdown(markdown),
        Platform::Telegram => telegram::format_markdown(markdown),
        Platform::Slack => slack::format_markdown(markdown),
        Platform::Unknown => markdown.to_string(),
    }
}

/// Get the character limit for a platform.
pub fn chunk_limit(platform: &Platform) -> usize {
    match platform {
        Platform::Discord => 2000,
        Platform::Telegram => 4096,
        Platform::Slack => 4000,
        Platform::Unknown => 4000,
    }
}

/// Format and chunk a message for a platform.
/// Returns a vector of message chunks ready to send.
pub fn format_and_chunk(markdown: &str, platform: &Platform) -> Vec<String> {
    let formatted = format_for_platform(markdown, platform);
    let limit = chunk_limit(platform);

    if formatted.len() <= limit {
        vec![formatted]
    } else {
        chunker::chunk_message(&formatted, limit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_for_discord() {
        let result = format_for_platform("**bold** text", &Platform::Discord);
        assert!(result.contains("**bold**"));
    }

    #[test]
    fn test_format_for_telegram() {
        let result = format_for_platform("**bold** text", &Platform::Telegram);
        assert!(result.contains("<b>bold</b>"));
    }

    #[test]
    fn test_format_for_slack() {
        let result = format_for_platform("**bold** text", &Platform::Slack);
        assert!(result.contains("*bold*"));
    }

    #[test]
    fn test_chunk_limits() {
        assert_eq!(chunk_limit(&Platform::Discord), 2000);
        assert_eq!(chunk_limit(&Platform::Telegram), 4096);
        assert_eq!(chunk_limit(&Platform::Slack), 4000);
    }

    #[test]
    fn test_format_and_chunk_short() {
        let chunks = format_and_chunk("Hello world", &Platform::Discord);
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn test_format_and_chunk_long() {
        let long_text = "a".repeat(3000);
        let chunks = format_and_chunk(&long_text, &Platform::Discord);
        assert!(chunks.len() > 1);
    }
}
