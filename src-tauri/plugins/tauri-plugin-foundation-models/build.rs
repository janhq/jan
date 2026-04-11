const COMMANDS: &[&str] = &[
    "cleanup_foundation_models_processes",
    "check_foundation_models_availability",
    "load_foundation_models",
    "unload_foundation_models",
    "is_foundation_models_loaded",
    "foundation_models_chat_completion",
    "foundation_models_chat_completion_stream",
    "abort_foundation_models_stream",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
