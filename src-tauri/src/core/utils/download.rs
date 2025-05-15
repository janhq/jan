use crate::core::cmd::get_jan_data_folder_path;
use crate::core::state::AppState;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tauri::{Emitter, State};
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
    // Error,
    Stopped,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub url: String,
    pub total_size: u64,
    pub downloaded_size: u64,
    pub download_type: String, // TODO: make this an enum as well
    pub event_type: DownloadEventType,
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {}", e)
}

#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: &str,
    path: &Path,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        if download_manager.cancel_tokens.contains_key(url) {
            return Err(format!("URL {} is already being downloaded", url));
        }
        download_manager
            .cancel_tokens
            .insert(url.to_string(), cancel_token.clone());
    }

    // .read_timeout() and .connect_timeout() requires reqwest 0.12, which is not
    // compatible with hyper 0.14
    let client = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        // .read_timeout(Duration::from_secs(10))  // timeout between chunks
        // .connect_timeout(Duration::from_secs(10)) // timeout for first connection
        .build()
        .map_err(err_to_string)?;

    // NOTE: might want to add User-Agent header
    let header_map = {
        let mut header_map = HeaderMap::new();
        for (k, v) in headers {
            let key = HeaderName::from_bytes(k.as_bytes()).map_err(err_to_string)?;
            let value = HeaderValue::from_str(&v).map_err(err_to_string)?;
            header_map.insert(key, value);
        }
        header_map
    };
    let resp = client
        .get(url)
        .headers(header_map)
        .send()
        .await
        .map_err(err_to_string)?;

    if !resp.status().is_success() {
        return Err(format!(
            "Failed to download: HTTP status {}, {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }

    // save file under Jan data folder
    let data_dir = get_jan_data_folder_path(app.clone());
    let save_path = data_dir.join(path);

    // Create parent directories if they don't exist
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(err_to_string)?;
        }
    }
    let mut file = File::create(save_path).await.map_err(err_to_string)?;

    let mut evt = DownloadEvent {
        url: url.to_string(),
        total_size: resp.content_length().unwrap_or(0),
        downloaded_size: 0,
        download_type: "Model".to_string(),
        event_type: DownloadEventType::Started,
    };
    app.emit("download", evt.clone()).unwrap();

    // write chunk to file
    let mut stream = resp.bytes_stream();
    let mut is_cancelled = false;
    let mut download_delta = 0u64;
    while let Some(chunk) = stream.next().await {
        if cancel_token.is_cancelled() {
            log::info!("Download cancelled: {}", url);
            is_cancelled = true;
            break;
        }

        let chunk = chunk.map_err(err_to_string)?;
        file.write_all(&chunk).await.map_err(err_to_string)?;
        download_delta += chunk.len() as u64;

        // only update every 1MB
        if download_delta >= 1024 * 1024 {
            evt.downloaded_size += download_delta;
            evt.event_type = DownloadEventType::Updated;
            app.emit("download", evt.clone()).unwrap();
            download_delta = 0u64;
        }
    }

    // cleanup
    file.flush().await.map_err(err_to_string)?;
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(url);
    }

    // emit final event
    evt.downloaded_size += download_delta;
    if !is_cancelled {
        evt.event_type = DownloadEventType::Success;
    } else {
        let _ = std::fs::remove_file(path); // don't check error
        evt.event_type = DownloadEventType::Stopped;
    }
    app.emit("download", evt).unwrap();

    Ok(())
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, url: &str) -> Result<(), String> {
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(url) {
        token.cancel();
        log::info!("Cancelled download URL: {}", url);
        Ok(())
    } else {
        Err(format!("No download URL: {}", url))
    }
}
