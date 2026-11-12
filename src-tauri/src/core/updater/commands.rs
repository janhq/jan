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
        // The feed leaves out platforms Jan no longer supports (Intel Macs).
        // Offering the version anyway would show the update dialog and then
        // fail the download, since tauri-plugin-updater picks the asset by
        // the same platform key and returns TargetNotFound.
        let target = tauri_plugin_updater::target();
        if !feed_serves_target(info.platforms.as_ref(), target.as_deref()) {
            log::info!(
                "No update for this platform: {} is not in the feed for {}",
                target.as_deref().unwrap_or("unknown"),
                info.version
            );
            return Ok(None);
        }
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

/// Whether a feed's `platforms` map has an asset for `target` (`{os}-{arch}`),
/// under the same keys tauri-plugin-updater looks up: `{os}-{arch}` or
/// `{os}-{arch}-{installer}`. A feed without `platforms` (the server format)
/// or an unknown target is left to the version check, as before.
fn feed_serves_target(platforms: Option<&serde_json::Value>, target: Option<&str>) -> bool {
    let (Some(platforms), Some(target)) = (platforms.and_then(|p| p.as_object()), target) else {
        return true;
    };
    platforms.keys().any(|key| {
        key == target
            || key
                .strip_prefix(target)
                .is_some_and(|rest| rest.starts_with('-'))
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry() -> serde_json::Value {
        json!({ "url": "https://example.com/Jan.app.tar.gz", "signature": "sig" })
    }

    #[test]
    fn static_feed_without_this_target_is_not_an_update() {
        let platforms = json!({ "darwin-aarch64": entry(), "linux-x86_64": entry() });
        assert!(!feed_serves_target(Some(&platforms), Some("darwin-x86_64")));
    }

    #[test]
    fn static_feed_with_this_target_is_an_update() {
        let platforms = json!({ "darwin-aarch64": entry(), "darwin-x86_64": entry() });
        assert!(feed_serves_target(Some(&platforms), Some("darwin-x86_64")));
    }

    #[test]
    fn installer_qualified_key_serves_its_target() {
        let platforms = json!({ "darwin-x86_64-app": entry() });
        assert!(feed_serves_target(Some(&platforms), Some("darwin-x86_64")));
    }

    #[test]
    fn similar_prefix_does_not_serve_target() {
        let platforms = json!({ "darwin-x86_64h": entry() });
        assert!(!feed_serves_target(Some(&platforms), Some("darwin-x86_64")));
    }

    #[test]
    fn dynamic_feed_without_platforms_is_left_to_the_version_check() {
        assert!(feed_serves_target(None, Some("darwin-x86_64")));
    }

    #[test]
    fn unknown_target_is_left_to_the_version_check() {
        let platforms = json!({ "darwin-aarch64": entry() });
        assert!(feed_serves_target(Some(&platforms), None));
    }
}
