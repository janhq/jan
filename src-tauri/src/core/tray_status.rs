//! Live status rows for the macOS menu-bar tray: server / URL row, current model,
//! RAM caption and a segmented memory bar.
//!
//! The menu rows themselves are created in [`crate::core::setup::setup_tray`]; handles
//! to the mutable rows are stashed in [`crate::core::state::AppState::tray_handles`] so
//! the `update_tray_status` command can re-render text + leading icons each tick.
//!
//! Updates are driven from the frontend ([`web-app/src/hooks/useTrayStatusSync.ts`]) on
//! a 5 s cadence so all state (server status, active models, hardware usage) can stay in
//! a single place without introducing a new Rust polling loop.

#[cfg(desktop)]
use std::sync::Mutex;

#[cfg(desktop)]
use tauri::{
    image::Image,
    menu::{IconMenuItem, MenuItem},
    AppHandle, Manager, Wry,
};

/// Handles to the live rows in the tray menu. Stored in `AppState`.
///
/// The Pico-style layout splits the server block into a status row
/// (`Server Running` / `Server Stopped`) and a separate, copy-icon-prefixed URL
/// row. The RAM block likewise lives across two rows: a text caption + a
/// segmented bar so the bar — not the longest text — drives the menu width.
#[cfg(desktop)]
pub struct TrayHandles {
    pub server: IconMenuItem<Wry>,
    pub server_url_row: IconMenuItem<Wry>,
    pub model: MenuItem<Wry>,
    pub ram_text: MenuItem<Wry>,
    pub ram_bar: IconMenuItem<Wry>,
    /// Last known server URL (kept so the URL row click works even when the
    /// server is currently stopped, and remains the source of truth instead of
    /// re-parsing the row's display text).
    pub server_url: Mutex<String>,
}

#[cfg(desktop)]
#[derive(Debug, serde::Deserialize)]
pub struct TrayStatusPayload {
    pub server_running: bool,
    pub server_url: String,
    pub model_label: String,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub ram_percent: u8,
}

// ---------- Icon rendering helpers ----------------------------------------------------

/// Pixel oversampling factor used when rasterising icons. We render every
/// glyph at `SCALE`× its logical menu size and emit the result as a PNG
/// carrying a `pHYs` chunk that declares 144 DPI (= @2x). NSImage decodes the
/// metadata via `initWithData:` and treats the bitmap as a Retina asset,
/// so soft-edged shapes (the server dot, the doc-on-doc copy glyph) stay crisp
/// instead of being upscaled 1:2 by the OS the way a raw 1× RGBA buffer is.
#[cfg(desktop)]
const SCALE: u32 = 2;
/// Logical point size of the server-status / copy-icon glyphs.
#[cfg(desktop)]
const DOT_SIZE_PT: u32 = 16;
#[cfg(desktop)]
const COPY_ICON_SIZE_PT: u32 = 16;
/// Logical width of the stand-alone RAM bar row. Picked so the bar — not the
/// longest piece of text — caps the menu width, mirroring Pico AI Server's
/// compact panel.
#[cfg(desktop)]
const BAR_WIDTH_PT: u32 = 240;
#[cfg(desktop)]
const BAR_HEIGHT_PT: u32 = 12;
/// Number of segments in the Pico-style memory bar. 24 segments at 240 pt give
/// ~8 pt wide pills with 2 pt gaps — chunky enough to read at a glance, dense
/// enough to feel like a continuous gauge.
#[cfg(desktop)]
const SEGMENTS: u32 = 24;
#[cfg(desktop)]
const SEGMENT_GAP_PT: u32 = 2;
#[cfg(desktop)]
const SEGMENT_RADIUS_PT: f32 = 1.5;

/// Maximum length, in characters, allowed for the URL and model rows before
/// the value is truncated with an ellipsis. Sized so the resulting text does
/// not exceed the bar width and keep menu width stable.
#[cfg(desktop)]
const ROW_MAX_CHARS: usize = 32;

