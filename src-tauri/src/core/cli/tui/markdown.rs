//! Markdown rendering for the chat transcript: assistant text in, styled
//! ratatui lines out. Kept separate from the render loop so the block-level
//! theme lives in one place.

use ratatui::prelude::*;

/// Render assistant text to styled lines: reasoning dimmed, answer prose passed
/// through markdown formatting. `width` bounds table wrapping.
pub(super) fn format_assistant_lines(text: &str, width: u16) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    for (reasoning, seg) in super::split_reasoning(text) {
        if reasoning {
            lines.extend(reasoning_detail_lines(&seg));
        } else {
            lines.extend(format_markdown_lines(&seg, width));
        }
    }
    lines
}

/// Live tail rendering for the in-progress assistant buffer. With reasoning
/// folding on (`fold_reasoning`), an open (unterminated) think block is hidden
/// entirely so the user sees only the answer prose stream, matching the
/// `[thinking]` header state; once the tag closes (or prose begins) the rest
/// renders as usual. When folding is off this is identical to
/// `format_assistant_lines`, so the existing live-tail tests hold.
pub(super) fn live_assistant_lines(text: &str, width: u16, fold_reasoning: bool) -> Vec<Line<'static>> {
    if !fold_reasoning {
        return format_assistant_lines(text, width);
    }
    let mut lines = Vec::new();
    for (reasoning, seg) in super::split_reasoning(text) {
        if reasoning {
            // Folded: the streaming content is hidden; nothing to show. (Once it
            // commits, `push_assistant_blocks` emits the summary row instead.)
            continue;
        }
        if !seg.trim().is_empty() {
            lines.extend(format_markdown_lines(&seg, width));
        }
    }
    lines
}

/// A reasoning block's full dimmed lines (`┊ ` gutter, dim italic body).
pub(super) fn reasoning_detail_lines(seg: &str) -> Vec<Line<'static>> {
    seg.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            Line::from(vec![
                Span::styled("┊ ", Style::new().dark_gray()),
                Span::styled(l.to_string(), Style::new().dim().italic()),
            ])
        })
        .collect()
}

/// Collapsed summary row for a folded reasoning block.
pub(super) fn reasoning_summary_row(n: usize) -> Line<'static> {
    let label = if n == 1 {
        "reasoning (1 line)".to_string()
    } else {
        format!("reasoning ({n} lines)")
    };
    Line::from(vec![
        Span::styled("┊ ", Style::new().dark_gray()),
        Span::styled(label, Style::new().dim().italic()),
    ])
}

/// Render answer prose to styled lines. Every block -- prose, code fences,
/// pipe tables -- comes from one `pulldown-cmark` pass, so cell and code
/// contents are extracted by the parser rather than by matching raw lines.
pub(super) fn format_markdown_lines(text: &str, width: u16) -> Vec<Line<'static>> {
    use pulldown_cmark::{Event, Options, Parser, Tag};

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_TABLES);

    let events: Vec<Event> = Parser::new_ext(text, opts).collect();
    let mut r = Renderer::new(width);
    // A fence that has not closed yet is still being streamed: its body changes
    // on every delta, so highlighting it is re-done from scratch each frame and
    // cannot be cached. Leave the open block plain and highlight it once the
    // closing fence lands.
    if has_open_fence(text) {
        let blocks = events
            .iter()
            .filter(|e| matches!(e, Event::Start(Tag::CodeBlock(_))))
            .count();
        r.plain_code_block = Some(blocks);
    }
    for event in events {
        r.handle(event);
    }
    r.finish()
}

/// True when `text` ends inside a fenced code block, i.e. an odd number of
/// fence markers have been seen. Cheap enough to run per frame; it only reads
/// line starts.
fn has_open_fence(text: &str) -> bool {
    let mut open: Option<char> = None;
    for line in text.lines() {
        let t = line.trim_start();
        let marker = if t.starts_with("```") {
            Some('`')
        } else if t.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        match (open, marker) {
            // A fence closes only with its own character.
            (Some(c), Some(m)) if c == m => open = None,
            (None, Some(m)) => open = Some(m),
            _ => {}
        }
    }
    open.is_some()
}

/// Render a code block as a boxed panel (same frame as `diff_lines`), the
/// language tag (when present) as a dim header row and the body
/// syntax-highlighted. Long lines wrap rather than truncate: dropping the tail
/// of a line of code loses the part that usually matters most.
fn render_code_block(body: &[&str], lang: &str, max: usize, plain: bool) -> Vec<Line<'static>> {
    let mut rows: Vec<Line<'static>> = Vec::with_capacity(body.len() + 1);
    if !lang.is_empty() {
        rows.push(Line::styled(
            lang.to_string(),
            Style::new().dark_gray().italic(),
        ));
    }
    let rendered = if plain {
        body.iter()
            .map(|l| vec![Span::raw(l.to_string())])
            .collect()
    } else {
        super::highlight::block(body, lang)
    };
    for spans in rendered {
        for chunk in wrap_spans(spans, max) {
            rows.push(Line::from(chunk));
        }
    }
    super::boxed_panel(rows, max, "")
}

