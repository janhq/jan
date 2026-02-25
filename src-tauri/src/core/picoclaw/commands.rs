use std::path::PathBuf;
use std::process::Stdio;

use tauri::State;
use tokio::process::Command;

use crate::core::picoclaw::{
    constants::*,
    models::*,
    get_picoclaw_config_path, get_picoclaw_config_dir, get_picoclaw_binary_path,
    PicoClawState, DEFAULT_PICOCLAW_PORT,
};

/// Check if a port is available
#[tauri::command]
pub async fn picoclaw_check_port(port: u16) -> PortCheckResult {
    log::info!("Checking if port {} is available for PicoClaw", port);

    let addr = format!("127.0.0.1:{}", port);

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

/// Check if PicoClaw binary exists and get its version
async fn check_picoclaw_binary() -> Result<Option<(String, PathBuf)>, String> {
    let binary_path = get_picoclaw_binary_path()?;

    if !binary_path.exists() {
        return Ok(None);
    }

    // Try to get version
    let output = Command::new(&binary_path)
        .arg("--version")
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok(Some((version, binary_path)))
            } else {
                // Binary exists but version check failed - still consider it installed
                Ok(Some(("unknown".to_string(), binary_path)))
            }
        }
        Err(_) => {
            // Binary exists but couldn't execute - might be permission issue
            Ok(Some(("unknown".to_string(), binary_path)))
        }
    }
}

/// Detect if PicoClaw is installed
#[tauri::command]
pub async fn picoclaw_detect() -> PicoClawStatus {
    log::info!("Detecting PicoClaw installation");

    let binary_info = match check_picoclaw_binary().await {
        Ok(info) => info,
        Err(e) => {
            return PicoClawStatus {
                installed: false,
                running: false,
                version: None,
                binary_path: None,
                port_available: true,
                error: Some(e),
            };
        }
    };

    let port_check = picoclaw_check_port(DEFAULT_PICOCLAW_PORT).await;

    match binary_info {
        Some((version, path)) => PicoClawStatus {
            installed: true,
            running: false, // Will be updated by status check
            version: Some(version),
            binary_path: Some(path.to_string_lossy().to_string()),
            port_available: port_check.available,
            error: None,
        },
        None => PicoClawStatus {
            installed: false,
            running: false,
            version: None,
            binary_path: None,
            port_available: port_check.available,
            error: None,
        },
    }
}

