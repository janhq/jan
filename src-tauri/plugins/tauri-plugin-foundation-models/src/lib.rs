use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod cleanup;
mod commands;
mod error;
pub mod state;

pub use cleanup::cleanup_processes;
pub use state::FoundationModelsState;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("foundation-models")
        .invoke_handler(tauri::generate_handler![
            cleanup::cleanup_foundation_models_processes,
            commands::check_foundation_models_availability,
            commands::load_foundation_models,
            commands::unload_foundation_models,
            commands::is_foundation_models_loaded,
            commands::foundation_models_chat_completion,
            commands::foundation_models_chat_completion_stream,
            commands::abort_foundation_models_stream,
        ])
        .setup(|app, _api| {
            app.manage(state::FoundationModelsState::new());
            Ok(())
        })
        .build()
}
