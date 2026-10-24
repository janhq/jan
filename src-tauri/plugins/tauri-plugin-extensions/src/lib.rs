//! Installs, verifies and serves runtime Jan extensions.
//!
//! The pure modules ([`bundle`], [`integrity`], [`manifest`], [`registry`],
//! [`sources`], [`index`]) take paths and bytes and need no `AppHandle`;
//! [`install`], [`catalog`] and [`http`] work on an
//! [`state::ExtensionsState`], so the whole pipeline is tested without a
//! Tauri runtime. The `tauri` feature adds the command surface.
//!
//! Jan ships no index URL and no key: catalogs come only from index sources
//! the user adds.

pub mod bundle;
pub mod catalog;
#[cfg(feature = "tauri")]
mod commands;
pub mod error;
pub mod http;
pub mod index;
pub mod install;
pub mod integrity;
pub mod manifest;
pub mod permissions;
pub mod registry;
pub mod sources;
pub mod state;
pub mod store;

#[cfg(feature = "tauri")]
pub use commands::{init, set_local_api_port};
