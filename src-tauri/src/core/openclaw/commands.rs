use std::process::Stdio;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async_with_config, tungstenite::{self, Message, http::Request}, MaybeTlsStream, WebSocketStream};
use tauri::State;

use crate::core::openclaw::{
    constants::*,
    models::*,
    sandbox::Sandbox,
    get_openclaw_config_path, get_openclaw_config_dir, set_docker_mode, OpenClawState, OPENCLAW_PORT,
};

/// On Windows, prevent console window popups for background commands.
#[cfg(target_os = "windows")]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

#[cfg(not(target_os = "windows"))]
fn hide_window(_cmd: &mut Command) {}

/// Request ID counter for WebSocket messages
static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Container name for the Docker sandbox
const DOCKER_CONTAINER_NAME: &str = "jan-openclaw";

/// Check if the Docker container `jan-openclaw` is running.
async fn is_docker_container_running() -> bool {
    let mut cmd = Command::new("docker");
    cmd.args(["inspect", "--format", "{{.State.Running}}", DOCKER_CONTAINER_NAME]);
    hide_window(&mut cmd);
    cmd.output()
        .await
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

/// Build a `Command` for openclaw: docker exec when container is running,
/// otherwise direct process with bun interpreter (Unix) or native exe (Windows).
async fn openclaw_command(args: &[&str]) -> Command {
    if is_docker_container_running().await {
        let mut cmd = Command::new("docker");
        let mut full_args: Vec<&str> = vec![
            "exec",
            "-e", "OPENCLAW_CONFIG=/home/node/.openclaw/openclaw.json",
            "-e", "HOME=/home/node",
            DOCKER_CONTAINER_NAME,
            "openclaw",
        ];
        full_args.extend_from_slice(args);
        cmd.args(full_args);
        hide_window(&mut cmd);
        cmd
    } else {
        let _ = super::ensure_bun_node_shim();

        let openclaw_path = super::get_openclaw_bin_path().ok();
        let use_installed_binary = openclaw_path
            .as_ref()
            .map(|p| p.exists())
            .unwrap_or(false);
        let bun_path = super::resolve_bundled_bun();
        let use_bun_interpreter = !cfg!(target_os = "windows")
            && use_installed_binary
            && bun_path.is_some();

        let mut cmd = if use_bun_interpreter {
            let mut c = Command::new(bun_path.unwrap());
            c.arg(openclaw_path.unwrap());
            if let Some(new_path) = super::build_augmented_path() {
                c.env("PATH", new_path);
            }
            c.args(args);
            c
        } else if use_installed_binary {
            let mut c = Command::new(openclaw_path.unwrap());
            if let Some(new_path) = super::build_augmented_path() {
                c.env("PATH", new_path);
            }
            c.args(args);
            c
        } else {
            let mut c = Command::new("openclaw");
            if let Some(new_path) = super::build_augmented_path() {
                c.env("PATH", new_path);
            }
            c.args(args);
            c
        };
        hide_window(&mut cmd);
        cmd
    }
}

/// Gateway restart attempts counter during WhatsApp auth polling (reset per session).
static WA_RESTART_COUNT: AtomicU8 = AtomicU8::new(0);
const MAX_WA_RESTART_ATTEMPTS: u8 = 3;

fn next_request_id() -> String {
    REQUEST_ID_COUNTER.fetch_add(1, Ordering::SeqCst).to_string()
}

/// Returns true if `installed` is older than `required` (CalVer comparison).
/// Returns false if either version cannot be parsed.
pub(crate) fn needs_upgrade(installed: &str, required: &str) -> bool {
    let parse = |v: &str| -> Option<Vec<u32>> {
        v.split('.').map(|s| s.parse::<u32>().ok()).collect()
    };
    match (parse(installed), parse(required)) {
        (Some(a), Some(b)) => a < b,
        _ => false,
    }
}

#[derive(Debug, Serialize)]
struct GatewayRequest {
    #[serde(rename = "type")]
    msg_type: String,
    id: String,
    method: String,
    params: serde_json::Value,
}

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

/// Read the gateway auth token from the OpenClaw config file.
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

/// Expose the gateway auth token to the frontend for direct HTTP API access.
#[tauri::command]
pub async fn openclaw_get_auth_token() -> Result<String, String> {
    get_gateway_auth_token().await
}

/// Ensure the OpenClaw HTTP chat completions endpoint is enabled in the config.
/// This is required for Jan's agent mode to send messages via POST /v1/chat/completions.
/// Uses `or_insert` semantics — only adds the field if missing, never overwrites.
#[tauri::command]
pub async fn openclaw_ensure_http_api() -> Result<bool, String> {
    let mut config = read_openclaw_config()?;

    let enabled = config
        .pointer("/gateway/http/endpoints/chatCompletions/enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if enabled {
        return Ok(false); // already enabled, no change
    }

    // Deep-set gateway.http.endpoints.chatCompletions.enabled = true
    let gw = config.get_mut("gateway")
        .and_then(|v| v.as_object_mut())
        .ok_or("Missing gateway config")?;
    let http = gw.entry("http")
        .or_insert_with(|| serde_json::json!({}));
    let endpoints = http.as_object_mut()
        .ok_or("Invalid gateway.http")?
        .entry("endpoints")
        .or_insert_with(|| serde_json::json!({}));
    let cc = endpoints.as_object_mut()
        .ok_or("Invalid gateway.http.endpoints")?
        .entry("chatCompletions")
        .or_insert_with(|| serde_json::json!({}));
    cc.as_object_mut()
        .ok_or("Invalid gateway.http.endpoints.chatCompletions")?
        .insert("enabled".to_string(), serde_json::json!(true));

    write_openclaw_config(&config)?;
    log::info!("Enabled OpenClaw HTTP chat completions endpoint");
    Ok(true) // config was changed
}

/// Connect to the OpenClaw Gateway WebSocket with required Origin header.
async fn connect_to_gateway() -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, String> {
    let url = format!("ws://127.0.0.1:{}", OPENCLAW_PORT);

    // Origin header required for CVE-2026-25253 validation
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

/// Perform the Gateway handshake (connect request) using protocol v3.
async fn gateway_handshake(ws_stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>) -> Result<(), String> {
    let timeout = tokio::time::Duration::from_secs(5);
    let challenge_result = tokio::time::timeout(timeout, async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    log::debug!("Received during handshake: {}", text);
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                        if event.get("type").and_then(|t| t.as_str()) == Some("event")
                           && event.get("event").and_then(|e| e.as_str()) == Some("connect.challenge") {
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

    match challenge_result {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Handshake timeout".to_string()),
    };

    // client.id "openclaw-control-ui" enables dangerouslyDisableDeviceAuth bypass
    let connect_id = next_request_id();
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

    log::debug!("Connect request: {}", request_json);

    ws_stream.send(Message::Text(request_json))
        .await
        .map_err(|e| format!("Failed to send connect request: {}", e))?;

    let response_result = tokio::time::timeout(timeout, async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    log::debug!("Received connect response: {}", text);
                    if let Ok(response) = serde_json::from_str::<GatewayResponse>(&text) {
                        if response.msg_type == "res" && response.id == connect_id {
                            if response.ok {
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
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Connect response timeout".to_string()),
    }
}

/// Send a request to the Gateway and wait for response with configurable timeout.
async fn gateway_request_with_timeout(
    method: &str,
    params: serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let _ = openclaw_ensure_jan_origin().await;

    let mut ws_stream = connect_to_gateway().await?;
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

    log::debug!("Sending Gateway request: {}", request_json);

    ws_stream.send(Message::Text(request_json))
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    let timeout = tokio::time::Duration::from_secs(timeout_secs);
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

    let _ = ws_stream.close(None).await;

    match result {
        Ok(inner) => inner,
        Err(_) => Err("Request timed out".to_string()),
    }
}

/// Send a request to the Gateway with default 30s timeout.
async fn gateway_request(
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    gateway_request_with_timeout(method, params, 30).await
}

// ============================================
// Unified 1-Click Setup Functions
// ============================================

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

/// 1-click setup: ensure OpenClaw is installed, configured, and the Gateway is reachable.
#[tauri::command]
pub async fn openclaw_setup_for_channels(state: tauri::State<'_, OpenClawState>) -> Result<OpenClawSetupResult, String> {

    {
        let sandbox_guard = state.sandbox.lock().await;
        let is_docker = sandbox_guard.as_ref().map(|s| s.name() == "Docker").unwrap_or(false);
        set_docker_mode(is_docker);
    }

    if let Err(e) = clear_stale_openclaw_data().await {
        log::warn!("Failed to clear stale data: {}", e);
    }

    let openclaw_version = match check_openclaw_installed().await {
        Ok(Some(version)) if !needs_upgrade(&version, OPENCLAW_VERSION) => {
            log::info!("OpenClaw installed: {}", version);
            Some(version)
        }
        Ok(maybe_version) => {
            if let Some(ref v) = maybe_version {
                log::info!("OpenClaw {} outdated, upgrading to {}", v, OPENCLAW_VERSION);
            }
            match openclaw_install().await {
                Ok(result) if result.success => {
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
                        message: Some("Please install Bun or Node.js 22+ and OpenClaw manually".to_string()),
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
                        message: Some("Please install Bun or Node.js 22+ and OpenClaw manually".to_string()),
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

    let config_changed = match ensure_gateway_config_for_jan().await {
        Ok(changed) => changed,
        Err(e) => {
            log::warn!("Failed to configure Gateway: {}", e);
            false
        }
    };

    let gateway_running = check_gateway_responding().await;
    if !gateway_running {
        match openclaw_start(state.clone()).await {
            Ok(()) => {
                if !wait_for_gateway_ready(10).await {
                    log::warn!("Gateway did not become responsive within 10s, proceeding anyway");
                }
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
        log::info!("Config changed, restarting Gateway");
        let _ = restart_gateway_cli().await;
        if !wait_for_gateway_ready(10).await {
            log::warn!("Gateway did not become responsive after restart within 10s");
        }
    }

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
        Err(e) => {
            log::warn!("Gateway connection failed: {}, retrying after restart", e);

            let _ = restart_gateway_cli().await;
            if !wait_for_gateway_ready(10).await {
                log::warn!("Gateway did not become responsive after retry restart");
            }

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

/// Test the Gateway connection by performing a handshake only.
async fn test_gateway_connection() -> Result<(), String> {
    let mut ws_stream = connect_to_gateway().await?;
    gateway_handshake(&mut ws_stream).await?;
    let _ = ws_stream.close(None).await;
    Ok(())
}

/// Validate gateway auth via WebSocket handshake + RPC health check.
async fn validate_gateway_auth() -> Result<(), String> {
    let mut ws_stream = connect_to_gateway().await
        .map_err(|e| format!("Gateway unreachable: {}", e))?;

    gateway_handshake(&mut ws_stream).await
        .map_err(|e| format!("Gateway auth failed: {}", e))?;

    let health_id = next_request_id();
    let health_request = serde_json::json!({
        "type": "req",
        "id": health_id,
        "method": "health",
        "params": {}
    });

    let health_json = serde_json::to_string(&health_request)
        .map_err(|e| format!("Failed to serialize health request: {}", e))?;

    ws_stream.send(Message::Text(health_json))
        .await
        .map_err(|e| format!("Failed to send health request: {}", e))?;

    let timeout = tokio::time::Duration::from_secs(5);
    let health_result = tokio::time::timeout(timeout, async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(response) = serde_json::from_str::<GatewayResponse>(&text) {
                        if response.msg_type == "res" && response.id == health_id {
                            if response.ok {
                                return Ok(());
                            } else {
                                let error_msg = response.error
                                    .map(|e| {
                                        e.get("message")
                                            .and_then(|m| m.as_str())
                                            .map(String::from)
                                            .unwrap_or_else(|| e.to_string())
                                    })
                                    .unwrap_or_else(|| "Health check rejected".to_string());
                                return Err(format!("Gateway health check failed: {}", error_msg));
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => return Err("Connection closed during health check".to_string()),
                Err(e) => return Err(format!("WebSocket error during health check: {}", e)),
                _ => {}
            }
        }
        Err("Connection closed before health response".to_string())
    }).await;

    let _ = ws_stream.close(None).await;

    match health_result {
        Ok(inner) => inner,
        Err(_) => Err("Gateway health check timed out".to_string()),
    }
}

/// Auto-fix gateway config issues via `openclaw doctor --fix`.
async fn run_doctor_fix() -> Result<(), String> {
    let output = openclaw_command(&["doctor", "--fix"]).await
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw doctor: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("openclaw doctor --fix failed: {}", stderr);
        Err(format!("Doctor fix failed: {}", stderr.trim()))
    }
}

/// Restart the gateway. Docker: `docker restart`. Direct process: stop → install → start
/// (launchd caches service args, so a plain `gateway restart` won't pick up config changes).
async fn restart_gateway_cli() -> Result<(), String> {
    if is_docker_container_running().await {
        let mut cmd = Command::new("docker");
        cmd.args(["restart", DOCKER_CONTAINER_NAME])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let output = cmd.output()
            .await
            .map_err(|e| format!("Failed to restart Docker container: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("Docker container restart failed: {}", stderr);
        }
        return Ok(());
    }

    let _ = openclaw_command(&["gateway", "stop"]).await
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    // Re-register service with --runtime bun when bundled Bun is available.
    // On Windows this requires admin (schtasks) and may fail.
    let install_args: Vec<&str> = if super::resolve_bundled_bun().is_some() {
        vec!["gateway", "install", "--runtime", "bun"]
    } else {
        vec!["gateway", "install"]
    };
    let install_output = openclaw_command(&install_args).await
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;
    let service_installed = install_output
        .as_ref()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // Patch LaunchAgent plist so macOS shows the Jan app icon
    // in the "Background Items Added" notification.
    #[cfg(target_os = "macos")]
    if service_installed {
        let bundle_id = super::sandbox_direct::resolve_bundle_identifier();
        super::sandbox_direct::patch_launchagent_associated_bundle_id(&bundle_id);
    }

    if service_installed {
        let output = openclaw_command(&["gateway", "start"]).await
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to start gateway: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("Gateway start failed: {}", stderr);
        }
    } else {
        // Service registration failed (e.g. Windows without admin).
        // Spawn `openclaw gateway` as a foreground child process.
        log::info!("Service install unavailable, restarting gateway as child process");
        let mut cmd = openclaw_command(&["gateway"]).await;
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Err(e) = cmd.spawn() {
            log::warn!("Failed to spawn openclaw gateway: {}", e);
        }
    }
    Ok(())
}

/// Clear stale files that may cause setup failures.
async fn clear_stale_openclaw_data() -> Result<(), String> {
    let config_dir = get_openclaw_config_dir()?;

    let stale_files = ["jan_device_key.json", "whatsapp.json"];
    for file in &stale_files {
        let file_path = config_dir.join(file);
        if file_path.exists() {
            match std::fs::remove_file(&file_path) {
                Ok(_) => log::info!("Removed stale file: {}", file),
                Err(e) => log::warn!("Failed to remove {}: {}", file, e),
            }
        }
    }

    // Remove corrupted whatsapp_auth session files (< 10 bytes)
    let whatsapp_auth_dir = config_dir.join("whatsapp_auth");
    if whatsapp_auth_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&whatsapp_auth_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.len() < 10 {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    Ok(())
}

/// Stop the opposing sandbox instance to prevent 409 conflicts when switching modes.
async fn stop_other_sandbox_instance(stop_docker: bool) {
    if stop_docker {
        if is_docker_container_running().await {
            let mut cmd = Command::new("docker");
            cmd.args(["stop", DOCKER_CONTAINER_NAME])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            hide_window(&mut cmd);
            let _ = cmd.output().await;
        }
    } else {
        // Try to use resolved openclaw path first, fallback to bare command
        let openclaw_path = super::get_openclaw_bin_path().ok();
        let use_installed_binary = openclaw_path
            .as_ref()
            .map(|p| p.exists())
            .unwrap_or(false);

        let cli_stopped = if use_installed_binary {
            let mut cmd = Command::new(openclaw_path.unwrap());
            cmd.args(["gateway", "stop"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(new_path) = super::build_augmented_path() {
                cmd.env("PATH", new_path);
            }
            hide_window(&mut cmd);
            cmd.output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            let mut cmd = Command::new("openclaw");
            cmd.args(["gateway", "stop"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(new_path) = super::build_augmented_path() {
                cmd.env("PATH", new_path);
            }
            hide_window(&mut cmd);
            cmd.output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false)
        };

        if !cli_stopped {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let _ = Command::new("pkill")
                    .args(["-f", "openclaw"])
                    .output()
                    .await;
            }

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let kill = |im: &'static str| async move {
                    let mut cmd = Command::new("taskkill");
                    cmd.args(["/F", "/IM", im]);
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                    let _ = cmd.output().await;
                };
                kill("bun.exe").await;
                kill("node.exe").await;
                kill("openclaw.exe").await;
            }
        }

        for _ in 0..10 {
            if !crate::core::openclaw::lifecycle::is_port_in_use(OPENCLAW_PORT).await {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        // Port-based kill fallback
        if crate::core::openclaw::lifecycle::is_port_in_use(OPENCLAW_PORT).await {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let _ = Command::new("sh")
                    .args(["-c", &format!("lsof -ti :{} | xargs kill -9", OPENCLAW_PORT)])
                    .output()
                    .await;
            }

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                if let Ok(output) = Command::new("cmd")
                    .args(["/C", &format!("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a", OPENCLAW_PORT)])
                    .creation_flags(0x08000000)
                    .output()
                    .await
                {
                    let _ = output;
                }
            }
        }
    }
}

/// Ensure the Gateway config has all required settings for Jan.
async fn ensure_gateway_config_for_jan() -> Result<bool, String> {
    let config_path = get_openclaw_config_path()?;

    if !config_path.exists() {
        return Ok(false);
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read OpenClaw config: {}", e))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse OpenClaw config: {}", e))?;

    let mut modified = false;

    if config.get("gateway").is_none() {
        config["gateway"] = serde_json::json!({});
        modified = true;
    }

    if config["gateway"].get("controlUi").is_none() {
        config["gateway"]["controlUi"] = serde_json::json!({});
        modified = true;
    }

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
        }
    }
    if modified {
        config["gateway"]["controlUi"]["allowedOrigins"] = serde_json::Value::Array(new_origins);
    }

    let disable_device_auth = config["gateway"]["controlUi"]
        .get("dangerouslyDisableDeviceAuth")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !disable_device_auth {
        config["gateway"]["controlUi"]["dangerouslyDisableDeviceAuth"] = serde_json::json!(true);
        modified = true;
    }

    // Channels require bind=lan; loopback causes setup errors
    let current_bind = config["gateway"]
        .get("bind")
        .and_then(|v| v.as_str())
        .unwrap_or("loopback");
    if current_bind == "loopback" {
        config["gateway"]["bind"] = serde_json::json!("lan");
        modified = true;
    }

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
    }

    if modified {
        let updated_json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(&config_path, updated_json)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        log::info!("Gateway config updated for Jan");
    }

    Ok(modified)
}


/// Ensure gateway.bind is "lan" in config. If the gateway is running
/// and the config changed, restarts it so the service picks up bind=lan.
async fn ensure_gateway_bind_lan() {
    let config_path = match get_openclaw_config_path() {
        Ok(p) => p,
        Err(_) => return,
    };
    if !config_path.exists() {
        return;
    }

    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut config: serde_json::Value = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return,
    };

    let current_bind = config
        .pointer("/gateway/bind")
        .and_then(|v| v.as_str())
        .unwrap_or("loopback");

    if current_bind == "lan" {
        return;
    }

    config["gateway"]["bind"] = serde_json::json!("lan");
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(&config_path, json);
    }

    if check_gateway_responding().await {
        let _ = restart_gateway_cli().await;
        let _ = wait_for_gateway_ready(10).await;
    }
}

/// Check if bundled Bun or Node.js is installed and meets version requirements.
#[tauri::command]
pub async fn openclaw_check_dependencies() -> NodeCheckResult {
    // First try: bundled Bun
    if let Some(bun_path) = super::resolve_bundled_bun() {
        let mut cmd = tokio::process::Command::new(&bun_path);
        cmd.arg("--version");
        hide_window(&mut cmd);
        let output = cmd.output().await;

        if let Ok(output) = output {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // Bun returns version like "1.2.3", prepend "bun " for clarity
                let version_with_runtime = format!("bun {}", version_output);
                let version_str = version_output.trim_start_matches('v');

                let major_version: Option<u32> = version_str
                    .split('.')
                    .next()
                    .and_then(|v| v.parse().ok());

                // Bun 1.0+ meets requirements
                let meets_requirements = major_version.map(|v| v >= 1).unwrap_or(false);

                return NodeCheckResult {
                    installed: true,
                    version: Some(version_with_runtime),
                    major_version,
                    meets_requirements,
                    error: if !meets_requirements {
                        Some(format!("Bun version {} is required, found {}", super::MIN_BUN_VERSION, version_str))
                    } else {
                        None
                    },
                };
            }
        }
    }

    // Fallback: check for Node.js
    let mut node_cmd = Command::new("node");
    node_cmd.arg("--version");
    hide_window(&mut node_cmd);
    let output = node_cmd.output().await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let version_str = version_output.trim_start_matches('v');

                let major_version: Option<u32> = version_str
                    .split('.')
                    .next()
                    .and_then(|v| v.parse().ok());

                let meets_requirements = major_version
                    .map(|v| v >= 22)
                    .unwrap_or(false);

                let version_clone = version_output.clone();
                NodeCheckResult {
                    installed: true,
                    version: Some(version_clone),
                    major_version,
                    meets_requirements,
                    error: if !meets_requirements {
                        Some(format!("Node.js version 22 is required, found {}", version_str))
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
                    error: Some("Could not find a JavaScript runtime (Bun or Node.js)".to_string()),
                }
            }
        }
        Err(e) => {
            NodeCheckResult {
                installed: false,
                version: None,
                major_version: None,
                meets_requirements: false,
                error: Some(format!("Could not find a JavaScript runtime: {}", e)),
            }
        }
    }
}

/// Check if a port is available.
#[tauri::command]
pub async fn openclaw_check_port(port: u16) -> PortCheckResult {

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

/// Check if OpenClaw is installed and get its version.
async fn check_openclaw_installed() -> Result<Option<String>, String> {
    let output = openclaw_command(&["--version"]).await
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

/// Get OpenClaw version from inside the Docker container.
async fn check_openclaw_version_docker() -> Option<String> {
    let mut cmd = Command::new("docker");
    cmd.args(["exec", "jan-openclaw", "openclaw", "--version"]);
    hide_window(&mut cmd);
    let output = cmd.output().await.ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() { None } else { Some(version) }
    } else {
        None
    }
}

/// Get Node.js version from inside the Docker container.
async fn check_node_version_docker() -> Option<String> {
    let mut cmd = Command::new("docker");
    cmd.args(["exec", "jan-openclaw", "node", "--version"]);
    hide_window(&mut cmd);
    let output = cmd.output().await.ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() { None } else { Some(version) }
    } else {
        None
    }
}

/// Install OpenClaw globally via npm or bun.
#[tauri::command]
pub async fn openclaw_install() -> Result<InstallResult, String> {
    let already_installed = check_openclaw_installed().await.ok().flatten();

    let should_install = match &already_installed {
        None => true,
        Some(version) => needs_upgrade(version, OPENCLAW_VERSION),
    };

    if should_install {
        if let Some(ref old_version) = already_installed {
            log::info!("Upgrading OpenClaw from {} to {}", old_version, OPENCLAW_VERSION);
        }
        let node_check = openclaw_check_dependencies().await;
        if !node_check.installed {
            return Ok(InstallResult {
                success: false,
                version: None,
                error: node_check.error.or_else(|| Some("A JavaScript runtime (Bun or Node.js) is required but not found".to_string())),
            });
        }

        if !node_check.meets_requirements {
            return Ok(InstallResult {
                success: false,
                version: None,
                error: node_check.error,
            });
        }

        let pinned_package = format!("{}@{}", OPENCLAW_PACKAGE_NAME, OPENCLAW_VERSION);

        let _ = super::ensure_bun_node_shim();

        let output = if let Some(bun_path) = super::resolve_bundled_bun() {
            let runtime_dir = super::get_openclaw_runtime_dir()?;
            let mut cmd = tokio::process::Command::new(&bun_path);
            cmd.args(["install", "-g", &pinned_package])
                .env("BUN_INSTALL", runtime_dir.to_string_lossy().as_ref())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            hide_window(&mut cmd);
            cmd.output()
                .await
                .map_err(|e| format!("Failed to run bun install: {}", e))?
        } else {
            let mut cmd = Command::new("npm");
            cmd.args(["install", "-g", &pinned_package])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            hide_window(&mut cmd);
            cmd.output()
                .await
                .map_err(|e| format!("Failed to run npm install: {}", e))?
        };

        if !output.status.success() {
            // Parse error output for better error messages
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);

            let error_message = if stderr.contains("404") || stderr.contains("Not Found") || stdout.contains("404") {
                format!(
                    "OpenClaw package '{}' is not yet available on npm. \
                    Please check the OpenClaw project for installation instructions.",
                    OPENCLAW_PACKAGE_NAME
                )
            } else if stderr.contains("EACCES") || stderr.contains("permission denied") {
                "Permission denied. Try running with administrator privileges.".to_string()
            } else if stderr.contains("ENOTFOUND") || stderr.contains("network") {
                "Network error. Please check your internet connection and try again.".to_string()
            } else {
                format!(
                    "Installation failed: {}",
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

            return Ok(InstallResult {
                success: false,
                version: None,
                error: Some(error_message),
            });
        }
    }

    // Verify installation
    let version = match check_openclaw_installed().await {
        Ok(v) => v,
        Err(e) => {
            return Ok(InstallResult {
                success: false,
                version: None,
                error: Some(e),
            });
        }
    };

    // Auto-configure for Jan integration

    // 1. Ensure Jan's origins are allowed for WebSocket connections
    if let Err(e) = openclaw_ensure_jan_origin().await {
        log::warn!("Failed to ensure Jan origin: {}", e);
        // Don't fail the install, just log the warning
    }

    // 2. Configure WhatsApp with pairing mode by default (safer for users)
    if let Ok(mut child) = openclaw_command(&["config", "set", "channels.whatsapp.dmPolicy", "pairing"]).await
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let _ = child.wait().await;
    }

    // 3. Configure Telegram with pairing mode by default
    if let Ok(mut child) = openclaw_command(&["config", "set", "channels.telegram.dmPolicy", "pairing"]).await
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let _ = child.wait().await;
    }

    // 4. Enable dangerouslyDisableDeviceAuth for Jan's Control UI client
    // This allows Jan to connect without device pairing (Jan is trusted)
    if let Ok(mut child) = openclaw_command(&["config", "set", "gateway.controlUi.dangerouslyDisableDeviceAuth", "true"]).await
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let _ = child.wait().await;
    }

    // 5. Set gateway.mode to "local" - required for gateway to start
    if let Ok(mut child) = openclaw_command(&["config", "set", "gateway.mode", "local"]).await
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        let _ = child.wait().await;
    }

    // NOTE: Gateway is NOT auto-started here. It is started by openclaw_start()
    // via the sandbox abstraction (Docker, platform-native, or direct process).
    // Auto-starting here would conflict with Docker sandbox mode.

    Ok(InstallResult {
        success: true,
        version,
        error: None,
    })
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
        if let Some(api_key) = input.jan_api_key {
            if !api_key.is_empty() {
                config.models.providers.jan.api_key = api_key;
            }
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
    log::debug!("Ensuring Jan's origin is in OpenClaw allowedOrigins");

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
        log::debug!("Jan's config already correct");
    }

    Ok(modified)
}

/// Back up `openclaw.json` before modifying it.
/// Keeps up to 3 timestamped backups, prunes older ones.
fn backup_openclaw_config(config_path: &std::path::Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let timestamp = chrono::Local::now().format("%Y%m%dT%H%M%S");
    let backup_name = format!(
        "{}.bak.{}",
        config_path.file_name().unwrap_or_default().to_string_lossy(),
        timestamp
    );
    let backup_path = config_path.with_file_name(&backup_name);
    std::fs::copy(config_path, &backup_path)
        .map_err(|e| format!("Failed to backup config: {}", e))?;

    const MAX_BACKUPS: usize = 3;
    if let Some(parent) = config_path.parent() {
        let prefix = format!(
            "{}.bak.",
            config_path.file_name().unwrap_or_default().to_string_lossy()
        );
        if let Ok(entries) = std::fs::read_dir(parent) {
            let mut backups: Vec<std::path::PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .map(|n| n.to_string_lossy().starts_with(&prefix))
                        .unwrap_or(false)
                })
                .collect();
            backups.sort_by(|a, b| b.cmp(a));
            for old in backups.into_iter().skip(MAX_BACKUPS) {
                let _ = std::fs::remove_file(&old);
            }
        }
    }

    Ok(())
}

/// Configure OpenClaw with the specified settings.
/// Selectively merges only Jan-managed gateway fields (mode, port, auth)
/// without destroying user-configured settings.
/// Strips known-invalid keys that would cause OpenClaw to reject the config.
#[tauri::command]
pub async fn openclaw_configure(config_input: Option<OpenClawConfigInput>) -> Result<OpenClawConfig, String> {
    log::info!("Configuring OpenClaw");

    let config = generate_default_config(config_input);
    let config_path = get_openclaw_config_path()?;

    let defaults: serde_json::Value = serde_json::to_value(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    let mut merged = if config_path.exists() {
        let existing_str = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read existing config: {}", e))?;
        let mut existing: serde_json::Value = serde_json::from_str(&existing_str)
            .unwrap_or_else(|_| serde_json::json!({}));

        backup_openclaw_config(&config_path)?;

        // Selectively merge only Jan-managed gateway fields, preserving user config
        if let Some(gw_defaults) = defaults.get("gateway").and_then(|v| v.as_object()) {
            if existing.get("gateway").is_none() {
                existing["gateway"] = serde_json::Value::Object(gw_defaults.clone());
            } else if let Some(gw_obj) = existing["gateway"].as_object_mut() {
                gw_obj.entry("mode")
                    .or_insert_with(|| gw_defaults.get("mode").cloned()
                        .unwrap_or(serde_json::json!("local")));
                gw_obj.entry("port")
                    .or_insert_with(|| gw_defaults.get("port").cloned()
                        .unwrap_or(serde_json::json!(super::OPENCLAW_PORT)));
                gw_obj.entry("auth")
                    .or_insert_with(|| gw_defaults.get("auth").cloned()
                        .unwrap_or(serde_json::json!({"mode": "token"})));
                // Enable the OpenAI-compatible HTTP API so Jan can send messages
                // to the OpenClaw agent runtime via POST /v1/chat/completions
                let http = gw_obj.entry("http")
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(http_obj) = http.as_object_mut() {
                    let endpoints = http_obj.entry("endpoints")
                        .or_insert_with(|| serde_json::json!({}));
                    if let Some(ep_obj) = endpoints.as_object_mut() {
                        let cc = ep_obj.entry("chatCompletions")
                            .or_insert_with(|| serde_json::json!({}));
                        if let Some(cc_obj) = cc.as_object_mut() {
                            cc_obj.entry("enabled")
                                .or_insert_with(|| serde_json::json!(true));
                        }
                    }
                }
            }
        }
        if let Some(models) = defaults.get("models") {
            if existing.get("models").is_none() {
                existing["models"] = models.clone();
            } else if existing.pointer("/models/providers/jan").is_none() {
                existing["models"]["providers"]["jan"] = models["providers"]["jan"].clone();
            }
        }
        // Always update the jan provider apiKey when an explicit key was provided
        // (i.e., the generated config has a non-default key from config_input.jan_api_key)
        if config.models.providers.jan.api_key != DEFAULT_JAN_API_KEY {
            existing["models"]["providers"]["jan"]["apiKey"] =
                serde_json::json!(config.models.providers.jan.api_key);
        }
        // Always update the jan provider baseUrl so a stale port is never kept
        existing["models"]["providers"]["jan"]["baseUrl"] =
            serde_json::json!(config.models.providers.jan.base_url);
        existing
    } else {
        defaults
    };

    strip_invalid_config_keys(&mut merged);

    // Ensure gateway.auth.token exists when mode is "token".
    // On Mac, `gateway install` auto-generates the token, but on Windows/Linux
    // the child-process path (`openclaw gateway`) skips `gateway install`
    // entirely, leaving the config without a token.
    let auth_mode = merged
        .pointer("/gateway/auth/mode")
        .and_then(|v| v.as_str())
        .unwrap_or("token");
    let has_token = merged
        .pointer("/gateway/auth/token")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if auth_mode == "token" && !has_token {
        let token = security::generate_access_token();
        merged["gateway"]["auth"]["token"] = serde_json::json!(token);
    }

    // Ensure controlUi settings so Jan can connect without device pairing.
    // The openclaw_install step sets these via CLI, but on fresh installs
    // the CLI commands may fail silently.
    if merged.pointer("/gateway/controlUi").is_none() {
        merged["gateway"]["controlUi"] = serde_json::json!({});
    }
    let has_disable_device_auth = merged
        .pointer("/gateway/controlUi/dangerouslyDisableDeviceAuth")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !has_disable_device_auth {
        merged["gateway"]["controlUi"]["dangerouslyDisableDeviceAuth"] = serde_json::json!(true);
    }
    // Ensure Jan's allowed origins for WebSocket connections
    let existing_origins: std::collections::HashSet<String> = merged
        .pointer("/gateway/controlUi/allowedOrigins")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(String::from).collect())
        .unwrap_or_default();
    let mut origins: Vec<serde_json::Value> = merged
        .pointer("/gateway/controlUi/allowedOrigins")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for origin in JAN_ALLOWED_ORIGINS {
        if !existing_origins.contains(*origin) {
            origins.push(serde_json::json!(origin));
        }
    }
    merged["gateway"]["controlUi"]["allowedOrigins"] = serde_json::Value::Array(origins);

    let config_json = serde_json::to_string_pretty(&merged)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("OpenClaw configuration written to {:?}", config_path);

    // Ensure the agent directory has auth-profiles.json and that models.json
    // carries the jan apiKey. Without these, agents fail with
    // "No API key found for provider".
    ensure_agent_auth_files()?;

    Ok(config)
}

/// Ensure the agent directory has the files OpenClaw's agent system needs:
/// 1. `auth-profiles.json` — the credential store (empty is fine).
/// 2. `models.json` — must have `apiKey` on the jan provider so the agent
///    can resolve credentials via `getCustomProviderApiKey`.
///
/// OpenClaw regenerates `models.json` from `openclaw.json` on gateway start,
/// but if the gateway is already running (hot-reload) the stale file is used.
/// We patch it directly so the fix takes effect immediately.
fn ensure_agent_auth_files() -> Result<(), String> {
    let config_dir = get_openclaw_config_dir()?;
    let agent_dir = config_dir.join("agents").join("main").join("agent");

    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Failed to create agent directory: {}", e))?;

    // 1. auth-profiles.json
    let auth_path = agent_dir.join("auth-profiles.json");
    if !auth_path.exists() {
        let empty_store = serde_json::json!({
            "version": 1,
            "profiles": {}
        });
        let json = serde_json::to_string_pretty(&empty_store)
            .map_err(|e| format!("Failed to serialize auth profiles: {}", e))?;
        std::fs::write(&auth_path, json)
            .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;
        log::info!("Created empty auth-profiles.json at {:?}", auth_path);
    }

    // 2. Patch models.json — ensure jan provider has apiKey
    let models_path = agent_dir.join("models.json");
    if models_path.exists() {
        let content = std::fs::read_to_string(&models_path)
            .map_err(|e| format!("Failed to read models.json: {}", e))?;
        if let Ok(mut models) = serde_json::from_str::<serde_json::Value>(&content) {
            let needs_patch = models
                .pointer("/providers/jan")
                .map(|jan| jan.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").is_empty())
                .unwrap_or(false);

            if needs_patch {
                models["providers"]["jan"]["apiKey"] = serde_json::json!(DEFAULT_JAN_API_KEY);
                let json = serde_json::to_string_pretty(&models)
                    .map_err(|e| format!("Failed to serialize models.json: {}", e))?;
                std::fs::write(&models_path, json)
                    .map_err(|e| format!("Failed to write models.json: {}", e))?;
                log::info!("Patched models.json with jan apiKey");
            }
        }
    }

    Ok(())
}

/// Sanitise an OpenClaw config value before writing it to disk.
/// 1. Strips known-invalid keys (OpenClaw uses strict Zod validation).
/// 2. Ensures required fields are present (e.g., gateway.mode = "local").
fn strip_invalid_config_keys(config: &mut serde_json::Value) {
    // agents.defaults.systemPrompt is NOT a valid key (system prompts come from workspace files)
    if let Some(defaults) = config.pointer_mut("/agents/defaults") {
        if let Some(obj) = defaults.as_object_mut() {
            if obj.remove("systemPrompt").is_some() {
                log::info!("Stripped invalid key: agents.defaults.systemPrompt");
            }
        }
    }

    // gateway.mode is REQUIRED — without it the gateway refuses to start.
    // Ensure it is always present and defaults to "local".
    if let Some(gw) = config.get_mut("gateway") {
        if let Some(obj) = gw.as_object_mut() {
            if !obj.contains_key("mode") {
                obj.insert("mode".to_string(), serde_json::json!("local"));
                log::info!("Added missing required key: gateway.mode = \"local\"");
            }
        }
    }
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

/// Read the OpenClaw config file as a JSON Value.
/// Preserves all fields including unknown ones.
fn read_openclaw_config() -> Result<serde_json::Value, String> {
    let config_path = get_openclaw_config_path()?;
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read OpenClaw config: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse OpenClaw config: {}", e))
}

/// Write a JSON Value back to the OpenClaw config file.
/// Automatically sanitises the config (strip invalid keys, ensure required keys).
fn write_openclaw_config(config: &serde_json::Value) -> Result<(), String> {
    let config_path = get_openclaw_config_path()?;
    let mut sanitized = config.clone();
    strip_invalid_config_keys(&mut sanitized);
    let json = serde_json::to_string_pretty(&sanitized)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config: {}", e))
}

/// Sync the selected model from Jan to OpenClaw
///
/// This updates OpenClaw's agent default model to match Jan's currently selected model.
/// Works for both Docker and direct process modes by writing directly to the config file.
#[tauri::command]
pub async fn openclaw_sync_model(
    model_id: String,
    provider: Option<String>,
    model_name: Option<String>,
) -> Result<(), String> {
    log::info!("Syncing model to OpenClaw: {} (provider: {:?})", model_id, provider);

    let display_name = model_name.unwrap_or_else(|| model_id.clone());

    // OpenClaw models.providers.jan.models expects an array of objects with
    // at minimum { id, name }. The id must be the plain model name — OpenClaw
    // prepends the provider key ("jan/") when resolving references.
    // Context window is declared as 131072 for all models — the actual limit
    // is enforced by the inference engine, not this metadata.
    let model_def = serde_json::json!({
        "id": model_id,
        "name": display_name,
        "input": ["text"],
        "reasoning": false,
        "contextWindow": 131072,
        "maxTokens": 16384,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
    });

    // Read, modify, write the config directly (works for both Docker and direct process)
    let mut config = read_openclaw_config()?;

    // Ensure models.providers.jan exists
    if config.pointer("/models/providers/jan").is_none() {
        let current_base_url = config
            .pointer("/models/providers/jan/baseUrl")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_JAN_BASE_URL);

        config["models"]["providers"]["jan"] = serde_json::json!({
            "baseUrl": current_base_url,
            "api": DEFAULT_JAN_API_TYPE,
            "apiKey": DEFAULT_JAN_API_KEY,
            "models": [model_def]
        });
    } else {
        // Add model to existing list if not already present
        let models = config
            .pointer_mut("/models/providers/jan/models")
            .and_then(|v| v.as_array_mut());

        if let Some(models) = models {
            let model_exists = models.iter().any(|m| {
                m.get("id").and_then(|v| v.as_str()) == Some(&model_id)
            });
            if !model_exists {
                models.push(model_def);
            }
        }
    }

    // Default model reference must use "jan/<model_id>" so OpenClaw resolves
    // it under the "jan" provider.
    let qualified_id = format!("jan/{}", model_id);
    config["agents"]["defaults"]["model"]["primary"] = serde_json::json!(qualified_id);

    write_openclaw_config(&config)?;

    log::info!("Successfully synced model '{}' to OpenClaw config (default: {})", model_id, qualified_id);
    Ok(())
}

/// Bulk sync all models from Jan to OpenClaw
///
/// This replaces the entire model list in the 'jan' provider with the full
/// catalog from Jan's model provider store. Called when Remote Access starts
/// so that OpenClaw knows about all available models without requiring the
/// user to switch models in the dropdown.
#[tauri::command]
pub async fn openclaw_sync_all_models(
    models: Vec<ModelSyncEntry>,
    default_model_id: Option<String>,
) -> Result<BulkSyncResult, String> {
    log::info!("Bulk syncing {} models to OpenClaw", models.len());

    if models.is_empty() {
        log::warn!("No models to sync");
        return Ok(BulkSyncResult {
            synced_count: 0,
            default_model: None,
        });
    }

    // Build model definition objects matching the CLI's rich format so OpenClaw
    // can make optimal decisions about context, output limits, and cost.
    // Use the actual context window from Jan's model settings when available,
    // falling back to 131072 (128K) as a reasonable default.
    let model_defs: Vec<serde_json::Value> = models
        .iter()
        .map(|entry| {
            let ctx = entry.context_window.unwrap_or(131072);
            serde_json::json!({
                "id": entry.model_id,
                "name": entry.display_name,
                "input": ["text"],
                "reasoning": false,
                "contextWindow": ctx,
                "maxTokens": 16384,
                "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
            })
        })
        .collect();

    let synced_count = model_defs.len() as u32;

    // Read, modify, write the config directly (works for both Docker and direct process)
    let mut config = read_openclaw_config()?;

    // Preserve the current baseUrl (may be Docker or localhost depending on sandbox)
    let current_base_url = config
        .pointer("/models/providers/jan/baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_JAN_BASE_URL)
        .to_string();

    // Preserve the current apiKey (may have been customised by the user)
    let current_api_key = config
        .pointer("/models/providers/jan/apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_JAN_API_KEY)
        .to_string();

    // Build the full jan provider config with all models as objects
    config["models"]["providers"]["jan"] = serde_json::json!({
        "baseUrl": current_base_url,
        "api": DEFAULT_JAN_API_TYPE,
        "apiKey": current_api_key,
        "models": model_defs
    });

    // Default model must be "jan/<model_id>" so OpenClaw resolves under the jan provider
    let set_default = if let Some(ref model_id) = default_model_id {
        let qualified = format!("jan/{}", model_id);
        config["agents"]["defaults"]["model"]["primary"] = serde_json::json!(qualified);
        Some(qualified)
    } else {
        None
    };

    write_openclaw_config(&config)?;

    // Also patch the agent-level models.json so the running gateway picks up
    // the apiKey immediately (without needing a full restart).
    ensure_agent_auth_files()?;

    log::info!("Successfully bulk synced {} models to OpenClaw", synced_count);
    Ok(BulkSyncResult {
        synced_count,
        default_model: set_default,
    })
}

/// Get the currently configured model in OpenClaw
#[tauri::command]
pub async fn openclaw_get_model() -> Result<String, String> {
    log::info!("Getting OpenClaw model");

    let config = read_openclaw_config()?;
    let model = config
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_MODEL_ID)
        .to_string();

    // Strip the "jan/" provider prefix so the frontend gets the plain model ID
    // that matches Jan's internal model identifiers.
    let model = model.strip_prefix("jan/").unwrap_or(&model).to_string();

    Ok(model)
}

/// Check if OpenClaw gateway is responding on the expected port
async fn check_gateway_responding() -> bool {
    // Use TCP connection check - OpenClaw serves a dashboard UI, not a JSON health endpoint
    match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", OPENCLAW_PORT)).await {
        Ok(_) => {
            log::debug!("OpenClaw gateway is responding on port {}", OPENCLAW_PORT);
            true
        }
        Err(_) => false,
    }
}

/// Wait for the gateway to become responsive, polling every 500ms up to `max_wait_secs`.
/// Returns true if the gateway responded before the deadline, false otherwise.
async fn wait_for_gateway_ready(max_wait_secs: u64) -> bool {
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(max_wait_secs);
    // Always give the process at least 1s to bind the port
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    loop {
        if check_gateway_responding().await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }
}

/// 1-click enable: orchestrates dependency check, install, configure, and start
#[tauri::command]
pub async fn openclaw_enable(
    app: tauri::AppHandle,
    config_input: Option<OpenClawConfigInput>,
    state: State<'_, OpenClawState>,
) -> Result<EnableResult, String> {
    use tauri::Emitter;
    log::info!("Starting 1-click OpenClaw enable flow");

    let mut steps_completed: Vec<EnableStep> = vec![];
    let emit = |step: &str, progress: u32, message: &str, sandbox: Option<&str>| {
        let _ = app.emit(
            "openclaw-enable-progress",
            EnableProgressEvent {
                step: step.to_string(),
                progress,
                message: message.to_string(),
                sandbox_info: sandbox.map(|s| s.to_string()),
            },
        );
    };

    // Step 1: Detect sandbox type FIRST (before Node.js check)
    // This is important because for Docker, Node.js runs inside container
    let detected = crate::core::openclaw::sandbox::detect_sandbox().await;
    let sandbox_name = detected.name().to_string();
    let tier = detected.isolation_tier();
    let is_docker = sandbox_name == "Docker";
    let mut sandbox_info = Some(match tier {
        crate::core::openclaw::sandbox::IsolationTier::None => "None (direct process)".to_string(),
        _ => sandbox_name.clone(),
    });
    log::info!("Detected sandbox: {} (tier: {:?})", sandbox_name, tier);

    set_docker_mode(is_docker);

    // Step 1b: Check JS runtime dependencies (skip for Docker - runs inside container)
    emit("checking_dependencies", 10, "Checking runtime installation...", sandbox_info.as_deref());
    steps_completed.push(EnableStep::CheckingDependencies);

    let _node_check = if is_docker {
        // For Docker, runtime runs inside container - no host check needed
        log::info!("Docker sandbox detected - runtime runs inside container, skipping host check");
        NodeCheckResult {
            installed: true, // Pretend it's installed to allow flow to continue
            version: None,
            major_version: None,
            meets_requirements: true,
            error: None,
        }
    } else {
        // For direct process, a JS runtime (bundled Bun or Node.js) must be available
        let check = openclaw_check_dependencies().await;
        if !check.installed {
            return Err(serde_json::to_string(&EnableError {
                code: EnableErrorCode::RuntimeNotFound,
                message: "Could not find a JavaScript runtime. Bundled Bun was not found, and Node.js 22+ is not installed.".to_string(),
                recovery: vec![RecoveryOption {
                    label: "Retry".to_string(),
                    action: RecoveryAction::Retry,
                    description: "Try detecting the runtime again.".to_string(),
                }],
            })
            .unwrap_or_else(|_| "JavaScript runtime not found".to_string()));
        }
        if !check.meets_requirements {
            return Err(serde_json::to_string(&EnableError {
                code: EnableErrorCode::RuntimeVersionTooLow,
                message: format!(
                    "A compatible JavaScript runtime is required. Found: {}",
                    check.version.as_deref().unwrap_or("unknown")
                ),
                recovery: vec![RecoveryOption {
                    label: "Retry".to_string(),
                    action: RecoveryAction::Retry,
                    description: "Try detecting the runtime again.".to_string(),
                }],
            })
            .unwrap_or_else(|_| "JavaScript runtime version too low".to_string()));
        }
        check
    };

    // Store detected sandbox in state
    {
        let mut sandbox_guard = state.sandbox.lock().await;
        *sandbox_guard = Some(detected);
    }

    // Step 2: Check if OpenClaw is already installed
    emit("checking_installation", 25, "Checking OpenClaw installation...", sandbox_info.as_deref());
    steps_completed.push(EnableStep::CheckingInstallation);

    let already_installed = if is_docker {
        let docker_installed = crate::core::openclaw::sandbox_docker::DockerSandbox::is_installed().await;
        let docker_exists = docker_installed == Some(true);
        let image_ready = if docker_exists {
            crate::core::openclaw::sandbox_docker::DockerSandbox::is_image_available().await
        } else {
            false
        };
        log::info!("Installation check: docker_container={}, image_ready={}", docker_exists, image_ready);

        if image_ready {
            emit("already_installed", 40, "OpenClaw container exists in Docker.", sandbox_info.as_deref());
        }
        image_ready
    } else {
        let pkg_version = check_openclaw_installed().await.ok().flatten();
        let up_to_date = match &pkg_version {
            Some(v) => !needs_upgrade(v, OPENCLAW_VERSION),
            None => false,
        };
        log::info!("Installation check: version={:?}, up_to_date={}", pkg_version, up_to_date);
        up_to_date
    };

    // Step 3: Install if needed
    if !already_installed {
        if is_docker {
            // Docker path: pull the image (the actual container is created in openclaw_start)
            emit("installing", 40, "Pulling OpenClaw Docker image...", sandbox_info.as_deref());
            steps_completed.push(EnableStep::Installing);

            // Pull Docker image with progress events
            match crate::core::openclaw::sandbox_docker::DockerSandbox::pull_image_if_needed_with_progress(
                &app,
                sandbox_info.as_deref(),
            ).await {
                Ok(()) => {
                    log::info!("Docker image pulled successfully");
                }
                Err(e) => {
                    // Docker image pull failed (e.g., image not published yet, auth error, network)
                    // Fall back to direct process mode with npm install
                    log::warn!("Docker image pull failed: {}. Falling back to direct process.", e);
                    emit("installing", 42, "Docker image unavailable, falling back to direct install...", sandbox_info.as_deref());

                    sandbox_info = Some("None (direct process)".to_string());

                    // Replace sandbox in state with DirectProcessSandbox
                    {
                        let mut sandbox_guard = state.sandbox.lock().await;
                        *sandbox_guard = Some(Box::new(
                            crate::core::openclaw::sandbox_direct::DirectProcessSandbox,
                        ));
                    }

                    // Check runtime (bundled Bun or Node.js, required for direct process)
                    let node_check = openclaw_check_dependencies().await;
                    if !node_check.installed {
                        return Err(serde_json::to_string(&EnableError {
                            code: EnableErrorCode::RuntimeNotFound,
                            message: format!(
                                "Docker image unavailable and no JavaScript runtime found. \
                                 Original error: {}. Bundled Bun was not found and Node.js 22+ is not installed.",
                                e
                            ),
                            recovery: vec![RecoveryOption {
                                label: "Retry".to_string(),
                                action: RecoveryAction::Retry,
                                description: "Try detecting the runtime again.".to_string(),
                            }],
                        })
                        .unwrap_or_else(|_| "No JavaScript runtime found".to_string()));
                    }
                    if !node_check.meets_requirements {
                        return Err(serde_json::to_string(&EnableError {
                            code: EnableErrorCode::RuntimeVersionTooLow,
                            message: format!(
                                "Docker image unavailable and runtime version too low. \
                                 Original error: {}. Bun 1.0+ or Node.js 22+ required.",
                                e
                            ),
                            recovery: vec![RecoveryOption {
                                label: "Retry".to_string(),
                                action: RecoveryAction::Retry,
                                description: "Try detecting the runtime again.".to_string(),
                            }],
                        })
                        .unwrap_or_else(|_| "Runtime version too low".to_string()));
                    }

                    // Now install via bun/npm
                    emit("installing", 45, "Installing OpenClaw...", sandbox_info.as_deref());
                    let install_result = openclaw_install().await?;
                    if !install_result.success {
                        return Err(serde_json::to_string(&EnableError {
                            code: EnableErrorCode::InstallFailed,
                            message: install_result
                                .error
                                .unwrap_or_else(|| "npm install failed".to_string()),
                            recovery: vec![RecoveryOption {
                                label: "Retry".to_string(),
                                action: RecoveryAction::Retry,
                                description: "Try installing OpenClaw again.".to_string(),
                            }],
                        })
                        .unwrap_or_else(|_| "Installation failed".to_string()));
                    }
                }
            }
        } else {
            // Non-Docker path: npm install
            emit("installing", 40, "Installing OpenClaw (this may take a moment)...", sandbox_info.as_deref());
            steps_completed.push(EnableStep::Installing);
            let install_result = openclaw_install().await?;
            if !install_result.success {
                return Err(serde_json::to_string(&EnableError {
                    code: EnableErrorCode::InstallFailed,
                    message: install_result
                        .error
                        .unwrap_or_else(|| "npm install failed".to_string()),
                    recovery: vec![RecoveryOption {
                        label: "Retry".to_string(),
                        action: RecoveryAction::Retry,
                        description: "Try installing OpenClaw again.".to_string(),
                    }],
                })
                .unwrap_or_else(|_| "Installation failed".to_string()));
            }
        }
    } else {
        emit("already_installed", 40, "OpenClaw is already installed.", sandbox_info.as_deref());
    }

    // Step 4: Configure
    emit("configuring", 60, "Configuring OpenClaw...", sandbox_info.as_deref());
    steps_completed.push(EnableStep::Configuring);
    openclaw_configure(config_input).await.map_err(|e| {
        serde_json::to_string(&EnableError {
            code: EnableErrorCode::ConfigWriteFailed,
            message: format!("Failed to write configuration: {}", e),
            recovery: vec![RecoveryOption {
                label: "Retry".to_string(),
                action: RecoveryAction::Retry,
                description: "Try configuring again.".to_string(),
            }],
        })
        .unwrap_or(e)
    })?;

    // Step 5: Start the gateway (with doctor --fix auto-recovery for non-Docker)
    emit("starting", 75, "Starting OpenClaw gateway...", sandbox_info.as_deref());
    steps_completed.push(EnableStep::Starting);

    // Phase A: attempt start + wait-for-ready
    let mut doctor_already_ran = false;
    let start_err = match openclaw_start(state.clone()).await {
        Ok(()) => None,
        Err(e) => Some(e),
    };

    // Port conflicts cannot be fixed by doctor — bail immediately
    if let Some(ref e) = start_err {
        if e.contains("Port") || e.contains("port") {
            return Err(serde_json::to_string(&EnableError {
                code: EnableErrorCode::PortInUse,
                message: e.clone(),
                recovery: vec![RecoveryOption {
                    label: "Use different port".to_string(),
                    action: RecoveryAction::UseDifferentPort {
                        port: OPENCLAW_PORT + 1,
                    },
                    description: format!("Try port {} instead.", OPENCLAW_PORT + 1),
                }],
            })
            .unwrap_or_else(|_| e.clone()));
        }
    }

    let gateway_responsive = if start_err.is_none() {
        let gateway_wait = if is_docker { 60 } else { 15 };
        wait_for_gateway_ready(gateway_wait).await
    } else {
        false
    };

    if !gateway_responsive && !is_docker {
        // Non-Docker: run doctor --fix and retry before giving up
        let original_err = start_err.unwrap_or_else(|| "Gateway did not become responsive after starting.".to_string());
        log::warn!("Gateway start/wait failed: {}. Running doctor --fix.", original_err);
        emit("starting", 78, "Auto-fixing configuration and retrying...", sandbox_info.as_deref());

        let _ = run_doctor_fix().await;
        doctor_already_ran = true;
        let _ = restart_gateway_cli().await;

        if !wait_for_gateway_ready(15).await {
            return Err(serde_json::to_string(&EnableError {
                code: EnableErrorCode::GatewayStartFailed,
                message: format!("Gateway did not recover after auto-fix: {}", original_err),
                recovery: vec![RecoveryOption {
                    label: "Retry".to_string(),
                    action: RecoveryAction::Retry,
                    description: "Try the setup again.".to_string(),
                }],
            })
            .unwrap_or_else(|_| original_err));
        }
    } else if !gateway_responsive {
        // Docker: start/wait failed — no doctor, just fail
        let original_err = start_err.unwrap_or_else(|| "Gateway did not become responsive after starting.".to_string());
        return Err(serde_json::to_string(&EnableError {
            code: EnableErrorCode::GatewayStartFailed,
            message: original_err.clone(),
            recovery: vec![RecoveryOption {
                label: "Retry".to_string(),
                action: RecoveryAction::Retry,
                description: "Try the setup again.".to_string(),
            }],
        })
        .unwrap_or_else(|_| original_err));
    }

    // Phase B: validate gateway auth
    emit("validating", 85, "Validating configuration...", sandbox_info.as_deref());
    steps_completed.push(EnableStep::ValidatingConfig);

    if is_docker {
        // Docker: port binds early but app layer may still be initialising.
        // Poll validate_gateway_auth with retries instead of restarting.
        let deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_secs(90);
        let mut last_err = String::new();
        loop {
            match validate_gateway_auth().await {
                Ok(()) => {
                    last_err.clear();
                    break;
                }
                Err(e) => {
                    last_err = e;
                    if tokio::time::Instant::now() >= deadline {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                }
            }
        }
        if !last_err.is_empty() {
            return Err(serde_json::to_string(&EnableError {
                code: EnableErrorCode::ValidationFailed,
                message: format!("Gateway validation timed out: {}", last_err),
                recovery: vec![RecoveryOption {
                    label: "Retry".to_string(),
                    action: RecoveryAction::Retry,
                    description: "Try the setup again.".to_string(),
                }],
            })
            .unwrap_or_else(|_| last_err));
        }
    } else {
        match validate_gateway_auth().await {
            Ok(()) => {}
            Err(e) => {
                if doctor_already_ran {
                    // Doctor already ran during start/wait retry — don't retry again
                    return Err(serde_json::to_string(&EnableError {
                        code: EnableErrorCode::ValidationFailed,
                        message: format!("Validation failed after auto-fix: {}", e),
                        recovery: vec![RecoveryOption {
                            label: "Retry".to_string(),
                            action: RecoveryAction::Retry,
                            description: "Try the setup again.".to_string(),
                        }],
                    })
                    .unwrap_or_else(|_| e));
                }

                // Doctor hasn't run yet (start+wait passed on first try) — try it now
                log::warn!("Gateway validation failed: {}. Running doctor --fix.", e);
                let _ = run_doctor_fix().await;
                let _ = restart_gateway_cli().await;

                if !wait_for_gateway_ready(15).await {
                    return Err(serde_json::to_string(&EnableError {
                        code: EnableErrorCode::ValidationFailed,
                        message: format!("Gateway did not recover after auto-fix: {}", e),
                        recovery: vec![RecoveryOption {
                            label: "Retry".to_string(),
                            action: RecoveryAction::Retry,
                            description: "Try the setup again.".to_string(),
                        }],
                    })
                    .unwrap_or_else(|_| e.clone()));
                }

                if let Err(retry_err) = validate_gateway_auth().await {
                    return Err(serde_json::to_string(&EnableError {
                        code: EnableErrorCode::ValidationFailed,
                        message: format!("Validation failed after auto-fix: {}", retry_err),
                        recovery: vec![RecoveryOption {
                            label: "Retry".to_string(),
                            action: RecoveryAction::Retry,
                            description: "Try the setup again.".to_string(),
                        }],
                    })
                    .unwrap_or_else(|_| retry_err));
                }
            }
        }
    }

    // Get final status
    emit("complete", 100, "OpenClaw is ready!", sandbox_info.as_deref());
    let final_status = openclaw_status(state).await?;

    Ok(EnableResult {
        success: true,
        already_installed,
        steps_completed,
        status: final_status,
    })
}

/// Start the OpenClaw gateway via the sandbox abstraction.
#[tauri::command]
pub async fn openclaw_start(state: State<'_, OpenClawState>) -> Result<(), String> {
    log::info!("Starting OpenClaw gateway");

    let is_docker = {
        let mut sandbox_guard = state.sandbox.lock().await;
        if sandbox_guard.is_none() {
            let detected = crate::core::openclaw::sandbox::detect_sandbox().await;
            let is_docker = detected.name() == "Docker";
            log::info!("Detected sandbox: {} (tier: {})", detected.name(), detected.isolation_tier());
            *sandbox_guard = Some(detected);
            is_docker
        } else {
            sandbox_guard.as_ref().unwrap().name() == "Docker"
        }
    };

    set_docker_mode(is_docker);

    // Step 2: Port check — behavior depends on sandbox type
    if is_docker {
        // For Docker: if port is in use, something else is on it (host process, old container).
        // We need to ensure the Docker container is running, not just that the port responds.
        // Check if our Docker container is already running.
        let docker_status = {
            let sandbox_guard = state.sandbox.lock().await;
            if let Some(sandbox) = sandbox_guard.as_ref() {
                let dummy_handle = crate::core::openclaw::sandbox::SandboxHandle::Named(
                    "jan-openclaw".to_string(),
                );
                sandbox.status(&dummy_handle).await.ok()
            } else {
                None
            }
        };

        if docker_status == Some(crate::core::openclaw::sandbox::SandboxStatus::Running) {
            return Ok(());
        }

        // Stop any running direct-process gateway to avoid port/bot conflicts
        stop_other_sandbox_instance(false).await;
    } else {
        // Stop any running Docker container to avoid port/bot conflicts
        stop_other_sandbox_instance(true).await;

        if check_gateway_responding().await {
            let _ = openclaw_ensure_jan_origin().await;
            return Ok(());
        }

        let port_check = openclaw_check_port(OPENCLAW_PORT).await;
        if !port_check.available {
            return Err(format!("Port {} is already in use by another application", OPENCLAW_PORT));
        }
    }

    // Ensure config exists
    let config_path = get_openclaw_config_path()?;
    if !config_path.exists() {
        openclaw_configure(None).await?;
    } else {
        openclaw_ensure_jan_origin().await?;
    }

    // Runtime check (skip for Docker — runs inside container)
    if !is_docker {
        let node_check = openclaw_check_dependencies().await;
        if !node_check.installed || !node_check.meets_requirements {
            return Err(node_check.error.unwrap_or_else(|| "JavaScript runtime requirements not met (Bun or Node.js 22+)".to_string()));
        }
    }

    // Build config and start via lifecycle module
    let config = crate::core::openclaw::lifecycle::build_sandbox_config(
        &crate::core::openclaw::constants::DEFAULT_JAN_BASE_URL,
    )?;

    let sandbox_guard = state.sandbox.lock().await;
    let sandbox = sandbox_guard.as_ref().ok_or("Sandbox not initialized")?;
    crate::core::openclaw::lifecycle::start_openclaw(sandbox.as_ref(), &config, &state).await
}

/// Stop the OpenClaw gateway via the sandbox abstraction.
#[tauri::command]
pub async fn openclaw_stop(state: State<'_, OpenClawState>) -> Result<(), String> {
    log::info!("Stopping OpenClaw gateway");

    let sandbox_guard = state.sandbox.lock().await;

    let is_docker = sandbox_guard.as_ref().map(|s| s.name() == "Docker").unwrap_or(false);
    set_docker_mode(is_docker);

    match sandbox_guard.as_ref() {
        Some(sandbox) => {
            crate::core::openclaw::lifecycle::stop_openclaw(sandbox.as_ref(), &state).await
        }
        None => {
            let direct = crate::core::openclaw::sandbox_direct::DirectProcessSandbox;
            let mut handle = crate::core::openclaw::sandbox::SandboxHandle::Named("direct-process".to_string());
            direct.stop(&mut handle).await
        }
    }
}

/// Lightweight gateway reachability check (TCP only, no HTTP).
/// Used by the frontend before sending agent-mode chat requests.
#[tauri::command]
pub async fn openclaw_check_gateway() -> bool {
    check_gateway_responding().await
}

/// Get the current OpenClaw status, including sandbox information.
#[tauri::command]
pub async fn openclaw_status(state: State<'_, OpenClawState>) -> Result<OpenClawStatus, String> {
    log::debug!("Getting OpenClaw status");

    let running = check_gateway_responding().await;

    // 1. Detect sandbox first — environment may change between checks
    //    (e.g. Docker Desktop started/stopped since last status call)
    let is_docker_sandbox = {
        let mut sandbox_guard = state.sandbox.lock().await;
        let mut mode = state.sandbox_mode.lock().await;

        if let crate::core::openclaw::sandbox::SandboxMode::Active { .. } = &*mode {
            if !running {
                *mode = crate::core::openclaw::sandbox::SandboxMode::Inactive;
            }
        }

        if !running || sandbox_guard.is_none() {
            *sandbox_guard = Some(crate::core::openclaw::sandbox::detect_sandbox().await);
        }

        sandbox_guard.as_ref().map(|s| s.name() == "Docker").unwrap_or(false)
    };

    set_docker_mode(is_docker_sandbox);

    // 2. Check installation status using the detected sandbox type
    let (openclaw_version, is_installed, runtime_version) = if is_docker_sandbox {
        let version = check_openclaw_version_docker().await;
        let installed = crate::core::openclaw::sandbox_docker::DockerSandbox::is_image_available().await;
        let runtime_ver = if running {
            check_node_version_docker().await
        } else {
            None
        };
        (version, installed, runtime_ver)
    } else {
        let version = match check_openclaw_installed().await {
            Ok(v) => v,
            Err(_) => None,
        };
        let installed = version.is_some();
        let runtime_check = openclaw_check_dependencies().await;
        (version, installed, runtime_check.version)
    };

    let port_check = openclaw_check_port(OPENCLAW_PORT).await;

    // 3. Read sandbox info for response
    let (sandbox_type, isolation_tier) = {
        let sandbox_guard = state.sandbox.lock().await;
        match &*sandbox_guard {
            Some(sandbox) => (
                Some(sandbox.name().to_string()),
                Some(sandbox.isolation_tier().to_string()),
            ),
            None => (None, None),
        }
    };

    Ok(OpenClawStatus {
        installed: is_installed,
        running,
        runtime_version,
        openclaw_version,
        port_available: port_check.available,
        error: None,
        sandbox_type,
        isolation_tier,
    })
}

/// Restart the OpenClaw gateway. Blocks until the gateway is responsive.
#[tauri::command]
pub async fn openclaw_restart(state: State<'_, OpenClawState>) -> Result<(), String> {
    openclaw_stop(state.clone()).await?;
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    openclaw_start(state).await?;

    let max_wait = if is_docker_container_running().await { 60 } else { 15 };
    if !wait_for_gateway_ready(max_wait).await {
        return Err("Gateway did not become responsive after restart".to_string());
    }

    Ok(())
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

/// Validate a Telegram bot token by calling the Telegram Bot API.
/// Retries up to 3 times on transient connection errors.
#[tauri::command]
pub async fn telegram_validate_token(token: String) -> TelegramTokenValidation {
    if token.len() < 30 || !token.contains(':') {
        return TelegramTokenValidation {
            valid: false,
            bot_username: None,
            bot_name: None,
            error: Some("Invalid token format. Telegram tokens should look like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz".to_string()),
        };
    }

    let url = format!("https://api.telegram.org/bot{}/getMe", token);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TelegramTokenValidation {
                valid: false,
                bot_username: None,
                bot_name: None,
                error: Some(format!("Failed to create HTTP client: {}", e)),
            };
        }
    };

    const MAX_RETRIES: u32 = 3;
    let mut last_err = String::new();

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500 * u64::from(attempt))).await;
        }

        match client.get(&url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<serde_json::Value>().await {
                        Ok(data) => {
                            if data.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let result = data.get("result");
                                let username = result.and_then(|r| r.get("username")).and_then(|v| v.as_str()).map(String::from);
                                let name = result.and_then(|r| r.get("first_name")).and_then(|v| v.as_str()).map(String::from);

                                return TelegramTokenValidation {
                                    valid: true,
                                    bot_username: username,
                                    bot_name: name,
                                    error: None,
                                };
                            } else {
                                let description = data.get("description").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                                return TelegramTokenValidation {
                                    valid: false,
                                    bot_username: None,
                                    bot_name: None,
                                    error: Some(format!("Token validation failed: {}", description)),
                                };
                            }
                        }
                        Err(e) => {
                            return TelegramTokenValidation {
                                valid: false,
                                bot_username: None,
                                bot_name: None,
                                error: Some(format!("Failed to parse API response: {}", e)),
                            };
                        }
                    }
                } else {
                    return TelegramTokenValidation {
                        valid: false,
                        bot_username: None,
                        bot_name: None,
                        error: Some(format!("API returned error: {}", response.status())),
                    };
                }
            }
            Err(e) => {
                last_err = format!("{}", e);
                let is_transient = e.is_connect() || e.is_timeout() || e.is_request();
                if !is_transient {
                    break;
                }
                log::warn!("Telegram API connection error (attempt {}): {}", attempt + 1, e);
            }
        }
    }

    TelegramTokenValidation {
        valid: false,
        bot_username: None,
        bot_name: None,
        error: Some(format!(
            "Failed to connect to Telegram API after {} attempts: {}",
            MAX_RETRIES, last_err
        )),
    }
}

