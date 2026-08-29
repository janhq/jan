use super::models::{
    DownloadEvent, DownloadItem, DownloadLedger, ProgressTracker, ProxyConfig, SegmentState,
};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::filesystem::helpers::resolve_path_within_jan_data_folder;
use crate::core::updater::hmac_client::SignedRequestHeaders;
use crate::core::updater::session::get_session_id;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::fs::File;
use tokio::io::{AsyncSeekExt, AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;
use url::Url;

// ===== CONSTANTS =====

// -- Segmented download tuning --

/// Parallel Range connections per file.
const SEGMENT_COUNT: u64 = 4;
/// Files smaller than this download over a single connection; segment
/// bookkeeping is not worth it below it.
const MIN_SEGMENTED_SIZE: u64 = 20 * 1024 * 1024;
/// A connection that delivers no bytes for this long is presumed dead and the
/// segment retries (fixes "stuck at N% forever" without an error).
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-segment retries with exponential backoff; only transient failures
/// (network, timeouts, 5xx, 429) count. 401/403/404 fail immediately.
const SEGMENT_RETRIES: u32 = 3;
const SEGMENT_BACKOFF_SECS: [u64; 3] = [1, 3, 9];
/// Progress events fire at most once per second AND whenever this many new
/// bytes arrived since the last event: fast links stay responsive, slow links
/// still tick every second instead of appearing frozen.
const EVENT_MIN_INTERVAL: Duration = Duration::from_secs(1);
const EVENT_MIN_BYTES: u64 = 5 * 1024 * 1024;
/// Ledger checkpoint interval per segment: a crash loses at most this much
/// progress per segment.
const LEDGER_SAVE_INTERVAL: u64 = 32 * 1024 * 1024;
/// Headroom demanded on the target drive before starting: missing bytes plus
/// this much must be free, or the task refuses to start.
const DISK_HEADROOM: u64 = 1024 * 1024 * 1024;
/// Structured error prefix the frontend matches on to show a localized
/// message: `DISK_SPACE_INSUFFICIENT|{needed}|{free}` (plain byte counts).
pub const ERR_DISK_SPACE: &str = "DISK_SPACE_INSUFFICIENT";

/// Jan mirror prefix for HuggingFace downloads
/// - Stable builds: https://apps.jan.ai/
/// - Nightly builds: https://apps-nightly.jan.ai/
const JAN_MIRROR_PREFIX_STABLE: &str = "https://apps.jan.ai/";
const JAN_MIRROR_PREFIX_NIGHTLY: &str = "https://apps-nightly.jan.ai/";

/// Domains that should use mirror download with fallback
const MIRROR_DOMAINS: &[&str] = &["huggingface.co"];

/// Check if this is a nightly build based on package name
fn is_nightly_build() -> bool {
    let pkg_name = env!("CARGO_PKG_NAME");
    pkg_name.to_lowercase().contains("nightly")
}

/// Get the appropriate mirror prefix based on build type
fn get_mirror_prefix() -> &'static str {
    if is_nightly_build() {
        JAN_MIRROR_PREFIX_NIGHTLY
    } else {
        JAN_MIRROR_PREFIX_STABLE
    }
}

/// Secret key for HMAC request authentication
/// - In CI: Set JAN_SIGNING_KEY environment variable at build time
/// - In local dev: Falls back to a test key
const SECRET_KEY: &str = match option_env!("JAN_SIGNING_KEY") {
    Some(key) => key,
    None => "local-dev-test-key-not-for-production",
};

// ===== UTILITY FUNCTIONS =====

pub fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {e}")
}

/// Converts a URL to Jan mirror URL if applicable
/// e.g., https://huggingface.co/... -> https://apps.jan.ai/huggingface.co/...
/// or for nightly: https://huggingface.co/... -> https://apps-nightly.jan.ai/huggingface.co/...
pub fn convert_to_mirror_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;

    // Check if the domain should use mirror
    if MIRROR_DOMAINS
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{}", domain)))
    {
        // Remove the scheme (https://) and prepend mirror prefix
        let url_without_scheme = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))?;
        Some(format!("{}{}", get_mirror_prefix(), url_without_scheme))
    } else {
        None
    }
}

/// Get session identifier for request signing
fn get_download_nonce_seed() -> String {
    get_session_id()
}

/// Get current app version from Cargo.toml
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ===== VALIDATION FUNCTIONS =====

/// Validates a downloaded file against expected hash and size
async fn validate_downloaded_file(
    item: &DownloadItem,
    save_path: &Path,
    app: &tauri::AppHandle<impl Runtime>,
    cancel_token: &CancellationToken,
    emit_event: bool,
) -> Result<(), String> {
    // Skip validation if no verification data is provided
    if item.sha256.is_none() && item.size.is_none() {
        log::debug!(
            "No validation data provided for {}, skipping validation",
            item.url
        );
        return Ok(());
    }

    // Use model_id from item if available, otherwise extract from save path
    // Path structure: llamacpp/models/{modelId}/model.gguf or llamacpp/models/{modelId}/mmproj.gguf
    let model_id = item.model_id.as_deref().unwrap_or_else(|| {
        save_path
            .parent() // get parent directory (modelId folder)
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
    });

    if emit_event {
        if let Err(e) = app.emit(
            "onModelValidationStarted",
            serde_json::json!({
                "modelId": model_id,
                "downloadType": "Model",
            }),
        ) {
            log::warn!("Failed to emit onModelValidationStarted for {model_id}: {e}");
        }
        log::info!("Starting validation for model: {model_id}");
    }

    // Validate size if provided (fast check first)
    if let Some(expected_size) = &item.size {
        log::info!("Starting size verification for {}", item.url);

        match tokio::fs::metadata(save_path).await {
            Ok(metadata) => {
                let actual_size = metadata.len();

                if actual_size != *expected_size {
                    log::error!(
                        "Size verification failed for {}. Expected: {} bytes, Actual: {} bytes",
                        item.url,
                        expected_size,
                        actual_size
                    );
                    return Err(format!(
                        "Size verification failed. Expected {expected_size} bytes but got {actual_size} bytes."
                    ));
                }

                log::info!(
                    "Size verification successful for {} ({} bytes)",
                    item.url,
                    actual_size
                );
            }
            Err(e) => {
                log::error!(
                    "Failed to get file metadata for {}: {}",
                    save_path.display(),
                    e
                );
                return Err(format!("Failed to verify file size: {e}"));
            }
        }
    }

    // Check for cancellation before expensive hash computation
    if cancel_token.is_cancelled() {
        log::info!("Validation cancelled for {}", item.url);
        return Err("Validation cancelled".to_string());
    }

    // Validate hash if provided (expensive check second)
    if let Some(expected_sha256) = &item.sha256 {
        log::info!("Starting Hash verification for {}", item.url);

        match jan_utils::crypto::compute_file_sha256_with_cancellation(save_path, cancel_token)
            .await
        {
            Ok(computed_sha256) => {
                if computed_sha256 != *expected_sha256 {
                    log::error!(
                        "Hash verification failed for {}. Expected: {}, Computed: {}",
                        item.url,
                        expected_sha256,
                        computed_sha256
                    );

                    return Err("Hash verification failed. The downloaded file is corrupted or has been tampered with.".to_string());
                }

                log::info!("Hash verification successful for {}", item.url);
            }
            Err(e) => {
                log::error!(
                    "Failed to compute SHA256 for {}: {}",
                    save_path.display(),
                    e
                );
                return Err(format!("Failed to verify file integrity: {e}"));
            }
        }
    }

    log::info!("All validations passed for {}", item.url);
    Ok(())
}

