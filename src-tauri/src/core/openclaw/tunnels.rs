//! Tunnel provider detection and management for OpenClaw remote access.
//!
//! This module provides support for multiple tunnel providers (ngrok, cloudflared, Tailscale)
//! to enable remote access to the Jan OpenClaw gateway.

use std::process::Stdio;
use std::sync::Arc;

use chrono::Utc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::models::{TunnelConfig, TunnelInfo, TunnelProvider, TunnelProviderStatus, TunnelProvidersStatus};
use super::get_openclaw_config_dir;

/// Shared tunnel state for managing active tunnel processes
#[derive(Clone)]
pub struct TunnelState {
    /// Process handle for the active tunnel
    pub process_handle: Arc<Mutex<Option<tokio::process::Child>>>,
    /// Information about the active tunnel
    pub active_tunnel: Arc<Mutex<Option<TunnelInfo>>>,
    /// Current tunnel configuration
    pub config: Arc<Mutex<TunnelConfig>>,
}

impl Default for TunnelState {
    fn default() -> Self {
        Self {
            process_handle: Arc::new(Mutex::new(None)),
            active_tunnel: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(TunnelConfig::default())),
        }
    }
}

/// Get the tunnel configuration file path
pub fn get_tunnel_config_path() -> Result<std::path::PathBuf, String> {
    Ok(get_openclaw_config_dir()?.join("tunnel.json"))
}

/// Load tunnel configuration from disk
pub async fn load_tunnel_config() -> Result<TunnelConfig, String> {
    let config_path = get_tunnel_config_path()?;

    if !config_path.exists() {
        return Ok(TunnelConfig::default());
    }

    let config_json = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("Failed to read tunnel config: {}", e))?;

    serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse tunnel config: {}", e))
}

/// Save tunnel configuration to disk
pub async fn save_tunnel_config(config: &TunnelConfig) -> Result<(), String> {
    let config_path = get_tunnel_config_path()?;

    let config_json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize tunnel config: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("Failed to write tunnel config: {}", e))
}

/// Check if ngrok is installed and get its status
pub async fn detect_ngrok() -> TunnelProviderStatus {
    log::info!("Detecting ngrok installation");

    let output = Command::new("ngrok")
        .arg("version")
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // ngrok version outputs like "ngrok version 3.x.x"
                let version = version_output
                    .split_whitespace()
                    .last()
                    .map(String::from);

                // Check if ngrok is authenticated by trying to get the config
                let authenticated = check_ngrok_authenticated().await;

                TunnelProviderStatus {
                    provider: TunnelProvider::Ngrok,
                    installed: true,
                    authenticated,
                    version,
                    error: None,
                }
            } else {
                TunnelProviderStatus {
                    provider: TunnelProvider::Ngrok,
                    installed: false,
                    authenticated: false,
                    version: None,
                    error: Some("ngrok command failed".to_string()),
                }
            }
        }
        Err(_) => TunnelProviderStatus {
            provider: TunnelProvider::Ngrok,
            installed: false,
            authenticated: false,
            version: None,
            error: None,
        },
    }
}

/// Check if ngrok is authenticated
async fn check_ngrok_authenticated() -> bool {
    // Try to check ngrok config for authtoken
    let output = Command::new("ngrok")
        .args(["config", "check"])
        .output()
        .await;

    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

/// Check if cloudflared is installed and get its status
pub async fn detect_cloudflared() -> TunnelProviderStatus {
    log::info!("Detecting cloudflared installation");

    let output = Command::new("cloudflared")
        .arg("version")
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // cloudflared version outputs like "cloudflared version 2024.x.x (built 2024-xx-xx)"
                let version = version_output
                    .split_whitespace()
                    .nth(2)
                    .map(String::from);

                // Check if cloudflared has tunnels configured
                let authenticated = check_cloudflared_authenticated().await;

                TunnelProviderStatus {
                    provider: TunnelProvider::Cloudflare,
                    installed: true,
                    authenticated,
                    version,
                    error: None,
                }
            } else {
                TunnelProviderStatus {
                    provider: TunnelProvider::Cloudflare,
                    installed: false,
                    authenticated: false,
                    version: None,
                    error: Some("cloudflared command failed".to_string()),
                }
            }
        }
        Err(_) => TunnelProviderStatus {
            provider: TunnelProvider::Cloudflare,
            installed: false,
            authenticated: false,
            version: None,
            error: None,
        },
    }
}

