//! The one place the TUI decides whether something moves.
//!
//! Every animated element -- the throbber, the brightness sweep on a status
//! word, the travelling `wave` glyph, a running tool row -- asks this module
//! for its frame and gets an explicit static fallback when motion is off. The
//! mode is resolved once at launch from `[tui] animations` in
//! `~/.jan/config.toml` and the OS reduce-motion preference, and is
//! process-wide for the same reason as the theme: the render helpers are free
//! functions with no session in hand.
//!
//! Animation is driven by the render loop's frame counter rather than the wall
//! clock, so every frame is a pure function of its inputs: a test passes a
//! frame and gets the same spans every time.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use super::theme::{ColorDepth, Theme};

/// Whether the TUI animates or holds every element still.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MotionMode {
    Animated,
    Reduced,
}

impl MotionMode {
    pub(super) fn from_animations_enabled(enabled: bool) -> Self {
        if enabled {
            Self::Animated
        } else {
            Self::Reduced
        }
    }
}

/// Process-wide "motion is reduced" flag. Animated until `init` says
/// otherwise, so a render before resolution (and every test) animates.
static REDUCED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
thread_local! {
    /// Per-test override, like `WAVE_GLYPH_OVERRIDE`: a test pins its own
    /// thread's mode instead of racing others on the shared flag.
    static MODE_OVERRIDE: std::cell::Cell<Option<MotionMode>> =
        const { std::cell::Cell::new(None) };
}

/// The resolved motion mode.
pub(super) fn mode() -> MotionMode {
    #[cfg(test)]
    {
        if let Some(over) = MODE_OVERRIDE.with(std::cell::Cell::get) {
            return over;
        }
    }
    if REDUCED.load(Ordering::Relaxed) {
        MotionMode::Reduced
    } else {
        MotionMode::Animated
    }
}

/// Run `f` with `mode` as this thread's motion mode.
#[cfg(test)]
pub(super) fn with_mode<T>(mode: MotionMode, f: impl FnOnce() -> T) -> T {
    MODE_OVERRIDE.with(|c| c.set(Some(mode)));
    let out = f();
    MODE_OVERRIDE.with(|c| c.set(None));
    out
}

/// Resolve the mode at launch: `animations = false` reduces motion outright;
/// otherwise the OS preference is read off the render thread and, if it asks
/// for less motion, reduces it when the answer lands. The OS can only take
/// motion away, never add it back over the config.
pub(crate) fn init(animations: bool) {
    let mode = MotionMode::from_animations_enabled(animations);
    REDUCED.store(mode == MotionMode::Reduced, Ordering::Relaxed);
    if mode == MotionMode::Animated {
        // A subprocess round trip (tens of ms) must not delay the first frame;
        // the worst case is a few animated frames before the switch.
        std::thread::spawn(|| {
            if os_prefers_reduced_motion() == Some(true) {
                REDUCED.store(true, Ordering::Relaxed);
            }
        });
    }
}

/// The OS reduce-motion preference, where it is readable without FFI: macOS
/// through `defaults`, a GNOME-family desktop through `gsettings`. `None`
/// elsewhere (Windows needs `SystemParametersInfo`, which is `unsafe` FFI) and
/// whenever the tool is missing or says nothing usable.
fn os_prefers_reduced_motion() -> Option<bool> {
    if cfg!(target_os = "macos") {
        read_command("defaults", &["read", "com.apple.universalaccess", "reduceMotion"])
            .and_then(|out| macos_reduce_motion(&out))
    } else if cfg!(all(unix, not(target_os = "macos"))) {
        read_command(
            "gsettings",
            &["get", "org.gnome.desktop.interface", "enable-animations"],
        )
        .and_then(|out| gnome_reduce_motion(&out))
    } else {
        None
    }
}

fn read_command(program: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `defaults read com.apple.universalaccess reduceMotion` prints `1` or `0`.
fn macos_reduce_motion(out: &str) -> Option<bool> {
    match out.trim() {
        "1" | "true" => Some(true),
        "0" | "false" => Some(false),
        _ => None,
    }
}

/// `gsettings get org.gnome.desktop.interface enable-animations` prints
/// `true` or `false`; animations off is the reduce-motion request.
fn gnome_reduce_motion(out: &str) -> Option<bool> {
    match out.trim() {
        "false" => Some(true),
        "true" => Some(false),
        _ => None,
    }
}

/// Shown in place of the Braille throbber when motion is reduced: one cell,
/// like every throbber frame, so nothing beside it shifts.
pub(super) const STATIC_GLYPH: &str = "\u{2022}";

/// The throbber frame for `frame`, or the static glyph when motion is reduced.
pub(super) fn spinner(frame: usize, mode: MotionMode) -> &'static str {
    match mode {
        MotionMode::Animated => super::SPINNER[frame % super::SPINNER.len()],
        MotionMode::Reduced => STATIC_GLYPH,
    }
}

