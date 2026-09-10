//! Terminal light/dark theme resolution.
//!
//! Resolved once at startup and read live everywhere a colour depends on the
//! terminal background (the syntect theme in `highlight`, the diff `+`/`-`
//! bands). The state is a process-wide flag, mirroring `set_think_tags_parsed`:
//! the colour helpers are reached from free render functions with no session in
//! hand. `false` (dark) is the default so tests and any pre-resolution render
//! match today's behaviour.

use std::sync::atomic::{AtomicBool, Ordering};

use ratatui::style::Color;

static IS_LIGHT: AtomicBool = AtomicBool::new(false);

/// Whether the resolved terminal theme is light. Dark until `resolve_and_apply`
/// says otherwise.
pub(super) fn is_light() -> bool {
    IS_LIGHT.load(Ordering::Relaxed)
}

/// The orange accent for strong text and the `[thinking]` badge. It is the one
/// markdown/badge colour that is truecolor rather than an ANSI name, so it does
/// not follow the terminal palette on its own: the bright orange that reads on a
/// dark background washes out on a light one, so light gets a deeper burnt
/// orange with real contrast on white.
const STRONG_ACCENT_DARK: Color = Color::Rgb(255, 165, 0);
const STRONG_ACCENT_LIGHT: Color = Color::Rgb(180, 83, 9);

fn strong_accent_for(light: bool) -> Color {
    if light {
        STRONG_ACCENT_LIGHT
    } else {
        STRONG_ACCENT_DARK
    }
}

/// Theme-aware orange accent. Reads the resolved theme live, like the diff bands.
pub(super) fn strong_accent() -> Color {
    strong_accent_for(is_light())
}

fn set_is_light(value: bool) {
    IS_LIGHT.store(value, Ordering::Relaxed);
}

/// Resolve the theme from the `theme` config value and, when it is auto/unset,
/// the terminal itself, and apply it process-wide. Called once at startup, after
/// raw mode is on (so the OSC query can read its reply) and before the first
/// highlight warms its theme.
pub(crate) fn resolve_and_apply(config: Option<String>) {
    set_is_light(classify(config.as_deref(), detect_is_light));
}

/// Decide light vs dark from the config value, deferring to `detect` only when
/// the value is auto/unset (or an unrecognized string). An explicit choice never
/// runs detection. Pure -- `detect` is passed in -- so the precedence is tested
/// without touching the terminal or the process-wide flag.
fn classify(config: Option<&str>, detect: impl FnOnce() -> Option<bool>) -> bool {
    match config.map(str::trim) {
        Some(v) if v.eq_ignore_ascii_case("light") => true,
        Some(v) if v.eq_ignore_ascii_case("dark") => false,
        _ => detect().unwrap_or(false),
    }
}

/// Best-effort terminal detection: query the background via OSC 11, falling back
/// to the `COLORFGBG` env var. `None` when neither answers.
fn detect_is_light() -> Option<bool> {
    query_osc11_is_light().or_else(|| colorfgbg_is_light(std::env::var("COLORFGBG").ok().as_deref()))
}

/// Perceived-luminance test (Rec. 601 weights) on an 8-bit colour. The midpoint
/// is what separates a light terminal background from a dark one.
fn luminance_is_light(r: u8, g: u8, b: u8) -> bool {
    let y = 299 * r as u32 + 587 * g as u32 + 114 * b as u32;
    y > 128_000
}

/// Parse an OSC 11 reply (`ESC ] 11 ; rgb:RRRR/GGGG/BBBB` then ST or BEL) into an
/// 8-bit colour. Components may be 1-4 hex digits; each is scaled to its high
/// byte so `ffff` and `ff` both read as 255.
fn parse_osc11(reply: &str) -> Option<(u8, u8, u8)> {
    let start = reply.find("rgb:")? + "rgb:".len();
    let rest = &reply[start..];
    let end = rest
        .find(|c: char| c != '/' && !c.is_ascii_hexdigit())
        .unwrap_or(rest.len());
    let mut parts = rest[..end].split('/');
    let comp = |s: Option<&str>| -> Option<u8> {
        let s = s?.trim();
        if s.is_empty() || s.len() > 4 {
            return None;
        }
        let v = u32::from_str_radix(s, 16).ok()?;
        // Scale from the reported bit-width to 8 bits: `f`->0xff, `ff`->0xff,
        // `ffff`->0xff, so any width lands on the same ceiling.
        let max = (1u32 << (4 * s.len())) - 1;
        Some((v * 255 / max) as u8)
    };
    Some((
        comp(parts.next())?,
        comp(parts.next())?,
        comp(parts.next())?,
    ))
}

/// Interpret `COLORFGBG` (`"fg;bg"`, sometimes `"fg;_;bg"`): the last field is
/// the background colour index. 0-6 and 8 are the dark ANSI colours; 7 and
/// 9-15 (and anything brighter) are light. `None` when unset or unparseable.
fn colorfgbg_is_light(value: Option<&str>) -> Option<bool> {
    let bg = value?.rsplit(';').next()?.trim();
    let n: u32 = bg.parse().ok()?;
    Some(!matches!(n, 0..=6 | 8))
}

