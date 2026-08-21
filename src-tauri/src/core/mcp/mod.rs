// Tauri command surface + the AppHandle-driven server lifecycle are
// desktop-only; the CLI drives MCP through `core::cli::mcp`.
#[cfg(not(feature = "cli"))]
pub mod commands;
pub mod constants;
#[cfg(not(feature = "cli"))]
pub mod helpers;
#[cfg(not(feature = "cli"))]
pub mod lockfile;
pub mod models;
// OAuth for remote MCP servers: Tauri-free so the CLI drives it today and the
// desktop activation stack can adopt it unchanged.
pub mod oauth;
#[cfg(not(feature = "cli"))]
pub mod progress;

#[cfg(test)]
#[cfg(not(feature = "cli"))]
mod tests;
