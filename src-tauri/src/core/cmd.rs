use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime, State};
use base64::{engine::general_purpose, Engine as _};

use super::{server, setup, state::AppState};

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

/// Merge missing fields from default configuration into existing JSON configuration
fn merge_missing_fields(
    json_value: &mut serde_json::Value,
    default_data_folder: String,
) {
    if let Some(obj) = json_value.as_object_mut() {
        // Set default data_folder if missing
        if !obj.contains_key("data_folder") {
            obj.insert(
                "data_folder".to_string(),
                serde_json::Value::String(default_data_folder),
            );
        }
    }
}

/// Load configuration from file or create default
fn load_or_create_configuration(
    configuration_file: &PathBuf,
    default_data_folder: String,
) -> AppConfiguration {
    let mut app_default_configuration = AppConfiguration::default();
    app_default_configuration.data_folder = default_data_folder.clone();

    if !configuration_file.exists() {
        log::info!(
            "App config not found, creating default config at {:?}",
            configuration_file
        );

        if let Err(err) = fs::write(
            configuration_file,
            serde_json::to_string_pretty(&app_default_configuration).unwrap(),
        ) {
            log::error!("Failed to create default config: {}", err);
        }

        return app_default_configuration;
    }

    // Read and parse existing configuration
    match fs::read_to_string(configuration_file) {
        Ok(content) => parse_and_update_configuration(content, configuration_file, default_data_folder),
        Err(err) => {
            log::error!(
                "Failed to read app config, returning default config instead. Error: {}",
                err
            );
            app_default_configuration
        }
    }
}

/// Parse configuration content and update missing fields
fn parse_and_update_configuration(
    content: String,
    configuration_file: &PathBuf,
    default_data_folder: String,
) -> AppConfiguration {
    let app_default_configuration = AppConfiguration {
        data_folder: default_data_folder.clone(),
        ..AppConfiguration::default()
    };

    // Parse the JSON into a generic Value first to handle missing fields
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(mut json_value) => {
            // Merge missing fields with defaults
            merge_missing_fields(&mut json_value, default_data_folder);

            // Save the updated configuration back to file
            let updated_content = serde_json::to_string_pretty(&json_value).unwrap();
            if let Err(err) = fs::write(configuration_file, updated_content) {
                log::error!("Failed to update config with missing fields: {}", err);
            }

            // Now try to deserialize the updated JSON into AppConfiguration
            match serde_json::from_value::<AppConfiguration>(json_value) {
                Ok(app_configurations) => app_configurations,
                Err(err) => {
                    log::error!(
                        "Failed to parse app config after updating, returning default config instead. Error: {}",
                        err
                    );
                    app_default_configuration
                }
            }
        }
        Err(err) => {
            log::error!(
                "Failed to parse app config JSON, returning default config instead. Error: {}",
                err
            );
            app_default_configuration
        }
    }
}

#[tauri::command]
pub fn get_app_configurations<R: Runtime>(app_handle: tauri::AppHandle<R>) -> AppConfiguration {
    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return AppConfiguration::default();
    }

    let configuration_file = get_configuration_file_path(app_handle.clone());
    let default_data_folder = default_data_folder_path(app_handle.clone());

    let app_config = load_or_create_configuration(&configuration_file, default_data_folder);
    
    log::info!("Loaded app configuration: {:?}", app_config);
    
    app_config
}

#[tauri::command]
pub async fn update_app_configuration(
    app_handle: tauri::AppHandle,
    configuration: AppConfiguration,
) -> Result<(), String> {
    let configuration_file = get_configuration_file_path(app_handle.clone());
    log::info!(
        "update_app_configuration, configuration_file: {:?}",
        configuration_file
    );

    // Write the configuration to file
    fs::write(
        configuration_file,
        serde_json::to_string(&configuration).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;


    Ok(())
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



/// Save base64 content to a file in the rag-docs directory and return the path
#[tauri::command]
pub async fn save_file(
    base64_content: String,
    file_name: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    log::info!("Saving file to rag-docs: {}", file_name);
    
    // Decode base64 content
    let content_bytes = general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("Failed to decode base64 content: {}", e))?;

    // Get app data directory and create rag-docs subdirectory
    let app_data_path = get_jan_data_folder_path(app_handle);
    let rag_docs_dir = app_data_path.join("rag-docs");
    
    // Ensure rag-docs directory exists
    if !rag_docs_dir.exists() {
        std::fs::create_dir_all(&rag_docs_dir)
            .map_err(|e| format!("Failed to create rag-docs directory: {}", e))?;
    }

    // Generate unique filename to avoid conflicts
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    
    // Extract file extension from original filename
    let extension = std::path::Path::new(&file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");
    
    // Create unique filename with timestamp prefix
    let unique_filename = if extension.is_empty() {
        format!("{}_{}", timestamp, file_name)
    } else {
        let stem = std::path::Path::new(&file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        format!("{}_{}.{}", timestamp, stem, extension)
    };
    
    let file_path = rag_docs_dir.join(&unique_filename);

    // Write content to file
    std::fs::write(&file_path, &content_bytes)
        .map_err(|e| format!("Failed to write to file: {}", e))?;

    // Get the absolute path as string
    let file_path_str = file_path.to_string_lossy().to_string();
    
    log::info!("File saved at: {}", file_path_str);
    Ok(file_path_str)
}

#[tauri::command]
pub async fn reset_cortex_restart_count(state: State<'_, AppState>) -> Result<(), String> {
    let mut count = state.cortex_restart_count.lock().await;
    *count = 0;
    log::info!("Cortex server restart count reset to 0.");
    Ok(())
}

#[tauri::command]
pub async fn change_app_data_folder(
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
    update_app_configuration(app_handle, configuration).await
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
    let auth_token = app
        .state::<AppState>()
        .app_token
        .clone()
        .unwrap_or_default();
    server::start_server(host, port, prefix, auth_token, api_key, trusted_hosts)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn stop_server() -> Result<(), String> {
    server::stop_server().await.map_err(|e| e.to_string())?;
    Ok(())
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
