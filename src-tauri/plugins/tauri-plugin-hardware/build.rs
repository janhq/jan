const COMMANDS: &[&str] = &[
    "get_system_info",
    "get_system_usage",
    // Wired in `lib.rs::init` but was missing from this list, so
    // `tauri_plugin::Builder` never generated the autogen permission TOML
    // for it and the frontend invocation failed with
    // "Command plugin:hardware:refresh_system_info not allowed by ACL".
    // See the 2026-05-27 ADR (Atomic-Chat#TBD).
    "refresh_system_info",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
