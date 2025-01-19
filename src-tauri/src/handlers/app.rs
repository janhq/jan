use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

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
pub fn get_app_configurations(app_handle: tauri::AppHandle) -> AppConfiguration {
    let app_default_configuration = AppConfiguration::default();

    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return app_default_configuration;
    }

    let configuration_file = get_configuration_file_path(app_handle);

    if !configuration_file.exists() {
        println!(
            "App config not found, creating default config at {:?}",
            configuration_file
        );

        if let Err(err) = fs::write(
            &configuration_file,
            serde_json::to_string(&app_default_configuration).unwrap(),
        ) {
            eprintln!("Failed to create default config: {}", err);
        }

        return app_default_configuration;
    }

    match fs::read_to_string(&configuration_file) {
        Ok(content) => match serde_json::from_str::<AppConfiguration>(&content) {
            Ok(app_configurations) => app_configurations,
            Err(err) => {
                eprintln!(
                    "Failed to parse app config, returning default config instead. Error: {}",
                    err
                );
                app_default_configuration
            }
        },
        Err(err) => {
            eprintln!(
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
    configuration: &AppConfiguration,
) -> Result<(), String> {
    let configuration_file = get_configuration_file_path(app_handle);
    println!(
        "update_app_configuration, configuration_file: {:?}",
        configuration_file
    );

    fs::write(
        configuration_file,
        serde_json::to_string(configuration).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_jan_data_folder_path(app_handle: tauri::AppHandle) -> PathBuf {
    let app_configurations = get_app_configurations(app_handle);
    PathBuf::from(app_configurations.data_folder)
}

#[tauri::command]
pub fn get_jan_extensions_path(app_handle: tauri::AppHandle) -> PathBuf {
    get_jan_data_folder_path(app_handle).join("extensions")
}

fn get_configuration_file_path(app_handle: tauri::AppHandle) -> PathBuf {
    let app_path = app_handle.path().app_data_dir().unwrap_or_else(|err| {
        let home_dir = std::env::var(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .expect("Failed to determine the home directory");

        PathBuf::from(home_dir)
    });

    app_path.join(CONFIGURATION_FILE_NAME)
}

fn default_data_folder_path(app_handle: tauri::AppHandle) -> String {
    return app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
}