/// Wall time a frame count stands for. The shimmer is timed off the render
/// loop's frame counter, so it is as deterministic as the throbber.
pub(super) fn frame_time(frame: usize) -> Duration {
    Duration::from_millis((frame as u64).saturating_mul(super::SPINNER_ADVANCE_MS))
}

/// The hue a sweep brightens: the text's resting colour approximated in RGB,
/// and the colour the crest peaks at. Characters outside the crest keep the
/// caller's own style untouched, so only the crest ever uses these values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Tint {
    /// Dim default-foreground text: the working words.
    Muted,
    /// The orange reasoning accent: the thinking words.
    Accent,
    /// The cyan of a running tool label.
    Cyan,
    /// The yellow of the `[thinking]` badge.
    Yellow,
}

type Rgb = (u8, u8, u8);

impl Tint {
    /// `(rest, crest)`. A dark background brightens toward white; a light one
    /// deepens toward black, which is what reads as "brighter" on white.
    fn colors(self, light: bool) -> (Rgb, Rgb) {
        match (self, light) {
            (Tint::Muted, false) => ((128, 128, 128), (240, 240, 240)),
            (Tint::Muted, true) => ((140, 140, 140), (20, 20, 20)),
            (Tint::Accent, false) => ((255, 165, 0), (255, 235, 180)),
            (Tint::Accent, true) => ((180, 83, 9), (80, 30, 0)),
            (Tint::Cyan, false) => ((0, 160, 170), (190, 255, 255)),
            (Tint::Cyan, true) => ((0, 120, 130), (0, 40, 50)),
            (Tint::Yellow, false) => ((205, 205, 0), (255, 255, 200)),
            (Tint::Yellow, true) => ((150, 120, 0), (60, 45, 0)),
        }
    }
}

/// One full pass of the crest, start to end.
const SWEEP: Duration = Duration::from_millis(2000);
/// Half-width of the crest, in characters.
const BAND_HALF: f32 = 4.0;
/// Characters of empty run-up either side of the text, so the crest enters and
/// leaves smoothly and the text rests between passes.
const SWEEP_PAD: usize = 6;
/// Below this the crest is indistinguishable from the resting style, so the
/// character keeps the caller's style exactly.
const CREST_FLOOR: f32 = 0.05;

/// Crest strength (0..=1) at character `i` of a `len`-character text at time
/// `t`: a raised-cosine band that sweeps left to right once per `SWEEP`.
pub(super) fn crest(i: usize, len: usize, t: Duration) -> f32 {
    let period = len + 2 * SWEEP_PAD;
    let phase = (t.as_millis() % SWEEP.as_millis()) as f32 / SWEEP.as_millis() as f32;
    let head = phase * period as f32 - SWEEP_PAD as f32;
    let dist = (i as f32 - head).abs();
    if dist > BAND_HALF {
        0.0
    } else {
        0.5 * (1.0 + (std::f32::consts::PI * dist / BAND_HALF).cos())
    }
}

fn blend(from: Rgb, to: Rgb, t: f32) -> Rgb {
    let mix = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
    (mix(from.0, to.0), mix(from.1, to.1), mix(from.2, to.2))
}

/// Whether a sweep may run at all. A 16-colour terminal has no in-between
/// shades, so a sweep there is a block of the nearest named colour jumping
/// across the word; the static style reads better.
fn may_shimmer(mode: MotionMode, theme: Theme) -> bool {
    mode == MotionMode::Animated && theme.depth != ColorDepth::Ansi16
}

/// The style of character `i` of `len` under a sweep at `t`.
fn crest_style(i: usize, len: usize, style: Style, tint: Tint, t: Duration, theme: Theme) -> Style {
    let level = crest(i, len, t);
    if level < CREST_FLOOR {
        return style;
    }
    let (rest, peak) = tint.colors(theme.light);
    let (r, g, b) = blend(rest, peak, level);
    style
        .remove_modifier(Modifier::DIM)
        .fg(theme.fit(Color::Rgb(r, g, b)))
}

/// `text` with a brightness sweep across it, one span per run of equal style.
/// Only colour changes: the text, and so the width, is identical at every `t`.
/// Reduced motion and 16-colour terminals get `text` in `style`, unchanged.
pub(super) fn shimmer(
    text: &str,
    style: Style,
    tint: Tint,
    t: Duration,
    mode: MotionMode,
    theme: Theme,
) -> Vec<Span<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    if !may_shimmer(mode, theme) {
        return vec![Span::styled(text.to_string(), style)];
    }
    let len = text.chars().count();
    runs(text.chars().enumerate().map(|(i, c)| {
        (c, crest_style(i, len, style, tint, t, theme))
    }))
}

