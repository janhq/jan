use super::helpers::{_download_files_internal, err_to_string};
use super::models::DownloadItem;
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::filesystem::helpers::resolve_path_within_jan_data_folder;
use crate::core::state::AppState;
use std::collections::HashMap;
use tauri::{Runtime, State};
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub async fn download_files<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    items: Vec<DownloadItem>,
    task_id: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(existing_token) = download_manager.cancel_tokens.remove(task_id) {
            log::info!("Cancelling existing download task: {task_id}");
            existing_token.cancel();
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }
    let result = _download_files_internal(
        app.clone(),
        &items,
        &headers,
        task_id,
        true,
        cancel_token.clone(),
    )
    .await;

    // cleanup
    let paused = {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(task_id);
        download_manager.paused_tasks.remove(task_id)
    };

    // A paused task keeps its partial .tmp/.url so it can be resumed; a true
    // cancel discards the partial along with the (possibly absent) final file.
    if cancel_token.is_cancelled() && !paused {
        let jan_data_folder = get_jan_data_folder_path(app.clone());
        for item in items {
            if let Ok((_, save_path)) =
                resolve_path_within_jan_data_folder(&jan_data_folder, &item.save_path)
            {
                let _ = std::fs::remove_file(&save_path);
                let _ = std::fs::remove_file(with_appended_ext(&save_path, "tmp"));
                let _ = std::fs::remove_file(with_appended_ext(&save_path, "url"));
            }
        }
    }

    result.map_err(err_to_string)
}

fn with_appended_ext(path: &std::path::Path, ext: &str) -> std::path::PathBuf {
    match path.extension() {
        Some(cur) if !cur.is_empty() => {
            path.with_extension(format!("{}.{ext}", cur.to_string_lossy()))
        }
        _ => path.with_extension(ext),
    }
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    // NOTE: might want to add User-Agent header
    let mut download_manager = state.download_manager.lock().await;
    download_manager.paused_tasks.remove(task_id);
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task: {task_id}");
        Ok(())
    } else {
        Err(format!("No download task: {task_id}"))
    }
}

#[tauri::command]
pub async fn pause_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        download_manager.paused_tasks.insert(task_id.to_string());
        token.cancel();
        log::info!("Paused download task: {task_id}");
        Ok(())
    } else {
        Err(format!("No download task: {task_id}"))
    }
}
