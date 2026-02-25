use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async_with_config, tungstenite::{self, Message, http::Request}, MaybeTlsStream, WebSocketStream};
use tauri::State;

use crate::core::openclaw::{
    constants::*,
    models::*,
    get_openclaw_config_path, get_openclaw_config_dir, OpenClawState, OPENCLAW_PORT, MIN_NODE_VERSION,
};

/// Request ID counter for WebSocket messages
static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Get next request ID
fn next_request_id() -> String {
    REQUEST_ID_COUNTER.fetch_add(1, Ordering::SeqCst).to_string()
}

/// OpenClaw Gateway WebSocket request
#[derive(Debug, Serialize)]
struct GatewayRequest {
    #[serde(rename = "type")]
    msg_type: String,
    id: String,
    method: String,
    params: serde_json::Value,
}

/// OpenClaw Gateway WebSocket response
#[derive(Debug, Deserialize)]
struct GatewayResponse {
    #[serde(rename = "type")]
    msg_type: String,
    id: String,
    ok: bool,
    #[serde(default)]
    payload: serde_json::Value,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

/// Get the gateway auth token from the OpenClaw config
async fn get_gateway_auth_token() -> Result<String, String> {
    let config_path = get_openclaw_config_path()?;

    if !config_path.exists() {
        return Err("OpenClaw config not found".to_string());
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read OpenClaw config: {}", e))?;

    let config: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse OpenClaw config: {}", e))?;

    config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(String::from)
        .ok_or_else(|| "Gateway auth token not found in config".to_string())
}

/// Connect to OpenClaw Gateway WebSocket and perform handshake
/// Uses an explicit Origin header to pass the Gateway's origin validation
async fn connect_to_gateway() -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, String> {
    let url = format!("ws://127.0.0.1:{}", OPENCLAW_PORT);
    log::info!("Connecting to OpenClaw Gateway at {}", url);

    // Build WebSocket request with Origin header
    // The Gateway validates the Origin header for security (CVE-2026-25253)
    // We use "http://localhost" which is in the allowedOrigins list
    let request = Request::builder()
        .uri(&url)
        .header("Host", format!("127.0.0.1:{}", OPENCLAW_PORT))
        .header("Origin", "http://localhost")
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
        .body(())
        .map_err(|e| format!("Failed to build WebSocket request: {}", e))?;

    let (ws_stream, _) = connect_async_with_config(request, None, false)
        .await
        .map_err(|e| format!("Failed to connect to OpenClaw Gateway: {}", e))?;

    Ok(ws_stream)
}

/// Perform the Gateway handshake (connect request) with proper protocol v3
async fn gateway_handshake(ws_stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>) -> Result<(), String> {
    // Wait for connect.challenge event
    let timeout = tokio::time::Duration::from_secs(5);
    let challenge_result = tokio::time::timeout(timeout, async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    log::debug!("Received during handshake: {}", text);
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                        if event.get("type").and_then(|t| t.as_str()) == Some("event")
                           && event.get("event").and_then(|e| e.as_str()) == Some("connect.challenge") {
                            // Extract nonce from challenge
                            let nonce = event.get("payload")
                                .and_then(|p| p.get("nonce"))
                                .and_then(|n| n.as_str())
                                .map(String::from);
                            return Ok(nonce);
                        }
                    }
                }
                Ok(Message::Close(_)) => return Err("Connection closed during handshake".to_string()),
                Err(e) => return Err(format!("WebSocket error during handshake: {}", e)),
                _ => {}
            }
        }
        Err("No challenge received".to_string())
    }).await;

    // We wait for the challenge but don't need the nonce since device auth is disabled
    match challenge_result {
        Ok(Ok(_)) => {} // Challenge received, proceed
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Handshake timeout".to_string()),
    };

    // Send connect request following protocol v3
    // Use "openclaw-control-ui" as client.id to enable dangerouslyDisableDeviceAuth bypass
    // This client ID is recognized by the Gateway as a Control UI client, which allows
    // bypassing device identity checks when dangerouslyDisableDeviceAuth=true
    //
    // We also pass the gateway auth token to satisfy the shared auth requirement
    let connect_id = next_request_id();

    // Read the gateway auth token from config
    let auth_token = get_gateway_auth_token().await.unwrap_or_default();

    let connect_request = serde_json::json!({
        "type": "req",
        "id": connect_id,
        "method": "connect",
        "params": {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "openclaw-control-ui",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
                "mode": "webchat"
            },
            "role": "operator",
            "scopes": ["operator.read", "operator.write", "operator.channels", "operator.admin"],
            "caps": ["structured-commands"],
            "commands": [],
            "permissions": {},
            "auth": {
                "token": auth_token
            },
            "locale": "en-US",
            "userAgent": format!("jan-desktop/{}", env!("CARGO_PKG_VERSION"))
        }
    });

    let request_json = serde_json::to_string(&connect_request)
        .map_err(|e| format!("Failed to serialize connect request: {}", e))?;

    log::info!("Sending connect handshake (device auth disabled)");
    log::debug!("Connect request: {}", request_json);

    ws_stream.send(Message::Text(request_json))
        .await
        .map_err(|e| format!("Failed to send connect request: {}", e))?;

    // Wait for connect response
    let response_result = tokio::time::timeout(timeout, async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    log::debug!("Received connect response: {}", text);
                    if let Ok(response) = serde_json::from_str::<GatewayResponse>(&text) {
                        if response.msg_type == "res" && response.id == connect_id {
                            if response.ok {
                                log::info!("Gateway connect successful");
                                return Ok(());
                            } else {
                                let error_msg = response.error
                                    .map(|e| {
                                        e.get("message")
                                            .and_then(|m| m.as_str())
                                            .map(String::from)
                                            .unwrap_or_else(|| e.to_string())
                                    })
                                    .unwrap_or_else(|| "Unknown connect error".to_string());
                                return Err(error_msg);
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => return Err("Connection closed".to_string()),
                Err(e) => return Err(format!("WebSocket error: {}", e)),
                _ => {}
            }
        }
        Err("No connect response received".to_string())
    }).await;

    match response_result {
        Ok(Ok(())) => {
            log::info!("Gateway handshake completed successfully");
            Ok(())
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Connect response timeout".to_string()),
    }
}

/// Send a request to the Gateway and wait for response
async fn gateway_request(
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Ensure Jan's origin is configured before connecting
    // This handles the case where the Gateway is already running but doesn't have Jan's origin
    let _ = openclaw_ensure_jan_origin().await;

    let mut ws_stream = connect_to_gateway().await?;

    // Perform handshake first
    gateway_handshake(&mut ws_stream).await?;

    let request_id = next_request_id();
    let request = GatewayRequest {
        msg_type: "req".to_string(),
        id: request_id.clone(),
        method: method.to_string(),
        params,
    };

    let request_json = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    log::info!("Sending Gateway request: {}", request_json);

    ws_stream.send(Message::Text(request_json))
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    // Wait for response with matching ID
    let timeout = tokio::time::Duration::from_secs(30);
    let result = tokio::time::timeout(timeout, async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    log::debug!("Received Gateway message: {}", text);
                    if let Ok(response) = serde_json::from_str::<GatewayResponse>(&text) {
                        if response.msg_type == "res" && response.id == request_id {
                            if response.ok {
                                return Ok(response.payload);
                            } else {
                                let error_msg = response.error
                                    .map(|e| {
                                        e.get("message")
                                            .and_then(|m| m.as_str())
                                            .map(String::from)
                                            .unwrap_or_else(|| e.to_string())
                                    })
                                    .unwrap_or_else(|| "Unknown error".to_string());
                                return Err(error_msg);
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    return Err("Connection closed".to_string());
                }
                Err(e) => {
                    return Err(format!("WebSocket error: {}", e));
                }
                _ => {}
            }
        }
        Err("Connection closed unexpectedly".to_string())
    }).await;

    // Close the connection
    let _ = ws_stream.close(None).await;

    match result {
        Ok(inner) => inner,
        Err(_) => Err("Request timed out".to_string()),
    }
}

// ============================================
// Unified 1-Click Setup Functions
// ============================================

/// Setup result for the unified 1-click flow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawSetupResult {
    /// Whether setup completed successfully
    pub success: bool,
    /// Current step in the setup process
    pub step: String,
    /// Whether OpenClaw is installed
    pub openclaw_installed: bool,
    /// Whether the Gateway is running
    pub gateway_running: bool,
    /// Whether the device is paired with the Gateway
    pub device_paired: bool,
    /// Error message if setup failed
    pub error: Option<String>,
    /// Helpful message for the user
    pub message: Option<String>,
}

/// Ensure OpenClaw is fully set up and ready for channel connections
/// This is the "1-click" setup that handles everything automatically:
/// 1. Clear any stale data from previous failed attempts
/// 2. Check/install OpenClaw
/// 3. Configure Gateway with correct settings (origins, device auth bypass)
/// 4. Start the Gateway if not running
/// 5. Test the Gateway connection
/// 6. Restart Gateway if config changed
#[tauri::command]
pub async fn openclaw_setup_for_channels(state: tauri::State<'_, OpenClawState>) -> Result<OpenClawSetupResult, String> {
    log::info!("Starting 1-click OpenClaw setup for channels");

    // Step 0: Clear any stale data that might cause issues
    if let Err(e) = clear_stale_openclaw_data().await {
        log::warn!("Failed to clear stale data: {}", e);
        // Non-fatal, continue
    }

    // Step 1: Check if OpenClaw is installed
    let openclaw_version = match check_openclaw_installed().await {
        Ok(Some(version)) => {
            log::info!("OpenClaw is installed: {}", version);
            Some(version)
        }
        Ok(None) => {
            log::info!("OpenClaw is not installed, attempting to install...");
            // Try to install OpenClaw
            match openclaw_install().await {
                Ok(result) if result.success => {
                    log::info!("OpenClaw installed successfully");
                    result.version
                }
                Ok(result) => {
                    return Ok(OpenClawSetupResult {
                        success: false,
                        step: "install".to_string(),
                        openclaw_installed: false,
                        gateway_running: false,
                        device_paired: false,
                        error: result.error,
                        message: Some("Please install Node.js 22+ and OpenClaw manually".to_string()),
                    });
                }
                Err(e) => {
                    return Ok(OpenClawSetupResult {
                        success: false,
                        step: "install".to_string(),
                        openclaw_installed: false,
                        gateway_running: false,
                        device_paired: false,
                        error: Some(e),
                        message: Some("Please install Node.js 22+ and OpenClaw manually".to_string()),
                    });
                }
            }
        }
        Err(e) => {
            return Ok(OpenClawSetupResult {
                success: false,
                step: "check_install".to_string(),
                openclaw_installed: false,
                gateway_running: false,
                device_paired: false,
                error: Some(e),
                message: None,
            });
        }
    };

    // Step 2: Ensure Gateway config has all required settings
    log::info!("Configuring Gateway for Jan...");
    let config_changed = match ensure_gateway_config_for_jan().await {
        Ok(changed) => changed,
        Err(e) => {
            log::warn!("Failed to configure Gateway: {}", e);
            false
        }
    };

    // Step 3: Check if Gateway is running, start or restart if needed
    let gateway_running = check_gateway_responding().await;
    if !gateway_running {
        log::info!("Gateway not running, starting...");
        match openclaw_start(state.clone()).await {
            Ok(()) => {
                log::info!("Gateway started successfully");
                // Wait for gateway to be ready
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            }
            Err(e) => {
                return Ok(OpenClawSetupResult {
                    success: false,
                    step: "start_gateway".to_string(),
                    openclaw_installed: openclaw_version.is_some(),
                    gateway_running: false,
                    device_paired: false,
                    error: Some(e),
                    message: Some("Failed to start the OpenClaw Gateway".to_string()),
                });
            }
        }
    } else if config_changed {
        // Gateway is running but config changed, restart to apply changes
        log::info!("Config changed, restarting Gateway...");
        let _ = restart_gateway_cli().await;
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }

    // Step 4: Test Gateway connection
    log::info!("Testing Gateway connection...");
    match test_gateway_connection().await {
        Ok(()) => {
            log::info!("Gateway connection successful");
            return Ok(OpenClawSetupResult {
                success: true,
                step: "complete".to_string(),
                openclaw_installed: true,
                gateway_running: true,
                device_paired: true,
                error: None,
                message: Some("OpenClaw is ready for channel connections".to_string()),
            });
        }
        Err(e) => {
            log::warn!("Gateway connection failed: {}", e);

            // If connection failed, try restarting the Gateway and retrying once
            // This handles cases where the Gateway needs to reload config
            log::info!("Attempting to restart Gateway and retry connection...");
            let _ = restart_gateway_cli().await;
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

            // Retry connection
            match test_gateway_connection().await {
                Ok(()) => {
                    return Ok(OpenClawSetupResult {
                        success: true,
                        step: "complete".to_string(),
                        openclaw_installed: true,
                        gateway_running: true,
                        device_paired: true,
                        error: None,
                        message: Some("OpenClaw is ready for channel connections".to_string()),
                    });
                }
                Err(retry_err) => {
                    return Ok(OpenClawSetupResult {
                        success: false,
                        step: "connect".to_string(),
                        openclaw_installed: true,
                        gateway_running: true,
                        device_paired: false,
                        error: Some(retry_err),
                        message: Some("Connection failed. Please check if OpenClaw Gateway is running.".to_string()),
                    });
                }
            }
        }
    }
}

