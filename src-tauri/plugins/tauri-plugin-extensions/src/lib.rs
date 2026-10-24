//! Installs, verifies and serves runtime Jan extensions.
//!
//! The pure modules ([`bundle`], [`integrity`], [`manifest`], [`registry`])
//! take paths and bytes and need no `AppHandle`, so they are tested without
//! a Tauri runtime.

pub mod bundle;
pub mod error;
pub mod integrity;
pub mod manifest;
pub mod permissions;
pub mod registry;
pub mod store;
