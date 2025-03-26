mod core;
use core::setup::{self, setup_engine_binaries, setup_sidecar};

use rand::{distributions::Alphanumeric, Rng};
use tauri::{command, State};

struct AppState {
    app_token: Option<String>,
}

#[command]
fn app_token(state: State<'_, AppState>) -> Option<String> {
    state.app_token.clone()
}

fn generate_app_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
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

            // Install extensions
            if let Err(e) = setup::install_extensions(app.handle().clone()) {
                eprintln!("Failed to install extensions: {}", e);
            }

            setup_sidecar(app).expect("Failed to setup sidecar");

            setup_engine_binaries(app).expect("Failed to setup engine binaries");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
