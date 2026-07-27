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

#[cfg(test)]
#[cfg(not(feature = "cli"))]
mod tests;
