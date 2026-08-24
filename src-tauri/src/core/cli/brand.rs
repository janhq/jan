//! The `jan` wordmark, shared by `jan --help` and the TUI splash so the two
//! can't drift.

/// "JAN" in ANSI Shadow block letters. Each glyph cell is one terminal column,
/// so `LOGO_WIDTH` is the rendered width.
pub const LOGO: [&str; 6] = [
    r"     ██╗ █████╗ ███╗  ██╗",
    r"     ██║██╔══██╗████╗ ██║",
    r"     ██║███████║██╔██╗██║",
    r"██   ██║██╔══██║██║╚████║",
    r"╚█████╔╝██║  ██║██║ ╚███║",
    r" ╚════╝ ╚═╝  ╚═╝╚═╝  ╚══╝",
];

pub const LOGO_WIDTH: u16 = 25;

/// The Jan hand-wave mark: the brand logo rendered above the wordmark in the
/// TUI splash, and repeatedly whenever a slash command starts a fresh view
/// (`/clear`, `/new`, `/resume`). Each glyph cell is one terminal column, so
/// `HAND_WIDTH` is the rendered width.
pub const HAND: [&str; 15] = [
    r"          ██  ███               ",
    r"        ███████████    ████     ",
    r"       ███   ██   ██  ███ ██    ",
    r"      ██ ███  ███  ███  ██ █    ",
    r"      ██   ███  ██   ██     ███ ",
    r"        ██  ███  ███  ███  ██ ██",
    r"       █████  ███  ██   ████  ██",
    r"      ██   ██   ██       ██   ██",
    r"       ███  ███  █            ██",
    r"   █  █  ██   ██              ██",
    r"   ██ ██  ███                 █ ",
    r"    ██ ██   ██               ██ ",
    r"     ████    ███           ███  ",
    r"               ████    █████    ",
    r"                 ████████       ",
];

pub const HAND_WIDTH: u16 = 32;

/// The hand-wave mark as a single glyph, for the header's leading column where
/// the block art has no room. No VS16: the emoji is already presentation-default
/// and the extra selector makes some terminals advance a column ratatui has not
/// reserved, which shifts the rest of the row.
pub const WAVE: &str = "\u{1F44B}";

/// Columns between the hand mark and the wordmark in the lockup.
const LOCKUP_GAP: u16 = 2;

/// Rendered width of `lockup()`.
pub const LOCKUP_WIDTH: u16 = HAND_WIDTH + LOCKUP_GAP + LOGO_WIDTH;

/// The full brand lockup: the hand mark with the wordmark set beside it,
/// vertically centred against the hand. Lines are padded to `LOCKUP_WIDTH`.
pub fn lockup() -> Vec<String> {
    let gap = " ".repeat(LOCKUP_GAP as usize);
    let top = (HAND.len() - LOGO.len()) / 2;
    HAND.iter()
        .enumerate()
        .map(|(i, hand)| {
            let word = i
                .checked_sub(top)
                .and_then(|row| LOGO.get(row))
                .copied()
                .unwrap_or("");
            let pad = LOGO_WIDTH as usize - word.chars().count();
            format!("{hand}{gap}{word}{}", " ".repeat(pad))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_logo_line_is_the_advertised_width() {
        for line in LOGO {
            assert_eq!(
                line.chars().count(),
                LOGO_WIDTH as usize,
                "ragged logo line: {line}"
            );
        }
    }

    #[test]
    fn every_hand_line_is_the_advertised_width() {
        for line in HAND {
            assert_eq!(
                line.chars().count(),
                HAND_WIDTH as usize,
                "ragged hand line: {line}"
            );
        }
    }

    #[test]
    fn every_lockup_line_is_the_advertised_width() {
        let lockup = lockup();
        assert_eq!(lockup.len(), HAND.len(), "the lockup is as tall as the hand");
        for line in &lockup {
            assert_eq!(
                line.chars().count(),
                LOCKUP_WIDTH as usize,
                "ragged lockup line: {line}"
            );
        }
    }

    /// Side by side, not stacked: the wordmark shares its rows with the hand,
    /// centred against it.
    #[test]
    fn the_wordmark_sits_beside_the_hand() {
        let lockup = lockup();
        let rows: Vec<usize> = lockup
            .iter()
            .enumerate()
            .filter(|(_, l)| l[..].contains(LOGO[0].trim()) || l.contains(LOGO[3].trim()))
            .map(|(i, _)| i)
            .collect();
        assert!(!rows.is_empty(), "wordmark missing from the lockup");
        for row in rows {
            let line = &lockup[row];
            let hand = HAND[row].trim();
            assert!(
                !hand.is_empty() && line.contains(hand),
                "row {row} must carry the hand too: {line}"
            );
        }
        let blank_above = lockup[0].chars().skip(HAND_WIDTH as usize).all(|c| c == ' ');
        assert!(blank_above, "the wordmark should be centred, not flush top");
    }
}
