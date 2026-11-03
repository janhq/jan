//! The one layout every transcript event shares: a marker (`TOOL_BULLET` or a
//! category glyph) and a title, then what the event has to say hung under it
//! as a tree: the first child behind `TREE_FIRST`'s corner, every later row
//! aligned under it by `TREE_REST`.
//!
//! A child may itself be an event, which nests the same shape one level in
//! (title, then subtitle, then description), so an expanded tool group, a
//! subagent row and a note all read alike. Tool calls, subagent rows, notes,
//! errors, compaction and memory reports, turn receipts: each builds an
//! `TranscriptEvent` and lets this module lay it out, instead of carrying a layout of
//! its own.
//!
//! An event that is not an internal agent shows its name and a one-line
//! summary; what it holds beyond that is `detail` (see `EventRow`), drawn only
//! while its step is in progress or once the user expands it.
//!
//! Internal agents (compaction, memory tidy; janhq/jan-internal#511) plug in
//! here rather than with a layout of their own: build an `EventRow` whose
//! title names the agent, whose one child is its summary, and whose `detail`
//! is its run; push it with `Transcript::push_event`, `live` while the agent
//! runs, and `Transcript::end_step` folds it when the step ends. Today both
//! still report through the shared note path (`App::note`).

use ratatui::style::Style;
use ratatui::text::{Line, Span};

use super::{
    child_prefix, clip_spans, diff_lines, gutter_lines, wrap_spans_hard, DIFF_MAX_ROWS,
    ELAPSED_RESERVE, TOOL_ROW_MAX_LINES, TOOL_ROW_RESERVE, TREE_REST,
};

/// How a title or child row meets the width: wrapped onto as many rows as it
/// needs; wrapped but capped at `TOOL_ROW_MAX_LINES` title rows (a tool call,
/// whose heredoc would otherwise push the conversation off screen); or cut to
/// one row with an ellipsis (a folded summary, whose height must not depend on
/// what it summarizes).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Fit {
    Wrap,
    Cap,
    Clip,
}

/// One row under an event's title.
#[derive(Clone)]
pub(super) enum Child {
    /// A subtitle or description, laid out by the event's `Fit`.
    Text(Vec<Span<'static>>),
    /// A nested event: its own marker and title, its children one level in.
    Nested(TranscriptEvent),
    /// A diff body, highlighted for `lang` when the path names one.
    Diff { diff: String, lang: Option<String> },
}

impl Child {
    /// A plain text child in one style.
    pub(super) fn text(text: impl Into<String>, style: Style) -> Child {
        Child::Text(vec![Span::styled(text.into(), style)])
    }
}

#[derive(Clone)]
pub(super) struct TranscriptEvent {
    /// The gutter mark: a state-coloured bullet, or a category or severity
    /// glyph, with its trailing space.
    pub(super) marker: Span<'static>,
    pub(super) title: Vec<Span<'static>>,
    /// Chrome riding the end of the title (an elapsed badge, a change count).
    /// The wrap holds back at least `ELAPSED_RESERVE` for it, so a ticking
    /// counter never re-flows the title above it.
    pub(super) suffix: Vec<Span<'static>>,
    pub(super) children: Vec<Child>,
    pub(super) fit: Fit,
}

/// Columns kept clear right of a child's text, matching what the title's
/// `TOOL_ROW_RESERVE` leaves past its marker.
const RIGHT_MARGIN: usize = 2;

impl TranscriptEvent {
    pub(super) fn new(marker: Span<'static>, title: Vec<Span<'static>>) -> Self {
        TranscriptEvent {
            marker,
            title,
            suffix: Vec::new(),
            children: Vec::new(),
            fit: Fit::Wrap,
        }
    }

    pub(super) fn suffix(mut self, suffix: Vec<Span<'static>>) -> Self {
        self.suffix = suffix;
        self
    }

    pub(super) fn capped(mut self) -> Self {
        self.fit = Fit::Cap;
        self
    }

    pub(super) fn child(mut self, child: Child) -> Self {
        self.children.push(child);
        self
    }

    pub(super) fn children(mut self, children: impl IntoIterator<Item = Child>) -> Self {
        self.children.extend(children);
        self
    }

    pub(super) fn clipped(mut self) -> Self {
        self.fit = Fit::Clip;
        self
    }

    /// The title, then the children as a tree opening on its corner.
    pub(super) fn lines(&self, width: u16) -> Vec<Line<'static>> {
        let mut out = self.title_lines(width);
        out.extend(tree_lines(&self.children, self.fit, width, true));
        out
    }

