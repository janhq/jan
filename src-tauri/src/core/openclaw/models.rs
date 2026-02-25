use serde::{Deserialize, Serialize};

use super::constants;

/// OpenClaw configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawConfig {
    /// Gateway configuration
    pub gateway: GatewayConfig,
    /// Model providers configuration
    pub models: ModelsConfig,
    /// Agents configuration
    pub agents: AgentsConfig,
}

impl Default for OpenClawConfig {
    fn default() -> Self {
        Self {
            gateway: GatewayConfig::default(),
            models: ModelsConfig::default(),
            agents: AgentsConfig::default(),
        }
    }
}

/// Gateway configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    /// Bind address (loopback or 0.0.0.0)
    pub bind: String,
    /// Port number
    pub port: u16,
    /// Authentication configuration
    pub auth: AuthConfig,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            bind: "loopback".to_string(),
            port: super::OPENCLAW_PORT,
            auth: AuthConfig::default(),
        }
    }
}

/// Authentication configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// Authentication mode (token, etc.)
    pub mode: String,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            mode: "token".to_string(),
        }
    }
}

/// Models configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsConfig {
    /// Provider configurations
    pub providers: ProvidersConfig,
}

impl Default for ModelsConfig {
    fn default() -> Self {
        Self {
            providers: ProvidersConfig::default(),
        }
    }
}

/// Providers configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvidersConfig {
    /// Jan provider configuration
    #[serde(rename = "jan")]
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
    /// Base URL for Jan API
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    /// API type (openai-completions, etc.)
    pub api: String,
    /// List of models to use (or ["*"] for all)
    pub models: Vec<String>,
}

impl Default for JanProviderConfig {
    fn default() -> Self {
        Self {
            base_url: constants::DEFAULT_JAN_BASE_URL.to_string(),
            api: constants::DEFAULT_JAN_API_TYPE.to_string(),
            models: vec!["*".to_string()],
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
    /// Default model configuration
    pub model: ModelConfig,
    /// Default system prompt
    #[serde(rename = "systemPrompt")]
    pub system_prompt: String,
}

impl Default for AgentDefaults {
    fn default() -> Self {
        Self {
            model: ModelConfig::default(),
            system_prompt: constants::DEFAULT_SYSTEM_PROMPT.to_string(),
        }
    }
}

/// Model configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// Primary model ID
    pub primary: String,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            primary: constants::DEFAULT_MODEL_ID.to_string(),
        }
    }
}

/// OpenClaw status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawStatus {
    /// Whether OpenClaw is installed
    pub installed: bool,
    /// Whether the gateway is running
    pub running: bool,
    /// Node.js version (if installed)
    pub node_version: Option<String>,
    /// Installed OpenClaw version (if installed)
    pub openclaw_version: Option<String>,
    /// Port status (available or in use)
    pub port_available: bool,
    /// Error message (if any)
    pub error: Option<String>,
}

/// Node.js check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCheckResult {
    /// Whether Node.js is installed
    pub installed: bool,
    /// Node.js version (if installed)
    pub version: Option<String>,
    /// Major version number
    pub major_version: Option<u32>,
    /// Whether the version meets minimum requirements (22+)
    pub meets_requirements: bool,
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

/// Custom configuration input for OpenClaw
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawConfigInput {
    /// Optional custom Jan base URL
    #[serde(rename = "janBaseUrl")]
    pub jan_base_url: Option<String>,
    /// Optional custom model ID
    #[serde(rename = "modelId")]
    pub model_id: Option<String>,
    /// Optional custom system prompt
    #[serde(rename = "systemPrompt")]
    pub system_prompt: Option<String>,
    /// Optional custom port
    pub port: Option<u16>,
    /// Optional bind address
    pub bind: Option<String>,
}

// ============================================
// Tailscale Integration Models
// ============================================

/// Tailscale installation and connection status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleStatus {
    /// Whether Tailscale is installed on the system
    pub installed: bool,
    /// Whether Tailscale daemon is running
    pub running: bool,
    /// Whether user is logged in to Tailscale
    pub logged_in: bool,
    /// Tailscale version (if installed)
    pub version: Option<String>,
    /// Error message (if any)
    pub error: Option<String>,
}

impl Default for TailscaleStatus {
    fn default() -> Self {
        Self {
            installed: false,
            running: false,
            logged_in: false,
            version: None,
            error: None,
        }
    }
}

/// Tailscale network information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleInfo {
    /// Machine hostname in the tailnet
    pub hostname: Option<String>,
    /// Name of the tailnet
    pub tailnet: Option<String>,
    /// Tailscale IP addresses assigned to this machine
    pub ip_addresses: Vec<String>,
    /// DNS name for this machine in the tailnet
    pub dns_name: Option<String>,
    /// Whether Tailscale Serve is enabled
    pub serve_enabled: bool,
    /// Whether Tailscale Funnel is enabled
    pub funnel_enabled: bool,
    /// URL for accessing via Tailscale Serve/Funnel
    pub serve_url: Option<String>,
}

impl Default for TailscaleInfo {
    fn default() -> Self {
        Self {
            hostname: None,
            tailnet: None,
            ip_addresses: Vec::new(),
            dns_name: None,
            serve_enabled: false,
            funnel_enabled: false,
            serve_url: None,
        }
    }
}

