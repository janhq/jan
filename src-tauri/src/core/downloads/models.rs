use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify, Semaphore};
use tokio_util::sync::CancellationToken;

/// 全局下载任务并发上限:最多同时执行 2 个下载任务(分段任务各占 4 条连接),
/// 超出的任务在 download_files 入口排队等待空位(排队期间可取消/暂停)。
pub const MAX_CONCURRENT_DOWNLOAD_TASKS: usize = 2;

#[derive(Clone)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, CancellationToken>,
    // Paused tasks keep their partial .tmp/.url instead of being deleted on cancel.
    pub paused_tasks: HashSet<String>,
    // 任务完成信号:取消/暂停后等待任务真正收尾(子进程退出、句柄释放),
    // 避免前端随即删目录/恢复时撞上文件锁(os error 32)。
    pub task_done: HashMap<String, Arc<Notify>>,
    // 并发槽位信号量,见 MAX_CONCURRENT_DOWNLOAD_TASKS。
    pub download_slots: Arc<Semaphore>,
}

impl Default for DownloadManagerState {
    fn default() -> Self {
        Self {
            cancel_tokens: HashMap::new(),
            paused_tasks: HashSet::new(),
            task_done: HashMap::new(),
            download_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOAD_TASKS)),
        }
    }
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct ProxyConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub no_proxy: Option<Vec<String>>, // List of domains to bypass proxy
    pub ignore_ssl: Option<bool>,      // Ignore SSL certificate verification
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct DownloadItem {
    pub url: String,
    pub save_path: String,
    pub proxy: Option<ProxyConfig>,
    pub sha256: Option<String>,
    pub size: Option<u64>,
    pub model_id: Option<String>,
}

/// One contiguous chunk of a segmented download: `[offset, end)`, with `done`
/// bytes already on disk — the next byte to fetch is `offset + done`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SegmentState {
    pub offset: u64,
    pub end: u64,
    pub done: u64,
}

/// The resume ledger of a segmented download, written beside the `.tmp` file.
/// It is the source of truth for progress: the file itself is preallocated to
/// `total_size`, so its length says nothing about how much is actually there.
/// A crash loses at most the bytes written since the last ledger checkpoint.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DownloadLedger {
    pub url: String,
    pub total_size: u64,
    pub segments: Vec<SegmentState>,
}

impl DownloadLedger {
    /// Bytes of this file already on disk across every segment.
    pub fn done_total(&self) -> u64 {
        self.segments.iter().map(|s| s.done).sum()
    }

    pub async fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let json = serde_json::to_string(self).map_err(|e| format!("Error: {e}"))?;
        tokio::fs::write(path, json)
            .await
            .map_err(|e| format!("Error: {e}"))
    }

    /// Loads a ledger; `None` when absent or corrupt (both mean "fresh start").
    pub async fn load(path: &std::path::Path) -> Option<Self> {
        let raw = tokio::fs::read_to_string(path).await.ok()?;
        serde_json::from_str(&raw).ok()
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub transferred: u64,
    pub total: u64,
}

/// Structure to track progress for each file in parallel downloads
#[derive(Clone)]
pub struct ProgressTracker {
    file_progress: Arc<Mutex<HashMap<String, u64>>>,
    total_size: Arc<AtomicU64>,
}

impl ProgressTracker {
    pub fn new(_items: &[DownloadItem], sizes: HashMap<String, u64>) -> Self {
        let total_size: u64 = sizes.values().sum();
        ProgressTracker {
            file_progress: Arc::new(Mutex::new(HashMap::new())),
            total_size: Arc::new(AtomicU64::new(total_size)),
        }
    }

    pub async fn update_progress(&self, file_id: &str, transferred: u64) {
        let mut progress = self.file_progress.lock().await;
        progress.insert(file_id.to_string(), transferred);
    }

    /// Add `additional` bytes to the running total. Used when the true size is
    /// only known after the GET response (HEAD may have reported 0 or been
    /// blocked).
    pub fn add_to_total(&self, additional: u64) {
        self.total_size.fetch_add(additional, Ordering::Relaxed);
    }

    /// Sets the absolute total. Preferred over `add_to_total` at retry points:
    /// adding would inflate the total once per attempt, shrinking the displayed
    /// percentage every time a download restarts.
    pub fn set_total(&self, total: u64) {
        self.total_size.store(total, Ordering::Relaxed);
    }

    pub async fn get_total_progress(&self) -> (u64, u64) {
        let progress = self.file_progress.lock().await;
        let total_transferred: u64 = progress.values().sum();
        (total_transferred, self.total_size.load(Ordering::Relaxed))
    }
}