pub fn validate_proxy_config(config: &ProxyConfig) -> Result<(), String> {
    // Validate proxy URL format
    if let Err(e) = Url::parse(&config.url) {
        return Err(format!("Invalid proxy URL '{}': {e}", config.url));
    }

    // Check if proxy URL has valid scheme
    let url = Url::parse(&config.url).unwrap(); // Safe to unwrap as we just validated it
    match url.scheme() {
        "http" | "https" | "socks4" | "socks5" => {}
        scheme => return Err(format!("Unsupported proxy scheme: {scheme}")),
    }

    // Validate authentication credentials
    if config.username.is_some() && config.password.is_none() {
        return Err("Username provided without password".to_string());
    }

    if config.password.is_some() && config.username.is_none() {
        return Err("Password provided without username".to_string());
    }

    // Validate no_proxy entries
    if let Some(no_proxy) = &config.no_proxy {
        for entry in no_proxy {
            if entry.is_empty() {
                return Err("Empty no_proxy entry".to_string());
            }
            // Basic validation for wildcard patterns
            if entry.starts_with("*.") && entry.len() < 3 {
                return Err(format!("Invalid wildcard pattern: {entry}"));
            }
        }
    }

    // SSL verification settings are all optional booleans, no validation needed

    Ok(())
}

pub fn create_proxy_from_config(config: &ProxyConfig) -> Result<reqwest::Proxy, String> {
    // Validate the configuration first
    validate_proxy_config(config)?;

    let mut proxy = reqwest::Proxy::all(&config.url).map_err(err_to_string)?;

    // Add authentication if provided
    if let (Some(username), Some(password)) = (&config.username, &config.password) {
        proxy = proxy.basic_auth(username, password);
    }

    Ok(proxy)
}

pub fn should_bypass_proxy(url: &str, no_proxy: &[String]) -> bool {
    if no_proxy.is_empty() {
        return false;
    }

    // Parse the URL to get the host
    let parsed_url = match Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };

    let host = match parsed_url.host_str() {
        Some(h) => h,
        None => return false,
    };

    // Check if host matches any no_proxy entry
    for entry in no_proxy {
        if entry == "*" {
            return true;
        }

        // Simple wildcard matching
        if let Some(domain) = entry.strip_prefix("*.") {
            if host.ends_with(domain) {
                return true;
            }
        } else if host == entry {
            return true;
        }
    }

    false
}

/// 魔搭 Tengine CDN 会对 reqwest 默认 UA 做 ACL 黑名单拦截(403 "denied by UA ACL = blacklist"。
/// 由阿里 Tengine 返回)。前端搜索/详情接口用 "User-Agent: Jan/1.0" 可通过,唯独文件下载没带。
/// 这里为 modelscope.cn 的下载补上同款 UA;未显式携带 User-Agent 的下载也一并补一个友好 UA。
pub fn effective_download_headers(item: &DownloadItem, header_map: &HeaderMap) -> HeaderMap {
    let mut effective = header_map.clone();
    if item.url.contains("modelscope.cn")
        && !effective.contains_key(HeaderName::from_static("user-agent"))
    {
        effective.insert(
            HeaderName::from_static("user-agent"),
            HeaderValue::from_static("Jan/1.0"),
        );
    }
    effective
}

pub fn _get_client_for_item(
    item: &DownloadItem,
    header_map: &HeaderMap,
) -> Result<reqwest::Client, String> {
    let effective_headers = effective_download_headers(item, header_map);

    let mut client_builder = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        // 断网/限流的快速失败:建连阶段 30s 超时,否则 send 可能无限挂起,
        // 重试与 download-retrying 事件都会迟迟不来。
        .connect_timeout(Duration::from_secs(30))
        .default_headers(effective_headers);

    // Add proxy configuration if provided
    if let Some(proxy_config) = &item.proxy {
        // Handle SSL verification settings
        if proxy_config.ignore_ssl.unwrap_or(false) {
            client_builder = client_builder.danger_accept_invalid_certs(true);
            log::info!("SSL certificate verification disabled for URL {}", item.url);
        }

        // Note: reqwest doesn't have fine-grained SSL verification controls
        // for verify_proxy_ssl, verify_proxy_host_ssl, verify_peer_ssl, verify_host_ssl
        // These settings are handled by the underlying TLS implementation

        // Check if this URL should bypass proxy
        let no_proxy = proxy_config.no_proxy.as_deref().unwrap_or(&[]);
        if !should_bypass_proxy(&item.url, no_proxy) {
            let proxy = create_proxy_from_config(proxy_config)?;
            client_builder = client_builder.proxy(proxy);
            log::info!("Using proxy {} for URL {}", proxy_config.url, item.url);
        } else {
            log::info!("Bypassing proxy for URL {}", item.url);
        }
    }

    client_builder.build().map_err(err_to_string)
}

pub fn _convert_headers(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    let mut header_map = HeaderMap::new();
    for (k, v) in headers {
        let key = HeaderName::from_bytes(k.as_bytes())?;
        let value = HeaderValue::from_str(v)?;
        header_map.insert(key, value);
    }
    Ok(header_map)
}

/// Discovers the true file size with a single ranged GET when HEAD fails
/// (e.g. ModelScope's API URL 404s on HEAD but 302s to a Range-capable CDN).
/// Returns None when the server does not honor Range — the caller then falls
/// back to a single stream. The probe body is discarded; the real download
/// re-requests from scratch, so at most one tiny request is wasted.
async fn probe_total_size(client: &reqwest::Client, url: &str) -> Option<u64> {
    const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

    let request = client.get(url).header(reqwest::header::RANGE, "bytes=0-0");
    let resp = tokio::time::timeout(PROBE_TIMEOUT, request.send())
        .await
        .ok()?
        .ok()?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let content_range = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .to_string();
    drop(resp);
    // "bytes 0-0/12345" → 12345; "*/12345" (a 416-style reply) also accepted.
    let total = content_range
        .rsplit('/')
        .next()?
        .trim()
        .parse::<u64>()
        .ok()?;
    (total > 0).then_some(total)
}

