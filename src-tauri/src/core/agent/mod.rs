//! Shared agent orchestration: the server-side loop and its upstream/provider
//! plumbing, consumed by both the API-server proxy and `tauri-plugin-agent`.

pub mod commands;
pub mod events;
pub mod r#loop;
pub mod permissions;
pub mod project;
pub mod session;
pub mod tools;
pub mod upstream;
