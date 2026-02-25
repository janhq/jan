use serde::{Deserialize, Serialize};

use super::constants;

/// PicoClaw configuration structure
/// Matches the config.json format used by PicoClaw
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PicoClawConfig {
    /// Agents configuration
    pub agents: AgentsConfig,
    /// LLM providers configuration
    pub providers: ProvidersConfig,
    /// Channels configuration
    #[serde(default)]
    pub channels: ChannelsConfig,
    /// Tools configuration
    #[serde(default)]
    pub tools: ToolsConfig,
    /// Gateway configuration
    #[serde(default)]
    pub gateway: GatewayConfig,
}

impl Default for PicoClawConfig {
    fn default() -> Self {
        Self {
            agents: AgentsConfig::default(),
            providers: ProvidersConfig::default(),
            channels: ChannelsConfig::default(),
            tools: ToolsConfig::default(),
            gateway: GatewayConfig::default(),
        }
    }
}

/// Agents configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentsConfig {
    /// Default agent settings
    pub defaults: AgentDefaults,
}

impl Default for AgentsConfig {
    fn default() -> Self {
        Self {
            defaults: AgentDefaults::default(),
        }
    }
}

/// Default agent settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefaults {
    /// Workspace directory
    pub workspace: String,
    /// Default model ID (format: provider/model)
    pub model: String,
    /// Maximum tokens for responses
    pub max_tokens: u32,
    /// Temperature for generation
    pub temperature: f32,
    /// Maximum tool iterations
    pub max_tool_iterations: u32,
}

impl Default for AgentDefaults {
    fn default() -> Self {
        Self {
            workspace: "~/.picoclaw/workspace".to_string(),
            model: format!("jan/{}", constants::DEFAULT_MODEL_ID),
            max_tokens: 8192,
            temperature: 0.7,
            max_tool_iterations: 20,
        }
    }
}

/// Providers configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvidersConfig {
    /// Jan provider configuration (Ollama-compatible)
    #[serde(default)]
    pub jan: JanProviderConfig,
}

impl Default for ProvidersConfig {
    fn default() -> Self {
        Self {
            jan: JanProviderConfig::default(),
        }
    }
}

/// Jan provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JanProviderConfig {
    /// API base URL
    pub api_base: String,
    /// API key (empty for local Jan)
    #[serde(default)]
    pub api_key: String,
}

impl Default for JanProviderConfig {
    fn default() -> Self {
        Self {
            api_base: constants::DEFAULT_JAN_BASE_URL.to_string(),
            api_key: String::new(),
        }
    }
}

/// Channels configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelsConfig {
    /// Telegram channel configuration
    #[serde(default)]
    pub telegram: Option<TelegramChannelConfig>,
    /// Discord channel configuration
    #[serde(default)]
    pub discord: Option<DiscordChannelConfig>,
}

/// Telegram channel configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramChannelConfig {
    /// Whether the channel is enabled
    pub enabled: bool,
    /// Bot token
    pub token: String,
    /// Allowed user IDs
    #[serde(default)]
    pub allow_from: Vec<String>,
}

/// Discord channel configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordChannelConfig {
    /// Whether the channel is enabled
    pub enabled: bool,
    /// Bot token
    pub token: String,
    /// Allowed user IDs
    #[serde(default)]
    pub allow_from: Vec<String>,
    /// Whether to only respond to mentions
    #[serde(default)]
    pub mention_only: bool,
}

/// Tools configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolsConfig {
    /// Web search tools configuration
    #[serde(default)]
    pub web: Option<WebToolsConfig>,
}

/// Web search tools configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebToolsConfig {
    /// DuckDuckGo configuration
    #[serde(default)]
    pub duckduckgo: Option<DuckDuckGoConfig>,
}

/// DuckDuckGo search configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuckDuckGoConfig {
    /// Whether enabled
    pub enabled: bool,
    /// Maximum results
    pub max_results: u32,
}

impl Default for DuckDuckGoConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_results: 5,
        }
    }
}

/// Gateway configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    /// Host to bind to
    pub host: String,
    /// Port to listen on
    pub port: u16,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: constants::DEFAULT_PICOCLAW_PORT,
        }
    }
}

/// PicoClaw status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PicoClawStatus {
    /// Whether PicoClaw binary is installed
    pub installed: bool,
    /// Whether the gateway is running
    pub running: bool,
    /// Installed PicoClaw version (if installed)
    pub version: Option<String>,
    /// Binary path (if installed)
    pub binary_path: Option<String>,
    /// Port status (available or in use)
    pub port_available: bool,
    /// Error message (if any)
    pub error: Option<String>,
}

/// Installation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    /// Whether installation was successful
    pub success: bool,
    /// Installed version (if successful)
    pub version: Option<String>,
    /// Binary path (if successful)
    pub binary_path: Option<String>,
    /// Error message (if failed)
    pub error: Option<String>,
}

/// Port check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortCheckResult {
    /// Whether the port is available
    pub available: bool,
    /// The port number checked
    pub port: u16,
    /// Error message (if any)
    pub error: Option<String>,
}

/// Download progress event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Current bytes downloaded
    pub downloaded: u64,
    /// Total bytes to download
    pub total: u64,
    /// Progress percentage (0-100)
    pub percentage: u8,
}

/// Custom configuration input for PicoClaw
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PicoClawConfigInput {
    /// Optional custom Jan base URL
    #[serde(rename = "janBaseUrl")]
    pub jan_base_url: Option<String>,
    /// Optional custom model ID
    #[serde(rename = "modelId")]
    pub model_id: Option<String>,
    /// Optional custom port
    pub port: Option<u16>,
    /// Optional bind host
    pub host: Option<String>,
}

/// Remote access backend type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RemoteAccessBackend {
    /// OpenClaw (full-featured, Node.js based)
    OpenClaw,
    /// PicoClaw (lightweight, Go binary)
    PicoClaw,
}

impl Default for RemoteAccessBackend {
    fn default() -> Self {
        Self::PicoClaw // Default to lightweight option
    }
}

/// Unified remote access status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAccessStatus {
    /// Which backend is active
    pub backend: RemoteAccessBackend,
    /// Whether the backend is installed
    pub installed: bool,
    /// Whether the gateway is running
    pub running: bool,
    /// Version string
    pub version: Option<String>,
    /// Connected channels
    pub channels: Vec<String>,
    /// Error message (if any)
    pub error: Option<String>,
}