/// Best-effort file size probe via HEAD. Returns 0 when the server blocks HEAD,
/// times out, omits Content-Length, or otherwise misbehaves — the actual GET
/// request will surface any real URL/auth errors.
pub async fn _get_file_size(client: &reqwest::Client, url: &str) -> u64 {
    const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
    let resp = match tokio::time::timeout(HEAD_TIMEOUT, client.head(url).send()).await {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => {
            log::warn!("HEAD {url} failed ({e}); proceeding without known size");
            return 0;
        }
        Err(_) => {
            log::warn!(
                "HEAD {url} timed out after {}s; proceeding without known size",
                HEAD_TIMEOUT.as_secs()
            );
            return 0;
        }
    };

    if !resp.status().is_success() {
        log::warn!(
            "HEAD {url} returned HTTP {}; proceeding without known size",
            resp.status()
        );
        return 0;
    }

    resp.headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

// ===== SEGMENTED DOWNLOAD HELPERS =====

/// Sidecar path helpers. The `.tmp` holds the preallocated payload, `.url` the
/// legacy single-stream resume URL, `.meta.json` the segmented resume ledger.
fn with_appended(path: &Path, ext: &str) -> std::path::PathBuf {
    match path.extension() {
        Some(cur) if !cur.is_empty() => {
            path.with_extension(format!("{}.{ext}", cur.to_string_lossy()))
        }
        _ => path.with_extension(ext),
    }
}

fn tmp_path_for(save_path: &Path) -> std::path::PathBuf {
    with_appended(save_path, "tmp")
}

fn url_path_for(save_path: &Path) -> std::path::PathBuf {
    with_appended(save_path, "url")
}

fn meta_path_for(save_path: &Path) -> std::path::PathBuf {
    with_appended(save_path, "meta.json")
}

/// Retry signaling: any retry point (segment backoff, single-stream retry,
/// task-level retry) tells the UI it is still working. The frontend flips the
/// row to "retrying" on this event and back to "downloading" as soon as real
/// progress events resume — state bound to the download, not guessed from a
/// silent frontend timer.
struct RetrySignal<R: Runtime> {
    app: tauri::AppHandle<R>,
    task_id: String,
    model_id: Option<String>,
}

// Manual impl: the derive would demand `R: Clone`, which Runtime does not
// provide — `.clone()` on `&Self` would then silently clone the reference.
impl<R: Runtime> Clone for RetrySignal<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            task_id: self.task_id.clone(),
            model_id: self.model_id.clone(),
        }
    }
}

impl<R: Runtime> RetrySignal<R> {
    fn emit(&self, attempt: u32) {
        log::info!(
            "Task {} retrying (attempt {attempt}) — notifying UI (model: {})",
            self.task_id,
            self.model_id.as_deref().unwrap_or("?")
        );
        if let Err(e) =
            app_emit_retrying(&self.app, &self.task_id, self.model_id.as_deref(), attempt)
        {
            log::warn!("Failed to emit download-retrying: {e}");
        }
    }
}

fn app_emit_retrying<R: Runtime>(
    app: &tauri::AppHandle<R>,
    task_id: &str,
    model_id: Option<&str>,
    attempt: u32,
) -> Result<(), tauri::Error> {
    app.emit(
        "download-retrying",
        serde_json::json!({
            "taskId": task_id,
            "modelId": model_id,
            "attempt": attempt,
        }),
    )
}

/// Splits `total` bytes into at most `n` contiguous `[start, end)` ranges.
/// Pure and unit-testable: the boundaries must tile the file exactly, with the
/// remainder spread over the leading ranges.
pub fn segment_ranges(total: u64, n: u64) -> Vec<(u64, u64)> {
    if total == 0 {
        return Vec::new();
    }
    let n = n.clamp(1, total);
    let base = total / n;
    let rem = total % n;
    let mut out = Vec::with_capacity(n as usize);
    let mut start = 0u64;
    for i in 0..n {
        let len = base + if i < rem { 1 } else { 0 };
        out.push((start, start + len));
        start += len;
    }
    out
}

/// How a failed segment attempt is treated.
#[derive(Debug)]
pub enum SegmentFailure {
    /// Worth retrying with backoff: network errors, timeouts, 5xx, 429.
    Transient(String),
    /// Retrying cannot help: 401 (token), 403 (license/expired signature),
    /// 404 (gone) and other client errors. Fail the file immediately.
    Hard(String),
    /// The server answered 200 to a ranged request: it does not honor Range.
    /// The caller restarts the file over a single stream.
    RangeUnsupported,
}

impl SegmentFailure {
    fn transient<E: std::fmt::Display>(e: E) -> Self {
        Self::Transient(e.to_string())
    }
}

impl std::fmt::Display for SegmentFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transient(e) | Self::Hard(e) => write!(f, "{e}"),
            Self::RangeUnsupported => write!(f, "server does not honor Range requests"),
        }
    }
}

/// Maps an HTTP status from a ranged GET to a failure class.
pub fn classify_status(status: reqwest::StatusCode) -> SegmentFailure {
    match status.as_u16() {
        200 => SegmentFailure::RangeUnsupported,
        401 | 403 | 404 => SegmentFailure::Hard(format!("HTTP status {}", status.as_u16())),
        429 => SegmentFailure::transient(format!("HTTP status {}", status.as_u16())),
        c if c >= 500 => SegmentFailure::transient(format!("HTTP status {c}")),
        c => SegmentFailure::Hard(format!("HTTP status {c}")),
    }
}

/// Whether an error string means the user (or the pause path) stopped the
/// download — such errors must never be retried or surfaced as failures.
fn is_cancellation_err(e: &str) -> bool {
    e.to_lowercase().contains("cancel")
}

/// Task-level retries are for transient troubles only: auth/license/missing
/// files and validation failures will fail again identically.
fn is_retryable_task_error(e: &str) -> bool {
    !(is_cancellation_err(e)
        || e.contains("HTTP status 401")
        || e.contains("HTTP status 403")
        || e.contains("HTTP status 404")
        || e.starts_with(ERR_DISK_SPACE))
}

/// Free bytes on the drive that contains `path`. 0 when the probe fails — the
/// check must never block a working setup on a listing hiccup; the actual
/// download will surface real I/O errors.
fn available_space(path: &Path) -> u64 {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut best_len = 0usize;
    let mut best_free = 0u64;
    for d in disks.list() {
        let mp = d.mount_point();
        if path.starts_with(mp) && mp.as_os_str().len() >= best_len {
            best_len = mp.as_os_str().len();
            best_free = d.available_space();
        }
    }
    best_free
}

/// Refuses to start when the target drive cannot hold the missing bytes plus
/// a headroom margin. The error is a structured string the frontend matches
/// on (`DISK_SPACE_INSUFFICIENT|{needed}|{free}`) to show a localized toast
/// and a failed row with the real numbers.
fn check_disk_space(save_root: &Path, needed: u64) -> Result<(), String> {
    if needed == 0 {
        return Ok(());
    }
    let free = available_space(save_root);
    if free == 0 {
        return Ok(());
    }
    if free < needed.saturating_add(DISK_HEADROOM) {
        log::error!(
            "Insufficient disk space: need {} bytes (+{} headroom), only {} free on {}",
            needed,
            DISK_HEADROOM,
            free,
            save_root.display()
        );
        return Err(format!("{ERR_DISK_SPACE}|{needed}|{free}"));
    }
    Ok(())
}

