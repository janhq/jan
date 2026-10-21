const COMMANDS: &[&str] = &[
    "cleanup_local_engine_processes",
    "load_local_model",
    "unload_local_model",
    "is_local_engine_process_running",
    "get_local_engine_random_port",
    "find_local_session_by_model",
    "get_local_loaded_models",
    "get_local_all_sessions",
    "check_local_engine",
    "install_local_engine_runtime",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
