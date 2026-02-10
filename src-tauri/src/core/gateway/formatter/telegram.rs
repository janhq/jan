//! Telegram HTML formatter
//!
//! Converts markdown to Telegram's supported HTML subset.
//!
//! Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">,
//! <tg-spoiler>, <blockquote>
//!
//! IMPORTANT: Text must be HTML-escaped FIRST, then formatting tags inserted.
//! The previous implementation had a bug where it escaped HTML AFTER inserting tags.

use regex::Regex;
use once_cell::sync::Lazy;

// Pre-compiled regexes for performance
static RE_CODE_BLOCK: Lazy<Regex> = Lazy::new(|| Regex::new(r"```(\w*)\n([\s\S]*?)```").unwrap());
static RE_INLINE_CODE: Lazy<Regex> = Lazy::new(|| Regex::new(r"`([^`]+)`").unwrap());
static RE_BOLD: Lazy<Regex> = Lazy::new(|| Regex::new(r"\*\*(.+?)\*\*").unwrap());
static RE_BOLD_ALT: Lazy<Regex> = Lazy::new(|| Regex::new(r"__(.+?)__").unwrap());
static RE_ITALIC: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?<!\*)\*([^*]+)\*(?!\*)").unwrap());
static RE_ITALIC_ALT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?<!_)_([^_]+)_(?!_)").unwrap());
static RE_STRIKETHROUGH: Lazy<Regex> = Lazy::new(|| Regex::new(r"~~(.+?)~~").unwrap());
static RE_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap());
static RE_HEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^#{1,6}\s+(.+)$").unwrap());

/// Format markdown to Telegram HTML.
///
/// Order of operations:
/// 1. Extract and preserve code blocks (they shouldn't be formatted)
/// 2. Escape HTML entities in the remaining text
/// 3. Apply formatting conversions
/// 4. Re-insert code blocks
pub fn format_markdown(markdown: &str) -> String {
    // Step 1: Extract code blocks to protect them
    let mut code_blocks: Vec<(String, String)> = Vec::new();
    let mut text = markdown.to_string();

    // Replace code blocks with placeholders
    let mut idx = 0;
    text = RE_CODE_BLOCK
        .replace_all(&text, |caps: &regex::Captures| {
            let lang = caps.get(1).map_or("", |m| m.as_str());
            let code = caps.get(2).map_or("", |m| m.as_str());
            let placeholder = format!("\x00CODEBLOCK{}\x00", idx);
            let formatted = if lang.is_empty() {
                format!("<pre>{}</pre>", escape_html(code))
            } else {
                format!("<pre><code class=\"language-{}\">{}</code></pre>", escape_html(lang), escape_html(code))
            };
            code_blocks.push((placeholder.clone(), formatted));
            idx += 1;
            placeholder
        })
        .to_string();

    // Extract inline code too
    let mut inline_codes: Vec<(String, String)> = Vec::new();
    let mut inline_idx = 0;
    text = RE_INLINE_CODE
        .replace_all(&text, |caps: &regex::Captures| {
            let code = caps.get(1).map_or("", |m| m.as_str());
            let placeholder = format!("\x00INLINECODE{}\x00", inline_idx);
            inline_codes.push((placeholder.clone(), format!("<code>{}</code>", escape_html(code))));
            inline_idx += 1;
            placeholder
        })
        .to_string();

    // Step 2: Escape HTML in the remaining text
    text = escape_html(&text);

    // Step 3: Apply formatting conversions

    // Headings -> bold
    text = RE_HEADING.replace_all(&text, "<b>$1</b>").to_string();

    // Bold: **text** -> <b>text</b>
    text = RE_BOLD.replace_all(&text, "<b>$1</b>").to_string();
    text = RE_BOLD_ALT.replace_all(&text, "<b>$1</b>").to_string();

    // Italic: *text* -> <i>text</i>
    text = RE_ITALIC.replace_all(&text, "<i>$1</i>").to_string();
    text = RE_ITALIC_ALT.replace_all(&text, "<i>$1</i>").to_string();

    // Strikethrough: ~~text~~ -> <s>text</s>
    text = RE_STRIKETHROUGH.replace_all(&text, "<s>$1</s>").to_string();

    // Links: [text](url) -> <a href="url">text</a>
    text = RE_LINK
        .replace_all(&text, "<a href=\"$2\">$1</a>")
        .to_string();

    // Step 4: Re-insert code blocks and inline code
    for (placeholder, formatted) in inline_codes.iter().rev() {
        text = text.replace(placeholder, formatted);
    }
    for (placeholder, formatted) in code_blocks.iter().rev() {
        text = text.replace(placeholder, formatted);
    }

    text
}

/// Escape HTML entities in text content.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bold() {
        assert_eq!(format_markdown("**bold**"), "<b>bold</b>");
    }

    #[test]
    fn test_italic() {
        assert_eq!(format_markdown("*italic*"), "<i>italic</i>");
    }

    #[test]
    fn test_strikethrough() {
        assert_eq!(format_markdown("~~strike~~"), "<s>strike</s>");
    }

    #[test]
    fn test_inline_code() {
        let result = format_markdown("use `println!`");
        assert!(result.contains("<code>println!</code>"));
    }

    #[test]
    fn test_code_block() {
        let input = "```rust\nfn main() {}\n```";
        let result = format_markdown(input);
        assert!(result.contains("<pre><code class=\"language-rust\">fn main() {}</code></pre>"));
    }

    #[test]
    fn test_link() {
        let result = format_markdown("[click](https://example.com)");
        assert!(result.contains("<a href=\"https://example.com\">click</a>"));
    }

    #[test]
    fn test_html_escaping() {
        let result = format_markdown("3 < 5 && 5 > 2");
        assert!(result.contains("&lt;"));
        assert!(result.contains("&gt;"));
        assert!(result.contains("&amp;&amp;"));
    }

    #[test]
    fn test_html_not_double_escaped_in_code() {
        let result = format_markdown("`<div>`");
        assert!(result.contains("<code>&lt;div&gt;</code>"));
    }

    #[test]
    fn test_heading_to_bold() {
        assert_eq!(format_markdown("## Section Title"), "<b>Section Title</b>");
    }

    #[test]
    fn test_mixed_formatting() {
        let input = "**bold** and *italic* and `code`";
        let result = format_markdown(input);
        assert!(result.contains("<b>bold</b>"));
        assert!(result.contains("<i>italic</i>"));
        assert!(result.contains("<code>code</code>"));
    }
}
