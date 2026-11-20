const COMMANDS: &[&str] = &[
    "stage_bundle",
    "confirm_install",
    "discard_stage",
    "list",
    "set_enabled",
    "set_grants",
    "uninstall",
    "rollback",
    "read_entry",
    "set_safe_mode",
    "http_fetch",
    "http_fetch_stream",
    "http_cancel",
    "list_sources",
    "add_source",
    "remove_source",
    "get_catalog",
    "accept_next_key",
    "stage_from_index",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
