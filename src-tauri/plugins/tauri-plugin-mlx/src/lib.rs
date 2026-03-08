use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod cleanup;
mod commands;
mod error;
mod process;
pub mod state;

pub use cleanup::cleanup_mlx_processes;
pub use commands::{load_mlx_model_impl, MlxConfig};
pub use state::MlxState;

/// Initializes the MLX plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mlx")
        .invoke_handler(tauri::generate_handler![
            cleanup::cleanup_mlx_processes,
            commands::load_mlx_model,
            commands::unload_mlx_model,
            commands::is_mlx_process_running,
            commands::get_mlx_random_port,
            commands::find_mlx_session_by_model,
            commands::get_mlx_loaded_models,
            commands::get_mlx_all_sessions,
        ])
        .setup(|app, _api| {
            app.manage(state::MlxState::new());
            Ok(())
        })
        .build()
}