/// Break a styled row into chunks of at most `max` columns, splitting spans
/// where needed and carrying each span's style onto its continuation.
fn wrap_spans(spans: Vec<Span<'static>>, max: usize) -> Vec<Vec<Span<'static>>> {
    let max = max.max(1);
    let mut out: Vec<Vec<Span<'static>>> = Vec::new();
    let mut row: Vec<Span<'static>> = Vec::new();
    let mut used = 0;
    for span in spans {
        let style = span.style;
        let mut rest: &str = &span.content;
        while !rest.is_empty() {
            let room = max - used;
            let take = rest.chars().count().min(room);
            let split = rest
                .char_indices()
                .nth(take)
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            let (head, tail) = rest.split_at(split);
            if !head.is_empty() {
                row.push(Span::styled(head.to_string(), style));
                used += take;
            }
            rest = tail;
            if used >= max && !rest.is_empty() {
                out.push(std::mem::take(&mut row));
                used = 0;
            }
        }
    }
    if !row.is_empty() || out.is_empty() {
        out.push(row);
    }
    out
}

/// Heading ladder. Weight and hue carry the level -- no `#` markers and no
/// filled background, so headings sit in the same palette as the rest of the
/// transcript (cyan accent, `dark_gray` structure).
fn heading_style(level: u8) -> Style {
    match level {
        1 => Style::new().cyan().bold().underlined(),
        2 => Style::new().cyan().bold(),
        3 => Style::new().bold(),
        _ => Style::new().bold().dim(),
    }
}

/// Incremental markdown -> `Line` writer. Text accumulates into `spans` until a
/// block boundary flushes it; `prefixes` re-emit blockquote gutters and list
/// indents at the head of every new line.
struct Renderer {
    width: u16,
    out: Vec<Line<'static>>,
    spans: Vec<Span<'static>>,
    prefixes: Vec<(String, Style)>,
    blocks: Vec<Style>,
    inlines: Vec<Style>,
    /// One slot per open list; `Some(n)` counts an ordered list's next number.
    lists: Vec<Option<u64>>,
    /// A list marker was just emitted, so the item's first paragraph continues
    /// on that line instead of opening a new one.
    item_open: bool,
    link: Option<Link>,
    code: Option<CodeBlock>,
    table: Option<TableBuilder>,
    /// 1-based index of the code block to render without highlighting (the
    /// still-streaming one); `None` highlights every block.
    plain_code_block: Option<usize>,
    code_blocks_seen: usize,
}

/// An open link. `text` accumulates the anchor's own content so an autolink
/// (anchor text == URL) doesn't print the URL twice. Tracked as text rather
/// than a span index because line prefixes share the span vector.
struct Link {
    url: String,
    text: String,
}

struct CodeBlock {
    lang: String,
    body: String,
}

/// One table cell: each character with the style it was parsed under. Kept
/// per-character because comfy-table lays the grid out from plain strings and
/// may wrap a cell across rows, so styles are re-applied to its output
/// afterwards (see `render_table`).
type Cell = Vec<(char, Style)>;

/// Cells of a table being parsed.
#[derive(Default)]
struct TableBuilder {
    header: Vec<Cell>,
    rows: Vec<Vec<Cell>>,
    row: Vec<Cell>,
    cell: Cell,
    in_head: bool,
}

fn cell_text(cell: &Cell) -> String {
    cell.iter().map(|(c, _)| *c).collect()
}

/// Trim surrounding whitespace, keeping each character paired with its style.
fn trim_cell(mut cell: Cell) -> Cell {
    while cell.first().is_some_and(|(c, _)| c.is_whitespace()) {
        cell.remove(0);
    }
    while cell.last().is_some_and(|(c, _)| c.is_whitespace()) {
        cell.pop();
    }
    cell
}

impl Renderer {
    fn new(width: u16) -> Self {
        Self {
            width,
            out: Vec::new(),
            spans: Vec::new(),
            prefixes: Vec::new(),
            blocks: Vec::new(),
            inlines: Vec::new(),
            lists: Vec::new(),
            item_open: false,
            link: None,
            code: None,
            table: None,
            plain_code_block: None,
            code_blocks_seen: 0,
        }
    }

    fn finish(mut self) -> Vec<Line<'static>> {
        self.end_line();
        self.out
    }

    /// Block styles apply under inline ones, so emphasis inside a heading keeps
    /// the heading's colour.
    fn style(&self) -> Style {
        let mut s = Style::default();
        for b in self.blocks.iter().chain(self.inlines.iter()) {
            s = s.patch(*b);
        }
        s
    }

    fn push(&mut self, text: impl Into<String>, style: Style) {
        if self.spans.is_empty() {
            for (t, s) in &self.prefixes {
                if !t.is_empty() {
                    self.spans.push(Span::styled(t.clone(), *s));
                }
            }
        }
        let text = text.into();
        if let Some(l) = &mut self.link {
            l.text.push_str(&text);
        }
        self.spans.push(Span::styled(text, style));
    }

    fn push_styled(&mut self, text: impl Into<String>) {
        let style = self.style();
        self.push(text, style);
    }

    fn end_line(&mut self) {
        if !self.spans.is_empty() {
            self.out.push(Line::from(std::mem::take(&mut self.spans)));
        }
    }

    /// Close the current line and separate the next block with one blank line
    /// (suppressed at the very top and never doubled).
    fn gap(&mut self) {
        self.end_line();
        let blank = self
            .out
            .last()
            .map(|l| l.spans.iter().all(|s| s.content.trim().is_empty()))
            .unwrap_or(true);
        if !blank {
            self.out.push(Line::default());
        }
    }

    /// Text inside a code block or table cell is collected, not emitted as
    /// spans. Returns true when the text was consumed that way.
    fn sink_text(&mut self, text: &str) -> bool {
        let style = self.style();
        self.sink_styled(text, style)
    }

    fn sink_styled(&mut self, text: &str, style: Style) -> bool {
        if let Some(c) = &mut self.code {
            c.body.push_str(text);
            return true;
        }
        let Some(t) = &mut self.table else {
            return false;
        };
        t.cell.extend(text.chars().map(|c| (c, style)));
        // Keep the anchor accumulator fed so autolink detection behaves the same
        // inside a cell as outside one.
        if let Some(l) = &mut self.link {
            l.text.push_str(text);
        }
        true
    }

    fn handle(&mut self, event: pulldown_cmark::Event<'_>) {
        use pulldown_cmark::Event;
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(t) => {
                if !self.sink_text(&t) {
                    self.push_styled(t.into_string());
                }
            }
            Event::Code(c) => {
                let style = self.style().patch(Style::new().cyan());
                if self.sink_styled(&c, style) {
                    return;
                }
                self.push(c.into_string(), style);
            }
            // Not dropped: rendering the source keeps content the model emitted
            // visible rather than silently swallowing it.
            Event::Html(h) | Event::InlineHtml(h) => {
                let style = self.style().patch(Style::new().dim());
                self.push(h.into_string().trim_end().to_string(), style);
            }
            Event::InlineMath(m) | Event::DisplayMath(m) => self.push_styled(m.into_string()),
            Event::FootnoteReference(name) => {
                let style = self.style().patch(Style::new().dim());
                self.push(format!("[^{name}]"), style);
            }
            // A soft break is not a line break: joining lets the Paragraph
            // widget reflow the paragraph at the real terminal width.
            Event::SoftBreak => {
                if !self.sink_text(" ") {
                    self.push_styled(" ");
                }
            }
            Event::HardBreak => self.end_line(),
            // Routed through `push` so a rule inside a blockquote keeps its
            // gutter, with the prefix width discounted so it still fits.
            Event::Rule => {
                self.gap();
                let used: usize = self.prefixes.iter().map(|(t, _)| t.chars().count()).sum();
                let w = (self.width as usize).saturating_sub(used).max(4);
                self.push("\u{2500}".repeat(w), Style::new().dark_gray());
                self.end_line();
            }
            Event::TaskListMarker(checked) => {
                let mark = if checked { "[x] " } else { "[ ] " };
                let style = self.style().patch(if checked {
                    Style::new().green()
                } else {
                    Style::new().dark_gray()
                });
                self.push(mark, style);
            }
        }
    }

    fn start(&mut self, tag: pulldown_cmark::Tag<'_>) {
        use pulldown_cmark::{CodeBlockKind, Tag};
        match tag {
            Tag::Paragraph => {
                if self.item_open {
                    self.item_open = false;
                } else {
                    self.gap();
                }
            }
            Tag::Heading { level, .. } => {
                self.gap();
                self.blocks.push(heading_style(level as u8));
            }
            Tag::BlockQuote(_) => {
                self.gap();
                self.prefixes
                    .push(("\u{2502} ".to_string(), Style::new().dark_gray()));
                self.blocks.push(Style::new().italic());
            }
            Tag::CodeBlock(kind) => {
                self.gap();
                let lang = match kind {
                    // Only the first word of an info string names the language
                    // (```rust,ignore); the rest is tooling metadata.
                    CodeBlockKind::Fenced(l) => l
                        .split(|c: char| c == ',' || c.is_whitespace())
                        .next()
                        .unwrap_or("")
                        .to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                self.code_blocks_seen += 1;
                self.code = Some(CodeBlock {
                    lang,
                    body: String::new(),
                });
            }
            Tag::List(start) => {
                if self.lists.is_empty() {
                    self.gap();
                }
                self.lists.push(start);
            }
            Tag::Item => {
                self.end_line();
                // Top-level items sit flush left; each nested level adds two.
                let pad = if self.lists.len() > 1 { "  " } else { "" };
                self.prefixes.push((pad.to_string(), Style::default()));
                match self.lists.last_mut() {
                    Some(Some(n)) => {
                        let marker = format!("{n}. ");
                        *n += 1;
                        self.push(marker, Style::new().cyan());
                    }
                    _ => self.push("- ", Style::new().cyan()),
                }
                self.item_open = true;
            }
            Tag::Emphasis => self.inlines.push(Style::new().italic()),
            Tag::Strong => self.inlines.push(Style::new().bold()),
            Tag::Strikethrough => self.inlines.push(Style::new().crossed_out()),
            Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. } => {
                self.link = Some(Link {
                    url: dest_url.into_string(),
                    text: String::new(),
                });
                self.inlines.push(Style::new().cyan().underlined());
            }
            Tag::MetadataBlock(_) => self.blocks.push(Style::new().dim()),
            Tag::Table(_) => {
                self.gap();
                self.table = Some(TableBuilder::default());
            }
            Tag::TableHead => {
                if let Some(t) = &mut self.table {
                    t.in_head = true;
                }
            }
            Tag::TableRow | Tag::TableCell => {
                if let Some(t) = &mut self.table {
                    t.cell.clear();
                }
            }
            Tag::FootnoteDefinition(_)
            | Tag::HtmlBlock
            | Tag::Subscript
            | Tag::Superscript
            | Tag::DefinitionList
            | Tag::DefinitionListTitle
            | Tag::DefinitionListDefinition => {}
        }
    }

    fn end(&mut self, tag: pulldown_cmark::TagEnd) {
        use pulldown_cmark::TagEnd;
        match tag {
            TagEnd::Paragraph => self.end_line(),
            TagEnd::Heading(_) => {
                self.end_line();
                self.blocks.pop();
            }
            TagEnd::BlockQuote(_) => {
                self.end_line();
                self.prefixes.pop();
                self.blocks.pop();
            }
            TagEnd::CodeBlock => {
                if let Some(c) = self.code.take() {
                    let body: Vec<&str> = c.body.lines().collect();
                    let max = (self.width as usize).saturating_sub(4);
                    let plain = self.plain_code_block == Some(self.code_blocks_seen);
                    let panel = render_code_block(&body, &c.lang, max, plain);
                    self.out.extend(panel);
                }
            }
            TagEnd::List(_) => {
                self.end_line();
                self.lists.pop();
            }
            TagEnd::Item => {
                self.end_line();
                self.prefixes.pop();
                self.item_open = false;
            }
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough => {
                self.inlines.pop();
            }
            TagEnd::MetadataBlock(_) => {
                self.end_line();
                self.blocks.pop();
            }
            TagEnd::TableCell => {
                if let Some(t) = &mut self.table {
                    let cell = trim_cell(std::mem::take(&mut t.cell));
                    if t.in_head {
                        t.header.push(cell);
                    } else {
                        t.row.push(cell);
                    }
                }
            }
            TagEnd::TableHead => {
                if let Some(t) = &mut self.table {
                    t.in_head = false;
                }
            }
            TagEnd::TableRow => {
                if let Some(t) = &mut self.table {
                    let row = std::mem::take(&mut t.row);
                    t.rows.push(row);
                }
            }
            TagEnd::Table => {
                if let Some(t) = self.table.take() {
                    let table = render_table(&t.header, &t.rows, self.width);
                    self.out.extend(table);
                }
            }
            TagEnd::Link | TagEnd::Image => {
                self.inlines.pop();
                if let Some(l) = self.link.take() {
                    // Inside a table the URL is dropped rather than appended:
                    // cells are width-constrained, and a full URL would dominate
                    // the column. The anchor text is already in the cell.
                    if self.table.is_none() && l.text.trim() != l.url {
                        let dim = Style::new().dark_gray();
                        self.push(format!(" ({})", l.url), dim);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Render a markdown table via comfy-table: `Dynamic` arrangement wraps long
/// cells within their column and keeps the whole table within `width`, fixing
/// the overflow/separator-wrap failure of naive padding. Border rows are dimmed.
fn render_table(header: &[Cell], rows: &[Vec<Cell>], width: u16) -> Vec<Line<'static>> {
    use comfy_table::{ContentArrangement, Table};

    let mut table = Table::new();
    table
        .load_preset(comfy_table::presets::UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_width(width.max(20))
        .set_header(header.iter().map(cell_text));
    for r in rows {
        table.add_row(r.iter().map(cell_text));
    }
    let rendered = table.to_string();

    // Styles are re-applied to comfy-table's finished grid, which is laid out
    // from plain text. Alignment walks the *non-whitespace* characters of each
    // cell rather than counting columns, because the arrangement pads cells to
    // the column width and drops the space it wraps on -- neither of which the
    // source cell contains.
    let mut all: Vec<&[Cell]> = Vec::with_capacity(rows.len() + 1);
    all.push(header);
    all.extend(rows.iter().map(Vec::as_slice));

    let border = Style::new().dim();
    let mut out = Vec::new();
    // Index of the body row being emitted, and how far into each of its cells
    // the mapping has consumed.
    let mut group = 0usize;
    let mut cursors: Vec<usize> = Vec::new();
    let mut fresh = true;

    for line in rendered.lines() {
        let is_content = line.starts_with('\u{2502}');
        if !is_content {
            out.push(Line::styled(line.to_string(), border));
            if !fresh {
                group += 1;
            }
            fresh = true;
            cursors.clear();
            continue;
        }
        if fresh {
            fresh = false;
            cursors = vec![0; all.get(group).map(|r| r.len()).unwrap_or(0)];
        }
        out.push(Line::from(style_table_row(
            line,
            all.get(group).copied().unwrap_or(&[]),
            &mut cursors,
            border,
        )));
    }
    out
}

/// Re-apply cell styles to one rendered grid row. Vertical rules are emitted as
/// border spans; every other run takes its style from the matching cell,
/// advancing that column's cursor once per non-whitespace character.
fn style_table_row(
    line: &str,
    cells: &[Cell],
    cursors: &mut [usize],
    border: Style,
) -> Vec<Span<'static>> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut buf: Vec<(char, Style)> = Vec::new();
    let mut col: usize = 0;
    let mut started = false;

    let flush = |buf: &mut Vec<(char, Style)>, spans: &mut Vec<Span<'static>>| {
        for (style, run) in group_by_style(buf) {
            spans.push(Span::styled(run, style));
        }
        buf.clear();
    };

    for ch in line.chars() {
        if ch == '\u{2502}' || ch == '\u{2506}' {
            flush(&mut buf, &mut spans);
            spans.push(Span::styled(ch.to_string(), border));
            if started {
                col += 1;
            }
            started = true;
            continue;
        }
        let style = if ch.is_whitespace() {
            Style::default()
        } else {
            next_cell_style(cells, cursors, col)
        };
        buf.push((ch, style));
    }
    flush(&mut buf, &mut spans);
    spans
}

/// Style of the next unconsumed character in column `col`, advancing its cursor.
/// Falls back to the default style if the grid shows more characters than the
/// source cell held (a break character comfy-table introduced, say).
fn next_cell_style(cells: &[Cell], cursors: &mut [usize], col: usize) -> Style {
    let Some(cell) = cells.get(col) else {
        return Style::default();
    };
    let Some(cursor) = cursors.get_mut(col) else {
        return Style::default();
    };
    let style = cell
        .iter()
        .filter(|(c, _)| !c.is_whitespace())
        .nth(*cursor)
        .map(|(_, s)| *s)
        .unwrap_or_default();
    *cursor += 1;
    style
}

/// Coalesce adjacent characters sharing a style into one span each.
fn group_by_style(chars: &[(char, Style)]) -> Vec<(Style, String)> {
    let mut out: Vec<(Style, String)> = Vec::new();
    for (ch, style) in chars {
        match out.last_mut() {
            Some((s, run)) if *s == *style => run.push(*ch),
            _ => out.push((*style, ch.to_string())),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{format_markdown_lines, render_table};

    fn line_text(line: &ratatui::text::Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    fn joined(lines: &[ratatui::text::Line]) -> String {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .map(|s| s.content.as_ref())
            .collect()
    }

    /// Style of the first span whose text contains `needle`.
    fn style_of(lines: &[ratatui::text::Line], needle: &str) -> ratatui::style::Style {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .find(|s| s.content.contains(needle))
            .unwrap_or_else(|| panic!("no span containing {needle:?} in {:?}", joined(lines)))
            .style
    }

    #[test]
    fn headings_drop_the_literal_hash_markers() {
        let lines = super::format_markdown_lines("# Title\n\n## Section\n\n### Sub", 40);
        let text = joined(&lines);
        assert!(!text.contains('#'), "hash markers leaked: {text:?}");
        assert!(text.contains("Title") && text.contains("Section") && text.contains("Sub"));
    }

    #[test]
    fn heading_levels_form_a_visible_ladder_without_a_filled_background() {
        let h1 = style_of(&super::format_markdown_lines("# Title", 40), "Title");
        let h2 = style_of(&super::format_markdown_lines("## Section", 40), "Section");
        let h4 = style_of(&super::format_markdown_lines("#### Deep", 40), "Deep");
        // A filled background bar clashes with the rest of the transcript.
        assert_eq!(h1.bg, None, "h1 should not paint a background");
        assert!(h1.add_modifier.contains(ratatui::style::Modifier::BOLD));
        assert_ne!(h1, h2, "h1 and h2 must be distinguishable");
        assert_ne!(h2, h4, "h2 and h4 must be distinguishable");
    }

    #[test]
    fn inline_code_uses_the_accent_colour_not_a_black_block() {
        let lines = super::format_markdown_lines("call `do_thing()` now", 40);
        let style = style_of(&lines, "do_thing()");
        assert_eq!(style.bg, None, "inline code should not paint a background");
        assert_eq!(style.fg, Some(ratatui::style::Color::Cyan));
        assert!(!joined(&lines).contains('`'), "backticks leaked");
    }

    #[test]
    fn ordered_list_markers_use_the_accent_colour() {
        let lines = super::format_markdown_lines("1. alpha\n2. beta", 40);
        // tui-markdown hardcoded light_blue here, bypassing any theme.
        assert_eq!(style_of(&lines, "1.").fg, Some(ratatui::style::Color::Cyan));
    }

    #[test]
    fn nested_lists_indent_by_depth() {
        let lines = super::format_markdown_lines("- outer\n  - inner", 40);
        let texts: Vec<String> = lines
            .iter()
            .map(line_text)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert_eq!(texts.len(), 2, "{texts:?}");
        let outer_indent = texts[0].len() - texts[0].trim_start().len();
        let inner_indent = texts[1].len() - texts[1].trim_start().len();
        assert!(
            inner_indent > outer_indent,
            "nested item not indented: {texts:?}"
        );
    }

    #[test]
    fn blockquote_uses_a_gutter_rather_than_a_literal_angle_bracket() {
        let lines = super::format_markdown_lines("> quoted wisdom", 40);
        let text = joined(&lines);
        assert!(!text.contains('>'), "raw angle bracket leaked: {text:?}");
        assert!(text.contains('\u{2502}'), "missing gutter glyph: {text:?}");
        assert!(text.contains("quoted wisdom"));
    }

    #[test]
    fn thematic_break_renders_as_a_rule_spanning_the_width() {
        let lines = super::format_markdown_lines("above\n\n---\n\nbelow", 20);
        let rule = lines
            .iter()
            .map(line_text)
            .find(|l| l.contains('\u{2500}'))
            .expect("no rule line rendered");
        assert!(!joined(&lines).contains("---"), "literal dashes leaked");
        assert!(rule.chars().count() > 3, "rule too short: {rule:?}");
        assert!(rule.chars().count() <= 20, "rule exceeds width: {rule:?}");
    }

    #[test]
    fn link_styles_the_anchor_text_and_dims_the_url() {
        let lines = super::format_markdown_lines("see [the docs](https://jan.ai)", 60);
        let text = joined(&lines);
        assert!(text.contains("the docs"), "anchor text lost: {text:?}");
        assert!(text.contains("https://jan.ai"), "url lost: {text:?}");
        let anchor = style_of(&lines, "the docs");
        assert!(
            anchor
                .add_modifier
                .contains(ratatui::style::Modifier::UNDERLINED),
            "anchor text not styled: {anchor:?}"
        );
    }

    #[test]
    fn autolink_does_not_repeat_the_url_twice() {
        let lines = super::format_markdown_lines("[https://jan.ai](https://jan.ai)", 60);
        let text = joined(&lines);
        assert_eq!(text.matches("https://jan.ai").count(), 1, "{text:?}");
    }

    /// Syntax-highlight colours only: the panel frame and the language label are
    /// both `DarkGray`, so they are excluded rather than counted as highlighting.
    fn code_colours(
        lines: &[ratatui::text::Line],
    ) -> std::collections::HashSet<ratatui::style::Color> {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .filter_map(|s| s.style.fg)
            .filter(|c| *c != ratatui::style::Color::DarkGray)
            .collect()
    }

    #[test]
    fn a_still_streaming_fence_is_not_highlighted() {
        // Highlighting an open block is thrown away on the next delta, so it is
        // deferred until the closing fence arrives.
        let open = format_markdown_lines("```rust\nfn main() { let x = 1; }", 60);
        assert!(
            code_colours(&open).is_empty(),
            "open fence was highlighted: {:?}",
            code_colours(&open)
        );
        assert!(joined(&open).contains("fn main()"), "body lost");
    }

    #[test]
    fn a_closed_fence_after_an_open_one_is_still_highlighted() {
        // Only the trailing open block is plain; earlier finished blocks keep
        // their colours.
        let md = "```rust\nfn done() { let x = 1; }\n```\n\n```rust\nfn open() { let y = 2; }";
        let lines = format_markdown_lines(md, 60);
        assert!(
            !code_colours(&lines).is_empty(),
            "the finished block lost its highlighting"
        );
    }

    #[test]
    fn open_fence_detection_tracks_the_marker_character() {
        assert!(super::has_open_fence("```rust\nx"));
        assert!(!super::has_open_fence("```rust\nx\n```"));
        assert!(super::has_open_fence("~~~py\nx"));
        assert!(!super::has_open_fence("~~~py\nx\n~~~"));
        // A tilde line does not close a backtick fence.
        assert!(super::has_open_fence("```rust\n~~~\nx"));
        assert!(!super::has_open_fence("no fences here"));
    }

    #[test]
    fn tilde_fences_are_boxed_like_backtick_fences() {
        let lines = format_markdown_lines("~~~python\nx = 1\n~~~", 40);
        let text = joined(&lines);
        assert!(!text.contains('~'), "tilde fence leaked: {text}");
        assert!(text.contains("x = 1"), "body lost: {text}");
        assert!(text.contains('\u{250c}'), "not boxed: {text}");
    }

    #[test]
    fn fence_info_string_with_attributes_still_resolves_the_language() {
        // ```rust,ignore is a valid info string; only the first word names the
        // language.
        let lines = format_markdown_lines("```rust,ignore\nfn main() { let x = 1; }\n```", 60);
        let colours = code_colours(&lines);
        assert!(colours.len() > 2, "not highlighted as rust: {colours:?}");
    }

    #[test]
    fn escaped_pipe_in_a_cell_does_not_split_the_column() {
        let md = "| expr | note |\n|---|---|\n| a \\| b | or |";
        let lines = format_markdown_lines(md, 40);
        let text = joined(&lines);
        assert!(text.contains("a | b"), "escaped pipe mishandled: {text}");
        // Three columns would appear if the escape were treated as a delimiter.
        let header_cols = lines
            .iter()
            .map(line_text)
            .find(|l| l.contains("expr"))
            .map(|l| l.matches('\u{2502}').count())
            .unwrap_or(0);
        assert_eq!(header_cols, 2, "column count changed: {text}");
    }

    #[test]
    fn literal_asterisks_in_a_cell_survive() {
        // The old string-stripping pass deleted every `**` it found, turning
        // "2 ** 3" into "2  3".
        let md = "| expr | value |\n|---|---|\n| 2 ** 3 | eight |";
        let text = joined(&format_markdown_lines(md, 40));
        assert!(text.contains("2 ** 3"), "literal asterisks lost: {text}");
    }

    /// Style of the first span whose text contains `needle`, searched across a
    /// rendered table (whose cells are split into per-style spans).
    fn cell_style(lines: &[ratatui::text::Line], needle: &str) -> ratatui::style::Style {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .find(|s| s.content.contains(needle))
            .unwrap_or_else(|| panic!("no span containing {needle:?} in {:?}", joined(lines)))
            .style
    }

    #[test]
    fn bold_in_a_cell_is_rendered_bold() {
        let md = "| name |\n|---|\n| **apple** |";
        let lines = format_markdown_lines(md, 40);
        assert!(
            cell_style(&lines, "apple")
                .add_modifier
                .contains(ratatui::style::Modifier::BOLD),
            "cell text not bold: {:?}",
            joined(&lines)
        );
    }

    #[test]
    fn inline_code_in_a_cell_keeps_the_accent_colour() {
        let md = "| expr |\n|---|\n| `total` |";
        let lines = format_markdown_lines(md, 40);
        assert_eq!(
            cell_style(&lines, "total").fg,
            Some(ratatui::style::Color::Cyan)
        );
    }

    #[test]
    fn link_text_in_a_cell_is_underlined() {
        let md = "| ref |\n|---|\n| [docs](https://jan.ai) |";
        let lines = format_markdown_lines(md, 40);
        assert!(cell_style(&lines, "docs")
            .add_modifier
            .contains(ratatui::style::Modifier::UNDERLINED));
    }

    #[test]
    fn plain_cell_text_stays_unstyled() {
        let md = "| name |\n|---|\n| apple |";
        let lines = format_markdown_lines(md, 40);
        let s = cell_style(&lines, "apple");
        assert_eq!(s.fg, None, "plain cell picked up a colour");
        assert!(s.add_modifier.is_empty(), "plain cell picked up a modifier");
    }

    #[test]
    fn cell_styles_survive_wrapping() {
        // comfy-table drops the space it breaks on, so style alignment cannot
        // rely on character counts alone.
        let md = "| note |\n|---|\n| some filler words then **emphatic** trailing words here |";
        let lines = format_markdown_lines(md, 24);
        assert!(
            cell_style(&lines, "emphatic")
                .add_modifier
                .contains(ratatui::style::Modifier::BOLD),
            "bold lost across a wrap: {:?}",
            lines.iter().map(line_text).collect::<Vec<_>>()
        );
    }

    #[test]
    fn table_borders_are_never_styled_as_content() {
        let md = "| a |\n|---|\n| **b** |";
        let lines = format_markdown_lines(md, 30);
        for l in &lines {
            for s in &l.spans {
                if s.content.contains('\u{2502}') || s.content.contains('\u{2506}') {
                    // Borders are dim by design; they must not inherit a cell's
                    // emphasis or colour.
                    assert!(
                        !s.style.add_modifier.intersects(
                            ratatui::style::Modifier::BOLD | ratatui::style::Modifier::UNDERLINED
                        ),
                        "border span inherited cell emphasis: {:?}",
                        s.content
                    );
                    assert_eq!(
                        s.style.fg, None,
                        "border span got a colour: {:?}",
                        s.content
                    );
                }
            }
        }
    }

    #[test]
    fn inline_markup_in_a_cell_is_parsed_not_stripped() {
        let md = "| name | note |\n|---|---|\n| **bold** | `code` |";
        let text = joined(&format_markdown_lines(md, 40));
        assert!(text.contains("bold") && !text.contains('*'), "{text}");
        assert!(text.contains("code") && !text.contains('`'), "{text}");
    }

    #[test]
    fn a_link_in_a_cell_keeps_its_anchor_text() {
        let md = "| ref |\n|---|\n| [the docs](https://jan.ai) |";
        let text = joined(&format_markdown_lines(md, 60));
        assert!(text.contains("the docs"), "anchor text lost: {text}");
        assert!(
            !text.contains("](") && !text.contains('['),
            "raw link syntax leaked into the cell: {text}"
        );
    }

    #[test]
    fn a_cell_link_url_does_not_escape_the_table() {
        // The URL suffix is written to the span buffer, which a table cell does
        // not use -- it would otherwise surface as a stray line after the grid.
        let md = "| ref |\n|---|\n| [the docs](https://jan.ai) |";
        let lines = format_markdown_lines(md, 60);
        let after_grid: Vec<String> = lines
            .iter()
            .map(line_text)
            .skip_while(|l| !l.starts_with('\u{2514}'))
            .skip(1)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert!(
            after_grid.is_empty(),
            "content leaked past the table: {after_grid:?}"
        );
    }

    #[test]
    fn fenced_code_is_syntax_highlighted() {
        let lines = format_markdown_lines("```rust\nfn main() { let x = 1; }\n```", 60);
        let colours = code_colours(&lines);
        assert!(
            colours.len() > 2,
            "code not highlighted, colours: {colours:?}"
        );
    }

    #[test]
    fn long_code_lines_wrap_instead_of_being_truncated() {
        let long = format!("let x = \"{}\";", "y".repeat(120));
        let md = format!("```rust\n{long}\n```");
        let lines = format_markdown_lines(&md, 40);
        let text = joined(&lines);
        assert!(!text.contains('\u{2026}'), "code was truncated: {text}");
        // Wrapping splits the run across rows, so count characters rather than
        // looking for a contiguous match.
        assert_eq!(
            text.matches('y').count(),
            120,
            "content lost while wrapping: {text}"
        );
        // Every rendered row, frame included, stays inside the width budget.
        for l in &lines {
            let w: usize = l.spans.iter().map(|s| s.content.chars().count()).sum();
            assert!(w <= 40, "row overflows width ({w}): {:?}", line_text(l));
        }
    }

    #[test]
    fn code_panel_rows_all_share_one_inner_width() {
        let md = "```rust\nfn a() {}\nfn bbbbbbbbbbbb() {}\n```";
        let widths: std::collections::HashSet<usize> = format_markdown_lines(md, 60)
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.chars().count()).sum())
            .collect();
        assert_eq!(widths.len(), 1, "panel borders misaligned: {widths:?}");
    }

    #[test]
    fn boxed_blocks_are_separated_from_neighbours_by_one_blank_line() {
        // Code panels and tables come from the line pre-pass, so they need the
        // same block separation the walker gives headings and paragraphs.
        let md = "intro\n\n```rs\nx = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\noutro";
        let texts: Vec<String> = format_markdown_lines(md, 40)
            .iter()
            .map(line_text)
            .collect();
        let blank = |s: &String| s.trim().is_empty();
        for (i, t) in texts.iter().enumerate() {
            if t.starts_with('\u{250c}') && i > 0 {
                assert!(blank(&texts[i - 1]), "no gap above block at {i}: {texts:?}");
            }
            if t.starts_with('\u{2514}') && i + 1 < texts.len() {
                assert!(blank(&texts[i + 1]), "no gap below block at {i}: {texts:?}");
            }
        }
        assert!(texts.iter().any(|t| t.contains("intro")));
        assert!(texts.iter().any(|t| t.contains("outro")));
    }

    #[test]
    fn autolink_inside_a_blockquote_is_not_duplicated() {
        // The gutter prefix must not be mistaken for part of the anchor text.
        let lines = super::format_markdown_lines("> [https://jan.ai](https://jan.ai)", 60);
        let text = joined(&lines);
        assert_eq!(text.matches("https://jan.ai").count(), 1, "{text:?}");
    }

    #[test]
    fn rule_inside_a_blockquote_keeps_the_gutter() {
        let lines = super::format_markdown_lines("> before\n>\n> ---\n>\n> after", 30);
        let rule = lines
            .iter()
            .map(line_text)
            .find(|l| l.contains('\u{2500}'))
            .expect("no rule rendered");
        assert!(rule.contains('\u{2502}'), "gutter lost on rule: {rule:?}");
        assert!(rule.chars().count() <= 30, "rule overflows width: {rule:?}");
    }

    #[test]
    fn task_list_markers_render_checked_state() {
        let text = joined(&super::format_markdown_lines("- [x] done\n- [ ] todo", 40));
        assert!(text.contains("[x]") && text.contains("[ ]"), "{text:?}");
        assert!(text.contains("done") && text.contains("todo"));
    }

    #[test]
    fn soft_breaks_reflow_into_one_line() {
        // Author line breaks inside a paragraph are not hard breaks; joining them
        // lets the Paragraph widget wrap to the real terminal width.
        let lines = super::format_markdown_lines("first half\nsecond half", 80);
        let non_blank: Vec<String> = lines
            .iter()
            .map(line_text)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert_eq!(non_blank, ["first half second half"], "{non_blank:?}");
    }

    #[test]
    fn strikethrough_is_rendered_as_a_modifier() {
        let lines = super::format_markdown_lines("~~gone~~", 40);
        assert!(joined(&lines).contains("gone"));
        assert!(style_of(&lines, "gone")
            .add_modifier
            .contains(ratatui::style::Modifier::CROSSED_OUT));
    }

    #[test]
    fn indented_code_block_is_boxed_like_a_fence() {
        let lines = super::format_markdown_lines("text\n\n    let x = 1;\n", 40);
        let text = joined(&lines);
        assert!(text.contains("let x = 1;"), "code lost: {text:?}");
        assert!(text.contains('\u{250c}'), "not boxed: {text:?}");
    }

    #[test]
    fn a_pipe_in_prose_is_not_mistaken_for_a_table() {
        // The old detector fired on any line containing a pipe followed by a
        // dashes-and-colons line; the parser requires a real delimiter row.
        let text = joined(&format_markdown_lines(
            "use a | b in a shell\n--- maybe",
            40,
        ));
        assert!(text.contains("use a | b in a shell"), "{text:?}");
    }

    #[test]
    fn loose_list_marker_merges_into_body_line() {
        // Loose list items must keep the marker on the body line.
        let md = "1. first item\n\n2. second item";
        let lines: Vec<String> = super::format_markdown_lines(md, 40)
            .iter()
            .map(line_text)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert_eq!(lines, ["1. first item", "2. second item"], "{lines:?}");

        let bullets: Vec<String> = super::format_markdown_lines("- alpha\n\n- beta", 40)
            .iter()
            .map(line_text)
            .filter(|l| !l.trim().is_empty())
            .collect();
        assert_eq!(bullets, ["- alpha", "- beta"], "{bullets:?}");
    }

    #[test]
    fn markdown_renders_bold_and_keeps_text() {
        let lines = super::format_markdown_lines("hello **world**", 40);
        let text: String = lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .map(|s| s.content.as_ref())
            .collect();
        assert!(text.contains("hello"), "got {text:?}");
        assert!(text.contains("world"), "got {text:?}");
        assert!(!text.contains("**"), "markers not stripped: {text:?}");
    }

    #[test]
    fn format_markdown_routes_table_through_comfy_table() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |";
        let lines = format_markdown_lines(md, 40);
        let text = joined(&lines);
        // No raw markdown pipes; cell content preserved; wrapped within width.
        assert!(text.contains('a') && text.contains('b') && text.contains('1'));
        assert!(lines
            .iter()
            .all(|l| joined(std::slice::from_ref(l)).chars().count() <= 40));
    }

    #[test]
    fn format_markdown_renders_code_fence_without_literal_backticks() {
        let md = "before\n\n```cpp\nconst bool x = true;\nif (x) { foo(); }\n```\n\nafter";
        let text = joined(&format_markdown_lines(md, 80));
        assert!(!text.contains("```"), "fence markers leaked: {text}");
        assert!(text.contains("const bool x = true;"));
        assert!(text.contains("if (x) { foo(); }"));
        assert!(text.contains("cpp"), "language tag missing: {text}");
        assert!(text.contains("before") && text.contains("after"));
        assert!(
            text.contains('┌') && text.contains('┘'),
            "missing box frame: {text}"
        );
    }

    #[test]
    fn format_markdown_handles_unterminated_code_fence() {
        let md = "```rust\nfn main() {}";
        let text = joined(&format_markdown_lines(md, 80));
        assert!(!text.contains("```"), "fence leaked: {text}");
        assert!(text.contains("fn main() {}"));
    }

    #[test]
    fn render_table_wraps_long_cells_within_the_width() {
        /// Unstyled cell, as the walker would build it from plain text.
        fn cell(s: &str) -> super::Cell {
            s.chars()
                .map(|c| (c, ratatui::style::Style::default()))
                .collect()
        }
        let header = vec![cell("name"), cell("note")];
        let rows = vec![vec![
            cell("apple"),
            cell("a very long note that must wrap across several lines"),
        ]];
        let lines = render_table(&header, &rows, 30);
        let text = joined(&lines);
        assert!(text.contains("apple"), "cell content lost: {text:?}");
        // Dynamic wrapping keeps every rendered row within the target width.
        assert!(lines
            .iter()
            .all(|l| joined(std::slice::from_ref(l)).chars().count() <= 30));
    }
}
