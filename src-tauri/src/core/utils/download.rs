use crate::core::cmd::get_jan_data_folder_path;
use crate::core::state::AppState;
use crate::core::utils::normalize_path;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{Emitter, State};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, CancellationToken>,
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct DownloadItem {
    pub url: String,
    pub save_path: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub transferred: u64,
    pub total: u64,
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {}", e)
}

#[tauri::command]
pub async fn download_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    items: Vec<DownloadItem>,
    task_id: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        if download_manager.cancel_tokens.contains_key(task_id) {
            return Err(format!("task_id {} exists", task_id));
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }

    let result =
        _download_files_internal(app.clone(), &items, &headers, task_id, cancel_token.clone())
            .await;

    // cleanup
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(task_id);
    }

    // delete files if cancelled
    if cancel_token.is_cancelled() {
        let jan_data_folder = get_jan_data_folder_path(app.clone());
        for item in items {
            let save_path = jan_data_folder.join(&item.save_path);
            let _ = std::fs::remove_file(&save_path); // don't check error
        }
    }

    result.map_err(err_to_string)
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    // NOTE: might want to add User-Agent header
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task: {}", task_id);
        Ok(())
    } else {
        Err(format!("No download task: {}", task_id))
    }
}

fn _convert_headers(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    let mut header_map = HeaderMap::new();
    for (k, v) in headers {
        let key = HeaderName::from_bytes(k.as_bytes())?;
        let value = HeaderValue::from_str(v)?;
        header_map.insert(key, value);
    }
    Ok(header_map)
}

async fn _get_file_size(
    client: &reqwest::Client,
    url: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let resp = client.head(url).send().await?;
    if !resp.status().is_success() {
        return Err(format!("Failed to get file size: HTTP status {}", resp.status()).into());
    }
    // this is buggy, always return 0 for HEAD request
    // Ok(resp.content_length().unwrap_or(0))

    match resp.headers().get("content-length") {
        Some(value) => {
            let value_str = value.to_str()?;
            let value_u64: u64 = value_str.parse()?;
            Ok(value_u64)
        }
        None => Ok(0),
    }
}

async fn _download_files_internal(
    app: tauri::AppHandle,
    items: &[DownloadItem],
    headers: &HashMap<String, String>,
    task_id: &str,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    log::info!("Start download task: {}", task_id);

    let header_map = _convert_headers(headers).map_err(err_to_string)?;

    // .read_timeout() and .connect_timeout() requires reqwest 0.12, which is not
    // compatible with hyper 0.14
    let client = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        // .read_timeout(Duration::from_secs(10))  // timeout between chunks
        // .connect_timeout(Duration::from_secs(10)) // timeout for first connection
        .default_headers(header_map.clone())
        .build()
        .map_err(err_to_string)?;

    let total_size = {
        let mut total_size = 0u64;
        for item in items.iter() {
            total_size += _get_file_size(&client, &item.url)
                .await
                .map_err(err_to_string)?;
        }
        total_size
    };
    log::info!("Total download size: {}", total_size);

    let mut evt = DownloadEvent {
        transferred: 0,
        total: total_size,
    };
    let evt_name = format!("download-{}", task_id);

    // save file under Jan data folder
    let jan_data_folder = get_jan_data_folder_path(app.clone());

    for item in items.iter() {
        let save_path = jan_data_folder.join(&item.save_path);
        let save_path = normalize_path(&save_path);

        // enforce scope
        if !save_path.starts_with(&jan_data_folder) {
            return Err(format!(
                "Path {} is outside of Jan data folder {}",
                save_path.display(),
                jan_data_folder.display()
            ));
        }

        log::info!("Started downloading: {}", item.url);
        let resp = client.get(&item.url).send().await.map_err(err_to_string)?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }

        // Create parent directories if they don't exist
        if let Some(parent) = save_path.parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent).await.map_err(err_to_string)?;
            }
        }
        let mut file = File::create(&save_path).await.map_err(err_to_string)?;

        // write chunk to file
        let mut stream = resp.bytes_stream();
        let mut download_delta = 0u64;

        while let Some(chunk) = stream.next().await {
            if cancel_token.is_cancelled() {
                log::info!("Download cancelled for task: {}", task_id);
                app.emit(&evt_name, evt.clone()).unwrap();
                return Ok(());
            }

            let chunk = chunk.map_err(err_to_string)?;
            file.write_all(&chunk).await.map_err(err_to_string)?;
            download_delta += chunk.len() as u64;

            // only update every 1MB
            if download_delta >= 1024 * 1024 {
                evt.transferred += download_delta;
                app.emit(&evt_name, evt.clone()).unwrap();
                download_delta = 0u64;
            }
        }

        file.flush().await.map_err(err_to_string)?;
        evt.transferred += download_delta;
        log::info!("Finished downloading: {}", item.url);
    }

    app.emit(&evt_name, evt.clone()).unwrap();
    Ok(())
}
