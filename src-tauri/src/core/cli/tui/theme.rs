//! Terminal theme resolution: light/dark background and colour depth.
//!
//! Resolved once at startup and read live everywhere a colour depends on the
//! terminal (the syntect theme in `highlight`, the diff `+`/`-` bands, the
//! accent). The state is process-wide, mirroring `set_think_tags_parsed`: the
//! colour helpers are reached from free render functions with no session in
//! hand. Dark truecolor is the default so tests and any pre-resolution render
//! match today's behaviour.
//!
//! Callers that need more than one colour take a resolved [`Theme`] (from
//! [`Theme::current`]) and pass every truecolor value through [`Theme::fit`] or
//! [`Theme::subtle`], so a 256- or 16-colour terminal never receives RGB codes it
//! would downsample on its own.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use ratatui::style::Color;

static IS_LIGHT: AtomicBool = AtomicBool::new(false);
static DEPTH: AtomicU8 = AtomicU8::new(ColorDepth::Truecolor as u8);

/// How many colours the terminal can show. Ordered richest first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ColorDepth {
    /// 24-bit RGB: every colour is emitted as-is.
    Truecolor = 0,
    /// The xterm 256-colour palette: RGB maps to the nearest `Color::Indexed`.
    Ansi256 = 1,
    /// The 16 named ANSI colours, whose actual values the user's palette picks.
    Ansi16 = 2,
}

impl ColorDepth {
    fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Ansi256,
            2 => Self::Ansi16,
            _ => Self::Truecolor,
        }
    }
}

/// The resolved terminal theme: everything a colour choice depends on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Theme {
    /// The terminal background is light.
    pub(super) light: bool,
    /// The colour depth colours are fitted to.
    pub(super) depth: ColorDepth,
}

/// The accent on a 16-colour terminal. There is no orange in the ANSI set;
/// yellow is the nearest hue, and since the user's palette already tunes it for
/// their background, one value serves both themes.
const STRONG_ACCENT_ANSI16: Color = Color::Yellow;

#[cfg(test)]
thread_local! {
    /// Per-test override, like `motion::with_mode`: a snapshot test pins its
    /// own thread's theme instead of racing others on the shared statics.
    /// Deliberately not consulted by `is_light`, which seeds the process-wide
    /// syntect theme once: an override seen there would leak into every later
    /// test in the process.
    static THEME_OVERRIDE: std::cell::Cell<Option<Theme>> =
        const { std::cell::Cell::new(None) };
}

/// Run `f` with `theme` as this thread's resolved theme.
#[cfg(test)]
pub(super) fn with_theme<T>(theme: Theme, f: impl FnOnce() -> T) -> T {
    THEME_OVERRIDE.with(|c| c.set(Some(theme)));
    let out = f();
    THEME_OVERRIDE.with(|c| c.set(None));
    out
}

impl Theme {
    /// The theme resolved at startup (dark truecolor before resolution).
    pub(super) fn current() -> Self {
        #[cfg(test)]
        {
            if let Some(over) = THEME_OVERRIDE.with(std::cell::Cell::get) {
                return over;
            }
        }
        Self {
            light: is_light(),
            depth: ColorDepth::from_u8(DEPTH.load(Ordering::Relaxed)),
        }
    }

    /// Fit a colour to the depth: RGB passes through on truecolor, maps to the
    /// nearest xterm index on 256 colours and to the nearest named colour on 16.
    /// Non-RGB colours already speak the terminal's palette and pass through.
    pub(super) fn fit(self, color: Color) -> Color {
        let Color::Rgb(r, g, b) = color else {
            return color;
        };
        match self.depth {
            ColorDepth::Truecolor => color,
            ColorDepth::Ansi256 => Color::Indexed(rgb_to_xterm256(r, g, b)),
            ColorDepth::Ansi16 => rgb_to_ansi16(r, g, b),
        }
    }

