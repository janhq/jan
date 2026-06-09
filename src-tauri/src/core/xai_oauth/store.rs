use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const TOKEN_FILE_NAME: &str = "xai_oauth_tokens.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredXaiTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

impl StoredXaiTokens {
    pub fn is_expiring_soon(&self, skew_ms: i64) -> bool {
        self.expires_at <= chrono::Utc::now().timestamp_millis() + skew_ms
    }
}

pub fn token_file_path(data_folder: &Path) -> PathBuf {
    data_folder.join(TOKEN_FILE_NAME)
}

pub fn load_tokens(data_folder: &Path) -> Result<Option<StoredXaiTokens>, String> {
    let path = token_file_path(data_folder);
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read xAI OAuth tokens: {err}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }

    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|err| format!("Failed to parse xAI OAuth tokens: {err}"))
}

pub fn save_tokens(data_folder: &Path, tokens: &StoredXaiTokens) -> Result<(), String> {
    let path = token_file_path(data_folder);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create xAI OAuth token directory: {err}"))?;
    }

    let raw = serde_json::to_string_pretty(tokens)
        .map_err(|err| format!("Failed to serialize xAI OAuth tokens: {err}"))?;
    std::fs::write(&path, raw)
        .map_err(|err| format!("Failed to write xAI OAuth tokens: {err}"))
}

pub fn clear_tokens(data_folder: &Path) -> Result<(), String> {
    let path = token_file_path(data_folder);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|err| format!("Failed to remove xAI OAuth tokens: {err}"))?;
    }
    Ok(())
}