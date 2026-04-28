use super::helpers::{_download_files_internal, err_to_string};
use super::models::DownloadItem;
use crate::core::app::commands::get_jan_data_folder_path;
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
    // TODO: Support resuming downloads when FE is ready
    let result = _download_files_internal(
        app.clone(),
        &items,
        &headers,
        task_id,
        false,
        cancel_token.clone(),
    )
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
        log::info!("Cancelled download task: {task_id}");
        Ok(())
    } else {
        Err(format!("No download task: {task_id}"))
    }
}
