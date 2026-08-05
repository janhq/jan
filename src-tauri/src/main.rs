// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix PATH before anything that may spawn subprocesses, so the lddtree
    // helper (and any other child) inherits directories added by fix_path_env.
    let _ = fix_path_env::fix();

    // Exits early if invoked as the out-of-process lddtree helper.
    tauri_plugin_llamacpp::deps_analyzer::run_deps_analyzer_if_requested();

    // Exits early if invoked as the out-of-process backend load probe.
    tauri_plugin_llamacpp::load_probe::run_load_probe_if_requested();

    app_lib::run();
}
