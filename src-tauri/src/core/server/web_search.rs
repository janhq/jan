use reqwest::Client;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Execute a web search using DuckDuckGo Lite (no API key needed).
/// Returns a list of search results with title, url, and snippet.
pub async fn execute_web_search(client: &Client, query: &str) -> Vec<SearchResult> {
    let url = "https://lite.duckduckgo.com/lite/";
    let params = [("q", query)];

    let response = match client.post(url).form(&params).send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("DuckDuckGo search request failed: {e}");
            return Vec::new();
        }
    };

    let html = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to read DuckDuckGo response: {e}");
            return Vec::new();
        }
    };

    parse_duckduckgo_lite_html(&html)
}

/// Parse DuckDuckGo Lite HTML response to extract search results.
///
/// DuckDuckGo Lite returns results in a table format where each result has:
/// - A link in an <a> tag with class='result-link' (single quotes in practice)
/// - A snippet in a <td> tag with class='result-snippet'
fn parse_duckduckgo_lite_html(html: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Extract result links and snippets from the HTML
    // DuckDuckGo Lite uses a table-based layout with specific classes
    let mut pos = 0;
    while let Some(link_start) = find_class_attr(&html[pos..], "result-link") {
        let link_start = pos + link_start;

        // Find the href in this <a> tag - search backwards for href="
        let tag_start = html[..link_start].rfind('<').unwrap_or(link_start);
        let href = extract_attribute(&html[tag_start..], "href");

        // Find the link text (between > and </a>)
        let title = if let Some(gt) = html[link_start..].find('>') {
            let text_start = link_start + gt + 1;
            if let Some(end_a) = html[text_start..].find("</a>") {
                strip_html_tags(&html[text_start..text_start + end_a])
                    .trim()
                    .to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Find the next snippet after this link
        let snippet =
            if let Some(snippet_start) = find_class_attr(&html[link_start..], "result-snippet") {
                let snippet_start = link_start + snippet_start;
                if let Some(gt) = html[snippet_start..].find('>') {
                    let text_start = snippet_start + gt + 1;
                    if let Some(end_td) = html[text_start..].find("</td>") {
                        strip_html_tags(&html[text_start..text_start + end_td])
                            .trim()
                            .to_string()
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

        if let Some(url) = href {
            if !url.is_empty() && !title.is_empty() {
                results.push(SearchResult {
                    title,
                    url,
                    snippet,
                });
            }
        }

        pos = link_start + 1;
        if results.len() >= 10 {
            break;
        }
    }

    results
}

/// Find a class attribute in HTML, matching both single and double quotes.
/// DuckDuckGo Lite uses single quotes (class='result-link') while other HTML
/// may use double quotes (class="result-link").
/// Returns the byte offset of the match within `html`, if found.
fn find_class_attr(html: &str, class_name: &str) -> Option<usize> {
    let double_quoted = format!("class=\"{class_name}\"");
    let single_quoted = format!("class='{class_name}'");
    match (html.find(&double_quoted), html.find(&single_quoted)) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// Extract an attribute value from an HTML tag string
fn extract_attribute(tag: &str, attr: &str) -> Option<String> {
    let pattern = format!("{attr}=\"");
    if let Some(start) = tag.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = tag[value_start..].find('"') {
            return Some(tag[value_start..value_start + end].to_string());
        }
    }
    // Also try single quotes
    let pattern = format!("{attr}='");
    if let Some(start) = tag.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = tag[value_start..].find('\'') {
            return Some(tag[value_start..value_start + end].to_string());
        }
    }
    None
}

/// Strip HTML tags from a string, returning only text content
fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    // Decode common HTML entities
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// Format search results as text suitable for inclusion in a tool result message
pub fn format_search_results(results: &[SearchResult]) -> String {
    if results.is_empty() {
        return "No search results found.".to_string();
    }
    results
        .iter()
        .enumerate()
        .map(|(i, r)| format!("{}. [{}]({})\n   {}", i + 1, r.title, r.url, r.snippet))
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_html_tags() {
        assert_eq!(strip_html_tags("<b>bold</b>"), "bold");
        assert_eq!(strip_html_tags("no tags"), "no tags");
        assert_eq!(strip_html_tags("<a href=\"x\">link</a> text"), "link text");
        assert_eq!(strip_html_tags("&amp; &lt; &gt;"), "& < >");
    }

    #[test]
    fn test_extract_attribute() {
        assert_eq!(
            extract_attribute(r#"<a href="https://example.com">"#, "href"),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            extract_attribute(r#"<a class="result-link" href="url">"#, "href"),
            Some("url".to_string())
        );
        assert_eq!(extract_attribute(r#"<a>"#, "href"), None);
    }

    #[test]
    fn test_parse_duckduckgo_lite_html() {
        let html = r#"
        <table>
            <tr>
                <td><a class="result-link" href="https://example.com">Example Title</a></td>
            </tr>
            <tr>
                <td class="result-snippet">This is a snippet about example.</td>
            </tr>
            <tr>
                <td><a class="result-link" href="https://test.org">Test Page</a></td>
            </tr>
            <tr>
                <td class="result-snippet">Another snippet here.</td>
            </tr>
        </table>
        "#;

        let results = parse_duckduckgo_lite_html(html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Example Title");
        assert_eq!(results[0].url, "https://example.com");
        assert_eq!(results[0].snippet, "This is a snippet about example.");
        assert_eq!(results[1].title, "Test Page");
        assert_eq!(results[1].url, "https://test.org");
    }

    #[test]
    fn test_parse_duckduckgo_lite_html_single_quotes() {
        // Real DuckDuckGo Lite uses single quotes for class attributes
        let html = r#"
        <table>
            <tr>
                <td valign="top">1.&nbsp;</td>
                <td><a rel="nofollow" href="https://rust-lang.org/" class='result-link'>Rust Programming Language</a></td>
            </tr>
            <tr>
                <td>&nbsp;&nbsp;&nbsp;</td>
                <td class='result-snippet'>Rust is a fast, reliable, and productive <b>programming</b> language.</td>
            </tr>
            <tr>
                <td valign="top">2.&nbsp;</td>
                <td><a rel="nofollow" href="https://en.wikipedia.org/wiki/Rust_(programming_language)" class='result-link'>Rust (programming language) - Wikipedia</a></td>
            </tr>
            <tr>
                <td>&nbsp;&nbsp;&nbsp;</td>
                <td class='result-snippet'>Rust is a general-purpose <b>programming</b> language.</td>
            </tr>
        </table>
        "#;

        let results = parse_duckduckgo_lite_html(html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Rust Programming Language");
        assert_eq!(results[0].url, "https://rust-lang.org/");
        assert_eq!(
            results[0].snippet,
            "Rust is a fast, reliable, and productive programming language."
        );
        assert_eq!(results[1].title, "Rust (programming language) - Wikipedia");
        assert_eq!(
            results[1].url,
            "https://en.wikipedia.org/wiki/Rust_(programming_language)"
        );
    }

    #[test]
    fn test_find_class_attr() {
        assert_eq!(find_class_attr(r#"class="foo""#, "foo"), Some(0));
        assert_eq!(find_class_attr("class='foo'", "foo"), Some(0));
        assert_eq!(find_class_attr("class='bar'", "foo"), None);
        // Single quote match should win when it appears first
        assert_eq!(
            find_class_attr("class='foo' class=\"foo\"", "foo"),
            Some(0)
        );
    }

    #[test]
    fn test_parse_empty_html() {
        let results = parse_duckduckgo_lite_html("<html><body></body></html>");
        assert!(results.is_empty());
    }

    #[test]
    fn test_format_search_results() {
        let results = vec![SearchResult {
            title: "Test".to_string(),
            url: "https://test.com".to_string(),
            snippet: "A test result".to_string(),
        }];
        let formatted = format_search_results(&results);
        assert!(formatted.contains("Test"));
        assert!(formatted.contains("https://test.com"));
    }

    #[test]
    fn test_format_empty_results() {
        let formatted = format_search_results(&[]);
        assert_eq!(formatted, "No search results found.");
    }
}