    /// Fit a subtle colour whose meaning lives in shades the 16 ANSI colours
    /// cannot express: a background tint under text the caller does not control,
    /// or a syntax token colour. `None` on 16 colours, where the nearest named
    /// colour is wrong (a saturated red band under code is unreadable; pastel
    /// tokens collapse to grey), so the caller drops it and falls back.
    pub(super) fn subtle(self, color: Color) -> Option<Color> {
        match self.depth {
            ColorDepth::Ansi16 => None,
            _ => Some(self.fit(color)),
        }
    }

    /// The orange accent for this theme and depth.
    pub(super) fn strong_accent(self) -> Color {
        match self.depth {
            ColorDepth::Ansi16 => STRONG_ACCENT_ANSI16,
            _ => self.fit(strong_accent_for(self.light)),
        }
    }
}

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

/// RGB channels of a colour, for code that blends between palette colours.
/// The palette is defined in RGB, so `None` only for a named colour.
pub(super) fn channels(color: Color) -> Option<(u8, u8, u8)> {
    match color {
        Color::Rgb(r, g, b) => Some((r, g, b)),
        _ => None,
    }
}

/// The orange strong accent's truecolor value for a background.
pub(super) fn strong_accent_rgb(light: bool) -> Color {
    strong_accent_for(light)
}

/// Theme-aware orange accent. Reads the resolved theme live, like the diff bands.
pub(super) fn strong_accent() -> Color {
    Theme::current().strong_accent()
}

/// A named chrome colour: what a border, title, hint or badge means, not which
/// hue it is. Every panel reads these instead of picking an ANSI name per call
/// site, so related elements (all input-waiting borders, all warnings) share
/// one colour and retheme together.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Role {
    /// Interactive emphasis: titles, selections, running tool labels.
    Accent,
    /// The border of a panel that only shows state.
    BorderIdle,
    /// The border of a panel waiting for the user's input.
    BorderActive,
    /// Needs attention: approvals, a zero cache hit, a parked run.
    Warning,
    /// Done or healthy.
    Success,
    /// Secondary text: hints, counts, separators.
    Muted,
}

impl Role {
    /// The truecolor value per background. Light values are deeper so they keep
    /// contrast on white; dark values are softer so they do not glare.
    pub(super) fn rgb(self, light: bool) -> Color {
        let (r, g, b) = match (self, light) {
            (Role::Accent | Role::BorderActive, false) => (86, 182, 194),
            (Role::Accent | Role::BorderActive, true) => (0, 110, 130),
            (Role::BorderIdle, false) => (92, 99, 112),
            (Role::BorderIdle, true) => (160, 166, 178),
            (Role::Warning, false) => (229, 192, 123),
            (Role::Warning, true) => (154, 103, 0),
            (Role::Success, false) => (152, 195, 121),
            (Role::Success, true) => (36, 128, 60),
            (Role::Muted, false) => (128, 128, 128),
            (Role::Muted, true) => (110, 110, 110),
        };
        Color::Rgb(r, g, b)
    }

    /// The named colour on a 16-colour terminal. Chosen by meaning rather than
    /// by nearest RGB (which would grey out the softer accents), and safe on
    /// either background because the user's palette already tunes the names.
    fn ansi16(self) -> Color {
        match self {
            Role::Accent | Role::BorderActive => Color::Cyan,
            Role::BorderIdle | Role::Muted => Color::DarkGray,
            Role::Warning => Color::Yellow,
            Role::Success => Color::Green,
        }
    }
}

impl Theme {
    /// The colour of `role` fitted to this theme and depth.
    pub(super) fn role(self, role: Role) -> Color {
        match self.depth {
            ColorDepth::Ansi16 => role.ansi16(),
            _ => self.fit(role.rgb(self.light)),
        }
    }

