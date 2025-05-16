use crate::core::cmd::get_jan_data_folder_path;
use crate::core::state::AppState;
use crate::core::utils::normalize_path;
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
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub enum DownloadEventType {
    Started,
    Updated,
    Success,
    // Error,  // we don't need to emit an Error event. just return an error directly
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

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {}", e)
}

#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: &str,
    path: &Path,
    task_id: &str,
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
            .insert(task_id.to_string(), cancel_token.clone());
    }

    let header_map = _convert_headers(headers).map_err(err_to_string)?;
    let total_size = _get_file_size(url, header_map.clone())
        .await
        .map_err(err_to_string)?;
    log::info!("File size: {}", total_size);
    let mut evt = DownloadEvent {
        task_id: task_id.to_string(),
        total_size,
        downloaded_size: 0,
        download_type: "Model".to_string(),
        event_type: DownloadEventType::Started,
    };
    app.emit("download", evt.clone()).unwrap();

    // save file under Jan data folder
    let data_dir = get_jan_data_folder_path(app.clone());
    let save_path = data_dir.join(path);

    let mut has_error = false;
    let mut error_msg = String::new();
    match _download_file_internal(
        app.clone(),
        url,
        &save_path,
        header_map.clone(),
        evt,
        cancel_token.clone(),
    )
    .await
    {
        Ok(evt_) => {
            evt = evt_; // reassign ownership
        }
        Err((evt_, e)) => {
            evt = evt_; // reassign ownership
            error_msg = format!("Failed to download file: {}", e);
            log::error!("{}", error_msg);
            has_error = true;
        }
    }

    // cleanup
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(url);
    }
    if has_error {
        let _ = std::fs::remove_file(&save_path); // don't check error
        return Err(error_msg);
    }

    // emit final event
    if evt.event_type == DownloadEventType::Stopped {
        let _ = std::fs::remove_file(&save_path); // don't check error
    } else {
        evt.event_type = DownloadEventType::Success;
    }
    app.emit("download", evt.clone()).unwrap();

    Ok(())
}

#[tauri::command]
pub async fn download_hf_repo(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: &str,
    save_dir: &Path,
    task_id: &str,
    branch: Option<&str>,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    let branch_str = branch.unwrap_or("main");
    let header_map = _convert_headers(headers).map_err(err_to_string)?;

    log::info!("Downloading HF repo: {}, branch {}", model_id, branch_str);

    // get all files from repo, including subdirs
    let items = _list_hf_repo_files(model_id, branch, header_map.clone())
        .await
        .map_err(err_to_string)?;

    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        if download_manager.cancel_tokens.contains_key(model_id) {
            return Err(format!("model_id {} is already being downloaded", model_id));
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }

    let total_size = items.iter().map(|f| f.size).sum::<u64>();
    let mut evt = DownloadEvent {
        task_id: task_id.to_string(),
        total_size,
        downloaded_size: 0,
        download_type: "Model".to_string(),
        event_type: DownloadEventType::Started,
    };
    app.emit("download", evt.clone()).unwrap();

    let local_dir = get_jan_data_folder_path(app.clone()).join(save_dir);
    let mut has_error = false;
    let mut error_msg = String::new();
    for item in items {
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            model_id, branch_str, item.path
        );
        let save_path = local_dir.join(&item.path);
        match _download_file_internal(
            app.clone(),
            &url,
            &save_path,
            header_map.clone(),
            evt,
            cancel_token.clone(),
        )
        .await
        {
            Ok(evt_) => {
                evt = evt_; // reassign ownership
                if evt.event_type == DownloadEventType::Stopped {
                    break;
                }
            }
            Err((evt_, e)) => {
                evt = evt_; // reassign ownership
                error_msg = format!("Failed to download file: {}", e);
                log::error!("{}", error_msg);
                has_error = true;
                break;
            }
        }
    }

    // cleanup
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(model_id);
    }
    if has_error {
        let _ = std::fs::remove_dir_all(&local_dir); // don't check error
        return Err(error_msg);
    }

    // emit final event
    if evt.event_type == DownloadEventType::Stopped {
        let _ = std::fs::remove_dir_all(&local_dir); // don't check error
    } else {
        evt.event_type = DownloadEventType::Success;
    }
    app.emit("download", evt.clone()).unwrap();

    Ok(())
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    // NOTE: might want to add User-Agent header
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task_id: {}", task_id);
        Ok(())
    } else {
        Err(format!("No download task_id: {}", task_id))
    }
}