/// Bytes of a file already on disk, credited by the resume artifacts:
/// the segmented ledger when it matches, else the legacy `.tmp`+`.url` pair.
/// Used by the disk pre-check so a resumed task only demands its remainder.
async fn existing_bytes_on_disk(save_path: &Path, url: &str, total: u64) -> u64 {
    if let Some(led) = DownloadLedger::load(&meta_path_for(save_path)).await {
        if led.url == url && (total == 0 || led.total_size == total) {
            let tmp_ok = tokio::fs::metadata(tmp_path_for(save_path))
                .await
                .map(|m| m.len() == led.total_size)
                .unwrap_or(false);
            if tmp_ok {
                return led.done_total().min(total);
            }
        }
    }
    let url_matches = tokio::fs::read_to_string(url_path_for(save_path))
        .await
        .map(|u| u == url)
        .unwrap_or(false);
    if url_matches {
        if let Ok(md) = tokio::fs::metadata(tmp_path_for(save_path)).await {
            return md.len().min(total);
        }
    }
    0
}

// ===== MAIN DOWNLOAD FUNCTIONS =====

// Context passed to `download_single_file` to reduce the number of arguments.
// Progress events are emitted by the task-level ticker, so the per-file
// context no longer carries the event name.
struct DownloadCtx<R: Runtime> {
    header_map: HeaderMap,
    resume: bool,
    cancel_token: CancellationToken,
    progress_tracker: ProgressTracker,
    retry: RetrySignal<R>,
}

/// Downloads multiple files in parallel with individual progress tracking.
///
/// Every file is fetched over up to [`SEGMENT_COUNT`] parallel Range
/// connections into one preallocated `.tmp` (segmented mode), or over a single
/// stream when the server gives no length, the file is small, or it ignores
/// Range. Combined progress events are emitted by a task-level ticker under
/// the dual condition "≥1s since the last event or ≥5 new MB": slow links
/// still tick every second, fast ones stay responsive.
pub async fn _download_files_internal(
    app: tauri::AppHandle<impl Runtime>,
    items: &[DownloadItem],
    headers: &HashMap<String, String>,
    task_id: &str,
    resume: bool,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    log::info!("Start download task: {task_id}");

    let header_map = _convert_headers(headers).map_err(err_to_string)?;

    // Calculate sizes for each file
    let mut file_sizes: HashMap<String, u64> = HashMap::new();
    for item in items.iter() {
        let client = _get_client_for_item(item, &header_map).map_err(err_to_string)?;
        let size = _get_file_size(&client, &item.url).await;
        file_sizes.insert(item.url.clone(), size);
    }

    let total_size: u64 = file_sizes.values().sum();
    log::info!("Total download size: {total_size}");

    // save file under Jan data folder
    let jan_data_folder = get_jan_data_folder_path(app.clone());

    let mut resolved: Vec<(DownloadItem, std::path::PathBuf)> = Vec::with_capacity(items.len());
    for item in items.iter() {
        let (_, save_path) =
            resolve_path_within_jan_data_folder(&jan_data_folder, &item.save_path)?;
        resolved.push((item.clone(), save_path));
    }

    // Disk pre-check before anything is written: only the still-missing bytes
    // are demanded (a resumed task's on-disk partials count as present).
    let mut needed = 0u64;
    for (item, save_path) in &resolved {
        let total = file_sizes.get(&item.url).copied().unwrap_or(0);
        let have = if resume {
            existing_bytes_on_disk(save_path, &item.url, total).await
        } else {
            0
        };
        needed += total.saturating_sub(have);
    }
    check_disk_space(&jan_data_folder, needed)?;

    // Create progress tracker
    let progress_tracker = ProgressTracker::new(items, file_sizes.clone());

    let evt_name = format!("download-{task_id}");

    // Progress ticker: combined progress under the dual condition.
    let done_flag = Arc::new(AtomicBool::new(false));
    let ticker = {
        let tracker = progress_tracker.clone();
        let evt_name = evt_name.clone();
        let app = app.clone();
        let cancel = cancel_token.clone();
        let done = done_flag.clone();
        tokio::spawn(async move {
            let mut last_emitted = 0u64;
            let mut last_emit_at = std::time::Instant::now();
            while !done.load(Ordering::Relaxed) && !cancel.is_cancelled() {
                tokio::time::sleep(Duration::from_millis(200)).await;
                let (t, total) = tracker.get_total_progress().await;
                if t == last_emitted {
                    continue;
                }
                let since = t.saturating_sub(last_emitted);
                if last_emit_at.elapsed() >= EVENT_MIN_INTERVAL || since >= EVENT_MIN_BYTES {
                    if let Err(e) = app.emit(
                        &evt_name,
                        DownloadEvent {
                            transferred: t,
                            total,
                        },
                    ) {
                        log::warn!("Failed to emit progress for {evt_name}: {e}");
                    }
                    last_emitted = t;
                    last_emit_at = std::time::Instant::now();
                }
            }
        })
    };

    // Collect download tasks for parallel execution
    let mut download_tasks = Vec::new();

    for (index, (item, save_path)) in resolved.iter().enumerate() {
        let item_clone = item.clone();
        let save_path = save_path.clone();
        let file_id = format!("{task_id}-{index}");
        let file_size = file_sizes.get(&item.url).copied().unwrap_or(0);

        let retry = RetrySignal {
            app: app.clone(),
            task_id: task_id.to_string(),
            model_id: item.model_id.clone(),
        };
        let ctx = DownloadCtx {
            header_map: header_map.clone(),
            resume,
            cancel_token: cancel_token.clone(),
            progress_tracker: progress_tracker.clone(),
            retry,
        };

        let task = tokio::spawn(async move {
            log::debug!("Downloading {} into Jan data folder", item_clone.url);
            download_single_file(&item_clone, &save_path, file_id, file_size, ctx).await
        });

        download_tasks.push(task);
    }

    // Wait for all downloads to complete
    let mut validation_tasks = Vec::new();
    for (task, (item, save_path)) in download_tasks.into_iter().zip(resolved.iter()) {
        let result = task.await.map_err(|e| format!("Task join error: {e}"))?;

        match result {
            Ok(_) => {
                // Spawn validation task in parallel
                let item_clone = item.clone();
                let app_clone = app.clone();
                let path_clone = save_path.clone();
                let cancel_token_clone = cancel_token.clone();
                let validation_task = tokio::spawn(async move {
                    validate_downloaded_file(
                        &item_clone,
                        &path_clone,
                        &app_clone,
                        &cancel_token_clone,
                        false,
                    )
                    .await
                });
                validation_tasks.push((validation_task, save_path.clone()));
            }
            Err(e) => {
                done_flag.store(true, Ordering::Relaxed);
                return Err(e);
            }
        }
    }

    let model_id = items
        .iter()
        .find_map(|item| item.model_id.as_ref())
        .map(|s| s.as_str())
        .or_else(|| {
            items.first().and_then(|item| {
                std::path::Path::new(&item.save_path)
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
            })
        })
        .unwrap_or("unknown");

    if !validation_tasks.is_empty()
        && items
            .iter()
            .any(|item| item.sha256.is_some() || item.size.is_some())
    {
        if let Err(e) = app.emit(
            "onModelValidationStarted",
            serde_json::json!({
                "modelId": model_id,
                "downloadType": "Model",
            }),
        ) {
            log::warn!("Failed to emit onModelValidationStarted for {model_id}: {e}");
        }
        log::info!("Starting validation for model: {model_id}");
    }

    // Wait for all validations to complete
    for (validation_task, save_path) in validation_tasks {
        let validation_result = validation_task
            .await
            .map_err(|e| format!("Validation task join error: {e}"))?;

        if let Err(validation_error) = validation_result {
            // Clean up the file if validation fails
            done_flag.store(true, Ordering::Relaxed);
            let _ = tokio::fs::remove_file(&save_path).await;

            // Try to clean up the parent directory if it's empty
            if let Some(parent) = save_path.parent() {
                let _ = tokio::fs::remove_dir(parent).await;
            }

            return Err(validation_error);
        }
    }

    // Stop the ticker and emit the final progress
    done_flag.store(true, Ordering::Relaxed);
    let _ = ticker.await;
    let (transferred, total) = progress_tracker.get_total_progress().await;
    let final_evt = DownloadEvent { transferred, total };
    if let Err(e) = app.emit(&evt_name, final_evt) {
        log::warn!("Failed to emit final {evt_name} progress: {e}");
    }
    Ok(())
}

