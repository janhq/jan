use std::fs;
use std::path::PathBuf;

mod handlers;

use crate::handlers::cmd;
use rand::{distributions::Alphanumeric, Rng};
use tauri::{command, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

struct AppState {
    app_token: Option<String>,
}

#[command]
fn app_token(state: State<'_, AppState>) -> Option<String> {
    // state.app_token.clone()
    None
}

fn generate_app_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn copy_dir_all(src: PathBuf, dst: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    println!("Copying from {:?} to {:?}", src, dst);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            handlers::fs::join_path,
            handlers::fs::mkdir,
            handlers::fs::exists_sync,
            handlers::fs::readdir_sync,
            handlers::fs::read_file_sync,
            handlers::fs::rm,
            // App commands
            handlers::cmd::get_themes,
            handlers::cmd::get_app_configurations,
            handlers::cmd::get_active_extensions,
            handlers::cmd::get_user_home_path,
            handlers::cmd::update_app_configuration,
            handlers::cmd::get_jan_data_folder_path,
            handlers::cmd::get_jan_extensions_path,
            handlers::cmd::relaunch,
            app_token,
        ])
        .manage(AppState {
            app_token: Some(generate_app_token()),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Setup sidecar
            let sidecar_command = app.shell().sidecar("cortex-server").unwrap().args([
                "--start-server",
                "--port",
                "39291",
                "--config_file_path",
                app.app_handle()
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .join(".janrc")
                    .to_str()
                    .unwrap(),
                "--data_folder_path",
                app.app_handle()
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .to_str()
                    .unwrap(),
                // "config",
                // "--api_keys",
                
            ]);
            let (mut rx, mut _child) = sidecar_command.spawn().expect("Failed to spawn sidecar");
            tauri::async_runtime::spawn(async move {
                // read events such as stdout
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line_bytes) = event {
                        let line = String::from_utf8_lossy(&line_bytes);
                        println!("Outputs: {:?}", line)
                    }
                }
            });

            // Install extensions
            if let Err(e) = cmd::install_extensions(app.handle().clone()) {
                eprintln!("Failed to install extensions: {}", e);
            }

            // Copy engine binaries to app_data
            let app_data_dir = app.app_handle().path().app_data_dir().unwrap();
            let binaries_dir = app.app_handle().path().resource_dir().unwrap().join("binaries");
            let themes_dir = app.app_handle().path().resource_dir().unwrap().join("resources");

            if let Err(e) = copy_dir_all(binaries_dir, app_data_dir.clone()) {
                eprintln!("Failed to copy binaries: {}", e);
            }
            if let Err(e) = copy_dir_all(themes_dir, app_data_dir.clone()) {
                eprintln!("Failed to copy themes: {}", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
