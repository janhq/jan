const COMMANDS: &[&str] = &["get_system_info", "get_system_usage", "refresh_system_info"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
