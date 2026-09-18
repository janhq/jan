//! Shared agent orchestration: the server-side loop and its upstream/provider
//! plumbing, consumed by both the API-server proxy and `tauri-plugin-agent`.
//!
//! The toolset the loop drives -- the built-in tools, their capability gate,
//! permissions, and skill storage -- lives in `tauri_plugin_agent_tools`, which
//! builds with or without Tauri so the desktop app and the headless CLI share
//! one implementation. This module owns orchestration only.

// Tauri IPC surface for the desktop agent; the CLI drives the loop directly.
#[cfg(not(feature = "cli"))]
pub mod commands;
pub mod compaction;
pub mod context;
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
pub mod upstream;

// Byte-level prefix-stability tests: the regression suite for epic #8956.
#[cfg(test)]
mod prefix_stability;