/// Query the terminal background with OSC 11 and classify it. Unix only: it
/// needs a bounded read of the reply from the tty, which `libc::poll` gives
/// without leaking a thread on a terminal that never answers. Any non-tty or
/// read failure yields `None` so the caller falls back.
#[cfg(unix)]
fn query_osc11_is_light() -> Option<bool> {
    use std::io::Write;
    use std::os::unix::io::AsRawFd;
    use std::time::{Duration, Instant};

    let stdin = std::io::stdin();
    let fd = stdin.as_raw_fd();
    // Both ends must be a real terminal: no point querying a pipe, and reading
    // a redirected stdin would swallow input meant for the program.
    if unsafe { libc::isatty(fd) } != 1 || unsafe { libc::isatty(libc::STDOUT_FILENO) } != 1 {
        return None;
    }

    let mut stdout = std::io::stdout();
    // OSC 11 background query, ST-terminated.
    stdout.write_all(b"\x1b]11;?\x1b\\").ok()?;
    stdout.flush().ok()?;

    let deadline = Instant::now() + Duration::from_millis(120);
    let mut reply = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        let mut pfd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let ms = remaining.as_millis().min(i32::MAX as u128) as libc::c_int;
        if unsafe { libc::poll(&mut pfd, 1, ms) } <= 0 {
            break;
        }
        let mut buf = [0u8; 64];
        let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
        if n <= 0 {
            break;
        }
        reply.extend_from_slice(&buf[..n as usize]);
        // The reply ends at ST (ESC \) or BEL; stop as soon as one lands so a
        // terminal that answered is not held for the whole timeout.
        if reply.contains(&0x07) || reply.windows(2).any(|w| w == [0x1b, b'\\']) {
            break;
        }
        if reply.len() > 256 {
            break;
        }
    }
    parse_osc11(&String::from_utf8_lossy(&reply)).map(|(r, g, b)| luminance_is_light(r, g, b))
}

#[cfg(not(unix))]
fn query_osc11_is_light() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn luminance_splits_at_the_midpoint() {
        assert!(luminance_is_light(255, 255, 255), "white is light");
        assert!(!luminance_is_light(0, 0, 0), "black is dark");
        assert!(luminance_is_light(200, 200, 200), "pale grey is light");
        assert!(!luminance_is_light(40, 44, 52), "a dark editor bg is dark");
    }

    #[test]
    fn parse_osc11_scales_any_component_width() {
        assert_eq!(
            parse_osc11("\x1b]11;rgb:ffff/ffff/ffff\x1b\\"),
            Some((255, 255, 255))
        );
        assert_eq!(parse_osc11("\x1b]11;rgb:ff/ff/ff\x07"), Some((255, 255, 255)));
        assert_eq!(parse_osc11("\x1b]11;rgb:0000/0000/0000"), Some((0, 0, 0)));
        // Mixed widths and a real dark background.
        assert_eq!(
            parse_osc11("11;rgb:2828/2c2c/3434"),
            Some((40, 44, 52)),
            "high byte of each component"
        );
        assert_eq!(parse_osc11("no rgb here"), None);
    }

    #[test]
    fn colorfgbg_reads_the_background_index() {
        assert_eq!(colorfgbg_is_light(Some("15;0")), Some(false), "bg 0 is dark");
        assert_eq!(colorfgbg_is_light(Some("0;15")), Some(true), "bg 15 is light");
        assert_eq!(colorfgbg_is_light(Some("0;7")), Some(true), "bg 7 is light");
        assert_eq!(colorfgbg_is_light(Some("15;8")), Some(false), "bg 8 is dark");
        // Some terminals emit a three-field form; the last is still the bg.
        assert_eq!(colorfgbg_is_light(Some("15;default;0")), Some(false));
        assert_eq!(colorfgbg_is_light(None), None);
        assert_eq!(colorfgbg_is_light(Some("")), None);
        assert_eq!(colorfgbg_is_light(Some("nope")), None);
    }

    #[test]
    fn strong_accent_deepens_on_a_light_terminal() {
        assert_eq!(strong_accent_for(false), STRONG_ACCENT_DARK);
        assert_eq!(strong_accent_for(true), STRONG_ACCENT_LIGHT);
        assert_ne!(
            strong_accent_for(false),
            strong_accent_for(true),
            "the accent must differ per theme"
        );
    }

    #[test]
    fn classify_prefers_an_explicit_choice_over_detection() {
        // An explicit choice wins and never runs detection.
        assert!(classify(Some("light"), || panic!("must not detect")));
        assert!(!classify(Some("  DARK  "), || panic!("must not detect")));
        // Auto / unset / unknown defer to detection, then default to dark.
        assert!(classify(Some("auto"), || Some(true)));
        assert!(!classify(None, || Some(false)));
        assert!(!classify(Some("mauve"), || None), "unknown then no detect -> dark");
    }
}
