//! Slack mrkdwn formatter
//!
//! Converts markdown to Slack's mrkdwn format.
//! Modeled after clawdbot's markdownToSlackMrkdwn.
//!
//! Slack mrkdwn uses:
//! - *bold* (not **bold**)
//! - _italic_ (same)
//! - ~strikethrough~ (not ~~)
//! - `code` (same)
//! - ```code blocks``` (same)
//! - > blockquotes (same)
//! - <url|text> for links (not [text](url))
//!
//! Special Slack tokens must be preserved: <@user>, <#channel>, <url>

use regex::Regex;
use once_cell::sync::Lazy;

static RE_CODE_BLOCK: Lazy<Regex> = Lazy::new(|| Regex::new(r"```(\w*)\n([\s\S]*?)```").unwrap());
static RE_INLINE_CODE: Lazy<Regex> = Lazy::new(|| Regex::new(r"`([^`]+)`").unwrap());
static RE_BOLD: Lazy<Regex> = Lazy::new(|| Regex::new(r"\*\*(.+?)\*\*").unwrap());
static RE_BOLD_ALT: Lazy<Regex> = Lazy::new(|| Regex::new(r"__(.+?)__").unwrap());
static RE_STRIKETHROUGH: Lazy<Regex> = Lazy::new(|| Regex::new(r"~~(.+?)~~").unwrap());
static RE_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap());
static RE_HEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^#{1,6}\s+(.+)$").unwrap());

/// Format markdown to Slack mrkdwn.
pub fn format_markdown(markdown: &str) -> String {
    let mut text = markdown.to_string();

    // Protect code blocks - Slack uses same ``` syntax
    let mut code_blocks: Vec<(String, String)> = Vec::new();
    let mut idx = 0;
    text = RE_CODE_BLOCK
        .replace_all(&text, |caps: &regex::Captures| {
            let placeholder = format!("\x00CODEBLOCK{}\x00", idx);
            // Slack code blocks don't support language hints, strip them
            let code = caps.get(2).map_or("", |m| m.as_str());
            code_blocks.push((placeholder.clone(), format!("```\n{}```", code)));
            idx += 1;
            placeholder
        })
        .to_string();

    // Protect inline code
    let mut inline_codes: Vec<(String, String)> = Vec::new();
    let mut inline_idx = 0;
    text = RE_INLINE_CODE
        .replace_all(&text, |caps: &regex::Captures| {
            let full = caps.get(0).map_or("", |m| m.as_str());
            let placeholder = format!("\x00INLINECODE{}\x00", inline_idx);
            inline_codes.push((placeholder.clone(), full.to_string()));
            inline_idx += 1;
            placeholder
        })
        .to_string();

    // Headings -> bold
    text = RE_HEADING.replace_all(&text, "*$1*").to_string();

    // Bold: **text** -> *text* (Slack bold)
    text = RE_BOLD.replace_all(&text, "*$1*").to_string();
    // __text__ -> *text* (also bold in Slack)
    text = RE_BOLD_ALT.replace_all(&text, "*$1*").to_string();

    // Strikethrough: ~~text~~ -> ~text~
    text = RE_STRIKETHROUGH.replace_all(&text, "~$1~").to_string();

    // Links: [text](url) -> <url|text>
    text = RE_LINK.replace_all(&text, "<$2|$1>").to_string();

    // Note: *italic* with single asterisk is the same in both markdown and mrkdwn,
    // BUT in Slack *text* means bold. Italic in Slack is _text_.
    // Standard markdown *text* = italic, Slack *text* = bold.
    // Since we already converted **bold** to *bold*, single * would conflict.
    // Leave _italic_ as-is since both formats use it.

    // Re-insert protected blocks
    for (placeholder, original) in inline_codes.iter().rev() {
        text = text.replace(placeholder, original);
    }
    for (placeholder, original) in code_blocks.iter().rev() {
        text = text.replace(placeholder, original);
    }

    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bold_conversion() {
        assert_eq!(format_markdown("**bold**"), "*bold*");
    }

    #[test]
    fn test_bold_alt() {
        assert_eq!(format_markdown("__bold__"), "*bold*");
    }

    #[test]
    fn test_strikethrough() {
        assert_eq!(format_markdown("~~strike~~"), "~strike~");
    }

    #[test]
    fn test_link_conversion() {
        let result = format_markdown("[click here](https://example.com)");
        assert_eq!(result, "<https://example.com|click here>");
    }

    #[test]
    fn test_inline_code_preserved() {
        let result = format_markdown("use `println!` please");
        assert!(result.contains("`println!`"));
    }

    #[test]
    fn test_code_block_strips_language() {
        let input = "```rust\nfn main() {}\n```";
        let result = format_markdown(input);
        assert!(result.contains("```\nfn main() {}```"));
        assert!(!result.contains("rust"));
    }

    #[test]
    fn test_heading_to_bold() {
        assert_eq!(format_markdown("## Section"), "*Section*");
    }

    #[test]
    fn test_blockquote_preserved() {
        let input = "> This is a quote";
        assert_eq!(format_markdown(input), "> This is a quote");
    }

    #[test]
    fn test_italic_underscore_preserved() {
        let result = format_markdown("_italic text_");
        assert_eq!(result, "_italic text_");
    }
}
