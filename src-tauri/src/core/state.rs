use std::{collections::HashMap, sync::Arc};

use crate::core::download::DownloadManagerState;
use rmcp::{service::RunningService, RoleClient};
use tokio::task::JoinHandle;

/// Server handle type for managing the proxy server lifecycle
pub type ServerHandle = JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>;
use tauri_plugin_llamacpp::LLamaBackendSession;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_restart_counts: Arc<Mutex<HashMap<String, u32>>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub mcp_successfully_connected: Arc<Mutex<HashMap<String, bool>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub llama_server_process: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
}