/// Check if cloudflared is authenticated (has tunnels)
async fn check_cloudflared_authenticated() -> bool {
    // Try to list tunnels to see if authenticated
    let output = Command::new("cloudflared")
        .args(["tunnel", "list"])
        .output()
        .await;

    match output {
        Ok(output) => {
            // If the command succeeds and doesn't show an error about authentication
            let stderr = String::from_utf8_lossy(&output.stderr);
            output.status.success() && !stderr.contains("You did not provide credentials")
        }
        Err(_) => false,
    }
}

/// Check if Tailscale is installed and get its status
pub async fn detect_tailscale() -> TunnelProviderStatus {
    log::info!("Detecting Tailscale installation");

    let output = Command::new("tailscale")
        .arg("version")
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // tailscale version outputs just the version number
                let version = version_output.lines().next().map(String::from);

                // Check if Tailscale is running and logged in
                let authenticated = check_tailscale_authenticated().await;

                TunnelProviderStatus {
                    provider: TunnelProvider::Tailscale,
                    installed: true,
                    authenticated,
                    version,
                    error: None,
                }
            } else {
                TunnelProviderStatus {
                    provider: TunnelProvider::Tailscale,
                    installed: false,
                    authenticated: false,
                    version: None,
                    error: Some("tailscale command failed".to_string()),
                }
            }
        }
        Err(_) => TunnelProviderStatus {
            provider: TunnelProvider::Tailscale,
            installed: false,
            authenticated: false,
            version: None,
            error: None,
        },
    }
}

/// Check if Tailscale is authenticated
async fn check_tailscale_authenticated() -> bool {
    let output = Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                // Parse JSON to check BackendState
                let json_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    // BackendState should be "Running" when logged in
                    json.get("BackendState")
                        .and_then(|v| v.as_str())
                        .map(|s| s == "Running")
                        .unwrap_or(false)
                } else {
                    false
                }
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

/// Get status of all tunnel providers
pub async fn get_tunnel_providers(tunnel_state: &TunnelState) -> TunnelProvidersStatus {
    log::info!("Getting status of all tunnel providers");

    // Run all detections in parallel
    let (tailscale, ngrok, cloudflare) = tokio::join!(
        detect_tailscale(),
        detect_ngrok(),
        detect_cloudflared()
    );

    // Get current config and active tunnel
    let config = tunnel_state.config.lock().await;
    let active_tunnel = tunnel_state.active_tunnel.lock().await.clone();

    TunnelProvidersStatus {
        tailscale,
        ngrok,
        cloudflare,
        active_provider: config.preferred_provider.clone(),
        active_tunnel,
    }
}

/// Start ngrok tunnel
pub async fn start_ngrok_tunnel(
    tunnel_state: &TunnelState,
    port: u16,
    auth_token: Option<String>,
) -> Result<TunnelInfo, String> {
    log::info!("Starting ngrok tunnel on port {}", port);

    // Check if already running
    {
        let handle = tunnel_state.process_handle.lock().await;
        if handle.is_some() {
            return Err("A tunnel is already running".to_string());
        }
    }

    // If auth token provided, configure ngrok
    if let Some(token) = &auth_token {
        let output = Command::new("ngrok")
            .args(["config", "add-authtoken", token])
            .output()
            .await
            .map_err(|e| format!("Failed to configure ngrok auth token: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to set ngrok auth token: {}", stderr));
        }
    }

    // Start ngrok with JSON log format
    let mut child = Command::new("ngrok")
        .args(["http", &port.to_string(), "--log=stdout", "--log-format=json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ngrok: {}", e))?;

    // Read stdout to get the public URL
    let stdout = child.stdout.take()
        .ok_or("Failed to capture ngrok stdout")?;

    let mut reader = BufReader::new(stdout).lines();
    let mut public_url: Option<String> = None;

    // Set a timeout for URL detection
    let timeout = tokio::time::Duration::from_secs(30);
    let start = tokio::time::Instant::now();

    while start.elapsed() < timeout {
        match tokio::time::timeout(tokio::time::Duration::from_secs(1), reader.next_line()).await {
            Ok(Ok(Some(line))) => {
                // Parse JSON log line
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    // Look for the URL in the log
                    if let Some(url) = json.get("url").and_then(|v| v.as_str()) {
                        if url.starts_with("https://") {
                            public_url = Some(url.to_string());
                            break;
                        }
                    }
                    // Also check msg field for URL assignment
                    if let Some(msg) = json.get("msg").and_then(|v| v.as_str()) {
                        if msg.contains("started tunnel") {
                            if let Some(url) = json.get("url").and_then(|v| v.as_str()) {
                                public_url = Some(url.to_string());
                                break;
                            }
                        }
                    }
                }
            }
            Ok(Ok(None)) => break, // EOF
            Ok(Err(e)) => {
                log::warn!("Error reading ngrok output: {}", e);
                break;
            }
            Err(_) => continue, // Timeout, try again
        }
    }

    // If we couldn't get the URL from logs, try the API
    if public_url.is_none() {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        public_url = get_ngrok_url_from_api().await;
    }

    let url = public_url.ok_or("Failed to get ngrok public URL")?;

    let tunnel_info = TunnelInfo {
        provider: TunnelProvider::Ngrok,
        url,
        started_at: Utc::now().to_rfc3339(),
        port,
        is_public: true,
    };

    // Store the process handle and tunnel info
    {
        let mut handle = tunnel_state.process_handle.lock().await;
        *handle = Some(child);
    }
    {
        let mut active = tunnel_state.active_tunnel.lock().await;
        *active = Some(tunnel_info.clone());
    }

    log::info!("ngrok tunnel started: {}", tunnel_info.url);
    Ok(tunnel_info)
}

