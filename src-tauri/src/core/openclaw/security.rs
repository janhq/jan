//! Security configuration module for OpenClaw gateway
//!
//! Handles authentication tokens, device pairing, and access logging
//! for the OpenClaw remote access feature.

use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::get_openclaw_config_dir;
use super::models::{AccessLogEntry, DeviceInfo, SecurityConfig};

/// Maximum number of access log entries to keep
const MAX_ACCESS_LOG_ENTRIES: usize = 1000;

/// Security configuration file name
const SECURITY_CONFIG_FILE: &str = "security.json";

/// Access logs file name
const ACCESS_LOGS_FILE: &str = "access_logs.json";

/// Generate a new secure access token
///
/// Returns a UUID-based token that can be used for authentication.
pub fn generate_access_token() -> String {
    Uuid::new_v4().to_string()
}

/// Hash an access token or password for storage
///
/// Uses SHA-256 to create a secure hash of the input.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

/// Verify a token or password against a stored hash
///
/// Returns true if the token matches the stored hash.
pub fn verify_token(token: &str, hash: &str) -> bool {
    let token_hash = hash_token(token);
    token_hash == hash
}

/// Generate a pairing code for device authentication
///
/// Returns an 8-character alphanumeric code that's easy to type.
pub fn generate_pairing_code() -> String {
    use rand::Rng;

    let mut rng = rand::thread_rng();
    let chars: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        .chars()
        .collect();

    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..chars.len());
            chars[idx]
        })
        .collect()
}

/// Get the path to the security configuration file
fn get_security_config_path() -> Result<std::path::PathBuf, String> {
    let config_dir = get_openclaw_config_dir()?;
    Ok(config_dir.join(SECURITY_CONFIG_FILE))
}

/// Get the path to the access logs file
fn get_access_logs_path() -> Result<std::path::PathBuf, String> {
    let config_dir = get_openclaw_config_dir()?;
    Ok(config_dir.join(ACCESS_LOGS_FILE))
}

/// Load the security configuration from disk
pub async fn load_security_config() -> Result<SecurityConfig, String> {
    let config_path = get_security_config_path()?;

    if !config_path.exists() {
        return Ok(SecurityConfig::default());
    }

    let config_json = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("Failed to read security config: {}", e))?;

    serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse security config: {}", e))
}

/// Save the security configuration to disk
pub async fn save_security_config(config: &SecurityConfig) -> Result<(), String> {
    let config_path = get_security_config_path()?;

    let config_json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize security config: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("Failed to write security config: {}", e))?;

    Ok(())
}

/// Record an access log entry
///
/// Appends the entry to the access logs file, rotating if necessary.
pub async fn log_access(entry: AccessLogEntry) -> Result<(), String> {
    let logs_path = get_access_logs_path()?;

    // Load existing logs
    let mut logs = load_access_logs_internal(&logs_path).await?;

    // Add new entry
    logs.push(entry);

    // Rotate if we exceed the maximum
    if logs.len() > MAX_ACCESS_LOG_ENTRIES {
        let excess = logs.len() - MAX_ACCESS_LOG_ENTRIES;
        logs.drain(0..excess);
    }

    // Save back to disk
    let logs_json = serde_json::to_string_pretty(&logs)
        .map_err(|e| format!("Failed to serialize access logs: {}", e))?;

    tokio::fs::write(&logs_path, logs_json)
        .await
        .map_err(|e| format!("Failed to write access logs: {}", e))?;

    Ok(())
}

/// Load access logs from the file
async fn load_access_logs_internal(path: &std::path::Path) -> Result<Vec<AccessLogEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let logs_json = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read access logs: {}", e))?;

    serde_json::from_str(&logs_json)
        .map_err(|e| format!("Failed to parse access logs: {}", e))
}

