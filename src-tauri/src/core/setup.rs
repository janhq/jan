use flate2::read::GzDecoder;
use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
};
use tar::Archive;
use tauri::{App, Emitter, Manager};
use tauri_plugin_store::StoreExt;
// use tokio::sync::Mutex;
// use tokio::time::{sleep, Duration}; // Using tokio::sync::Mutex
//                                     // MCP

// MCP
use super::{
    app::commands::get_jan_data_folder_path, extensions::commands::get_jan_extensions_path,
    mcp::helpers::run_mcp_commands, state::AppState,
};

pub fn install_extensions(app: tauri::AppHandle, force: bool) -> Result<(), String> {
    let mut store_path = get_jan_data_folder_path(app.clone());
    store_path.push("store.json");
    let store = app.store(store_path).expect("Store not initialized");
    let stored_version = store
        .get("version")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let app_version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "".to_string());

    let extensions_path = get_jan_extensions_path(app.clone());
    let pre_install_path = app
        .path()
        .resource_dir()
        .unwrap()
        .join("resources")
        .join("pre-install");

    let mut clean_up = force;

    // Check IS_CLEAN environment variable to optionally skip extension install
    if std::env::var("IS_CLEAN").is_ok() {
        clean_up = true;
    }
    log::info!(
        "Installing extensions. Clean up: {}, Stored version: {}, App version: {}",
        clean_up,
        stored_version,
        app_version
    );
    if !clean_up && stored_version == app_version && extensions_path.exists() {
        return Ok(());
    }

    // Attempt to remove extensions folder
    if extensions_path.exists() {
        fs::remove_dir_all(&extensions_path).unwrap_or_else(|_| {
            log::info!("Failed to remove existing extensions folder, it may not exist.");
        });
    }

    // Attempt to create it again
    if !extensions_path.exists() {
        fs::create_dir_all(&extensions_path).map_err(|e| e.to_string())?;
    }

    let extensions_json_path = extensions_path.join("extensions.json");
    let mut extensions_list = if extensions_json_path.exists() {
        let existing_data =
            fs::read_to_string(&extensions_json_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str::<Vec<serde_json::Value>>(&existing_data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };

    for entry in fs::read_dir(&pre_install_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "tgz") {
            log::info!("Installing extension from {:?}", path);
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
                "productName": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["productName"].as_str())
                    .unwrap_or(""),
            });

            extensions_list.push(new_extension);

            log::info!("Installed extension to {:?}", extension_dir);
        }
    }
    fs::write(
        &extensions_json_path,
        serde_json::to_string_pretty(&extensions_list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // Store the new app version
    store.set("version", serde_json::json!(app_version));
    store.save().expect("Failed to save store");

    Ok(())
}

pub fn extract_extension_manifest<R: Read>(
    archive: &mut Archive<R>,
) -> Result<Option<serde_json::Value>, String> {
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

        let package_json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(Some(package_json));
    }

    Ok(None)
}

pub fn setup_mcp(app: &App) {
    let state = app.state::<AppState>();
    let servers = state.mcp_servers.clone();
    let app_handle: tauri::AppHandle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_mcp_commands(&app_handle, servers).await {
            log::error!("Failed to run mcp commands: {}", e);
        }
        app_handle
            .emit("mcp-update", "MCP servers updated")
            .unwrap();
    });
}
