use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod commands;
pub mod error;
pub mod process;
pub mod state;

pub use commands::{
    check_local_engine, cleanup_local_engine_processes, find_local_session_by_model,
    get_local_all_sessions, get_local_engine_random_port, get_local_loaded_models,
    install_local_engine_runtime, is_local_engine_process_running, load_local_model,
    unload_local_model, EngineAvailability, UnloadResult,
};
pub use error::{EngineResult, LocalEngineError};
pub use process::LocalEngineConfig;
pub use state::{LocalEngineState, SessionInfo};

/// Initializes the local engine plugin.
///
/// The plugin manages the sidecar processes that host Jan's local CPU
/// inference engines (LiteRT-LM, OpenVINO) and exposes them over the OpenAI
/// chat-completions API.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("local-engine")
        .invoke_handler(tauri::generate_handler![
            cleanup_local_engine_processes,
            load_local_model,
            unload_local_model,
            is_local_engine_process_running,
            get_local_engine_random_port,
            find_local_session_by_model,
            get_local_loaded_models,
            get_local_all_sessions,
            check_local_engine,
            install_local_engine_runtime,
        ])
        .setup(|app, _api| {
            app.manage(state::LocalEngineState::new());
            Ok(())
        })
        .build()
}
