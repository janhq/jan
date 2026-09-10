//! Webview-backed `screenshot` renderer for the desktop.
//!
//! Renders a local HTML/SVG file to PNG using the app's own platform webview, so
//! `screenshot` works without a Chrome/Chromium binary. The window-build,
//! page-load, settle and destroy orchestration is cross-platform; only the
//! snapshot itself is per-OS (`take_snapshot`):
//!
//! - Linux: `webkit2gtk` `WebView::snapshot` (`FullDocument`) -> cairo surface -> PNG.
//! - macOS: `WKWebView takeSnapshotWithConfiguration:` -> `NSImage` -> PNG (viewport).
//! - Windows: WebView2 `ICoreWebView2::CapturePreview` -> PNG bytes (viewport).
//!
//! Everything that touches a GUI stack lives here, behind `feature = "tauri"` and
//! the desktop targets, so the Tauri-free core and the headless CLI never pull it
//! into their graph. The Chrome path stays the fallback everywhere.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{Runtime, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::tools::ScreenshotBackend;

const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(30);
/// Settle window for async assets (fonts, images) after `load` fires.
const SETTLE: Duration = Duration::from_millis(150);

/// One-shot delivery slot for the completed snapshot, shared with whatever
/// platform callback produces the PNG bytes.
type SnapshotSlot = Arc<Mutex<Option<oneshot::Sender<Result<Vec<u8>, String>>>>>;

fn deliver(slot: &SnapshotSlot, value: Result<Vec<u8>, String>) {
    if let Ok(mut guard) = slot.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(value);
        }
    }
}

/// Build a [`ScreenshotBackend`] that captures through the app's webview.
pub fn make_backend<R: Runtime>(app: &tauri::AppHandle<R>) -> ScreenshotBackend {
    let app = app.clone();
    Arc::new(move |target, width, height, scale| {
        let app = app.clone();
        Box::pin(capture(app, target, width, height, scale))
    })
}

async fn capture<R: Runtime>(
    app: tauri::AppHandle<R>,
    target: PathBuf,
    width: u64,
    height: u64,
    // The platform snapshots at the display's own backing scale; there is no
    // viewport DPR knob to honor here, so `scale` is accepted for signature
    // parity and left unapplied. The tool only ever passes 1.0.
    _scale: f64,
) -> Result<Vec<u8>, String> {
    let url = tauri::Url::from_file_path(&target)
        .map_err(|_| format!("cannot build file URL for {}", target.display()))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let label = format!("jan-shot-{}-{nanos}", std::process::id());

    let (load_tx, load_rx) = oneshot::channel::<()>();
    let load_signal = Arc::new(Mutex::new(Some(load_tx)));
    let (win_tx, win_rx) = oneshot::channel::<Result<tauri::WebviewWindow<R>, String>>();

    // Window creation and page-load registration happen on the main thread (the
    // GUI toolkit owns the widget). The window is built visible but far
    // off-screen: a webview that is never mapped can snapshot blank, so it must
    // be realized, and off-screen keeps it from flashing on the user's display.
    let build_app = app.clone();
    let build = move || {
        let signal = load_signal.clone();
        let res = WebviewWindowBuilder::new(&build_app, &label, WebviewUrl::External(url))
            .title("")
            .inner_size(width as f64, height as f64)
            .position(-10000.0, -10000.0)
            .decorations(false)
            .skip_taskbar(true)
            .visible(true)
            .on_page_load(move |_window, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    if let Ok(mut guard) = signal.lock() {
                        if let Some(tx) = guard.take() {
                            let _ = tx.send(());
                        }
                    }
                }
            })
            .build()
            .map_err(|e| format!("failed to create capture window: {e}"));
        let _ = win_tx.send(res);
    };
    app.run_on_main_thread(build)
        .map_err(|e| format!("failed to schedule capture window: {e}"))?;

    let window = win_rx
        .await
        .map_err(|_| "capture window builder dropped".to_string())??;

    let result = capture_loaded(&window, load_rx, width, height).await;
    let _ = window.destroy();
    result
}