/// Get ngrok URL from the local API
async fn get_ngrok_url_from_api() -> Option<String> {
    // ngrok runs a local API on port 4040
    let client = reqwest::Client::new();
    let response = client
        .get("http://127.0.0.1:4040/api/tunnels")
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().await.ok()?;

    // Find the https tunnel
    json.get("tunnels")?
        .as_array()?
        .iter()
        .find_map(|tunnel| {
            let url = tunnel.get("public_url")?.as_str()?;
            if url.starts_with("https://") {
                Some(url.to_string())
            } else {
                None
            }
        })
}

/// Stop ngrok tunnel
pub async fn stop_ngrok_tunnel(tunnel_state: &TunnelState) -> Result<(), String> {
    log::info!("Stopping ngrok tunnel");

    let mut handle = tunnel_state.process_handle.lock().await;

    if let Some(mut child) = handle.take() {
        child.kill().await
            .map_err(|e| format!("Failed to kill ngrok process: {}", e))?;

        // Clear active tunnel
        let mut active = tunnel_state.active_tunnel.lock().await;
        *active = None;

        log::info!("ngrok tunnel stopped");
        Ok(())
    } else {
        // Try to kill any orphaned ngrok processes
        #[cfg(unix)]
        {
            let _ = Command::new("pkill")
                .args(["-f", "ngrok"])
                .output()
                .await;
        }

        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", "ngrok.exe"])
                .output()
                .await;
        }

        Ok(())
    }
}

/// Start cloudflared tunnel
pub async fn start_cloudflared_tunnel(
    tunnel_state: &TunnelState,
    port: u16,
    tunnel_name: Option<String>,
) -> Result<TunnelInfo, String> {
    log::info!("Starting cloudflared tunnel on port {}", port);

    // Check if already running
    {
        let handle = tunnel_state.process_handle.lock().await;
        if handle.is_some() {
            return Err("A tunnel is already running".to_string());
        }
    }

    let url = format!("http://localhost:{}", port);

    // Build command args based on whether we have a named tunnel or quick tunnel
    let (child, public_url) = if let Some(name) = tunnel_name {
        // Named tunnel (requires pre-configuration)
        let child = Command::new("cloudflared")
            .args(["tunnel", "run", "--url", &url, &name])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start cloudflared: {}", e))?;

        // For named tunnels, the URL is typically <tunnel-name>.<domain>
        // We need to get this from the tunnel configuration
        let tunnel_url = get_cloudflared_tunnel_url(&name).await
            .unwrap_or_else(|| format!("https://{}.trycloudflare.com", name));

        (child, tunnel_url)
    } else {
        // Quick tunnel (no account required)
        let mut child = Command::new("cloudflared")
            .args(["tunnel", "--url", &url])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start cloudflared: {}", e))?;

        // Read stderr to get the public URL (cloudflared outputs to stderr)
        let stderr = child.stderr.take()
            .ok_or("Failed to capture cloudflared stderr")?;

        let mut reader = BufReader::new(stderr).lines();
        let mut public_url: Option<String> = None;

        let timeout = tokio::time::Duration::from_secs(30);
        let start = tokio::time::Instant::now();

        while start.elapsed() < timeout {
            match tokio::time::timeout(tokio::time::Duration::from_secs(1), reader.next_line()).await {
                Ok(Ok(Some(line))) => {
                    // Look for the URL in the output
                    // cloudflared outputs something like: "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://xxx.trycloudflare.com"
                    if line.contains("trycloudflare.com") {
                        // Extract URL from the line
                        if let Some(start_idx) = line.find("https://") {
                            let url_part = &line[start_idx..];
                            let end_idx = url_part.find(|c: char| c.is_whitespace()).unwrap_or(url_part.len());
                            public_url = Some(url_part[..end_idx].to_string());
                            break;
                        }
                    }
                }
                Ok(Ok(None)) => break,
                Ok(Err(e)) => {
                    log::warn!("Error reading cloudflared output: {}", e);
                    break;
                }
                Err(_) => continue,
            }
        }

        let url = public_url.ok_or("Failed to get cloudflared public URL")?;
        (child, url)
    };

    let tunnel_info = TunnelInfo {
        provider: TunnelProvider::Cloudflare,
        url: public_url,
        started_at: Utc::now().to_rfc3339(),
        port,
        is_public: true,
    };

    // Store the process handle and tunnel info
    {
        let mut handle = tunnel_state.process_handle.lock().await;
        *handle = Some(child);
    }
    {
        let mut active = tunnel_state.active_tunnel.lock().await;
        *active = Some(tunnel_info.clone());
    }

    log::info!("cloudflared tunnel started: {}", tunnel_info.url);
    Ok(tunnel_info)
}

