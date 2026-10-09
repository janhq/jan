//! In-transcript search (`/find`, Ctrl-F, Enter / Shift-Enter).
//!
//! The transcript is a single scrollable pane, so search is narrow on purpose:
//! it never rebuilds or filters rows, it only records where matches are and
//! asks `draw` to move the viewport and paint highlight spans over the lines it
//! already materializes. Everything here is pure so the matching, wraparound and
//! highlighting rules are tested without a terminal.

use std::ops::Range;

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// One matching line: its transcript row, whether it sits in that row's folded
/// detail (what Ctrl-O or a click reveals) rather than the row itself, and the
/// line within that part. The field order makes the derived ordering top to
/// bottom as drawn, which is the order Enter walks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Hit {
    pub(super) row: usize,
    pub(super) detail: bool,
    pub(super) line: usize,
}

/// Active search state. Lives on `App` until Esc, a new turn, or a rebuilt
/// transcript clears it.
pub(super) struct Find {
    /// The term as typed; matching folds case on both sides.
    pub(super) term: String,
    /// Matches from the latest scan. Rescanned on every step, so rows that
    /// landed after the search started are reachable without searching again.
    pub(super) hits: Vec<Hit>,
    /// Index into `hits` of the current match, `None` when nothing matched.
    pub(super) current: Option<usize>,
    /// Set when the viewport owes a jump to the current match; `draw` consumes
    /// it, so manual scrolling afterwards is not fought every frame.
    pub(super) jump: bool,
}

impl Find {
    /// The current match location, if any.
    pub(super) fn current_hit(&self) -> Option<Hit> {
        self.current.and_then(|i| self.hits.get(i).copied())
    }
}

/// Lowercased `term`, or `None` when it is blank (nothing to search for).
/// Folded one char at a time like the text in `match_ranges`: `str::to_lowercase`
/// turns a word-final sigma into the final form, which the text side never does.
pub(super) fn needle(term: &str) -> Option<String> {
    let trimmed = term.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().flat_map(char::to_lowercase).collect())
}

/// Byte ranges in `text` where the already-lowercased `needle` occurs,
/// case-insensitively. Folding can change a character's byte length, so the
/// match is found in a folded copy and mapped back to whole source characters
/// rather than reusing the folded offsets.
pub(super) fn match_ranges(text: &str, needle: &str) -> Vec<Range<usize>> {
    if needle.is_empty() {
        return Vec::new();
    }
    let mut folded = String::with_capacity(text.len());
    // For each folded byte position where a source char's fold ends: that
    // char's source range.
    let mut spans: Vec<(usize, Range<usize>)> = Vec::with_capacity(text.len());
    for (start, ch) in text.char_indices() {
        for lower in ch.to_lowercase() {
            folded.push(lower);
        }
        spans.push((folded.len(), start..start + ch.len_utf8()));
    }
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = folded[from..].find(needle).map(|i| i + from) {
        let end = at + needle.len();
        let first = spans.partition_point(|(stop, _)| *stop <= at);
        let last = spans.partition_point(|(stop, _)| *stop < end);
        if let (Some(a), Some(b)) = (spans.get(first), spans.get(last)) {
            out.push(a.1.start..b.1.end);
        }
        from = end;
    }
    out
}

/// Plain text of a rendered line, the form matching runs against.
pub(super) fn line_text(line: &Line<'_>) -> String {
    line.spans.iter().map(|s| s.content.as_ref()).collect()
}

/// Every other match: reversed, so it reads on dark and light terminals alike
/// without picking a colour that one of them washes out.
fn match_style() -> Style {
    Style::new().add_modifier(Modifier::REVERSED)
}

/// The match the viewport jumped to: a solid band, so it stands apart from the
/// reversed ones around it.
fn current_style() -> Style {
    Style::new()
        .fg(Color::Black)
        .bg(Color::Yellow)
        .add_modifier(Modifier::BOLD)
}

