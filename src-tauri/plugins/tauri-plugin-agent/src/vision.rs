//! Vision capture for the agent loop.
//!
//! Provides a [`VisionProvider`] trait and concrete implementations for
//! feeding real-time image frames into the agent's VLM context.
//!
//! Supported sources:
//! - **Camera** — captures from the default webcam via platform CLI tools
//!   (`imagesnap` on macOS, `fswebcam` on Linux).
//! - **Directory watcher** — polls a directory for the newest `.jpg`/`.png`.
//! - **URL** — fetches a JPEG frame from an HTTP endpoint (e.g. IP camera).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::watch;

/// A single captured frame: JPEG bytes, ready for base64 encoding.
#[derive(Clone)]
pub struct Frame {
    pub jpeg_bytes: Vec<u8>,
    pub timestamp_ms: u64,
}

/// Provides the latest vision frame to the agent loop.
///
/// Implementations run a background capture loop and expose the most recent
/// frame via [`latest_frame`].
#[async_trait::async_trait]
pub trait VisionProvider: Send + Sync {
    /// Return the most recently captured frame, or `None` if no frame is available yet.
    fn latest_frame(&self) -> Option<Frame>;

    /// Number of frames captured so far.
    fn frame_count(&self) -> u64;

    /// Whether the capture source is actively running.
    fn is_active(&self) -> bool;

    /// Stop the capture loop.
    fn stop(&self);
}

/// Encode a frame as a data URI suitable for the OpenAI vision API.
pub fn frame_to_data_uri(frame: &Frame) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&frame.jpeg_bytes);
    format!("data:image/jpeg;base64,{b64}")
}

/// Build the OpenAI multimodal content array: one text part + one image_url part.
pub fn build_vision_content(text: &str, frame: &Frame) -> serde_json::Value {
    serde_json::json!([
        { "type": "text", "text": text },
        {
            "type": "image_url",
            "image_url": { "url": frame_to_data_uri(frame), "detail": "low" }
        }
    ])
}

// ── Camera capture ──────────────────────────────────────────────────────────

pub struct CameraCapture {
    frame_tx: watch::Sender<Option<Frame>>,
    frame_rx: watch::Receiver<Option<Frame>>,
    frame_count: Arc<AtomicU64>,
    active: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
}

impl CameraCapture {
    /// Start capturing from the default camera at `interval`.
    ///
    /// Spawns a background tokio task.  Call [`stop()`] or drop to end capture.
    pub fn start(interval: std::time::Duration) -> Self {
        let (tx, rx) = watch::channel(None);
        let count = Arc::new(AtomicU64::new(0));
        let active = Arc::new(AtomicBool::new(true));
        let stop = Arc::new(AtomicBool::new(false));

        let tx2 = tx.clone();
        let count2 = count.clone();
        let active2 = active.clone();
        let stop2 = stop.clone();

        tokio::spawn(async move {
            let tmp_dir = std::env::temp_dir().join("jan-vision");
            let _ = std::fs::create_dir_all(&tmp_dir);
            let tmp_path = tmp_dir.join("frame.jpg");

            loop {
                if stop2.load(Ordering::Relaxed) {
                    break;
                }

                match capture_camera_frame(&tmp_path).await {
                    Ok(bytes) => {
                        let ts = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let _ = tx2.send(Some(Frame { jpeg_bytes: bytes, timestamp_ms: ts }));
                        count2.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        log::info!("[vision] camera capture failed: {e}");
                    }
                }

                tokio::time::sleep(interval).await;
            }
            active2.store(false, Ordering::Relaxed);
        });

        Self { frame_tx: tx, frame_rx: rx, frame_count: count, active, stop_flag: stop }
    }
}

#[async_trait::async_trait]
impl VisionProvider for CameraCapture {
    fn latest_frame(&self) -> Option<Frame> {
        self.frame_rx.borrow().clone()
    }

    fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

/// Capture a single frame from the default camera using platform CLI tools.
async fn capture_camera_frame(output_path: &Path) -> Result<Vec<u8>, String> {
    let path_str = output_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    let result = {
        // imagesnap: brew install imagesnap
        tokio::process::Command::new("imagesnap")
            .args(["-q", &path_str])
            .output()
            .await
            .map_err(|e| format!("imagesnap not found (brew install imagesnap): {e}"))
    };

    #[cfg(target_os = "linux")]
    let result = {
        // fswebcam: apt install fswebcam
        tokio::process::Command::new("fswebcam")
            .args(["-r", "640x480", "--no-banner", "-q", &path_str])
            .output()
            .await
            .map_err(|e| format!("fswebcam not found (apt install fswebcam): {e}"))
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let result = Err::<std::process::Output, String>(
        "Camera capture not supported on this platform".into(),
    );

    let output = result?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("camera capture failed: {stderr}"));
    }

