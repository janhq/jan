//! Size cap for MCP tool results.
//!
//! A tool result is injected verbatim into conversation history, so one call to
//! a tool that dumps a whole page (Jan Browser MCP's snapshot, for instance) can
//! exhaust the model's context on its own, regardless of how large that context
//! is. Everything that hands an MCP result to a model funnels through here first
//! so the payload is bounded and the clipping is announced rather than silent.

use rmcp::model::{CallToolResult, Content};

/// Total text characters carried by a result, across every text block.
fn total_text_chars(result: &CallToolResult) -> usize {
    result
        .content
        .iter()
        .filter_map(|c| c.as_text())
        .map(|t| t.text.chars().count())
        .sum()
}

fn truncation_marker(retained: usize, total: usize) -> String {
    format!(
        "[Tool output truncated: {retained} of {total} characters retained. \
Increase \"Max tool output characters\" in Settings > MCP Servers to retain more.]"
    )
}

/// Cap the combined text of `result` at `max_chars`, appending a marker block
/// that reports how much was kept.
///
/// The budget spans all text blocks rather than each block individually, since
/// the model receives their concatenation. Blocks are filled in order: earlier
/// ones survive intact, the block that crosses the budget is cut mid-way, and
/// later ones are dropped. Non-text blocks (images, resources, audio) are never
/// counted or altered - they aren't the payload that blows up, and clipping
/// their base64 would corrupt them.
///
/// `max_chars == 0` disables the cap, which is how a user opts out.
pub fn truncate_tool_result(result: &CallToolResult, max_chars: u64) -> CallToolResult {
    if max_chars == 0 {
        return result.clone();
    }
    let max_chars = max_chars as usize;

    let total = total_text_chars(result);
    if total <= max_chars {
        return result.clone();
    }

    let mut used = 0usize;
    let mut new_content: Vec<Content> = Vec::with_capacity(result.content.len() + 1);

    for block in &result.content {
        let Some(text) = block.as_text() else {
            // Non-text block: pass through untouched.
            new_content.push(block.clone());
            continue;
        };

        if used >= max_chars {
            continue; // Budget spent; this block and the rest are dropped.
        }

        let len = text.text.chars().count();
        let keep = len.min(max_chars - used);
        used += keep;

        if keep == len {
            new_content.push(block.clone());
        } else {
            new_content.push(Content::text(
                text.text.chars().take(keep).collect::<String>(),
            ));
        }
    }

    new_content.push(Content::text(truncation_marker(used, total)));

    CallToolResult {
        content: new_content,
        structured_content: result.structured_content.clone(),
        is_error: result.is_error,
        meta: result.meta.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_result(parts: &[&str]) -> CallToolResult {
        CallToolResult::success(parts.iter().map(|p| Content::text(*p)).collect())
    }

    fn texts(result: &CallToolResult) -> Vec<String> {
        result
            .content
            .iter()
            .filter_map(|c| c.as_text())
            .map(|t| t.text.clone())
            .collect()
    }

    /// The web layer reads `content[].text` off the serialized result and feeds
    /// it straight into conversation history, so the cap has to hold on the wire,
    /// not just in the struct.
    #[test]
    fn serialized_result_the_web_layer_receives_is_bounded() {
        // Stand-in for a Jan Browser MCP page snapshot: one enormous text block.
        let snapshot = CallToolResult::success(vec![Content::text(
            "<div>page</div>".repeat(100_000),
        )]);

        let capped = truncate_tool_result(&snapshot, 40_000);
        let wire = serde_json::to_value(&capped).expect("serializes");

        let blocks = wire["content"].as_array().expect("content array");
        let wire_chars: usize = blocks
            .iter()
            .filter_map(|b| b["text"].as_str())
            .map(|t| t.chars().count())
            .sum();

        assert!(
            wire_chars < 41_000,
            "1.5M-char snapshot reached the model as {wire_chars} chars"
        );
        assert!(blocks
            .last()
            .and_then(|b| b["text"].as_str())
            .is_some_and(|t| t.contains("truncated")));
    }

    #[test]
    fn small_output_passes_through_untouched() {
        let result = text_result(&["hello world"]);
        let capped = truncate_tool_result(&result, 100);

        assert_eq!(texts(&capped), vec!["hello world".to_string()]);
        assert_eq!(capped.content.len(), 1, "no marker on untruncated output");
    }

    #[test]
    fn output_exactly_at_cap_is_not_truncated() {
        let result = text_result(&["0123456789"]);
        let capped = truncate_tool_result(&result, 10);

        assert_eq!(texts(&capped), vec!["0123456789".to_string()]);
        assert_eq!(capped.content.len(), 1);
    }

    #[test]
    fn oversized_output_is_capped_to_max_chars() {
        let result = text_result(&["x".repeat(5_000).as_str()]);
        let capped = truncate_tool_result(&result, 100);

        let retained: usize = capped
            .content
            .iter()
            .take(capped.content.len() - 1)
            .filter_map(|c| c.as_text())
            .map(|t| t.text.chars().count())
            .sum();
        assert_eq!(retained, 100);
    }

    #[test]
    fn truncation_marker_reports_retained_and_total() {
        let result = text_result(&["y".repeat(5_000).as_str()]);
        let capped = truncate_tool_result(&result, 100);

        let marker = texts(&capped).pop().expect("marker block");
        assert!(marker.contains("truncated"), "marker text: {marker}");
        assert!(marker.contains("100 of 5000"), "marker text: {marker}");
        assert!(
            marker.contains("Max tool output characters"),
            "marker points the user at the setting: {marker}"
        );
    }

    #[test]
    fn multi_block_budget_spans_all_text_blocks() {
        let result = text_result(&["aaaa", "bbbb", "cccc"]);
        let capped = truncate_tool_result(&result, 6);

        let blocks = texts(&capped);
        // First block intact, second cut mid-way, third dropped, marker appended.
        assert_eq!(blocks[0], "aaaa");
        assert_eq!(blocks[1], "bb");
        assert_eq!(blocks.len(), 3, "third block dropped, marker added: {blocks:?}");
        assert!(blocks[2].contains("6 of 12"), "marker text: {}", blocks[2]);
    }

    #[test]
    fn non_text_blocks_survive_truncation() {
        let result = CallToolResult::success(vec![
            Content::text("z".repeat(1_000)),
            Content::image("ZmFrZQ==".to_string(), "image/png".to_string()),
        ]);
        let capped = truncate_tool_result(&result, 10);

        assert!(
            capped.content.iter().any(|c| c.as_image().is_some()),
            "image block must not be dropped by the text cap"
        );
        assert_eq!(texts(&capped)[0].chars().count(), 10);
    }

    #[test]
    fn zero_max_chars_disables_the_cap() {
        let result = text_result(&["w".repeat(10_000).as_str()]);
        let capped = truncate_tool_result(&result, 0);

        assert_eq!(texts(&capped)[0].chars().count(), 10_000);
        assert_eq!(capped.content.len(), 1);
    }

    #[test]
    fn error_flag_and_structured_content_are_preserved() {
        let mut result = text_result(&["e".repeat(500).as_str()]);
        result.is_error = Some(true);
        result.structured_content = Some(serde_json::json!({ "code": 42 }));

        let capped = truncate_tool_result(&result, 10);

        assert_eq!(capped.is_error, Some(true));
        assert_eq!(
            capped.structured_content,
            Some(serde_json::json!({ "code": 42 }))
        );
    }

    #[test]
    fn multibyte_text_is_cut_on_char_boundaries() {
        let result = text_result(&["日本語テキスト".repeat(100).as_str()]);
        let capped = truncate_tool_result(&result, 5);

        assert_eq!(texts(&capped)[0], "日本語テキ");
    }
}