/// Enable a channel plugin in OpenClaw.
/// In Docker mode, writes directly to the config file to avoid CLI commands
/// that restart the gateway (killing the container's PID 1).
async fn enable_channel_plugin(channel: &str) -> Result<(), String> {
    log::info!("Enabling {} plugin", channel);

    if is_docker_container_running().await {
        let mut config = read_openclaw_config()?;

        // Schema: plugins.entries.<channel>.enabled (not plugins.<channel>)
        let plugins = config
            .as_object_mut()
            .ok_or("Config is not an object")?
            .entry("plugins")
            .or_insert_with(|| serde_json::json!({}));
        let plugins_obj = plugins
            .as_object_mut()
            .ok_or("plugins is not an object")?;
        let entries = plugins_obj
            .entry("entries")
            .or_insert_with(|| serde_json::json!({}));
        let entries_obj = entries
            .as_object_mut()
            .ok_or("plugins.entries is not an object")?;
        entries_obj.insert(
            channel.to_string(),
            serde_json::json!({ "enabled": true }),
        );

        write_openclaw_config(&config)?;
        return Ok(());
    }

    let enable_output = openclaw_command(&["plugins", "enable", channel]).await
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw plugins enable: {}", e))?;

    let stderr = String::from_utf8_lossy(&enable_output.stderr);
    let stdout = String::from_utf8_lossy(&enable_output.stdout);
    if !enable_output.status.success() {
        let combined = format!("{}{}", stdout, stderr);
        // Ignore "already enabled" type messages
        if !combined.contains("already") && !combined.contains("Enabled") {
            return Err(format!("Failed to enable {} plugin: {}", channel, combined));
        }
    }

    Ok(())
}