/// Downloads one file: segmented (preallocated `.tmp` + parallel Range
/// connections + ledger) when the server gives a length and honors Range,
/// else a single stream. Both paths retry transient failures and keep their
/// partials so a later start resumes where they stopped.
async fn download_single_file<R: Runtime>(
    item: &DownloadItem,
    save_path: &std::path::Path,
    file_id: String,
    file_size: u64,
    ctx: DownloadCtx<R>,
) -> Result<std::path::PathBuf, String> {
    let DownloadCtx {
        header_map,
        resume,
        cancel_token,
        progress_tracker,
        retry,
    } = ctx;

    // Create parent directories if they don't exist
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(err_to_string)?;
        }
    }

    // Idempotency: when the final file is already on disk at the expected
    // size, skip straight to validation. This covers the "download finished
    // but the app closed before the success event" case (e.g. sha256 of a
    // 6.77 GB file still running during a restart) — clicking download again
    // must not re-fetch gigabytes that are already local.
    if let Ok(meta) = tokio::fs::metadata(save_path).await {
        let size_matches = item.size.map(|s| meta.len() == s).unwrap_or(meta.len() > 0);
        if size_matches {
            log::info!(
                "File already downloaded ({} bytes) — skipping: {}",
                meta.len(),
                item.url
            );
            // Stale sidecars from an interrupted run are junk now
            let _ = tokio::fs::remove_file(tmp_path_for(save_path)).await;
            let _ = tokio::fs::remove_file(url_path_for(save_path)).await;
            let _ = tokio::fs::remove_file(meta_path_for(save_path)).await;
            return Ok(save_path.to_path_buf());
        }
    }

    let tmp_save_path = tmp_path_for(save_path);
    let url_save_path = url_path_for(save_path);
    let meta_path = meta_path_for(save_path);

    let client = _get_client_for_item(item, &header_map).map_err(err_to_string)?;

    // HEAD 无法给出大小时(如魔搭 API URL 对 HEAD 返回 404),用一次
    // Range 0-0 的 GET 探测真实大小与 Range 支持,让这类下载也能走分段并行。
    let file_size = if file_size == 0 {
        match probe_total_size(&client, &item.url).await {
            Some(total) => {
                log::info!("Range probe discovered file size {total} for {}", item.url);
                total
            }
            None => {
                log::warn!(
                    "Range probe failed for {} (no 206/Content-Range) — falling back to a single stream",
                    item.url
                );
                0
            }
        }
    } else {
        file_size
    };

    // Decode URL for better readability in logs
    let decoded_url = url::Url::parse(&item.url)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| item.url.clone());
    log::info!("Started downloading: {decoded_url}");

    let mut task_attempt: u32 = 0;
    let result = loop {
        // Re-detect resume state on every pass: a previous attempt's segments
        // checkpointed the ledger as they went, so a retry continues from it.
        let ledger = DownloadLedger::load(&meta_path).await.filter(|l| {
            l.url == item.url
                && (file_size == 0 || l.total_size == file_size)
                && tmp_save_path.is_file()
        });
        let legacy_resume = ledger.is_none()
            && resume
            && tokio::fs::metadata(&tmp_save_path)
                .await
                .map(|m| m.len() > 0)
                .unwrap_or(false)
            && tokio::fs::read_to_string(&url_save_path)
                .await
                .map(|u| u == item.url)
                .unwrap_or(false);

        let attempt_result = if let Some(led) = ledger {
            log::info!(
                "Download mode: segmented resume ({} of {} bytes already on disk)",
                led.done_total(),
                led.total_size
            );
            segmented_download(
                item,
                &client,
                &tmp_save_path,
                &url_save_path,
                &meta_path,
                led,
                &cancel_token,
                &progress_tracker,
                &file_id,
                &retry,
            )
            .await
        } else if file_size >= MIN_SEGMENTED_SIZE {
            log::info!("Download mode: segmented ({SEGMENT_COUNT} ranges, {file_size} bytes)");
            let led = DownloadLedger {
                url: item.url.clone(),
                total_size: file_size,
                segments: segment_ranges(file_size, SEGMENT_COUNT)
                    .into_iter()
                    .map(|(offset, end)| SegmentState {
                        offset,
                        end,
                        done: 0,
                    })
                    .collect(),
            };
            led.save(&meta_path).await.map_err(err_to_string)?;
            segmented_download(
                item,
                &client,
                &tmp_save_path,
                &url_save_path,
                &meta_path,
                led,
                &cancel_token,
                &progress_tracker,
                &file_id,
                &retry,
            )
            .await
        } else {
            log::info!(
                "Download mode: single stream (size {file_size}, legacy resume: {legacy_resume})"
            );
            single_stream_download(
                item,
                &client,
                &tmp_save_path,
                &url_save_path,
                legacy_resume,
                file_size,
                &cancel_token,
                &progress_tracker,
                &file_id,
                &retry,
            )
            .await
        };

        match attempt_result {
            Ok(()) => break Ok(()),
            Err(e) if is_cancellation_err(&e) => break Err(e),
            // Auth, license, missing files and disk refusals fail identically
            // on a retry — surface them immediately.
            Err(e) if !is_retryable_task_error(&e) => break Err(e),
            Err(e) => {
                task_attempt += 1;
                if task_attempt > 1 {
                    break Err(e);
                }
                log::warn!(
                    "Download of {} failed ({e}); retrying once from the resume point",
                    item.url
                );
                // 告诉 UI 进入"重试中"(真实下载事件,而非前端猜测)
                retry.emit(task_attempt);
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                    _ = cancel_token.cancelled() => {
                        break Err("Download cancelled".to_string());
                    }
                }
            }
        }
    };
    result?;

    // rename tmp file to final file
    tokio::fs::rename(&tmp_save_path, save_path)
        .await
        .map_err(err_to_string)?;
    tokio::fs::remove_file(&url_save_path).await.ok();
    tokio::fs::remove_file(&meta_path).await.ok();

    log::info!("Finished downloading: {decoded_url}");
    Ok(save_path.to_path_buf())
}

