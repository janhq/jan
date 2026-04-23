// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Exits early if invoked as the out-of-process lddtree helper.
    tauri_plugin_llamacpp::deps_analyzer::run_deps_analyzer_if_requested();

    let _ = fix_path_env::fix();
    app_lib::run();
}