/// Configure Telegram channel with the bot token.
/// In Docker mode, writes config directly + restarts the container.
#[tauri::command]
pub async fn telegram_configure(token: String) -> Result<TelegramConfig, String> {
    log::info!("Configuring Telegram channel");

    let validation = telegram_validate_token(token.clone()).await;
    if !validation.valid {
        return Err(validation.error.unwrap_or_else(|| "Invalid token".to_string()));
    }

    ensure_gateway_bind_lan().await;

    enable_channel_plugin("telegram").await?;

    if is_docker_container_running().await {
        let mut config = read_openclaw_config()?;

        // Schema: botToken, enabled, dmPolicy, groupPolicy, streaming
        let channels = config
            .as_object_mut()
            .ok_or("Config is not an object")?
            .entry("channels")
            .or_insert_with(|| serde_json::json!({}));
        let channels_obj = channels
            .as_object_mut()
            .ok_or("channels is not an object")?;
        channels_obj.insert("telegram".to_string(), serde_json::json!({
            "botToken": token,
            "enabled": true,
            "dmPolicy": "pairing",
            "groupPolicy": "allowlist",
            "streaming": "off"
        }));

        // Ensure pairing credentials file exists
        let config_dir = get_openclaw_config_dir()?;
        let creds_dir = config_dir.join("credentials");
        std::fs::create_dir_all(&creds_dir)
            .map_err(|e| format!("Failed to create credentials dir: {}", e))?;
        let pairing_path = creds_dir.join("telegram-pairing.json");
        if !pairing_path.exists() {
            std::fs::write(
                &pairing_path,
                serde_json::to_string_pretty(&serde_json::json!({
                    "requests": [],
                    "version": 1
                })).unwrap(),
            )
            .map_err(|e| format!("Failed to write telegram-pairing.json: {}", e))?;
        }

        write_openclaw_config(&config)?;
    } else {
        let add_output = openclaw_command(&[
                "channels",
                "add",
                "--channel", "telegram",
                "--token", &token,
                "--account", "default",
            ]).await
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run openclaw channels add: {}", e))?;

        let add_stderr = String::from_utf8_lossy(&add_output.stderr);
        let add_stdout = String::from_utf8_lossy(&add_output.stdout);

        if !add_output.status.success() {
            let combined = format!("{}{}", add_stdout, add_stderr);
            if !combined.contains("already exists") && !combined.contains("updated") && !combined.contains("Added") {
                return Err(format!(
                    "Failed to add Telegram channel: {}",
                    if !add_stderr.is_empty() { add_stderr.to_string() } else { add_stdout.to_string() }
                ));
            }
        }
    }

    // Clear stale pending pairing codes from the credentials file.
    // This ensures the 3-code cap is reset so the user can get a fresh code
    // when they type /start in Telegram.
    {
        let config_dir = get_openclaw_config_dir()?;
        let pairing_path = config_dir.join("credentials").join("telegram-pairing.json");
        let creds_dir = config_dir.join("credentials");
        std::fs::create_dir_all(&creds_dir).ok();
        let empty = serde_json::json!({ "version": 1, "requests": [] });
        std::fs::write(&pairing_path, serde_json::to_string_pretty(&empty).unwrap())
            .map_err(|e| format!("Failed to clear pairing state: {}", e))?;
        log::info!("Reset pairing state for fresh code generation");
    }

    // Restart gateway so it picks up both the new channel config and the
    // clean pairing state. Use readiness polling instead of a fixed sleep.
    if check_gateway_responding().await {
        log::info!("Restarting gateway to apply Telegram config and pairing state");
        let _ = restart_gateway_cli().await;
        if !wait_for_gateway_ready(10).await {
            log::warn!("Gateway did not become responsive after Telegram configure restart");
        }
    }

    // Store in local config for Jan's reference
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

    log::info!("Telegram configured successfully via OpenClaw");

    Ok(TelegramConfig {
        bot_token: token,
        bot_username: validation.bot_username,
        connected: true, // Channel is added and connected
        pairing_code: None,
        paired_users: 0,
    })
}