/// One file over up to [`SEGMENT_COUNT`] parallel Range connections writing
/// into a single preallocated `.tmp`. Every segment checkpoints its progress
/// into the shared ledger; the whole run resumes from that ledger.
#[allow(clippy::too_many_arguments)]
async fn segmented_download<R: Runtime>(
    item: &DownloadItem,
    client: &reqwest::Client,
    tmp_save_path: &Path,
    url_save_path: &Path,
    meta_path: &Path,
    ledger: DownloadLedger,
    cancel_token: &CancellationToken,
    progress_tracker: &ProgressTracker,
    file_id: &str,
    retry: &RetrySignal<R>,
) -> Result<(), String> {
    let total = ledger.total_size;
    let initial_done = ledger.done_total();
    // The tracker was built from HEAD sizes, which are 0 for sources that
    // block HEAD (e.g. ModelScope). The ledger carries the real total — set
    // it absolutely or every progress event goes out with total = 0 and the
    // UI loses its percentage and size display.
    progress_tracker.set_total(total);
    progress_tracker
        .update_progress(file_id, initial_done)
        .await;

    let all_done: Vec<Arc<AtomicU64>> = ledger
        .segments
        .iter()
        .map(|s| Arc::new(AtomicU64::new(s.done)))
        .collect();

    // Preallocate the payload so every segmented write lands inside the file.
    let pre = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(tmp_save_path)
        .await
        .map_err(err_to_string)?;
    pre.set_len(total).await.map_err(err_to_string)?;
    drop(pre);

    // A child token lets one segment cancel its siblings (e.g. when the
    // server turns out to ignore Range) without touching the whole task.
    let file_cancel = cancel_token.child_token();
    let file_bytes = Arc::new(AtomicU64::new(0));

    let mut handles = Vec::new();
    for (index, seg) in ledger.segments.iter().cloned().enumerate() {
        let sctx = SegmentCtx {
            client: client.clone(),
            url: item.url.clone(),
            seg,
            done: all_done[index].clone(),
            all_done: all_done.clone(),
            tmp: tmp_save_path.to_path_buf(),
            meta_path: meta_path.to_path_buf(),
            ledger: ledger.clone(),
            cancel: file_cancel.clone(),
            tracker: progress_tracker.clone(),
            file_id: file_id.to_string(),
            file_initial: initial_done,
            file_bytes: file_bytes.clone(),
            retry: retry.clone(),
        };
        handles.push(tokio::spawn(async move { segment_worker(sctx).await }));
    }

    let mut range_unsupported = false;
    let mut hard_err: Option<String> = None;
    let mut transient_err: Option<String> = None;
    for h in handles {
        match h.await {
            Ok(Ok(())) => {}
            Ok(Err(SegmentFailure::RangeUnsupported)) => range_unsupported = true,
            Ok(Err(SegmentFailure::Hard(e))) => {
                if hard_err.is_none() {
                    hard_err = Some(e);
                }
            }
            Ok(Err(SegmentFailure::Transient(e))) => {
                if transient_err.is_none() {
                    transient_err = Some(e);
                }
            }
            Err(e) => {
                if transient_err.is_none() {
                    transient_err = Some(format!("Segment task join error: {e}"));
                }
            }
        }
    }

    let result = if let Some(e) = hard_err {
        Err(e)
    } else if range_unsupported {
        log::warn!(
            "Server ignored Range for {}; restarting over a single stream",
            item.url
        );
        // The segmented partial cannot be continued by a plain stream, so the
        // fallback starts from scratch (the ledger is dropped with it).
        let _ = tokio::fs::remove_file(meta_path).await;
        single_stream_download(
            item,
            client,
            tmp_save_path,
            url_save_path,
            false,
            total,
            cancel_token,
            progress_tracker,
            file_id,
            retry,
        )
        .await
    } else if let Some(e) = transient_err {
        Err(e)
    } else {
        Ok(())
    };
    result?;

    // Sanity check: the preallocated file must now be exactly full.
    let len = tokio::fs::metadata(tmp_save_path)
        .await
        .map_err(err_to_string)?
        .len();
    if len != total {
        return Err(format!(
            "Segmented download size mismatch for {}: expected {total}, got {len}",
            item.url
        ));
    }
    progress_tracker.update_progress(file_id, total).await;
    Ok(())
}

/// Everything one segment needs across its streaming passes. `all_done` holds
/// every segment's counter so the ledger can be checkpointed as a whole.
struct SegmentCtx<R: Runtime> {
    client: reqwest::Client,
    url: String,
    seg: SegmentState,
    /// This segment's own progress counter (mirrored in `all_done`).
    done: Arc<AtomicU64>,
    all_done: Vec<Arc<AtomicU64>>,
    tmp: std::path::PathBuf,
    meta_path: std::path::PathBuf,
    ledger: DownloadLedger,
    cancel: CancellationToken,
    tracker: ProgressTracker,
    file_id: String,
    /// Bytes this file already had on disk when the run started.
    file_initial: u64,
    /// Bytes written this run, across all segments of the file.
    file_bytes: Arc<AtomicU64>,
    retry: RetrySignal<R>,
}

/// Runs one segment to completion: stream, retry transient failures with
/// backoff, checkpoint the ledger. Hard failures and a Range-ignoring server
/// propagate to the caller immediately.
async fn segment_worker<R: Runtime>(ctx: SegmentCtx<R>) -> Result<(), SegmentFailure> {
    let seg_len = ctx.seg.end - ctx.seg.offset;
    let mut attempt: u32 = 0;
    loop {
        if ctx.cancel.is_cancelled() {
            return Err(SegmentFailure::transient("Download cancelled"));
        }
        if ctx.done.load(Ordering::Relaxed) >= seg_len {
            return Ok(());
        }
        match connect_and_stream(&ctx, seg_len).await {
            Ok(()) => return Ok(()),
            Err(SegmentFailure::RangeUnsupported) => return Err(SegmentFailure::RangeUnsupported),
            Err(SegmentFailure::Hard(e)) => return Err(SegmentFailure::Hard(e)),
            Err(f @ SegmentFailure::Transient(_)) => {
                attempt += 1;
                if attempt > SEGMENT_RETRIES {
                    return Err(f);
                }
                let wait = SEGMENT_BACKOFF_SECS[(attempt - 1) as usize];
                log::warn!(
                    "Segment [{}..{}] failed ({f}); retry {attempt}/{} in {wait}s",
                    ctx.seg.offset,
                    ctx.seg.end,
                    SEGMENT_RETRIES
                );
                persist_ledger(&ctx).await;
                // 告诉 UI 进入"重试中"(真实下载事件,而非前端猜测)
                ctx.retry.emit(attempt);
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(wait)) => {}
                    _ = ctx.cancel.cancelled() => {
                        return Err(SegmentFailure::transient("Download cancelled"));
                    }
                }
            }
        }
    }
}

