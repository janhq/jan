use crate::core::state::AppState;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tauri::State;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, CancellationToken>,
}

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
    cancel_token: Option<CancellationToken>,
    mut callback: Option<F>,
) -> Result<(), Box<dyn std::error::Error>>
where
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
    let mut is_cancelled = false;
    while let Some(chunk) = stream.next().await {
        if let Some(token) = cancel_token.as_ref() {
            if token.is_cancelled() {
                log::info!("Download cancelled: {}", url);
                is_cancelled = true;
                break;
            }
        }

        let chunk = chunk?;
        file.write_all(&chunk).await?;

        // NOTE: might want to reduce frequency of callback e.g. every 1MB
        if let Some(cb) = callback.as_mut() {
            cb(chunk.len() as u64);
        }
    }

    // cleanup
    file.flush().await?;
    if is_cancelled {
        // NOTE: we don't check error here
        let _ = std::fs::remove_file(save_path);
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task: {}", task_id);
        Ok(())
    } else {
        Err(format!("No download task with id {}", task_id))
    }
}