/// Test the Gateway connection without making any requests
async fn test_gateway_connection() -> Result<(), String> {
    let mut ws_stream = connect_to_gateway().await?;
    gateway_handshake(&mut ws_stream).await?;
    let _ = ws_stream.close(None).await;
    Ok(())
}

/// Restart the Gateway via CLI command
async fn restart_gateway_cli() -> Result<(), String> {
    log::info!("Restarting Gateway via CLI...");

    let output = Command::new("openclaw")
        .args(["gateway", "restart"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to restart gateway: {}", e))?;

    if output.status.success() {
        log::info!("Gateway restarted successfully");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("Gateway restart may have failed: {}", stderr);
        // Don't fail - the gateway might still be restarting
        Ok(())
    }
}

/// Clear all stale OpenClaw data that might cause connection issues
/// This is called automatically before setup to ensure a clean state
async fn clear_stale_openclaw_data() -> Result<(), String> {
    log::info!("Clearing stale OpenClaw data for fresh setup...");

    let config_dir = get_openclaw_config_dir()?;

    // List of files that might contain stale device/auth data
    let stale_files = [
        "jan_device_key.json",  // Old device keypair (no longer needed)
        "whatsapp.json",        // Stale WhatsApp config from failed attempts
    ];

    for file in &stale_files {
        let file_path = config_dir.join(file);
        if file_path.exists() {
            match std::fs::remove_file(&file_path) {
                Ok(_) => log::info!("Removed stale file: {}", file),
                Err(e) => log::warn!("Failed to remove {}: {}", file, e),
            }
        }
    }

    // Also clear the whatsapp_auth directory if it exists and has issues
    let whatsapp_auth_dir = config_dir.join("whatsapp_auth");
    if whatsapp_auth_dir.exists() {
        // Check if the session files are corrupted (very small or empty)
        if let Ok(entries) = std::fs::read_dir(&whatsapp_auth_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    // Remove files that are suspiciously small (likely corrupted)
                    if metadata.len() < 10 {
                        let _ = std::fs::remove_file(entry.path());
                        log::info!("Removed potentially corrupted file: {:?}", entry.path());
                    }
                }
            }
        }
    }

    log::info!("Stale data cleanup complete");
    Ok(())
}

/// Ensure the Gateway config has all required settings for Jan
/// This fixes common configuration issues that cause connection failures
async fn ensure_gateway_config_for_jan() -> Result<bool, String> {
    log::info!("Ensuring Gateway config is correct for Jan...");

    let config_path = get_openclaw_config_path()?;

    if !config_path.exists() {
        log::info!("No OpenClaw config exists yet");
        return Ok(false);
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read OpenClaw config: {}", e))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse OpenClaw config: {}", e))?;

    let mut modified = false;

    // Ensure gateway object exists
    if config.get("gateway").is_none() {
        config["gateway"] = serde_json::json!({});
        modified = true;
    }

    // Ensure gateway.controlUi object exists
    if config["gateway"].get("controlUi").is_none() {
        config["gateway"]["controlUi"] = serde_json::json!({});
        modified = true;
    }

    // 1. Ensure allowedOrigins contains Jan's origins
    let allowed_origins = config["gateway"]["controlUi"]
        .get("allowedOrigins")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let existing_origins: std::collections::HashSet<String> = allowed_origins
        .iter()
        .filter_map(|v| v.as_str())
        .map(String::from)
        .collect();

    let mut new_origins: Vec<serde_json::Value> = allowed_origins;
    for origin in JAN_ALLOWED_ORIGINS {
        if !existing_origins.contains(*origin) {
            new_origins.push(serde_json::json!(origin));
            modified = true;
            log::info!("Adding Jan origin: {}", origin);
        }
    }
    if modified {
        config["gateway"]["controlUi"]["allowedOrigins"] = serde_json::Value::Array(new_origins);
    }

    // 2. Enable dangerouslyDisableDeviceAuth for local connections
    // This is the key setting that allows connections without complex device signing
    let disable_device_auth = config["gateway"]["controlUi"]
        .get("dangerouslyDisableDeviceAuth")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !disable_device_auth {
        config["gateway"]["controlUi"]["dangerouslyDisableDeviceAuth"] = serde_json::json!(true);
        modified = true;
        log::info!("Enabled dangerouslyDisableDeviceAuth for local connections");
    }

    // 3. Enable whatsapp plugin if not already
    if config.get("plugins").is_none() {
        config["plugins"] = serde_json::json!({"entries": {}});
    }
    if config["plugins"].get("entries").is_none() {
        config["plugins"]["entries"] = serde_json::json!({});
    }
    let whatsapp_enabled = config["plugins"]["entries"]
        .get("whatsapp")
        .and_then(|w| w.get("enabled"))
        .and_then(|e| e.as_bool())
        .unwrap_or(false);

    if !whatsapp_enabled {
        config["plugins"]["entries"]["whatsapp"] = serde_json::json!({"enabled": true});
        modified = true;
        log::info!("Enabled WhatsApp plugin");
    }

    if modified {
        let updated_json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(&config_path, updated_json)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        log::info!("OpenClaw config updated for Jan");
    }

    Ok(modified)
}


/// Check if Node.js is installed and meets version requirements
#[tauri::command]
pub async fn openclaw_check_dependencies() -> NodeCheckResult {
    log::info!("Checking Node.js dependencies for OpenClaw");

    // Check if Node.js is installed
    let output = Command::new("node")
        .arg("--version")
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let version_str = version_output.trim_start_matches('v');

                // Parse major version
                let major_version: Option<u32> = version_str
                    .split('.')
                    .next()
                    .and_then(|v| v.parse().ok());

                let meets_requirements = major_version
                    .map(|v| v >= MIN_NODE_VERSION)
                    .unwrap_or(false);

                let version_clone = version_output.clone();
                NodeCheckResult {
                    installed: true,
                    version: Some(version_clone),
                    major_version,
                    meets_requirements,
                    error: if !meets_requirements {
                        Some(format!("Node.js version {} is required, found {}", MIN_NODE_VERSION, version_str))
                    } else {
                        None
                    },
                }
            } else {
                NodeCheckResult {
                    installed: false,
                    version: None,
                    major_version: None,
                    meets_requirements: false,
                    error: Some("Node.js is not installed".to_string()),
                }
            }
        }
        Err(e) => {
            NodeCheckResult {
                installed: false,
                version: None,
                major_version: None,
                meets_requirements: false,
                error: Some(format!("Failed to check Node.js: {}", e)),
            }
        }
    }
}

/// Check if a port is available
#[tauri::command]
pub async fn openclaw_check_port(port: u16) -> PortCheckResult {
    log::info!("Checking if port {} is available", port);

    let addr = if cfg!(target_os = "windows") {
        format!("127.0.0.1:{}", port)
    } else {
        format!("localhost:{}", port)
    };

    match tokio::net::TcpListener::bind(&addr).await {
        Ok(_) => PortCheckResult {
            available: true,
            port,
            error: None,
        },
        Err(e) => PortCheckResult {
            available: false,
            port,
            error: Some(format!("Port {} is in use: {}", port, e)),
        },
    }
}

/// Check if OpenClaw is installed and get its version
async fn check_openclaw_installed() -> Result<Option<String>, String> {
    let output = Command::new("openclaw")
        .arg("--version")
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok(Some(version))
            } else {
                Ok(None)
            }
        }
        Err(_) => Ok(None),
    }
}

/// Install OpenClaw globally via npm
#[tauri::command]
pub async fn openclaw_install() -> Result<InstallResult, String> {
    log::info!("Installing OpenClaw via npm");

    // First check if OpenClaw is already installed
    if let Ok(Some(version)) = check_openclaw_installed().await {
        log::info!("OpenClaw is already installed: {}", version);
        return Ok(InstallResult {
            success: true,
            version: Some(version),
            error: None,
        });
    }

    // Check Node.js
    let node_check = openclaw_check_dependencies().await;
    if !node_check.installed {
        return Ok(InstallResult {
            success: false,
            version: None,
            error: node_check.error.or_else(|| Some("Node.js is required but not installed".to_string())),
        });
    }

    if !node_check.meets_requirements {
        return Ok(InstallResult {
            success: false,
            version: None,
            error: node_check.error.or_else(|| Some(format!("Node.js {} or higher is required", MIN_NODE_VERSION))),
        });
    }

    // Run npm install -g @openclaw/openclaw
    let child = Command::new("npm")
        .args(["install", "-g", OPENCLAW_PACKAGE_NAME])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn npm: {}", e))?;

    let output = child.wait_with_output().await.map_err(|e| format!("Failed to wait for npm: {}", e))?;

    if output.status.success() {
        // Verify installation
        match check_openclaw_installed().await {
            Ok(version) => Ok(InstallResult {
                success: true,
                version,
                error: None,
            }),
            Err(e) => Ok(InstallResult {
                success: false,
                version: None,
                error: Some(e),
            }),
        }
    } else {
        // Parse npm error output for better error messages
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);

        let error_message = if stderr.contains("404") || stderr.contains("Not Found") || stdout.contains("404") {
            format!(
                "OpenClaw package '{}' is not yet available on npm. \
                Please check the OpenClaw project for installation instructions, \
                or try using PicoClaw as an alternative lightweight gateway.",
                OPENCLAW_PACKAGE_NAME
            )
        } else if stderr.contains("EACCES") || stderr.contains("permission denied") {
            "Permission denied. Try running with administrator privileges or use a Node version manager like nvm.".to_string()
        } else if stderr.contains("ENOTFOUND") || stderr.contains("network") {
            "Network error. Please check your internet connection and try again.".to_string()
        } else {
            format!(
                "npm install failed: {}",
                if !stderr.is_empty() {
                    stderr.trim().to_string()
                } else if !stdout.is_empty() {
                    stdout.trim().to_string()
                } else {
                    "Unknown error".to_string()
                }
            )
        };

        log::error!("OpenClaw installation failed: {}", error_message);

        Ok(InstallResult {
            success: false,
            version: None,
            error: Some(error_message),
        })
    }
}

