use tauri_plugin::Builder;

fn main() {
    Builder::new(&["get_system_info", "get_system_usage"]).build();
}