/// Writes the shared ledger with every segment's current progress.
async fn persist_ledger<R: Runtime>(ctx: &SegmentCtx<R>) {
    let mut led = ctx.ledger.clone();
    for (s, d) in led.segments.iter_mut().zip(ctx.all_done.iter()) {
        s.done = d.load(Ordering::Relaxed).min(s.end - s.offset);
    }
    if let Err(e) = led.save(&ctx.meta_path).await {
        log::warn!("Failed to checkpoint the download ledger: {e}");
    }
}

/// One streaming pass over a segment. Returns Ok only when the segment is
/// complete; anything transient (network error, idle timeout, early close)
/// comes back as `Transient` and the worker retries from `done`.
async fn connect_and_stream<R: Runtime>(
    ctx: &SegmentCtx<R>,
    seg_len: u64,
) -> Result<(), SegmentFailure> {
    let done = ctx.done.load(Ordering::Relaxed);
    let range_start = ctx.seg.offset + done;
    if range_start >= ctx.seg.end {
        return Ok(());
    }

    // Jan's own mirror first (signed), then the original URL — the same
    // policy as the single-stream path. A fresh GET re-resolves 302s (e.g.
    // ModelScope's signed CDN link), so signature expiry never matters.
    let resp = if let Some(mirror) = convert_to_mirror_url(&ctx.url) {
        match range_get(ctx, &mirror, range_start, true).await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Jan mirror segment failed ({e}); falling back to the original URL");
                range_get(ctx, &ctx.url, range_start, false).await?
            }
        }
    } else {
        range_get(ctx, &ctx.url, range_start, false).await?
    };

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(&ctx.tmp)
        .await
        .map_err(SegmentFailure::transient)?;
    file.seek(SeekFrom::Start(range_start))
        .await
        .map_err(SegmentFailure::transient)?;
    let mut writer = BufWriter::new(file);
    let mut stream = resp.bytes_stream();

    let mut since_ledger = 0u64;
    let mut last_tracker = std::time::Instant::now();
    loop {
        if ctx.cancel.is_cancelled() {
            writer.flush().await.ok();
            return Err(SegmentFailure::transient("Download cancelled"));
        }
        let chunk = match tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(chunk))) => chunk,
            Ok(Some(Err(e))) => return Err(SegmentFailure::transient(e)),
            Ok(None) => {
                writer.flush().await.map_err(SegmentFailure::transient)?;
                if ctx.done.load(Ordering::Relaxed) >= seg_len {
                    return Ok(());
                }
                // The server hung up early; the next attempt continues from
                // where the ledger says we are.
                return Err(SegmentFailure::transient("connection closed early"));
            }
            Err(_) => {
                writer.flush().await.ok();
                return Err(SegmentFailure::transient(format!(
                    "no data for {}s",
                    IDLE_TIMEOUT.as_secs()
                )));
            }
        };
        writer
            .write_all(&chunk)
            .await
            .map_err(SegmentFailure::transient)?;
        let n = chunk.len() as u64;
        ctx.done.fetch_add(n, Ordering::Relaxed);
        ctx.file_bytes.fetch_add(n, Ordering::Relaxed);
        since_ledger += n;
        if since_ledger >= LEDGER_SAVE_INTERVAL {
            persist_ledger(ctx).await;
            since_ledger = 0;
        }
        // Tracker refreshes are time-driven, not byte-driven: a byte gate (5MB
        // per segment) lets the combined tracker go stale for seconds on slow
        // links, which the frontend speed watchdog then misreads as a stall.
        if last_tracker.elapsed() >= Duration::from_millis(500) {
            ctx.tracker
                .update_progress(
                    &ctx.file_id,
                    ctx.file_initial + ctx.file_bytes.load(Ordering::Relaxed),
                )
                .await;
            last_tracker = std::time::Instant::now();
        }
    }
}

/// One ranged GET with status-based classification. 206 passes; 200 means the
/// server ignored Range; 429/5xx are transient; 401/403/404 and the rest of
/// 4xx are hard failures. The optional Jan mirror carries HMAC headers.
async fn range_get<R: Runtime>(
    ctx: &SegmentCtx<R>,
    url: &str,
    range_start: u64,
    hmac: bool,
) -> Result<reqwest::Response, SegmentFailure> {
    let mut request = ctx.client.get(url).header(
        reqwest::header::RANGE,
        format!("bytes={range_start}-{}", ctx.seg.end - 1),
    );
    if hmac {
        let signed = SignedRequestHeaders::new(SECRET_KEY, &get_session_id(), get_app_version());
        for (key, value) in signed.to_header_pairs() {
            request = request.header(key, value);
        }
    }
    let resp = request.send().await.map_err(SegmentFailure::transient)?;
    let status = resp.status();
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        return Ok(resp);
    }
    Err(classify_status(status))
}

/// Single-connection download for small files, unknown lengths, and servers
/// that ignore Range. Keeps the legacy `.url` companion so an interrupted run
/// resumes on the next start, and retries transient failures with backoff.
#[allow(clippy::too_many_arguments)]
async fn single_stream_download<R: Runtime>(
    item: &DownloadItem,
    client: &reqwest::Client,
    tmp_save_path: &Path,
    url_save_path: &Path,
    resume: bool,
    file_size: u64,
    cancel_token: &CancellationToken,
    progress_tracker: &ProgressTracker,
    file_id: &str,
    retry: &RetrySignal<R>,
) -> Result<(), String> {
    // Legacy resume marker: the next start resumes only when the recorded URL
    // still matches the request.
    tokio::fs::write(url_save_path, &item.url)
        .await
        .map_err(err_to_string)?;

    let mut attempt: u32 = 0;
    let mut effective_resume = resume;
    loop {
        if cancel_token.is_cancelled() {
            return Err("Download cancelled".to_string());
        }
        match single_stream_attempt(
            item,
            client,
            tmp_save_path,
            url_save_path,
            effective_resume,
            file_size,
            cancel_token,
            progress_tracker,
            file_id,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(e) if is_cancellation_err(&e) => return Err(e),
            Err(e) => {
                attempt += 1;
                if attempt > SEGMENT_RETRIES {
                    return Err(e);
                }
                let wait = SEGMENT_BACKOFF_SECS[(attempt - 1) as usize];
                log::warn!(
                    "Single-stream download of {} failed ({e}); retry {attempt}/{} in {wait}s",
                    item.url,
                    SEGMENT_RETRIES
                );
                // 告诉 UI 进入"重试中"(真实下载事件,而非前端猜测)
                retry.emit(attempt);
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(wait)) => {}
                    _ = cancel_token.cancelled() => {
                        return Err("Download cancelled".to_string());
                    }
                }
                // The partial `.tmp` is exactly what the resume path wants.
                effective_resume = true;
            }
        }
    }
}