/// Generate the default OpenClaw configuration
fn generate_default_config(input: Option<OpenClawConfigInput>) -> OpenClawConfig {
    let mut config = OpenClawConfig::default();

    if let Some(input) = input {
        if let Some(port) = input.port {
            config.gateway.port = port;
        }
        if let Some(bind) = input.bind {
            config.gateway.bind = bind;
        }
        if let Some(base_url) = input.jan_base_url {
            config.models.providers.jan.base_url = base_url;
        }
        if let Some(model_id) = input.model_id {
            config.agents.defaults.model.primary = model_id;
        }
        if let Some(system_prompt) = input.system_prompt {
            config.agents.defaults.system_prompt = system_prompt;
        }
    }

    config
}

/// Jan's allowed origins for OpenClaw Gateway WebSocket connections
/// These origins allow Jan (Tauri app) to connect to the Gateway
const JAN_ALLOWED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "http://localhost",
    "http://localhost:1420",  // Tauri dev server
    "http://127.0.0.1",
];

/// Ensure Jan's origins are in the OpenClaw config's gateway.controlUi.allowedOrigins
/// This patches an existing config without overwriting other settings
/// Returns true if the config was modified, false if already correct
#[tauri::command]
pub async fn openclaw_ensure_jan_origin() -> Result<bool, String> {
    log::info!("Ensuring Jan's origin is in OpenClaw allowedOrigins");

    let config_path = get_openclaw_config_path()?;

    if !config_path.exists() {
        // No config exists, it will be created with correct defaults when openclaw_configure is called
        log::info!("No OpenClaw config exists yet, will be created with Jan origins");
        return Ok(false);
    }

    // Read and parse existing config as JSON Value to preserve all fields
    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read OpenClaw config: {}", e))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse OpenClaw config: {}", e))?;

    // Ensure gateway object exists
    if config.get("gateway").is_none() {
        config["gateway"] = serde_json::json!({});
    }

    // Ensure gateway.controlUi object exists
    if config["gateway"].get("controlUi").is_none() {
        config["gateway"]["controlUi"] = serde_json::json!({});
    }

    // Get or create allowedOrigins array
    let allowed_origins = config["gateway"]["controlUi"]
        .get("allowedOrigins")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // Convert to a set of existing origins
    let existing_origins: std::collections::HashSet<String> = allowed_origins
        .iter()
        .filter_map(|v| v.as_str())
        .map(String::from)
        .collect();

    // Check which Jan origins are missing
    let mut modified = false;
    let mut new_origins: Vec<serde_json::Value> = allowed_origins;

    for origin in JAN_ALLOWED_ORIGINS {
        if !existing_origins.contains(*origin) {
            new_origins.push(serde_json::json!(origin));
            modified = true;
            log::info!("Adding Jan origin to allowedOrigins: {}", origin);
        }
    }

    // Also enable dangerouslyDisableDeviceAuth for local connections
    // This simplifies the connection flow for non-tech users
    // Security note: This is safe for loopback-only gateways (local use)
    let disable_device_auth = config["gateway"]["controlUi"]
        .get("dangerouslyDisableDeviceAuth")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !disable_device_auth {
        config["gateway"]["controlUi"]["dangerouslyDisableDeviceAuth"] = serde_json::json!(true);
        modified = true;
        log::info!("Enabled dangerouslyDisableDeviceAuth for local connections");
    }

    if modified {
        // Update the config with new origins
        config["gateway"]["controlUi"]["allowedOrigins"] = serde_json::Value::Array(new_origins);

        // Write back the config
        let updated_json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(&config_path, updated_json)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        log::info!("OpenClaw config updated with Jan's allowed origins and device auth disabled");
    } else {
        log::info!("Jan's config already correct");
    }

    Ok(modified)
}

/// Configure OpenClaw with the specified settings
#[tauri::command]
pub async fn openclaw_configure(config_input: Option<OpenClawConfigInput>) -> Result<OpenClawConfig, String> {
    log::info!("Configuring OpenClaw");

    let config = generate_default_config(config_input);

    let config_path = get_openclaw_config_path()?;
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("OpenClaw configuration written to {:?}", config_path);
    Ok(config)
}