/// `line` with every occurrence of `needle` painted over its own style. Spans
/// are split at match edges, so a match that straddles two styled spans is
/// still covered whole. A line without a match comes back unchanged. When
/// `current` is set the line is the jumped-to hit, and only its first match
/// gets the current style: hits are whole lines, so that is the one a step landed
/// on, and the rest stay reversed.
pub(super) fn highlight_line(line: Line<'static>, needle: &str, current: bool) -> Line<'static> {
    let ranges = match_ranges(&line_text(&line), needle);
    if ranges.is_empty() {
        return line;
    }
    let mut spans: Vec<Span<'static>> = Vec::with_capacity(line.spans.len() + ranges.len() * 2);
    let mut offset = 0;
    for span in line.spans {
        let text = span.content.as_ref();
        let (start, end) = (offset, offset + text.len());
        offset = end;
        let mut cut = start;
        for (n, r) in ranges.iter().enumerate() {
            if r.start >= end || r.end <= start {
                continue;
            }
            let paint = if current && n == 0 { current_style() } else { match_style() };
            let (a, b) = (r.start.max(start), r.end.min(end));
            if a > cut {
                spans.push(Span::styled(text[cut - start..a - start].to_string(), span.style));
            }
            spans.push(Span::styled(
                text[a - start..b - start].to_string(),
                span.style.patch(paint),
            ));
            cut = b;
        }
        if cut < end {
            spans.push(Span::styled(text[cut - start..].to_string(), span.style));
        }
    }
    Line {
        spans,
        ..line
    }
}

/// The match a fresh search lands on: the last one at or above `bottom_row`
/// (the lowest row on screen), so searching reads back through what led up to
/// the view, the way a terminal's scrollback search does. Falls back to the
/// first match when every one sits below the view.
pub(super) fn nearest(hits: &[Hit], bottom_row: usize) -> Option<usize> {
    if hits.is_empty() {
        return None;
    }
    Some(
        hits.iter()
            .rposition(|h| h.row <= bottom_row)
            .unwrap_or(0),
    )
}

/// Index of the match after (`forward`) or before `from`, wrapping at either
/// end. `from` is a location rather than an index because `hits` is rescanned
/// between steps and the old index may name a different match.
pub(super) fn step(hits: &[Hit], from: Hit, forward: bool) -> Option<usize> {
    if hits.is_empty() {
        return None;
    }
    let found = if forward {
        hits.iter().position(|h| *h > from)
    } else {
        hits.iter().rposition(|h| *h < from)
    };
    Some(found.unwrap_or(if forward { 0 } else { hits.len() - 1 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(row: usize, line: usize) -> Hit {
        Hit {
            row,
            detail: false,
            line,
        }
    }

    #[test]
    fn match_ranges_is_case_insensitive_and_finds_every_occurrence() {
        assert_eq!(match_ranges("Foo foo FOO", "foo"), vec![0..3, 4..7, 8..11]);
        assert!(match_ranges("bar", "foo").is_empty());
        assert!(match_ranges("bar", "").is_empty());
    }

    #[test]
    fn match_ranges_maps_folded_offsets_back_to_source_chars() {
        // U+0130 lowercases to two chars (`i` + combining dot), so folded
        // offsets drift from source offsets after it.
        let text = "\u{130}x Stra\u{df}e";
        let ranges = match_ranges(text, "stra\u{df}e");
        assert_eq!(ranges.len(), 1);
        assert_eq!(&text[ranges[0].clone()], "Stra\u{df}e");
    }

    #[test]
    fn needle_trims_and_rejects_blank_terms() {
        assert_eq!(needle("  Foo "), Some("foo".to_string()));
        assert_eq!(needle("   "), None);
    }

    #[test]
    fn needle_folds_a_final_sigma_like_the_text() {
        // Capital omicron, delta, omicron, sigma: the sigma ends the word.
        let word = "\u{39f}\u{394}\u{39f}\u{3a3}";
        let n = needle(word).unwrap();
        assert_eq!(match_ranges(word, &n).len(), 1);
    }

    #[test]
    fn highlight_splits_spans_at_match_edges() {
        let line = Line::from(vec![
            Span::styled("say he", Style::new().green()),
            Span::styled("llo there", Style::new().blue()),
        ]);
        let out = highlight_line(line.clone(), "hello", false);
        assert_eq!(line_text(&out), line_text(&line), "text is unchanged");
        let painted: String = out
            .spans
            .iter()
            .filter(|s| s.style.add_modifier.contains(Modifier::REVERSED))
            .map(|s| s.content.as_ref())
            .collect();
        assert_eq!(painted, "hello");
        // Each half keeps its own colour under the highlight.
        assert!(out
            .spans
            .iter()
            .any(|s| s.content == "he" && s.style.fg == Some(Color::Green)));
        assert!(out
            .spans
            .iter()
            .any(|s| s.content == "llo" && s.style.fg == Some(Color::Blue)));
    }

    #[test]
    fn highlight_marks_the_current_match_distinctly() {
        let out = highlight_line(Line::raw("a needle"), "needle", true);
        let hit = out.spans.iter().find(|s| s.content == "needle").unwrap();
        assert_eq!(hit.style.bg, Some(Color::Yellow));
        let plain = highlight_line(Line::raw("no match here"), "needle", true);
        assert_eq!(plain, Line::raw("no match here"));
    }

    #[test]
    fn only_the_first_match_on_the_current_line_gets_the_current_style() {
        let out = highlight_line(Line::raw("needle and needle"), "needle", true);
        let bands: Vec<bool> = out
            .spans
            .iter()
            .filter(|s| s.content == "needle")
            .map(|s| s.style.bg == Some(Color::Yellow))
            .collect();
        assert_eq!(bands, vec![true, false]);
    }

    #[test]
    fn nearest_prefers_the_last_match_at_or_above_the_view() {
        let hits = [hit(2, 0), hit(5, 1), hit(9, 0)];
        assert_eq!(nearest(&hits, 6), Some(1));
        assert_eq!(nearest(&hits, 9), Some(2));
        assert_eq!(nearest(&hits, 1), Some(0), "all below: first match");
        assert_eq!(nearest(&[], 3), None);
    }

    #[test]
    fn step_wraps_at_both_ends() {
        let hits = [hit(1, 0), hit(1, 3), hit(4, 0)];
        assert_eq!(step(&hits, hit(1, 0), true), Some(1));
        assert_eq!(step(&hits, hit(4, 0), true), Some(0), "next wraps to first");
        assert_eq!(step(&hits, hit(1, 0), false), Some(2), "prev wraps to last");
        assert_eq!(step(&hits, hit(4, 0), false), Some(1));
        // A location that is no longer a hit still steps relative to it.
        assert_eq!(step(&hits, hit(2, 0), true), Some(2));
        assert_eq!(step(&[], hit(0, 0), true), None);
    }

    #[test]
    fn detail_lines_order_after_their_row() {
        let detail = Hit {
            row: 1,
            detail: true,
            line: 0,
        };
        assert!(hit(1, 9) < detail && detail < hit(2, 0));
    }
}
