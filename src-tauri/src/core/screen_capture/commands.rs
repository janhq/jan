use base64::Engine;
use image::ImageFormat;
use tauri::{AppHandle, Emitter};
use xcap::{Monitor, Window};

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
    if let Some(m) = monitors.iter().find(|m| m.is_primary()).cloned() {
        return Ok(m);
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
    let mx = monitor.x() as i64;
    let my = monitor.y() as i64;
    let mw = monitor.width() as i64;
    let mh = monitor.height() as i64;

    let gx0 = x as i64;
    let gy0 = y as i64;
    let gx1 = gx0 + width as i64;
    let gy1 = gy0 + height as i64;

    let mx1 = mx + mw;
    let my1 = my + mh;

    let ix0 = gx0.max(mx);
    let iy0 = gy0.max(my);
    let ix1 = gx1.min(mx1);
    let iy1 = gy1.min(my1);

    if ix1 <= ix0 || iy1 <= iy0 {
        return Err("Region does not intersect the captured monitor".to_string());
    }

    let rx = (ix0 - mx) as u32;
    let ry = (iy0 - my) as u32;
    let rw = (ix1 - ix0) as u32;
    let rh = (iy1 - iy0) as u32;

    let full = monitor.capture_image().map_err(|e| e.to_string())?;
    let sub = image::imageops::crop_imm(&full, rx, ry, rw, rh);
    let cropped = sub.to_image();
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
        if w.is_minimized() {
            continue;
        }
        if w.width() == 0 || w.height() == 0 {
            continue;
        }
        let title = w.title().to_string();
        if title.contains("Screen capture toolbar") || title.contains("Select screen region") {
            continue;
        }
        out.push(ScreenCaptureWindowItem {
            id: w.id(),
            app_name: w.app_name().to_string(),
            title,
            x: w.x(),
            y: w.y(),
            width: w.width(),
            height: w.height(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn capture_window_png_base64(window_id: u32) -> Result<String, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;
    let w = windows
        .iter()
        .find(|w| w.id() == window_id)
        .ok_or_else(|| format!("Window {window_id} not found"))?;
    let rgba = w.capture_image().map_err(|e| e.to_string())?;
    rgba_to_png_base64(rgba)
}

/// Delivers a PNG (base64) to the main window via a frontend event (`jan-screen-capture-png`).
#[tauri::command]
pub fn publish_screen_capture_png(app: AppHandle, png_base64: String) -> Result<(), String> {
    app.emit(
        "jan-screen-capture-png",
        serde_json::json!({ "base64": png_base64 }),
    )
    .map_err(|e| e.to_string())
}
