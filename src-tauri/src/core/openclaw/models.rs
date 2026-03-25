use serde::{Deserialize, Serialize};

use super::constants;

// ============================================
// Jan Gateway Settings (persisted in Tauri Store)
// ============================================

/// How Jan connects to the OpenClaw gateway.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum JanGatewayMode {
    /// Run the bundled OpenClaw instance locally (default).
    #[default]
    Embedded,
    /// Connect to a user-provided remote OpenClaw gateway.
    Remote,
}

/// Jan-side settings for gateway connectivity.
/// Persisted in the Tauri Store, NOT in ~/.openclaw/openclaw.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JanGatewaySettings {
    pub mode: JanGatewayMode,
    /// URL of the remote gateway (e.g. "https://my-openclaw.example.com").
    /// Only used when mode == Remote.
    pub remote_url: Option<String>,
    /// Auth token for the remote gateway.
    /// Only used when mode == Remote.
    pub remote_token: Option<String>,
}

impl Default for JanGatewaySettings {
    fn default() -> Self {
        Self {
            mode: JanGatewayMode::Embedded,
            remote_url: None,
            remote_token: None,
        }
    }
}

/// OpenClaw configuration structure
/// Only includes keys that OpenClaw actually recognizes.
/// Unknown keys (like agents.defaults.systemPrompt) cause OpenClaw to reject the config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawConfig {
    /// Gateway configuration
    pub gateway: GatewayConfig,
    /// Model providers configuration
    pub models: ModelsConfig,
}

impl Default for OpenClawConfig {
    fn default() -> Self {
        Self {
            gateway: GatewayConfig::default(),
            models: ModelsConfig::default(),
        }
    }
}

/// Gateway configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    /// Gateway mode: "local" (run server here) or "remote" (connect to remote)
    pub mode: String,
    /// Bind address (loopback or 0.0.0.0)
    pub bind: String,
    /// Port number
    pub port: u16,
    /// Authentication configuration
    pub auth: AuthConfig,
    /// Control UI configuration (for WebSocket origin validation)
    #[serde(rename = "controlUi", skip_serializing_if = "Option::is_none")]
    pub control_ui: Option<ControlUiConfig>,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            mode: "local".to_string(),
            bind: "lan".to_string(),
            port: super::OPENCLAW_PORT,
            auth: AuthConfig::default(),
            control_ui: Some(ControlUiConfig::default()),
        }
    }
}

/// Control UI configuration for the Gateway
/// This controls WebSocket origin validation for security
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlUiConfig {
    /// Allowed origins for WebSocket connections
    /// Required for non-loopback connections (e.g., from Tauri apps)
    #[serde(rename = "allowedOrigins")]
    pub allowed_origins: Vec<String>,
}

