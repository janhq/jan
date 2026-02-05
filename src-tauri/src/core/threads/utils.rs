use std::fs;
use std::path::PathBuf;
use tauri::Runtime;

use super::constants::{MESSAGES_FILE, THREADS_DIR, THREADS_FILE};
use crate::core::app::commands::get_jan_data_folder_path;

pub fn get_data_dir<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    get_jan_data_folder_path(app_handle).join(THREADS_DIR)
}

pub fn get_thread_dir<R: Runtime>(app_handle: tauri::AppHandle<R>, thread_id: &str) -> PathBuf {
    get_data_dir(app_handle).join(thread_id)
}

pub fn get_thread_metadata_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
) -> PathBuf {
    get_thread_dir(app_handle, thread_id).join(THREADS_FILE)
}

pub fn get_messages_path<R: Runtime>(app_handle: tauri::AppHandle<R>, thread_id: &str) -> PathBuf {
    get_thread_dir(app_handle, thread_id).join(MESSAGES_FILE)
}

pub fn ensure_data_dirs<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<(), String> {
    let data_dir = get_data_dir(app_handle.clone());
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ensure_thread_dir_exists<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
) -> Result<(), String> {
    ensure_data_dirs(app_handle.clone())?;
    let thread_dir = get_thread_dir(app_handle, thread_id);
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