    /// Text drawn on a filled palette colour (a panel title, a badge). The
    /// light palette is deep enough that white reads on it; the dark palette
    /// and the user's 16 named colours are bright, so black does.
    pub(super) fn on_fill(self) -> Color {
        if self.light && self.depth != ColorDepth::Ansi16 {
            Color::White
        } else {
            Color::Black
        }
    }
}

/// Text drawn on a filled palette colour.
pub(super) fn on_fill() -> Color {
    Theme::current().on_fill()
}

/// Interactive emphasis: panel titles, selections, the running tool label.
pub(super) fn accent() -> Color {
    Theme::current().role(Role::Accent)
}

/// The border of a panel that only shows state (todo, subagents).
pub(super) fn border_idle() -> Color {
    Theme::current().role(Role::BorderIdle)
}

/// The border of a panel waiting for input (pickers, approvals, settings).
pub(super) fn border_active() -> Color {
    Theme::current().role(Role::BorderActive)
}

/// Needs attention.
pub(super) fn warning() -> Color {
    Theme::current().role(Role::Warning)
}

/// Done or healthy.
pub(super) fn success() -> Color {
    Theme::current().role(Role::Success)
}

/// Secondary text: hints, counts, separators.
pub(super) fn muted() -> Color {
    Theme::current().role(Role::Muted)
}

fn set_is_light(value: bool) {
    IS_LIGHT.store(value, Ordering::Relaxed);
}

/// Resolve the theme from the `theme` config value and, when it is auto/unset,
/// the terminal itself, and apply it process-wide together with the colour
/// depth. Called once at startup, after raw mode is on (so the OSC query can
/// read its reply) and before the first highlight warms its theme.
pub(crate) fn resolve_and_apply(config: Option<String>) {
    set_is_light(classify(config.as_deref(), detect_is_light));
    DEPTH.store(detect_depth() as u8, Ordering::Relaxed);
}

/// Colour depth from the environment.
fn detect_depth() -> ColorDepth {
    classify_depth(|name| std::env::var(name).ok())
}

/// `TERM` values that name a terminal limited to the 16 ANSI colours.
const ANSI16_TERMS: &[&str] = &[
    "linux", "vt100", "vt102", "vt220", "ansi", "xterm", "xterm-color", "screen", "tmux",
    "rxvt", "cygwin",
];

/// Decide the colour depth from the environment `var` reads, in precedence
/// order (the order the `supports-color` crate uses, plus a Windows Terminal
/// promotion):
///
/// 1. `FORCE_COLOR` -- the user's explicit level: `3` truecolor, `2` 256,
///    anything else that is set 16 (there is no colourless mode to fall to).
/// 2. `WT_SESSION` -- Windows Terminal renders truecolor but sets neither
///    `COLORTERM` nor a telling `TERM`, and under WSL inherits a stale one.
/// 3. `TERM=dumb` -- no colour to speak of, so the most conservative depth.
/// 4. `COLORTERM` of `truecolor`/`24bit`.
/// 5. `TERM`: `-direct`/truecolor names, then `256color`, then a known
///    16-colour name.
///
/// Anything else is inconclusive and keeps truecolor, today's behaviour. Pure
/// -- `var` is passed in -- so the precedence is tested without the process env.
fn classify_depth(var: impl Fn(&str) -> Option<String>) -> ColorDepth {
    let read = |name| var(name).map(|v| v.trim().to_ascii_lowercase());
    if let Some(force) = read("FORCE_COLOR") {
        return match force.as_str() {
            "3" => ColorDepth::Truecolor,
            "2" => ColorDepth::Ansi256,
            _ => ColorDepth::Ansi16,
        };
    }
    if read("WT_SESSION").is_some_and(|v| !v.is_empty()) {
        return ColorDepth::Truecolor;
    }
    let term = read("TERM").unwrap_or_default();
    if term == "dumb" {
        return ColorDepth::Ansi16;
    }
    let colorterm = read("COLORTERM").unwrap_or_default();
    if colorterm == "truecolor" || colorterm == "24bit" {
        return ColorDepth::Truecolor;
    }
    if term.ends_with("-direct") || term.contains("truecolor") || term.contains("24bit") {
        ColorDepth::Truecolor
    } else if term.contains("256col") {
        ColorDepth::Ansi256
    } else if term.ends_with("-16color") || ANSI16_TERMS.contains(&term.as_str()) {
        ColorDepth::Ansi16
    } else {
        ColorDepth::Truecolor
    }
}

