use std::time::Duration;

use serde::{Deserialize, Serialize};

fn build_reqwest_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------------
// GitHub Releases
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub prerelease: bool,
    pub draft: bool,
    pub body: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
}

/// 获取 Jan GitHub releases（通过 Rust 代理，避免前端 CORS）
#[tauri::command]
pub async fn fetch_github_releases() -> Result<Vec<GitHubRelease>, String> {
    let client = build_reqwest_client()?;

    let response = client
        .get("https://api.github.com/repos/janhq/jan/releases")
        .header("User-Agent", "RongxinAI")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body_text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "GitHub API error: HTTP {} - {}",
            status,
            &body_text[..body_text.len().min(500)]
        ));
    }

    let releases: Vec<GitHubRelease> = serde_json::from_str(&body_text).map_err(|e| {
        format!(
            "Failed to parse GitHub releases: {}. Raw: {}",
            e,
            &body_text[..body_text.len().min(500)]
        )
    })?;

    Ok(releases)
}

// ------------------------------------------------------------------
// HuggingFace Repository
// ------------------------------------------------------------------

/// 获取 HuggingFace 仓库信息（通过 Rust 代理，避免前端 CORS）
#[tauri::command]
pub async fn fetch_huggingface_repo(
    repo_id: String,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = build_reqwest_client()?;

    let clean_repo_id = repo_id
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("huggingface.co/")
        .trim_end_matches('/')
        .to_string();

    if !clean_repo_id.contains('/') {
        return Err("Invalid HuggingFace repo ID format".to_string());
    }

    let mut request = client.get(format!(
        "https://huggingface.co/api/models/{}?blobs=true&files_metadata=true",
        clean_repo_id
    ));

    if let Some(token) = hf_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    let response = request.send().await.map_err(|e| e.to_string())?;

    let status = response.status();
    let body_text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "HuggingFace API error: HTTP {} - {}",
            status,
            &body_text[..body_text.len().min(500)]
        ));
    }

    let repo_data: serde_json::Value = serde_json::from_str(&body_text).map_err(|e| {
        format!(
            "Failed to parse HuggingFace response: {}. Raw: {}",
            e,
            &body_text[..body_text.len().min(500)]
        )
    })?;

    Ok(repo_data)
}