#[cfg(desktop)]
#[inline]
fn put_pixel(buf: &mut [u8], x: u32, y: u32, width: u32, r: u8, g: u8, b: u8, a: u8) {
    let idx = ((y * width + x) * 4) as usize;
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = a;
}

/// Premultiplied straight-alpha source-over compositing. Used by the copy icon
/// so the back rectangle visibly "peeks out" from behind the front one without
/// fully obscuring it.
#[cfg(desktop)]
#[inline]
fn blend_pixel(buf: &mut [u8], x: u32, y: u32, width: u32, r: u8, g: u8, b: u8, a: u8) {
    if a == 0 {
        return;
    }
    let idx = ((y * width + x) * 4) as usize;
    let dst_a = buf[idx + 3] as f32 / 255.0;
    let src_a = a as f32 / 255.0;
    let out_a = src_a + dst_a * (1.0 - src_a);
    if out_a <= 0.0 {
        return;
    }
    let blend = |dst: u8, src: u8| -> u8 {
        let s = src as f32 / 255.0;
        let d = dst as f32 / 255.0;
        let v = (s * src_a + d * dst_a * (1.0 - src_a)) / out_a;
        (v.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    buf[idx] = blend(buf[idx], r);
    buf[idx + 1] = blend(buf[idx + 1], g);
    buf[idx + 2] = blend(buf[idx + 2], b);
    buf[idx + 3] = (out_a.clamp(0.0, 1.0) * 255.0).round() as u8;
}

/// Encode a raw RGBA buffer as a PNG carrying a `pHYs` chunk that advertises
/// `scale * 72 DPI`, then return a Tauri `Image` decoded from those bytes.
///
/// macOS' `NSImage initWithData:` honours the `pHYs` metadata and sets the
/// image's logical `size` to `pixels / scale`, so a 32×32 bitmap encoded with
/// `scale = 2` displays at 16 pt — but uses all 32 source pixels on Retina,
/// producing crisp edges instead of the 1:2 bilinear upscale you get from a
/// raw 16×16 RGBA buffer through `Image::new_owned`.
#[cfg(desktop)]
fn encode_hidpi_png(rgba: Vec<u8>, width: u32, height: u32, scale: u32) -> Image<'static> {
    // 1 inch = 0.0254 m → 72 dpi ≈ 2835 ppm. Round to the nearest integer for
    // each scale so the pHYs values match the canonical Apple @Nx encoding.
    let ppm: u32 = match scale {
        1 => 2835,
        2 => 5669,
        3 => 8504,
        n => 2835 * n,
    };

    let mut png_bytes: Vec<u8> = Vec::with_capacity(rgba.len() / 4 + 256);
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .expect("tray icon: PNG header write must succeed for fixed-size buffers");

        // pHYs payload: 4-byte ppmX, 4-byte ppmY (BE u32), 1-byte unit (1 = meter).
        let mut phys = [0u8; 9];
        phys[..4].copy_from_slice(&ppm.to_be_bytes());
        phys[4..8].copy_from_slice(&ppm.to_be_bytes());
        phys[8] = 1;
        writer
            .write_chunk(png::chunk::pHYs, &phys)
            .expect("tray icon: pHYs chunk write must succeed");

        writer
            .write_image_data(&rgba)
            .expect("tray icon: IDAT write must succeed");
    }

    Image::from_bytes(&png_bytes)
        .expect("tray icon: re-decoding our own PNG must succeed")
        .to_owned()
}

