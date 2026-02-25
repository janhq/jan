//! Tailscale integration for OpenClaw remote access
//!
//! This module provides functions to detect, configure, and manage Tailscale
//! for secure remote access to the OpenClaw gateway.

use serde::Deserialize;
use tokio::process::Command;

use super::models::{TailscaleInfo, TailscaleStatus};

/// Tailscale status JSON response structure
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleStatusJson {
    #[serde(default)]
    backend_state: String,
    #[serde(rename = "Self")]
    self_node: Option<TailscaleSelfNode>,
    #[serde(default)]
    current_tailnet: Option<TailscaleCurrentTailnet>,
}

/// Tailscale self node information
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleSelfNode {
    #[serde(default)]
    host_name: String,
    #[serde(rename = "DNSName")]
    #[serde(default)]
    dns_name: String,
    #[serde(rename = "TailscaleIPs")]
    #[serde(default)]
    tailscale_ips: Vec<String>,
}

/// Tailscale current tailnet information
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
#[allow(dead_code)]
struct TailscaleCurrentTailnet {
    #[serde(default)]
    name: String,
    #[serde(rename = "MagicDNSSuffix")]
    #[serde(default)]
    magic_dns_suffix: String,
}

/// Get the Tailscale CLI command based on the platform
fn get_tailscale_cmd() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        // On macOS, Tailscale is typically installed via App Store or direct download
        // The CLI is usually available at /Applications/Tailscale.app/Contents/MacOS/Tailscale
        // or via /usr/local/bin/tailscale if installed via Homebrew
        "tailscale"
    }
    #[cfg(target_os = "windows")]
    {
        "tailscale"
    }
    #[cfg(target_os = "linux")]
    {
        "tailscale"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "tailscale"
    }
}