/// Get cloudflared tunnel URL for a named tunnel
async fn get_cloudflared_tunnel_url(tunnel_name: &str) -> Option<String> {
    let output = Command::new("cloudflared")
        .args(["tunnel", "info", tunnel_name, "--output", "json"])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;

    // Extract the hostname from tunnel info
    json.get("config")?
        .get("ingress")?
        .as_array()?
        .first()?
        .get("hostname")
        .and_then(|h| h.as_str())
        .map(|h| format!("https://{}", h))
}

/// Stop cloudflared tunnel
pub async fn stop_cloudflared_tunnel(tunnel_state: &TunnelState) -> Result<(), String> {
    log::info!("Stopping cloudflared tunnel");

    let mut handle = tunnel_state.process_handle.lock().await;

    if let Some(mut child) = handle.take() {
        child.kill().await
            .map_err(|e| format!("Failed to kill cloudflared process: {}", e))?;

        // Clear active tunnel
        let mut active = tunnel_state.active_tunnel.lock().await;
        *active = None;

        log::info!("cloudflared tunnel stopped");
        Ok(())
    } else {
        // Try to kill any orphaned cloudflared processes
        #[cfg(unix)]
        {
            let _ = Command::new("pkill")
                .args(["-f", "cloudflared tunnel"])
                .output()
                .await;
        }

        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", "cloudflared.exe"])
                .output()
                .await;
        }

        Ok(())
    }
}