async fn capture_loaded<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    load_rx: oneshot::Receiver<()>,
    width: u64,
    height: u64,
) -> Result<Vec<u8>, String> {
    match tokio::time::timeout(LOAD_TIMEOUT, load_rx).await {
        Ok(Ok(())) => {}
        Ok(Err(_)) => return Err("capture window closed before load".to_string()),
        Err(_) => return Err("webview screenshot timed out waiting for page load".to_string()),
    }
    tokio::time::sleep(SETTLE).await;

    let (png_tx, png_rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let slot: SnapshotSlot = Arc::new(Mutex::new(Some(png_tx)));
    let cb_slot = slot.clone();
    window
        .with_webview(move |platform| {
            take_snapshot(&platform, width, height, cb_slot);
        })
        .map_err(|e| format!("failed to reach platform webview: {e}"))?;

    match tokio::time::timeout(SNAPSHOT_TIMEOUT, png_rx).await {
        Ok(Ok(res)) => res,
        Ok(Err(_)) => Err("webview snapshot callback dropped".to_string()),
        Err(_) => Err("webview screenshot timed out waiting for snapshot".to_string()),
    }
}

// ---------------------------------------------------------------------------
// Linux: webkit2gtk snapshot -> cairo surface -> PNG.
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn take_snapshot(
    platform: &tauri::webview::PlatformWebview,
    _width: u64,
    _height: u64,
    slot: SnapshotSlot,
) {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    let webview = platform.inner();
    webview.snapshot(
        SnapshotRegion::FullDocument,
        SnapshotOptions::NONE,
        None::<&webkit2gtk::gio::Cancellable>,
        move |result| {
            let png = result
                .map_err(|e| format!("webkit snapshot failed: {e}"))
                .and_then(surface_to_png);
            deliver(&slot, png);
        },
    );
}

/// Encode a cairo `ARgb32` surface (BGRA, premultiplied on little-endian) as a
/// straight-alpha RGBA PNG.
#[cfg(target_os = "linux")]
fn surface_to_png(surface: cairo::Surface) -> Result<Vec<u8>, String> {
    let mut image = cairo::ImageSurface::try_from(surface)
        .map_err(|_| "snapshot surface is not an image surface".to_string())?;
    if image.format() != cairo::Format::ARgb32 {
        return Err(format!("unexpected snapshot format {:?}", image.format()));
    }
    let width = image.width();
    let height = image.height();
    if width <= 0 || height <= 0 {
        return Err("snapshot has empty dimensions".to_string());
    }
    let stride = image.stride() as usize;
    let data = image
        .data()
        .map_err(|e| format!("cannot read snapshot pixels: {e}"))?;

    let w = width as usize;
    let h = height as usize;
    let mut rgba = Vec::with_capacity(w * h * 4);
    for row in 0..h {
        let start = row * stride;
        for col in 0..w {
            let px = &data[start + col * 4..start + col * 4 + 4];
            let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
            let straight = |c: u8| -> u8 {
                if a == 0 {
                    0
                } else {
                    ((c as u16 * 255 + a as u16 / 2) / a as u16) as u8
                }
            };
            rgba.extend_from_slice(&[straight(r), straight(g), straight(b), a]);
        }
    }
    drop(data);

    encode_rgba_png(&rgba, width as u32, height as u32)
}

#[cfg(target_os = "linux")]
fn encode_rgba_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG header failed: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("PNG encode failed: {e}"))?;
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// macOS: WKWebView snapshot -> NSImage -> PNG.
//
// WKWebView captures the viewport, not the full scrollable document: full-page
// capture there is unreliable, so this snapshots the window's inner size
// (`width` x `height`). That is a deliberate difference from Linux's
// `FullDocument`.
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn take_snapshot(
    platform: &tauri::webview::PlatformWebview,
    width: u64,
    height: u64,
    slot: SnapshotSlot,
) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSImage;
    use objc2_foundation::{NSError, NSPoint, NSRect, NSSize};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    let ptr: *mut WKWebView = platform.inner().cast();
    if ptr.is_null() {
        deliver(&slot, Err("null WKWebView handle".to_string()));
        return;
    }
    // The webview is owned by the window we keep alive until `destroy()`, so a
    // borrow for the duration of the (synchronous) `takeSnapshot` call is sound;
    // WebKit retains what it needs for the async completion itself.
    let webview: &WKWebView = unsafe { &*ptr };

    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => {
            deliver(&slot, Err("webview snapshot not on main thread".to_string()));
            return;
        }
    };

    let config = unsafe { WKSnapshotConfiguration::new(mtm) };
    let rect = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(width as f64, height as f64),
    );
    unsafe { config.setRect(rect) };

    let cb_slot = slot.clone();
    let handler = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        deliver(&cb_slot, nsimage_to_png(image, error));
    });

    unsafe {
        webview.takeSnapshotWithConfiguration_completionHandler(Some(&*config), &handler);
    }
}