/// Get current Telegram configuration.
///
/// Reads the local `telegram.json` reference file and reconciles it with the
/// live gateway state (if running) and the main `openclaw.json` config.
/// This ensures the UI shows the correct status regardless of whether the
/// channel was originally configured in Docker mode or direct process mode.
#[tauri::command]
pub async fn telegram_get_config() -> Result<TelegramConfig, String> {
    let config_dir = get_openclaw_config_dir()?;
    let telegram_config_path = config_dir.join("telegram.json");

    // Start with local file data (if it exists)
    let mut bot_token = String::new();
    let mut bot_username: Option<String> = None;
    let mut connected = false;
    let mut paired_users: u32 = 0;

    if telegram_config_path.exists() {
        if let Ok(config_json) = std::fs::read_to_string(&telegram_config_path) {
            if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&config_json) {
                bot_token = settings.get("bot_token").and_then(|v| v.as_str()).unwrap_or("").to_string();
                bot_username = settings.get("bot_username").and_then(|v| v.as_str()).map(String::from);
                connected = settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
                paired_users = settings.get("paired_users").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            }
        }
    }

    // If no local file, try to recover from openclaw.json (read-only — never
    // write back here; only explicit user actions should modify local files)
    if bot_token.is_empty() {
        if let Ok(main_config) = read_openclaw_config() {
            if let Some(tg) = main_config.get("channels").and_then(|c| c.get("telegram")) {
                if let Some(token) = tg.get("botToken").and_then(|v| v.as_str()) {
                    if !token.is_empty() {
                        log::info!("Recovered Telegram config from openclaw.json (in-memory only)");
                        bot_token = token.to_string();
                    }
                }
            }
        }
    }

    // If the gateway is running, check live channel status (read-only — report
    // actual state but never persist it; only connect/disconnect actions write)
    if !bot_token.is_empty() && check_gateway_responding().await {
        let params = serde_json::json!({ "probe": true, "timeoutMs": 5000 });
        if let Ok(status) = gateway_request("channels.status", params).await {
            if let Some(telegram) = status.get("channels").and_then(|c| c.get("telegram")) {
                let gw_configured = telegram.get("configured").and_then(|v| v.as_bool()).unwrap_or(false);
                let gw_running = telegram.get("running").and_then(|v| v.as_bool()).unwrap_or(false);
                let gw_probe_ok = telegram.get("probe")
                    .and_then(|p| p.get("ok"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let live_connected = gw_configured && gw_running && gw_probe_ok;
                connected = live_connected;
            }
        }
    }

    Ok(TelegramConfig {
        bot_token,
        bot_username,
        connected,
        pairing_code: None,
        paired_users,
    })
}

/// Clear all pending Telegram pairing codes.
///
/// OpenClaw caps pending pairing requests at 3 per channel.  After that,
/// `/start` silently does nothing until a code is approved or expires (1 h).
/// By resetting the pairing state file we guarantee the user always gets a
/// fresh code slot when they open the wizard or tap `/start` again.
///
/// After clearing, we restart the gateway so it reloads the empty state from
/// disk (the running process may have the old requests cached in memory).
#[tauri::command]
pub async fn telegram_clear_pending_pairing() -> Result<(), String> {
    log::info!("Clearing pending Telegram pairing codes");

    let config_dir = get_openclaw_config_dir()?;
    let pairing_path = config_dir.join("credentials").join("telegram-pairing.json");

    if pairing_path.exists() {
        // Reset to an empty request list (keep the version marker)
        let empty = serde_json::json!({ "version": 1, "requests": [] });
        std::fs::write(&pairing_path, serde_json::to_string_pretty(&empty).unwrap())
            .map_err(|e| format!("Failed to clear pairing state: {}", e))?;
        log::info!("Cleared pending pairing codes at {:?}", pairing_path);

        // Restart gateway so it picks up the clean state
        if check_gateway_responding().await {
            log::info!("Restarting gateway to reload pairing state");
            let _ = restart_gateway_cli().await;
            wait_for_gateway_ready(8).await;
        }
    } else {
        log::info!("No pairing state file to clear");
    }

    Ok(())
}

/// Read pending Telegram pairing codes from the credentials file.
///
/// Returns a list of pairing code strings that are currently pending approval.
/// The frontend can poll this to auto-populate the pairing code input field
/// when a user types `/start` in Telegram.
#[tauri::command]
pub async fn telegram_get_pending_pairing_codes() -> Result<Vec<String>, String> {
    let config_dir = get_openclaw_config_dir()?;
    let pairing_path = config_dir.join("credentials").join("telegram-pairing.json");

    if !pairing_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&pairing_path)
        .map_err(|e| format!("Failed to read pairing file: {}", e))?;
    let data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse pairing file: {}", e))?;

    let codes = data
        .get("requests")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|req| {
                    req.get("code")
                        .and_then(|c| c.as_str())
                        .map(String::from)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(codes)
}

/// Check if Telegram channel is actually connected in OpenClaw gateway
#[tauri::command]
pub async fn telegram_check_pairing() -> Result<bool, String> {
    log::info!("Checking Telegram channel status via OpenClaw gateway");

    // Try gateway WebSocket API first (same pattern as WhatsApp status check)
    let params = serde_json::json!({
        "probe": true,
        "timeoutMs": 10000
    });

    if let Ok(status) = gateway_request("channels.status", params).await {
        if let Some(channels) = status.get("channels") {
            if let Some(telegram) = channels.get("telegram") {
                // Telegram uses configured+running+probe.ok (not connected/linked like WhatsApp)
                let configured = telegram.get("configured")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let running = telegram.get("running")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let probe_ok = telegram.get("probe")
                    .and_then(|p| p.get("ok"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                log::info!("Telegram channel status - configured: {}, running: {}, probe.ok: {}", configured, running, probe_ok);
                return Ok(configured && running && probe_ok);
            }
        }
        log::info!("Telegram channel not found in gateway status response");
        return Ok(false);
    }

    // Fallback: try openclaw channels status --probe CLI
    log::info!("Gateway WebSocket unavailable, falling back to CLI check");
    let status_output = openclaw_command(&["channels", "status", "--probe"]).await
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    match status_output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            // Look for telegram in the output with connected/enabled/online status
            for line in stdout.lines() {
                if line.contains("telegram") {
                    let is_connected = line.contains("connected")
                        || line.contains("online")
                        || line.contains("enabled");
                    log::info!("Telegram CLI status line: {}, connected: {}", line.trim(), is_connected);
                    return Ok(is_connected);
                }
            }
            log::info!("Telegram not found in channels status output");
            Ok(false)
        }
        Err(e) => {
            log::warn!("Failed to check channel status via CLI: {}", e);
            // Last resort: check local config
            let config_dir = get_openclaw_config_dir()?;
            let telegram_config_path = config_dir.join("telegram.json");
            if telegram_config_path.exists() {
                let config_json = std::fs::read_to_string(&telegram_config_path)
                    .map_err(|e| format!("Failed to read Telegram config: {}", e))?;
                let settings: serde_json::Value = serde_json::from_str(&config_json)
                    .map_err(|e| format!("Failed to parse Telegram config: {}", e))?;
                Ok(settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false))
            } else {
                Ok(false)
            }
        }
    }
}

