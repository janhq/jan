use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime, State};

use super::{server, setup, state::AppState, validation::{validate_factory_reset_target, validate_folder_change_target, FolderValidationResult}};

const CONFIGURATION_FILE_NAME: &str = "settings.json";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfiguration {
    pub data_folder: String,
    // Add other fields as needed
}
impl AppConfiguration {
    pub fn default() -> Self {
        Self {
            data_folder: String::from("./data"), // Set a default value for the data_folder
                                                 // Add other fields with default values as needed
        }
    }
}

#[tauri::command]
pub fn get_app_configurations<R: Runtime>(app_handle: tauri::AppHandle<R>) -> AppConfiguration {
    let mut app_default_configuration = AppConfiguration::default();

    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return app_default_configuration;
    }

    let configuration_file = get_configuration_file_path(app_handle.clone());

    let default_data_folder = default_data_folder_path(app_handle.clone());

    if !configuration_file.exists() {
        log::info!(
            "App config not found, creating default config at {:?}",
            configuration_file
        );

        app_default_configuration.data_folder = default_data_folder;

        if let Err(err) = fs::write(
            &configuration_file,
            serde_json::to_string(&app_default_configuration).unwrap(),
        ) {
            log::error!("Failed to create default config: {}", err);
        }

        return app_default_configuration;
    }

    match fs::read_to_string(&configuration_file) {
        Ok(content) => match serde_json::from_str::<AppConfiguration>(&content) {
            Ok(app_configurations) => app_configurations,
            Err(err) => {
                log::error!(
                    "Failed to parse app config, returning default config instead. Error: {}",
                    err
                );
                app_default_configuration
            }
        },
        Err(err) => {
            log::error!(
                "Failed to read app config, returning default config instead. Error: {}",
                err
            );
            app_default_configuration
        }
    }
}

#[tauri::command]
pub fn update_app_configuration(
    app_handle: tauri::AppHandle,
    configuration: AppConfiguration,
) -> Result<(), String> {
    let configuration_file = get_configuration_file_path(app_handle);
    log::info!(
        "update_app_configuration, configuration_file: {:?}",
        configuration_file
    );

    fs::write(
        configuration_file,
        serde_json::to_string(&configuration).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_jan_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    if cfg!(test) {
        return PathBuf::from("./data");
    }

    let app_configurations = get_app_configurations(app_handle);
    PathBuf::from(app_configurations.data_folder)
}

#[tauri::command]
pub fn get_jan_extensions_path(app_handle: tauri::AppHandle) -> PathBuf {
    get_jan_data_folder_path(app_handle).join("extensions")
}

#[tauri::command]
pub fn get_configuration_file_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    let app_path = app_handle.path().app_data_dir().unwrap_or_else(|err| {
        log::error!(
            "Failed to get app data directory: {}. Using home directory instead.",
            err
        );

        let home_dir = std::env::var(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .expect("Failed to determine the home directory");

        PathBuf::from(home_dir)
    });

    let package_name = env!("CARGO_PKG_NAME");
    #[cfg(target_os = "linux")]
    let old_data_dir = {
        if let Some(config_path) = dirs::config_dir() {
            config_path.join(package_name)
        } else {
            log::debug!("Could not determine config directory");
            app_path
                .parent()
                .unwrap_or(&app_path.join("../"))
                .join(package_name)
        }
    };

    #[cfg(not(target_os = "linux"))]
    let old_data_dir = app_path
        .parent()
        .unwrap_or(&app_path.join("../"))
        .join(package_name);

    if old_data_dir.exists() {
        return old_data_dir.join(CONFIGURATION_FILE_NAME);
    } else {
        return app_path.join(CONFIGURATION_FILE_NAME);
    }
}

#[tauri::command]
pub fn default_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> String {
    let mut path = app_handle.path().data_dir().unwrap();

    let app_name = std::env::var("APP_NAME")
        .unwrap_or_else(|_| app_handle.config().product_name.clone().unwrap());
    path.push(app_name);
    path.push("data");

    let mut path_str = path.to_str().unwrap().to_string();

    if let Some(stripped) = path.to_str().unwrap().to_string().strip_suffix(".ai.app") {
        path_str = stripped.to_string();
    }

    path_str
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
pub fn install_extensions(app: AppHandle) {
    if let Err(err) = setup::install_extensions(app, true) {
        log::error!("Failed to install extensions: {}", err);
    }
}

#[tauri::command]
pub fn get_active_extensions(app: AppHandle) -> Vec<serde_json::Value> {
    let mut path = get_jan_extensions_path(app);
    path.push("extensions.json");
    log::info!("get jan extensions, path: {:?}", path);

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
                log::error!("Failed to parse extensions.json: {}", error);
                vec![]
            }
        },
        Err(error) => {
            log::error!("Failed to read extensions.json: {}", error);
            vec![]
        }
    };
    return contents;
}

