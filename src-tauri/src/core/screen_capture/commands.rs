use base64::Engine;
use image::ImageFormat;
use std::str::FromStr;
use tauri::{AppHandle, Emitter};
use xcap::{Monitor, Window};

/// Validates a Tauri/global-shortcut accelerator string (same family as `tauri-plugin-global-shortcut`).
#[tauri::command]
pub fn validate_global_shortcut(accelerator: String) -> Result<(), String> {
    let t = accelerator.trim();
    if t.is_empty() {
        return Err("Shortcut cannot be empty".to_string());
    }
    global_hotkey::hotkey::HotKey::from_str(t).map(drop).map_err(|e| e.to_string())
}

fn rgba_to_png_base64(rgba: image::RgbaImage) -> Result<String, String> {
    let dyn_img = image::DynamicImage::ImageRgba8(rgba);
    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    dyn_img
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png_bytes))
}

fn primary_or_first_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    for m in &monitors {
        if m.is_primary().map_err(|e| e.to_string())? {
            return Ok(m.clone());
        }
    }
    monitors
        .first()
        .cloned()
        .ok_or_else(|| "No display found".to_string())
}

fn monitor_for_global_rect(x: i32, y: i32, w: u32, h: u32) -> Result<Monitor, String> {
    let cx = x + (w as i32).max(1) / 2;
    let cy = y + (h as i32).max(1) / 2;
    match Monitor::from_point(cx, cy) {
        Ok(m) => Ok(m),
        Err(_) => primary_or_first_monitor(),
    }
}

/// Intersects a global axis-aligned rectangle with a monitor rectangle (both in global / physical space).
/// Returns `(rx, ry, rw, rh)` suitable for [`Monitor::capture_region`].
pub(crate) fn intersect_global_rect_with_monitor_bounds(
    gx0: i64,
    gy0: i64,
    gx1: i64,
    gy1: i64,
    mx: i64,
    my: i64,
    mw: i64,
    mh: i64,
) -> Result<(u32, u32, u32, u32), &'static str> {
    let mx1 = mx + mw;
    let my1 = my + mh;
    let ix0 = gx0.max(mx);
    let iy0 = gy0.max(my);
    let ix1 = gx1.min(mx1);
    let iy1 = gy1.min(my1);
    if ix1 <= ix0 || iy1 <= iy0 {
        return Err("Region does not intersect the captured monitor");
    }
    let rx = (ix0 - mx) as u32;
    let ry = (iy0 - my) as u32;
    let rw = (ix1 - ix0) as u32;
    let rh = (iy1 - iy0) as u32;
    Ok((rx, ry, rw, rh))
}

pub(crate) fn screen_capture_png_event_payload(
    png_base64: &str,
    instruction: Option<&str>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({ "base64": png_base64 });
    if let Some(s) = instruction {
        let t = s.trim();
        if !t.is_empty() {
            payload["instruction"] = serde_json::Value::String(t.to_string());
        }
    }
    payload
}

/// Captures the primary display (or first available monitor) as a PNG and returns base64-encoded bytes.
#[tauri::command]
pub fn capture_primary_display_png_base64() -> Result<String, String> {
    let monitor = primary_or_first_monitor()?;
    let rgba = monitor.capture_image().map_err(|e| e.to_string())?;
    rgba_to_png_base64(rgba)
}