/// One single-stream pass, extracted from the historical
/// `download_single_file`: mirror fallback, `.tmp` append-or-create, and
/// per-10MB tracker updates. Progress events are emitted by the ticker.
#[allow(clippy::too_many_arguments)]
async fn single_stream_attempt(
    item: &DownloadItem,
    client: &reqwest::Client,
    tmp_save_path: &Path,
    url_save_path: &Path,
    resume: bool,
    file_size: u64,
    cancel_token: &CancellationToken,
    progress_tracker: &ProgressTracker,
    file_id: &str,
) -> Result<(), String> {
    let mut should_resume = resume
        && tokio::fs::metadata(tmp_save_path)
            .await
            .map(|m| m.len() > 0)
            .unwrap_or(false)
        && tokio::fs::read_to_string(url_save_path)
            .await
            .map(|u| u == item.url)
            .unwrap_or(false);

    // Tracker refreshes are time-driven (see connect_and_stream): a byte gate
    // stalls the UI speed display on slow links.
    let mut last_tracker = std::time::Instant::now();
    let mut initial_progress = 0u64;

    let (resp, actual_url) = if should_resume {
        let downloaded_size = tokio::fs::metadata(tmp_save_path)
            .await
            .map_err(err_to_string)?
            .len();
        match _get_maybe_resume(client, &item.url, downloaded_size).await {
            Ok(resp) => {
                log::info!(
                    "Resume download: {}, already downloaded {} bytes",
                    item.url,
                    downloaded_size
                );
                initial_progress = downloaded_size;

                // Initialize progress for resumed download
                progress_tracker
                    .update_progress(file_id, downloaded_size)
                    .await;

                (resp, item.url.clone())
            }
            Err(e) => {
                // fallback to normal download with proxy support
                log::warn!("Failed to resume download: {e}");
                should_resume = false;
                _get_maybe_resume_with_fallback(client, &item.url, 0).await?
            }
        }
    } else {
        // Use mirror fallback for new downloads
        _get_maybe_resume_with_fallback(client, &item.url, 0).await?
    };

    // Log which URL is being used for download
    if actual_url != item.url {
        log::info!("Downloading via Jan mirror: {}", actual_url);
    }

    // If HEAD gave us no size, refine the running total from the GET response
    // so the UI can progress past "Initializing" and show a real percentage.
    // Absolute set, not add: the retry loop re-runs this per attempt and an
    // add would inflate the total once per retry.
    if file_size == 0 {
        if let Some(content_length) = resp.content_length() {
            progress_tracker.set_total(initial_progress + content_length);
        }
    }

    let mut stream = resp.bytes_stream();

    let file = if should_resume {
        // resume download, append to existing file
        tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(tmp_save_path)
            .await
            .map_err(err_to_string)?
    } else {
        // start new download, create a new file
        File::create(tmp_save_path).await.map_err(err_to_string)?
    };
    let mut writer = tokio::io::BufWriter::new(file);
    let mut total_transferred = initial_progress;

    // write chunk to file — with the same idle timeout as the segmented path:
    // a dead connection must not hang the stream forever (断网挂死不重试).
    loop {
        if cancel_token.is_cancelled() {
            // Keep the partial .tmp on disk so the download can be resumed;
            // a true cancel deletes it in the download_files command.
            writer.flush().await.ok();
            log::info!("Download cancelled: {}", item.url);
            return Err("Download cancelled".to_string());
        }

        let chunk = match tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
            Ok(Some(chunk)) => chunk.map_err(err_to_string)?,
            Ok(None) => {
                writer.flush().await.ok();
                return Err("connection closed early".to_string());
            }
            Err(_) => {
                writer.flush().await.ok();
                return Err(format!(
                    "no data for {}s — connection presumed dead",
                    IDLE_TIMEOUT.as_secs()
                ));
            }
        };

        writer.write_all(&chunk).await.map_err(err_to_string)?;
        total_transferred += chunk.len() as u64;

        // Update tracker (and thus the ticker) at most twice a second
        if last_tracker.elapsed() >= Duration::from_millis(500) {
            progress_tracker
                .update_progress(file_id, total_transferred)
                .await;
            last_tracker = std::time::Instant::now();
        }
    }

    writer.flush().await.map_err(err_to_string)?;

    // Final progress update for this file
    progress_tracker
        .update_progress(file_id, total_transferred)
        .await;

    log::info!("Finished streaming: {}", item.url);
    Ok(())
}

// ===== HTTP CLIENT HELPER FUNCTIONS =====

/// Attempts to download from mirror URL first, falls back to original URL if mirror fails
/// When using mirror URL, adds HMAC headers for request authentication
pub async fn _get_maybe_resume_with_fallback(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
) -> Result<(reqwest::Response, String), String> {
    // Try mirror URL first if applicable
    if let Some(mirror_url) = convert_to_mirror_url(url) {
        log::info!("Attempting download from Jan mirror: {}", mirror_url);
        match _get_maybe_resume_with_hmac(client, &mirror_url, start_bytes).await {
            Ok(resp) => {
                log::info!("Successfully connected to Jan mirror");
                return Ok((resp, mirror_url));
            }
            Err(e) => {
                log::warn!(
                    "Jan mirror download failed: {}. Falling back to original URL...",
                    e
                );
            }
        }
    }

    // Fallback to original URL (no HMAC headers needed)
    log::info!("Downloading from original URL: {}", url);
    let resp = _get_maybe_resume_internal(client, url, start_bytes).await?;
    Ok((resp, url.to_string()))
}

/// Download from URL with HMAC headers for Jan mirror authentication
async fn _get_maybe_resume_with_hmac(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
) -> Result<reqwest::Response, String> {
    // Generate HMAC headers for request authentication
    let nonce_seed = get_download_nonce_seed();
    let app_version = get_app_version();
    let signed_headers = SignedRequestHeaders::new(SECRET_KEY, &nonce_seed, app_version);

    let mut request = if start_bytes > 0 {
        client
            .get(url)
            .header("Range", format!("bytes={start_bytes}-"))
    } else {
        client.get(url)
    };

    // Add HMAC headers
    for (key, value) in signed_headers.to_header_pairs() {
        request = request.header(key, value);
    }

    let resp = request.send().await.map_err(err_to_string)?;

    if start_bytes > 0 {
        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "Failed to resume download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
    } else if !resp.status().is_success() {
        return Err(format!(
            "Failed to download: HTTP status {}, {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }

    Ok(resp)
}

/// Internal function to attempt download from a single URL (without HMAC)
async fn _get_maybe_resume_internal(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
) -> Result<reqwest::Response, String> {
    if start_bytes > 0 {
        let resp = client
            .get(url)
            .header("Range", format!("bytes={start_bytes}-"))
            .send()
            .await
            .map_err(err_to_string)?;
        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "Failed to resume download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    } else {
        let resp = client.get(url).send().await.map_err(err_to_string)?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    }
}

pub async fn _get_maybe_resume(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
) -> Result<reqwest::Response, String> {
    if start_bytes > 0 {
        let resp = client
            .get(url)
            .header("Range", format!("bytes={start_bytes}-"))
            .send()
            .await
            .map_err(err_to_string)?;
        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "Failed to resume download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    } else {
        let resp = client.get(url).send().await.map_err(err_to_string)?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    }
}
