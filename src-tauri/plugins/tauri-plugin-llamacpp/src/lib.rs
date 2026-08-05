use std::sync::Arc;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod backend;
pub mod cleanup;
pub mod deps_analyzer;
mod commands;
mod device;
mod error;
mod gguf;
pub mod load_probe;
mod path;
mod process;
pub mod router;
pub mod state;
pub use cleanup::cleanup_llama_processes;
pub use commands::{force_kill_router_tree, stop_router, try_graceful_stop_router};
pub use state::LlamacppState;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("llamacpp")
        .invoke_handler(tauri::generate_handler![
            cleanup::cleanup_llama_processes,
            commands::load_llama_model,
            commands::unload_llama_model,
            commands::start_router,
            commands::stop_router,
            commands::try_graceful_stop_router,
            commands::force_kill_router_tree,
            commands::get_router_info,
            commands::reload_router_models,
            commands::router_slots_idle,
            commands::router_health,
            commands::adopt_router,
            backend::fetch_backend_checksums,
            backend::verify_file_sha512,
            commands::get_devices,
            commands::generate_api_key,
            commands::ensure_session_ready,
            commands::find_session_by_model,
            commands::get_loaded_models,
            gguf::commands::read_gguf_metadata,
            gguf::commands::estimate_kv_cache_size,
            gguf::commands::get_model_size,
            gguf::commands::is_model_supported,
            backend::map_old_backend_to_new,
            backend::get_local_installed_backends,
            backend::list_supported_backends,
            backend::determine_supported_backends,
            backend::get_supported_features,
            backend::is_cuda_installed,
            backend::find_latest_version_for_backend,
            backend::prioritize_backends,
            backend::parse_backend_version,
            backend::check_backend_for_updates,
            backend::remove_old_backend_versions,
            backend::validate_backend_string,
            backend::should_migrate_backend,
            backend::handle_setting_update,
            backend::get_backend_dir,
            backend::get_backend_exe_path,
            backend::check_backend_installed,
            backend::verify_backend_installation,
            load_probe::probe_backend_load,
            backend::fetch_remote_supported_backends,
            backend::build_backend_download_items
        ])
        .setup(|app, _api| {
            app.manage(Arc::new(state::LlamacppState::new()));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod permission_tests {
    /// A command reaches the frontend only if it is BOTH in `generate_handler!`
    /// and in `build.rs`'s `COMMANDS` (which generates its permission). Missing
    /// the latter compiles and tests clean, then fails at runtime with
    /// "not allowed. Command not found" -- invisible to any suite that mocks
    /// `invoke`. Keep the two lists in lockstep.
    fn names_between<'a>(src: &'a str, start: &str, end: &str) -> Vec<&'a str> {
        let body = src
            .split_once(start)
            .and_then(|(_, rest)| rest.split_once(end))
            .map(|(body, _)| body)
            .unwrap_or_else(|| panic!("could not locate {start} .. {end}"));
        body.lines()
            .map(|l| l.trim().trim_end_matches(',').trim_matches('"'))
            .filter(|l| !l.is_empty() && !l.starts_with("//") && !l.starts_with('#'))
            .map(|l| l.rsplit("::").next().unwrap_or(l))
            .collect()
    }

    #[test]
    fn every_registered_command_has_a_permission() {
        let handlers = names_between(
            include_str!("lib.rs"),
            "tauri::generate_handler![",
            "])",
        );
        let declared = names_between(include_str!("../build.rs"), "COMMANDS: &[&str] = &[", "];");

        let missing: Vec<_> = handlers
            .iter()
            .filter(|c| !declared.contains(c))
            .collect();
        assert!(
            missing.is_empty(),
            "commands registered but absent from build.rs COMMANDS (they will \
             fail at runtime as \"not allowed\"): {missing:?}"
        );
    }

    #[test]
    fn every_permission_is_in_the_default_set() {
        let declared = names_between(include_str!("../build.rs"), "COMMANDS: &[&str] = &[", "];");
        let default_toml = include_str!("../permissions/default.toml");

        let missing: Vec<_> = declared
            .iter()
            .filter(|c| {
                let permission = format!("allow-{}", c.replace('_', "-"));
                !default_toml.contains(&permission)
            })
            .collect();
        assert!(
            missing.is_empty(),
            "commands missing an allow-* entry in permissions/default.toml: {missing:?}"
        );
    }
}
