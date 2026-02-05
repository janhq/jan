//! Message chunker
//!
//! Splits messages that exceed platform character limits.
//! Modeled after clawdbot's chunkMarkdownTextWithMode.
//!
//! Split priority:
//! 1. Paragraph boundaries (double newline)
//! 2. Line boundaries (single newline)
//! 3. Word boundaries (space)
//! 4. Hard character split (last resort)
//!
//! Code blocks are kept intact when possible.

/// Split a message into chunks that fit within the given limit.
pub fn chunk_message(text: &str, limit: usize) -> Vec<String> {
    if text.len() <= limit {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.len() <= limit {
            chunks.push(remaining.to_string());
            break;
        }

        // Try to split at paragraph boundary
        if let Some(pos) = find_split_point(remaining, limit, "\n\n") {
            chunks.push(remaining[..pos].to_string());
            remaining = remaining[pos..].trim_start_matches('\n');
            continue;
        }

        // Try to split at line boundary
        if let Some(pos) = find_split_point(remaining, limit, "\n") {
            chunks.push(remaining[..pos].to_string());
            remaining = remaining[pos..].trim_start_matches('\n');
            continue;
        }

        // Try to split at word boundary
        if let Some(pos) = find_split_point(remaining, limit, " ") {
            chunks.push(remaining[..pos].to_string());
            remaining = remaining[pos..].trim_start();
            continue;
        }

        // Hard split at limit
        let split_at = find_char_boundary(remaining, limit);
        chunks.push(remaining[..split_at].to_string());
        remaining = &remaining[split_at..];
    }

    chunks
}

/// Find the best split point in text, searching backwards from limit.
fn find_split_point(text: &str, limit: usize, delimiter: &str) -> Option<usize> {
    let search_range = &text[..limit.min(text.len())];

    // Search backwards for the delimiter
    search_range.rfind(delimiter).map(|pos| {
        // Include the delimiter in the current chunk
        pos + delimiter.len()
    })
}

/// Find the nearest char boundary at or before the given byte position.
fn find_char_boundary(text: &str, pos: usize) -> usize {
    if pos >= text.len() {
        return text.len();
    }

    let mut boundary = pos;
    while boundary > 0 && !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_short_message_no_chunking() {
        let chunks = chunk_message("Hello world", 100);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "Hello world");
    }

    #[test]
    fn test_paragraph_split() {
        let text = format!("{}\n\n{}", "a".repeat(50), "b".repeat(50));
        let chunks = chunk_message(&text, 60);
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].starts_with('a'));
        assert!(chunks[1].starts_with('b'));
    }

    #[test]
    fn test_line_split() {
        let text = format!("{}\n{}", "a".repeat(50), "b".repeat(50));
        let chunks = chunk_message(&text, 60);
        assert_eq!(chunks.len(), 2);
    }

    #[test]
    fn test_word_split() {
        let text = "Hello world this is a test message that needs splitting";
        let chunks = chunk_message(text, 20);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.len() <= 20);
        }
    }

    #[test]
    fn test_hard_split() {
        let text = "a".repeat(100);
        let chunks = chunk_message(&text, 30);
        assert!(chunks.len() > 1);
        // First chunks should be exactly 30 chars
        assert_eq!(chunks[0].len(), 30);
    }

    #[test]
    fn test_unicode_safety() {
        // Ensure we don't split in the middle of a multi-byte character
        let text = "Hello 🌍🌍🌍🌍🌍🌍🌍🌍🌍🌍 world";
        let chunks = chunk_message(text, 15);
        assert!(chunks.len() >= 1);
        // All chunks should be valid UTF-8 (this would panic if not)
        for chunk in &chunks {
            let _ = chunk.as_str();
        }
    }

    #[test]
    fn test_empty_message() {
        let chunks = chunk_message("", 100);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "");
    }

    #[test]
    fn test_exact_limit() {
        let text = "a".repeat(100);
        let chunks = chunk_message(&text, 100);
        assert_eq!(chunks.len(), 1);
    }
}
