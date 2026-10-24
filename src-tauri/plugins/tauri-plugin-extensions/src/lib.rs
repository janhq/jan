//! Installs, verifies and serves runtime Jan extensions.
//!
//! The pure modules ([`bundle`], [`integrity`], [`manifest`], [`registry`])
//! take paths and bytes and need no `AppHandle`; [`install`] and [`http`]
//! work on an [`state::ExtensionsState`], so the whole pipeline is tested
//! without a Tauri runtime. The `tauri` feature adds the command surface.

pub mod bundle;
#[cfg(feature = "tauri")]
mod commands;
pub mod error;
pub mod http;
pub mod install;
pub mod integrity;
pub mod manifest;
pub mod permissions;
pub mod registry;
pub mod state;
pub mod store;

#[cfg(feature = "tauri")]
pub use commands::{init, set_local_api_port};
