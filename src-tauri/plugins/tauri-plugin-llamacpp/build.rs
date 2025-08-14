const COMMANDS: &[&str] = &[
    // Cleanup command
    "cleanup_llama_processes",
    // LlamaCpp server commands
    "load_llama_model",
    "unload_llama_model",
    "get_devices",
    "generate_api_key",
    "is_process_running",
    "get_random_port",
    "find_session_by_model",
    "get_loaded_models",
    "get_all_sessions",
    "get_session_by_model",
    // GGUF commands
    "read_gguf_metadata",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