/// Filled circle for the server-status row. Green when `running`, neutral gray
/// otherwise. Rendered at `DOT_SIZE_PT * SCALE` and emitted as a @2x PNG so
/// the AA edge stays sharp on Retina menus.
#[cfg(desktop)]
pub fn render_dot(running: bool) -> Image<'static> {
    let (r, g, b) = if running {
        (0x22, 0xc5, 0x5e) // emerald-500
    } else {
        (0x6b, 0x72, 0x80) // slate-500
    };

    let size = DOT_SIZE_PT * SCALE;
    let mut buf = vec![0u8; (size * size * 4) as usize];
    let center = (size as f32 - 1.0) / 2.0;
    // Inset by SCALE so the AA band at the edge is `SCALE` source pixels wide,
    // i.e. exactly one logical-point of softness at any oversampling factor.
    let aa_band = SCALE as f32;
    let radius = size as f32 / 2.0 - aa_band / 2.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let alpha = if dist <= radius - aa_band {
                255.0
            } else if dist <= radius {
                (1.0 - (dist - (radius - aa_band)) / aa_band) * 255.0
            } else {
                0.0
            };
            if alpha > 0.0 {
                put_pixel(&mut buf, x, y, size, r, g, b, alpha.round() as u8);
            }
        }
    }

    encode_hidpi_png(buf, size, size, SCALE)
}

/// AA-rounded-rect fill into `buf`. `(x, y, w, h)` is the rectangle origin and
/// size in pixels; `radius` is the corner radius. Uses straight-alpha blending
/// so the helper composes cleanly with other shapes already drawn into `buf`.
#[cfg(desktop)]
fn draw_rounded_rect(
    buf: &mut [u8],
    canvas_w: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    radius: f32,
    color: (u8, u8, u8),
    alpha: u8,
) {
    let r = radius.max(0.0);
    for dy in 0..h {
        for dx in 0..w {
            let fx = dx as f32;
            let fy = dy as f32;
            let cx = fx.max(r).min(w as f32 - 1.0 - r);
            let cy = fy.max(r).min(h as f32 - 1.0 - r);
            let ddx = fx - cx;
            let ddy = fy - cy;
            let dist = (ddx * ddx + ddy * ddy).sqrt();
            let mask = if dist <= r - 1.0 {
                1.0
            } else if dist <= r {
                1.0 - (dist - (r - 1.0))
            } else {
                0.0
            };
            if mask <= 0.0 {
                continue;
            }
            let a = (alpha as f32 * mask).round() as u8;
            blend_pixel(buf, x + dx, y + dy, canvas_w, color.0, color.1, color.2, a);
        }
    }
}

/// `doc.on.doc`-style copy glyph: a back rectangle peeking out behind a front
/// rectangle. Rendered at `COPY_ICON_SIZE_PT * SCALE` pixels and emitted as an
/// @2x PNG so the rounded corners don't smear when the OS rasterises onto a
/// Retina menu.
#[cfg(desktop)]
pub fn render_copy_icon() -> Image<'static> {
    let size = COPY_ICON_SIZE_PT * SCALE;
    let mut buf = vec![0u8; (size * size * 4) as usize];
    let color = (0x9c, 0xa3, 0xaf); // slate-400, reads as muted in both light/dark menus

    // All offsets are quoted in logical points and multiplied by SCALE so the
    // glyph keeps the same visual size regardless of the oversampling factor.
    let s = SCALE as f32;
    let radius = 1.5 * s;

    // Back document — slightly transparent so it visibly sits "behind".
    draw_rounded_rect(
        &mut buf,
        size,
        5 * SCALE,
        1 * SCALE,
        8 * SCALE,
        10 * SCALE,
        radius,
        color,
        170,
    );
    // Front document — fully opaque, overpaints the bottom-left of the back.
    draw_rounded_rect(
        &mut buf,
        size,
        2 * SCALE,
        4 * SCALE,
        8 * SCALE,
        10 * SCALE,
        radius,
        color,
        235,
    );

    encode_hidpi_png(buf, size, size, SCALE)
}