    /// The marker beside the title; a wrapped title's later rows align under
    /// the first one's text. The running and finished forms of one event wrap
    /// identically: the marker is one width in every state, and the suffix's
    /// room is held back whatever it currently says.
    fn title_lines(&self, width: u16) -> Vec<Line<'static>> {
        let lead = self.marker.width();
        if self.fit == Fit::Clip {
            let mut spans = vec![self.marker.clone()];
            spans.extend(self.title.iter().cloned());
            spans.extend(self.suffix.iter().cloned());
            return vec![Line::from(clip_ellipsis(spans, width as usize))];
        }
        let held = if self.suffix.is_empty() {
            0
        } else {
            self.suffix.iter().map(Span::width).sum::<usize>().max(ELAPSED_RESERVE)
        };
        let max = (width.saturating_sub(TOOL_ROW_RESERVE) as usize)
            .saturating_sub(held)
            .max(1);
        let mut rows = wrap_spans_hard(self.title.clone(), max);
        if self.fit == Fit::Cap && rows.len() > TOOL_ROW_MAX_LINES {
            rows.truncate(TOOL_ROW_MAX_LINES);
            if let Some(last) = rows.last_mut() {
                last.push(Span::raw(" \u{2026}"));
            }
        }
        rows.last_mut()
            .expect("wrap_spans_hard yields at least one row")
            .extend(self.suffix.iter().cloned());
        gutter_lines(rows, vec![self.marker.clone()], vec![Span::raw(" ".repeat(lead))])
    }
}

/// `children` hung as a tree: the corner on the first row when `corner`, the aligned
/// blank prefix on every other, so a caller continuing a tree another row
/// opened (an expanded region under its summary) passes `false`.
pub(super) fn tree_lines(
    children: &[Child],
    fit: Fit,
    width: u16,
    corner: bool,
) -> Vec<Line<'static>> {
    // `TREE_REST` is ASCII, so its byte length is the tree's display width;
    // the corner's is not.
    let inner = width.saturating_sub(TREE_REST.len() as u16).max(1);
    let max = (inner as usize).saturating_sub(RIGHT_MARGIN).max(1);
    let mut out: Vec<Line<'static>> = Vec::new();
    for child in children {
        let rows: Vec<Line<'static>> = match child {
            Child::Text(spans) => match fit {
                Fit::Wrap | Fit::Cap => wrap_spans_hard(spans.clone(), max)
                    .into_iter()
                    .map(Line::from)
                    .collect(),
                Fit::Clip => vec![Line::from(clip_ellipsis(spans.clone(), max))],
            },
            Child::Nested(event) => event.lines(inner),
            Child::Diff { diff, lang } => {
                diff_lines(diff, inner as usize, DIFF_MAX_ROWS, "", lang.as_deref())
            }
        };
        for row in rows {
            let first = corner && out.is_empty();
            let mut spans = vec![if first {
                child_prefix(true)
            } else {
                Span::raw(TREE_REST)
            }];
            spans.extend(row.spans);
            out.push(Line::from(spans).style(row.style));
        }
    }
    out
}