/// Get recent access logs
///
/// Returns the most recent `limit` entries.
pub async fn get_access_logs(limit: usize) -> Result<Vec<AccessLogEntry>, String> {
    let logs_path = get_access_logs_path()?;
    let logs = load_access_logs_internal(&logs_path).await?;

    // Return the most recent entries
    let start = if logs.len() > limit {
        logs.len() - limit
    } else {
        0
    };

    Ok(logs[start..].to_vec())
}

/// Clear all access logs
pub async fn clear_access_logs() -> Result<(), String> {
    let logs_path = get_access_logs_path()?;

    if logs_path.exists() {
        tokio::fs::write(&logs_path, "[]")
            .await
            .map_err(|e| format!("Failed to clear access logs: {}", e))?;
    }

    Ok(())
}

/// Add a device to the approved list
pub async fn approve_device(device: DeviceInfo) -> Result<(), String> {
    let mut config = load_security_config().await?;

    // Check if device already exists (by ID)
    let existing_index = config.approved_devices
        .iter()
        .position(|d| d.id == device.id);

    if let Some(index) = existing_index {
        // Update existing device
        config.approved_devices[index] = device;
    } else {
        // Add new device
        config.approved_devices.push(device);
    }

    save_security_config(&config).await
}

/// Remove a device from the approved list
pub async fn revoke_device(device_id: &str) -> Result<(), String> {
    let mut config = load_security_config().await?;

    let original_len = config.approved_devices.len();
    config.approved_devices.retain(|d| d.id != device_id);

    if config.approved_devices.len() == original_len {
        return Err(format!("Device '{}' not found", device_id));
    }

    save_security_config(&config).await
}

/// Get list of approved devices
pub async fn get_approved_devices() -> Result<Vec<DeviceInfo>, String> {
    let config = load_security_config().await?;
    Ok(config.approved_devices)
}

/// Update the last access time for a device
pub async fn update_device_last_access(device_id: &str) -> Result<(), String> {
    let mut config = load_security_config().await?;

    if let Some(device) = config.approved_devices.iter_mut().find(|d| d.id == device_id) {
        device.last_access = Some(Utc::now().to_rfc3339());
        save_security_config(&config).await
    } else {
        Err(format!("Device '{}' not found", device_id))
    }
}

/// Count recent authentication failures within the rate limit window
pub async fn count_recent_auth_failures() -> Result<u32, String> {
    let config = load_security_config().await?;
    let logs = get_access_logs(100).await?;

    let window_start = Utc::now()
        .checked_sub_signed(chrono::Duration::seconds(config.rate_limit_window_secs as i64))
        .map(|t| t.to_rfc3339())
        .unwrap_or_default();

    let failures = logs
        .iter()
        .filter(|entry| {
            entry.action == "auth_fail"
                && entry.timestamp > window_start
        })
        .count();

    Ok(failures as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_access_token() {
        let token = generate_access_token();
        assert!(!token.is_empty());
        // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        assert_eq!(token.len(), 36);
    }

    #[test]
    fn test_hash_token() {
        let token = "test-token-12345";
        let hash = hash_token(token);

        // SHA-256 produces 64 hex characters
        assert_eq!(hash.len(), 64);

        // Same input should produce same hash
        let hash2 = hash_token(token);
        assert_eq!(hash, hash2);

        // Different input should produce different hash
        let hash3 = hash_token("different-token");
        assert_ne!(hash, hash3);
    }

    #[test]
    fn test_verify_token() {
        let token = "my-secret-token";
        let hash = hash_token(token);

        assert!(verify_token(token, &hash));
        assert!(!verify_token("wrong-token", &hash));
    }

    #[test]
    fn test_generate_pairing_code() {
        let code = generate_pairing_code();
        assert_eq!(code.len(), 8);

        // All characters should be alphanumeric (excluding confusing chars like 0, O, 1, I)
        for c in code.chars() {
            assert!(c.is_ascii_alphanumeric());
            assert!(c != '0' && c != 'O' && c != '1' && c != 'I');
        }
    }
}
