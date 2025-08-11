use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod cleanup;
mod server;
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
            server::load_llama_model,
            server::unload_llama_model,
            server::get_devices,
            server::generate_api_key,
            server::is_process_running,
            server::get_random_port,
            server::find_session_by_model,
            server::get_loaded_models,
            server::get_all_sessions,
            server::get_session_by_model,
        ])
        .setup(|app, _api| {
            // Initialize and manage the plugin state
            app.manage(state::LlamacppState::new());
            Ok(())
        })
        .build()
}