fn _convert_headers(
    headers: HashMap<String, String>,
) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    let mut header_map = HeaderMap::new();
    for (k, v) in headers {
        let key = HeaderName::from_bytes(k.as_bytes())?;
        let value = HeaderValue::from_str(&v)?;
        header_map.insert(key, value);
    }
    Ok(header_map)
}

async fn _get_file_size(
    url: &str,
    header_map: HeaderMap,
) -> Result<u64, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let resp = client.head(url).headers(header_map).send().await?;
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

// NOTE: Caller of this function should pass ownership of `evt` to this function
// (no .clone()) and obtain it back. Both Ok and Err will return ownership of
// the modified `evt` object back to the caller.
async fn _download_file_internal(
    app: tauri::AppHandle,
    url: &str,
    path: &Path, // this is absolute path
    header_map: HeaderMap,
    mut evt: DownloadEvent,
    cancel_token: CancellationToken,
) -> Result<DownloadEvent, (DownloadEvent, Box<dyn std::error::Error>)> {
    log::info!("Downloading file: {}", url);

    // normalize and enforce scope
    let path = normalize_path(path);
    let jan_data_folder = get_jan_data_folder_path(app.clone());
    if !path.starts_with(&jan_data_folder) {
        return Err((
            evt.clone(),
            format!(
                "Path {} is outside of Jan data folder {}",
                path.display(),
                jan_data_folder.display()
            )
            .into(),
        ));
    }

    // .read_timeout() and .connect_timeout() requires reqwest 0.12, which is not
    // compatible with hyper 0.14
    let client = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        // .read_timeout(Duration::from_secs(10))  // timeout between chunks
        // .connect_timeout(Duration::from_secs(10)) // timeout for first connection
        .build()
        .map_err(|e| (evt.clone(), e.into()))?;

    let resp = client
        .get(url)
        .headers(header_map)
        .send()
        .await
        .map_err(|e| (evt.clone(), e.into()))?;

    if !resp.status().is_success() {
        return Err((
            evt,
            format!(
                "Failed to download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            )
            .into(),
        ));
    }

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| (evt.clone(), e.into()))?;
        }
    }
    let mut file = File::create(&path)
        .await
        .map_err(|e| (evt.clone(), e.into()))?;

    // write chunk to file
    let mut stream = resp.bytes_stream();
    let mut download_delta = 0u64;
    evt.event_type = DownloadEventType::Updated;

    while let Some(chunk) = stream.next().await {
        if cancel_token.is_cancelled() {
            log::info!("Download cancelled: {}", url);
            evt.event_type = DownloadEventType::Stopped;
            break;
        }

        let chunk = chunk.map_err(|e| (evt.clone(), e.into()))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| (evt.clone(), e.into()))?;
        download_delta += chunk.len() as u64;

        // only update every 1MB
        if download_delta >= 1024 * 1024 {
            evt.downloaded_size += download_delta;
            app.emit("download", evt.clone()).unwrap();
            download_delta = 0u64;
        }
    }

    // cleanup
    file.flush().await.map_err(|e| (evt.clone(), e.into()))?;
    if evt.event_type == DownloadEventType::Stopped {
        let _ = std::fs::remove_file(&path); // don't check error
    }

    // caller should emit a final event after calling this function
    evt.downloaded_size += download_delta;

    Ok(evt)
}

#[derive(serde::Deserialize)]
struct HfItem {
    r#type: String,
    // oid: String,  // unused
    path: String,
    size: u64,
}

async fn _list_hf_repo_files(
    model_id: &str,
    branch: Option<&str>,
    header_map: HeaderMap,
) -> Result<Vec<HfItem>, Box<dyn std::error::Error>> {
    let branch_str = branch.unwrap_or("main");

    let mut files = vec![];

    // DFS
    let mut stack = vec!["".to_string()];
    let client = reqwest::Client::new();
    while let Some(subdir) = stack.pop() {
        let url = format!(
            "https://huggingface.co/api/models/{}/tree/{}/{}",
            model_id, branch_str, subdir
        );
        let resp = client.get(&url).headers(header_map.clone()).send().await?;

        if !resp.status().is_success() {
            return Err(format!(
                "Failed to list files: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default(),
            )
            .into());
        }

        for item in resp.json::<Vec<HfItem>>().await?.into_iter() {
            if item.r#type == "directory" {
                stack.push(item.path);
            } else {
                files.push(item);
            }
        }
    }

    Ok(files)
}
