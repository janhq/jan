use std::sync::Arc;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod backend;
pub mod cleanup;
pub mod deps_analyzer;
mod commands;
mod device;
mod error;
mod gguf;
mod path;
mod process;
pub mod router;
pub mod state;
pub use cleanup::cleanup_llama_processes;
pub use commands::stop_router;
pub use state::LlamacppState;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("llamacpp")
        .invoke_handler(tauri::generate_handler![
            cleanup::cleanup_llama_processes,
            commands::load_llama_model,
            commands::unload_llama_model,
            commands::start_router,
            commands::stop_router,
            commands::get_router_info,
            commands::get_devices,
            commands::generate_api_key,
            commands::ensure_session_ready,
            commands::find_session_by_model,
            commands::get_loaded_models,
            gguf::commands::read_gguf_metadata,
            gguf::commands::estimate_kv_cache_size,
            gguf::commands::get_model_size,
            gguf::commands::is_model_supported,
            gguf::commands::score_hub_model,
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
            backend::handle_setting_update,
            backend::get_backend_dir,
            backend::get_backend_exe_path,
            backend::check_backend_installed,
            backend::verify_backend_installation,
            backend::fetch_remote_supported_backends,
            backend::build_backend_download_items
        ])
        .setup(|app, _api| {
            app.manage(Arc::new(state::LlamacppState::new()));
            Ok(())
        })
        .build()
}
