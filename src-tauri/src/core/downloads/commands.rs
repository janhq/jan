use super::helpers::{_download_files_internal, err_to_string};
use super::models::DownloadItem;
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::filesystem::helpers::resolve_path_within_jan_data_folder;
use crate::core::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Runtime, State};
use tokio::sync::Notify;
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
    let notify = Arc::new(Notify::new());
    {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(existing_token) = download_manager.cancel_tokens.remove(task_id) {
            log::info!("Cancelling existing download task: {task_id}");
            existing_token.cancel();
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
        download_manager
            .task_done
            .insert(task_id.to_string(), notify.clone());
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

    // 任务已收尾,通知等待中的取消/暂停调用方(仅当信号仍是本任务的)
    {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(current) = download_manager.task_done.get(task_id) {
            if Arc::ptr_eq(current, &notify) {
                if let Some(notify) = download_manager.task_done.remove(task_id) {
                    notify.notify_waiters();
                }
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

/// 取消/暂停置位后,等待任务真正收尾(子进程退出、文件句柄释放)。
/// 前端随后会立即删除模型目录/恢复下载,若不等待会撞上文件锁(os error 32)。
async fn await_task_finished(state: &State<'_, AppState>, task_id: &str) {
    let notify = {
        let download_manager = state.download_manager.lock().await;
        download_manager.task_done.get(task_id).cloned()
    };
    if let Some(notify) = notify {
        let _ = tokio::time::timeout(Duration::from_secs(15), notify.notified()).await;
    }
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.paused_tasks.remove(task_id);
        if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
            token.cancel();
            log::info!("Cancelled download task: {task_id}");
        } else {
            return Err(format!("No download task: {task_id}"));
        }
    }
    await_task_finished(&state, task_id).await;
    Ok(())
}

#[tauri::command]
pub async fn pause_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
            download_manager.paused_tasks.insert(task_id.to_string());
            token.cancel();
            log::info!("Paused download task: {task_id}");
        } else {
            return Err(format!("No download task: {task_id}"));
        }
    }
    await_task_finished(&state, task_id).await;
    Ok(())
}