#[tauri::command]
pub fn get_user_home_path(app: AppHandle) -> String {
    return get_app_configurations(app.clone()).data_folder;
}

/// Recursively copy a directory from src to dst
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), io::Error> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn reset_cortex_restart_count(state: State<'_, AppState>) -> Result<(), String> {
    let mut count = state.cortex_restart_count.lock().await;
    *count = 0;
    log::info!("Cortex server restart count reset to 0.");
    Ok(())
}

#[tauri::command]
pub fn change_app_data_folder(
    app_handle: tauri::AppHandle,
    new_data_folder: String,
) -> Result<(), String> {
    // Get current data folder path
    let current_data_folder = get_jan_data_folder_path(app_handle.clone());
    let new_data_folder_path = PathBuf::from(&new_data_folder);

    // Create the new data folder if it doesn't exist
    if !new_data_folder_path.exists() {
        fs::create_dir_all(&new_data_folder_path)
            .map_err(|e| format!("Failed to create new data folder: {}", e))?;
    }

    // Copy all files from the old folder to the new one
    if current_data_folder.exists() {
        log::info!(
            "Copying data from {:?} to {:?}",
            current_data_folder,
            new_data_folder_path
        );

        // Check if this is a parent directory to avoid infinite recursion
        if new_data_folder_path.starts_with(&current_data_folder) {
            return Err(
                "New data folder cannot be a subdirectory of the current data folder".to_string(),
            );
        }
        copy_dir_recursive(&current_data_folder, &new_data_folder_path)
            .map_err(|e| format!("Failed to copy data to new folder: {}", e))?;
    } else {
        log::info!("Current data folder does not exist, nothing to copy");
    }

    // Update the configuration to point to the new folder
    let mut configuration = get_app_configurations(app_handle.clone());
    configuration.data_folder = new_data_folder;

    // Save the updated configuration
    update_app_configuration(app_handle, configuration)
}

#[tauri::command]
pub fn app_token(state: State<'_, AppState>) -> Option<String> {
    state.app_token.clone()
}

#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    host: String,
    port: u16,
    prefix: String,
    api_key: String,
    trusted_hosts: Vec<String>,
) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let auth_token = state.app_token.clone().unwrap_or_default();
    let server_handle = state.server_handle.clone();

    server::start_server(
        server_handle,
        host,
        port,
        prefix,
        auth_token,
        api_key,
        trusted_hosts,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    let server_handle = state.server_handle.clone();

    server::stop_server(server_handle)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();

    Ok(server::is_server_running(server_handle).await)
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

/// Validates a folder for factory reset operation
#[tauri::command]
pub fn validate_factory_reset_folder<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<FolderValidationResult, String> {
    let current_data_folder = get_jan_data_folder_path(app_handle);
    
    log::info!("Validating factory reset for folder: {:?}", current_data_folder);
    
    let result = validate_factory_reset_target(&current_data_folder);
    
    log::info!("Factory reset validation result: {:?}", result);
    
    Ok(result)
}

/// Validates a target folder for data folder change operation
#[tauri::command]
pub fn validate_folder_change<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    target_path: String,
) -> Result<FolderValidationResult, String> {
    let current_data_folder = get_jan_data_folder_path(app_handle);
    let target_folder = PathBuf::from(&target_path);
    
    log::info!(
        "Validating folder change from {:?} to {:?}",
        current_data_folder,
        target_folder
    );
    
    let result = validate_folder_change_target(&target_folder, Some(&current_data_folder));
    
    log::info!("Folder change validation result: {:?}", result);
    
    Ok(result)
}

/// Enhanced change_app_data_folder with validation
#[tauri::command]
pub fn change_app_data_folder_with_validation(
    app_handle: tauri::AppHandle,
    new_data_folder: String,
    skip_validation: Option<bool>,
) -> Result<(), String> {
    let skip_validation = skip_validation.unwrap_or(false);
    
    if !skip_validation {
        // Validate the target folder first
        let validation_result = validate_folder_change(app_handle.clone(), new_data_folder.clone())?;
        
        if let Some(error) = validation_result.error_message {
            return Err(format!("Validation failed: {}", error));
        }
        
        // Log warnings but don't block the operation
        for warning in &validation_result.warnings {
            log::warn!("Folder change warning: {}", warning);
        }
    }
    
    // Proceed with the original change_app_data_folder logic
    change_app_data_folder(app_handle, new_data_folder)
}
