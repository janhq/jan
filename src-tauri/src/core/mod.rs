pub mod agent;
pub mod app;
#[cfg(feature = "cli")]
pub mod cli;
// Download manager, native file dialogs/IO commands, and the system/tray
// command surface are desktop-only; the CLI uses std::fs and its own tools.
#[cfg(not(feature = "cli"))]
pub mod downloads;
#[cfg(not(feature = "cli"))]
pub mod filesystem;
pub mod mcp;
pub mod openai_schema;
pub mod server;
// Desktop-only app setup (tray, theme, window wiring); pulls in Tauri GUI types
// (Wry/AppHandle) the headless `jan` CLI build does not link.
#[cfg(not(feature = "cli"))]
pub mod setup;
pub mod state;
#[cfg(not(feature = "cli"))]
pub mod system;
pub mod threads;

#[cfg(all(not(any(target_os = "android", target_os = "ios")), not(feature = "cli")))]
pub mod updater;