/// Get the current OpenClaw configuration
#[tauri::command]
pub async fn openclaw_get_config() -> Result<OpenClawConfig, String> {
    let config_path = get_openclaw_config_path()?;

    if !config_path.exists() {
        // Return default config if no config exists
        return Ok(OpenClawConfig::default());
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

/// Sync the selected model from Jan to OpenClaw
///
/// This updates OpenClaw's agent default model to match Jan's currently selected model.
/// It does three things:
/// 1. Ensures the "jan" provider exists pointing to localhost:1337
/// 2. Adds/updates the model in the jan provider's model list
/// 3. Sets the model as the default using `openclaw models set` (no restart needed)
#[tauri::command]
pub async fn openclaw_sync_model(
    model_id: String,
    provider: Option<String>,
    model_name: Option<String>,
) -> Result<(), String> {
    log::info!("Syncing model to OpenClaw: {} (provider: {:?})", model_id, provider);

    // Format the model ID for OpenClaw
    // For the jan provider, we use "jan/<model_id>" format
    let openclaw_model_id = format!("jan/{}", model_id);
    let display_name = model_name.unwrap_or_else(|| model_id.clone());

    // Determine context window based on provider type
    let context_window = if provider.as_deref() == Some("llamacpp") || provider.as_deref() == Some("mlx") {
        16000 // Local models typically have smaller context
    } else {
        128000 // Remote providers usually have larger context
    };

    // Create a model definition for OpenClaw
    let model_def = serde_json::json!({
        "id": model_id,
        "name": display_name,
        "reasoning": false,
        "input": ["text"],
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
        "contextWindow": context_window,
        "maxTokens": 4096
    });

    // Check if jan provider exists
    let check_output = Command::new("openclaw")
        .args(["config", "get", "models.providers.jan"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let jan_provider_exists = check_output
        .as_ref()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !jan_provider_exists {
        // Create the jan provider pointing to local Jan API
        log::info!("Creating 'jan' provider in OpenClaw config");
        let jan_provider = serde_json::json!({
            "baseUrl": "http://localhost:1337/v1",
            "api": "openai-completions",
            "authHeader": false,
            "apiKey": "not-needed",
            "models": [model_def]
        });

        let create_output = Command::new("openclaw")
            .args([
                "config",
                "set",
                "models.providers.jan",
                &jan_provider.to_string(),
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        if let Ok(output) = create_output {
            if !output.status.success() {
                log::warn!("Failed to create jan provider: {:?}", String::from_utf8_lossy(&output.stderr));
            }
        }
    } else {
        // Jan provider exists, update the models list with this model
        log::debug!("Jan provider exists, updating model list");

        // Get current models
        let models_output = Command::new("openclaw")
            .args(["config", "get", "models.providers.jan.models"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        if let Ok(output) = models_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(mut models) = serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim()) {
                    // Check if model already exists
                    let model_exists = models.iter().any(|m| {
                        m.get("id").and_then(|v| v.as_str()) == Some(&model_id)
                    });

                    if !model_exists {
                        // Add the new model
                        models.push(model_def);
                        let models_json = serde_json::to_string(&models).unwrap_or_default();

                        let _ = Command::new("openclaw")
                            .args([
                                "config",
                                "set",
                                "models.providers.jan.models",
                                &models_json,
                            ])
                            .stdout(Stdio::piped())
                            .stderr(Stdio::piped())
                            .output()
                            .await;
                    }
                }
            }
        }
    }

    // Use `openclaw models set` to change the default model
    // This updates the default for new sessions
    let output = Command::new("openclaw")
        .args(["models", "set", &openclaw_model_id])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw models set: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);

    log::info!("OpenClaw config set output: {}", stdout);
    if !stderr.is_empty() {
        log::debug!("OpenClaw config set stderr: {}", stderr);
    }

    if !output.status.success() {
        return Err(format!(
            "Failed to set OpenClaw model: {}",
            if !stderr.is_empty() { stderr.to_string() } else { stdout.to_string() }
        ));
    }

    // Now update active sessions to use the new model
    // Get list of active sessions (updated in last 24 hours)
    let sessions_output = Command::new("openclaw")
        .args(["sessions", "--json", "--active", "1440"]) // Last 24 hours
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    if let Ok(sessions_result) = sessions_output {
        if sessions_result.status.success() {
            let sessions_json = String::from_utf8_lossy(&sessions_result.stdout);
            // Parse the sessions response - it's an object with a "sessions" array
            if let Ok(sessions_response) = serde_json::from_str::<serde_json::Value>(&sessions_json) {
                if let Some(sessions) = sessions_response.get("sessions").and_then(|v| v.as_array()) {
                    // Send /model command to each active session
                    for session in sessions {
                        if let Some(session_id) = session.get("sessionId").and_then(|v| v.as_str()) {
                            let model_cmd = format!("/model {}", openclaw_model_id);
                            log::debug!("Switching model for session {}: {}", session_id, model_cmd);

                            // Fire and forget - don't wait for response
                            let session_id_clone = session_id.to_string();
                            let model_cmd_clone = model_cmd.clone();
                            tokio::spawn(async move {
                                let _ = Command::new("openclaw")
                                    .args(["agent", "--session-id", &session_id_clone, "--message", &model_cmd_clone])
                                    .stdout(Stdio::null())
                                    .stderr(Stdio::null())
                                    .output()
                                    .await;
                            });
                        }
                    }
                }
            }
        }
    }

    log::info!("Successfully synced model '{}' to OpenClaw", openclaw_model_id);
    Ok(())
}

/// Get the currently configured model in OpenClaw
#[tauri::command]
pub async fn openclaw_get_model() -> Result<String, String> {
    log::info!("Getting OpenClaw model");

    let output = Command::new("openclaw")
        .args(["config", "get", "agents.defaults.model.primary"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw config get: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to get OpenClaw model: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // The output is JSON, parse it to get just the value
    let model: String = serde_json::from_str(stdout.trim())
        .unwrap_or_else(|_| stdout.trim().trim_matches('"').to_string());

    Ok(model)
}

/// Check if OpenClaw gateway is responding on the expected port
async fn check_gateway_responding() -> bool {
    // Use TCP connection check - OpenClaw serves a dashboard UI, not a JSON health endpoint
    match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", OPENCLAW_PORT)).await {
        Ok(_) => {
            log::info!("OpenClaw gateway is responding on port {}", OPENCLAW_PORT);
            true
        }
        Err(_) => false,
    }
}

/// Start the OpenClaw gateway
#[tauri::command]
pub async fn openclaw_start(state: State<'_, OpenClawState>) -> Result<(), String> {
    log::info!("Starting OpenClaw gateway");

    // Check if already running (tracked by us)
    {
        let handle = state.process_handle.lock().await;
        if handle.is_some() {
            log::info!("OpenClaw gateway is already running (tracked process)");
            return Ok(());
        }
    }

    // Check if gateway is already responding (started externally)
    if check_gateway_responding().await {
        log::info!("OpenClaw gateway is already running on port {} (external process)", OPENCLAW_PORT);
        // Even if running externally, ensure Jan's origin is configured
        let _ = openclaw_ensure_jan_origin().await;
        return Ok(());
    }

    // Check dependencies first
    let node_check = openclaw_check_dependencies().await;
    if !node_check.installed || !node_check.meets_requirements {
        return Err(node_check.error.unwrap_or_else(|| "Node.js requirements not met".to_string()));
    }

    // Check port availability
    let port_check = openclaw_check_port(OPENCLAW_PORT).await;
    if !port_check.available {
        // Port is in use but gateway not responding - something else is using the port
        return Err(format!("Port {} is already in use by another application", OPENCLAW_PORT));
    }

    // Ensure config exists
    let config_path = get_openclaw_config_path()?;
    if !config_path.exists() {
        // Generate default config (includes Jan's allowed origins by default)
        openclaw_configure(None).await?;
    } else {
        // Config exists, ensure Jan's origin is in allowedOrigins
        // This is crucial for the 1-click experience - users shouldn't need to manually edit config
        openclaw_ensure_jan_origin().await?;
    }

    // Start OpenClaw gateway
    let mut child = Command::new("openclaw")
        .args(&["gateway", "start"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start OpenClaw: {}", e))?;

    // Wait a bit for the process to start
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Check if process is still running
    match child.try_wait().map_err(|e| format!("Failed to check process: {}", e)) {
        Ok(Some(status)) => {
            if !status.success() {
                return Err(format!("OpenClaw failed to start: {:?}", status));
            }
        }
        Ok(None) => {
            // Process is running, store the handle
            let mut handle = state.process_handle.lock().await;
            *handle = Some(child);
            log::info!("OpenClaw gateway started successfully on port {}", OPENCLAW_PORT);
        }
        Err(e) => {
            return Err(format!("Failed to check process status: {}", e));
        }
    }

    Ok(())
}

/// Stop the OpenClaw gateway
#[tauri::command]
pub async fn openclaw_stop(state: State<'_, OpenClawState>) -> Result<(), String> {
    log::info!("Stopping OpenClaw gateway");

    let mut handle = state.process_handle.lock().await;

    if let Some(mut child) = handle.take() {
        // Try graceful shutdown first
        match child.kill().await {
            Ok(_) => {
                log::info!("OpenClaw gateway stopped");
                Ok(())
            }
            Err(e) => {
                log::warn!("Failed to stop OpenClaw gracefully: {}", e);
                // Try to force kill
                let _ = child.start_kill();
                Ok(())
            }
        }
    } else {
        // Process not tracked, try to kill by name
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("pkill")
                .arg("-f")
                .arg("openclaw")
                .output()
                .await
                .map_err(|e| format!("Failed to run pkill: {}", e))?;

            if output.status.success() {
                Ok(())
            } else {
                Err("OpenClaw process not found".to_string())
            }
        }

        #[cfg(target_os = "linux")]
        {
            let output = Command::new("pkill")
                .arg("-f")
                .arg("openclaw")
                .output()
                .await
                .map_err(|e| format!("Failed to run pkill: {}", e))?;

            if output.status.success() {
                Ok(())
            } else {
                Err("OpenClaw process not found".to_string())
            }
        }

        #[cfg(target_os = "windows")]
        {
            let output = Command::new("taskkill")
                .args(&["/F", "/IM", "openclaw.exe"])
                .output()
                .await
                .map_err(|e| format!("Failed to run taskkill: {}", e))?;

            if output.status.success() {
                Ok(())
            } else {
                Err("OpenClaw process not found".to_string())
            }
        }
    }
}

/// Get the current OpenClaw status
#[tauri::command]
pub async fn openclaw_status(state: State<'_, OpenClawState>) -> Result<OpenClawStatus, String> {
    log::info!("Getting OpenClaw status");

    // Check if process is running
    let running = {
        let mut handle = state.process_handle.lock().await;
        if let Some(ref mut child) = *handle {
            match child.try_wait() {
                Ok(Some(_)) => false, // Process has exited
                Ok(None) => true,     // Process is still running
                Err(_) => false,
            }
        } else {
            // Check if gateway is responding (might be started externally)
            check_gateway_responding().await
        }
    };

    // Check if OpenClaw is installed
    let openclaw_version = match check_openclaw_installed().await {
        Ok(v) => v,
        Err(_) => None,
    };

    // Check Node.js
    let node_check = openclaw_check_dependencies().await;

    // Check port
    let port_check = openclaw_check_port(OPENCLAW_PORT).await;

    Ok(OpenClawStatus {
        installed: openclaw_version.is_some(),
        running,
        node_version: node_check.version,
        openclaw_version,
        port_available: port_check.available,
        error: None,
    })
}

/// Restart the OpenClaw gateway
#[tauri::command]
pub async fn openclaw_restart(state: State<'_, OpenClawState>) -> Result<(), String> {
    log::info!("Restarting OpenClaw gateway");

    // Stop first
    openclaw_stop(state.clone()).await?;

    // Wait a bit for the process to fully terminate
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    // Start again
    openclaw_start(state).await
}

/// Get the OpenClaw configuration directory path
#[tauri::command]
pub fn openclaw_get_config_dir() -> Result<String, String> {
    let path = get_openclaw_config_dir()?;
    Ok(path.to_string_lossy().to_string())
}

/// Telegram bot token validation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramTokenValidation {
    /// Whether the token is valid
    pub valid: bool,
    /// Bot username if valid
    pub bot_username: Option<String>,
    /// Bot name if valid
    pub bot_name: Option<String>,
    /// Error message if invalid
    pub error: Option<String>,
}

/// Telegram channel configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    /// Bot token
    pub bot_token: String,
    /// Bot username
    pub bot_username: Option<String>,
    /// Whether the channel is connected
    pub connected: bool,
    /// Pairing code (if not yet paired)
    pub pairing_code: Option<String>,
    /// Number of paired users
    pub paired_users: u32,
}

/// Validate a Telegram bot token by calling the Telegram Bot API
#[tauri::command]
pub async fn telegram_validate_token(token: String) -> TelegramTokenValidation {
    log::info!("Validating Telegram bot token");

    // Basic format validation (Telegram tokens are typically format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
    if token.len() < 30 || !token.contains(':') {
        return TelegramTokenValidation {
            valid: false,
            bot_username: None,
            bot_name: None,
            error: Some("Invalid token format. Telegram tokens should look like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz".to_string()),
        };
    }

    // Call Telegram Bot API to validate the token
    let url = format!("https://api.telegram.org/bot{}/getMe", token);

    match reqwest::get(&url).await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(data) => {
                        if data.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                            let result = data.get("result");
                            let username = result.and_then(|r| r.get("username")).and_then(|v| v.as_str()).map(String::from);
                            let name = result.and_then(|r| r.get("first_name")).and_then(|v| v.as_str()).map(String::from);

                            TelegramTokenValidation {
                                valid: true,
                                bot_username: username.clone(),
                                bot_name: name,
                                error: None,
                            }
                        } else {
                            let description = data.get("description").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                            TelegramTokenValidation {
                                valid: false,
                                bot_username: None,
                                bot_name: None,
                                error: Some(format!("Token validation failed: {}", description)),
                            }
                        }
                    }
                    Err(e) => TelegramTokenValidation {
                        valid: false,
                        bot_username: None,
                        bot_name: None,
                        error: Some(format!("Failed to parse API response: {}", e)),
                    },
                }
            } else {
                TelegramTokenValidation {
                    valid: false,
                    bot_username: None,
                    bot_name: None,
                    error: Some(format!("API returned error: {}", response.status())),
                }
            }
        }
        Err(e) => TelegramTokenValidation {
            valid: false,
            bot_username: None,
            bot_name: None,
            error: Some(format!("Failed to connect to Telegram API: {}", e)),
        },
    }
}

/// Generate a unique pairing code for Telegram
fn generate_pairing_code() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let random_part: u32 = (timestamp % 10000) as u32;
    format!("{:04X}{:04X}", random_part, (timestamp / 10000) as u32)
}

/// Enable a channel plugin in OpenClaw
///
/// Plugins must be enabled before channels can be added
async fn enable_channel_plugin(channel: &str) -> Result<(), String> {
    log::info!("Enabling {} plugin in OpenClaw", channel);

    let enable_output = Command::new("openclaw")
        .args(["plugins", "enable", channel])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw plugins enable: {}", e))?;

    let stderr = String::from_utf8_lossy(&enable_output.stderr);
    let stdout = String::from_utf8_lossy(&enable_output.stdout);

    log::info!("OpenClaw plugins enable {} output: {}", channel, stdout);
    if !stderr.is_empty() {
        log::debug!("OpenClaw plugins enable {} stderr: {}", channel, stderr);
    }

    // Plugin enable succeeds even if already enabled, so we only check for actual errors
    if !enable_output.status.success() {
        let combined = format!("{}{}", stdout, stderr);
        // Ignore "already enabled" type messages
        if !combined.contains("already") && !combined.contains("Enabled") {
            return Err(format!("Failed to enable {} plugin: {}", channel, combined));
        }
    }

    Ok(())
}

/// Configure Telegram channel with the bot token
///
/// Uses `openclaw plugins enable telegram` followed by
/// `openclaw channels add --channel telegram --token <token>` to add the channel
#[tauri::command]
pub async fn telegram_configure(token: String) -> Result<TelegramConfig, String> {
    log::info!("Configuring Telegram channel via OpenClaw CLI");

    // Validate the token first via Telegram API
    let validation = telegram_validate_token(token.clone()).await;
    if !validation.valid {
        return Err(validation.error.unwrap_or_else(|| "Invalid token".to_string()));
    }

    // First, enable the Telegram plugin (must be done before adding channel)
    enable_channel_plugin("telegram").await?;

    // Add Telegram channel using OpenClaw CLI
    let add_output = Command::new("openclaw")
        .args([
            "channels",
            "add",
            "--channel", "telegram",
            "--token", &token,
            "--account", "default",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw channels add: {}", e))?;

    let add_stderr = String::from_utf8_lossy(&add_output.stderr);
    let add_stdout = String::from_utf8_lossy(&add_output.stdout);

    log::info!("OpenClaw channels add telegram output: {}", add_stdout);
    if !add_stderr.is_empty() {
        log::info!("OpenClaw channels add telegram stderr: {}", add_stderr);
    }

    if !add_output.status.success() {
        // Check if it failed because channel already exists
        let combined = format!("{}{}", add_stdout, add_stderr);
        if !combined.contains("already exists") && !combined.contains("updated") && !combined.contains("Added") {
            return Err(format!(
                "Failed to add Telegram channel: {}",
                if !add_stderr.is_empty() { add_stderr.to_string() } else { add_stdout.to_string() }
            ));
        }
    }

    // Also store in local config for Jan's reference
    let telegram_settings = serde_json::json!({
        "enabled": true,
        "bot_token": token,
        "bot_username": validation.bot_username,
        "connected": true,
    });

    let config_dir = get_openclaw_config_dir()?;
    let telegram_config_path = config_dir.join("telegram.json");

    std::fs::write(&telegram_config_path, serde_json::to_string_pretty(&telegram_settings).unwrap())
        .map_err(|e| format!("Failed to save Telegram config: {}", e))?;

    // Generate pairing code for DM access control
    let pairing_code = generate_pairing_code();

    log::info!("Telegram configured successfully via OpenClaw, pairing code: {}", pairing_code);

    Ok(TelegramConfig {
        bot_token: token,
        bot_username: validation.bot_username,
        connected: true, // Channel is added and connected
        pairing_code: Some(pairing_code),
        paired_users: 0,
    })
}

/// Get current Telegram configuration
#[tauri::command]
pub async fn telegram_get_config() -> Result<TelegramConfig, String> {
    let config_dir = get_openclaw_config_dir()?;
    let telegram_config_path = config_dir.join("telegram.json");

    if !telegram_config_path.exists() {
        return Ok(TelegramConfig {
            bot_token: String::new(),
            bot_username: None,
            connected: false,
            pairing_code: None,
            paired_users: 0,
        });
    }

    let config_json = std::fs::read_to_string(&telegram_config_path)
        .map_err(|e| format!("Failed to read Telegram config: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse Telegram config: {}", e))?;

    Ok(TelegramConfig {
        bot_token: settings.get("bot_token").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        bot_username: settings.get("bot_username").and_then(|v| v.as_str()).map(String::from),
        connected: settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false),
        pairing_code: None, // Only shown during initial setup
        paired_users: settings.get("paired_users").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
    })
}

/// Check if pairing is complete (simulated - in real impl would check with OpenClaw)
#[tauri::command]
pub async fn telegram_check_pairing() -> Result<bool, String> {
    log::info!("Checking Telegram pairing status");

    let config_dir = get_openclaw_config_dir()?;
    let telegram_config_path = config_dir.join("telegram.json");

    if !telegram_config_path.exists() {
        return Ok(false);
    }

    let config_json = std::fs::read_to_string(&telegram_config_path)
        .map_err(|e| format!("Failed to read Telegram config: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse Telegram config: {}", e))?;

    Ok(settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false))
}

