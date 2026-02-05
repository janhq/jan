//! Discord markdown formatter
//!
//! Discord natively supports a subset of markdown, so this is mostly
//! pass-through with minor cleanup of unsupported elements.

/// Format markdown for Discord.
///
/// Discord supports: **bold**, *italic*, __underline__, ~~strikethrough~~,
/// `inline code`, ```code blocks```, > blockquotes, [links](url)
///
/// We strip HTML tags and other unsupported elements.
pub fn format_markdown(markdown: &str) -> String {
    let mut result = markdown.to_string();

    // Strip HTML tags that may have leaked through
    result = strip_html_tags(&result);

    // Discord has a 2000 char limit - truncation handled by chunker
    result
}

/// Remove HTML tags from text
fn strip_html_tags(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_tag = false;

    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_passthrough_markdown() {
        let input = "**bold** and *italic* and `code`";
        assert_eq!(format_markdown(input), input);
    }

    #[test]
    fn test_strip_html() {
        let input = "Hello <b>bold</b> world";
        assert_eq!(format_markdown(input), "Hello bold world");
    }

    #[test]
    fn test_code_blocks_preserved() {
        let input = "```rust\nfn main() {}\n```";
        assert_eq!(format_markdown(input), input);
    }

    #[test]
    fn test_links_preserved() {
        let input = "Check [this](https://example.com)";
        assert_eq!(format_markdown(input), input);
    }

    #[test]
    fn test_blockquotes_preserved() {
        let input = "> This is a quote\n> second line";
        assert_eq!(format_markdown(input), input);
    }
}
