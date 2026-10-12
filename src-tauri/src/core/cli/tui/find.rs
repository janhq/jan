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

/// One matching logical line: its transcript row, whether it sits in that row's
/// folded detail (what Ctrl-O or a click reveals) rather than the row itself,
/// and the line within that part as the row says it before the terminal wraps
/// it. That index does not move when the window resizes, which is what keeps the
/// hit count and the current hit steady. The field order makes the derived
/// ordering top to bottom as drawn, which is the order Enter walks.
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

/// The width a row is rendered at to read what it says before the terminal
/// cuts it into lines. Wide enough that prose does not wrap in practice; a
/// band that pads to the width (a user turn) stays cheap at this size.
pub(super) const FLAT_WIDTH: u16 = 2000;

/// `lines` as text, one entry per line, trailing blanks dropped: a row's
/// unwrapped form when `lines` were rendered at [`FLAT_WIDTH`]. Each entry is a
/// *logical* line, whose index does not depend on the terminal width.
pub(super) fn flat_text(lines: &[Line<'_>]) -> Vec<String> {
    lines
        .iter()
        .map(|l| line_text(l).trim_end().to_string())
        .collect()
}

/// One place the search term occurs.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Occurrence {
    /// The logical (unwrapped) line it sits in: the identity of a `Hit`, so the
    /// hit count and what Enter walks do not change when the window resizes.
    pub(super) logical: usize,
    /// Where it lands on the lines as rendered at the current width: one
    /// (rendered line, byte range in that line's text) per line it spans. A
    /// term that word-wrapped has a piece on each line.
    pub(super) pieces: Vec<(usize, Range<usize>)>,
}

