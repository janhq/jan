use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

pub async fn download_hf_file(
    repo_id: &str,
    file_path: &str,
    save_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        repo_id, file_path
    );

    let client = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        .build()?;

    let mut resp = client
        .get(&url)
        .header("User-Agent", "rust-reqwest/huggingface-downloader")
        .send()
        .await?;

    // Check if request was successful
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to download: HTTP status {}, {}",
            resp.status(),
            resp.text().await?
        )
        .into());
    }
    // Create parent directories if they don't exist
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut file = File::create(save_path)?;

    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_download_hf_file() {
        let repo_id = "gpt2";
        let file_path = "config.json";
        let save_path = std::path::PathBuf::from("subdir/test_config.json");

        if let Some(parent) = save_path.parent() {
            if parent.exists() {
                std::fs::remove_dir_all(parent).unwrap();
            }
        }

        let result = download_hf_file(repo_id, file_path, &save_path).await;
        assert!(result.is_ok(), "{}", result.unwrap_err());
        assert!(save_path.exists());

        // Read the file and verify its content
        let file_content = std::fs::read_to_string(&save_path).unwrap();
        let json_result: Result<serde_json::Value, _> = serde_json::from_str(&file_content);
        assert!(json_result.is_ok(), "Downloaded file is not valid JSON");

        if let Ok(json) = json_result {
            assert!(json.is_object(), "JSON root should be an object");
            assert_eq!(
                json.get("model_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                "gpt2",
                "model_type should be gpt2"
            );
        }

        // Clean up
        // NOTE: this will not run if there are errors
        // TODO: use tempfile crate instead
        std::fs::remove_dir_all(save_path.parent().unwrap()).unwrap();
    }
}
