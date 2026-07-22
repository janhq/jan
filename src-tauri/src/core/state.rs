use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use crate::core::{
    downloads::models::DownloadManagerState,
    mcp::models::{McpSettings, ToolWithServer},
};
use rmcp::{
    model::{CallToolRequestParam, CallToolResult, InitializeRequestParam, Tool},
    service::RunningService,
    RoleClient, ServiceError,
};
use tokio::sync::{oneshot, Mutex, Notify};

/// Server handle type for managing the proxy server lifecycle
pub type ServerHandle =
    tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>;

/// Provider configuration for remote model providers
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    /// First key (mirrors `api_keys[0]` when populated); kept for backward compatibility.
    pub api_key: Option<String>,
    /// Ordered keys for Bearer auth: proxy tries each on 401/403/429.
    #[serde(default)]
    pub api_keys: Vec<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
    /// Upstream wire API this provider speaks. `None`/`"openai"` = OpenAI
    /// chat/completions (verbatim passthrough). Other values select a
    /// translating converter (e.g. `"openai-responses"`, `"google"`,
    /// `"anthropic"`) so the proxy can accept OpenAI-shaped requests and talk
    /// the provider's native API.
    #[serde(default)]
    pub api_type: Option<String>,
}

impl ProviderConfig {
    pub fn bearer_key_chain(&self) -> Vec<String> {
        if !self.api_keys.is_empty() {
            return self.api_keys.clone();
        }
        self.api_key.clone().into_iter().collect()
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

pub enum RunningServiceEnum {
    NoInit(RunningService<RoleClient, ()>),
    WithInit(RunningService<RoleClient, InitializeRequestParam>),
}
pub type SharedMcpServers = Arc<Mutex<HashMap<String, RunningServiceEnum>>>;

pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: SharedMcpServers,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub mcp_shutdown_in_progress: Arc<Mutex<bool>>,
    pub mcp_monitoring_tasks: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    /// Names of MCP servers whose initial start is currently in flight. Guards
    /// against a server being `serve()`'d twice (e.g. boot startup racing a
    /// frontend activation), which sends duplicate `initialize` requests.
    pub mcp_starting: Arc<Mutex<HashSet<String>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub mcp_server_pids: Arc<Mutex<HashMap<String, u32>>>,
    /// Remote provider configurations (e.g., Anthropic, OpenAI, etc.)
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    /// Per-model sampling defaults the API server injects when the caller omits
    /// them (MLX path; llamacpp uses the router preset instead). Keyed by model
    /// id; values are objects already in the target's request-body key form.
    pub model_param_defaults: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    /// Wakes up MCP monitors to trigger an immediate health check + reconnect
    pub mcp_reconnect_notify: Arc<Notify>,
    /// Last successful tool listing per enabled server, served when a server
    /// is transiently disconnected so its schema stays present and stable in
    /// the prompt instead of disappearing/reappearing across reconnects.
    /// Cleared only on explicit user deactivation, never on a transient
    /// list-tools failure.
    pub mcp_last_known_tools: Arc<Mutex<HashMap<String, Vec<ToolWithServer>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            app_token: None,
            mcp_servers: Default::default(),
            download_manager: Default::default(),
            mcp_active_servers: Default::default(),
            server_handle: Default::default(),
            tool_call_cancellations: Default::default(),
            mcp_settings: Default::default(),
            mcp_shutdown_in_progress: Default::default(),
            mcp_monitoring_tasks: Default::default(),
            mcp_starting: Default::default(),
            background_cleanup_handle: Default::default(),
            mcp_server_pids: Default::default(),
            provider_configs: Default::default(),
            model_param_defaults: Default::default(),
            mcp_reconnect_notify: Arc::new(Notify::new()),
            mcp_last_known_tools: Default::default(),
        }
    }
}

impl RunningServiceEnum {
    pub async fn list_all_tools(&self) -> Result<Vec<Tool>, ServiceError> {
        match self {
            Self::NoInit(s) => s.list_all_tools().await,
            Self::WithInit(s) => s.list_all_tools().await,
        }
    }
    pub async fn call_tool(
        &self,
        params: CallToolRequestParam,
    ) -> Result<CallToolResult, ServiceError> {
        match self {
            Self::NoInit(s) => s.call_tool(params).await,
            Self::WithInit(s) => s.call_tool(params).await,
        }
    }
}
