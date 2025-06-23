mod core;
use core::{
    cmd::get_jan_data_folder_path,
    setup::{self, setup_mcp},
    state::{generate_app_token, AppState},
    utils::download::DownloadManagerState,
};
use reqwest::Client;
use std::{collections::HashMap, sync::Arc};
use tauri::{Emitter, Manager};

use tokio::sync::Mutex;

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
            // generic utils
            core::utils::write_yaml,
            core::utils::read_yaml,
            core::utils::decompress,
            core::utils::is_library_available,
            // Download
            core::utils::download::download_files,
            core::utils::download::cancel_download_task,
            // hardware
            core::hardware::get_system_info,
            core::hardware::get_system_usage,
            // llama-cpp extension
            core::utils::extensions::inference_llamacpp_extension::server::load_llama_model,
            core::utils::extensions::inference_llamacpp_extension::server::unload_llama_model,
            core::utils::extensions::inference_llamacpp_extension::server::generate_api_key,
        ])
        .manage(AppState {
            app_token: Some(generate_app_token()),
            mcp_servers: Arc::new(Mutex::new(HashMap::new())),
            download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
            mcp_restart_counts: Arc::new(Mutex::new(HashMap::new())),
            mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
            mcp_successfully_connected: Arc::new(Mutex::new(HashMap::new())),
            server_handle: Arc::new(Mutex::new(None)),
            llama_server_process: Arc::new(Mutex::new(HashMap::new())),
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
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                if window.label() == "main" {
                    window.emit("kill-mcp-servers", ()).unwrap();
                    let state = window.app_handle().state::<AppState>();

                    tauri::async_runtime::block_on(async {
                        let mut map = state.llama_server_process.lock().await;
                        let pids: Vec<String> = map.keys().cloned().collect();
                        for pid in pids {
                            if let Some(mut child) = map.remove(&pid) {
                                #[cfg(unix)]
                                {
                                    use nix::sys::signal::{kill, Signal};
                                    use nix::unistd::Pid;
                                    use tokio::time::{timeout, Duration};

                                    if let Some(raw_pid) = child.id() {
                                        let raw_pid = raw_pid as i32;
                                        log::info!(
                                            "Sending SIGTERM to PID {} during shutdown",
                                            raw_pid
                                        );
                                        let _ = kill(Pid::from_raw(raw_pid), Signal::SIGTERM);

                                        match timeout(Duration::from_secs(2), child.wait()).await {
                                            Ok(Ok(status)) => log::info!(
                                                "Process {} exited gracefully: {}",
                                                raw_pid,
                                                status
                                            ),
                                            Ok(Err(e)) => log::error!(
                                                "Error waiting after SIGTERM for {}: {}",
                                                raw_pid,
                                                e
                                            ),
                                            Err(_) => {
                                                log::warn!(
                                                    "SIGTERM timed out for PID {}; sending SIGKILL",
                                                    raw_pid
                                                );
                                                let _ =
                                                    kill(Pid::from_raw(raw_pid), Signal::SIGKILL);
                                                let _ = child.wait().await;
                                            }
                                        }
                                    }
                                }

                                #[cfg(windows)]
                                {
                                    use tokio::time::{timeout, Duration};
                                    use windows_sys::Win32::Foundation::BOOL;
                                    use windows_sys::Win32::System::Console::{
                                        GenerateConsoleCtrlEvent, CTRL_C_EVENT,
                                    };

                                    if let Some(raw_pid) = child.id() {
                                        log::info!(
                                            "Sending Ctrl-C to PID {} during shutdown",
                                            raw_pid
                                        );
                                        let ok: BOOL = unsafe {
                                            GenerateConsoleCtrlEvent(CTRL_C_EVENT, raw_pid)
                                        };
                                        if ok == 0 {
                                            log::error!("Failed to send Ctrl-C to PID {}", raw_pid);
                                        }

                                        match timeout(Duration::from_secs(2), child.wait()).await {
                                            Ok(Ok(status)) => log::info!(
                                                "Process {} exited after Ctrl-C: {}",
                                                raw_pid,
                                                status
                                            ),
                                            Ok(Err(e)) => log::error!(
                                                "Error waiting after Ctrl-C for {}: {}",
                                                raw_pid,
                                                e
                                            ),
                                            Err(_) => {
                                                log::warn!(
                                                    "Timed out for PID {}; force-killing",
                                                    raw_pid
                                                );
                                                let _ = child.kill().await;
                                                let _ = child.wait().await;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
                let client = Client::new();
                let url = "http://127.0.0.1:39291/processManager/destroy";
                let _ = client.delete(url).send();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
