//! The built-in agent toolset, shared by the Jan desktop app and the headless
//! `jan` CLI.
//!
//! The toolset is Tauri-free: executing a tool needs nothing but
//! `(&BuiltinTool, &serde_json::Value, &ToolContext)`, never an `AppHandle`.
//! `tauri` is an optional dependency behind the `tauri` feature, so the CLI
//! builds this crate with `default-features = false` and links no GUI crates.
//! Everything under `permissions`, `skills`, `tools` and `workspace` is
//! available in both configurations; only `init()` and the IPC shims in
//! `commands` are gated.

pub mod memory;
pub mod permissions;
pub mod skills;
pub mod tools;
pub mod workspace;

#[cfg(feature = "tauri")]
mod commands;

/// Runs the confined-spawn helper and exits, when this process was re-exec'd as
/// one by the Windows sandbox backend. A no-op on every other platform and on a
/// normal launch, but it must be called before anything else in `main`: the
/// helper's whole job is to spawn and wait, so starting the app first would run a
/// second copy of it per shell command.
pub use tools::appcontainer::run_helper_if_requested as run_sandbox_helper_if_requested;

#[cfg(feature = "tauri")]
pub use commands::{AgentToolsError, ToolResult};

/// Initializes the agent tools plugin.
#[cfg(feature = "tauri")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("agent-tools")
        .invoke_handler(tauri::generate_handler![
            commands::workspace_path,
            commands::thread_workspace_path,
            commands::thread_workspace_delete,
            commands::thread_workspace_sweep,
            commands::skill_list,
            commands::skill_read,
            commands::skill_write,
            commands::skill_delete,
            commands::memory_list,
            commands::memory_read,
            commands::memory_write,
            commands::memory_delete,
            commands::tool_schemas,
            commands::sandbox_status,
            commands::execute_tool
        ])
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
        let Some(rest) = src.split_once(start).map(|(_, r)| r) else {
            return Vec::new();
        };
        let Some(block) = rest.split_once(end).map(|(b, _)| b) else {
            return Vec::new();
        };
        block
            .split(',')
            .map(|s| s.trim().trim_matches('"'))
            .filter(|s| !s.is_empty())
            .map(|s| s.rsplit("::").next().unwrap_or(s))
            .collect()
    }

    #[test]
    fn every_registered_command_has_a_permission() {
        let handlers = names_between(include_str!("lib.rs"), "tauri::generate_handler![", "])");
        let declared = names_between(include_str!("../build.rs"), "COMMANDS: &[&str] = &[", "];");
        assert!(!handlers.is_empty(), "failed to parse generate_handler!");
        assert!(!declared.is_empty(), "failed to parse build.rs COMMANDS");
        let missing: Vec<_> = handlers.iter().filter(|c| !declared.contains(c)).collect();
        assert!(
            missing.is_empty(),
            "commands registered but absent from build.rs COMMANDS: {missing:?}"
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