    std::fs::read(output_path).map_err(|e| format!("read captured frame: {e}"))
}

// ── Directory watcher ───────────────────────────────────────────────────────

/// Watches a directory for the newest image file.  Good for testing
/// without a physical camera — just drop images into the directory.
pub struct DirectoryCapture {
    frame_tx: watch::Sender<Option<Frame>>,
    frame_rx: watch::Receiver<Option<Frame>>,
    frame_count: Arc<AtomicU64>,
    active: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
}

impl DirectoryCapture {
    pub fn start(dir: PathBuf, interval: std::time::Duration) -> Self {
        let (tx, rx) = watch::channel(None);
        let count = Arc::new(AtomicU64::new(0));
        let active = Arc::new(AtomicBool::new(true));
        let stop = Arc::new(AtomicBool::new(false));

        let tx2 = tx.clone();
        let count2 = count.clone();
        let active2 = active.clone();
        let stop2 = stop.clone();

        tokio::spawn(async move {
            loop {
                if stop2.load(Ordering::Relaxed) {
                    break;
                }

                if let Some(bytes) = find_newest_image(&dir) {
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let _ = tx2.send(Some(Frame { jpeg_bytes: bytes, timestamp_ms: ts }));
                    count2.fetch_add(1, Ordering::Relaxed);
                }

                tokio::time::sleep(interval).await;
            }
            active2.store(false, Ordering::Relaxed);
        });

        Self { frame_tx: tx, frame_rx: rx, frame_count: count, active, stop_flag: stop }
    }
}

#[async_trait::async_trait]
impl VisionProvider for DirectoryCapture {
    fn latest_frame(&self) -> Option<Frame> {
        self.frame_rx.borrow().clone()
    }
    fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }
    fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }
    fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

// ── URL capture ─────────────────────────────────────────────────────────────

/// Polls a remote HTTP endpoint (e.g. `http://localhost:8765/frame`) for JPEG frames.
/// Designed to work with the ProcTHOR robot server or any endpoint that returns `image/jpeg`.
pub struct UrlCapture {
    frame_rx: watch::Receiver<Option<Frame>>,
    frame_count: Arc<AtomicU64>,
    active: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
}

impl UrlCapture {
    /// Start polling `url` at the given `interval`.
    pub fn start(url: String, interval: std::time::Duration) -> Self {
        let (tx, rx) = watch::channel(None);
        let count = Arc::new(AtomicU64::new(0));
        let active = Arc::new(AtomicBool::new(true));
        let stop = Arc::new(AtomicBool::new(false));

        let count2 = count.clone();
        let active2 = active.clone();
        let stop2 = stop.clone();

        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default();

            loop {
                if stop2.load(Ordering::Relaxed) {
                    break;
                }

                match client.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(bytes) = resp.bytes().await {
                            let ts = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            let _ = tx.send(Some(Frame {
                                jpeg_bytes: bytes.to_vec(),
                                timestamp_ms: ts,
                            }));
                            count2.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Ok(resp) => {
                        log::info!("[vision] url capture: HTTP {}", resp.status());
                    }
                    Err(e) => {
                        log::info!("[vision] url capture failed: {e}");
                    }
                }

                tokio::time::sleep(interval).await;
            }
            active2.store(false, Ordering::Relaxed);
        });

        Self { frame_rx: rx, frame_count: count, active, stop_flag: stop }
    }
}

#[async_trait::async_trait]
impl VisionProvider for UrlCapture {
    fn latest_frame(&self) -> Option<Frame> {
        self.frame_rx.borrow().clone()
    }
    fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }
    fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }
    fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

fn find_newest_image(dir: &Path) -> Option<Vec<u8>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "jpg" | "jpeg" | "png") {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            if newest.as_ref().map_or(true, |(t, _)| modified > *t) {
                newest = Some((modified, path));
            }
        }
    }
    let (_, path) = newest?;
    std::fs::read(&path).ok()
}
