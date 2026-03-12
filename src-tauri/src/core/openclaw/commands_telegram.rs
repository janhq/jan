use std::process::Stdio;

use serde::{Deserialize, Serialize};

use crate::core::openclaw::get_openclaw_config_dir;

use super::commands::{
    check_gateway_responding, enable_channel_plugin, ensure_gateway_bind_lan,
    gateway_request, is_docker_container_running, openclaw_command, read_openclaw_config,
    restart_gateway_cli, wait_for_gateway_ready, write_openclaw_config,
};

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
