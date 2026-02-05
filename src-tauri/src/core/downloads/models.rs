use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, CancellationToken>,
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

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub transferred: u64,
    pub total: u64,
}

/// Structure to track progress for each file in parallel downloads
#[derive(Clone)]
pub struct ProgressTracker {
    file_progress: Arc<Mutex<HashMap<String, u64>>>,
    total_size: u64,
}

impl ProgressTracker {
    pub fn new(_items: &[DownloadItem], sizes: HashMap<String, u64>) -> Self {
        let total_size = sizes.values().sum();
        ProgressTracker {
            file_progress: Arc::new(Mutex::new(HashMap::new())),
            total_size,
        }
    }

    pub async fn update_progress(&self, file_id: &str, transferred: u64) {
        let mut progress = self.file_progress.lock().await;
        progress.insert(file_id.to_string(), transferred);
    }

    pub async fn get_total_progress(&self) -> (u64, u64) {
        let progress = self.file_progress.lock().await;
        let total_transferred: u64 = progress.values().sum();
        (total_transferred, self.total_size)
    }
}