/// Crops a rectangle in global screen coordinates from the monitor that contains the region center.
#[tauri::command]
pub fn capture_screen_rect_png_base64(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("Region size must be positive".to_string());
    }

    let monitor = monitor_for_global_rect(x, y, width, height)?;
    let mx = monitor.x().map_err(|e| e.to_string())? as i64;
    let my = monitor.y().map_err(|e| e.to_string())? as i64;
    let mw = monitor.width().map_err(|e| e.to_string())? as i64;
    let mh = monitor.height().map_err(|e| e.to_string())? as i64;

    let gx0 = x as i64;
    let gy0 = y as i64;
    let gx1 = gx0 + width as i64;
    let gy1 = gy0 + height as i64;

    let (rx, ry, rw, rh) = intersect_global_rect_with_monitor_bounds(gx0, gy0, gx1, gy1, mx, my, mw, mh)
        .map_err(|e| e.to_string())?;

    let cropped = monitor
        .capture_region(rx, ry, rw, rh)
        .map_err(|e| e.to_string())?;
    rgba_to_png_base64(cropped)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureWindowItem {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn list_screen_capture_windows() -> Result<Vec<ScreenCaptureWindowItem>, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for w in windows {
        if w.is_minimized().map_err(|e| e.to_string())? {
            continue;
        }
        let width = w.width().map_err(|e| e.to_string())?;
        let height = w.height().map_err(|e| e.to_string())?;
        if width == 0 || height == 0 {
            continue;
        }
        let title = w.title().map_err(|e| e.to_string())?;
        if title.contains("Quick capture")
            || title.contains("Screen capture toolbar")
            || title.contains("Select screen region")
        {
            continue;
        }
        out.push(ScreenCaptureWindowItem {
            id: w.id().map_err(|e| e.to_string())?,
            app_name: w.app_name().map_err(|e| e.to_string())?,
            title,
            x: w.x().map_err(|e| e.to_string())?,
            y: w.y().map_err(|e| e.to_string())?,
            width,
            height,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn capture_window_png_base64(window_id: u32) -> Result<String, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;
    let w = windows
        .iter()
        .find(|w| w.id().map(|id| id == window_id).unwrap_or(false))
        .ok_or_else(|| format!("Window {window_id} not found"))?;
    let rgba = w.capture_image().map_err(|e| e.to_string())?;
    rgba_to_png_base64(rgba)
}

/// Delivers a PNG (base64) to the main window via a frontend event (`jan-screen-capture-png`).
/// Optional `instruction` is merged into the OCR draft (quick-ask style note from the floating toolbar).
#[tauri::command]
pub fn publish_screen_capture_png(
    app: AppHandle,
    png_base64: String,
    instruction: Option<String>,
) -> Result<(), String> {
    let payload = screen_capture_png_event_payload(&png_base64, instruction.as_deref());
    app.emit("jan-screen-capture-png", payload)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_tauri_style_default_shortcut() {
        validate_global_shortcut("CommandOrControl+Shift+KeyS".to_string()).unwrap();
    }

    #[test]
    fn validate_rejects_empty() {
        assert!(validate_global_shortcut("".to_string()).is_err());
        assert!(validate_global_shortcut("   ".to_string()).is_err());
    }

    #[test]
    fn validate_rejects_garbage() {
        assert!(validate_global_shortcut("not-a-real-shortcut!!!".to_string()).is_err());
    }

    #[test]
    fn intersect_full_region_inside_monitor() {
        // Monitor 0,0 1920x1080; global rect fully inside
        let r = intersect_global_rect_with_monitor_bounds(100, 200, 500, 400, 0, 0, 1920, 1080);
        assert_eq!(r, Ok((100, 200, 400, 200)));
    }

    #[test]
    fn intersect_clips_to_monitor_edges() {
        // Monitor at (0,0) 1920x1080; global rect spills past right/bottom
        let r = intersect_global_rect_with_monitor_bounds(1800, 1000, 2500, 1200, 0, 0, 1920, 1080);
        assert_eq!(r, Ok((1800, 1000, 120, 80)));
    }

    #[test]
    fn intersect_negative_origin_monitor() {
        // Left monitor: x=-1920, same height; rect crossing into it
        let r = intersect_global_rect_with_monitor_bounds(-500, 0, 0, 1080, -1920, 0, 1920, 1080);
        assert_eq!(r, Ok((1420, 0, 500, 1080)));
    }

    #[test]
    fn intersect_no_overlap_errors() {
        assert!(intersect_global_rect_with_monitor_bounds(0, 0, 10, 10, 100, 100, 50, 50).is_err());
    }

    #[test]
    fn intersect_touching_edge_is_empty_error() {
        // [0,10) and [10,20) touch at 10 — zero area
        assert!(intersect_global_rect_with_monitor_bounds(0, 0, 10, 10, 10, 0, 10, 10).is_err());
    }

    #[test]
    fn screen_capture_payload_base64_only() {
        let v = screen_capture_png_event_payload("Zm9v", None);
        assert_eq!(v["base64"], "Zm9v");
        assert!(v.get("instruction").is_none());
    }

    #[test]
    fn screen_capture_payload_skips_blank_instruction() {
        let v = screen_capture_png_event_payload("YmFy", Some("   "));
        assert_eq!(v["base64"], "YmFy");
        assert!(v.get("instruction").is_none());
    }

    #[test]
    fn screen_capture_payload_includes_trimmed_instruction() {
        let v = screen_capture_png_event_payload("eA==", Some("  hello  "));
        assert_eq!(v["instruction"], "hello");
    }
}
