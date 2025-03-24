use flate2::read::GzDecoder;
use serde_json::Value;
use std::fs;
use std::fs::File;
use std::io::Read;
use tar::Archive;
use tauri::AppHandle;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    let mut app_default_configuration = AppConfiguration::default();

    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return app_default_configuration;
    }

    let configuration_file = get_configuration_file_path(app_handle.clone());

    let default_data_folder = default_data_folder_path(app_handle.clone());

    if !configuration_file.exists() {
        println!(
            "App config not found, creating default config at {:?}",
            configuration_file
        );

        app_default_configuration.data_folder = default_data_folder;

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
    configuration: AppConfiguration,
) -> Result<(), String> {
    let configuration_file = get_configuration_file_path(app_handle);
    println!(
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
pub fn get_jan_data_folder_path(app_handle: tauri::AppHandle) -> PathBuf {
    let app_configurations = get_app_configurations(app_handle);
    PathBuf::from(app_configurations.data_folder)
}

#[tauri::command]
pub fn get_jan_extensions_path(app_handle: tauri::AppHandle) -> PathBuf {
    get_jan_data_folder_path(app_handle).join("extensions")
}

#[tauri::command]
pub fn get_configuration_file_path(app_handle: tauri::AppHandle) -> PathBuf {
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

#[tauri::command]
pub fn default_data_folder_path(app_handle: tauri::AppHandle) -> String {
    return app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
}

#[tauri::command]
pub fn get_active_extensions(app: AppHandle) -> Vec<serde_json::Value> {
    let mut path = get_jan_extensions_path(app);
    path.push("extensions.json");
    println!("get jan extensions, path: {:?}", path);

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
            Err(_) => vec![],
        },
        Err(_) => vec![],
    };
    return contents;
}

#[tauri::command]
pub fn get_user_home_path(app: AppHandle) -> String {
    return get_app_configurations(app.clone()).data_folder;
}

fn extract_extension_manifest<R: Read>(archive: &mut Archive<R>) -> Result<Option<Value>, String> {
    let entry = archive
        .entries()
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()) // Ignore errors in individual entries
        .find(|entry| {
            if let Ok(file_path) = entry.path() {
                let path_str = file_path.to_string_lossy();
                path_str == "package/package.json" || path_str == "package.json"
            } else {
                false
            }
        });

    if let Some(mut entry) = entry {
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;

        let package_json: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(Some(package_json));
    }

    Ok(None)
}

pub fn install_extensions(app: tauri::AppHandle) -> Result<(), String> {
    let extensions_path = get_jan_extensions_path(app.clone());
    let pre_install_path = PathBuf::from("./../pre-install");

    if !extensions_path.exists() {
        fs::create_dir_all(&extensions_path).map_err(|e| e.to_string())?;
    }

    let extensions_json_path = extensions_path.join("extensions.json");
    let mut extensions_list = if extensions_json_path.exists() {
        let existing_data =
            fs::read_to_string(&extensions_json_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str::<Vec<Value>>(&existing_data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };

    for entry in fs::read_dir(&pre_install_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "tgz") {
            println!("Installing extension from {:?}", path);
            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);

            let mut extension_name = None;
            let mut extension_manifest = None;
            extract_extension_manifest(&mut archive)
                .map_err(|e| e.to_string())
                .and_then(|manifest| match manifest {
                    Some(manifest) => {
                        extension_name = manifest["name"].as_str().map(|s| s.to_string());
                        extension_manifest = Some(manifest);
                        Ok(())
                    }
                    None => Err("Manifest is None".to_string()),
                })?;

            let extension_name = extension_name.ok_or("package.json not found in archive")?;
            let extension_dir = extensions_path.join(extension_name.clone());
            fs::create_dir_all(&extension_dir).map_err(|e| e.to_string())?;

            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let file_path = entry.path().map_err(|e| e.to_string())?;
                let components: Vec<_> = file_path.components().collect();
                if components.len() > 1 {
                    let relative_path: PathBuf = components[1..].iter().collect();
                    let target_path = extension_dir.join(relative_path);
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let _result = entry.unpack(&target_path).map_err(|e| e.to_string())?;
                }
            }

            let main_entry = extension_manifest
                .as_ref()
                .and_then(|manifest| manifest["main"].as_str())
                .unwrap_or("index.js");
            let url = extension_dir.join(main_entry).to_string_lossy().to_string();

            let new_extension = serde_json::json!({
                "url": url,
                "name": extension_name.clone(),
                "origin": extension_dir.to_string_lossy(),
                "active": true,
                "description": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["description"].as_str())
                    .unwrap_or(""),
                "version": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["version"].as_str())
                    .unwrap_or(""),
            });

            extensions_list.push(new_extension);

            println!("Installed extension to {:?}", extension_dir);
        }
    }
    fs::write(
        &extensions_json_path,
        serde_json::to_string_pretty(&extensions_list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