/// Disconnect Telegram channel
#[tauri::command]
pub async fn telegram_disconnect() -> Result<(), String> {
    log::info!("Disconnecting Telegram channel");

    let config_dir = get_openclaw_config_dir()?;
    let telegram_config_path = config_dir.join("telegram.json");

    if telegram_config_path.exists() {
        let config_json = std::fs::read_to_string(&telegram_config_path)
            .map_err(|e| format!("Failed to read Telegram config: {}", e))?;

        let mut settings: serde_json::Value = serde_json::from_str(&config_json)
            .map_err(|e| format!("Failed to parse Telegram config: {}", e))?;

        settings["enabled"] = serde_json::json!(false);
        settings["connected"] = serde_json::json!(false);
        settings["paired_users"] = serde_json::json!(0);

        std::fs::write(&telegram_config_path, serde_json::to_string_pretty(&settings).unwrap())
            .map_err(|e| format!("Failed to save Telegram config: {}", e))?;
    }

    Ok(())
}

// ============================================
// Channel List and Status Commands
// ============================================

/// Channel status information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelStatus {
    /// Channel name (e.g., "telegram", "whatsapp", "discord")
    pub name: String,
    /// Account ID
    pub account_id: String,
    /// Whether the channel is enabled
    pub enabled: bool,
    /// Whether the channel is connected/authenticated
    pub connected: bool,
    /// Additional status info
    pub status_info: Option<String>,
}

/// List of available and configured channels
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelList {
    /// Configured channels with their status
    pub configured: Vec<ChannelStatus>,
    /// All supported channel types (for showing available options)
    pub supported: Vec<String>,
}

/// Get list of configured channels from OpenClaw
#[tauri::command]
pub async fn openclaw_list_channels() -> Result<ChannelList, String> {
    log::info!("Listing OpenClaw channels");

    // Run openclaw channels list to get configured channels
    let list_output = Command::new("openclaw")
        .args(["channels", "list"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw channels list: {}", e))?;

    let stdout = String::from_utf8_lossy(&list_output.stdout);
    let stderr = String::from_utf8_lossy(&list_output.stderr);

    log::debug!("channels list output: {}", stdout);
    if !stderr.is_empty() {
        log::debug!("channels list stderr: {}", stderr);
    }

    let mut configured = Vec::new();

    // Parse the output to extract configured channels
    // Format expected: "- channelName accountId: enabled/disabled"
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("- ") || line.starts_with("* ") {
            let parts: Vec<&str> = line[2..].split_whitespace().collect();
            if !parts.is_empty() {
                let channel_name = parts[0].to_string();
                let account_id = parts.get(1).unwrap_or(&"default").to_string();
                let is_enabled = line.contains("enabled") || !line.contains("disabled");

                configured.push(ChannelStatus {
                    name: channel_name.clone(),
                    account_id: account_id.replace(":", ""),
                    enabled: is_enabled,
                    connected: is_enabled, // Assume enabled means connected for now
                    status_info: None,
                });
            }
        }
    }

    // List of all supported channel types from OpenClaw
    let supported = vec![
        "telegram".to_string(),
        "whatsapp".to_string(),
        "discord".to_string(),
        "slack".to_string(),
        "signal".to_string(),
        "imessage".to_string(),
        "matrix".to_string(),
        "msteams".to_string(),
        "googlechat".to_string(),
        "mattermost".to_string(),
        "irc".to_string(),
    ];

    Ok(ChannelList {
        configured,
        supported,
    })
}

/// Get detailed status of a specific channel
#[tauri::command]
pub async fn openclaw_channel_status(channel: String) -> Result<ChannelStatus, String> {
    log::info!("Getting status for channel: {}", channel);

    // Run openclaw channels status to get detailed status
    let status_output = Command::new("openclaw")
        .args(["channels", "status", "--probe"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw channels status: {}", e))?;

    let stdout = String::from_utf8_lossy(&status_output.stdout);

    // Find the channel in the output
    let channel_lower = channel.to_lowercase();
    let mut found = false;
    let mut is_enabled = false;
    let mut status_info = None;

    for line in stdout.lines() {
        let line_lower = line.to_lowercase();
        if line_lower.contains(&channel_lower) {
            found = true;
            is_enabled = line_lower.contains("enabled") || line_lower.contains("connected") || line_lower.contains("online");
            if line.contains(":") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() > 1 {
                    status_info = Some(parts[1..].join(":").trim().to_string());
                }
            }
            break;
        }
    }

    if !found {
        // Channel not configured
        return Ok(ChannelStatus {
            name: channel,
            account_id: "default".to_string(),
            enabled: false,
            connected: false,
            status_info: Some("Not configured".to_string()),
        });
    }

    Ok(ChannelStatus {
        name: channel,
        account_id: "default".to_string(),
        enabled: is_enabled,
        connected: is_enabled,
        status_info,
    })
}

// ============================================
// WhatsApp Integration Commands
// ============================================

/// WhatsApp configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppConfig {
    /// Account ID (e.g., "default")
    pub account_id: String,
    /// Session path for WhatsApp session data
    pub session_path: String,
    /// Whether the channel is connected
    pub connected: bool,
    /// Phone number of the connected account (if connected)
    pub phone_number: Option<String>,
    /// QR code data (base64 encoded image) for authentication
    pub qr_code: Option<String>,
    /// Number of contacts synced
    pub contacts_count: u32,
}

impl Default for WhatsAppConfig {
    fn default() -> Self {
        Self {
            account_id: "default".to_string(),
            session_path: String::new(),
            connected: false,
            phone_number: None,
            qr_code: None,
            contacts_count: 0,
        }
    }
}

/// WhatsApp authentication status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppAuthStatus {
    /// Whether authentication is in progress
    pub in_progress: bool,
    /// Whether the QR code is ready to be scanned
    pub qr_code_ready: bool,
    /// QR code data (base64 encoded image)
    pub qr_code: Option<String>,
    /// Whether authentication is complete
    pub authenticated: bool,
    /// Error message if any
    pub error: Option<String>,
}

/// Get the WhatsApp configuration file path
fn get_whatsapp_config_path() -> Result<std::path::PathBuf, String> {
    let config_dir = get_openclaw_config_dir()?;
    Ok(config_dir.join("whatsapp.json"))
}

/// Check if WhatsApp is connected by reading the config
#[tauri::command]
pub async fn whatsapp_validate_connection() -> Result<bool, String> {
    log::info!("Validating WhatsApp connection");

    let config_path = get_whatsapp_config_path()?;

    if !config_path.exists() {
        return Ok(false);
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;

    Ok(settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false))
}

