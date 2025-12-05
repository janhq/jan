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
    "get_shortest_path",
    // GGUF commands
    "read_gguf_metadata",
    "estimate_kv_cache_size",
    "get_model_size",
    "is_model_supported",
    "plan_model_load"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