/// Check if Tailscale is installed on the system
pub async fn detect_tailscale() -> TailscaleStatus {
    log::info!("Detecting Tailscale installation");

    // Try to get Tailscale version
    let version_output = Command::new(get_tailscale_cmd())
        .arg("version")
        .output()
        .await;

    match version_output {
        Ok(output) => {
            if output.status.success() {
                let version_str = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();

                // Check if Tailscale daemon is running and user is logged in
                let status_output = Command::new(get_tailscale_cmd())
                    .args(["status", "--json"])
                    .output()
                    .await;

                match status_output {
                    Ok(status) => {
                        if status.status.success() {
                            let status_json = String::from_utf8_lossy(&status.stdout);
                            match serde_json::from_str::<TailscaleStatusJson>(&status_json) {
                                Ok(parsed) => {
                                    let running = !parsed.backend_state.is_empty();
                                    let logged_in = parsed.backend_state == "Running"
                                        && parsed.self_node.is_some();

                                    TailscaleStatus {
                                        installed: true,
                                        running,
                                        logged_in,
                                        version: Some(version_str),
                                        error: None,
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Failed to parse Tailscale status JSON: {}", e);
                                    TailscaleStatus {
                                        installed: true,
                                        running: true,
                                        logged_in: false,
                                        version: Some(version_str),
                                        error: Some(format!(
                                            "Failed to parse status: {}",
                                            e
                                        )),
                                    }
                                }
                            }
                        } else {
                            let stderr = String::from_utf8_lossy(&status.stderr);
                            // Check for common error messages
                            let (running, error) = if stderr.contains("not running") {
                                (false, Some("Tailscale daemon is not running".to_string()))
                            } else if stderr.contains("not logged in") {
                                (true, Some("Not logged in to Tailscale".to_string()))
                            } else {
                                (false, Some(stderr.trim().to_string()))
                            };

                            TailscaleStatus {
                                installed: true,
                                running,
                                logged_in: false,
                                version: Some(version_str),
                                error,
                            }
                        }
                    }
                    Err(e) => TailscaleStatus {
                        installed: true,
                        running: false,
                        logged_in: false,
                        version: Some(version_str),
                        error: Some(format!("Failed to check Tailscale status: {}", e)),
                    },
                }
            } else {
                TailscaleStatus {
                    installed: false,
                    running: false,
                    logged_in: false,
                    version: None,
                    error: Some("Tailscale is not installed".to_string()),
                }
            }
        }
        Err(e) => {
            log::info!("Tailscale not found: {}", e);
            TailscaleStatus {
                installed: false,
                running: false,
                logged_in: false,
                version: None,
                error: Some("Tailscale is not installed".to_string()),
            }
        }
    }
}

/// Get the current tailnet name and status
pub async fn get_tailscale_status() -> TailscaleInfo {
    log::info!("Getting Tailscale status");

    let output = Command::new(get_tailscale_cmd())
        .args(["status", "--json"])
        .output()
        .await;

    let mut info = TailscaleInfo::default();

    match output {
        Ok(output) => {
            if output.status.success() {
                let status_json = String::from_utf8_lossy(&output.stdout);
                if let Ok(parsed) = serde_json::from_str::<TailscaleStatusJson>(&status_json) {
                    if let Some(self_node) = parsed.self_node {
                        info.hostname = Some(self_node.host_name);
                        info.dns_name = if self_node.dns_name.is_empty() {
                            None
                        } else {
                            // Remove trailing dot if present
                            Some(self_node.dns_name.trim_end_matches('.').to_string())
                        };
                        info.ip_addresses = self_node.tailscale_ips;
                    }

                    if let Some(tailnet) = parsed.current_tailnet {
                        info.tailnet = if tailnet.name.is_empty() {
                            None
                        } else {
                            Some(tailnet.name)
                        };
                    }
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to get Tailscale status: {}", e);
        }
    }

    // Check serve status
    let serve_status = check_serve_status().await;
    info.serve_enabled = serve_status.0;
    info.funnel_enabled = serve_status.1;
    info.serve_url = serve_status.2;

    info
}

/// Check the current Tailscale Serve status
/// Returns (serve_enabled, funnel_enabled, serve_url)
async fn check_serve_status() -> (bool, bool, Option<String>) {
    let output = Command::new(get_tailscale_cmd())
        .args(["serve", "status", "--json"])
        .output()
        .await;

    match output {
        Ok(output) => {
            if output.status.success() {
                let status_str = String::from_utf8_lossy(&output.stdout);
                // Parse the serve status JSON
                // The structure varies but typically contains "Services" or similar
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&status_str) {
                    // Check if there are any active services
                    let has_services = json.get("Services").map(|s| !s.is_null()).unwrap_or(false)
                        || json.get("TCP").map(|s| !s.is_null()).unwrap_or(false)
                        || json.get("Web").map(|s| !s.is_null()).unwrap_or(false);

                    // Check for funnel
                    let funnel_enabled = json.get("AllowFunnel")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // Try to extract the serve URL
                    let serve_url = json.get("ServeConfig")
                        .and_then(|c| c.get("DNS"))
                        .and_then(|d| d.as_str())
                        .map(|s| format!("https://{}", s));

                    return (has_services, funnel_enabled, serve_url);
                }
            }
        }
        Err(e) => {
            log::debug!("Failed to check serve status: {}", e);
        }
    }

    (false, false, None)
}

/// Configure Tailscale Serve for OpenClaw gateway
///
/// This sets up Tailscale Serve to proxy HTTPS traffic to the local OpenClaw port.
pub async fn configure_tailscale_serve(port: u16) -> Result<String, String> {
    log::info!("Configuring Tailscale Serve for port {}", port);

    // First, check if Tailscale is ready
    let status = detect_tailscale().await;
    if !status.installed {
        return Err("Tailscale is not installed".to_string());
    }
    if !status.running {
        return Err("Tailscale daemon is not running".to_string());
    }
    if !status.logged_in {
        return Err("Not logged in to Tailscale. Please run 'tailscale login' first.".to_string());
    }

    // Configure Tailscale Serve to forward HTTPS to localhost:port
    // The command is: tailscale serve https / http://localhost:PORT
    let output = Command::new(get_tailscale_cmd())
        .args([
            "serve",
            "https",
            "/",
            &format!("http://localhost:{}", port),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run tailscale serve: {}", e))?;

    if output.status.success() {
        // Get the serve URL
        let info = get_tailscale_status().await;
        let url = info.serve_url.unwrap_or_else(|| {
            // Construct URL from DNS name if available
            info.dns_name
                .map(|dns| format!("https://{}", dns))
                .unwrap_or_else(|| "URL not available".to_string())
        });

        log::info!("Tailscale Serve configured successfully: {}", url);
        Ok(url)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to configure Tailscale Serve: {}", stderr.trim()))
    }
}

/// Remove Tailscale Serve configuration
pub async fn remove_tailscale_serve() -> Result<(), String> {
    log::info!("Removing Tailscale Serve configuration");

    let output = Command::new(get_tailscale_cmd())
        .args(["serve", "off"])
        .output()
        .await
        .map_err(|e| format!("Failed to run tailscale serve off: {}", e))?;

    if output.status.success() {
        log::info!("Tailscale Serve configuration removed");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If already off, that's fine
        if stderr.contains("no serve config") || stderr.is_empty() {
            Ok(())
        } else {
            Err(format!("Failed to remove Tailscale Serve: {}", stderr.trim()))
        }
    }
}

/// Enable Tailscale Funnel for public access
///
/// This allows the OpenClaw gateway to be accessed from the public internet
/// via Tailscale's Funnel feature.
pub async fn enable_tailscale_funnel(port: u16) -> Result<String, String> {
    log::info!("Enabling Tailscale Funnel for port {}", port);

    // First, check if Tailscale is ready
    let status = detect_tailscale().await;
    if !status.installed {
        return Err("Tailscale is not installed".to_string());
    }
    if !status.running {
        return Err("Tailscale daemon is not running".to_string());
    }
    if !status.logged_in {
        return Err("Not logged in to Tailscale. Please run 'tailscale login' first.".to_string());
    }

    // Enable Funnel - this also sets up serve if not already configured
    // The command is: tailscale funnel PORT
    let output = Command::new(get_tailscale_cmd())
        .args(["funnel", &port.to_string()])
        .output()
        .await
        .map_err(|e| format!("Failed to run tailscale funnel: {}", e))?;

    if output.status.success() {
        // Get the funnel URL
        let info = get_tailscale_status().await;
        let url = info.serve_url.unwrap_or_else(|| {
            info.dns_name
                .map(|dns| format!("https://{}", dns))
                .unwrap_or_else(|| "URL not available".to_string())
        });

        log::info!("Tailscale Funnel enabled: {}", url);
        Ok(url)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Check for common errors
        if stderr.contains("Funnel not available") || stderr.contains("not enabled") {
            Err("Tailscale Funnel is not enabled for your account. Please enable it in the Tailscale admin console.".to_string())
        } else {
            Err(format!("Failed to enable Tailscale Funnel: {}", stderr.trim()))
        }
    }
}

/// Disable Tailscale Funnel
pub async fn disable_tailscale_funnel() -> Result<(), String> {
    log::info!("Disabling Tailscale Funnel");

    let output = Command::new(get_tailscale_cmd())
        .args(["funnel", "off"])
        .output()
        .await
        .map_err(|e| format!("Failed to run tailscale funnel off: {}", e))?;

    if output.status.success() {
        log::info!("Tailscale Funnel disabled");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If already off, that's fine
        if stderr.contains("no funnel") || stderr.is_empty() {
            Ok(())
        } else {
            Err(format!("Failed to disable Tailscale Funnel: {}", stderr.trim()))
        }
    }
}

/// Get the tailnet URL for accessing the gateway
///
/// Returns the HTTPS URL that can be used to access the OpenClaw gateway
/// via Tailscale Serve or Funnel.
pub async fn get_tailscale_url() -> Result<Option<String>, String> {
    log::info!("Getting Tailscale URL");

    let info = get_tailscale_status().await;

    // If serve is enabled and we have a URL, return it
    if info.serve_enabled {
        if let Some(url) = info.serve_url {
            return Ok(Some(url));
        }
    }

    // Otherwise, construct from DNS name if available
    if let Some(dns_name) = info.dns_name {
        // If serve is enabled, use HTTPS
        if info.serve_enabled {
            return Ok(Some(format!("https://{}", dns_name)));
        }
        // Otherwise, return the Tailscale IP-based URL for direct access
        // (though this won't work without serve for HTTP services)
        return Ok(Some(format!("http://{}", dns_name)));
    }

    // No URL available
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_detect_tailscale() {
        // This test will vary based on whether Tailscale is installed
        let status = detect_tailscale().await;
        // Just verify we get a valid response
        assert!(status.installed || status.error.is_some());
    }
}
