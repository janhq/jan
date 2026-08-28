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

/// The hand-wave mark as a single glyph, for the header's leading column where
/// the block art has no room. No VS16: the emoji is already presentation-default
/// and the extra selector makes some terminals advance a column ratatui has not
/// reserved, which shifts the rest of the row.
pub const WAVE: &str = "\u{1F44B}";

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
}
