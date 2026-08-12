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
