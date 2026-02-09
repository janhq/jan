use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod args;
mod backend;
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
            gguf::commands::estimate_kv_cache_size,
            gguf::commands::get_model_size,
            gguf::commands::is_model_supported,
            // Backend management
            backend::map_old_backend_to_new,
            backend::get_local_installed_backends,
            backend::list_supported_backends,
            backend::determine_supported_backends,
            backend::get_supported_features,
            backend::is_cuda_installed,
            backend::find_latest_version_for_backend,
            backend::prioritize_backends,
            backend::parse_backend_version,
            backend::check_backend_for_updates,
            backend::remove_old_backend_versions,
            backend::validate_backend_string,
            backend::should_migrate_backend,
            backend::handle_setting_update
        ])
        .setup(|app, _api| {
            // Initialize and manage the plugin state
            app.manage(state::LlamacppState::new());
            Ok(())
        })
        .build()
}
