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

        // Create parent directories if they don't exist
        if let Some(parent) = save_path.parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(err_to_string)?;
            }
        }

        let current_extension = save_path.extension().unwrap_or_default().to_string_lossy();
        let append_extension = |ext: &str| {
            if current_extension.is_empty() {
                ext.to_string()
            } else {
                format!("{}.{}", current_extension, ext)
            }
        };
        let tmp_save_path = save_path.with_extension(append_extension("tmp"));
        let url_save_path = save_path.with_extension(append_extension("url"));

        let mut resume = tmp_save_path.exists()
            && tokio::fs::read_to_string(&url_save_path)
                .await
                .map(|url| url == item.url) // check if we resume the same URL
                .unwrap_or(false);

        tokio::fs::write(&url_save_path, item.url.clone())
            .await
            .map_err(err_to_string)?;

        log::info!("Started downloading: {}", item.url);
        let mut download_delta = 0u64;
        let resp = if resume {
            let downloaded_size = tmp_save_path.metadata().map_err(err_to_string)?.len();
            match _get_maybe_resume(&client, &item.url, downloaded_size).await {
                Ok(resp) => {
                    log::info!(
                        "Resume download: {}, already downloaded {} bytes",
                        item.url,
                        downloaded_size
                    );
                    download_delta += downloaded_size;
                    resp
                }
                Err(e) => {
                    // fallback to normal download
                    log::warn!("Failed to resume download: {}", e);
                    resume = false;
                    _get_maybe_resume(&client, &item.url, 0).await?
                }
            }
        } else {
            _get_maybe_resume(&client, &item.url, 0).await?
        };
        let mut stream = resp.bytes_stream();

        let file = if resume {
            // resume download, append to existing file
            tokio::fs::OpenOptions::new()
                .write(true)
                .append(true)
                .open(&tmp_save_path)
                .await
                .map_err(err_to_string)?
        } else {
            // start new download, create a new file
            File::create(&tmp_save_path).await.map_err(err_to_string)?
        };
        let mut writer = tokio::io::BufWriter::new(file);

        // write chunk to file
        while let Some(chunk) = stream.next().await {
            if cancel_token.is_cancelled() {
                log::info!("Download cancelled for task: {}", task_id);
                app.emit(&evt_name, evt.clone()).unwrap();
                return Ok(());
            }

            let chunk = chunk.map_err(err_to_string)?;
            writer.write_all(&chunk).await.map_err(err_to_string)?;
            download_delta += chunk.len() as u64;

            // only update every 10 MB
            if download_delta >= 10 * 1024 * 1024 {
                evt.transferred += download_delta;
                app.emit(&evt_name, evt.clone()).unwrap();
                download_delta = 0u64;
            }
        }

        writer.flush().await.map_err(err_to_string)?;
        evt.transferred += download_delta;

        // rename tmp file to final file
        tokio::fs::rename(&tmp_save_path, &save_path)
            .await
            .map_err(err_to_string)?;
        tokio::fs::remove_file(&url_save_path)
            .await
            .map_err(err_to_string)?;
        log::info!("Finished downloading: {}", item.url);
    }

    app.emit(&evt_name, evt.clone()).unwrap();
    Ok(())
}

async fn _get_maybe_resume(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
) -> Result<reqwest::Response, String> {
    if start_bytes > 0 {
        let resp = client
            .get(url)
            .header("Range", format!("bytes={}-", start_bytes))
            .send()
            .await
            .map_err(err_to_string)?;
        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "Failed to resume download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    } else {
        let resp = client.get(url).send().await.map_err(err_to_string)?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    }
}