/// Every occurrence of the already-lowercased `needle` in a row part, matched
/// against its unwrapped text `flat` (see [`flat_text`]) and mapped back onto
/// `lines`, the part as rendered at the current width. Without `flat` the
/// rendered lines are the text.
///
/// The mapping lines the two renderings up by their non-blank characters, so a
/// wrap that swallows a space, or a gutter glyph repeated on a continuation
/// line, does not matter. When they do not line up (a table re-laid out, a
/// label cut short at a narrow width) the rendered lines are searched on their
/// own, as they were before the term could span lines.
pub(super) fn occurrences(
    lines: &[Line<'_>],
    flat: Option<&[String]>,
    needle: &str,
) -> Vec<Occurrence> {
    let rendered: Vec<String> = lines.iter().map(line_text).collect();
    let Some(flat) = flat else {
        return per_line(&rendered, needle);
    };
    let found: Vec<(usize, Range<usize>)> = flat
        .iter()
        .enumerate()
        .flat_map(|(l, text)| match_ranges(text, needle).into_iter().map(move |r| (l, r)))
        .collect();
    if found.is_empty() {
        return Vec::new();
    }
    // Nothing wrapped at this width: the unwrapped ranges are the pieces.
    if rendered.len() == flat.len()
        && rendered
            .iter()
            .zip(flat)
            .all(|(shown, whole)| shown.trim_end() == whole)
    {
        return found
            .into_iter()
            .map(|(l, r)| Occurrence {
                logical: l,
                pieces: vec![(l, r)],
            })
            .collect();
    }
    let (whole, shown) = (Glyphs::of(flat), Glyphs::of(&rendered));
    let Some(map) = whole.onto(&shown) else {
        return per_line(&rendered, needle);
    };
    found
        .into_iter()
        .filter_map(|(logical, range)| {
            let mut pieces: Vec<(usize, Range<usize>)> = Vec::new();
            for g in whole.within(logical, &range) {
                let (line, at) = shown.at[map[g]];
                let end = at + shown.chars[map[g]].len_utf8();
                match pieces.last_mut() {
                    Some((l, r)) if *l == line => r.end = end,
                    _ => pieces.push((line, at..end)),
                }
            }
            (!pieces.is_empty()).then_some(Occurrence { logical, pieces })
        })
        .collect()
}

/// Occurrences inside single lines, each its own logical line.
fn per_line(texts: &[String], needle: &str) -> Vec<Occurrence> {
    texts
        .iter()
        .enumerate()
        .flat_map(|(l, text)| {
            match_ranges(text, needle)
                .into_iter()
                .map(move |r| Occurrence {
                    logical: l,
                    pieces: vec![(l, r)],
                })
        })
        .collect()
}

/// The non-blank characters of some lines, and where each one sits.
struct Glyphs {
    chars: Vec<char>,
    /// (line, byte offset) of each character.
    at: Vec<(usize, usize)>,
    /// Index in `chars` of each line's first character, then `chars.len()`.
    starts: Vec<usize>,
}

impl Glyphs {
    fn of(texts: &[String]) -> Glyphs {
        let mut g = Glyphs {
            chars: Vec::new(),
            at: Vec::new(),
            starts: Vec::new(),
        };
        for (line, text) in texts.iter().enumerate() {
            g.starts.push(g.chars.len());
            for (byte, c) in text.char_indices().filter(|(_, c)| !c.is_whitespace()) {
                g.chars.push(c);
                g.at.push((line, byte));
            }
        }
        g.starts.push(g.chars.len());
        g
    }

    /// Indices of the characters of `line` inside `range`.
    fn within(&self, line: usize, range: &Range<usize>) -> Range<usize> {
        let (from, to) = (self.starts[line], self.starts[line + 1]);
        let before = |at: usize| self.at[from..to].partition_point(|&(_, byte)| byte < at);
        from + before(range.start)..from + before(range.end)
    }

    /// For each of this one's characters, the index of the same character in
    /// `other`, which may carry extras (a gutter glyph repeated on every
    /// continuation line). `None` when this one has text `other` does not.
    ///
    /// A line of only rule glyphs (a horizontal rule, a box border) is as wide
    /// as the render it came from, so this one has far more of them than a
    /// narrower `other`. Such a line is mapped as a unit onto the matching line
    /// of `other`, its surplus glyphs landing on that line's last one.
    fn onto(&self, other: &Glyphs) -> Option<Vec<usize>> {
        let mut map = Vec::with_capacity(self.chars.len());
        let mut next = 0;
        for line in 0..self.starts.len() - 1 {
            let (from, to) = (self.starts[line], self.starts[line + 1]);
            let own = &self.chars[from..to];
            if !own.is_empty() && own.iter().all(|&c| is_rule_glyph(c)) {
                if let Some(&(shown, _)) = other.at.get(next) {
                    let (a, b) = (other.starts[shown], other.starts[shown + 1]);
                    if a == next && other.chars[a..b].iter().all(|&c| is_rule_glyph(c)) {
                        map.extend((0..own.len()).map(|k| a + k.min(b - a - 1)));
                        next = b;
                        continue;
                    }
                }
            }
            for c in own {
                let skip = other.chars[next..].iter().position(|o| o == c)?;
                map.push(next + skip);
                next += skip + 1;
            }
        }
        Some(map)
    }
}

/// Glyphs a horizontal rule or a box border is drawn with.
fn is_rule_glyph(c: char) -> bool {
    matches!(c, '-' | '+' | '|' | '=' | '_') || ('\u{2500}'..='\u{257F}').contains(&c)
}

/// `line` with `ranges` painted over its own styles, in order. Spans are split
/// at the edges, so a range that straddles two styled spans is still covered
/// whole. A `true` range is the match the viewport jumped to and gets the
/// current style; the rest are reversed.
pub(super) fn highlight_ranges(
    line: Line<'static>,
    ranges: &[(Range<usize>, bool)],
) -> Line<'static> {
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
        for (r, current) in ranges {
            if r.start >= end || r.end <= start {
                continue;
            }
            let paint = if *current { current_style() } else { match_style() };
            let (a, b) = (r.start.max(start).max(cut), r.end.min(end));
            if b <= a {
                continue;
            }
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
    Line { spans, ..line }
}

/// `lines` with every occurrence painted, each piece onto the line it landed
/// on. `current` is the logical line of the jumped-to hit: only its first
/// occurrence gets the current style, so the one a step landed on stands apart
/// from the rest of the line.
pub(super) fn paint_lines(
    lines: Vec<Line<'static>>,
    found: &[Occurrence],
    current: Option<usize>,
) -> Vec<Line<'static>> {
    if found.is_empty() {
        return lines;
    }
    let mut ranges: Vec<Vec<(Range<usize>, bool)>> = vec![Vec::new(); lines.len()];
    let mut landed = false;
    for o in found {
        let is_current = current == Some(o.logical) && !std::mem::replace(&mut landed, true);
        for (line, range) in &o.pieces {
            if let Some(on_line) = ranges.get_mut(*line) {
                on_line.push((range.clone(), is_current));
            }
        }
    }
    lines
        .into_iter()
        .zip(ranges)
        .map(|(line, on_line)| highlight_ranges(line, &on_line))
        .collect()
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
        let out = paint(line.clone(), "hello", false);
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
        let out = paint(Line::raw("a needle"), "needle", true);
        let hit = out.spans.iter().find(|s| s.content == "needle").unwrap();
        assert_eq!(hit.style.bg, Some(Color::Yellow));
        let plain = paint(Line::raw("no match here"), "needle", true);
        assert_eq!(plain, Line::raw("no match here"));
    }

    #[test]
    fn only_the_first_match_on_the_current_line_gets_the_current_style() {
        let out = paint(Line::raw("needle and needle"), "needle", true);
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

    /// `needle` painted onto one unwrapped line the way `draw` does it, with the
    /// first match as the current one when `current`.
    fn paint(line: Line<'static>, needle: &str, current: bool) -> Line<'static> {
        let ranges: Vec<(Range<usize>, bool)> = match_ranges(&line_text(&line), needle)
            .into_iter()
            .enumerate()
            .map(|(n, r)| (r, current && n == 0))
            .collect();
        highlight_ranges(line, &ranges)
    }

    fn rows(texts: &[&str]) -> Vec<Line<'static>> {
        texts.iter().map(|t| Line::raw(t.to_string())).collect()
    }

    fn flat(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|t| t.to_string()).collect()
    }

    /// The text each piece of `o` covers on `lines`.
    fn covered(lines: &[&str], o: &Occurrence) -> Vec<String> {
        o.pieces
            .iter()
            .map(|(l, r)| lines[*l][r.clone()].to_string())
            .collect()
    }

    #[test]
    fn a_term_that_wraps_across_two_lines_is_found_with_a_piece_on_each() {
        let shown = ["• the quick brown", "  fox jumps"];
        let found = occurrences(
            &rows(&shown),
            Some(&flat(&["• the quick brown fox jumps"])),
            "brown fox",
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].logical, 0);
        assert_eq!(covered(&shown, &found[0]), vec!["brown", "fox"]);
    }

    #[test]
    fn the_count_is_the_same_at_every_width() {
        let whole = flat(&["foo bar foo bar"]);
        for shown in [
            vec!["foo bar foo bar"],
            vec!["foo bar", "foo bar"],
            vec!["foo", "bar foo", "bar"],
            vec!["foo", "bar", "foo", "bar"],
        ] {
            let found = occurrences(&rows(&shown), Some(&whole), "foo bar");
            assert_eq!(found.len(), 2, "{shown:?}");
            assert!(found.iter().all(|o| o.logical == 0), "{shown:?}");
            // However it wrapped, each occurrence covers all of "foo bar".
            for o in &found {
                assert_eq!(
                    covered(&shown, o).join(" ").replace("  ", " "),
                    "foo bar",
                    "{shown:?}"
                );
            }
        }
    }

    // Lines that are separate in the source stay separate: a term does not run
    // from the end of one paragraph into the next.
    #[test]
    fn a_term_does_not_span_a_real_line_break() {
        let found = occurrences(
            &rows(&["alpha", "beta"]),
            Some(&flat(&["alpha", "beta"])),
            "alpha beta",
        );
        assert!(found.is_empty());
    }

    #[test]
    fn a_gutter_glyph_repeated_on_each_continuation_line_is_skipped() {
        let shown = ["│ alpha beta", "│ gamma delta"];
        let found = occurrences(
            &rows(&shown),
            Some(&flat(&["│ alpha beta gamma delta"])),
            "beta gamma",
        );
        assert_eq!(found.len(), 1);
        assert_eq!(covered(&shown, &found[0]), vec!["beta", "gamma"]);
    }

    #[test]
    fn each_logical_line_keeps_its_own_index() {
        let shown = ["one hit", "two", "again hit"];
        let found = occurrences(&rows(&shown), Some(&flat(&shown)), "hit");
        assert_eq!(
            found.iter().map(|o| o.logical).collect::<Vec<_>>(),
            vec![0, 2]
        );
    }

    // The rendered lines differ from the unwrapped text beyond wrapping (a
    // label cut short at a narrow width), so there is nothing to map onto:
    // search what is shown, and never invent a match for text that is not.
    #[test]
    fn text_that_is_not_on_screen_is_not_matched() {
        let shown = rows(&["label long…"]);
        let whole = flat(&["label long enough to be cut"]);
        assert!(occurrences(&shown, Some(&whole), "enough").is_empty());
        let found = occurrences(&shown, Some(&whole), "label");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].pieces, vec![(0, 0..5)]);
    }

    #[test]
    fn without_unwrapped_text_each_rendered_line_is_searched_on_its_own() {
        let found = occurrences(&rows(&["a hit", "no", "hit hit"]), None, "hit");
        assert_eq!(found.len(), 3);
        assert_eq!(found[2].logical, 2);
    }

    // A rule or a box border is as wide as the render it is in, so the
    // unwrapped text carries far more of its glyphs than the narrow render.
    // That must not cost the rest of the region its wrap-aware matching.
    #[test]
    fn a_rule_or_box_border_does_not_stop_a_wrapped_term_being_found() {
        let rule = "-".repeat(40);
        let border = format!("+{}+", "-".repeat(38));
        let shown = [
            "the quick brown",
            "fox jumps",
            "-----",
            "+---+",
            "| code |",
            "+---+",
        ];
        let whole = [
            "the quick brown fox jumps".to_string(),
            rule,
            border.clone(),
            "| code |".to_string(),
            border,
        ];
        let found = occurrences(&rows(&shown), Some(&whole), "brown fox");
        assert_eq!(found.len(), 1);
        assert_eq!(covered(&shown, &found[0]), vec!["brown", "fox"]);
        let found = occurrences(&rows(&shown), Some(&whole), "code");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].logical, 3);
        assert_eq!(covered(&shown, &found[0]), vec!["code"]);
    }

    #[test]
    fn a_wrapped_term_is_painted_on_both_lines() {
        let shown = ["say hel", "lo there"];
        // "hel" and "lo" are two pieces of one occurrence, painted on their own lines.
        let found = occurrences(&rows(&shown), Some(&flat(&["say hello there"])), "hello");
        assert_eq!(found.len(), 1);
        let painted: Vec<String> = (0..2)
            .map(|l| {
                let ranges: Vec<(Range<usize>, bool)> = found
                    .iter()
                    .flat_map(|o| {
                        o.pieces
                            .iter()
                            .filter(|(pl, _)| *pl == l)
                            .map(|(_, r)| (r.clone(), true))
                    })
                    .collect();
                highlight_ranges(Line::raw(shown[l].to_string()), &ranges)
                    .spans
                    .iter()
                    .filter(|s| s.style.bg == Some(Color::Yellow))
                    .map(|s| s.content.as_ref())
                    .collect()
            })
            .collect();
        assert_eq!(painted, vec!["hel", "lo"]);
    }
}