impl Default for ControlUiConfig {
    fn default() -> Self {
        Self {
            // Allow connections from Tauri app and local development
            allowed_origins: vec![
                "tauri://localhost".to_string(),
                "http://tauri.localhost".to_string(),
                "http://localhost".to_string(),
                "http://localhost:1420".to_string(), // Tauri dev server
                "http://127.0.0.1".to_string(),
            ],
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

/// A single model definition for OpenClaw's provider config.
/// Only `id` and `name` are required by OpenClaw's Zod schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDefinition {
    /// Model identifier (plain name, no provider prefix)
    pub id: String,
    /// Human-readable display name
    pub name: String,
    /// Context window size in tokens
    #[serde(rename = "contextWindow", skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    /// Maximum output tokens
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

/// Jan provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JanProviderConfig {
    /// Base URL for Jan API
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    /// API type (openai-completions, etc.)
    pub api: String,
    /// API key for authentication.
    /// For local models this is a placeholder (Jan doesn't require auth).
    /// For remote providers routed through Jan, this carries the real key.
    #[serde(rename = "apiKey")]
    pub api_key: String,
    /// List of model definitions (objects with at least { id, name })
    pub models: Vec<ModelDefinition>,
}

impl Default for JanProviderConfig {
    fn default() -> Self {
        Self {
            base_url: constants::DEFAULT_JAN_BASE_URL.to_string(),
            api: constants::DEFAULT_JAN_API_TYPE.to_string(),
            api_key: constants::DEFAULT_JAN_API_KEY.to_string(),
            // Start with the pinned default model; openclaw_sync_all_models
            // replaces this list with the full catalog from Jan.
            models: vec![ModelDefinition {
                id: constants::DEFAULT_MODEL_ID.to_string(),
                name: constants::DEFAULT_MODEL_ID.to_string(),
                context_window: Some(128000),
                max_tokens: Some(4096),
            }],
        }
    }
}

// NOTE: OpenClaw uses strict Zod validation on its config — unknown keys
// cause the gateway to refuse to start. The `agents.defaults` section accepts
// known keys like `model` (object: {primary, fallbacks}), `maxConcurrent`,
// `subagents`, `compaction`, `workspace`, etc. Custom keys like `systemPrompt`
// are NOT valid and will be rejected. See: https://docs.openclaw.ai/gateway/configuration-reference

/// OpenClaw status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawStatus {
    /// Whether OpenClaw is installed
    pub installed: bool,
    /// Whether the gateway is running
    pub running: bool,
    /// Runtime version (Bun or Node.js, if installed)
    pub runtime_version: Option<String>,
    /// Installed OpenClaw version (if installed)
    pub openclaw_version: Option<String>,
    /// Port status (available or in use)
    pub port_available: bool,
    /// Error message (if any)
    pub error: Option<String>,
    /// Active sandbox type name (e.g., "Linux Namespaces", "WSL2", "Docker", "Direct Process")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_type: Option<String>,
    /// Isolation tier ("none", "platform_sandbox", "full_container")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isolation_tier: Option<String>,
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
    /// Optional custom model ID (sets agents.defaults.model.primary)
    #[serde(rename = "modelId")]
    pub model_id: Option<String>,
    /// Optional custom port
    pub port: Option<u16>,
    /// Optional bind address
    pub bind: Option<String>,
    /// Optional API key for Jan's local API server
    #[serde(rename = "janApiKey")]
    pub jan_api_key: Option<String>,
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

/// Entry for bulk model sync from Jan to OpenClaw
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSyncEntry {
    /// Model ID (e.g., "llama-3.2-3b", "gpt-4o")
    #[serde(rename = "modelId")]
    pub model_id: String,
    /// Jan's internal provider name (e.g., "llamacpp", "openai", "anthropic")
    pub provider: String,
    /// Human-readable display name
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// Context window size from Jan's model settings (ctx_len). None = use default.
    #[serde(rename = "contextWindow")]
    pub context_window: Option<u32>,
}

/// Result of bulk model sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkSyncResult {
    /// Number of models synced
    pub synced_count: u32,
    /// Default model that was set (if any)
    pub default_model: Option<String>,
}

// ============================================
// 1-Click Enable Models
// ============================================

/// Steps in the 1-click enable flow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EnableStep {
    CheckingDependencies,
    CheckingInstallation,
    Installing,
    Configuring,
    Starting,
    ValidatingConfig,
    SyncingModels,
}

/// Result of the 1-click enable orchestrator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnableResult {
    /// Whether the enable flow completed successfully
    pub success: bool,
    /// Whether OpenClaw was already installed before this run
    pub already_installed: bool,
    /// Steps that were completed
    pub steps_completed: Vec<EnableStep>,
    /// Final OpenClaw status
    pub status: OpenClawStatus,
}

/// Progress event emitted during the enable flow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnableProgressEvent {
    /// Current step identifier
    pub step: String,
    /// Progress percentage (0-100)
    pub progress: u32,
    /// Human-readable message
    pub message: String,
    /// Optional sandbox info for display (e.g., "Linux Namespaces", "Docker 24.0.7")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_info: Option<String>,
}

/// Error with recovery options for the enable flow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnableError {
    /// Error code for programmatic handling
    pub code: EnableErrorCode,
    /// Human-readable error message
    pub message: String,
    /// Recovery options the user can take
    pub recovery: Vec<RecoveryOption>,
}

/// Error codes for the enable flow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EnableErrorCode {
    RuntimeNotFound,
    RuntimeVersionTooLow,
    InstallFailed,
    PortInUse,
    ConfigWriteFailed,
    GatewayStartFailed,
    ValidationFailed,
}

/// A recovery option the user can take
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryOption {
    /// Button label
    pub label: String,
    /// Recovery action type
    pub action: RecoveryAction,
    /// Description of what this action does
    pub description: String,
}

/// Recovery actions the frontend can execute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecoveryAction {
    Retry,
    UseDifferentPort { port: u16 },
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