/// Pico-style segmented memory gauge: ~24 short pills where the filled prefix
/// uses a horizontal blue→pink gradient and the remaining pills are dimmed
/// gray rails. Logical size is `BAR_WIDTH_PT × BAR_HEIGHT_PT` (240×12 pt) but
/// rasterised at `SCALE`× and emitted as an @2x PNG so the pill corners stay
/// crisp on Retina menus.
#[cfg(desktop)]
pub fn render_segmented_bar(percent: u8) -> Image<'static> {
    let pct = (percent.min(100)) as f32 / 100.0;
    let canvas_w = BAR_WIDTH_PT * SCALE;
    let canvas_h = BAR_HEIGHT_PT * SCALE;
    let segment_gap = SEGMENT_GAP_PT * SCALE;
    let segment_radius = SEGMENT_RADIUS_PT * SCALE as f32;
    let mut buf = vec![0u8; (canvas_w * canvas_h * 4) as usize];

    let total_gaps = segment_gap * (SEGMENTS - 1);
    let seg_w = (canvas_w - total_gaps) / SEGMENTS;
    // Center any leftover pixel slack so the bar is symmetric inside the menu row.
    let used_w = seg_w * SEGMENTS + total_gaps;
    let left_pad = (canvas_w - used_w) / 2;

    // Round-up so partial percentages always show at least one lit segment;
    // a fully-loaded machine should still leave the rightmost pill dimmed
    // unless RAM is genuinely at 100 %.
    let lit = if pct <= 0.0 {
        0
    } else {
        ((SEGMENTS as f32) * pct).ceil() as u32
    }
    .min(SEGMENTS);

    let start = (0x3b, 0x82, 0xf6); // blue-500
    let end = (0xec, 0x48, 0x99); // pink-500
    let rail = (0x4b, 0x55, 0x63); // slate-600 (subtle)

    for s in 0..SEGMENTS {
        let x = left_pad + s * (seg_w + segment_gap);
        let filled = s < lit;

        if filled {
            // Gradient color is keyed off the segment's centre so each pill has a
            // single, even tint rather than its own mini-gradient.
            let t = if SEGMENTS > 1 {
                s as f32 / (SEGMENTS - 1) as f32
            } else {
                0.0
            };
            let r = (start.0 as f32 + (end.0 as f32 - start.0 as f32) * t) as u8;
            let g = (start.1 as f32 + (end.1 as f32 - start.1 as f32) * t) as u8;
            let b = (start.2 as f32 + (end.2 as f32 - start.2 as f32) * t) as u8;
            draw_rounded_rect(
                &mut buf,
                canvas_w,
                x,
                0,
                seg_w,
                canvas_h,
                segment_radius,
                (r, g, b),
                255,
            );
        } else {
            // Empty pill: low-alpha rail so the row reads as a gauge background
            // instead of disappearing entirely on dark menus.
            draw_rounded_rect(
                &mut buf,
                canvas_w,
                x,
                0,
                seg_w,
                canvas_h,
                segment_radius,
                rail,
                90,
            );
        }
    }

    encode_hidpi_png(buf, canvas_w, canvas_h, SCALE)
}

/// Truncate a string to at most `max_chars` graphemes, appending an ellipsis
/// when truncated. Counts Unicode chars (not bytes) so multi-byte names don't
/// produce broken glyphs at the boundary.
#[cfg(desktop)]
fn truncate_tail(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_chars {
        return s.to_string();
    }
    let kept: String = chars[..max_chars.saturating_sub(1)].iter().collect();
    format!("{kept}…")
}

// ---------- Command -------------------------------------------------------------------

