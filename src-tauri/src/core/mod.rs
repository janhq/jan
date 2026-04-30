pub mod app;
#[cfg(feature = "cli")]
pub mod cli;
pub mod downloads;
pub mod extensions;
pub mod filesystem;
pub mod http;
pub mod mcp;
#[cfg(target_os = "windows")]
pub mod notifications;
pub mod server;
pub mod setup;
pub mod state;
pub mod system;
pub mod threads;
pub mod tray_status;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod updater;
