use futures_util::StreamExt;
use std::path::Path;
use std::time::Duration;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

// this is to emulate the current way of downloading files by Cortex + Jan
// we can change this later
#[derive(serde::Serialize, Clone, Debug)]
pub enum DownloadEventType {
    Started,
    Updated,
    Success,
    Error,
    Stopped,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub task_id: String,
    pub total_size: u64,
    pub downloaded_size: u64,
    pub download_type: String, // TODO: make this an enum as well
    pub event_type: DownloadEventType,
}

pub async fn download<F>(
    url: &str,
    save_path: &Path,
    mut callback: Option<F>,
) -> Result<(), Box<dyn std::error::Error>>
where
    // F: FnMut(u64) + Send + 'static,
    F: FnMut(u64),
{
    let client = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        .build()?;

    // NOTE: might want to add User-Agent header
    let resp = client.get(url).send().await?;
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
    let mut file = File::create(save_path).await?;

    // write chunk to file, and call callback if needed (e.g. download progress)
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;

        // NOTE: might want to reduce frequency of callback e.g. every 1MB
        if let Some(cb) = callback.as_mut() {
            cb(chunk.len() as u64);
        }
    }
    file.flush().await?;
    Ok(())
}
