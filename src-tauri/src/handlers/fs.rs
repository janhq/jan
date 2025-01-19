use tauri::AppHandle;

use crate::handlers::app::get_jan_data_folder_path;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn rm(app_handle: tauri::AppHandle, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("rm error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    fs::remove_dir_all(&path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn mkdir(app_handle: tauri::AppHandle, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args[0].is_empty() {
        return Err("mkdir error: Invalid argument".to_string());
    }

    let path = resolve_path(app_handle, &args[0]);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

fn normalize_file_path(path: &str) -> String {
    path.replace("file:/", "").replace("file:\\", "")
}

fn resolve_path(app_handle: tauri::AppHandle, path: &str) -> PathBuf {
    let path = if path.starts_with("file:/") || path.starts_with("file:\\") {
        let normalized = normalize_file_path(path);
        get_jan_data_folder_path(app_handle).join(normalized)
    } else {
        PathBuf::from(path)
    };

    if path.starts_with("http://") || path.starts_with("https://") {
        path
    } else {
        path.canonicalize().unwrap_or(path)
    }
}
