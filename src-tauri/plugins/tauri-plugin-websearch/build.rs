const COMMANDS: &[&str] = &["web_search", "web_fetch"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