/// Channel values of the xterm 6x6x6 colour cube (indices 16-231).
const CUBE_LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];

/// Channel spread (max - min) at or above which a colour counts as tinted.
const TINT_SPREAD: u8 = 24;

fn dist2(a: (u8, u8, u8), b: (u8, u8, u8)) -> u32 {
    let d = |x: u8, y: u8| (x as i32 - y as i32).pow(2) as u32;
    d(a.0, b.0) + d(a.1, b.1) + d(a.2, b.2)
}

/// Nearest xterm-256 index for an RGB colour, from the cube (16-231) or the grey
/// ramp (232-255); never 0-15, whose values the user's palette redefines.
///
/// A tinted colour stays in the cube even when a grey is closer by distance:
/// the diff bands are dark, desaturated tints whose whole job is their hue, and
/// plain nearest-distance would turn both the add and the remove band into the
/// same grey.
fn rgb_to_xterm256(r: u8, g: u8, b: u8) -> u8 {
    let level = |v: u8| -> usize {
        // Midpoints between the uneven cube levels: 0|95 at 48, then every 40.
        match v {
            0..=47 => 0,
            48..=114 => 1,
            _ => ((v - 35) / 40) as usize,
        }
    };
    let (ri, gi, bi) = (level(r), level(g), level(b));
    let cube = (CUBE_LEVELS[ri], CUBE_LEVELS[gi], CUBE_LEVELS[bi]);
    let cube_index = 16 + 36 * ri as u8 + 6 * gi as u8 + bi as u8;

    let spread = r.max(g).max(b) - r.min(g).min(b);
    if spread >= TINT_SPREAD {
        return cube_index;
    }
    // Grey ramp step i is 8 + 10i for i in 0..24.
    let avg = (r as u32 + g as u32 + b as u32) / 3;
    let step = (avg.saturating_sub(3) / 10).min(23) as u8;
    let grey = 8 + 10 * step;
    if dist2((r, g, b), (grey, grey, grey)) < dist2((r, g, b), cube) {
        232 + step
    } else {
        cube_index
    }
}

/// The 16 named colours with xterm's default values, for nearest matching.
const ANSI16: [(Color, (u8, u8, u8)); 16] = [
    (Color::Black, (0, 0, 0)),
    (Color::Red, (205, 0, 0)),
    (Color::Green, (0, 205, 0)),
    (Color::Yellow, (205, 205, 0)),
    (Color::Blue, (0, 0, 238)),
    (Color::Magenta, (205, 0, 205)),
    (Color::Cyan, (0, 205, 205)),
    (Color::Gray, (229, 229, 229)),
    (Color::DarkGray, (127, 127, 127)),
    (Color::LightRed, (255, 0, 0)),
    (Color::LightGreen, (0, 255, 0)),
    (Color::LightYellow, (255, 255, 0)),
    (Color::LightBlue, (92, 92, 255)),
    (Color::LightMagenta, (255, 0, 255)),
    (Color::LightCyan, (0, 255, 255)),
    (Color::White, (255, 255, 255)),
];