// ============================================
// Tunnel Provider Models
// ============================================

/// Available tunnel providers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TunnelProvider {
    #[default]
    None,
    Tailscale,
    Ngrok,
    Cloudflare,
    LocalOnly,
}

/// Status of a tunnel provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelProviderStatus {
    /// The tunnel provider type
    pub provider: TunnelProvider,
    /// Whether the provider CLI is installed
    pub installed: bool,
    /// Whether the provider is authenticated
    pub authenticated: bool,
    /// Version of the installed CLI (if available)
    pub version: Option<String>,
    /// Error message if detection failed
    pub error: Option<String>,
}

impl Default for TunnelProviderStatus {
    fn default() -> Self {
        Self {
            provider: TunnelProvider::None,
            installed: false,
            authenticated: false,
            version: None,
            error: None,
        }
    }
}

/// Status of all tunnel providers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelProvidersStatus {
    /// Tailscale status
    pub tailscale: TunnelProviderStatus,
    /// ngrok status
    pub ngrok: TunnelProviderStatus,
    /// Cloudflare (cloudflared) status
    pub cloudflare: TunnelProviderStatus,
    /// Currently active/preferred provider
    pub active_provider: TunnelProvider,
    /// Currently active tunnel information (if any)
    pub active_tunnel: Option<TunnelInfo>,
}

impl Default for TunnelProvidersStatus {
    fn default() -> Self {
        Self {
            tailscale: TunnelProviderStatus {
                provider: TunnelProvider::Tailscale,
                ..Default::default()
            },
            ngrok: TunnelProviderStatus {
                provider: TunnelProvider::Ngrok,
                ..Default::default()
            },
            cloudflare: TunnelProviderStatus {
                provider: TunnelProvider::Cloudflare,
                ..Default::default()
            },
            active_provider: TunnelProvider::None,
            active_tunnel: None,
        }
    }
}

/// Active tunnel information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelInfo {
    /// The tunnel provider being used
    pub provider: TunnelProvider,
    /// Public URL for the tunnel
    pub url: String,
    /// ISO 8601 timestamp when tunnel started
    pub started_at: String,
    /// Local port being tunneled
    pub port: u16,
    /// Whether the tunnel is publicly accessible
    pub is_public: bool,
}

/// Tunnel configuration stored in config file
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TunnelConfig {
    /// Preferred tunnel provider
    pub preferred_provider: TunnelProvider,
    /// ngrok authentication token
    pub ngrok_auth_token: Option<String>,
    /// Cloudflare tunnel ID
    pub cloudflare_tunnel_id: Option<String>,
    /// Whether to auto-start tunnel when OpenClaw starts
    pub auto_start: bool,
}

// ============================================
// Security Configuration Models
// ============================================

/// Authentication mode for the gateway
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    #[default]
    Token,
    Password,
    None,
}

/// Security configuration for OpenClaw gateway
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    /// Authentication mode (token, password, or none)
    pub auth_mode: AuthMode,
    /// Hashed access token (if auth_mode is Token)
    pub token_hash: Option<String>,
    /// Hashed password (if auth_mode is Password)
    pub password_hash: Option<String>,
    /// Whether device pairing is required
    pub require_pairing: bool,
    /// List of approved devices
    pub approved_devices: Vec<DeviceInfo>,
    /// Maximum authentication attempts before rate limiting
    pub rate_limit_attempts: u32,
    /// Time window for rate limiting in seconds
    pub rate_limit_window_secs: u32,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            auth_mode: AuthMode::Token,
            token_hash: None,
            password_hash: None,
            require_pairing: true,
            approved_devices: vec![],
            rate_limit_attempts: 5,
            rate_limit_window_secs: 300,
        }
    }
}

/// Approved device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    /// Unique device identifier
    pub id: String,
    /// Human-readable device name
    pub name: String,
    /// Communication channel (telegram, whatsapp, discord)
    pub channel: String,
    /// User ID on the channel
    pub user_id: String,
    /// ISO 8601 timestamp when device was approved
    pub approved_at: String,
    /// ISO 8601 timestamp of last access (if any)
    pub last_access: Option<String>,
}

/// Access log entry for security auditing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLogEntry {
    /// ISO 8601 timestamp of the event
    pub timestamp: String,
    /// Device ID (if known)
    pub device_id: Option<String>,
    /// Communication channel
    pub channel: String,
    /// User ID on the channel
    pub user_id: String,
    /// Action performed (message, pairing, auth_success, auth_fail)
    pub action: String,
    /// IP address (if available)
    pub ip_address: Option<String>,
    /// Whether the action was successful
    pub success: bool,
    /// Error message (if any)
    pub error: Option<String>,
}

/// Security status response for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityStatus {
    /// Current authentication mode
    pub auth_mode: AuthMode,
    /// Whether an access token has been configured
    pub has_token: bool,
    /// Whether a password has been configured
    pub has_password: bool,
    /// Whether device pairing is required
    pub require_pairing: bool,
    /// Number of approved devices
    pub approved_device_count: u32,
    /// Number of recent authentication failures
    pub recent_auth_failures: u32,
}