use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

pub async fn download(url: &str, save_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        .build()?;

    let mut resp = client
        .get(url)
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