/// Nearest named ANSI colour, measured against xterm's defaults. The user's
/// palette decides the real values, which is the point: the colour then follows
/// their theme instead of being an RGB code the terminal cannot show.
fn rgb_to_ansi16(r: u8, g: u8, b: u8) -> Color {
    ANSI16
        .iter()
        .min_by_key(|(_, rgb)| dist2((r, g, b), *rgb))
        .map(|(c, _)| *c)
        .unwrap_or(Color::Reset)
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

    fn theme(light: bool, depth: ColorDepth) -> Theme {
        Theme { light, depth }
    }

    /// `classify_depth` over a fixed environment.
    fn depth(env: &[(&str, &str)]) -> ColorDepth {
        classify_depth(|name| {
            env.iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        })
    }

    #[test]
    fn depth_defaults_to_truecolor_when_inconclusive() {
        assert_eq!(depth(&[]), ColorDepth::Truecolor);
        assert_eq!(depth(&[("COLORTERM", ""), ("TERM", "")]), ColorDepth::Truecolor);
        assert_eq!(
            depth(&[("COLORTERM", "yes"), ("TERM", "xterm-kitty")]),
            ColorDepth::Truecolor
        );
        assert_eq!(depth(&[("TERM", "alacritty")]), ColorDepth::Truecolor);
    }

    #[test]
    fn depth_reads_colorterm_then_term() {
        assert_eq!(depth(&[("COLORTERM", "truecolor")]), ColorDepth::Truecolor);
        assert_eq!(depth(&[("COLORTERM", " 24BIT ")]), ColorDepth::Truecolor);
        // COLORTERM outranks a TERM that undersells the terminal.
        assert_eq!(
            depth(&[("COLORTERM", "truecolor"), ("TERM", "xterm-256color")]),
            ColorDepth::Truecolor
        );
        assert_eq!(
            depth(&[("COLORTERM", "truecolor"), ("TERM", "xterm")]),
            ColorDepth::Truecolor
        );
        assert_eq!(depth(&[("TERM", "xterm-direct")]), ColorDepth::Truecolor);
        assert_eq!(depth(&[("TERM", "xterm-256color")]), ColorDepth::Ansi256);
        assert_eq!(depth(&[("TERM", "tmux-256color")]), ColorDepth::Ansi256);
        assert_eq!(depth(&[("TERM", "screen.xterm-256color")]), ColorDepth::Ansi256);
        for term in ["linux", "vt100", "xterm", "xterm-color", "screen", "xterm-16color"] {
            assert_eq!(depth(&[("TERM", term)]), ColorDepth::Ansi16, "{term}");
        }
    }

    #[test]
    fn dumb_term_outranks_colorterm() {
        assert_eq!(
            depth(&[("COLORTERM", "truecolor"), ("TERM", "dumb")]),
            ColorDepth::Ansi16
        );
    }

    #[test]
    fn windows_terminal_is_truecolor_whatever_term_says() {
        assert_eq!(depth(&[("WT_SESSION", "abc")]), ColorDepth::Truecolor);
        assert_eq!(
            depth(&[("WT_SESSION", "abc"), ("TERM", "xterm")]),
            ColorDepth::Truecolor
        );
        assert_eq!(
            depth(&[("WT_SESSION", "abc"), ("TERM", "dumb")]),
            ColorDepth::Truecolor
        );
        assert_eq!(
            depth(&[("WT_SESSION", ""), ("TERM", "xterm")]),
            ColorDepth::Ansi16,
            "an empty WT_SESSION says nothing"
        );
    }

    #[test]
    fn force_color_outranks_everything() {
        let wt = ("WT_SESSION", "abc");
        let tc = ("COLORTERM", "truecolor");
        assert_eq!(depth(&[("FORCE_COLOR", "3"), ("TERM", "dumb")]), ColorDepth::Truecolor);
        assert_eq!(depth(&[("FORCE_COLOR", "2"), wt, tc]), ColorDepth::Ansi256);
        assert_eq!(depth(&[("FORCE_COLOR", "1"), wt, tc]), ColorDepth::Ansi16);
        assert_eq!(depth(&[("FORCE_COLOR", "0"), wt]), ColorDepth::Ansi16);
        assert_eq!(depth(&[("FORCE_COLOR", ""), tc]), ColorDepth::Ansi16);
    }

    #[test]
    fn xterm256_maps_cube_and_grey_ramp() {
        assert_eq!(rgb_to_xterm256(0, 0, 0), 16);
        assert_eq!(rgb_to_xterm256(255, 255, 255), 231);
        assert_eq!(rgb_to_xterm256(95, 135, 175), 67);
        assert_eq!(rgb_to_xterm256(255, 0, 0), 196);
        assert_eq!(rgb_to_xterm256(128, 128, 128), 244, "exact grey step");
        assert_eq!(rgb_to_xterm256(238, 238, 238), 255, "top of the ramp");
        assert_eq!(rgb_to_xterm256(40, 44, 58), 236, "a slate is near-grey");
        assert_eq!(rgb_to_xterm256(255, 165, 0), 214);
        assert_eq!(rgb_to_xterm256(180, 83, 9), 130);
    }

    #[test]
    fn xterm256_keeps_the_hue_of_a_dark_tint() {
        // Plain nearest-distance would grey both diff bands out; they stay green
        // and red.
        assert_eq!(rgb_to_xterm256(22, 52, 32), 22);
        assert_eq!(rgb_to_xterm256(66, 26, 30), 52);
        assert_eq!(rgb_to_xterm256(198, 239, 206), 194);
        assert_eq!(rgb_to_xterm256(255, 205, 210), 224);
    }

    #[test]
    fn ansi16_picks_the_nearest_named_colour() {
        assert_eq!(rgb_to_ansi16(0, 0, 0), Color::Black);
        assert_eq!(rgb_to_ansi16(250, 250, 250), Color::White);
        assert_eq!(rgb_to_ansi16(200, 10, 10), Color::Red);
        assert_eq!(rgb_to_ansi16(10, 250, 10), Color::LightGreen);
        assert_eq!(rgb_to_ansi16(40, 44, 58), Color::Black);
        assert_eq!(rgb_to_ansi16(226, 232, 240), Color::Gray);
    }

    #[test]
    fn fit_emits_the_variant_for_each_depth() {
        let rgb = Color::Rgb(22, 52, 32);
        assert_eq!(theme(false, ColorDepth::Truecolor).fit(rgb), rgb);
        assert_eq!(theme(false, ColorDepth::Ansi256).fit(rgb), Color::Indexed(22));
        assert!(!matches!(
            theme(false, ColorDepth::Ansi16).fit(rgb),
            Color::Rgb(..) | Color::Indexed(..)
        ));
        // Palette colours are already safe at any depth.
        for depth in [ColorDepth::Truecolor, ColorDepth::Ansi256, ColorDepth::Ansi16] {
            assert_eq!(theme(true, depth).fit(Color::Cyan), Color::Cyan);
        }
    }

    #[test]
    fn subtle_colours_are_dropped_on_sixteen_colours() {
        let rgb = Color::Rgb(66, 26, 30);
        assert_eq!(theme(false, ColorDepth::Truecolor).subtle(rgb), Some(rgb));
        assert_eq!(theme(false, ColorDepth::Ansi256).subtle(rgb), Some(Color::Indexed(52)));
        assert_eq!(theme(false, ColorDepth::Ansi16).subtle(rgb), None);
    }

    #[test]
    fn strong_accent_has_a_fallback_per_depth() {
        let t = |light, depth| theme(light, depth).strong_accent();
        assert_eq!(t(false, ColorDepth::Truecolor), STRONG_ACCENT_DARK);
        assert_eq!(t(true, ColorDepth::Truecolor), STRONG_ACCENT_LIGHT);
        assert_eq!(t(false, ColorDepth::Ansi256), Color::Indexed(214));
        assert_eq!(t(true, ColorDepth::Ansi256), Color::Indexed(130));
        assert_eq!(t(false, ColorDepth::Ansi16), Color::Yellow);
        assert_eq!(t(true, ColorDepth::Ansi16), Color::Yellow);
    }

    const ROLES: [Role; 6] = [
        Role::Accent,
        Role::BorderIdle,
        Role::BorderActive,
        Role::Warning,
        Role::Success,
        Role::Muted,
    ];

    #[test]
    fn palette_is_rgb_per_background_on_truecolor() {
        for role in ROLES {
            let dark = theme(false, ColorDepth::Truecolor).role(role);
            let light = theme(true, ColorDepth::Truecolor).role(role);
            assert_eq!(dark, role.rgb(false), "{role:?}");
            assert_eq!(light, role.rgb(true), "{role:?}");
            assert_ne!(dark, light, "{role:?} must differ per background");
        }
    }

    #[test]
    fn palette_light_values_are_darker_than_dark_values() {
        let lum = |c: Color| match c {
            Color::Rgb(r, g, b) => 299 * r as u32 + 587 * g as u32 + 114 * b as u32,
            other => panic!("not rgb: {other:?}"),
        };
        for role in ROLES {
            if role == Role::BorderIdle {
                // An idle border recedes: lighter than text on white.
                continue;
            }
            assert!(lum(role.rgb(true)) < lum(role.rgb(false)), "{role:?}");
        }
    }

    #[test]
    fn palette_is_indexed_on_256_colours() {
        for light in [false, true] {
            for role in ROLES {
                let c = theme(light, ColorDepth::Ansi256).role(role);
                assert!(matches!(c, Color::Indexed(_)), "{role:?} light={light}: {c:?}");
            }
        }
    }

    #[test]
    fn palette_is_named_on_sixteen_colours() {
        for light in [false, true] {
            let t = |role| theme(light, ColorDepth::Ansi16).role(role);
            assert_eq!(t(Role::Accent), Color::Cyan);
            assert_eq!(t(Role::BorderActive), Color::Cyan);
            assert_eq!(t(Role::BorderIdle), Color::DarkGray);
            assert_eq!(t(Role::Warning), Color::Yellow);
            assert_eq!(t(Role::Success), Color::Green);
            assert_eq!(t(Role::Muted), Color::DarkGray);
        }
    }

    #[test]
    fn fill_text_contrasts_with_the_palette() {
        assert_eq!(theme(false, ColorDepth::Truecolor).on_fill(), Color::Black);
        assert_eq!(theme(true, ColorDepth::Truecolor).on_fill(), Color::White);
        assert_eq!(theme(true, ColorDepth::Ansi256).on_fill(), Color::White);
        assert_eq!(theme(true, ColorDepth::Ansi16).on_fill(), Color::Black);
        assert_eq!(theme(false, ColorDepth::Ansi16).on_fill(), Color::Black);
    }

    #[test]
    fn palette_functions_read_the_current_theme() {
        let light16 = theme(true, ColorDepth::Ansi16);
        with_theme(light16, || {
            assert_eq!(accent(), Color::Cyan);
            assert_eq!(border_idle(), Color::DarkGray);
            assert_eq!(border_active(), Color::Cyan);
            assert_eq!(warning(), Color::Yellow);
            assert_eq!(success(), Color::Green);
            assert_eq!(muted(), Color::DarkGray);
        });
        with_theme(theme(true, ColorDepth::Truecolor), || {
            assert_eq!(accent(), Role::Accent.rgb(true));
            assert_eq!(warning(), Role::Warning.rgb(true));
        });
        assert_eq!(accent(), Role::Accent.rgb(false), "default is dark truecolor");
    }

    #[test]
    fn the_unresolved_theme_is_dark_truecolor() {
        // Nothing in the test binary resolves the theme, so this is the default.
        assert_eq!(Theme::current(), theme(false, ColorDepth::Truecolor));
        assert_eq!(strong_accent(), STRONG_ACCENT_DARK);
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
