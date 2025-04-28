use flate2::read::GzDecoder;
use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tar::Archive;
use tauri::{App, Listener, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

// MCP
use super::{
    cmd::{get_jan_data_folder_path, get_jan_extensions_path},
    mcp::run_mcp_commands,
    state::AppState,
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

    if !force && stored_version == app_version {
        return Ok(());
    }
    let extensions_path = get_jan_extensions_path(app.clone());
    let pre_install_path = app
        .path()
        .resource_dir()
        .unwrap()
        .join("resources")
        .join("pre-install");

    // Attempt to remove extensions folder
    if extensions_path.exists() {
        fs::remove_dir_all(&extensions_path).unwrap_or_else(|_| {
            log::info!("Failed to remove existing extensions folder, it may not exist.");
        });
    }

    if !force {
        return Ok(());
    };

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

fn extract_extension_manifest<R: Read>(
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
    let app_path = get_jan_data_folder_path(app.handle().clone());

    let state = app.state::<AppState>().inner();
    let app_path_str = app_path.to_str().unwrap().to_string();
    let servers = state.mcp_servers.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_mcp_commands(app_path_str, servers).await {
            log::error!("Failed to run mcp commands: {}", e);
        }
    });
}

pub fn setup_sidecar(app: &App) -> Result<(), String> {
    // Setup sidecar

    let app_state = app.state::<AppState>();
    let app_data_dir = get_jan_data_folder_path(app.handle().clone());
    let mut sidecar_command = app.shell().sidecar("cortex-server").unwrap().args([
        "--start-server",
        "--port",
        "39291",
        "--config_file_path",
        app_data_dir.join(".janrc").to_str().unwrap(),
        "--data_folder_path",
        app_data_dir.to_str().unwrap(),
        "--cors",
        "ON",
        "--allowed_origins",
        // TODO(sang) '*' is only for testing purpose, will remove it later
        "http://localhost:3000,tauri://localhost,*",
        "config",
        "--api_keys",
        app_state.inner().app_token.as_deref().unwrap_or(""),
    ]);

    #[cfg(target_os = "windows")]
    {
        sidecar_command = sidecar_command.env("PATH", {
            let app_data_dir = app.app_handle().path().app_data_dir().unwrap();
            let dest = app_data_dir.to_str().unwrap();
            let path = std::env::var("PATH").unwrap_or_default();
            format!("{}{}{}", path, std::path::MAIN_SEPARATOR, dest)
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        sidecar_command = sidecar_command.env("LD_LIBRARY_PATH", {
            let app_data_dir = app.app_handle().path().app_data_dir().unwrap();
            let dest = app_data_dir.to_str().unwrap();
            let ld_library_path = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            format!("{}{}{}", ld_library_path, std::path::MAIN_SEPARATOR, dest)
        });
    }

    let (mut rx, _child) = sidecar_command.spawn().expect("Failed to spawn sidecar");
    let child = Arc::new(Mutex::new(Some(_child)));
    let child_clone = child.clone();

    tauri::async_runtime::spawn(async move {
        // read events such as stdout
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line_bytes) = event {
                let line = String::from_utf8_lossy(&line_bytes);
                log::info!("Outputs: {:?}", line)
            }
        }
    });

    app.handle().listen("kill-sidecar", move |_| {
        let mut child_guard = child_clone.lock().unwrap();
        if let Some(actual_child) = child_guard.take() {
            actual_child.kill().unwrap();
        }
    });
    Ok(())
}

fn copy_dir_all(src: PathBuf, dst: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    log::info!("Copying from {:?} to {:?}", src, dst);
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.join(entry.file_name())).map_err(|e| e.to_string())?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn setup_engine_binaries(app: &App) -> Result<(), String> {
    // Copy engine binaries to app_data
    let app_data_dir = get_jan_data_folder_path(app.handle().clone());
    let binaries_dir = app.handle().path().resource_dir().unwrap().join("binaries");
    let themes_dir = app
        .handle()
        .path()
        .resource_dir()
        .unwrap()
        .join("resources");

    if let Err(e) = copy_dir_all(binaries_dir, app_data_dir.clone()) {
        log::error!("Failed to copy binaries: {}", e);
    }
    if let Err(e) = copy_dir_all(themes_dir, app_data_dir.clone()) {
        log::error!("Failed to copy themes: {}", e);
    }
    Ok(())
}
