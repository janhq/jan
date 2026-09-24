//! Shared agent orchestration: the server-side loop and its upstream/provider
//! plumbing, consumed by both the API-server proxy and `tauri-plugin-agent`.
//!
//! The toolset the loop drives -- the built-in tools, their capability gate,
//! permissions, and skill storage -- lives in `tauri_plugin_agent_tools`, which
//! builds with or without Tauri so the desktop app and the headless CLI share
//! one implementation. This module owns orchestration only.

/// Completion pings for backgrounded `bash` commands.
pub mod bg_shell;
// Tauri IPC surface for the desktop agent; the CLI drives the loop directly.
#[cfg(not(feature = "cli"))]
pub mod commands;
pub mod compaction;
pub mod context;
pub mod correlation;
pub mod events;
pub mod genai_bridge;
pub mod git;
// Not cli-gated: `~/.jan/config.toml` is the user's own layer, and its
// `[[hooks]]` have to mean the same thing in the desktop app and the API
// server as they do in the CLI. The rest of the module (provider records, the
// TUI's settings writers) has no consumer outside the CLI, hence the allow
// rather than a second gate per item.
#[cfg_attr(not(feature = "cli"), allow(dead_code))]
pub mod global_config;
#[cfg(feature = "cli")]
pub mod goal;
pub mod hooks_config;
// Host tools are executed by a client over the headless stdio channel, so the
// capability exists only where that channel does. The desktop build has no peer
// that could answer a `tool_request`.
#[cfg(feature = "cli")]
pub mod host_tools;
pub mod interaction;
pub mod r#loop;
pub mod memory;
pub mod plan;
pub mod plugin_commands;
pub mod plugins;
pub mod project;
pub mod prompt;
pub mod reminder;
pub mod session;
pub mod skill_hub;
pub mod skills;
pub mod subagent;
pub mod todo;
pub mod transcript;
pub mod upstream;

// Byte-level prefix-stability tests: the regression suite for epic #8956.
#[cfg(test)]
mod prefix_stability;

/// Render a path for embedding in a hook/plugin-tool shell command in tests.
///
/// The hook runner hands the command to the resolved shell, which on the
/// Windows CI runner is git-bash: a native `C:\Users\...` path reaches it as a
/// backslash-escaped string and those escapes are eaten, so the command writes
/// to a mangled name and the file the test asserts on never appears. Bash
/// accepts forward slashes on Windows, and the quotes keep a path containing
/// spaces a single word.
#[cfg(test)]
pub(crate) fn shell_quoted_path(path: &std::path::Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\\', "/"))
}
