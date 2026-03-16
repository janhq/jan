const COMMANDS: &[&str] = &[
    "cleanup_foundation_models_processes",
    "load_foundation_models_server",
    "unload_foundation_models_server",
    "is_foundation_models_process_running",
    "get_foundation_models_random_port",
    "find_foundation_models_session",
    "get_foundation_models_loaded",
    "get_foundation_models_all_sessions",
    "check_foundation_models_availability",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
