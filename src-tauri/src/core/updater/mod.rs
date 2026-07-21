// Desktop-only Tauri commands (AppHandle<Wry>); the headless `jan` CLI build
// still uses the sibling `hmac_client`/`session` modules via `downloads`.
#[cfg(not(feature = "cli"))]
pub mod commands;
pub mod custom_updater;
pub mod hmac_client;
pub mod session;
