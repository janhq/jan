mod core;
use core::{
    cmd::get_jan_data_folder_path,
    setup::{self, setup_engine_binaries, setup_mcp, setup_sidecar},
    state::{generate_app_token, AppState},
    utils::download::DownloadManagerState,
};
use std::{collections::HashMap, sync::Arc};

use tauri::Emitter;
use tokio::sync::Mutex;

use crate::core::setup::clean_up;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
          println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
          // when defining deep link schemes at runtime, you must also check `argv` here
        }));
    }
    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // FS commands - Deperecate soon
            core::fs::join_path,
            core::fs::mkdir,
            core::fs::exists_sync,
            core::fs::readdir_sync,
            core::fs::read_file_sync,
            core::fs::rm,
            core::fs::file_stat,
            core::fs::write_file_sync,
            // App commands
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
            core::cmd::app_token,
            core::cmd::start_server,
            core::cmd::stop_server,
            core::cmd::get_server_status,
            core::cmd::read_logs,
            core::cmd::change_app_data_folder,
            core::cmd::change_app_data_folder_with_validation,
            core::cmd::validate_factory_reset_folder,
            core::cmd::validate_folder_change,
            core::cmd::reset_cortex_restart_count,
            // MCP commands
            core::mcp::get_tools,
            core::mcp::call_tool,
            core::mcp::restart_mcp_servers,
            core::mcp::get_connected_servers,
            core::mcp::save_mcp_configs,
            core::mcp::get_mcp_configs,
            core::mcp::activate_mcp_server,
            core::mcp::deactivate_mcp_server,
            core::mcp::reset_mcp_restart_count,
            // Threads
            core::threads::list_threads,
            core::threads::create_thread,
            core::threads::modify_thread,
            core::threads::delete_thread,
            core::threads::list_messages,
            core::threads::create_message,
            core::threads::modify_message,
            core::threads::delete_message,
            core::threads::get_thread_assistant,
            core::threads::create_thread_assistant,
            core::threads::modify_thread_assistant,
            // Download
            core::utils::download::download_files,
            core::utils::download::cancel_download_task,
            // hardware
            core::hardware::get_system_info,
            core::hardware::get_system_usage,
        ])
        .manage(AppState {
            app_token: Some(generate_app_token()),
            mcp_servers: Arc::new(Mutex::new(HashMap::new())),
            download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
            cortex_restart_count: Arc::new(Mutex::new(0)),
            cortex_killed_intentionally: Arc::new(Mutex::new(false)),
            mcp_restart_counts: Arc::new(Mutex::new(HashMap::new())),
            mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
            mcp_successfully_connected: Arc::new(Mutex::new(HashMap::new())),
            server_handle: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Debug)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                            path: get_jan_data_folder_path(app.handle().clone()).join("logs"),
                            file_name: Some("app".to_string()),
                        }),
                    ])
                    .build(),
            )?;
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            // Install extensions
            if let Err(e) = setup::install_extensions(app.handle().clone(), false) {
                log::error!("Failed to install extensions: {}", e);
            }
            setup_mcp(app);
            setup_sidecar(app).expect("Failed to setup sidecar");
            setup_engine_binaries(app).expect("Failed to setup engine binaries");
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                if window.label() == "main" {
                    window.emit("kill-sidecar", ()).unwrap();
                    window.emit("kill-mcp-servers", ()).unwrap();
                    clean_up();
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
