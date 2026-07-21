//! Shared agent orchestration: the server-side loop and its upstream/provider
//! plumbing, consumed by both the API-server proxy and `tauri-plugin-agent`.

pub mod commands;
pub mod compaction;
pub mod context;
pub mod events;
#[cfg(feature = "cli")]
pub mod global_config;
#[cfg(feature = "cli")]
pub mod git;
pub mod r#loop;
pub mod memory;
pub mod permissions;
pub mod project;
pub mod session;
pub mod skill_hub;
pub mod skills;
pub mod subagent;
pub mod tools;
pub mod upstream;
