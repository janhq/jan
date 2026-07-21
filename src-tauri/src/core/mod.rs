pub mod agent;
pub mod app;
#[cfg(feature = "cli")]
pub mod cli;
pub mod downloads;
pub mod filesystem;
pub mod mcp;
pub mod server;
// Desktop-only app setup (tray, theme, window wiring); pulls in Tauri GUI types
// (Wry/AppHandle) the headless `jan` CLI build does not link.
#[cfg(not(feature = "cli"))]
pub mod setup;
pub mod state;
pub mod system;
pub mod threads;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod updater;
