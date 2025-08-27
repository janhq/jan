const COMMANDS: &[&str] = &["get_system_info", "get_system_usage"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
