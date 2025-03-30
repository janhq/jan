mod core;
use core::{
    cmd::get_jan_data_folder_path,
    mcp::run_mcp_commands,
    setup::{self, setup_engine_binaries, setup_sidecar},
    state::{generate_app_token, AppState},
};
use std::{collections::HashMap, sync::Arc};

use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // FS commands - Deperecate soon
            core::fs::join_path,
            core::fs::mkdir,
            core::fs::exists_sync,
            core::fs::readdir_sync,
            core::fs::read_file_sync,
            core::fs::rm,
            // App commands
            core::cmd::get_themes,
            core::cmd::get_app_configurations,
            core::cmd::get_active_extensions,
            core::cmd::get_user_home_path,
            core::cmd::update_app_configuration,
            core::cmd::get_jan_data_folder_path,
            core::cmd::get_jan_extensions_path,
            core::cmd::relaunch,
            core::cmd::open_app_directory,
            core::cmd::open_file_explorer,
            core::cmd::install_extensions,
            core::cmd::read_theme,
            core::cmd::app_token,
            core::cmd::start_server,
            core::cmd::stop_server,
            // MCP commands
            core::cmd::get_tools,
            core::cmd::call_tool
        ])
        .manage(AppState {
            app_token: Some(generate_app_token()),
            mcp_servers: Arc::new(Mutex::new(HashMap::new())),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Install extensions
            if let Err(e) = setup::install_extensions(app.handle().clone(), false) {
                eprintln!("Failed to install extensions: {}", e);
            }

            let app_path = get_jan_data_folder_path(app.handle().clone());

            let state = app.state::<AppState>().inner();
            let app_path_str = app_path.to_str().unwrap().to_string();
            let servers = state.mcp_servers.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_mcp_commands(app_path_str, servers).await {
                    eprintln!("Failed to run mcp commands: {}", e);
                }
            });

            setup_sidecar(app).expect("Failed to setup sidecar");

            setup_engine_binaries(app).expect("Failed to setup engine binaries");

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested {  .. } => {
                window.emit("kill-sidecar", ()).unwrap();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