/// Download and install PicoClaw binary
#[tauri::command]
pub async fn picoclaw_install() -> Result<InstallResult, String> {
    log::info!("Installing PicoClaw binary");

    // Create config directory if it doesn't exist
    let _config_dir = get_picoclaw_config_dir()?;

    // Determine download URL
    let download_url = get_releases_url();
    log::info!("Downloading PicoClaw from: {}", download_url);

    // Download the binary
    let response = reqwest::get(&download_url)
        .await
        .map_err(|e| format!("Failed to download PicoClaw: {}", e))?;

    if !response.status().is_success() {
        return Ok(InstallResult {
            success: false,
            version: None,
            binary_path: None,
            error: Some(format!("Download failed with status: {}", response.status())),
        });
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    // Save the binary
    let binary_path = get_picoclaw_binary_path()?;
    std::fs::write(&binary_path, &bytes)
        .map_err(|e| format!("Failed to save binary: {}", e))?;

    // Make it executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    // Verify installation
    match check_picoclaw_binary().await {
        Ok(Some((version, path))) => {
            log::info!("PicoClaw installed successfully: {} at {:?}", version, path);
            Ok(InstallResult {
                success: true,
                version: Some(version),
                binary_path: Some(path.to_string_lossy().to_string()),
                error: None,
            })
        }
        Ok(None) => Ok(InstallResult {
            success: false,
            version: None,
            binary_path: None,
            error: Some("Binary was saved but verification failed".to_string()),
        }),
        Err(e) => Ok(InstallResult {
            success: false,
            version: None,
            binary_path: None,
            error: Some(e),
        }),
    }
}

/// Generate the default PicoClaw configuration
fn generate_default_config(input: Option<PicoClawConfigInput>) -> PicoClawConfig {
    let mut config = PicoClawConfig::default();

    if let Some(input) = input {
        if let Some(port) = input.port {
            config.gateway.port = port;
        }
        if let Some(host) = input.host {
            config.gateway.host = host;
        }
        if let Some(base_url) = input.jan_base_url {
            config.providers.jan.api_base = base_url;
        }
        if let Some(model_id) = input.model_id {
            config.agents.defaults.model = format!("jan/{}", model_id);
        }
    }

    // Add default web search tool
    config.tools = ToolsConfig {
        web: Some(WebToolsConfig {
            duckduckgo: Some(DuckDuckGoConfig::default()),
        }),
    };

    config
}

/// Configure PicoClaw with the specified settings
#[tauri::command]
pub async fn picoclaw_configure(config_input: Option<PicoClawConfigInput>) -> Result<PicoClawConfig, String> {
    log::info!("Configuring PicoClaw");

    let config = generate_default_config(config_input);

    // Ensure config directory exists
    let config_dir = get_picoclaw_config_dir()?;

    // Create workspace directory
    let workspace_dir = config_dir.join("workspace");
    if !workspace_dir.exists() {
        std::fs::create_dir_all(&workspace_dir)
            .map_err(|e| format!("Failed to create workspace: {}", e))?;
    }

    // Write config file
    let config_path = get_picoclaw_config_path()?;
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("PicoClaw configuration written to {:?}", config_path);
    Ok(config)
}

/// Get the current PicoClaw configuration
#[tauri::command]
pub async fn picoclaw_get_config() -> Result<PicoClawConfig, String> {
    let config_path = get_picoclaw_config_path()?;

    if !config_path.exists() {
        // Return default config if no config exists
        return Ok(PicoClawConfig::default());
    }

    let config_json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

/// Start the PicoClaw gateway
#[tauri::command]
pub async fn picoclaw_start(state: State<'_, PicoClawState>) -> Result<(), String> {
    log::info!("Starting PicoClaw gateway");

    // Check if already running
    {
        let handle = state.process_handle.lock().await;
        if handle.is_some() {
            return Err("PicoClaw is already running".to_string());
        }
    }

    // Check if binary exists
    let binary_path = get_picoclaw_binary_path()?;
    if !binary_path.exists() {
        return Err("PicoClaw is not installed. Please install it first.".to_string());
    }

    // Check port availability
    let port_check = picoclaw_check_port(DEFAULT_PICOCLAW_PORT).await;
    if !port_check.available {
        return Err(format!("Port {} is already in use", DEFAULT_PICOCLAW_PORT));
    }

    // Ensure config exists
    let config_path = get_picoclaw_config_path()?;
    if !config_path.exists() {
        // Generate default config
        picoclaw_configure(None).await?;
    }

    // Start PicoClaw gateway
    let config_dir = get_picoclaw_config_dir()?;
    let mut child = Command::new(&binary_path)
        .arg("gateway")
        .current_dir(&config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start PicoClaw: {}", e))?;

    // Wait a bit for the process to start
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Check if process is still running
    match child.try_wait().map_err(|e| format!("Failed to check process: {}", e)) {
        Ok(Some(status)) => {
            if !status.success() {
                return Err(format!("PicoClaw failed to start: {:?}", status));
            }
        }
        Ok(None) => {
            // Process is running, store the handle
            let mut handle = state.process_handle.lock().await;
            *handle = Some(child);
            log::info!("PicoClaw gateway started successfully on port {}", DEFAULT_PICOCLAW_PORT);
        }
        Err(e) => {
            return Err(format!("Failed to check process status: {}", e));
        }
    }

    Ok(())
}

/// Stop the PicoClaw gateway
#[tauri::command]
pub async fn picoclaw_stop(state: State<'_, PicoClawState>) -> Result<(), String> {
    log::info!("Stopping PicoClaw gateway");

    let mut handle = state.process_handle.lock().await;

    if let Some(mut child) = handle.take() {
        // Try graceful shutdown first
        match child.kill().await {
            Ok(_) => {
                log::info!("PicoClaw gateway stopped");
                Ok(())
            }
            Err(e) => {
                log::warn!("Failed to stop PicoClaw gracefully: {}", e);
                // Try to force kill
                let _ = child.start_kill();
                Ok(())
            }
        }
    } else {
        // Process not tracked, try to kill by name
        #[cfg(unix)]
        {
            let output = Command::new("pkill")
                .arg("-f")
                .arg("picoclaw")
                .output()
                .await
                .map_err(|e| format!("Failed to run pkill: {}", e))?;

            if output.status.success() {
                Ok(())
            } else {
                Err("PicoClaw process not found".to_string())
            }
        }

        #[cfg(target_os = "windows")]
        {
            let output = Command::new("taskkill")
                .args(&["/F", "/IM", "picoclaw.exe"])
                .output()
                .await
                .map_err(|e| format!("Failed to run taskkill: {}", e))?;

            if output.status.success() {
                Ok(())
            } else {
                Err("PicoClaw process not found".to_string())
            }
        }
    }
}

/// Get the current PicoClaw status
#[tauri::command]
pub async fn picoclaw_status(state: State<'_, PicoClawState>) -> Result<PicoClawStatus, String> {
    log::info!("Getting PicoClaw status");

    // Check if process is running
    let running = {
        let mut handle = state.process_handle.lock().await;
        if let Some(ref mut child) = *handle {
            match child.try_wait() {
                Ok(Some(_)) => {
                    // Process has exited, clear the handle
                    *handle = None;
                    false
                }
                Ok(None) => true, // Process is still running
                Err(_) => false,
            }
        } else {
            false
        }
    };

    // Check if binary is installed
    let binary_info = match check_picoclaw_binary().await {
        Ok(info) => info,
        Err(e) => {
            return Ok(PicoClawStatus {
                installed: false,
                running: false,
                version: None,
                binary_path: None,
                port_available: true,
                error: Some(e),
            });
        }
    };

    // Check port
    let port_check = picoclaw_check_port(DEFAULT_PICOCLAW_PORT).await;

    match binary_info {
        Some((version, path)) => Ok(PicoClawStatus {
            installed: true,
            running,
            version: Some(version),
            binary_path: Some(path.to_string_lossy().to_string()),
            port_available: port_check.available || running, // Port is "available" if we're using it
            error: None,
        }),
        None => Ok(PicoClawStatus {
            installed: false,
            running: false,
            version: None,
            binary_path: None,
            port_available: port_check.available,
            error: None,
        }),
    }
}

/// Restart the PicoClaw gateway
#[tauri::command]
pub async fn picoclaw_restart(state: State<'_, PicoClawState>) -> Result<(), String> {
    log::info!("Restarting PicoClaw gateway");

    // Stop first
    let _ = picoclaw_stop(state.clone()).await;

    // Wait a bit for the process to fully terminate
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Start again
    picoclaw_start(state).await
}

/// Get the PicoClaw configuration directory path
#[tauri::command]
pub fn picoclaw_get_config_dir() -> Result<String, String> {
    let path = get_picoclaw_config_dir()?;
    Ok(path.to_string_lossy().to_string())
}

/// One-click enable PicoClaw remote access
/// This handles detection, installation, configuration, and startup
#[tauri::command]
pub async fn picoclaw_enable(
    state: State<'_, PicoClawState>,
    config_input: Option<PicoClawConfigInput>,
) -> Result<PicoClawStatus, String> {
    log::info!("Enabling PicoClaw remote access (1-click setup)");

    // Step 1: Detect current status
    let mut status = picoclaw_detect().await;

    // Step 2: Install if not installed
    if !status.installed {
        log::info!("PicoClaw not installed, installing...");
        let install_result = picoclaw_install().await?;

        if !install_result.success {
            return Err(install_result.error.unwrap_or_else(|| "Installation failed".to_string()));
        }

        status.installed = true;
        status.version = install_result.version;
        status.binary_path = install_result.binary_path;
    }

    // Step 3: Configure with Jan as provider
    log::info!("Configuring PicoClaw...");
    picoclaw_configure(config_input).await?;

    // Step 4: Start the gateway
    log::info!("Starting PicoClaw gateway...");
    picoclaw_start(state.clone()).await?;

    // Step 5: Return final status
    picoclaw_status(state).await
}

/// Configure Telegram channel for PicoClaw
/// Reuses the validation logic but stores in PicoClaw config
#[tauri::command]
pub async fn picoclaw_telegram_configure(token: String, user_id: Option<String>) -> Result<(), String> {
    log::info!("Configuring Telegram channel for PicoClaw");

    // Get current config
    let mut config = picoclaw_get_config().await?;

    // Update Telegram configuration
    config.channels.telegram = Some(TelegramChannelConfig {
        enabled: true,
        token,
        allow_from: user_id.map(|id| vec![id]).unwrap_or_default(),
    });

    // Write updated config
    let config_path = get_picoclaw_config_path()?;
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    log::info!("Telegram configured for PicoClaw");
    Ok(())
}

/// Configure Discord channel for PicoClaw
#[tauri::command]
pub async fn picoclaw_discord_configure(token: String, user_id: Option<String>, mention_only: bool) -> Result<(), String> {
    log::info!("Configuring Discord channel for PicoClaw");

    // Get current config
    let mut config = picoclaw_get_config().await?;

    // Update Discord configuration
    config.channels.discord = Some(DiscordChannelConfig {
        enabled: true,
        token,
        allow_from: user_id.map(|id| vec![id]).unwrap_or_default(),
        mention_only,
    });

    // Write updated config
    let config_path = get_picoclaw_config_path()?;
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    log::info!("Discord configured for PicoClaw");
    Ok(())
}

/// Get Telegram channel configuration for PicoClaw
#[tauri::command]
pub async fn picoclaw_telegram_get_config() -> Result<Option<TelegramChannelConfig>, String> {
    let config = picoclaw_get_config().await?;
    Ok(config.channels.telegram)
}

/// Get Discord channel configuration for PicoClaw
#[tauri::command]
pub async fn picoclaw_discord_get_config() -> Result<Option<DiscordChannelConfig>, String> {
    let config = picoclaw_get_config().await?;
    Ok(config.channels.discord)
}
