//! Syntax highlighting for code shown in the transcript.
//!
//! Foreground colours only: the theme's own background is discarded so a
//! highlighted block sits transparently inside the panel frame drawn around it
//! (and over whatever background the user's terminal has).

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};

use ratatui::prelude::*;
use syntect::easy::HighlightLines;
use syntect::highlighting::{FontStyle, Style as SynStyle, Theme, ThemeSet};
use syntect::parsing::{SyntaxReference, SyntaxSet};

/// Width a tab expands to. Code panels are padded to a fixed inner width, so a
/// literal tab would be measured as one column and misalign the right border.
const TAB_WIDTH: usize = 4;

/// Highlighted lines for one block.
type Rows = Vec<Vec<Span<'static>>>;

/// Distinct code blocks kept highlighted. A long session would otherwise grow
/// the cache without bound; the whole map is dropped rather than evicted
/// per-entry because a rebuild costs one re-highlight of whatever is on screen.
const CACHE_MAX: usize = 128;

/// Memo for `block`, keyed on a hash of the language and body.
///
/// The render loop re-derives the entire visible transcript every frame, and a
/// streamed response re-derives it on every delta, so without this the earlier
/// code blocks of a response are re-highlighted continuously -- quadratic in
/// the length of the response. Measured on a 31KB code-heavy answer: 237ms per
/// frame uncached, against a 50ms frame budget. Highlighting dominates
/// everything else in this module by roughly two orders of magnitude (the same
/// answer's prose costs ~1ms), so it is the only part worth memoizing.
fn cache() -> &'static Mutex<HashMap<u64, Rows>> {
    static CACHE: OnceLock<Mutex<HashMap<u64, Rows>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(body: &[&str], token: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    token.hash(&mut h);
    body.len().hash(&mut h);
    for line in body {
        line.hash(&mut h);
    }
    h.finish()
}

/// Deserializing the bundled dumps costs tens of milliseconds, so both are
/// initialized once. `warm` pays that cost off the render path.
fn syntaxes() -> &'static SyntaxSet {
    static SET: OnceLock<SyntaxSet> = OnceLock::new();
    SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn theme() -> &'static Theme {
    static THEME: OnceLock<Theme> = OnceLock::new();
    THEME.get_or_init(|| {
        let mut set = ThemeSet::load_defaults();
        set.themes
            .remove("base16-ocean.dark")
            .expect("base16-ocean.dark is bundled with syntect")
    })
}

/// Load the syntax and theme dumps now, so the first code block in a response
/// doesn't stall the render loop deserializing them.
pub(super) fn warm() {
    syntaxes();
    theme();
}

/// Resolve a fence tag (`rust`, `sh`) or a file name (`main.rs`) to a syntax.
fn syntax_for(token: &str) -> Option<&'static SyntaxReference> {
    let set = syntaxes();
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    set.find_syntax_by_token(token)
        .or_else(|| {
            let ext = token.rsplit('.').next()?;
            set.find_syntax_by_extension(ext)
        })
        .or_else(|| set.find_syntax_by_name(token))
}

/// Highlight `body` into one span list per input line. `token` is a fence
/// language tag or a file name; an unrecognized one yields unstyled spans, so
/// callers get renderable output either way.
///
/// The highlighter is threaded across lines rather than reset per line, so a
/// block comment or multi-line string keeps its colour past the line it opened.
pub(super) fn block(body: &[&str], token: &str) -> Rows {
    let key = cache_key(body, token);
    if let Some(hit) = cache().lock().ok().and_then(|c| c.get(&key).cloned()) {
        return hit;
    }
    let rows = highlight_uncached(body, token);
    if let Ok(mut c) = cache().lock() {
        if c.len() >= CACHE_MAX {
            c.clear();
        }
        c.insert(key, rows.clone());
    }
    rows
}

fn highlight_uncached(body: &[&str], token: &str) -> Rows {
    let Some(syntax) = syntax_for(token) else {
        return body
            .iter()
            .map(|l| vec![Span::raw(expand_tabs(l))])
            .collect();
    };
    let mut h = HighlightLines::new(syntax, theme());
    body.iter()
        .map(|line| {
            let text = expand_tabs(line);
            // The `newlines` syntax set expects a line terminator to close
            // line-scoped contexts; it is stripped back off below.
            let terminated = format!("{text}\n");
            match h.highlight_line(&terminated, syntaxes()) {
                Ok(ranges) => ranges
                    .iter()
                    .map(|(style, piece)| (piece.trim_end_matches('\n'), *style))
                    .filter(|(piece, _)| !piece.is_empty())
                    .map(|(piece, style)| Span::styled(piece.to_string(), convert(style)))
                    .collect(),
                Err(_) => vec![Span::raw(text)],
            }
        })
        .collect()
}