#[cfg(desktop)]
#[tauri::command]
pub async fn update_tray_status(app: AppHandle, payload: TrayStatusPayload) -> Result<(), String> {
    let state = app.state::<crate::core::state::AppState>();
    let guard = state.tray_handles.lock().map_err(|e| e.to_string())?;
    let Some(handles) = guard.as_ref() else {
        // Tray not installed (non-macOS without ENABLE_SYSTEM_TRAY_ICON, or setup failed).
        return Ok(());
    };

    // Status row: just "Server Running" / "Server Stopped" — the URL moves to
    // its own row below for the Pico-style stacked layout.
    let server_text = if payload.server_running {
        "Server Running".to_string()
    } else {
        "Server Stopped".to_string()
    };
    handles
        .server
        .set_text(&server_text)
        .map_err(|e| e.to_string())?;
    handles
        .server
        .set_icon(Some(render_dot(payload.server_running)))
        .map_err(|e| e.to_string())?;

    // URL row. Always show — when stopped, gray it out and substitute a dash so
    // the menu height stays stable across server transitions.
    if payload.server_running && !payload.server_url.is_empty() {
        handles
            .server_url_row
            .set_text(&truncate_tail(&payload.server_url, ROW_MAX_CHARS))
            .map_err(|e| e.to_string())?;
        handles
            .server_url_row
            .set_enabled(true)
            .map_err(|e| e.to_string())?;
    } else {
        handles
            .server_url_row
            .set_text("—")
            .map_err(|e| e.to_string())?;
        handles
            .server_url_row
            .set_enabled(false)
            .map_err(|e| e.to_string())?;
    }

    // Stash latest non-empty URL so the click handler can copy it even after
    // the row text was truncated for display.
    if !payload.server_url.is_empty() {
        if let Ok(mut u) = handles.server_url.lock() {
            *u = payload.server_url.clone();
        }
    }

    // Model row text (no icon). Truncated identically to the URL so the menu
    // width is bounded by `BAR_WIDTH` regardless of model id length.
    let model_text = if payload.model_label.trim().is_empty() {
        "Model  — no model loaded —".to_string()
    } else {
        format!(
            "Model  {}",
            truncate_tail(&payload.model_label, ROW_MAX_CHARS)
        )
    };
    handles
        .model
        .set_text(&model_text)
        .map_err(|e| e.to_string())?;

    // RAM caption above the bar — kept verbose ("X.X / Y.Y GB · NN%") since the
    // segmented bar alone does not communicate absolute capacity.
    let used_gb = payload.ram_used_mb as f64 / 1024.0;
    let total_gb = payload.ram_total_mb as f64 / 1024.0;
    let ram_text = format!(
        "RAM  {:.1} / {:.1} GB  ·  {}%",
        used_gb, total_gb, payload.ram_percent
    );
    handles
        .ram_text
        .set_text(&ram_text)
        .map_err(|e| e.to_string())?;
    handles
        .ram_bar
        .set_icon(Some(render_segmented_bar(payload.ram_percent)))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// No-op on mobile — the frontend hook is gated to Tauri desktop but we keep the
/// symbol registered so `generate_handler!` lists stay aligned.
#[cfg(not(desktop))]
#[tauri::command]
pub async fn update_tray_status(_payload: serde_json::Value) -> Result<(), String> {
    Ok(())
}

// ---------- Clipboard helper used by the URL row -------------------------------------

/// Write the given text to the system clipboard.
///
/// On macOS this shells out to `pbcopy` to avoid pulling in
/// `tauri-plugin-clipboard-manager` purely for this one feature. On other
/// desktops the tray is env-gated and currently opt-in, so this path stays
/// a best-effort fallback there.
#[cfg(desktop)]
pub fn write_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn pbcopy: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("write pbcopy stdin: {e}"))?;
        }
        child.wait().map_err(|e| format!("wait pbcopy: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};
        // Try xclip first, fall back to xsel.
        let try_cmd = |program: &str, args: &[&str]| -> Result<(), String> {
            let mut child = Command::new(program)
                .args(args)
                .stdin(Stdio::piped())
                .spawn()
                .map_err(|e| format!("spawn {program}: {e}"))?;
            if let Some(stdin) = child.stdin.as_mut() {
                stdin
                    .write_all(text.as_bytes())
                    .map_err(|e| format!("write {program} stdin: {e}"))?;
            }
            child.wait().map_err(|e| format!("wait {program}: {e}"))?;
            Ok(())
        };
        try_cmd("xclip", &["-selection", "clipboard"])
            .or_else(|_| try_cmd("xsel", &["--clipboard", "--input"]))
    }

    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("cmd")
            .args(["/C", "clip"])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn clip: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("write clip stdin: {e}"))?;
        }
        child.wait().map_err(|e| format!("wait clip: {e}"))?;
        Ok(())
    }
}
