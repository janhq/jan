use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod cleanup;
mod commands;
mod device;
mod error;
mod gguf;
mod path;
mod process;
pub mod state;
pub use cleanup::cleanup_llama_processes;
pub use state::LLamaBackendSession;

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("llamacpp")
        .invoke_handler(tauri::generate_handler![
            // Cleanup command
            cleanup::cleanup_llama_processes,
            // LlamaCpp server commands
            commands::load_llama_model,
            commands::unload_llama_model,
            commands::get_devices,
            commands::generate_api_key,
            commands::is_process_running,
            commands::get_random_port,
            commands::find_session_by_model,
            commands::get_loaded_models,
            commands::get_all_sessions,
            commands::get_session_by_model,
            // GGUF commands
            gguf::commands::read_gguf_metadata,
        ])
        .setup(|app, _api| {
            // Initialize and manage the plugin state
            app.manage(state::LlamacppState::new());
            Ok(())
        })
        .build()
}
