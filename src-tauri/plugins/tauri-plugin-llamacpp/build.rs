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
    "estimate_kv_cache_size",
    "get_model_size",
    "is_model_supported",
    "plan_model_load",
    // backend management
    "map_old_backend_to_new",
    "get_local_installed_backends",
    "list_supported_backends",
    "determine_supported_backends",
    "get_supported_features",
    "is_cuda_installed",
    "find_latest_version_for_backend",
    "prioritize_backends",
    "parse_backend_version",
    "check_backend_for_updates",
    "remove_old_backend_versions",
    "validate_backend_string",
    "should_migrate_backend",
    "handle_setting_update",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