/// Sweep every span of `lines` styled exactly `target` as one continuous text,
/// for a label that has already been wrapped across rows: the crest crosses
/// from one row into the next instead of restarting on each. Spans in any
/// other style (gutters, tags, suffixes) are left alone.
pub(super) fn shimmer_styled(
    lines: Vec<Line<'static>>,
    target: Style,
    tint: Tint,
    t: Duration,
    mode: MotionMode,
    theme: Theme,
) -> Vec<Line<'static>> {
    if !may_shimmer(mode, theme) {
        return lines;
    }
    let len: usize = lines
        .iter()
        .flat_map(|l| l.spans.iter())
        .filter(|s| s.style == target)
        .map(|s| s.content.chars().count())
        .sum();
    let mut at = 0usize;
    lines
        .into_iter()
        .map(|line| {
            let mut spans = Vec::with_capacity(line.spans.len());
            for span in line.spans {
                if span.style != target {
                    spans.push(span);
                    continue;
                }
                let start = at;
                at += span.content.chars().count();
                spans.extend(runs(span.content.chars().enumerate().map(|(k, c)| {
                    (c, crest_style(start + k, len, target, tint, t, theme))
                })));
            }
            Line::from(spans).style(line.style)
        })
        .collect()
}

/// Fold styled characters into spans, merging neighbours of equal style so a
/// mostly-resting text costs a handful of spans rather than one per character.
pub(super) fn runs(chars: impl Iterator<Item = (char, Style)>) -> Vec<Span<'static>> {
    let mut out: Vec<Span<'static>> = Vec::new();
    let mut text = String::new();
    let mut current: Option<Style> = None;
    for (c, style) in chars {
        if current.is_some_and(|s| s != style) {
            out.push(Span::styled(std::mem::take(&mut text), current.unwrap_or_default()));
        }
        current = Some(style);
        text.push(c);
    }
    if let Some(style) = current {
        out.push(Span::styled(text, style));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const DARK_TC: Theme = Theme { light: false, depth: ColorDepth::Truecolor };

    fn text_of(spans: &[Span<'static>]) -> String {
        spans.iter().map(|s| s.content.as_ref()).collect()
    }

    fn per_char_styles(spans: &[Span<'static>]) -> Vec<Style> {
        spans
            .iter()
            .flat_map(|s| s.content.chars().map(move |_| s.style))
            .collect()
    }

    #[test]
    fn the_config_switch_maps_to_a_mode() {
        assert_eq!(MotionMode::from_animations_enabled(true), MotionMode::Animated);
        assert_eq!(MotionMode::from_animations_enabled(false), MotionMode::Reduced);
    }

    #[test]
    fn the_os_preference_parsers_read_only_clear_answers() {
        assert_eq!(macos_reduce_motion("1\n"), Some(true));
        assert_eq!(macos_reduce_motion("0\n"), Some(false));
        assert_eq!(macos_reduce_motion("does not exist"), None);
        assert_eq!(gnome_reduce_motion("false\n"), Some(true));
        assert_eq!(gnome_reduce_motion("true\n"), Some(false));
        assert_eq!(gnome_reduce_motion(""), None);
    }

    #[test]
    fn the_test_override_pins_the_mode() {
        assert_eq!(with_mode(MotionMode::Reduced, mode), MotionMode::Reduced);
        assert_eq!(with_mode(MotionMode::Animated, mode), MotionMode::Animated);
    }

    #[test]
    fn reduced_motion_holds_the_throbber_still() {
        let frames: Vec<&str> = (0..12).map(|f| spinner(f, MotionMode::Reduced)).collect();
        assert!(frames.iter().all(|g| *g == STATIC_GLYPH), "{frames:?}");
        assert_ne!(spinner(0, MotionMode::Animated), spinner(1, MotionMode::Animated));
    }

    /// The same time always yields the same frame, and the crest moves as
    /// time does.
    #[test]
    fn the_sweep_is_a_pure_function_of_time() {
        let style = Style::new().cyan();
        let at = |ms: u64| {
            shimmer("working", style, Tint::Cyan, Duration::from_millis(ms), MotionMode::Animated, DARK_TC)
        };
        assert_eq!(at(700), at(700), "deterministic");
        assert_eq!(at(700), at(700 + SWEEP.as_millis() as u64), "periodic");
        assert_ne!(per_char_styles(&at(500)), per_char_styles(&at(900)), "the crest moves");
    }

    /// Colour only: the text is intact at every point of the sweep.
    #[test]
    fn the_sweep_never_changes_the_text() {
        for ms in (0..2000).step_by(80) {
            let spans = shimmer(
                "thinking",
                Style::new().yellow(),
                Tint::Yellow,
                Duration::from_millis(ms),
                MotionMode::Animated,
                DARK_TC,
            );
            assert_eq!(text_of(&spans), "thinking", "t={ms}ms");
        }
    }

    /// The crest is brightest where it stands and fades to nothing outside
    /// the band, so characters away from it keep the caller's style exactly.
    #[test]
    fn the_crest_peaks_under_its_head_and_rests_elsewhere() {
        // Mid-sweep for a 8-char text: period 20, head at phase * 20 - 6.
        let t = Duration::from_millis(1000); // head = 10 - 6 = 4
        assert!((crest(4, 8, t) - 1.0).abs() < 1e-6);
        assert!(crest(3, 8, t) < 1.0 && crest(3, 8, t) > 0.0);
        assert_eq!(crest(0, 8, t), 0.0, "past the band");
        // At t=0 the head sits in the left run-up, off the text.
        assert!((0..8).all(|i| crest(i, 8, Duration::ZERO) == 0.0));

        let style = Style::new().cyan();
        let spans = shimmer("abcdefgh", style, Tint::Cyan, t, MotionMode::Animated, DARK_TC);
        let styles = per_char_styles(&spans);
        assert_eq!(styles[0], style, "outside the crest");
        assert_ne!(styles[4], style, "under the crest");
        assert!(matches!(styles[4].fg, Some(Color::Rgb(..))), "{:?}", styles[4]);
    }

    /// The crest lifts DIM so the brightening is visible on dimmed text.
    #[test]
    fn the_crest_lifts_dim() {
        let style = Style::new().dim().italic();
        let t = Duration::from_millis(1000);
        let spans = shimmer("abcdefgh", style, Tint::Muted, t, MotionMode::Animated, DARK_TC);
        let crest_style = per_char_styles(&spans)[4];
        assert!(!crest_style.add_modifier.contains(Modifier::DIM));
        assert!(crest_style.add_modifier.contains(Modifier::ITALIC));
    }

    #[test]
    fn reduced_motion_renders_the_static_style() {
        let style = Style::new().yellow().bold();
        for ms in [0, 500, 1000, 1500] {
            let spans = shimmer(
                "thinking",
                style,
                Tint::Yellow,
                Duration::from_millis(ms),
                MotionMode::Reduced,
                DARK_TC,
            );
            assert_eq!(spans, vec![Span::styled("thinking", style)]);
        }
    }

    #[test]
    fn a_16_colour_terminal_renders_the_static_style() {
        let theme = Theme { light: false, depth: ColorDepth::Ansi16 };
        let style = Style::new().cyan();
        let spans = shimmer(
            "working",
            style,
            Tint::Cyan,
            Duration::from_millis(1000),
            MotionMode::Animated,
            theme,
        );
        assert_eq!(spans, vec![Span::styled("working", style)]);
    }

    /// 256 colours still sweep, with every crest colour fitted to the palette.
    #[test]
    fn a_256_colour_sweep_emits_no_rgb() {
        let theme = Theme { light: true, depth: ColorDepth::Ansi256 };
        let spans = shimmer(
            "abcdefgh",
            Style::new(),
            Tint::Accent,
            Duration::from_millis(1000),
            MotionMode::Animated,
            theme,
        );
        assert!(spans.len() > 1, "still animates");
        assert!(spans.iter().all(|s| !matches!(s.style.fg, Some(Color::Rgb(..)))));
    }

    /// A wrapped label sweeps as one text: only spans in the target style
    /// change, and the rows keep their text.
    #[test]
    fn a_wrapped_label_sweeps_as_one_text() {
        let label = Style::new().cyan().dim();
        let gutter = Style::new().dark_gray();
        let lines = vec![
            Line::from(vec![Span::styled("| ", gutter), Span::styled("abcd", label)]),
            Line::from(vec![Span::styled("| ", gutter), Span::styled("efgh", label)]),
        ];
        let t = Duration::from_millis(1000); // head at char 4: the second row
        let out = shimmer_styled(lines.clone(), label, Tint::Cyan, t, MotionMode::Animated, DARK_TC);
        for (a, b) in lines.iter().zip(&out) {
            assert_eq!(text_of(&a.spans), text_of(&b.spans));
            assert_eq!(b.spans[0].style, gutter, "gutter untouched");
        }
        assert_ne!(per_char_styles(&out[1].spans[1..])[0], label, "crest on row two");

        let still = shimmer_styled(lines.clone(), label, Tint::Cyan, t, MotionMode::Reduced, DARK_TC);
        assert_eq!(still, lines);
    }

    #[test]
    fn frame_time_follows_the_throbber_cadence() {
        assert_eq!(frame_time(0), Duration::ZERO);
        assert_eq!(frame_time(10), Duration::from_millis(10 * super::super::SPINNER_ADVANCE_MS));
    }
}
