pub mod core;

#[cfg(not(feature = "cli"))]
use core::{
    app::commands::get_jan_data_folder_path,
    downloads::models::DownloadManagerState,
    mcp::models::McpSettings,
    setup::{self, setup_mcp},
    state::AppState,
};
#[cfg(not(feature = "cli"))]
use jan_utils::generate_app_token;
#[cfg(not(feature = "cli"))]
use std::{collections::HashMap, sync::Arc};
#[cfg(not(feature = "cli"))]
use tauri::{Emitter, Manager, RunEvent};
#[cfg(not(feature = "cli"))]
use tauri_plugin_store::StoreExt;
#[cfg(not(feature = "cli"))]
use tokio::sync::Mutex;

#[cfg(not(feature = "cli"))]
#[cfg_attr(
    all(mobile, any(target_os = "android", target_os = "ios")),
    tauri::mobile_entry_point
)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
          println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
          // when defining deep link schemes at runtime, you must also check `argv` here
        }));
    }

    let mut app_builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_llamacpp::init())
        .plugin(tauri_plugin_vector_db::init())
        .plugin(tauri_plugin_rag::init());

    #[cfg(feature = "deep-link")]
    {
        app_builder = app_builder.plugin(tauri_plugin_deep_link::init());
    }

    #[cfg(feature = "mlx")]
    {
        app_builder = app_builder.plugin(tauri_plugin_mlx::init());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        app_builder = app_builder.plugin(tauri_plugin_hardware::init());
    }

    // Desktop: include updater commands
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let app_builder = app_builder.invoke_handler(tauri::generate_handler![
        // FS commands - Deperecate soon
        core::filesystem::commands::join_path,
        core::filesystem::commands::mkdir,
        core::filesystem::commands::exists_sync,
        core::filesystem::commands::readdir_sync,
        core::filesystem::commands::read_file_sync,
        core::filesystem::commands::rm,
        core::filesystem::commands::mv,
        core::filesystem::commands::file_stat,
        core::filesystem::commands::write_file_sync,
        core::filesystem::commands::write_yaml,
        core::filesystem::commands::read_yaml,
        core::filesystem::commands::decompress,
        core::filesystem::commands::open_dialog,
        core::filesystem::commands::save_dialog,
        // App configuration commands
        core::app::commands::get_app_configurations,
        core::app::commands::get_user_home_path,
        core::app::commands::update_app_configuration,
        core::app::commands::get_jan_data_folder_path,
        core::app::commands::get_configuration_file_path,
        core::app::commands::default_data_folder_path,
        core::app::commands::change_app_data_folder,
        core::app::commands::app_token,
        // Extension commands
        core::extensions::commands::get_jan_extensions_path,
        core::extensions::commands::install_extensions,
        core::extensions::commands::get_active_extensions,
        // System commands
        core::system::commands::relaunch,
        core::system::commands::open_app_directory,
        core::system::commands::open_file_explorer,
        core::system::commands::factory_reset,
        core::system::commands::read_logs,
        core::system::commands::is_library_available,
        core::system::commands::launch_claude_code_with_config,
        // Server commands
        core::server::commands::start_server,
        core::server::commands::stop_server,
        core::server::commands::get_server_status,
        // Remote provider commands
        core::server::remote_provider_commands::register_provider_config,
        core::server::remote_provider_commands::unregister_provider_config,
        core::server::remote_provider_commands::get_provider_config,
        core::server::remote_provider_commands::list_provider_configs,
        // MCP commands
        core::mcp::commands::get_tools,
        core::mcp::commands::call_tool,
        core::mcp::commands::cancel_tool_call,
        core::mcp::commands::restart_mcp_servers,
        core::mcp::commands::get_connected_servers,
        core::mcp::commands::save_mcp_configs,
        core::mcp::commands::get_mcp_configs,
        core::mcp::commands::activate_mcp_server,
        core::mcp::commands::deactivate_mcp_server,
        core::mcp::commands::check_jan_browser_extension_connected,
        // Threads
        core::threads::commands::list_threads,
        core::threads::commands::create_thread,
        core::threads::commands::modify_thread,
        core::threads::commands::delete_thread,
        core::threads::commands::list_messages,
        core::threads::commands::create_message,
        core::threads::commands::modify_message,
        core::threads::commands::delete_message,
        core::threads::commands::get_thread_assistant,
        core::threads::commands::create_thread_assistant,
        core::threads::commands::modify_thread_assistant,
        // Download
        core::downloads::commands::download_files,
        core::downloads::commands::cancel_download_task,
        // Custom updater commands (desktop only)
        core::updater::commands::check_for_app_updates,
        core::updater::commands::is_update_available,
    ]);

    // Mobile: no updater commands
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let app_builder = app_builder.invoke_handler(tauri::generate_handler![
        // FS commands - Deperecate soon
        core::filesystem::commands::join_path,
        core::filesystem::commands::mkdir,
        core::filesystem::commands::exists_sync,
        core::filesystem::commands::readdir_sync,
        core::filesystem::commands::read_file_sync,
        core::filesystem::commands::rm,
        core::filesystem::commands::mv,
        core::filesystem::commands::file_stat,
        core::filesystem::commands::write_file_sync,
        core::filesystem::commands::write_yaml,
        core::filesystem::commands::read_yaml,
        core::filesystem::commands::decompress,
        core::filesystem::commands::open_dialog,
        core::filesystem::commands::save_dialog,
        // App configuration commands
        core::app::commands::get_app_configurations,
        core::app::commands::get_user_home_path,
        core::app::commands::update_app_configuration,
        core::app::commands::get_jan_data_folder_path,
        core::app::commands::get_configuration_file_path,
        core::app::commands::default_data_folder_path,
        core::app::commands::change_app_data_folder,
        core::app::commands::app_token,
        // Extension commands
        core::extensions::commands::get_jan_extensions_path,
        core::extensions::commands::install_extensions,
        core::extensions::commands::get_active_extensions,
        // System commands
        core::system::commands::relaunch,
        core::system::commands::open_app_directory,
        core::system::commands::open_file_explorer,
        core::system::commands::factory_reset,
        core::system::commands::read_logs,
        core::system::commands::is_library_available,
        core::system::commands::launch_claude_code_with_config,
        // Server commands
        core::server::commands::start_server,
        core::server::commands::stop_server,
        core::server::commands::get_server_status,
        // Remote provider commands
        core::server::remote_provider_commands::register_provider_config,
        core::server::remote_provider_commands::unregister_provider_config,
        core::server::remote_provider_commands::get_provider_config,
        core::server::remote_provider_commands::list_provider_configs,
        core::server::remote_provider_commands::abort_remote_stream,
        // MCP commands
        core::mcp::commands::get_tools,
        core::mcp::commands::call_tool,
        core::mcp::commands::cancel_tool_call,
        core::mcp::commands::restart_mcp_servers,
        core::mcp::commands::get_connected_servers,
        core::mcp::commands::save_mcp_configs,
        core::mcp::commands::get_mcp_configs,
        core::mcp::commands::activate_mcp_server,
        core::mcp::commands::deactivate_mcp_server,
        core::mcp::commands::check_jan_browser_extension_connected,
        // Threads
        core::threads::commands::list_threads,
        core::threads::commands::create_thread,
        core::threads::commands::modify_thread,
        core::threads::commands::delete_thread,
        core::threads::commands::list_messages,
        core::threads::commands::create_message,
        core::threads::commands::modify_message,
        core::threads::commands::delete_message,
        core::threads::commands::get_thread_assistant,
        core::threads::commands::create_thread_assistant,
        core::threads::commands::modify_thread_assistant,
        // Download
        core::downloads::commands::download_files,
        core::downloads::commands::cancel_download_task,
    ]);

    let app = app_builder
        .manage(AppState {
            app_token: Some(generate_app_token()),
            mcp_servers: Arc::new(Mutex::new(HashMap::new())),
            download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
            mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
            server_handle: Arc::new(Mutex::new(None)),
            tool_call_cancellations: Arc::new(Mutex::new(HashMap::new())),
            mcp_settings: Arc::new(Mutex::new(McpSettings::default())),
            mcp_shutdown_in_progress: Arc::new(Mutex::new(false)),
            mcp_monitoring_tasks: Arc::new(Mutex::new(HashMap::new())),
            background_cleanup_handle: Arc::new(Mutex::new(None)),
            mcp_server_pids: Arc::new(Mutex::new(HashMap::new())),
            provider_configs: Arc::new(Mutex::new(HashMap::new())),
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
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Start migration
            let mut store_path = get_jan_data_folder_path(app.handle().clone());
            store_path.push("store.json");
            let store = app
                .handle()
                .store(store_path)
                .expect("Store not initialized");
            let stored_version = store
                .get("version")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let app_version = app.config().version.clone().unwrap_or_default();
            // Migrate extensions
            if let Err(e) =
                setup::install_extensions(app.handle().clone(), stored_version != app_version)
            {
                log::error!("Failed to install extensions: {e}");
            }

            // Migrate MCP servers
            if let Err(e) = setup::migrate_mcp_servers(app.handle().clone(), store.clone()) {
                log::error!("Failed to migrate MCP servers: {e}");
            }

            // Store the new app version
            store.set("version", serde_json::json!(app_version));
            store.save().expect("Failed to save store");
            // Migration completed

            #[cfg(desktop)]
            if option_env!("ENABLE_SYSTEM_TRAY_ICON").unwrap_or("false") == "true" {
                log::info!("Enabling system tray icon");
                let _ = setup::setup_tray(app);
            }

            #[cfg(all(feature = "deep-link", any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            // Initialize SQLite database for mobile platforms
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = crate::core::threads::db::init_database(&app_handle).await {
                        log::error!("Failed to initialize mobile database: {}", e);
                    }
                });
            }

            setup_mcp(app);
            setup::setup_theme_listener(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    // Handle app lifecycle events
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let app_handle = app.clone();

            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("app-shutting-down", ());
                    let _ = window.hide();
                }
            }

            let state = app_handle.state::<AppState>();

            // Check if cleanup already ran
            let cleanup_already_running = tokio::task::block_in_place(|| {
                tauri::async_runtime::block_on(async {
                    let handle = state.background_cleanup_handle.lock().await;
                    handle.is_some()
                })
            });

            if cleanup_already_running {
                return;
            }

            // Run cleanup synchronously and WAIT for it to complete
            tokio::task::block_in_place(|| {
                tauri::async_runtime::block_on(async {
                    use crate::core::mcp::helpers::background_cleanup_mcp_servers;
                    use tauri_plugin_llamacpp::cleanup_llama_processes;

                    let state = app_handle.state::<AppState>();

                    // Increase timeout to 10 seconds and log if it times out
                    let cleanup_future = background_cleanup_mcp_servers(&app_handle, &state);
                    match tokio::time::timeout(tokio::time::Duration::from_secs(10), cleanup_future)
                        .await
                    {
                        Ok(_) => log::info!("MCP cleanup completed successfully"),
                        Err(_) => log::warn!("MCP cleanup timed out after 10 seconds"),
                    }

                    if let Err(e) = cleanup_llama_processes(app_handle.clone()).await {
                        log::warn!("Failed to cleanup llama processes: {}", e);
                    } else {
                        log::info!("Llama processes cleaned up successfully");
                    }

                    #[cfg(feature = "mlx")]
                    {
                        use tauri_plugin_mlx::cleanup_mlx_processes;
                        if let Err(e) = cleanup_mlx_processes(app_handle.clone()).await {
                            log::warn!("Failed to cleanup MLX processes: {}", e);
                        } else {
                            log::info!("MLX processes cleaned up successfully");
                        }
                    }

                    log::info!("App cleanup completed");
                });
            });
        }
    });
}