/// Start Tailscale Serve/Funnel
pub async fn start_tailscale_tunnel(
    tunnel_state: &TunnelState,
    port: u16,
    use_funnel: bool,
) -> Result<TunnelInfo, String> {
    log::info!("Starting Tailscale {} on port {}", if use_funnel { "Funnel" } else { "Serve" }, port);

    // Check if already running
    {
        let active = tunnel_state.active_tunnel.lock().await;
        if active.is_some() {
            return Err("A tunnel is already running".to_string());
        }
    }

    // First, get the Tailscale hostname
    let status_output = Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .await
        .map_err(|e| format!("Failed to get Tailscale status: {}", e))?;

    if !status_output.status.success() {
        return Err("Tailscale is not running or not logged in".to_string());
    }

    let status_json: serde_json::Value = serde_json::from_slice(&status_output.stdout)
        .map_err(|e| format!("Failed to parse Tailscale status: {}", e))?;

    let dns_name = status_json.get("Self")
        .and_then(|s| s.get("DNSName"))
        .and_then(|d| d.as_str())
        .map(|s| s.trim_end_matches('.').to_string())
        .ok_or("Failed to get Tailscale DNS name")?;

    // Start Tailscale Serve
    let _serve_url = format!("http://localhost:{}", port);

    // Use funnel if requested (publicly accessible), otherwise serve (tailnet only)
    let command = if use_funnel { "funnel" } else { "serve" };

    let output = Command::new("tailscale")
        .args([command, &port.to_string()])
        .output()
        .await
        .map_err(|e| format!("Failed to start Tailscale {}: {}", command, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to start Tailscale {}: {}", command, stderr));
    }

    let public_url = if use_funnel {
        format!("https://{}", dns_name)
    } else {
        format!("https://{}:{}", dns_name, port)
    };

    let tunnel_info = TunnelInfo {
        provider: TunnelProvider::Tailscale,
        url: public_url,
        started_at: Utc::now().to_rfc3339(),
        port,
        is_public: use_funnel,
    };

    // Store tunnel info (Tailscale serve/funnel runs as a daemon, not a child process)
    {
        let mut active = tunnel_state.active_tunnel.lock().await;
        *active = Some(tunnel_info.clone());
    }

    log::info!("Tailscale {} started: {}", command, tunnel_info.url);
    Ok(tunnel_info)
}

/// Stop Tailscale Serve/Funnel
pub async fn stop_tailscale_tunnel(tunnel_state: &TunnelState) -> Result<(), String> {
    log::info!("Stopping Tailscale Serve/Funnel");

    // Reset serve configuration
    let output = Command::new("tailscale")
        .args(["serve", "reset"])
        .output()
        .await
        .map_err(|e| format!("Failed to stop Tailscale serve: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("Failed to reset Tailscale serve: {}", stderr);
    }

    // Also reset funnel
    let _ = Command::new("tailscale")
        .args(["funnel", "reset"])
        .output()
        .await;

    // Clear active tunnel
    let mut active = tunnel_state.active_tunnel.lock().await;
    *active = None;

    log::info!("Tailscale tunnel stopped");
    Ok(())
}

/// Get active tunnel info
pub async fn get_active_tunnel(tunnel_state: &TunnelState) -> Option<TunnelInfo> {
    let active = tunnel_state.active_tunnel.lock().await;
    active.clone()
}

/// Set preferred tunnel provider
pub async fn set_tunnel_provider(
    tunnel_state: &TunnelState,
    provider: TunnelProvider,
) -> Result<(), String> {
    log::info!("Setting preferred tunnel provider to {:?}", provider);

    let mut config = tunnel_state.config.lock().await;
    config.preferred_provider = provider;

    // Save to disk
    save_tunnel_config(&config).await?;

    Ok(())
}

/// Start tunnel with preferred provider
pub async fn start_tunnel(
    tunnel_state: &TunnelState,
    port: u16,
) -> Result<TunnelInfo, String> {
    let config = tunnel_state.config.lock().await.clone();

    match config.preferred_provider {
        TunnelProvider::Ngrok => {
            start_ngrok_tunnel(tunnel_state, port, config.ngrok_auth_token).await
        }
        TunnelProvider::Cloudflare => {
            start_cloudflared_tunnel(tunnel_state, port, config.cloudflare_tunnel_id).await
        }
        TunnelProvider::Tailscale => {
            start_tailscale_tunnel(tunnel_state, port, false).await
        }
        TunnelProvider::None | TunnelProvider::LocalOnly => {
            Err("No tunnel provider configured. Please set a preferred provider first.".to_string())
        }
    }
}

/// Stop active tunnel
pub async fn stop_tunnel(tunnel_state: &TunnelState) -> Result<(), String> {
    let active = tunnel_state.active_tunnel.lock().await.clone();

    match active.map(|t| t.provider) {
        Some(TunnelProvider::Ngrok) => stop_ngrok_tunnel(tunnel_state).await,
        Some(TunnelProvider::Cloudflare) => stop_cloudflared_tunnel(tunnel_state).await,
        Some(TunnelProvider::Tailscale) => stop_tailscale_tunnel(tunnel_state).await,
        _ => {
            // No active tunnel, but try to clean up any orphaned processes
            let _ = stop_ngrok_tunnel(tunnel_state).await;
            let _ = stop_cloudflared_tunnel(tunnel_state).await;
            Ok(())
        }
    }
}

/// Set ngrok auth token
pub async fn set_ngrok_token(
    tunnel_state: &TunnelState,
    token: String,
) -> Result<(), String> {
    log::info!("Setting ngrok auth token");

    // Configure ngrok with the token
    let output = Command::new("ngrok")
        .args(["config", "add-authtoken", &token])
        .output()
        .await
        .map_err(|e| format!("Failed to configure ngrok: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to set ngrok auth token: {}", stderr));
    }

    // Save to config
    let mut config = tunnel_state.config.lock().await;
    config.ngrok_auth_token = Some(token);
    save_tunnel_config(&config).await?;

    Ok(())
}

/// Set cloudflare tunnel ID
pub async fn set_cloudflare_tunnel(
    tunnel_state: &TunnelState,
    tunnel_id: String,
) -> Result<(), String> {
    log::info!("Setting Cloudflare tunnel ID: {}", tunnel_id);

    // Verify the tunnel exists
    let output = Command::new("cloudflared")
        .args(["tunnel", "info", &tunnel_id])
        .output()
        .await
        .map_err(|e| format!("Failed to verify Cloudflare tunnel: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Invalid tunnel ID or not authenticated: {}", stderr));
    }

    // Save to config
    let mut config = tunnel_state.config.lock().await;
    config.cloudflare_tunnel_id = Some(tunnel_id);
    save_tunnel_config(&config).await?;

    Ok(())
}
