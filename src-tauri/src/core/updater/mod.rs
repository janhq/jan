// Desktop-only Tauri commands (AppHandle<Wry>) and session store
// (tauri-plugin-store); the headless `jan` CLI build reuses the sibling
// `custom_updater`/`hmac_client` modules for its own usage ping instead
// (`cli::telemetry`), which needs neither.
#[cfg(not(feature = "cli"))]
pub mod commands;
pub mod custom_updater;
pub mod hmac_client;
#[cfg(not(feature = "cli"))]
pub mod session;