/// Approve a Telegram pairing code so the user can chat with Jan via the bot
///
/// When dmPolicy is set to "pairing", users must be approved before they can
/// interact with the bot. This runs `openclaw pairing approve telegram <code>`
#[tauri::command]
pub async fn telegram_approve_pairing(code: String) -> Result<(), String> {
    log::info!("Approving Telegram pairing code: {}", code);

    let output = openclaw_command(&["pairing", "approve", "telegram", &code]).await
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run openclaw pairing approve: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    log::info!("Pairing approve stdout: {}", stdout);
    if !stderr.is_empty() {
        log::info!("Pairing approve stderr: {}", stderr);
    }

    if output.status.success() {
        Ok(())
    } else {
        let error_msg = if !stderr.is_empty() {
            stderr.to_string()
        } else {
            stdout.to_string()
        };
        Err(format!("Failed to approve pairing: {}", error_msg.trim()))
    }
}

/// Disconnect Telegram channel
#[tauri::command]
pub async fn telegram_disconnect() -> Result<(), String> {
    log::info!("Disconnecting Telegram channel");

    // 1. Remove channel from openclaw.json — gateway hot-reloads on file change
    if let Ok(mut config) = read_openclaw_config() {
        if let Some(channels) = config.get_mut("channels").and_then(|c| c.as_object_mut()) {
            channels.remove("telegram");
            write_openclaw_config(&config)
                .map_err(|e| format!("Failed to update config: {}", e))?;
            log::info!("Telegram channel removed from openclaw.json (hot-reload will stop bot)");
        }
    }

    // 2. Delete local config file
    let config_dir = get_openclaw_config_dir()?;
    let telegram_config_path = config_dir.join("telegram.json");
    if telegram_config_path.exists() {
        let _ = std::fs::remove_file(&telegram_config_path);
    }

    // Also clean up pairing file
    let pairing_path = config_dir.join("credentials").join("telegram-pairing.json");
    if pairing_path.exists() {
        let _ = std::fs::remove_file(&pairing_path);
    }

    log::info!("Telegram channel fully disconnected and credentials removed");
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
    let list_output = openclaw_command(&["channels", "list"]).await
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
    let status_output = openclaw_command(&["channels", "status", "--probe"]).await
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

/// Check if WhatsApp is connected by reading the config.
/// Delegates to `whatsapp_get_config` which reconciles across sandbox modes.
#[tauri::command]
pub async fn whatsapp_validate_connection() -> Result<bool, String> {
    log::info!("Validating WhatsApp connection");
    let config = whatsapp_get_config().await?;
    Ok(config.connected)
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

    // Reset the restart counter for this new auth session
    WA_RESTART_COUNT.store(0, Ordering::SeqCst);

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

    // Now add WhatsApp channel using CLI.
    // With config directory isolation, auth_dir is always the correct host path
    // for the active sandbox — no Docker-specific path rewriting needed.
    let add_output = openclaw_command(&[
            "channels",
            "add",
            "--channel", "whatsapp",
            "--account", "default",
            "--auth-dir", &auth_dir.to_string_lossy(),
        ]).await
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

    // Use 65s transport timeout so the server-side 60s timeoutMs can fire first
    match gateway_request_with_timeout("web.login.start", qr_params, 65).await {
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

                    let running = whatsapp.get("running")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // "linked" means the account is paired with a phone (QR scanned)
                    // "connected" means the WebSocket is currently active
                    // "running" means the channel process is running
                    // All three must be true for WhatsApp to actually work
                    if linked && connected && running {
                        log::info!("WhatsApp is fully connected (linked + running + connected)");
                        update_whatsapp_connected_status(true).await?;

                        return Ok(WhatsAppAuthStatus {
                            in_progress: false,
                            qr_code_ready: false,
                            qr_code: None,
                            authenticated: true,
                            error: None,
                        });
                    }

                    if linked && (!connected || !running) {
                        // QR was scanned but the Gateway hasn't established the WhatsApp
                        // WebSocket connection yet. This is a transient state — the
                        // Gateway may need a restart to kick-start the connection.
                        log::info!(
                            "WhatsApp linked but not fully connected (running: {}, connected: {}), \
                            waiting for gateway to establish connection",
                            running, connected
                        );

                        // Restart the gateway up to MAX_WA_RESTART_ATTEMPTS times per
                        // auth session to nudge it into connecting. Counter is reset
                        // in whatsapp_start_auth.
                        let attempt = WA_RESTART_COUNT.fetch_add(1, Ordering::SeqCst);
                        if attempt < MAX_WA_RESTART_ATTEMPTS {
                            log::info!(
                                "Restarting gateway to establish WhatsApp connection (attempt {}/{})",
                                attempt + 1, MAX_WA_RESTART_ATTEMPTS
                            );
                            let _ = restart_gateway_cli().await;
                            // Give the gateway time to come back before the next poll
                            wait_for_gateway_ready(8).await;
                        }

                        // Return in_progress so the frontend keeps polling
                        return Ok(WhatsAppAuthStatus {
                            in_progress: true,
                            qr_code_ready: false,
                            qr_code: None,
                            authenticated: false,
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

                    // Only report fatal errors, not transient ones like 515 stream errors
                    // These can occur during connection establishment but the link often succeeds after
                    if let Some(ref err) = last_error {
                        let is_transient = err.contains("515") ||
                                          err.contains("restart required") ||
                                          err.contains("Stream Errored") ||
                                          err.contains("not linked") ||
                                          err.contains("not configured");    

                        if !is_transient && !linked {
                            return Ok(WhatsAppAuthStatus {
                                in_progress: false,
                                qr_code_ready: false,
                                qr_code: None,
                                authenticated: false,
                                error: last_error,
                            });
                        }
                        // For transient errors, continue checking - don't report as error yet
                    }
                }
            }

            // Still waiting for authentication — refresh the QR code from Gateway.
            // WhatsApp QR codes expire every ~20s, so we must fetch a fresh one
            // rather than serving the stale one from local config.
            let qr_params = serde_json::json!({
                "accountId": "default",
                "timeoutMs": 5000
            });

            let qr_code = match gateway_request("web.login.start", qr_params).await {
                Ok(qr_payload) => {
                    let qr = qr_payload.get("qrDataUrl")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    // Update local config with fresh QR
                    if let Some(ref qr_data) = qr {
                        if let Ok(config_path) = get_whatsapp_config_path() {
                            if config_path.exists() {
                                if let Ok(content) = std::fs::read_to_string(&config_path) {
                                    if let Ok(mut cfg) = serde_json::from_str::<serde_json::Value>(&content) {
                                        cfg["qr_code"] = serde_json::json!(qr_data);
                                        let _ = std::fs::write(&config_path, serde_json::to_string_pretty(&cfg).unwrap_or_default());
                                    }
                                }
                            }
                        }
                    }
                    qr
                }
                Err(_) => {
                    // Fall back to local config if Gateway call fails
                    let config_path = get_whatsapp_config_path()?;
                    if config_path.exists() {
                        std::fs::read_to_string(&config_path).ok()
                            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
                            .and_then(|settings| settings.get("qr_code").and_then(|v| v.as_str()).map(String::from))
                    } else {
                        None
                    }
                }
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

/// Get current WhatsApp configuration.
///
/// Reconciles across sandbox modes (Docker vs direct process):
/// 1. Reads local `whatsapp.json` first
/// 2. Falls back to `openclaw.json` if local file is absent or empty (cross-mode recovery)
/// 3. Probes live gateway `channels.status` to verify actual connected/linked state
/// 4. Persists reconciled state back to local file
///
/// This ensures the UI shows the correct status regardless of whether the
/// channel was originally configured in Docker mode or direct process mode.
#[tauri::command]
pub async fn whatsapp_get_config() -> Result<WhatsAppConfig, String> {
    let config_path = get_whatsapp_config_path()?;

    // Start with local file data (if it exists)
    let mut account_id = "default".to_string();
    let mut session_path = String::new();
    let mut connected = false;
    let mut phone_number: Option<String> = None;
    let mut qr_code: Option<String> = None;
    let mut contacts_count: u32 = 0;
    let mut has_local_data = false;

    if config_path.exists() {
        if let Ok(config_json) = std::fs::read_to_string(&config_path) {
            if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&config_json) {
                account_id = settings.get("account_id").and_then(|v| v.as_str()).unwrap_or("default").to_string();
                session_path = settings.get("session_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                connected = settings.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
                phone_number = settings.get("phone_number").and_then(|v| v.as_str()).map(String::from);
                qr_code = settings.get("qr_code").and_then(|v| v.as_str()).map(String::from);
                contacts_count = settings.get("contacts_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                // Consider local data present if connected or has phone number
                has_local_data = connected || phone_number.is_some();
            }
        }
    }

    // If no meaningful local data, check openclaw.json (read-only — never write
    // back here; only explicit user actions should modify local files)
    if !has_local_data {
        if let Ok(main_config) = read_openclaw_config() {
            if let Some(wa) = main_config.get("channels").and_then(|c| c.get("whatsapp")) {
                let enabled = wa.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
                if enabled {
                    log::info!("WhatsApp channel enabled in openclaw.json (in-memory only)");
                }
            }
        }
    }

    // If the gateway is running, check live channel status (read-only — report
    // actual state but never persist it; only connect/disconnect actions write)
    if check_gateway_responding().await {
        let params = serde_json::json!({ "probe": true, "timeoutMs": 5000 });
        if let Ok(status) = gateway_request("channels.status", params).await {
            if let Some(whatsapp) = status.get("channels").and_then(|c| c.get("whatsapp")) {
                let gw_running = whatsapp.get("running")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let gw_linked = whatsapp.get("linked")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                // linked=true just means session auth exists (credentials kept after disconnect).
                // The channel is only truly active when the gateway is running it.
                connected = gw_running && gw_linked;
            }
        }
    }

    Ok(WhatsAppConfig {
        account_id,
        session_path,
        connected,
        phone_number,
        qr_code,
        contacts_count,
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

    // 1. Remove channel from openclaw.json — gateway hot-reloads on file change
    if let Ok(mut config) = read_openclaw_config() {
        if let Some(channels) = config.get_mut("channels").and_then(|c| c.as_object_mut()) {
            channels.remove("whatsapp");
            write_openclaw_config(&config)
                .map_err(|e| format!("Failed to update config: {}", e))?;
            log::info!("WhatsApp channel removed from openclaw.json (hot-reload will stop bot)");
        }
    }

    // 2. Delete local config file
    let config_path = get_whatsapp_config_path()?;
    if config_path.exists() {
        let _ = std::fs::remove_file(&config_path);
    }

    // 3. Delete WhatsApp auth/session directory
    let config_dir = get_openclaw_config_dir()?;
    let auth_dir = config_dir.join("whatsapp_auth");
    if auth_dir.exists() {
        let _ = std::fs::remove_dir_all(&auth_dir);
    }

    log::info!("WhatsApp channel fully disconnected and credentials removed");
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

/// Set the authentication mode.
#[tauri::command]
pub async fn security_set_auth_mode(mode: AuthMode) -> Result<(), String> {
    log::info!("Setting auth mode to {:?}", mode);

    let mut config = security::load_security_config().await?;
    config.auth_mode = mode.clone();
    security::save_security_config(&config).await?;

    if mode == AuthMode::None {
        if let Ok(mut oc_config) = read_openclaw_config() {
            if let Some(auth) = oc_config.pointer_mut("/gateway/auth") {
                if let Some(obj) = auth.as_object_mut() {
                    obj.remove("token");
                }
            }
            if let Err(e) = write_openclaw_config(&oc_config) {
                log::warn!("Failed to clear gateway auth token: {}", e);
            }
        }
    }

    Ok(())
}

/// Generate and store a new access token.
/// Returns the plaintext token (only shown once).
#[tauri::command]
pub async fn security_generate_token() -> Result<String, String> {
    log::info!("Generating new access token");

    let token = security::generate_access_token();
    let hash = security::hash_token(&token);

    let mut config = security::load_security_config().await?;
    config.token_hash = Some(hash);
    config.auth_mode = AuthMode::Token;
    security::save_security_config(&config).await?;

    // Also write to gateway config so OpenClaw enforces this token
    if let Ok(mut oc_config) = read_openclaw_config() {
        oc_config["gateway"]["auth"]["token"] = serde_json::json!(token);
        if let Err(e) = write_openclaw_config(&oc_config) {
            log::warn!("Failed to sync token to gateway config: {}", e);
        }
    }

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
// Sandbox Commands
// ============================================

use crate::core::openclaw::sandbox::SandboxMode;

/// Get sandbox logs
///
/// Returns the last N lines of logs from the sandboxed OpenClaw process.
#[tauri::command]
pub async fn sandbox_get_logs(
    state: State<'_, OpenClawState>,
    lines: usize,
) -> Result<Vec<String>, String> {
    log::info!("Getting sandbox logs (lines: {})", lines);

    let mode = state.sandbox_mode.lock().await;
    let sandbox_guard = state.sandbox.lock().await;

    match (&*mode, &*sandbox_guard) {
        (SandboxMode::Active { handle, .. }, Some(sandbox)) => {
            sandbox.logs(handle, lines).await
        }
        _ => {
            // Try to read from the gateway log file directly
            let config_dir = get_openclaw_config_dir()?;
            let log_path = config_dir.join("gateway.log");

            if log_path.exists() {
                let content = tokio::fs::read_to_string(&log_path)
                    .await
                    .map_err(|e| format!("Failed to read log file: {}", e))?;

                let all_lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
                let start = if all_lines.len() > lines {
                    all_lines.len() - lines
                } else {
                    0
                };
                Ok(all_lines[start..].to_vec())
            } else {
                Ok(vec!["No logs available. OpenClaw may not be running.".to_string()])
            }
        }
    }
}

/// Restart the sandboxed OpenClaw process
///
/// Stops the current sandbox (if running) and starts a fresh one.
/// This is useful for recovering from errors or applying configuration changes.
#[tauri::command]
pub async fn sandbox_restart(state: State<'_, OpenClawState>) -> Result<(), String> {
    log::info!("Restarting sandbox");

    // Stop the current sandbox if active
    {
        let mut mode = state.sandbox_mode.lock().await;
        let sandbox_guard = state.sandbox.lock().await;

        if let SandboxMode::Active { handle, sandbox_name, isolation_tier } = std::mem::take(&mut *mode) {
            if let Some(sandbox) = &*sandbox_guard {
                log::info!("Stopping sandbox {} ({:?})", sandbox_name, isolation_tier);
                let mut handle = handle;
                let _ = sandbox.stop(&mut handle).await;
            }
        }
        *mode = SandboxMode::Inactive;
    }

    // Start fresh
    openclaw_start(state).await
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
