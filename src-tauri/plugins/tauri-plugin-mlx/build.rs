const COMMANDS: &[&str] = &[
    "cleanup_mlx_processes",
    "load_mlx_model",
    "unload_mlx_model",
    "is_mlx_process_running",
    "get_mlx_random_port",
    "find_mlx_session_by_model",
    "get_mlx_loaded_models",
    "get_mlx_all_sessions",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
