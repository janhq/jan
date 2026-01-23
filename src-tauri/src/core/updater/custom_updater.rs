/**
 * Custom Updater for Jan with HMAC request signing
 * 
 * This module provides a custom update checker that:
 * 1. Reads endpoints from tauri.conf.json (plugins.updater.endpoints)
 * 2. First endpoint is treated as PRIMARY - uses HMAC request signing
 * 3. Remaining endpoints are FALLBACK - no signing needed
 * 
 * Convention: The first endpoint in the list should be the signed endpoint
 * (e.g., https://apps.jan.ai/update-check)
 */
use super::hmac_client::SignedRequestHeaders;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

/// Secret key for HMAC signature
/// - In CI: Set JAN_SIGNING_KEY environment variable at build time
/// - In local dev: Falls back to a test key
const SECRET_KEY: &str = match option_env!("JAN_SIGNING_KEY") {
    Some(key) => key,
    None => "local-dev-test-key-not-for-production",
};

/// Timeout for HTTP requests
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),

    #[error("Failed to parse update response: {0}")]
    ParseError(String),

    #[error("All endpoints failed")]
    AllEndpointsFailed,

    #[error("Invalid response from server: {0}")]
    InvalidResponse(String),

    #[error("No endpoints configured")]
    NoEndpointsConfigured,
}

/// Update information returned by the update check endpoint
/// Compatible with Tauri's updater format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub platforms: Option<serde_json::Value>,
    /// URL to download the update
    #[serde(default)]
    pub url: Option<String>,
    /// Signature for verifying the update
    #[serde(default)]
    pub signature: Option<String>,
}

/// Custom updater client
pub struct CustomUpdater {
    client: Client,
    secret_key: String,
}

impl CustomUpdater {
    /// Create a new custom updater
    pub fn new() -> Result<Self, UpdateError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()?;

        Ok(Self {
            client,
            secret_key: SECRET_KEY.to_string(),
        })
    }

    /// Build User-Agent header: Jan/{version} ({os}; {arch})
    fn build_user_agent(app_version: &str) -> String {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        format!("Jan/{} ({}; {})", app_version, os, arch)
    }

    /// Check for updates using endpoints list
    /// First endpoint uses HMAC signing, rest are fallbacks without signing
    pub async fn check_for_updates(
        &self,
        endpoints: Vec<String>,
        nonce_seed: &str,
        current_version: &str,
    ) -> Result<Option<UpdateInfo>, UpdateError> {
        if endpoints.is_empty() {
            return Err(UpdateError::NoEndpointsConfigured);
        }

        log::info!(
            "Checking for updates (current version: {}, {} endpoints configured)",
            current_version,
            endpoints.len()
        );

        let mut last_error: Option<UpdateError> = None;

        for (index, endpoint) in endpoints.iter().enumerate() {
            let is_primary = index == 0;

            let result = if is_primary {
                // First endpoint: use HMAC signing
                log::info!("Trying primary endpoint with signing: {}", endpoint);
                self.check_with_signing(endpoint, nonce_seed, current_version)
                    .await
            } else {
                // Fallback endpoints: no signing
                log::info!("Trying fallback endpoint: {}", endpoint);
                self.check_without_signing(endpoint, current_version).await
            };

            match result {
                Ok(info) => {
                    log::info!(
                        "Successfully fetched update info from endpoint {}: version {}",
                        endpoint,
                        info.version
                    );
                    return Ok(Some(info));
                }
                Err(e) => {
                    log::warn!("Endpoint {} failed: {}", endpoint, e);
                    last_error = Some(e);
                    // Continue to next endpoint
                }
            }
        }

        // All endpoints failed
        log::error!("All {} endpoints failed", endpoints.len());
        Err(last_error.unwrap_or(UpdateError::AllEndpointsFailed))
    }

    /// Check endpoint with HMAC request signing
    async fn check_with_signing(
        &self,
        endpoint: &str,
        nonce_seed: &str,
        app_version: &str,
    ) -> Result<UpdateInfo, UpdateError> {
        // Generate signed request headers
        let headers = SignedRequestHeaders::new(&self.secret_key, nonce_seed, app_version);

        // Build request with security headers
        let mut request = self.client.get(endpoint);

        for (key, value) in headers.to_header_pairs() {
            request = request.header(key, value);
        }

        request = request
            .header("Accept", "application/json")
            .header("User-Agent", Self::build_user_agent(app_version));

        // Send request
        let response = request.send().await?;

        // Check response status
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(UpdateError::InvalidResponse(format!(
                "Status {}: {}",
                status, body
            )));
        }

        // Parse response
        let update_info: UpdateInfo = response
            .json()
            .await
            .map_err(|e| UpdateError::ParseError(e.to_string()))?;

        Ok(update_info)
    }

    /// Check endpoint without signing (for fallback endpoints)
    async fn check_without_signing(&self, endpoint: &str, app_version: &str) -> Result<UpdateInfo, UpdateError> {
        let response = self
            .client
            .get(endpoint)
            .header("Accept", "application/json")
            .header("User-Agent", Self::build_user_agent(app_version))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(UpdateError::InvalidResponse(format!(
                "Status {}: {}",
                status, body
            )));
        }

        let update_info: UpdateInfo = response
            .json()
            .await
            .map_err(|e| UpdateError::ParseError(e.to_string()))?;

        Ok(update_info)
    }

    /// Compare versions to check if update is available
    pub fn is_update_available(&self, current: &str, latest: &str) -> bool {
        let current = current.trim_start_matches('v');
        let latest = latest.trim_start_matches('v');

        let current_parts: Vec<u32> = current
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        let latest_parts: Vec<u32> = latest.split('.').filter_map(|s| s.parse().ok()).collect();

        for i in 0..std::cmp::max(current_parts.len(), latest_parts.len()) {
            let current_part = current_parts.get(i).unwrap_or(&0);
            let latest_part = latest_parts.get(i).unwrap_or(&0);

            if latest_part > current_part {
                return true;
            } else if latest_part < current_part {
                return false;
            }
        }

        false
    }
}

impl Default for CustomUpdater {
    fn default() -> Self {
        Self::new().expect("Failed to create default CustomUpdater")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        let updater = CustomUpdater::new().unwrap();

        assert!(updater.is_update_available("1.0.0", "1.0.1"));
        assert!(updater.is_update_available("1.0.0", "1.1.0"));
        assert!(updater.is_update_available("1.0.0", "2.0.0"));
        assert!(!updater.is_update_available("1.0.0", "1.0.0"));
        assert!(!updater.is_update_available("1.0.1", "1.0.0"));
        assert!(updater.is_update_available("v1.0.0", "v1.0.1"));
    }
}