/// `spans` cut to `max` columns, the last kept column given to an ellipsis
/// when anything was cut, so a clipped row always shows that it was.
fn clip_ellipsis(spans: Vec<Span<'static>>, max: usize) -> Vec<Span<'static>> {
    let total: usize = spans.iter().map(Span::width).sum();
    if total <= max {
        return spans;
    }
    let mut out = clip_spans(spans, max.saturating_sub(1));
    // A cut that lands on a space would float the ellipsis off the word.
    if let Some(last) = out.last_mut() {
        let kept = last.content.trim_end().to_string();
        last.content = kept.into();
    }
    let style = out.last().map(|s| s.style).unwrap_or_default();
    out.push(Span::styled("\u{2026}", style));
    out
}

/// An event row in the transcript: the event as it always shows (its name and
/// summary), and the `detail` it opens to. `live` is whether the event happens
/// as part of the agent's step, which holds it open until that step finishes
/// (see `Transcript::end_step`); an event reported after the fact (a tidy
/// report, an error) starts folded.
#[derive(Clone)]
pub(super) struct EventRow {
    pub(super) event: TranscriptEvent,
    pub(super) detail: Vec<Child>,
    pub(super) live: bool,
}

impl EventRow {
    /// A row with nothing folded away.
    pub(super) fn plain(event: TranscriptEvent) -> EventRow {
        EventRow {
            event,
            detail: Vec::new(),
            live: false,
        }
    }

    /// The detail as it hangs under the folded row: it opens the tree when the
    /// event has no summary, else carries the summary's tree on.
    pub(super) fn detail_lines(&self, width: u16) -> Vec<Line<'static>> {
        tree_lines(&self.detail, Fit::Wrap, width, self.event.children.is_empty())
    }

    /// The row folded (its name and summary) or opened (the summary followed
    /// by the detail, on the same tree).
    pub(super) fn lines(&self, width: u16, expanded: bool) -> Vec<Line<'static>> {
        let mut out = self.event.lines(width);
        if expanded {
            out.extend(self.detail_lines(width));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::cli::tui::TOOL_BULLET;

    fn text(lines: &[Line<'_>]) -> String {
        lines
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn bullet() -> Span<'static> {
        Span::raw(TOOL_BULLET)
    }

    fn title(s: &str) -> Vec<Span<'static>> {
        vec![Span::raw(s.to_string())]
    }

    fn sample() -> EventRow {
        EventRow {
            event: TranscriptEvent::new(bullet(), title("Memory tidied"))
                .child(Child::text("archived 2, merged 1", Style::new())),
            detail: vec![
                Child::text("archived old-notes", Style::new()),
                Child::text("archived pr-1", Style::new()),
                Child::text("merged a into b", Style::new()),
            ],
            live: false,
        }
    }

    #[test]
    fn a_folded_event_is_its_name_and_summary() {
        assert_eq!(
            text(&sample().lines(60, false)),
            "\u{2022} Memory tidied\n  \u{2514} archived 2, merged 1"
        );
    }

    #[test]
    fn an_expanded_event_carries_its_detail_on_the_same_tree() {
        assert_eq!(
            text(&sample().lines(60, true)),
            concat!(
                "\u{2022} Memory tidied\n",
                "  \u{2514} archived 2, merged 1\n",
                "    archived old-notes\n",
                "    archived pr-1\n",
                "    merged a into b",
            )
        );
    }

    /// Without a summary the detail opens the tree itself.
    #[test]
    fn detail_without_a_summary_takes_the_corner() {
        let row = EventRow {
            event: TranscriptEvent::new(bullet(), title("Dispatched review")),
            detail: vec![Child::text("Review the store.", Style::new())],
            live: true,
        };
        assert_eq!(text(&row.lines(60, false)), "\u{2022} Dispatched review");
        assert_eq!(
            text(&row.lines(60, true)),
            "\u{2022} Dispatched review\n  \u{2514} Review the store."
        );
    }

    #[test]
    fn nested_events_repeat_the_shape_one_level_in() {
        let call = TranscriptEvent::new(bullet(), title("Ran cargo test"))
            .child(Child::text("ok", Style::new()));
        let group = TranscriptEvent::new(bullet(), title("Worked"))
            .child(Child::Nested(call.clone()))
            .child(Child::Nested(call));
        assert_eq!(
            text(&group.lines(60)),
            concat!(
                "\u{2022} Worked\n",
                "  \u{2514} \u{2022} Ran cargo test\n",
                "      \u{2514} ok\n",
                "    \u{2022} Ran cargo test\n",
                "      \u{2514} ok",
            )
        );
    }

    /// A narrow terminal wraps the title under its own text and every child
    /// under the tree, never past the width.
    #[test]
    fn a_narrow_terminal_wraps_title_and_children_inside_the_tree() {
        let event = TranscriptEvent::new(bullet(), title("Compacted 12 messages into a summary"))
            .child(Child::text("the prompt neared the context window", Style::new()));
        let lines = event.lines(24);
        assert_eq!(
            text(&lines),
            concat!(
                "\u{2022} Compacted 12\n",
                "  messages into a\n",
                "  summary\n",
                "  \u{2514} the prompt neared\n",
                "    the context window",
            )
        );
        assert!(lines.iter().all(|l| l.width() <= 24), "{}", text(&lines));
    }

    /// A tool call's title is capped so a heredoc cannot bury the screen, and
    /// its suffix keeps its room whatever it says.
    #[test]
    fn a_capped_title_elides_past_its_row_budget_and_keeps_the_suffix() {
        let long = "word ".repeat(200);
        let event = TranscriptEvent::new(bullet(), title(&long))
            .suffix(vec![Span::raw(" (3s)")])
            .capped();
        let lines = event.lines(40);
        assert_eq!(lines.len(), TOOL_ROW_MAX_LINES);
        let last = text(&lines[TOOL_ROW_MAX_LINES - 1..]);
        assert!(last.ends_with("\u{2026} (3s)"), "{last}");
        assert!(lines.iter().all(|l| l.width() <= 40), "{}", text(&lines));
    }

    #[test]
    fn a_clipped_event_holds_one_row_each_and_marks_the_cut() {
        let event = TranscriptEvent::new(bullet(), title("Worked \u{b7} 12 tool calls"))
            .child(Child::text("Read 4 files; ran 3 commands", Style::new()))
            .clipped();
        let lines = event.lines(20);
        assert_eq!(
            text(&lines),
            "\u{2022} Worked \u{b7} 12 tool\u{2026}\n  \u{2514} Read 4 files;\u{2026}"
        );
        assert!(lines.iter().all(|l| l.width() <= 20), "{}", text(&lines));
    }
}
