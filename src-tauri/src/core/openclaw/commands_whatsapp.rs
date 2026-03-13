use std::process::Stdio;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

use crate::core::openclaw::{
    get_openclaw_config_dir, OpenClawState,
};

use super::commands::{
    check_gateway_responding, enable_channel_plugin, gateway_request,
    gateway_request_with_timeout, openclaw_command, openclaw_setup_for_channels,
    read_openclaw_config, restart_gateway_cli, wait_for_gateway_ready,
    write_openclaw_config,
};

static WA_RESTART_COUNT: AtomicU8 = AtomicU8::new(0);
const MAX_WA_RESTART_ATTEMPTS: u8 = 3;

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
