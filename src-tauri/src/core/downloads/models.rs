use std::collections::HashMap;
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
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub transferred: u64,
    pub total: u64,
}
