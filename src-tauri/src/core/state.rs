use std::{collections::HashMap, sync::Arc};

use crate::core::{downloads::models::DownloadManagerState, mcp::models::McpSettings};
use rmcp::{
    model::{CallToolRequestParam, CallToolResult, InitializeRequestParam, Tool},
    service::RunningService,
    RoleClient, ServiceError,
};
use tokio::sync::{oneshot, Mutex};

/// Server handle type for managing the proxy server lifecycle
pub type ServerHandle =
    tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>;

/// Provider configuration for remote model providers
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
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

#[derive(Default)]
pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: SharedMcpServers,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub mcp_shutdown_in_progress: Arc<Mutex<bool>>,
    pub mcp_monitoring_tasks: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub mcp_server_pids: Arc<Mutex<HashMap<String, u32>>>,
    /// Remote provider configurations (e.g., Anthropic, OpenAI, etc.)
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
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