/// Convert the `NSImage` handed to the snapshot completion handler into PNG
/// bytes, routing through a TIFF representation so no CoreGraphics dependency is
/// needed. Both pointers come straight from WebKit; exactly one is non-null.
#[cfg(target_os = "macos")]
fn nsimage_to_png(
    image: *mut objc2_app_kit::NSImage,
    error: *mut objc2_foundation::NSError,
) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey};
    use objc2_foundation::NSDictionary;

    if image.is_null() {
        let detail = if error.is_null() {
            "no image and no error".to_string()
        } else {
            unsafe { (*error).localizedDescription() }.to_string()
        };
        return Err(format!("WKWebView snapshot failed: {detail}"));
    }

    let image: &objc2_app_kit::NSImage = unsafe { &*image };
    let tiff = unsafe { image.TIFFRepresentation() }
        .ok_or_else(|| "snapshot has no TIFF representation".to_string())?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "cannot build bitmap rep from snapshot".to_string())?;
    let props: objc2::rc::Retained<NSDictionary<NSBitmapImageRepPropertyKey, AnyObject>> =
        NSDictionary::new();
    let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) }
        .ok_or_else(|| "PNG encode of snapshot failed".to_string())?;
    Ok(data.to_vec())
}

// ---------------------------------------------------------------------------
// Windows: WebView2 CapturePreview -> in-memory IStream (already PNG).
//
// CapturePreview captures the viewport at the webview's current size, so this
// matches macOS's viewport capture rather than Linux's `FullDocument`.
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn take_snapshot(
    platform: &tauri::webview::PlatformWebview,
    _width: u64,
    _height: u64,
    slot: SnapshotSlot,
) {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use webview2_com::CapturePreviewCompletedHandler;
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let controller = platform.controller();
    let setup = (|| -> Result<(), String> {
        let webview = unsafe { controller.CoreWebView2() }
            .map_err(|e| format!("cannot reach CoreWebView2: {e}"))?;
        let stream = unsafe { SHCreateMemStream(None) }
            .ok_or_else(|| "failed to allocate capture stream".to_string())?;
        let cb_stream = stream.clone();
        let cb_slot = slot.clone();
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
            let png = result
                .map_err(|e| format!("CapturePreview failed: {e}"))
                .and_then(|()| unsafe { read_stream(&cb_stream) });
            deliver(&cb_slot, png);
            Ok(())
        }));
        unsafe {
            webview.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            )
        }
        .map_err(|e| format!("CapturePreview call failed: {e}"))?;
        Ok(())
    })();
    if let Err(e) = setup {
        deliver(&slot, Err(e));
    }
}

/// Drain an in-memory `IStream` that WebView2 filled with PNG bytes.
#[cfg(target_os = "windows")]
unsafe fn read_stream(
    stream: &windows::Win32::System::Com::IStream,
) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    stream
        .Seek(0, STREAM_SEEK_SET, None)
        .map_err(|e| format!("capture stream seek failed: {e}"))?;

    let mut stat = STATSTG::default();
    stream
        .Stat(&mut stat, STATFLAG_NONAME)
        .map_err(|e| format!("capture stream stat failed: {e}"))?;
    let size = stat.cbSize as usize;
    if size == 0 {
        return Err("capture stream is empty".to_string());
    }

    let mut buf = vec![0u8; size];
    let mut total = 0usize;
    while total < size {
        let mut read = 0u32;
        let remaining = (size - total) as u32;
        let hr = stream.Read(
            buf.as_mut_ptr().add(total) as *mut core::ffi::c_void,
            remaining,
            Some(&mut read),
        );
        hr.ok()
            .map_err(|e| format!("capture stream read failed: {e}"))?;
        if read == 0 {
            break;
        }
        total += read as usize;
    }
    buf.truncate(total);
    Ok(buf)
}