/// syntect style -> ratatui style, dropping the background (see module docs).
fn convert(s: SynStyle) -> Style {
    let mut out = Style::new().fg(Color::Rgb(s.foreground.r, s.foreground.g, s.foreground.b));
    if s.font_style.contains(FontStyle::BOLD) {
        out = out.bold();
    }
    if s.font_style.contains(FontStyle::ITALIC) {
        out = out.italic();
    }
    if s.font_style.contains(FontStyle::UNDERLINE) {
        out = out.underlined();
    }
    out
}

fn expand_tabs(s: &str) -> String {
    if !s.contains('\t') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch == '\t' {
            let pad = TAB_WIDTH - (out.chars().count() % TAB_WIDTH);
            out.push_str(&" ".repeat(pad));
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{block, expand_tabs};
    use std::collections::HashSet;

    fn text(spans: &[ratatui::text::Span]) -> String {
        spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[test]
    fn known_language_gets_more_than_one_colour() {
        let rows = block(&["fn main() { let x = 1; }"], "rust");
        let colours: HashSet<_> = rows[0].iter().filter_map(|s| s.style.fg).collect();
        assert!(
            colours.len() > 1,
            "expected multiple token colours, got {colours:?}"
        );
    }

    #[test]
    fn content_survives_highlighting_verbatim() {
        let src = "fn main() { let x = 1; }";
        let rows = block(&[src], "rust");
        assert_eq!(text(&rows[0]), src);
    }

    #[test]
    fn unknown_language_falls_back_to_unstyled_text() {
        let rows = block(&["some ::: thing"], "not-a-language");
        assert_eq!(rows.len(), 1);
        assert_eq!(text(&rows[0]), "some ::: thing");
        assert!(rows[0].iter().all(|s| s.style.fg.is_none()));
    }

    #[test]
    fn empty_language_tag_falls_back_without_panicking() {
        let rows = block(&["plain text"], "");
        assert_eq!(text(&rows[0]), "plain text");
    }

    #[test]
    fn no_background_is_ever_emitted() {
        // A theme background would show as a colour block inside the panel.
        let rows = block(&["fn main() {}", "// comment"], "rust");
        assert!(
            rows.iter().flatten().all(|s| s.style.bg.is_none()),
            "a span carried a background"
        );
    }

    #[test]
    fn a_file_name_resolves_by_extension() {
        let rows = block(&["fn main() {}"], "src/main.rs");
        let colours: HashSet<_> = rows[0].iter().filter_map(|s| s.style.fg).collect();
        assert!(colours.len() > 1, "path token did not resolve to a syntax");
    }

    #[test]
    fn block_comment_state_carries_to_following_lines() {
        // Line 2 is only a comment by virtue of line 1 opening one; a
        // per-line highlighter would colour it as code.
        let rows = block(&["/* open", "still comment", "*/"], "rust");
        let first = rows[0].last().expect("line 1 spans").style.fg;
        let second = rows[1].first().expect("line 2 spans").style.fg;
        assert_eq!(first, second, "comment colour did not carry across lines");
    }

    #[test]
    fn line_count_is_preserved_including_blanks() {
        let rows = block(&["fn a() {}", "", "fn b() {}"], "rust");
        assert_eq!(rows.len(), 3);
        assert_eq!(text(&rows[1]), "");
    }

    #[test]
    fn tabs_expand_to_the_next_stop() {
        assert_eq!(expand_tabs("\tx"), "    x");
        assert_eq!(expand_tabs("ab\tx"), "ab  x");
        assert_eq!(expand_tabs("abcd\tx"), "abcd    x");
        assert_eq!(expand_tabs("no tabs"), "no tabs");
    }

    #[test]
    fn highlighted_lines_contain_no_tabs() {
        let rows = block(&["\tlet x = 1;"], "rust");
        assert!(!text(&rows[0]).contains('\t'));
    }

    #[test]
    fn repeated_blocks_hit_the_cache_and_match_the_uncached_result() {
        let body = ["fn main() {", "    let x = 1;", "}"];
        let fresh = super::highlight_uncached(&body, "rust");
        let first = block(&body, "rust");
        let second = block(&body, "rust");
        assert_eq!(first, second, "cache returned different rows");
        assert_eq!(first, fresh, "cached rows differ from a fresh highlight");
    }

    #[test]
    fn cache_key_distinguishes_language_and_content() {
        let body = ["let x = 1"];
        assert_ne!(
            super::cache_key(&body, "rust"),
            super::cache_key(&body, "python"),
            "same body in different languages must not share a key"
        );
        assert_ne!(
            super::cache_key(&["a"], "rust"),
            super::cache_key(&["b"], "rust")
        );
        // Line splits must matter: ["a", "b"] is not the same block as ["ab"].
        assert_ne!(
            super::cache_key(&["a", "b"], "rust"),
            super::cache_key(&["ab"], "rust")
        );
    }

    #[test]
    fn cache_stays_bounded() {
        for i in 0..(super::CACHE_MAX + 20) {
            let line = format!("let v{i} = {i};");
            block(&[line.as_str()], "rust");
        }
        let n = super::cache().lock().unwrap().len();
        assert!(n <= super::CACHE_MAX, "cache grew to {n}");
    }
}
