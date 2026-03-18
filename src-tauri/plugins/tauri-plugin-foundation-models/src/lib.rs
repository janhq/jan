use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod cleanup;
mod commands;
mod error;
mod process;
pub mod state;

pub use cleanup::cleanup_processes;
pub use state::FoundationModelsState;

/// Initializes the Foundation Models plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("foundation-models")
        .invoke_handler(tauri::generate_handler![
            cleanup::cleanup_foundation_models_processes,
            commands::load_foundation_models_server,
            commands::unload_foundation_models_server,
            commands::is_foundation_models_process_running,
            commands::get_foundation_models_random_port,
            commands::find_foundation_models_session,
            commands::get_foundation_models_loaded,
            commands::get_foundation_models_all_sessions,
            commands::check_foundation_models_availability,
        ])
        .setup(|app, _api| {
            app.manage(state::FoundationModelsState::new());
            Ok(())
        })
        .build()
}
