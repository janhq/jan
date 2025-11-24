use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::setup;

#[tauri::command]
pub fn get_jan_extensions_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    get_jan_data_folder_path(app_handle).join("extensions")
}

#[tauri::command]
pub fn install_extensions<R: Runtime>(app: AppHandle<R>) {
    if let Err(err) = setup::install_extensions(app, true) {
        log::error!("Failed to install extensions: {err}");
    }
}

#[tauri::command]
pub fn get_active_extensions<R: Runtime>(app: AppHandle<R>) -> Vec<serde_json::Value> {
    // On mobile platforms, extensions are pre-bundled in the frontend
    // Return empty array so frontend's MobileCoreService handles it
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return vec![];
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut path = get_jan_extensions_path(app);
        path.push("extensions.json");
        log::info!("get jan extensions, path: {path:?}");

        let contents = fs::read_to_string(path);
        let contents: Vec<serde_json::Value> = match contents {
            Ok(data) => match serde_json::from_str::<Vec<serde_json::Value>>(&data) {
                Ok(exts) => exts
                    .into_iter()
                    .map(|ext| {
                        serde_json::json!({
                            "url": ext["url"],
                            "name": ext["name"],
                            "productName": ext["productName"],
                            "active": ext["_active"],
                            "description": ext["description"],
                            "version": ext["version"]
                        })
                    })
                    .collect(),
                Err(error) => {
                    log::error!("Failed to parse extensions.json: {error}");
                    vec![]
                }
            },
            Err(error) => {
                log::error!("Failed to read extensions.json: {error}");
                vec![]
            }
        };
        contents
    }
}