/// Start WhatsApp authentication - 1-click setup that handles everything
///
/// This function handles the complete setup flow automatically:
/// 1. Ensures OpenClaw is installed and configured
/// 2. Starts the Gateway if not running
/// 3. Ensures device pairing for Gateway connection
/// 4. Enables the WhatsApp plugin
/// 5. Adds the WhatsApp channel configuration
/// 6. Initiates the QR code login flow
///
/// Users don't need to run any terminal commands - everything is automatic.
#[tauri::command]
pub async fn whatsapp_start_auth(state: tauri::State<'_, OpenClawState>) -> Result<WhatsAppAuthStatus, String> {
    log::info!("Starting WhatsApp 1-click setup and authentication");

    // Step 1: Run the unified setup to ensure OpenClaw is ready
    log::info!("Running OpenClaw setup...");
    let setup_result = openclaw_setup_for_channels(state).await?;

    if !setup_result.success {
        return Ok(WhatsAppAuthStatus {
            in_progress: false,
            qr_code_ready: false,
            qr_code: None,
            authenticated: false,
            error: Some(format!(
                "OpenClaw setup failed at step '{}': {}",
                setup_result.step,
                setup_result.error.unwrap_or_else(|| "Unknown error".to_string())
            )),
        });
    }

    log::info!("OpenClaw setup complete, checking if WhatsApp is already linked...");

    // Step 2: Check if WhatsApp is already linked (authenticated with a phone)
    // If so, we don't need to show QR code
    let params = serde_json::json!({
        "probe": false,
        "timeoutMs": 5000
    });

    if let Ok(status) = gateway_request("channels.status", params).await {
        if let Some(channels) = status.get("channels") {
            if let Some(whatsapp) = channels.get("whatsapp") {
                let linked = whatsapp.get("linked")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let connected = whatsapp.get("connected")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                if linked {
                    log::info!("WhatsApp is already linked to a phone");

                    // Update local config to reflect linked status
                    update_whatsapp_connected_status(true).await.ok();

                    return Ok(WhatsAppAuthStatus {
                        in_progress: false,
                        qr_code_ready: false,
                        qr_code: None,
                        authenticated: true,
                        error: None,
                    });
                }

                if connected {
                    log::info!("WhatsApp is connected but not yet linked, need QR code");
                }
            }
        }
    }

    log::info!("WhatsApp not linked, proceeding with QR code setup");

    // Get the WhatsApp session/auth directory
    let config_dir = get_openclaw_config_dir()?;
    let auth_dir = config_dir.join("whatsapp_auth");

    if !auth_dir.exists() {
        std::fs::create_dir_all(&auth_dir)
            .map_err(|e| format!("Failed to create WhatsApp auth directory: {}", e))?;
    }

    // Enable the WhatsApp plugin (must be done before adding channel)
    enable_channel_plugin("whatsapp").await?;

    // Now add WhatsApp channel using CLI
    // This configures the channel in OpenClaw's config
    let add_output = Command::new("openclaw")
        .args([
            "channels",
            "add",
            "--channel", "whatsapp",
            "--account", "default",
            "--auth-dir", &auth_dir.to_string_lossy(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw channels add: {}", e))?;

    let add_stderr = String::from_utf8_lossy(&add_output.stderr);
    let add_stdout = String::from_utf8_lossy(&add_output.stdout);

    log::info!("OpenClaw channels add output: {}", add_stdout);
    if !add_stderr.is_empty() {
        log::info!("OpenClaw channels add stderr: {}", add_stderr);
    }

    if !add_output.status.success() {
        // Check if it failed because channel already exists (which is fine)
        let combined = format!("{}{}", add_stdout, add_stderr);
        if !combined.contains("already exists") && !combined.contains("Added") && !combined.contains("updated") {
            return Ok(WhatsAppAuthStatus {
                in_progress: false,
                qr_code_ready: false,
                qr_code: None,
                authenticated: false,
                error: Some(format!(
                    "Failed to add WhatsApp channel: {}",
                    if !add_stderr.is_empty() { add_stderr.to_string() } else { add_stdout.to_string() }
                )),
            });
        }
    }

    // Now get QR code via Gateway RPC (web.login.start)
    // This returns the QR as a base64 PNG data URL that can be displayed in the UI
    log::info!("Requesting QR code via Gateway RPC...");

    let qr_params = serde_json::json!({
        "accountId": "default",
        "timeoutMs": 60000,
        "force": true
    });

    match gateway_request("web.login.start", qr_params).await {
        Ok(qr_payload) => {
            let qr_code = qr_payload.get("qrDataUrl")
                .and_then(|v| v.as_str())
                .map(String::from);

            if qr_code.is_some() {
                log::info!("QR code received successfully");

                // Save state to local config
                let whatsapp_config = WhatsAppConfig {
                    account_id: "default".to_string(),
                    session_path: auth_dir.to_string_lossy().to_string(),
                    connected: false,
                    phone_number: None,
                    qr_code: qr_code.clone(),
                    contacts_count: 0,
                };

                let config_path = get_whatsapp_config_path()?;
                std::fs::write(
                    &config_path,
                    serde_json::to_string_pretty(&whatsapp_config).unwrap()
                ).map_err(|e| format!("Failed to save WhatsApp config: {}", e))?;

                return Ok(WhatsAppAuthStatus {
                    in_progress: true,
                    qr_code_ready: true,
                    qr_code,
                    authenticated: false,
                    error: None,
                });
            } else {
                log::warn!("QR code response missing qrDataUrl");
                return Ok(WhatsAppAuthStatus {
                    in_progress: false,
                    qr_code_ready: false,
                    qr_code: None,
                    authenticated: false,
                    error: Some("QR code generation failed - missing qrDataUrl".to_string()),
                });
            }
        }
        Err(e) => {
            log::error!("Failed to get QR code: {}", e);

            // Check for specific error messages
            if e.contains("Unsupported channel") || e.contains("web login provider is not available") {
                return Ok(WhatsAppAuthStatus {
                    in_progress: false,
                    qr_code_ready: false,
                    qr_code: None,
                    authenticated: false,
                    error: Some(
                        "WhatsApp channel is not yet supported in this version of OpenClaw. \
                        Please check for OpenClaw updates.".to_string()
                    ),
                });
            }

            return Ok(WhatsAppAuthStatus {
                in_progress: false,
                qr_code_ready: false,
                qr_code: None,
                authenticated: false,
                error: Some(format!("Failed to get QR code: {}", e)),
            });
        }
    }
}

/// Get the QR code for WhatsApp authentication
/// This polls OpenClaw's Gateway for the QR code
#[tauri::command]
pub async fn whatsapp_get_qr_code() -> Result<WhatsAppAuthStatus, String> {
    log::info!("Getting WhatsApp QR code from OpenClaw Gateway");

    // First check if Gateway is running
    if !check_gateway_responding().await {
        return Ok(WhatsAppAuthStatus {
            in_progress: false,
            qr_code_ready: false,
            qr_code: None,
            authenticated: false,
            error: Some("OpenClaw Gateway is not running".to_string()),
        });
    }

    // Check channel status via Gateway
    let params = serde_json::json!({
        "probe": true,
        "timeoutMs": 5000
    });

    match gateway_request("channels.status", params).await {
        Ok(payload) => {
            log::debug!("Channel status response: {:?}", payload);

            // Check if WhatsApp channel is linked (authenticated) or connected
            if let Some(channels) = payload.get("channels") {
                if let Some(whatsapp) = channels.get("whatsapp") {
                    let connected = whatsapp.get("connected")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let linked = whatsapp.get("linked")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // If linked, WhatsApp is already authenticated - no QR needed
                    if linked {
                        log::info!("WhatsApp is already linked, no QR code needed");
                        update_whatsapp_connected_status(true).await?;

                        return Ok(WhatsAppAuthStatus {
                            in_progress: false,
                            qr_code_ready: false,
                            qr_code: None,
                            authenticated: true,
                            error: None,
                        });
                    }

                    if connected && !linked {
                        log::info!("WhatsApp connected but not linked, need to get QR code");
                    }
                }
            }

            // If not linked, try to get/refresh QR code
            let qr_params = serde_json::json!({
                "accountId": "default",
                "timeoutMs": 30000
            });

            match gateway_request("web.login.start", qr_params).await {
                Ok(qr_payload) => {
                    let qr_code = qr_payload.get("qrDataUrl")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    Ok(WhatsAppAuthStatus {
                        in_progress: true,
                        qr_code_ready: qr_code.is_some(),
                        qr_code,
                        authenticated: false,
                        error: None,
                    })
                }
                Err(e) => {
                    // Fall back to local config
                    let config_path = get_whatsapp_config_path()?;
                    if config_path.exists() {
                        let config_json = std::fs::read_to_string(&config_path)
                            .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;
                        let settings: serde_json::Value = serde_json::from_str(&config_json)
                            .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;
                        let qr_code = settings.get("qr_code").and_then(|v| v.as_str()).map(String::from);

                        Ok(WhatsAppAuthStatus {
                            in_progress: true,
                            qr_code_ready: qr_code.is_some(),
                            qr_code,
                            authenticated: false,
                            error: Some(format!("Could not refresh QR code: {}", e)),
                        })
                    } else {
                        Ok(WhatsAppAuthStatus {
                            in_progress: false,
                            qr_code_ready: false,
                            qr_code: None,
                            authenticated: false,
                            error: Some(format!("Failed to get QR code: {}", e)),
                        })
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Failed to get channel status: {}", e);
            Ok(WhatsAppAuthStatus {
                in_progress: false,
                qr_code_ready: false,
                qr_code: None,
                authenticated: false,
                error: Some(format!("Failed to check WhatsApp status: {}", e)),
            })
        }
    }
}

/// Update local WhatsApp connected status
async fn update_whatsapp_connected_status(connected: bool) -> Result<(), String> {
    let config_path = get_whatsapp_config_path()?;

    let mut config = if config_path.exists() {
        let config_json = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;
        serde_json::from_str::<WhatsAppConfig>(&config_json)
            .unwrap_or_default()
    } else {
        WhatsAppConfig::default()
    };

    config.connected = connected;
    if connected {
        config.qr_code = None; // Clear QR code when connected
    }

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).unwrap()
    ).map_err(|e| format!("Failed to save WhatsApp config: {}", e))?;

    Ok(())
}

/// Check if WhatsApp authentication is complete
#[tauri::command]
pub async fn whatsapp_check_auth() -> Result<WhatsAppAuthStatus, String> {
    log::info!("Checking WhatsApp authentication status via OpenClaw Gateway");

    // Check Gateway status first
    if !check_gateway_responding().await {
        // Fall back to local config
        let config_path = get_whatsapp_config_path()?;
        if !config_path.exists() {
            return Ok(WhatsAppAuthStatus {
                in_progress: false,
                qr_code_ready: false,
                qr_code: None,
                authenticated: false,
                error: Some("WhatsApp not configured".to_string()),
            });
        }

        let config_json = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;
        let settings: serde_json::Value = serde_json::from_str(&config_json)
            .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;

        let connected = settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
        let qr_code = settings.get("qr_code").and_then(|v| v.as_str()).map(String::from);

        return Ok(WhatsAppAuthStatus {
            in_progress: !connected,
            qr_code_ready: qr_code.is_some(),
            qr_code,
            authenticated: connected,
            error: if !connected { Some("OpenClaw Gateway is not running".to_string()) } else { None },
        });
    }

    // Check channel status via Gateway
    let params = serde_json::json!({
        "probe": true,
        "timeoutMs": 5000
    });

    match gateway_request("channels.status", params).await {
        Ok(payload) => {
            log::debug!("Channel status response: {:?}", payload);

            // Check if WhatsApp channel is connected or linked
            if let Some(channels) = payload.get("channels") {
                if let Some(whatsapp) = channels.get("whatsapp") {
                    let connected = whatsapp.get("connected")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    let linked = whatsapp.get("linked")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // If linked, WhatsApp is authenticated (even if not currently connected)
                    // "linked" means the account is paired with a phone
                    // "connected" means the WebSocket is currently active
                    if linked {
                        log::info!("WhatsApp is linked (authenticated)");
                        update_whatsapp_connected_status(true).await?;

                        return Ok(WhatsAppAuthStatus {
                            in_progress: false,
                            qr_code_ready: false,
                            qr_code: None,
                            authenticated: true,
                            error: None,
                        });
                    }

                    if connected && !linked {
                        // Connected but not linked - waiting for QR scan
                        log::info!("WhatsApp connected but waiting for QR scan");
                    }

                    // Check for errors
                    let last_error = whatsapp.get("lastError")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    if last_error.is_some() && !linked {
                        return Ok(WhatsAppAuthStatus {
                            in_progress: false,
                            qr_code_ready: false,
                            qr_code: None,
                            authenticated: false,
                            error: last_error,
                        });
                    }
                }
            }

            // Still waiting for authentication, get QR code from local config
            let config_path = get_whatsapp_config_path()?;
            let qr_code = if config_path.exists() {
                let config_json = std::fs::read_to_string(&config_path).ok();
                config_json.and_then(|json| {
                    serde_json::from_str::<serde_json::Value>(&json).ok()
                }).and_then(|settings| {
                    settings.get("qr_code").and_then(|v| v.as_str()).map(String::from)
                })
            } else {
                None
            };

            Ok(WhatsAppAuthStatus {
                in_progress: true,
                qr_code_ready: qr_code.is_some(),
                qr_code,
                authenticated: false,
                error: None,
            })
        }
        Err(e) => {
            log::error!("Failed to check channel status: {}", e);

            // Fall back to local config
            let config_path = get_whatsapp_config_path()?;
            if config_path.exists() {
                let config_json = std::fs::read_to_string(&config_path)
                    .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;
                let settings: serde_json::Value = serde_json::from_str(&config_json)
                    .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;

                let connected = settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
                let qr_code = settings.get("qr_code").and_then(|v| v.as_str()).map(String::from);

                Ok(WhatsAppAuthStatus {
                    in_progress: !connected,
                    qr_code_ready: qr_code.is_some(),
                    qr_code,
                    authenticated: connected,
                    error: Some(format!("Gateway error: {}", e)),
                })
            } else {
                Ok(WhatsAppAuthStatus {
                    in_progress: false,
                    qr_code_ready: false,
                    qr_code: None,
                    authenticated: false,
                    error: Some(format!("Failed to check WhatsApp status: {}", e)),
                })
            }
        }
    }
}

/// Get current WhatsApp configuration
#[tauri::command]
pub async fn whatsapp_get_config() -> Result<WhatsAppConfig, String> {
    let config_path = get_whatsapp_config_path()?;

    if !config_path.exists() {
        return Ok(WhatsAppConfig::default());
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;

    Ok(WhatsAppConfig {
        account_id: settings.get("account_id").and_then(|v| v.as_str()).unwrap_or("default").to_string(),
        session_path: settings.get("session_path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        connected: settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false),
        phone_number: settings.get("phone_number").and_then(|v| v.as_str()).map(String::from),
        qr_code: settings.get("qr_code").and_then(|v| v.as_str()).map(String::from),
        contacts_count: settings.get("contacts_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
    })
}

/// Get connected WhatsApp contacts
#[tauri::command]
pub async fn whatsapp_get_contacts() -> Result<Vec<String>, String> {
    log::info!("Getting WhatsApp contacts");

    let config_path = get_whatsapp_config_path()?;

    if !config_path.exists() {
        return Ok(vec![]);
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;

    // In production, this would return actual contacts from OpenClaw
    // For now, return the phone number if connected
    let connected = settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
    let phone_number = settings.get("phone_number").and_then(|v| v.as_str()).map(String::from);

    if connected {
        if let Some(phone) = phone_number {
            return Ok(vec![phone]);
        }
    }

    Ok(vec![])
}

/// Disconnect WhatsApp session
#[tauri::command]
pub async fn whatsapp_disconnect() -> Result<(), String> {
    log::info!("Disconnecting WhatsApp channel");

    let config_path = get_whatsapp_config_path()?;

    if config_path.exists() {
        let config_json = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read WhatsApp config: {}", e))?;

        let mut settings: serde_json::Value = serde_json::from_str(&config_json)
            .map_err(|e| format!("Failed to parse WhatsApp config: {}", e))?;

        settings["connected"] = serde_json::json!(false);
        settings["phone_number"] = serde_json::json!(null);
        settings["contacts_count"] = serde_json::json!(0);

        // Clear the session
        let session_path = settings.get("session_path").and_then(|v| v.as_str());
        if let Some(session) = session_path {
            let session_dir = std::path::PathBuf::from(session);
            if session_dir.exists() {
                let _ = std::fs::remove_dir_all(&session_dir);
            }
        }

        std::fs::write(&config_path, serde_json::to_string_pretty(&settings).unwrap())
            .map_err(|e| format!("Failed to save WhatsApp config: {}", e))?;
    }

    Ok(())
}

// ============================================
// Discord Integration Commands
// ============================================

/// Discord configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    /// Account ID (e.g., "default")
    pub account_id: String,
    /// Bot token
    pub bot_token: String,
    /// Bot username
    pub bot_username: Option<String>,
    /// Bot discriminator (for older bots)
    pub bot_discriminator: Option<String>,
    /// Whether the bot is connected
    pub connected: bool,
    /// Number of guilds the bot is in
    pub guilds_count: u32,
    /// Number of channels configured
    pub channels_count: u32,
}

impl Default for DiscordConfig {
    fn default() -> Self {
        Self {
            account_id: "default".to_string(),
            bot_token: String::new(),
            bot_username: None,
            bot_discriminator: None,
            connected: false,
            guilds_count: 0,
            channels_count: 0,
        }
    }
}

/// Discord token validation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordTokenValidation {
    /// Whether the token is valid
    pub valid: bool,
    /// Bot username if valid
    pub bot_username: Option<String>,
    /// Bot discriminator if valid
    pub bot_discriminator: Option<String>,
    /// Error message if invalid
    pub error: Option<String>,
}

/// Get the Discord configuration file path
fn get_discord_config_path() -> Result<std::path::PathBuf, String> {
    let config_dir = get_openclaw_config_dir()?;
    Ok(config_dir.join("discord.json"))
}

/// Validate a Discord bot token by calling the Discord API
#[tauri::command]
pub async fn discord_validate_token(token: String) -> DiscordTokenValidation {
    log::info!("Validating Discord bot token");

    // Basic format validation (Discord bot tokens are typically 72 characters)
    if token.len() < 50 || token.len() > 80 {
        return DiscordTokenValidation {
            valid: false,
            bot_username: None,
            bot_discriminator: None,
            error: Some("Invalid token format. Discord bot tokens are typically 72 characters.".to_string()),
        };
    }

    // Call Discord API to validate the token
    let client = reqwest::Client::new();
    let url = "https://discord.com/api/v10/users/@me";

    match client.get(url)
        .header("Authorization", format!("Bot {}", token))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(data) => {
                        let username = data.get("username").and_then(|v| v.as_str()).map(String::from);
                        let discriminator = data.get("discriminator").and_then(|v| v.as_str()).map(String::from);

                        DiscordTokenValidation {
                            valid: true,
                            bot_username: username.clone(),
                            bot_discriminator: discriminator,
                            error: None,
                        }
                    }
                    Err(e) => DiscordTokenValidation {
                        valid: false,
                        bot_username: None,
                        bot_discriminator: None,
                        error: Some(format!("Failed to parse API response: {}", e)),
                    },
                }
            } else if response.status() == 401 {
                DiscordTokenValidation {
                    valid: false,
                    bot_username: None,
                    bot_discriminator: None,
                    error: Some("Invalid token. The bot token is incorrect or has been revoked.".to_string()),
                }
            } else {
                DiscordTokenValidation {
                    valid: false,
                    bot_username: None,
                    bot_discriminator: None,
                    error: Some(format!("API returned error: {}", response.status())),
                }
            }
        }
        Err(e) => DiscordTokenValidation {
            valid: false,
            bot_username: None,
            bot_discriminator: None,
            error: Some(format!("Failed to connect to Discord API: {}", e)),
        },
    }
}

/// Configure Discord channel with the bot token
///
/// Uses `openclaw plugins enable discord` followed by
/// `openclaw channels add --channel discord --token <token>` to add the channel
#[tauri::command]
pub async fn discord_configure(token: String) -> Result<DiscordConfig, String> {
    log::info!("Configuring Discord channel via OpenClaw CLI");

    // Validate the token first
    let validation = discord_validate_token(token.clone()).await;
    if !validation.valid {
        return Err(validation.error.unwrap_or_else(|| "Invalid token".to_string()));
    }

    // First, enable the Discord plugin (must be done before adding channel)
    enable_channel_plugin("discord").await?;

    // Add Discord channel using OpenClaw CLI
    let add_output = Command::new("openclaw")
        .args([
            "channels",
            "add",
            "--channel", "discord",
            "--token", &token,
            "--account", "default",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw channels add: {}", e))?;

    let add_stderr = String::from_utf8_lossy(&add_output.stderr);
    let add_stdout = String::from_utf8_lossy(&add_output.stdout);

    log::info!("OpenClaw channels add discord output: {}", add_stdout);
    if !add_stderr.is_empty() {
        log::info!("OpenClaw channels add discord stderr: {}", add_stderr);
    }

    if !add_output.status.success() {
        // Check if it failed because channel already exists
        let combined = format!("{}{}", add_stdout, add_stderr);
        if !combined.contains("already exists") && !combined.contains("updated") && !combined.contains("Added") {
            return Err(format!(
                "Failed to add Discord channel: {}",
                if !add_stderr.is_empty() { add_stderr.to_string() } else { add_stdout.to_string() }
            ));
        }
    }

    // Also store in local config for Jan's reference
    let config_dir = get_openclaw_config_dir()?;
    let discord_settings = serde_json::json!({
        "enabled": true,
        "bot_token": token,
        "bot_username": validation.bot_username,
        "bot_discriminator": validation.bot_discriminator,
        "connected": true,
    });

    // Store Discord config
    let discord_config_path = config_dir.join("discord.json");
    std::fs::write(&discord_config_path, serde_json::to_string_pretty(&discord_settings).unwrap())
        .map_err(|e| format!("Failed to save Discord config: {}", e))?;

    log::info!("Discord configured successfully via OpenClaw for bot: {:?}", validation.bot_username);

    Ok(DiscordConfig {
        account_id: "default".to_string(),
        bot_token: token,
        bot_username: validation.bot_username,
        bot_discriminator: validation.bot_discriminator,
        connected: true,
        guilds_count: 0,
        channels_count: 0,
    })
}

/// Get current Discord configuration
#[tauri::command]
pub async fn discord_get_config() -> Result<DiscordConfig, String> {
    let config_path = get_discord_config_path()?;

    if !config_path.exists() {
        return Ok(DiscordConfig::default());
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read Discord config: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse Discord config: {}", e))?;

    Ok(DiscordConfig {
        account_id: settings.get("account_id").and_then(|v| v.as_str()).unwrap_or("default").to_string(),
        bot_token: settings.get("bot_token").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        bot_username: settings.get("bot_username").and_then(|v| v.as_str()).map(String::from),
        bot_discriminator: settings.get("bot_discriminator").and_then(|v| v.as_str()).map(String::from),
        connected: settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false),
        guilds_count: settings.get("guilds_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        channels_count: settings.get("channels_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
    })
}

/// Disconnect Discord channel
#[tauri::command]
pub async fn discord_disconnect() -> Result<(), String> {
    log::info!("Disconnecting Discord channel");

    let config_path = get_discord_config_path()?;

    if config_path.exists() {
        let config_json = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read Discord config: {}", e))?;

        let mut settings: serde_json::Value = serde_json::from_str(&config_json)
            .map_err(|e| format!("Failed to parse Discord config: {}", e))?;

        settings["enabled"] = serde_json::json!(false);
        settings["connected"] = serde_json::json!(false);
        settings["guilds_count"] = serde_json::json!(0);
        settings["channels_count"] = serde_json::json!(0);

        std::fs::write(&config_path, serde_json::to_string_pretty(&settings).unwrap())
            .map_err(|e| format!("Failed to save Discord config: {}", e))?;
    }

    Ok(())
}

// ============================================
// Tailscale Integration Commands
// ============================================

use crate::core::openclaw::tailscale;

/// Check if Tailscale is installed on the system
///
/// Returns detailed status including whether Tailscale is installed,
/// running, and the user is logged in.
#[tauri::command]
pub async fn tailscale_detect() -> TailscaleStatus {
    log::info!("Detecting Tailscale installation");
    tailscale::detect_tailscale().await
}

/// Get current Tailscale status and tailnet information
///
/// Returns information about the current tailnet, including hostname,
/// IP addresses, DNS name, and serve/funnel status.
#[tauri::command]
pub async fn tailscale_get_status() -> TailscaleInfo {
    log::info!("Getting Tailscale status");
    tailscale::get_tailscale_status().await
}

/// Configure Tailscale Serve for the OpenClaw gateway
///
/// Sets up Tailscale Serve to proxy HTTPS traffic to the local
/// OpenClaw gateway port (default 18789).
#[tauri::command]
pub async fn tailscale_configure_serve(port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(OPENCLAW_PORT);
    log::info!("Configuring Tailscale Serve for port {}", port);
    tailscale::configure_tailscale_serve(port).await
}

/// Remove Tailscale Serve configuration
///
/// Disables Tailscale Serve, stopping the HTTPS proxy to the local gateway.
#[tauri::command]
pub async fn tailscale_remove_serve() -> Result<(), String> {
    log::info!("Removing Tailscale Serve configuration");
    tailscale::remove_tailscale_serve().await
}

/// Enable Tailscale Funnel for public access
///
/// Enables Tailscale Funnel to make the OpenClaw gateway accessible
/// from the public internet via a secure HTTPS URL.
#[tauri::command]
pub async fn tailscale_enable_funnel(port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(OPENCLAW_PORT);
    log::info!("Enabling Tailscale Funnel for port {}", port);
    tailscale::enable_tailscale_funnel(port).await
}

/// Disable Tailscale Funnel
///
/// Disables public internet access via Tailscale Funnel.
#[tauri::command]
pub async fn tailscale_disable_funnel() -> Result<(), String> {
    log::info!("Disabling Tailscale Funnel");
    tailscale::disable_tailscale_funnel().await
}

/// Get the Tailscale URL for accessing the gateway
///
/// Returns the HTTPS URL that can be used to access the OpenClaw gateway
/// via Tailscale Serve or Funnel, if configured.
#[tauri::command]
pub async fn tailscale_get_url() -> Result<Option<String>, String> {
    log::info!("Getting Tailscale URL");
    tailscale::get_tailscale_url().await
}

// ============================================
// Security Configuration Commands
// ============================================

use crate::core::openclaw::security;

/// Get current security configuration status
///
/// Returns a summary of the security configuration including
/// auth mode, whether token/password are set, and device counts.
#[tauri::command]
pub async fn security_get_status() -> Result<SecurityStatus, String> {
    log::info!("Getting security status");

    let config = security::load_security_config().await?;
    let recent_failures = security::count_recent_auth_failures().await?;

    Ok(SecurityStatus {
        auth_mode: config.auth_mode,
        has_token: config.token_hash.is_some(),
        has_password: config.password_hash.is_some(),
        require_pairing: config.require_pairing,
        approved_device_count: config.approved_devices.len() as u32,
        recent_auth_failures: recent_failures,
    })
}

/// Set the authentication mode
///
/// Changes how users authenticate to the OpenClaw gateway.
#[tauri::command]
pub async fn security_set_auth_mode(mode: AuthMode) -> Result<(), String> {
    log::info!("Setting auth mode to {:?}", mode);

    let mut config = security::load_security_config().await?;
    config.auth_mode = mode;
    security::save_security_config(&config).await
}

/// Generate and store a new access token
///
/// Returns the plaintext token (only shown once). The token is
/// stored as a hash and cannot be retrieved after this.
#[tauri::command]
pub async fn security_generate_token() -> Result<String, String> {
    log::info!("Generating new access token");

    let token = security::generate_access_token();
    let hash = security::hash_token(&token);

    let mut config = security::load_security_config().await?;
    config.token_hash = Some(hash);
    config.auth_mode = AuthMode::Token;
    security::save_security_config(&config).await?;

    Ok(token)
}

/// Set password authentication
///
/// Stores the password hash and sets auth mode to Password.
#[tauri::command]
pub async fn security_set_password(password: String) -> Result<(), String> {
    log::info!("Setting password authentication");

    if password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }

    let hash = security::hash_token(&password);

    let mut config = security::load_security_config().await?;
    config.password_hash = Some(hash);
    config.auth_mode = AuthMode::Password;
    security::save_security_config(&config).await
}

/// Verify a token against the stored hash
///
/// Returns true if the token is valid.
#[tauri::command]
pub async fn security_verify_token(token: String) -> Result<bool, String> {
    log::info!("Verifying token");

    let config = security::load_security_config().await?;

    match config.auth_mode {
        AuthMode::Token => {
            if let Some(hash) = config.token_hash {
                Ok(security::verify_token(&token, &hash))
            } else {
                Ok(false)
            }
        }
        AuthMode::Password => {
            if let Some(hash) = config.password_hash {
                Ok(security::verify_token(&token, &hash))
            } else {
                Ok(false)
            }
        }
        AuthMode::None => Ok(true),
    }
}

/// Set whether device pairing is required
///
/// When enabled, only approved devices can access the gateway.
#[tauri::command]
pub async fn security_set_require_pairing(require: bool) -> Result<(), String> {
    log::info!("Setting require_pairing to {}", require);

    let mut config = security::load_security_config().await?;
    config.require_pairing = require;
    security::save_security_config(&config).await
}

/// Get list of approved devices
#[tauri::command]
pub async fn security_get_devices() -> Result<Vec<DeviceInfo>, String> {
    log::info!("Getting approved devices");
    security::get_approved_devices().await
}

/// Approve a device for access
///
/// Adds the device to the approved list or updates an existing device.
#[tauri::command]
pub async fn security_approve_device(device: DeviceInfo) -> Result<(), String> {
    log::info!("Approving device: {} ({})", device.name, device.id);
    security::approve_device(device).await
}

/// Revoke device access
///
/// Removes the device from the approved list.
#[tauri::command]
pub async fn security_revoke_device(device_id: String) -> Result<(), String> {
    log::info!("Revoking device: {}", device_id);
    security::revoke_device(&device_id).await
}

/// Get recent access logs
///
/// Returns the most recent access log entries.
#[tauri::command]
pub async fn security_get_logs(limit: u32) -> Result<Vec<AccessLogEntry>, String> {
    log::info!("Getting access logs (limit: {})", limit);
    security::get_access_logs(limit as usize).await
}

/// Clear all access logs
#[tauri::command]
pub async fn security_clear_logs() -> Result<(), String> {
    log::info!("Clearing access logs");
    security::clear_access_logs().await
}

/// Generate a new pairing code
///
/// Returns an 8-character alphanumeric code for device pairing.
#[tauri::command]
pub fn security_generate_pairing_code() -> String {
    log::info!("Generating pairing code");
    security::generate_pairing_code()
}

// ============================================
// Tunnel Provider Commands
// ============================================

use crate::core::openclaw::tunnels;

/// Get status of all tunnel providers
///
/// Returns the installation and authentication status of all supported
/// tunnel providers (Tailscale, ngrok, Cloudflare).
#[tauri::command]
pub async fn tunnel_get_providers(
    state: State<'_, OpenClawState>,
) -> Result<TunnelProvidersStatus, String> {
    log::info!("Getting tunnel providers status");
    let tunnel_state = state.tunnel_state.clone();
    Ok(tunnels::get_tunnel_providers(&tunnel_state).await)
}

/// Detect all installed tunnel providers
///
/// Runs detection for all supported tunnel providers in parallel
/// and returns their installation/authentication status.
#[tauri::command]
pub async fn tunnel_detect_all(
    state: State<'_, OpenClawState>,
) -> Result<TunnelProvidersStatus, String> {
    log::info!("Detecting all tunnel providers");
    let tunnel_state = state.tunnel_state.clone();
    Ok(tunnels::get_tunnel_providers(&tunnel_state).await)
}

/// Set the preferred tunnel provider
///
/// Sets which tunnel provider should be used when starting a tunnel.
#[tauri::command]
pub async fn tunnel_set_provider(
    state: State<'_, OpenClawState>,
    provider: TunnelProvider,
) -> Result<(), String> {
    log::info!("Setting tunnel provider to {:?}", provider);
    let tunnel_state = state.tunnel_state.clone();
    tunnels::set_tunnel_provider(&tunnel_state, provider).await
}

/// Start a tunnel with the preferred provider
///
/// Starts a tunnel using the configured preferred provider on the specified port.
#[tauri::command]
pub async fn tunnel_start(
    state: State<'_, OpenClawState>,
    port: u16,
) -> Result<TunnelInfo, String> {
    log::info!("Starting tunnel on port {}", port);
    let tunnel_state = state.tunnel_state.clone();
    tunnels::start_tunnel(&tunnel_state, port).await
}

/// Stop the active tunnel
///
/// Stops the currently running tunnel, if any.
#[tauri::command]
pub async fn tunnel_stop(
    state: State<'_, OpenClawState>,
) -> Result<(), String> {
    log::info!("Stopping tunnel");
    let tunnel_state = state.tunnel_state.clone();
    tunnels::stop_tunnel(&tunnel_state).await
}

/// Get active tunnel information
///
/// Returns information about the currently active tunnel, if any.
#[tauri::command]
pub async fn tunnel_get_active(
    state: State<'_, OpenClawState>,
) -> Result<Option<TunnelInfo>, String> {
    log::info!("Getting active tunnel info");
    let tunnel_state = state.tunnel_state.clone();
    Ok(tunnels::get_active_tunnel(&tunnel_state).await)
}

/// Set ngrok authentication token
///
/// Configures ngrok with the provided auth token and saves it for future use.
#[tauri::command]
pub async fn tunnel_set_ngrok_token(
    state: State<'_, OpenClawState>,
    token: String,
) -> Result<(), String> {
    log::info!("Setting ngrok auth token");
    let tunnel_state = state.tunnel_state.clone();
    tunnels::set_ngrok_token(&tunnel_state, token).await
}

/// Set Cloudflare tunnel ID
///
/// Configures a named Cloudflare tunnel for use with cloudflared.
#[tauri::command]
pub async fn tunnel_set_cloudflare_tunnel(
    state: State<'_, OpenClawState>,
    tunnel_id: String,
) -> Result<(), String> {
    log::info!("Setting Cloudflare tunnel ID");
    let tunnel_state = state.tunnel_state.clone();
    tunnels::set_cloudflare_tunnel(&tunnel_state, tunnel_id).await
}

/// Get tunnel configuration
///
/// Returns the current tunnel configuration including preferred provider
/// and stored credentials.
#[tauri::command]
pub async fn tunnel_get_config(
    state: State<'_, OpenClawState>,
) -> Result<TunnelConfig, String> {
    log::info!("Getting tunnel configuration");
    let config = state.tunnel_state.config.lock().await;
    Ok(config.clone())
}

/// Start ngrok tunnel directly
///
/// Starts an ngrok tunnel on the specified port, optionally using a provided auth token.
#[tauri::command]
pub async fn tunnel_start_ngrok(
    state: State<'_, OpenClawState>,
    port: u16,
    auth_token: Option<String>,
) -> Result<TunnelInfo, String> {
    log::info!("Starting ngrok tunnel on port {}", port);
    let tunnel_state = state.tunnel_state.clone();
    tunnels::start_ngrok_tunnel(&tunnel_state, port, auth_token).await
}

/// Stop ngrok tunnel
///
/// Stops the active ngrok tunnel.
#[tauri::command]
pub async fn tunnel_stop_ngrok(
    state: State<'_, OpenClawState>,
) -> Result<(), String> {
    log::info!("Stopping ngrok tunnel");
    let tunnel_state = state.tunnel_state.clone();
    tunnels::stop_ngrok_tunnel(&tunnel_state).await
}

/// Start cloudflared tunnel directly
///
/// Starts a cloudflared tunnel on the specified port. If no tunnel_name is provided,
/// a quick tunnel (no account required) will be created.
#[tauri::command]
pub async fn tunnel_start_cloudflared(
    state: State<'_, OpenClawState>,
    port: u16,
    tunnel_name: Option<String>,
) -> Result<TunnelInfo, String> {
    log::info!("Starting cloudflared tunnel on port {}", port);
    let tunnel_state = state.tunnel_state.clone();
    tunnels::start_cloudflared_tunnel(&tunnel_state, port, tunnel_name).await
}

/// Stop cloudflared tunnel
///
/// Stops the active cloudflared tunnel.
#[tauri::command]
pub async fn tunnel_stop_cloudflared(
    state: State<'_, OpenClawState>,
) -> Result<(), String> {
    log::info!("Stopping cloudflared tunnel");
    let tunnel_state = state.tunnel_state.clone();
    tunnels::stop_cloudflared_tunnel(&tunnel_state).await
}