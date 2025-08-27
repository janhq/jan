use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_jan_data_folder_path, update_app_configuration,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::clean_up_mcp_servers;
use crate::core::state::AppState;

#[tauri::command]
pub fn factory_reset(app_handle: tauri::AppHandle, state: State<'_, AppState>) {
    // close window
    let windows = app_handle.webview_windows();
    for (label, window) in windows.iter() {
        window.close().unwrap_or_else(|_| {
            log::warn!("Failed to close window: {:?}", label);
        });
    }
    let data_folder = get_jan_data_folder_path(app_handle.clone());
    log::info!("Factory reset, removing data folder: {:?}", data_folder);

    tauri::async_runtime::block_on(async {
        clean_up_mcp_servers(state.clone()).await;
        let _ = cleanup_llama_processes(app_handle.clone()).await;

        if data_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&data_folder) {
                log::error!("Failed to remove data folder: {}", e);
                return;
            }
        }

        // Recreate the data folder
        let _ = fs::create_dir_all(&data_folder).map_err(|e| e.to_string());

        // Reset the configuration
        let mut default_config = AppConfiguration::default();
        default_config.data_folder = default_data_folder_path(app_handle.clone());
        let _ = update_app_configuration(app_handle.clone(), default_config);

        app_handle.restart();
    });
}

#[tauri::command]
pub fn relaunch(app: AppHandle) {
    app.restart()
}

#[tauri::command]
pub fn open_app_directory(app: AppHandle) {
    let app_path = app.path().app_data_dir().unwrap();
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(app_path)
            .spawn()
            .expect("Failed to open app directory");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(app_path)
            .spawn()
            .expect("Failed to open app directory");
    } else {
        std::process::Command::new("xdg-open")
            .arg(app_path)
            .spawn()
            .expect("Failed to open app directory");
    }
}

#[tauri::command]
pub fn open_file_explorer(path: String) {
    let path = PathBuf::from(path);
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .expect("Failed to open file explorer");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .expect("Failed to open file explorer");
    } else {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .expect("Failed to open file explorer");
    }
}

#[tauri::command]
pub async fn read_logs(app: AppHandle) -> Result<String, String> {
    let log_path = get_jan_data_folder_path(app).join("logs").join("app.log");
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err(format!("Log file not found"))
    }
}

// check if a system library is available
#[tauri::command]
pub fn is_library_available(library: &str) -> bool {
    match unsafe { libloading::Library::new(library) } {
        Ok(_) => true,
        Err(e) => {
            log::info!("Library {} is not available: {}", library, e);
            false
        }
    }
}
