/**
 * Tauri commands for custom updater with HMAC request signing
 * 
 * Convention: First endpoint in tauri.conf.json uses HMAC signing, rest are fallbacks
 */
use super::custom_updater::{CustomUpdater, UpdateInfo};
use tauri::{command, AppHandle};

/// Check for updates using endpoints from tauri.conf.json
/// First endpoint uses HMAC request signing, remaining endpoints are fallbacks
#[command]
pub async fn check_for_app_updates(
    app: AppHandle,
    nonce_seed: String,
    current_version: String,
) -> Result<Option<UpdateInfo>, String> {
    // Get endpoints from tauri config
    let endpoints = get_updater_endpoints(&app);

    if endpoints.is_empty() {
        return Err("No updater endpoints configured in tauri.conf.json".to_string());
    }

    let updater = CustomUpdater::new().map_err(|e| e.to_string())?;

    let update_info = updater
        .check_for_updates(endpoints, &nonce_seed, &current_version)
        .await
        .map_err(|e| e.to_string())?;

    // Only return update info if the version is actually newer
    if let Some(ref info) = update_info {
        if updater.is_update_available(&current_version, &info.version) {
            log::info!(
                "Update available: current {} -> latest {}",
                current_version,
                info.version
            );
            return Ok(update_info);
        } else {
            log::info!(
                "No update needed: current {} is up to date with latest {}",
                current_version,
                info.version
            );
            return Ok(None);
        }
    }

    Ok(None)
}

/// Get updater endpoints from tauri config
fn get_updater_endpoints(app: &AppHandle) -> Vec<String> {
    // Try to get endpoints from tauri config
    // The config structure is: plugins.updater.endpoints
    let config = app.config();

    if let Some(plugins) = &config.plugins.0.get("updater") {
        if let Some(endpoints) = plugins.get("endpoints") {
            if let Some(arr) = endpoints.as_array() {
                return arr
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
            }
        }
    }

    // Return empty if no endpoints found
    Vec::new()
}

/// Check if update is available by comparing versions
#[command]
pub fn is_update_available(current_version: String, latest_version: String) -> bool {
    let updater = match CustomUpdater::new() {
        Ok(u) => u,
        Err(_) => return false,
    };
    updater.is_update_available(&current_version, &latest_version)
}

